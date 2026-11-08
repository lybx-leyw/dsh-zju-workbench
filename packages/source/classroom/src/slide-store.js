/**
 * 课件图片缓存的**文件层**：把 `slide-cache.js` 的决策落成磁盘上的东西。
 *
 * # 为什么缓存的是 PPT 而不是视频
 *
 * 用户报的问题是「翻页经常卡顿」。翻页打的是**一张 100–300 KB 的 jpg**，
 * 而视频是边走 HLS 分片的长连接 —— 前者加缓存收益立竿见影（一次往返换成本地
 * 文件读取），后者要落几个 GB、还要处理 Range 与分片失效，投入产出完全不成比例。
 *
 * # 目录布局
 *
 * ```
 * <directory>/
 *   index.json            # { [缓存键]: { file, bytes, usedAt } }
 *   0001-<键前 12 位>.jpg
 *   0002-<键前 12 位>.jpg
 * ```
 *
 * 索引与文件**以索引为准**：磁盘上多出来的文件不认（可能是上次淘汰到一半），
 * 索引里有但文件没了也不认（用户手删过）。两种偏差都收敛成「没缓存，重下」。
 *
 * # 为什么索引要原子写
 *
 * 这个进程随时可能被关掉。写一半的 JSON 会让下次启动把**整份**索引当损坏，
 * 于是 2 GB 缓存瞬间归零 —— 用户看到的是"缓存根本没生效"。所以写临时文件再
 * `rename`：要么是旧的完整索引，要么是新的完整索引，没有中间态。
 */

import path from 'node:path';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';

import {
  MAX_SLIDE_BYTES,
  CACHE_QUOTA_BYTES,
  cacheKeyForSlide,
  lookupCached,
  mergeIndex,
  missingSlides,
  planEviction,
  removeKeys,
  slideFileName,
} from './slide-cache.js';

/** 索引文件名。放缓存目录内，跟着缓存一起删。 */
const INDEX_FILE = 'index.json';

/** 单个课件的默认下载并发。与 `downloadSlides` 保持一致，避免打爆课堂服务。 */
const DEFAULT_CONCURRENCY = 6;

/** 缓存键的形状。路由与 store 两边都用它挡畸形输入。 */
const KEY_PATTERN = /^[0-9a-f]{32}$/;

/**
 * 判断一个字符串是不是合法缓存键。
 *
 * @param {unknown} key
 * @returns {boolean}
 */
export function isCacheKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/**
 * 判断索引里的 `file` 是不是一个**单段文件名**。
 *
 * 索引是磁盘上的 JSON，用户手改、磁盘损坏、旧版本迁移都会让它带上
 * `../../x.jpg` 这种值。真正的穿越防线在路由层（键必须是十六进制，文件名只能
 * 来自索引），但索引本身也得验一次 —— 否则 `lookup` 会去 `stat` 一个目录外的
 * 路径，那是"验证自己有没有越权"的写法，顺序反了。
 *
 * @param {unknown} name
 * @returns {boolean}
 */
export function isSlideFileName(name) {
  if (typeof name !== 'string' || name === '') return false;
  if (name === '.' || name === '..') return false;
  // 只要 basename 与自身相等，就说明不含目录分隔符（`/`、`\` 都算）。
  if (path.basename(name) !== name) return false;
  // Windows 上 `C:foo.jpg` 是盘符相对路径，basename 也是它自己，得单独挡。
  return !/^[a-zA-Z]:/.test(name);
}

export class SlideCache {
  /**
   * @param {object} options
   * @param {string} options.directory - 缓存目录的**绝对路径**。
   * @param {(options: object) => Promise<{ bytes: number }>} options.download
   *   实际的下载函数，签名同 `ClassroomSource.downloadResource`。
   *   注入而不是内部 import，是为了让这一层不依赖 transport（可单测）。
   * @param {number} [options.quotaBytes] - 总容量配额。
   * @param {number} [options.concurrency] - 下载并发（1–8）。
   * @param {(message: string) => void} [options.log] - 日志出口。
   */
  constructor({ directory, download, quotaBytes = CACHE_QUOTA_BYTES, concurrency = DEFAULT_CONCURRENCY, log = () => {} } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('缓存目录须为绝对路径');
    if (typeof download !== 'function') throw new TypeError('SlideCache 需要一个 download 函数');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new TypeError('下载并发须为 1–8');
    this.directory = directory;
    this.quotaBytes = quotaBytes;
    this.concurrency = concurrency;
    this.download = download;
    this.log = log;
    /** 内存索引。`ready` 之前为 null，避免调用方拿到空索引误判"全都没缓存"。 */
    this.index = null;
    /** 单个文件的下载去重：同一个键同时只下一次。 */
    this.inflight = new Map();
    /** 索引写入串行化 —— 并发 `ensureSlides` 各自算出的新索引会互相覆盖。 */
    this.writing = Promise.resolve();
    this.ready = this.load();
  }

  /** 索引文件路径。 */
  get indexFile() {
    return path.join(this.directory, INDEX_FILE);
  }

  /**
   * 读索引。
   *
   * 任何读取失败都收敛成空索引：缓存是**加速手段**不是数据源，读不到就当没有，
   * 绝不能让它把「打开一节课」变成报错。
   */
  async load() {
    await mkdir(this.directory, { recursive: true });
    let parsed;
    try {
      parsed = JSON.parse(await readFile(this.indexFile, 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.log(`[zhiyun-classroom] 课件缓存索引不可读，按空索引处理：${error?.message ?? error}`);
      }
      this.index = {};
      return this.index;
    }
    // 只保留形状正确的条目：坏条目会在淘汰统计里制造 NaN。
    const clean = {};
    for (const [key, entry] of Object.entries(parsed ?? {})) {
      if (!isCacheKey(key)) continue;
      if (typeof entry?.file !== 'string' || entry.file === '') continue;
      const bytes = Number(entry.bytes);
      if (!Number.isFinite(bytes) || bytes <= 0) continue;
      clean[key] = { file: entry.file, bytes, usedAt: Number(entry.usedAt) || 0 };
    }
    this.index = clean;
    return clean;
  }

  /** 等索引就绪，返回一份**只读**快照。 */
  async snapshot() {
    await this.ready;
    return this.index;
  }

  /**
   * 把索引落盘（原子）。
   *
   * 串行执行：两次 `ensureSlides` 同时结束时会各自持有一份"我这份最新"的索引，
   * 直接 `writeFile` 就是谁后写谁赢，另一批下载结果凭空消失（表现为下次启动重下）。
   * 这里在锁内**重读磁盘合并**，让两次写入的结果取并集。
   *
   * @param {object} next - 调用方算出的新索引。
   */
  persist(next) {
    this.index = next;
    const task = this.writing.then(async () => {
      const tmp = `${this.indexFile}.tmp`;
      await mkdir(this.directory, { recursive: true });
      await writeFile(tmp, JSON.stringify(this.index), { mode: 0o600 });
      await rename(tmp, this.indexFile);
    });
    // 一次写失败不该让后续写入永久卡在 rejected 链上。
    this.writing = task.catch((error) => {
      this.log(`[zhiyun-classroom] 课件缓存索引写入失败：${error?.message ?? error}`);
    });
    return this.writing;
  }

  /**
   * 查一个键的**可用**条目：索引里有，且文件真的在磁盘上。
   *
   * @param {string} key
   * @returns {Promise<{ file: string, bytes: number, usedAt: number, path: string } | null>}
   */
  async lookup(key) {
    if (!isCacheKey(key)) return null;
    const entry = lookupCached(key, await this.snapshot());
    if (entry === null) return null;
    // 索引里的文件名必须先过"单段文件名"这一关，再去碰磁盘。
    if (!isSlideFileName(entry.file)) {
      this.index = removeKeys(this.index, [key]);
      return null;
    }
    const file = path.join(this.directory, entry.file);
    try {
      await stat(file);
    } catch {
      // 索引说有、磁盘上没有：当成没缓存，并顺手把死条目清掉，
      // 否则它会在淘汰统计里占着配额不放。
      this.index = removeKeys(this.index, [key]);
      return null;
    }
    return { ...entry, path: file };
  }

  /**
   * 一张图对外暴露的本地地址。
   *
   * 返回 `null` 表示"还没缓存，别给前端" —— 前端据此回退到原始签名 URL。
   * 刻意**不**返回一个"稍后会有"的地址：那会让 `<img>` 先吃一个 404 再重试，
   * 反倒比直接用原地址更慢。
   */
  async localUrl(key) {
    return (await this.lookup(key)) === null ? null : `/zhiyun-slides/${key}`;
  }

  /**
   * 给一批课件页补上缓存信息。
   *
   * ⚠️ 这是**用户感知延迟上的**函数（每次打开一节课都调一次），所以逐页并发查，
   * 不串行。串行时 83 页 × 一次 `stat` 会把"打开课件"平白拖慢十几毫秒 ——
   * 而缓存存在的理由正是让它变快。
   *
   * @param {Array<{ imageUrl: string }>} slides
   * @returns {Promise<Array<object>>} 每项加 `cacheKey`，命中时再加 `cacheUrl`。
   */
  async decorate(slides) {
    const list = Array.isArray(slides) ? slides : [];
    return Promise.all(list.map(async (slide) => {
      const key = cacheKeyForSlide(slide?.imageUrl);
      if (key === null) return { ...slide };
      const hit = await this.lookup(key);
      return { ...slide, cacheKey: key, ...(hit === null ? {} : { cacheUrl: `/zhiyun-slides/${key}` }) };
    }));
  }

  /**
   * 确保一批课件页在缓存里（缺的下载，已有的跳过）。
   *
   * @param {Array<{ page: number, imageUrl: string }>} slides
   * @param {object} [options]
   * @param {AbortSignal} [options.signal]
   * @param {(progress: object) => void} [options.onProgress]
   * @returns {Promise<{ downloaded: number, skipped: number, failed: number, total: number }>}
   */
  async ensureSlides(slides, { signal, onProgress } = {}) {
    const index = await this.snapshot();
    const todo = missingSlides(slides, index);
    const total = Array.isArray(slides) ? slides.length : 0;
    if (todo.length === 0) {
      // 全命中也要摸一次时间戳：不然"一直在看但没重下"的课会被淘汰挑走。
      await this.touchAll(slides, index);
      return { downloaded: 0, skipped: total, failed: 0, total };
    }

    const results = [];
    let done = 0;
    let failed = 0;
    let cursor = 0;
    const worker = async () => {
      while (cursor < todo.length && !signal?.aborted) {
        const job = todo[cursor++];
        try {
          results.push(await this.fetchOne(job, signal));
        } catch (error) {
          if (error?.code === 'CANCELLED' || signal?.aborted) return;
          failed += 1;
          this.log(`[zhiyun-classroom] 课件第 ${job.page} 页缓存失败：${error?.code ?? error?.message ?? error}`);
        } finally {
          done += 1;
          onProgress?.({ phase: 'cache-slides', completed: done, total: todo.length });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, todo.length) }, worker));

    if (results.length) {
      const merged = mergeIndex(this.index, results);
      await this.persist(merged);
    }
    await this.touchAll(slides, this.index);
    await this.sweep();
    return {
      downloaded: results.length,
      skipped: total - todo.length,
      failed,
      total,
    };
  }

  /**
   * 下一次图。
   *
   * 同一个键并发调用只会真的下一次（`inflight` 去重）：解析与播放面板会同时
   * 请求同一批页，不去重就是双倍流量 + `DOWNLOAD_BUSY` 报错噪声。
   */
  fetchOne(job, signal) {
    const existing = this.inflight.get(job.key);
    if (existing) return existing;
    const task = (async () => {
      const file = job.file ?? slideFileName(job.page, job.key);
      const destination = path.join(this.directory, file);
      try {
        const result = await this.download({ url: job.imageUrl, destination, signal, maxBytes: MAX_SLIDE_BYTES });
        return { key: job.key, file, bytes: result.bytes };
      } catch (error) {
        // 文件已在磁盘上但索引没记（例如上次索引写失败）：认它，别当失败。
        if (error?.code === 'FILE_EXISTS') {
          const size = (await stat(destination)).size;
          if (size > 0) return { key: job.key, file, bytes: size };
        }
        throw error;
      }
    })();
    this.inflight.set(job.key, task);
    task.finally(() => this.inflight.delete(job.key)).catch(() => {});
    return task;
  }

  /**
   * 把一批页标成"刚用过"。
   *
   * 只在**已缓存**的键上生效 —— 没缓存的页会在 `mergeIndex` 里拿到新时间戳。
   */
  async touchAll(slides, index) {
    const keys = [];
    for (const slide of Array.isArray(slides) ? slides : []) {
      const key = cacheKeyForSlide(slide?.imageUrl);
      if (key !== null && lookupCached(key, index) !== null) keys.push(key);
    }
    if (!keys.length) return;
    await this.persist(touchKeys(index, keys));
  }

  /** 按配额淘汰，并真的把文件删掉。 */
  async sweep() {
    const plan = planEviction(this.index, this.quotaBytes);
    if (plan.evict.length === 0) return plan;
    const victims = plan.evict.map((key) => this.index[key]?.file).filter(Boolean);
    await this.persist(removeKeys(this.index, plan.evict));
    for (const file of victims) {
      await rm(path.join(this.directory, file), { force: true }).catch(() => {});
    }
    this.log(`[zhiyun-classroom] 课件缓存淘汰 ${plan.evict.length} 项，释放 ${plan.evictedBytes} 字节`);
    return plan;
  }

  /** 清空整个缓存（设置页的"清除缓存"用）。 */
  async clear() {
    await this.ready;
    await this.persist({});
    await rm(this.directory, { recursive: true, force: true }).catch(() => {});
    await mkdir(this.directory, { recursive: true });
  }

  /** 当前用量，供设置页显示。 */
  async stats() {
    const index = await this.snapshot();
    const entries = Object.values(index);
    return {
      files: entries.length,
      bytes: entries.reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0),
      quotaBytes: this.quotaBytes,
    };
  }
}

/**
 * 给一组已缓存的键打时间戳。
 *
 * 与 `slide-cache.js` 的 `touchIndex` 分开导出，是为了让本文件不必把
 * `touchIndex` 的实现细节（拷一份、逐键展开）泄露到调用方。
 */
function touchKeys(index, keys) {
  const next = { ...index };
  const now = Date.now();
  for (const key of keys) {
    const entry = next[key];
    if (entry === undefined) continue;
    next[key] = { ...entry, usedAt: now };
  }
  return next;
}

/**
 * 课件缓存路由的前缀。客户端拼 `cacheUrl` 时用的是同一个值。
 *
 * 单独一个前缀（不是挂在 `/zhiyun-live` 下）是刻意的：直播转发端点的安全姿态
 * 是"代你去白名单域名取任意 URL"，而这里是"只给你我磁盘上已有的字节"。
 * 两套威胁模型混在一个前缀里，审起来就只能按更松的那个看。
 */
export const SLIDE_ROUTE_PREFIX = '/zhiyun-slides';

/**
 * 创建课件图路由的 handler。
 *
 * 签名与直播转发一致：`(req, res) => Promise<void>`，自己 `writeHead` / `end`。
 *
 * # 安全姿态
 *
 * 这里没有出站请求，唯一的越权风险是**路径穿越**（`../../../.ssh/id_rsa`）。
 * 挡法是把键限制成 32 位十六进制，再用索引把键换成文件名 —— 文件名来自
 * 我们自己的索引，浏览器永远递不进一个路径片段。最后再检查一次
 * `path.resolve` 后仍在缓存目录内，兜住索引本身被改坏的情况。
 *
 * @param {SlideCache} cache
 * @param {object} [options]
 * @param {(event: object) => void} [options.log]
 */
export function createSlideHandler(cache, { log = () => {} } = {}) {
  if (!cache) throw new TypeError('createSlideHandler 需要 SlideCache');
  return async function slideHandler(req, res) {
    res.on('error', () => {});
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'method not allowed');
      return;
    }
    /**
     * ⚠️ 取 pathname 必须在**规范化之前**判前缀。
     *
     * `new URL('/zhiyun-slides/../../etc/passwd', 'http://localhost')` 会把 `..`
     * 折成 `/etc/passwd` —— 前缀没了，`slice(prefix.length)` 却照样切出一段看似
     * 无害的字符串。拿规范化后的结果做前缀判断，等于让一次穿越静默变成"另一个
     * 路由"。所以先用原始 pathname 确认它**确实落在本前缀下**。
     */
    const rawPath = (req.url ?? '/').split('?')[0].split('#')[0];
    const url = new URL(rawPath, 'http://localhost');
    const pathname = url.pathname;
    if (pathname !== SLIDE_ROUTE_PREFIX && !pathname.startsWith(`${SLIDE_ROUTE_PREFIX}/`)) {
      log({ kind: 'slide', status: 404, reason: 'not this route' });
      sendText(res, 404, 'not found');
      return;
    }
    const sub = pathname.slice(SLIDE_ROUTE_PREFIX.length).replace(/^\/+/, '');
    if (sub === '' || sub === 'status') {
      const stats = await cache.stats().catch(() => null);
      sendJson(res, 200, { ok: true, kind: 'slide-cache', route: `${SLIDE_ROUTE_PREFIX}/<key>`, ...(stats ?? {}) });
      return;
    }
    if (!isCacheKey(sub)) {
      log({ kind: 'slide', status: 400, reason: 'bad key' });
      sendText(res, 400, 'bad key');
      return;
    }
    const hit = await cache.lookup(sub).catch(() => null);
    if (hit === null) {
      // 404 是**正常路径**：前端拿到它就回退到原始签名地址，不是错误。
      // 索引损坏（文件名带路径）也走这里 —— 不告诉调用方"这个键存在但被拒"，
      // 那点信息对正常前端没用，对探测者有用。
      res.writeHead(404, { 'cache-control': 'no-store' });
      res.end();
      return;
    }
    // ETag 把「键 + 大小」当版本：同键换了内容（老师重传）大小必变，
    // 于是浏览器会重取，而不是拿旧的 `immutable` 缓存永远显示错误的一页。
    const etag = `"${sub}-${hit.bytes}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { etag, 'cache-control': 'private, no-cache' });
      res.end();
      return;
    }
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': String(hit.bytes),
      // `no-cache` = 存但每次带 ETag 验证。本地回环的一次 304 只有零点几毫秒，
      // 换来的是"课件重传后不会永久显示旧图"这个正确性。
      'cache-control': 'private, no-cache',
      etag,
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    await new Promise((resolve) => {
      const stream = createReadStream(hit.path);
      stream.on('error', () => { res.destroy(); resolve(); });
      stream.on('end', resolve);
      res.on('close', () => { stream.destroy(); resolve(); });
      stream.pipe(res);
    });
    log({ kind: 'slide', status: 200, bytes: hit.bytes });
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}
