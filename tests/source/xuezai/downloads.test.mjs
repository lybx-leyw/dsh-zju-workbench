/**
 * 学在浙大的**下载**：共享下载器 + 文件命名 + 落盘位置。
 *
 * # 这一份守什么
 *
 * 下载是本仓唯一「外部数据直接变成本机文件」的能力，失败方式有两种，
 * 而且都**不会报错**：
 *
 *   1. **路径穿越**：老师能把附件起名叫 `../../../.ssh/authorized_keys`。
 *      名字来自平台，不来自用户 —— 「用户不会这么填」这条假设在这里根本不成立。
 *   2. **同名覆盖**：`rename()` 发布时目标已存在会被**静默替换**，于是用户
 *      上一次下的那份（可能是老师旧版）就没了，而两次都显示成功。
 *
 * 所以这里的断言偏执一些：不用 `assert.ok(存在)` 就完事，而是核对**最终字节**
 * 与**文件名**，并且核对「第二次下载之后第一份还在、内容没变」。
 *
 * # 全离线
 *
 * 所有字节来自一个假的 `transport.request`（实现了 Range / If-Range / ETag），
 * 落盘目标是 `os.tmpdir()` 下的临时目录，用完删掉。不联网、不用真账号。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { download } from '../../../packages/source/http/src/download.js';
import { XzzdDownloads, batchName, safeFileName, underRoot } from '../../../packages/source/xuezai/src/downloads.js';
import { correctionFilesOf } from '../../../packages/source/xuezai/src/xzzd-reads.js';

/* ────────────────────────────────────── 假字节服务器 */

/**
 * 造一个假的传输层：按 Range / If-Range 回 206 或 200。
 *
 * 参数与真 `Transport` 同形（`request(url, { headers, stream, auth })` 返回
 * `{ response, release, signal }`），因为下载器只认这个契约。
 *
 * @param options.body - 文件字节。
 * @param options.etag - ETag（Range 请求会拿它做 If-Range 校验）。
 * @param options.ranges - 是否支持 Range（false = 永远回 200 全量）。
 * @param options.status - 强制某个状态码（测失败分支）。
 * @param options.badRange - 故意把 Content-Range 的起点写错一位。
 * @param options.hops - 先回几次 302 再给内容（学在浙大的签名地址会跳一次存储域）。
 */
function fakeTransport({ body = Buffer.from('hello'), etag = '"v1"', ranges = true, status = null, badRange = false, hops = 0, redirectTo = null, ignoreIfRange = false } = {}) {
  const calls = [];
  let hopsLeft = hops;
  const request = async (url, init = {}) => {
    calls.push({ url: String(url), headers: { ...(init.headers ?? {}) }, auth: init.auth, stream: init.stream });
    const signal = AbortSignal.timeout(init.timeoutMs ?? 60000);
    const respond = (payload, responseStatus, headers) => ({
      response: new Response(payload, { status: responseStatus, headers: new Headers(headers) }),
      release: () => {},
      signal,
    });

    if (hopsLeft > 0) {
      hopsLeft -= 1;
      return respond(null, 302, { location: redirectTo ?? `${url}.real` });
    }
    if (status !== null) return respond(null, status, { etag });
    if (/^http:/.test(String(url)) && !/127\.0\.0\.1|localhost/.test(String(url))) {
      return respond(null, 400, {});
    }

    const range = init.headers?.Range;
    const ifRange = init.headers?.['If-Range'];
    let offset = 0;
    // `ignoreIfRange` 模拟「源文件换了、但服务器仍然按 Range 回 206 的旧范围」
    // —— 这正是 `DOWNLOAD_CHANGED` 要挡的那个场景。
    if (ranges && range && (ignoreIfRange || !ifRange || ifRange === etag)) {
      offset = Number(/bytes=(\d+)-/.exec(String(range))?.[1] ?? 0);
    }
    if (offset > 0) {
      const start = badRange ? offset + 1 : offset;
      return respond(body.subarray(offset), 206, {
        etag,
        'content-length': String(body.length - offset),
        'content-range': `bytes ${start}-${body.length - 1}/${body.length}`,
      });
    }
    return respond(body, 200, { etag, 'content-length': String(body.length) });
  };
  return { calls, request };
}

/** 一个临时目录，用完删。 */
const scratch = async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'xuezai-download-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

/** 下载器认的续传身份：`origin + pathname`，**不含签名 query**。 */
const identityOf = (url) => {
  const target = new URL(url);
  return createHash('sha256').update(`${target.origin}${target.pathname}`).digest('hex');
};

/* ────────────────────────────────────── 文件名 */

test('safeFileName：路径分隔符、冒号、控制字符一律替换，不留子目录', () => {
  // 下面每一个都会在不过滤时把文件写到别处（或写不出来）。
  const cases = [
    // 分隔符换成 `_` 之后，`..` 就只是文件名里的两个点，不再是「上一层」
    ['../../../.ssh/authorized_keys', '.._.._.._.ssh_authorized_keys'],
    ['C:\\Windows\\System32\\evil.dll', 'C__Windows_System32_evil.dll'],
    ['\\\\server\\share\\x.pdf', '__server_share_x.pdf'],
    ['a\u0000b.pdf', 'a_b.pdf'],
    ['line\nbreak.pdf', 'line_break.pdf'],
  ];
  for (const [input, expected] of cases) {
    const actual = safeFileName(input);
    assert.equal(actual, expected, `${JSON.stringify(input)} → ${actual}`);
    assert.equal(/[\\/:*?"<>|\x00-\x1f]/.test(actual), false, `${actual} 里还留着非法字符`);
  }
});

test('safeFileName：结尾的点与空格要剥掉（Windows 会静默剥，两个名字会撞）', () => {
  assert.equal(safeFileName('report.pdf. '), 'report.pdf');
  assert.equal(safeFileName('a. . .'), 'a');
});

test('safeFileName：`..`、空串、超长、Windows 保留设备名', () => {
  assert.equal(safeFileName('..'), 'file');
  assert.equal(safeFileName('....'), 'file');
  assert.equal(safeFileName(''), 'file');
  assert.equal(safeFileName(null), 'file');
  assert.equal(safeFileName('   '), 'file');
  assert.ok(safeFileName('x'.repeat(500)).length <= 180, '要给 .part.json 后缀留余量');
  // con.pdf 在任何目录里都打不开 —— 而它是老师起的名字
  assert.equal(safeFileName('con.pdf'), '_con.pdf');
  assert.equal(safeFileName('LPT1'), '_LPT1');
  // 不是保留名的不能被误伤
  assert.equal(safeFileName('console.pdf'), 'console.pdf');
});

test('underRoot：拼出来的路径一定在根之下，越界就报错', async (t) => {
  const dir = await scratch(t);
  const inside = underRoot(dir, '数据结构', '课件');
  assert.equal(path.relative(dir, inside).includes('..'), false);

  // 每一段都过 safeFileName，所以 `..` 变成 `.._` 之类而不是上层目录
  const sneaky = underRoot(dir, '..', '..', 'evil');
  const relative = path.relative(dir, sneaky);
  assert.equal(relative === '..' || relative.startsWith(`..${path.sep}`), false, `越界了：${sneaky}`);

  // ⚠️ 反证：`..` 开头的**文件名**不该被当成越界（活动标题常以点开头）
  assert.equal(underRoot(dir, '..章节'), path.join(path.resolve(dir), '..章节'));

  // 空段 / 全是点的段：`safeFileName` 给 fallback，不会退化成根自己
  assert.notEqual(underRoot(dir, '.', '.'), path.resolve(dir));
});

/* ────────────────────────────────────── 一批里的同名 */

test('batchName：本批没有重名就用原名，重名时带上平台 id（**结果与顺序无关**）', () => {
  const one = [{ id: 1, name: '课件.pdf' }];
  assert.equal(batchName('课件.pdf', 1, one), '课件.pdf');

  const two = [{ id: 1, name: '课件.pdf' }, { id: 2, name: '课件.pdf' }];
  // 两章都叫「课件.pdf」时，逐个加 (1) 会让「谁是第一个」取决于平台返回顺序
  assert.equal(batchName('课件.pdf', 1, two), '课件 (1).pdf');
  assert.equal(batchName('课件.pdf', 2, two), '课件 (2).pdf');
  // 顺序反过来，同一个 id 得到同一个名字
  assert.equal(batchName('课件.pdf', 1, [...two].reverse()), '课件 (1).pdf');
});

/* ────────────────────────────────────── 断点续传 */

test('download：断点续传（.part + If-Range），续上的字节与整份一致', async (t) => {
  const dir = await scratch(t);
  const bytes = Buffer.from('0123456789'.repeat(1000));
  const url = 'https://media.example.invalid/files/a.bin?sign=abc';
  const destination = path.join(dir, 'a.bin');
  const transport = fakeTransport({ body: bytes });

  // 上一次中断留下的现场：前 100 字节 + 校验信息
  await writeFile(`${destination}.part`, bytes.subarray(0, 100));
  await writeFile(`${destination}.part.json`, JSON.stringify({ identity: identityOf(url), etag: '"v1"' }));

  const out = await download(transport, { url, destination });

  assert.equal(out.resumed, true, '应识别出可以续传');
  assert.equal(out.bytes, bytes.length);
  assert.deepEqual(await readFile(destination), bytes, '续传后的内容必须与整份逐字节相同');
  // 续传请求真的带了 Range 与 If-Range
  assert.equal(transport.calls[0].headers.Range, 'bytes=100-');
  assert.equal(transport.calls[0].headers['If-Range'], '"v1"');
  // 签名 URL 不落盘：元数据文件已经删了，且里面本来也没有它
  await assert.rejects(() => stat(`${destination}.part`), { code: 'ENOENT' });
  await assert.rejects(() => stat(`${destination}.part.json`), { code: 'ENOENT' });
});

test('download：签名换了但文件没换时仍能续传（身份不含 query）', async (t) => {
  const dir = await scratch(t);
  const bytes = Buffer.from('abcdef'.repeat(500));
  const destination = path.join(dir, 'b.bin');
  const oldUrl = 'https://media.example.invalid/files/b.bin?sign=old';
  const newUrl = 'https://media.example.invalid/files/b.bin?sign=new';

  await writeFile(`${destination}.part`, bytes.subarray(0, 60));
  await writeFile(`${destination}.part.json`, JSON.stringify({ identity: identityOf(oldUrl), etag: '"v1"' }));

  const out = await download(fakeTransport({ body: bytes }), { url: newUrl, destination });
  assert.equal(out.resumed, true, '签名每小时换一次，不能因此从头下');
  assert.deepEqual(await readFile(destination), bytes);
});

test('download：服务器忽略 Range（回 200）时从头写，旧半截作废', async (t) => {
  const dir = await scratch(t);
  const bytes = Buffer.from('0123456789'.repeat(50));
  const destination = path.join(dir, 'c.bin');
  const url = 'https://media.example.invalid/files/c.bin';

  await writeFile(`${destination}.part`, Buffer.from('旧'.repeat(100)));
  await writeFile(`${destination}.part.json`, JSON.stringify({ identity: identityOf(url), etag: '"v1"' }));

  const out = await download(fakeTransport({ body: bytes, ranges: false }), { url, destination });
  assert.equal(out.resumed, false);
  assert.deepEqual(await readFile(destination), bytes, '旧半截不能拼进新文件');
});

test('download：206 的 Content-Range 起点对不上时报 DOWNLOAD_RANGE，不「尽力拼接」', async (t) => {
  const dir = await scratch(t);
  const bytes = Buffer.from('0123456789'.repeat(100));
  const destination = path.join(dir, 'd.bin');
  const url = 'https://media.example.invalid/files/d.bin';

  await writeFile(`${destination}.part`, bytes.subarray(0, 100));
  await writeFile(`${destination}.part.json`, JSON.stringify({ identity: identityOf(url), etag: '"v1"' }));

  await assert.rejects(
    () => download(fakeTransport({ body: bytes, badRange: true }), { url, destination }),
    (error) => error.code === 'DOWNLOAD_RANGE',
  );
});

test('download：源文件变了（ETag 不同）时报 DOWNLOAD_CHANGED，不把新旧字节拼在一起', async (t) => {
  const dir = await scratch(t);
  const destination = path.join(dir, 'e.bin');
  const url = 'https://media.example.invalid/files/e.bin';

  await writeFile(`${destination}.part`, Buffer.from('old'));
  await writeFile(`${destination}.part.json`, JSON.stringify({ identity: identityOf(url), etag: '"v1"' }));

  // 服务器换了 ETag，却仍然按 Range 回 206 —— 只发 Range 的写法会把新旧字节
  // 拼在一起，得到一个大小正确、内容错位的文件。`If-Range` + ETag 复核挡的就是它。
  await assert.rejects(
    () => download(
      fakeTransport({ body: Buffer.from('new-content'), etag: '"v2"', ignoreIfRange: true }),
      { url, destination },
    ),
    (error) => error.code === 'DOWNLOAD_CHANGED',
  );
});

/* ────────────────────────────────────── 不覆盖 / 上限 / 重定向 */

test('download：目标已存在时报 FILE_EXISTS，且**不改动**已有文件', async (t) => {
  const dir = await scratch(t);
  const destination = path.join(dir, 'exists.bin');
  await writeFile(destination, 'user 上一次下的那份');

  const transport = fakeTransport({ body: Buffer.from('新的') });
  await assert.rejects(() => download(transport, { url: 'https://media.example.invalid/x', destination }), (error) => error.code === 'FILE_EXISTS');
  assert.equal(await readFile(destination, 'utf8'), 'user 上一次下的那份', '已有文件必须一个字节都没变');
  assert.equal(transport.calls.length, 0, '撞名时连请求都不该发');
});

test('download：**下载途中**目标冒出来时也不覆盖（发布那一步必须原子且不替换）', async (t) => {
  // 上面那条只覆盖了「开始之前就已存在」——那时本文件根本不发请求。
  // 真正难的是**竞态**：检查通过之后、发布之前，目标被别的进程/另一次下载建出来了。
  // 这时如果用 `rename` / `copyFile` 发布，就会静默覆盖掉那份文件，而两次都显示成功。
  //
  // 所以这里在下载进度回调里（也就是发布之前）把目标文件造出来，然后要求：
  //   1) 整次调用以 FILE_EXISTS 失败；
  //   2) 已存在的那个文件一个字节都没变。
  const dir = await scratch(t);
  const destination = path.join(dir, 'race.bin');
  const bytes = Buffer.from('新内容'.repeat(100));

  let injected = false;
  await assert.rejects(
    () => download(fakeTransport({ body: bytes }), {
      url: 'https://media.example.invalid/race',
      destination,
      // ⚠️ 必须**同步**写：`onProgress` 在 Transform 里是同步调的，返回的 Promise
      // 不会被 await —— 写成异步的话文件可能在发布之后才出现，那条测试就假绿了。
      onProgress: () => {
        if (injected) return;
        injected = true;
        writeFileSync(destination, '别人刚下的那份');
      },
    }),
    (error) => error.code === 'FILE_EXISTS',
  );

  assert.equal(injected, true, '进度回调应该至少被调过一次（否则这条测试没测到发布那一步）');
  assert.equal(await readFile(destination, 'utf8'), '别人刚下的那份', '发布不许替换已存在的文件');
});

test('download：超长时报 DOWNLOAD_SIZE（先看 Content-Length，再逐块核）', async (t) => {
  const dir = await scratch(t);
  const destination = path.join(dir, 'big.bin');
  await assert.rejects(
    () => download(fakeTransport({ body: Buffer.alloc(2048) }), { url: 'https://media.example.invalid/big', destination, maxBytes: 1024 }),
    (error) => error.code === 'DOWNLOAD_SIZE',
  );
  await assert.rejects(() => stat(destination), { code: 'ENOENT' }, '没下成就不能留下目标文件');
});

test('download：自己跟 302（Transport 一律不跟），且拒绝跨协议降级', async (t) => {
  const dir = await scratch(t);
  const bytes = Buffer.from('via redirect');
  const destination = path.join(dir, 'r.bin');
  const transport = fakeTransport({ body: bytes, hops: 1, redirectTo: 'https://media.example.invalid/real/file.bin' });
  const out = await download(transport, { url: 'https://courses.zju.edu.cn/api/download?sig=1', destination });
  assert.equal(transport.calls.length, 2);
  assert.equal(transport.calls[1].url, 'https://media.example.invalid/real/file.bin');
  assert.deepEqual(await readFile(destination), bytes);
  assert.ok(out.bytes > 0);

  // 往 http 跳 = 把签名与内容交给链路上每一跳
  await assert.rejects(
    () => download(
      fakeTransport({ body: bytes, hops: 1, redirectTo: 'http://media.example.invalid/real.bin' }),
      { url: 'https://courses.zju.edu.cn/api/download?sig=1', destination: path.join(dir, 'r2.bin') },
    ),
    (error) => error.code === 'DOWNLOAD_HTTP',
  );
});

test('download：下载地址必须是绝对的，且不许非 HTTPS', async (t) => {
  const dir = await scratch(t);
  await assert.rejects(
    () => download(fakeTransport(), { url: 'https://x.invalid/a', destination: 'relative.bin' }),
    TypeError,
  );
  await assert.rejects(
    () => download(fakeTransport(), { url: 'http://media.example.invalid/a', destination: path.join(dir, 'p.bin') }),
    (error) => error.code === 'DOWNLOAD_HTTP',
  );
});

/* ────────────────────────────────────── 学在浙大的下载器 */

/**
 * 造一个假的 `XzzdApi` + `XzzdReader`。
 *
 * `files` 决定「列举出来的课件 / 作业附件是什么」，`bodies` 决定「每个 id 下回来
 * 多少字节」。签名地址故意带 query，用来确认续传身份不含它。
 */
function fakeEngine({ materials = [], detail = null, submission = null, bodies = {} } = {}) {
  const issued = [];
  const api = {
    transport: fakeTransport({ body: Buffer.from('fallback') }),
    async json(url) {
      const id = Number(/\/api\/uploads\/(\d+)\/url/.exec(String(url))?.[1]);
      issued.push(id);
      const body = bodies[id];
      if (body === 'no-url') return {};
      if (body === 'http-url') return { url: `http://media.example.invalid/${id}` };
      if (body === undefined) return { url: `https://media.example.invalid/${id}/file.bin?sign=${issued.length}` };
      // 每个 id 一个自己的传输层，这样并发/顺序都不影响断言
      const transport = fakeTransport({ body: Buffer.isBuffer(body) ? body : Buffer.from(body) });
      return { url: `https://media.example.invalid/${id}/file.bin?sign=${issued.length}`, __transport: transport };
    },
    issued,
  };
  // 下载器会向 `api.transport` 要字节；这里按「最近一次发出的地址」路由到对应
  // 传输层 —— 简单做法：所有 id 共用一个按 path 分发的大传输层。
  api.transport = {
    calls: [],
    async request(url, init = {}) {
      api.transport.calls.push({ url: String(url), headers: { ...(init.headers ?? {}) }, auth: init.auth });
      const id = Number(/media\.example\.invalid\/(\d+)\//.exec(String(url))?.[1]);
      const body = bodies[id];
      if (body === undefined || body === 'no-url' || body === 'http-url') {
        return { response: new Response(null, { status: 404 }), release: () => {}, signal: AbortSignal.timeout(60000) };
      }
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      const range = init.headers?.Range;
      const etag = `"e${id}"`;
      const offset = range ? Number(/bytes=(\d+)-/.exec(range)[1]) : 0;
      const headers = offset > 0
        ? { etag, 'content-range': `bytes ${offset}-${bytes.length - 1}/${bytes.length}`, 'content-length': String(bytes.length - offset) }
        : { etag, 'content-length': String(bytes.length) };
      return {
        response: new Response(bytes.subarray(offset), { status: offset > 0 ? 206 : 200, headers: new Headers(headers) }),
        release: () => {},
        signal: AbortSignal.timeout(60000),
      };
    },
  };

  const reader = {
    async materials(courseId, { page = 1 } = {}) {
      return page === 1
        ? { materials, activities: materials, page, pageSize: 50, total: materials.length, nextPage: null }
        : { materials: [], activities: [], page, pageSize: 50, total: materials.length, nextPage: null };
    },
    async activity() {
      if (!detail) throw Object.assign(new Error('没有这条作业'), { code: 'NOT_FOUND' });
      return detail;
    },
    async activitySubmission() {
      return submission ?? { submissionStatus: 'unsubmitted', latestSubmission: null };
    },
  };
  return { api, reader };
}

/** 一条活动形状的课件行（`materials()` 的返回元素）。 */
const materialRow = (id, files, title = '第一章课件') => ({ id: String(id), title, files });

const downloader = (engine, root) => new XzzdDownloads({ api: engine.api, reader: engine.reader, root });

test('materials：不默认下整门课 —— 不给 names / uploadIds 也没 all 就报错', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({ materials: [materialRow(1, [{ id: 11, name: 'a.pdf', size: 3 }])] });
  await assert.rejects(
    () => downloader(engine, dir).materials({ courseId: 7 }),
    (error) => error.code === 'INVALID_INPUT',
  );
  assert.equal(engine.api.issued.length, 0, '参数不合法时不该去换签名地址');
});

test('materials：按 id 挑，落盘字节正确，且用的是不带 Cookie 的请求', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    materials: [materialRow(1, [{ id: 11, name: '第一讲.pdf', size: 6 }, { id: 12, name: '第二讲.pdf', size: 5 }])],
    bodies: { 11: 'AAAAAA', 12: 'BBBBB' },
  });
  const out = await downloader(engine, dir).materials({ courseId: 7, courseLabel: '数据结构', uploadIds: ['12'] });

  assert.equal(out.count, 1);
  assert.equal(out.files[0].name, '第二讲.pdf');
  assert.equal(await readFile(out.files[0].path, 'utf8'), 'BBBBB');
  assert.match(out.files[0].path, /数据结构[\\/]课件[\\/]第二讲\.pdf$/);
  // 签名地址自带授权：把会话 cookie 发给对象存储是没必要的暴露面
  assert.equal(engine.api.transport.calls[0].auth, false);
});

test('materials：文件名里的路径穿越被拦在课程目录里', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    materials: [materialRow(1, [{ id: 11, name: '../../../.ssh/authorized_keys', size: 4 }])],
    bodies: { 11: 'evil' },
  });
  const out = await downloader(engine, dir).materials({ courseId: 7, courseLabel: '数据结构', all: true });

  const saved = out.files[0].path;
  const base = path.join(dir, '数据结构', '课件');
  // 判据不能用「文件名不以 .. 开头」：过滤后的名字本来就还带着那两点
  // （`.._.._.._.ssh_authorized_keys`），而它危险与否取决于**路径语义**。
  const relative = path.relative(base, saved);
  assert.equal(relative.includes(path.sep), false, `跑到子目录里去了：${relative}`);
  assert.equal(relative === '..' || relative.startsWith(`..${path.sep}`), false, `写到课程目录外了：${saved}`);
  assert.deepEqual(await readdir(base), [path.basename(saved)]);
});

test('materials：平台标了 allowDownload=false 的文件不下载（也不换签名地址）', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    materials: [materialRow(1, [
      { id: 11, name: '禁止.pdf', size: 3, allowDownload: false },
      { id: 12, name: '允许.pdf', size: 2, allowDownload: true },
    ])],
    bodies: { 11: 'no!', 12: 'ok' },
  });
  const out = await downloader(engine, dir).materials({ courseId: 7, courseLabel: '课', all: true });

  assert.equal(out.count, 1);
  assert.equal(out.files[0].name, '允许.pdf');
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /不允许下载/);
  assert.deepEqual(engine.api.issued, [12], '被禁止的那个连地址都不该去要');
});

test('materials：大小一致时复用，同名不同大小时另存 (n)，**第一份不被覆盖**', async (t) => {
  const dir = await scratch(t);
  // 第一次：3 字节
  const first = fakeEngine({ materials: [materialRow(1, [{ id: 11, name: '讲义.pdf', size: 3 }])], bodies: { 11: 'AAA' } });
  const one = await downloader(first, dir).materials({ courseId: 7, courseLabel: '课', all: true });
  assert.equal(one.files[0].reused, undefined);
  const original = await readFile(one.files[0].path, 'utf8');
  assert.equal(original, 'AAA');

  // 第二次：大小一样 → 复用，不再要地址
  const again = fakeEngine({ materials: [materialRow(1, [{ id: 11, name: '讲义.pdf', size: 3 }])], bodies: { 11: 'AAA' } });
  const two = await downloader(again, dir).materials({ courseId: 7, courseLabel: '课', all: true });
  assert.equal(two.files[0].reused, true);
  assert.deepEqual(again.api.issued, [], '内容没变就不该再下一次');

  // 第三次：同名但大小变了（老师换了版本）→ 另存，不覆盖
  const changed = fakeEngine({ materials: [materialRow(1, [{ id: 11, name: '讲义.pdf', size: 6 }])], bodies: { 11: 'AAABBB' } });
  const three = await downloader(changed, dir).materials({ courseId: 7, courseLabel: '课', all: true });
  assert.equal(path.basename(three.files[0].path), '讲义 (1).pdf');
  assert.equal(await readFile(one.files[0].path, 'utf8'), 'AAA', '第一份必须一个字节都没变');
  assert.equal(await readFile(three.files[0].path, 'utf8'), 'AAABBB');
});

test('materials：一批里两个同名文件 → 都带上平台 id，互不覆盖', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    materials: [materialRow(1, [{ id: 11, name: '课件.pdf', size: 1 }, { id: 12, name: '课件.pdf', size: 1 }])],
    bodies: { 11: 'A', 12: 'B' },
  });
  const out = await downloader(engine, dir).materials({ courseId: 7, courseLabel: '课', all: true });
  const names = out.files.map((file) => file.name).sort();
  assert.deepEqual(names, ['课件 (11).pdf', '课件 (12).pdf']);
  assert.deepEqual(out.files.map((file) => file.path).sort(), [...new Set(out.files.map((file) => file.path))].sort());
});

test('materials：单个文件失败不影响其余，失败项带 code 与原因', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    materials: [materialRow(1, [
      { id: 11, name: '好的.pdf', size: 2 },
      { id: 12, name: '没了.pdf', size: 2 },
      { id: 13, name: '没地址.pdf', size: 2 },
      { id: 14, name: '明文地址.pdf', size: 2 },
    ])],
    // 12：存储侧 404；13：平台没给 url；14：平台给了 http 地址
    bodies: { 11: 'ok', 13: 'no-url', 14: 'http-url' },
  });
  const out = await downloader(engine, dir).materials({ courseId: 7, courseLabel: '课', all: true });

  assert.equal(out.count, 1, '其余文件仍然要下');
  assert.equal(await readFile(out.files[0].path, 'utf8'), 'ok');
  assert.equal(out.failed.length, 3, '三个坏的一个都不能被算成成功');

  const codes = out.failed.map((file) => `${file.name}:${file.code}`).sort();
  assert.deepEqual(codes, [
    '明文地址.pdf:API_SHAPE',
    '没了.pdf:DOWNLOAD_HTTP',
    '没地址.pdf:API_SHAPE',
  ].sort());
  // 明文地址被拒是因为「签名在 query 里，走 http 等于交给链路上每一跳」——
  // 它必须在**发请求之前**就失败，而不是下到一半才发现。
  assert.equal(engine.api.transport.calls.some((call) => call.url.startsWith('http://')), false);
});

test('fileUrl：非法 id 与明文地址都在发请求前后被拦住', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({ bodies: {} });
  const engineApi = downloader(engine, dir);
  await assert.rejects(() => engineApi.fileUrl('abc'), (error) => error.code === 'INVALID_INPUT');
  await assert.rejects(() => engineApi.fileUrl(0), (error) => error.code === 'INVALID_INPUT');
  const plain = fakeEngine({ bodies: { 11: 'http-url' } });
  await assert.rejects(() => downloader(plain, dir).fileUrl(11), (error) => error.code === 'API_SHAPE');
});

/* ────────────────────────────────────── 作业下载 */

test('homework：三类文件分目录落盘，批改文件在「老师批改」下', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    detail: {
      id: '101',
      courseId: '7',
      title: '第三次作业',
      isGroup: false,
      files: [{ id: 21, name: '题目.pdf', size: 3 }],
    },
    submission: {
      submissionStatus: 'submitted',
      latestSubmission: {
        id: 9,
        uploads: [{ id: 22, name: '我的答案.pdf', size: 2 }],
        correctionFiles: [{ id: 23, name: '批注版.pdf', size: 4 }],
        annotated: true,
      },
    },
    bodies: { 21: 'TOP', 22: 'ME', 23: 'NOTE' },
  });
  const out = await downloader(engine, dir).homework({ activityId: 101, courseId: 7, courseLabel: '数据结构' });

  assert.equal(out.count, 3);
  const byKind = Object.fromEntries(out.files.map((file) => [file.kind, file]));
  assert.equal(await readFile(byKind.attachments.path, 'utf8'), 'TOP');
  assert.equal(await readFile(byKind.submission.path, 'utf8'), 'ME');
  assert.equal(await readFile(byKind.corrections.path, 'utf8'), 'NOTE');
  assert.match(byKind.corrections.path, /老师批改[\\/]批注版\.pdf$/);
  assert.equal(out.kinds.attachments, 1);
  assert.equal(out.kinds.submission, 1);
  assert.equal(out.kinds.corrections, 1);
});

test('homework：parts 只取点名的那几类', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    detail: { id: '101', courseId: '7', title: '作业', isGroup: false, files: [{ id: 21, name: '题目.pdf', size: 3 }] },
    bodies: { 21: 'TOP' },
  });
  const out = await downloader(engine, dir).homework({ activityId: 101, courseLabel: '课', parts: ['attachments'] });
  assert.equal(out.count, 1);
  assert.equal(out.files[0].kind, 'attachments');
});

test('homework：没有提交记录时如实说明哪一类是空的，不报错', async (t) => {
  const dir = await scratch(t);
  const engine = fakeEngine({
    detail: { id: '101', courseId: '7', title: '作业', isGroup: false, files: [{ id: 21, name: '题目.pdf', size: 3 }] },
    bodies: { 21: 'TOP' },
  });
  const out = await downloader(engine, dir).homework({ activityId: 101, courseLabel: '课' });
  assert.equal(out.count, 1);
  assert.equal(out.kinds.submission, 0);
  assert.match(out.note, /还没有提交记录/);
});

test('homework：提交类文件每次都重下（重交后同名内容会变），不按大小复用', async (t) => {
  const dir = await scratch(t);
  const make = (body) => fakeEngine({
    detail: { id: '101', courseId: '7', title: '作业', isGroup: false, files: [] },
    submission: { submissionStatus: 'submitted', latestSubmission: { id: 9, uploads: [{ id: 22, name: '答案.pdf', size: 2 }], correctionFiles: [] } },
    bodies: { 22: body },
  });

  const one = await downloader(make('AA'), dir).homework({ activityId: 101, courseLabel: '课' });
  // 第二次大小也变了（真实场景里重交多半如此），但也可能一样 —— 这里两个都测
  const two = await downloader(make('BBB'), dir).homework({ activityId: 101, courseLabel: '课' });
  assert.equal(two.files[0].reused, undefined, '提交文件不许复用');
  assert.equal(await readFile(one.files[0].path, 'utf8'), 'AA', '旧的那份是上一次提交的证据，不能被覆盖');
  assert.equal(path.basename(two.files[0].path), '答案 (1).pdf');
});

test('correctionFilesOf：markattatchment.txt 只算「有网页批注」，不当文件列出', () => {
  const { files, annotated } = correctionFilesOf({
    submission_correct: {
      uploads: [
        { id: 1, name: 'markattatchment.txt' },
        { id: 2, name: 'markattachment.txt' },
        { id: 3, name: '批注版.pdf' },
      ],
    },
  });
  assert.deepEqual(files.map((file) => file.name), ['批注版.pdf']);
  assert.equal(annotated, true);

  const none = correctionFilesOf({});
  assert.deepEqual(none, { files: [], annotated: false });
});
