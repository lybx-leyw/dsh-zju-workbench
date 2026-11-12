/**
 * 带断点续传的**单文件下载器**。
 *
 * # 为什么它住在 tier 0 的共享层
 *
 * 「把一个已经拿到签名地址的字节流落到磁盘」不属于任何一个站点：地址从哪来
 * （`/api/uploads/<id>/url`、`file.cc98.org`、课件 CDN）是站点知识，而
 * 「Range 怎么续、半截文件叫什么、什么时候算发布成功」是**传输层知识**。
 *
 * `source/classroom` 原先自带一份同语义实现。两份并存的代价是可预期的 ——
 * 续传条件的判断、原子发布的写法、错误码表这三处一旦分叉，两个包的
 * 「下载失败」就会长得不一样，而这类差异**不会有人回头对齐**。
 *
 * **2026-11-12 已合并**：`classroom` 删掉了自己那份，改为引用本文件
 * （`package.json` 加依赖、`dsh.capability.requires` 加一项）。
 * 现在全仓只有这一份下载器。
 *
 * # 与 classroom 那份的差异（合并时一并带过来）
 *
 * 合并后 `classroom` 也获得了本文件的两项能力：**跟随重定向**（它的签名地址
 * 不跳转，但多跟几次没有坏处）与 **只允许 HTTPS**（回环地址例外，给本地
 * 测试服务器用）。
 *
 * # 六条硬约束（每条都对应一次真实的坑）
 *
 * 1. **身份不是签名地址**：签名每小时换一次，每次 query 都不同。续传身份取
 *    `origin + pathname`，且**不把签名 URL 落盘**（那等于把可用链接写进磁盘）。
 * 2. **`If-Range` 必须带**：只发 `Range` 的话，源文件更新后会把新旧字节拼在一起，
 *    得到一个大小正确、内容错位的文件 —— 这是最难发现的一类损坏。
 * 3. **206 的 `Content-Range` 要逐字段核**：起点对不上就重下，不「尽力拼接」。
 * 4. **发布用 `link()`**：`rename()` 会覆盖同名目标，而下载目录里的同名文件
 *    可能是用户上一次下的那份。`link()` 在目标已存在时抛 `EEXIST`，于是
 *    「不覆盖」是内核保证的，不是本文件的口头约定。
 * 5. **失败保留 `.part`**：中断（超时、取消、网络断）之后，下次调用从断点接着下；
 *    只有在**源变了**（`DOWNLOAD_CHANGED`）时才允许丢掉旧的部分。
 * 6. **同一目标同进程只下一个**：两个并发下载写同一个 `.part` 会产生交叉字节。
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { stat, readFile, writeFile, mkdir, link, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ClassroomError } from './errors.js';

/** 正在下载的目标（大小写不敏感的文件系统上要归一）。 */
const activePaths = new Set();

/** 需要自己跟的那些状态码（`Transport` 不跟重定向，见契约说明）。 */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * 文件大小；不存在算 0。
 *
 * @param file - 绝对路径。
 * @returns 字节数。
 */
const sizes = async (file) => {
  try { return (await stat(file)).size; } catch (error) { if (error.code === 'ENOENT') return 0; throw error; }
};

/**
 * 只允许 HTTPS（回环地址允许 HTTP，给本地测试服务器用）。
 *
 * 为什么值得单独拦：签名地址里带着授权，走明文等于把「谁能下这个文件」
 * 交给链路上的每一跳。
 *
 * @param target - 已解析的 URL。
 * @returns 是否可下载。
 */
const transportable = (target) => target.protocol === 'https:'
  || (target.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));

/**
 * 下载一个文件到 `destination`，支持断点续传与原子发布。
 *
 * @param transport - 带 `request(url, { stream, auth, headers, signal, timeoutMs })`
 *   的传输层（本仓的 `Transport` 满足）。**不使用 Cookie**（`auth: false`）：
 *   签名地址自带授权，把会话 cookie 发给对象存储域名是没必要的暴露面。
 * @param options.url - 已签名的下载地址。
 * @param options.destination - 绝对路径。**已存在即失败**（`FILE_EXISTS`）。
 * @param [options.signal] - 中止信号。
 * @param [options.onProgress] - `({ phase, received, total, resumed }) => void`。
 * @param [options.maxBytes] - 上限（0 = 不限）。超出即 `DOWNLOAD_SIZE`。
 * @param [options.timeoutMs] - 单个请求的超时。
 * @param [options.maxRedirects] - 最多跟几次重定向。
 * @returns `{ destination, bytes, resumed }`。
 * @throws {ClassroomError} `DOWNLOAD_BUSY` / `FILE_EXISTS` / `DOWNLOAD_RANGE` /
 *   `DOWNLOAD_CHANGED` / `DOWNLOAD_HTTP` / `DOWNLOAD_SIZE` / `DOWNLOAD_BODY` /
 *   `DOWNLOAD_INCOMPLETE` / `DOWNLOAD_IO` / `CANCELLED` / `TIMEOUT`。
 */
export async function download(transport, {
  url, destination, signal, onProgress, maxBytes = 0, timeoutMs = 1200000, maxRedirects = 5,
} = {}) {
  if (!path.isAbsolute(destination ?? '')) throw new TypeError('下载目标须为绝对路径');
  destination = path.resolve(destination);
  const key = process.platform === 'win32' ? destination.toLowerCase() : destination;
  if (activePaths.has(key)) throw new ClassroomError('DOWNLOAD_BUSY', '这个文件正在下载');
  activePaths.add(key);
  let opened;
  const partial = `${destination}.part`;
  const metadata = `${partial}.json`;
  try {
    try {
      await stat(destination);
      throw new ClassroomError('FILE_EXISTS', '目标文件已存在');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }

    const initial = new URL(url);
    // 续传认的是「存储上的同一个文件」，不是「同一串签名地址」：签名换了，
    // 文件没换。反过来把完整 URL 当身份，每次重试都会从零开始。
    const identity = createHash('sha256').update(`${initial.origin}${initial.pathname}`).digest('hex');
    let cached;
    try { cached = JSON.parse(await readFile(metadata, 'utf8')); } catch { /* 缺校验信息的半成品一律从零下 */ }
    let offset = cached?.identity === identity && cached?.etag ? await sizes(partial) : 0;
    const headers = offset ? { Range: `bytes=${offset}-`, 'If-Range': cached.etag } : {};

    let current = initial;
    let response;
    for (let hop = 0; ; hop += 1) {
      if (!transportable(current)) {
        throw new ClassroomError('DOWNLOAD_HTTP', '下载地址必须是 HTTPS，已拒绝', { protocol: current.protocol });
      }
      opened = await transport.request(current.href, { signal, headers, stream: true, auth: false, timeoutMs });
      response = opened.response;
      if (!REDIRECTS.has(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      opened.release();
      opened = undefined;
      if (!location) throw new ClassroomError('DOWNLOAD_HTTP', '下载重定向缺少目标地址', { status: response.status });
      if (hop >= maxRedirects) throw new ClassroomError('DOWNLOAD_HTTP', '下载重定向次数过多', { hops: hop + 1 });
      const next = new URL(location, current);
      // 只许同协议：https → http 的一跳等于把文件交给链路上的每一跳。
      if (next.protocol !== current.protocol) {
        throw new ClassroomError('DOWNLOAD_HTTP', '下载重定向试图更换协议，已拒绝', { protocol: next.protocol });
      }
      current = next;
    }

    const etag = response.headers.get('etag');
    let total = 0;
    let resumed = false;
    if (response.status === 206) {
      const range = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
      // 起点对不上就报错，不「尽力拼接」：拼出来的文件大小对、内容错位。
      if (!range || Number(range[1]) !== offset || Number(range[2]) < offset || Number(range[3]) <= Number(range[2])) {
        throw new ClassroomError('DOWNLOAD_RANGE', '续传范围与本地文件不一致');
      }
      total = Number(range[3]);
      resumed = offset > 0;
      if (offset && etag && etag !== cached.etag) {
        throw new ClassroomError('DOWNLOAD_CHANGED', '资源已更新，无法续传旧文件');
      }
    } else if (response.status === 200) {
      // 服务器忽略了 Range（或本来就没给）：从头写，旧的部分作废。
      offset = 0;
      total = Number(response.headers.get('content-length') ?? 0);
    } else {
      throw new ClassroomError('DOWNLOAD_HTTP', '资源下载请求失败', { status: response.status });
    }
    if (!Number.isSafeInteger(total) || total < 0) throw new ClassroomError('DOWNLOAD_SIZE', '资源长度异常');
    if (maxBytes > 0 && total > maxBytes) throw new ClassroomError('DOWNLOAD_SIZE', '资源超过下载大小限制');
    if (!response.body) throw new ClassroomError('DOWNLOAD_BODY', '下载响应缺少内容');

    await mkdir(path.dirname(destination), { recursive: true });
    // 元数据在**开始写字节之前**落盘：中断后下次才知道这半截是谁的。
    await writeFile(metadata, JSON.stringify({ identity, etag: etag?.startsWith('W/') ? null : etag }), { mode: 0o600 });

    let received = offset;
    const progress = new Transform({
      transform(chunk, encoding, callback) {
        received += chunk.length;
        if (maxBytes > 0 && received > maxBytes || total > 0 && received > total) {
          return callback(new ClassroomError('DOWNLOAD_SIZE', '下载内容超出预期长度'));
        }
        try {
          onProgress?.({ phase: 'download', received, total: total || null, resumed });
          callback(null, chunk);
        } catch (error) { callback(error); }
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      progress,
      createWriteStream(partial, { flags: resumed ? 'a' : 'w' }),
      { signal: opened.signal },
    );
    if (total && received !== total) throw new ClassroomError('DOWNLOAD_INCOMPLETE', '资源尚未下载完整');

    // 原子发布且**永不覆盖**：`link` 在目标已存在时抛 EEXIST，那是内核给的保证。
    try { await link(partial, destination); } catch (error) {
      if (error.code === 'EEXIST') throw new ClassroomError('FILE_EXISTS', '目标文件已存在');
      throw error;
    }
    await rm(partial);
    await rm(metadata, { force: true });
    return { destination, bytes: received, resumed };
  } catch (error) {
    if (error instanceof ClassroomError || error instanceof TypeError) throw error;
    if (opened?.signal.aborted || signal?.aborted) {
      throw new ClassroomError(
        opened?.signal.reason?.name === 'TimeoutError' ? 'TIMEOUT' : 'CANCELLED',
        '下载已取消或超时',
      );
    }
    throw new ClassroomError('DOWNLOAD_IO', '下载中断，已保留可续传的临时文件');
  } finally {
    if (opened) {
      await opened.response.body?.cancel().catch(() => {});
      opened.release();
    }
    activePaths.delete(key);
  }
}
