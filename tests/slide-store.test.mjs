/**
 * 课件缓存文件层的测试。
 *
 * 核心张力：**"缓存"不能变成"新的故障源"**。
 *   - 索引坏了 → 必须退化成"没缓存"，不是打不开课件
 *   - 并发预取 → 同一张图不能下两遍
 *   - 索引与磁盘不一致 → 以**能读到文件**为准，不骗前端
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { Writable } from 'node:stream';
import path from 'node:path';

import {
  SlideCache,
  createSlideHandler,
  isCacheKey,
  isSlideFileName,
  SLIDE_ROUTE_PREFIX,
} from '../packages/dsh-zhiyun-source-classroom/src/slide-store.js';
import { cacheKeyForSlide, slideFileName } from '../packages/dsh-zhiyun-source-classroom/src/slide-cache.js';

const IMG = 'https://video.cmc.zju.edu.cn/c/1/slides/0001.jpg';

/** 造一个临时缓存目录，测试结束自动删。 */
async function withDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slide-cache-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * 假下载器：把 `url` 的字节数写进目标文件。
 *
 * 记录每次调用的 URL，用来断言"到底下了几次"。
 */
function fakeDownload({ bytes = 100, fail = null, calls = [] } = {}) {
  const fn = async ({ url, destination }) => {
    calls.push(url);
    if (fail) throw fail;
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.alloc(bytes, 0x41));
    return { bytes };
  };
  fn.calls = calls;
  return fn;
}

const slide = (page, url = `https://video.cmc.zju.edu.cn/c/1/slides/${String(page).padStart(4, '0')}.jpg`) => ({ page, imageUrl: url });

// ── 键校验 ───────────────────────────────────────────────

test('isCacheKey 只认 32 位十六进制', () => {
  assert.equal(isCacheKey('a'.repeat(32)), true);
  assert.equal(isCacheKey('0123456789abcdef0123456789abcdef'), true);
  assert.equal(isCacheKey('a'.repeat(31)), false);
  assert.equal(isCacheKey('a'.repeat(33)), false);
  assert.equal(isCacheKey('../../etc/passwd'), false);
  assert.equal(isCacheKey('A'.repeat(32)), false);
  assert.equal(isCacheKey(null), false);
  assert.equal(isCacheKey(123), false);
});

// ── 空缓存 ───────────────────────────────────────────────

test('空缓存时 lookup 返回 null，decorate 不带 cacheUrl', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    await cache.ready;
    assert.equal(await cache.lookup(cacheKeyForSlide(IMG)), null);
    const [item] = await cache.decorate([{ page: 1, imageUrl: IMG }]);
    assert.equal(item.cacheUrl, undefined);
    assert.equal(item.cacheKey, cacheKeyForSlide(IMG));
  });
});

test('索引文件不存在时按空索引启动，不报错', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    assert.deepEqual(await cache.snapshot(), {});
    assert.deepEqual(await cache.stats(), { files: 0, bytes: 0, quotaBytes: 2 * 1024 * 1024 * 1024 });
  });
});

// ── 下载与命中 ───────────────────────────────────────────

test('首次预取把这些页下下来，第二次全部跳过', async () => {
  await withDir(async (dir) => {
    const download = fakeDownload({ bytes: 100 });
    const cache = new SlideCache({ directory: dir, download });
    const slides = [slide(1), slide(2), slide(3)];

    const first = await cache.ensureSlides(slides);
    assert.equal(first.downloaded, 3);
    assert.equal(first.skipped, 0);
    assert.equal(first.total, 3);
    assert.equal(download.calls.length, 3);

    const second = await cache.ensureSlides(slides);
    assert.equal(second.downloaded, 0);
    assert.equal(second.skipped, 3);
    assert.equal(download.calls.length, 3, '已缓存的不该重下');
  });
});

test('下完之后 decorate 给出本地地址', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 100 }) });
    const slides = [slide(1), slide(2)];
    await cache.ensureSlides(slides);
    const decorated = await cache.decorate(slides);
    for (const item of decorated) {
      assert.equal(item.cacheUrl, `${SLIDE_ROUTE_PREFIX}/${item.cacheKey}`);
    }
  });
});

test('索引落盘，重建实例仍命中（跨进程有效）', async () => {
  await withDir(async (dir) => {
    const slides = [slide(1)];
    const a = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 100 }) });
    await a.ensureSlides(slides);

    const b = new SlideCache({ directory: dir, download: fakeDownload({ calls: [] }) });
    const again = await b.ensureSlides(slides);
    assert.equal(again.downloaded, 0, '重启后应该命中已有缓存');
    assert.equal(again.skipped, 1);
  });
});

test('签名变化仍命中（缓存键剥掉了 query）', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    await cache.ensureSlides([slide(1, `${IMG}?e=1&token=aaa`)]);
    const again = await cache.ensureSlides([slide(1, `${IMG}?e=2&token=bbb`)]);
    assert.equal(again.downloaded, 0);
    assert.equal(again.skipped, 1);
  });
});

test('并发预取同一批页不会重复下载（inflight 去重）', async () => {
  await withDir(async (dir) => {
    const download = fakeDownload({ bytes: 100 });
    const cache = new SlideCache({ directory: dir, download });
    const slides = [slide(1), slide(2), slide(3)];
    await Promise.all([cache.ensureSlides(slides), cache.ensureSlides(slides)]);
    assert.equal(download.calls.length, 3, `三张图应只下三次，实际 ${download.calls.length}`);
  });
});

// ── 失败与降级 ───────────────────────────────────────────

test('单页下载失败不炸整批，其余照常缓存', async () => {
  await withDir(async (dir) => {
    let n = 0;
    const download = async ({ url, destination }) => {
      n += 1;
      if (n === 2) { const e = new Error('boom'); e.code = 'DOWNLOAD_HTTP'; throw e; }
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, Buffer.alloc(50, 0x41));
      return { bytes: 50 };
    };
    const cache = new SlideCache({ directory: dir, download });
    const result = await cache.ensureSlides([slide(1), slide(2), slide(3)]);
    assert.equal(result.downloaded, 2);
    assert.equal(result.failed, 1);
    assert.equal(result.total, 3);
  });
});

test('索引损坏时退化成空索引，不抛错', async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, 'index.json'), '{不是 JSON');
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    assert.deepEqual(await cache.snapshot(), {});
  });
});

test('索引里的坏条目被丢掉（不制造 NaN 统计）', async () => {
  await withDir(async (dir) => {
    await writeFile(path.join(dir, 'index.json'), JSON.stringify({
      ['a'.repeat(32)]: { file: 'ok.jpg', bytes: 10, usedAt: 1 },
      ['b'.repeat(32)]: { bytes: 10 },              // 缺 file
      ['c'.repeat(32)]: { file: 'x.jpg', bytes: 0 }, // 大小非法
      ['d'.repeat(32)]: { file: 'y.jpg', bytes: NaN },
      ['not-a-key']: { file: 'z.jpg', bytes: 10 },
    }));
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    const index = await cache.snapshot();
    assert.deepEqual(Object.keys(index), ['a'.repeat(32)]);
  });
});

test('索引有但文件被手删 → 当未命中（并清掉死条目）', async () => {
  await withDir(async (dir) => {
    const slides = [slide(1)];
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 100 }) });
    await cache.ensureSlides(slides);
    const key = cacheKeyForSlide(slides[0].imageUrl);
    assert.notEqual(await cache.lookup(key), null);

    await rm(path.join(dir, slideFileName(1, key)));
    assert.equal(await cache.lookup(key), null);
    assert.equal((await cache.snapshot())[key], undefined);
  });
});

test('文件已在磁盘但索引没记（FILE_EXISTS）→ 认它，不算失败', async () => {
  await withDir(async (dir) => {
    const slides = [slide(1)];
    const key = cacheKeyForSlide(slides[0].imageUrl);
    const file = slideFileName(1, key);
    // 先造出文件，但让 download 报 FILE_EXISTS（模拟上次索引写失败）
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, file), Buffer.alloc(77, 0x41));
    const download = async () => { const e = new Error('exists'); e.code = 'FILE_EXISTS'; throw e; };
    const cache = new SlideCache({ directory: dir, download });
    const result = await cache.ensureSlides(slides);
    assert.equal(result.downloaded, 1);
    assert.equal(result.failed, 0);
    assert.equal((await cache.snapshot())[key].bytes, 77);
  });
});

// ── 容量淘汰 ─────────────────────────────────────────────

test('超配额时按最近使用淘汰，文件真的被删', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 100 }), quotaBytes: 250 });
    const a = [slide(1)];
    const b = [slide(2)];
    const c = [slide(3)];

    await cache.ensureSlides(a);
    // 把 a 的 usedAt 推到很久以前
    cache.index[cacheKeyForSlide(a[0].imageUrl)].usedAt = 1;
    await new Promise((r) => setTimeout(r, 5));
    await cache.ensureSlides(b);
    await new Promise((r) => setTimeout(r, 5));
    await cache.ensureSlides(c);

    const keyA = cacheKeyForSlide(a[0].imageUrl);
    assert.equal((await cache.snapshot())[keyA], undefined, '最久未用的应该被淘汰');
    const fileA = path.join(dir, slideFileName(1, keyA));
    await assert.rejects(stat(fileA), '淘汰必须真删文件');
  });
});

test('配额内不淘汰', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 10 }), quotaBytes: 10_000 });
    const slides = [slide(1), slide(2), slide(3)];
    await cache.ensureSlides(slides);
    assert.equal((await cache.stats()).files, 3);
  });
});

// ── 用量与清空 ───────────────────────────────────────────

test('stats 报出文件数与字节数', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 100 }) });
    await cache.ensureSlides([slide(1), slide(2)]);
    assert.deepEqual(await cache.stats(), { files: 2, bytes: 200, quotaBytes: 2 * 1024 * 1024 * 1024 });
  });
});

test('clear 清空索引与文件', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 100 }) });
    await cache.ensureSlides([slide(1), slide(2)]);
    await cache.clear();
    assert.deepEqual(await cache.stats(), { files: 0, bytes: 0, quotaBytes: 2 * 1024 * 1024 * 1024 });
  });
});

// ── 存储路径安全 ─────────────────────────────────────────

test('索引写的是单段文件名，不含目录分隔符', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 10 }) });
    await cache.ensureSlides([slide(1)]);
    const raw = JSON.parse(await readFile(path.join(dir, 'index.json'), 'utf8'));
    for (const entry of Object.values(raw)) {
      assert.equal(path.basename(entry.file), entry.file);
    }
  });
});

// ── 路由 ─────────────────────────────────────────────────

/** 最小 req/res 桩，够 handler 用。 */
/**
 * 最小 res 桩。
 *
 * 用真的 `Writable` 而不是手搓 `write`/`end` —— handler 里
 * `createReadStream().pipe(res)` 会用到 `write` 的返回值、`'drain'`、`'finish'`、
 * `'close'` 一整套流协议。手搓的桩只能测到"看起来通了"，测不出真实关闭路径 ——
 * 这一版桩一开始就漏了 `finish`，于是"图能返回"这条用例是假通过的。
 */
function callHandler(handler, { method = 'GET', url, headers = {} }) {
  return new Promise((resolve) => {
    const chunks = [];
    let status = 0;
    let outHeaders = null;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve({ status, headers: outHeaders ?? {}, body: Buffer.concat(chunks) });
    };
    const res = new Writable({
      write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); },
      final(callback) { done(); callback(); },
    });
    res.writeHead = (code, headerBag = {}) => { status = code; outHeaders = headerBag; return res; };
    res.on('finish', done);
    res.on('close', done);
    handler({ method, url, headers }, res).catch((error) => {
      if (settled) return;
      settled = true;
      resolve({ status: -1, error });
    });
  });
}

test('路由返回已缓存的图，带 ETag 与 jpeg 类型', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 64 }) });
    const slides = [slide(1)];
    await cache.ensureSlides(slides);
    const key = cacheKeyForSlide(slides[0].imageUrl);
    const handler = createSlideHandler(cache);
    const out = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/${key}` });
    assert.equal(out.status, 200);
    assert.equal(out.headers['content-type'], 'image/jpeg');
    assert.equal(out.headers['content-length'], '64');
    assert.equal(out.body.length, 64);
    assert.match(out.headers.etag, /^".+-64"$/);
  });
});

test('未缓存的键回 404（正常路径，不是错误）', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    const handler = createSlideHandler(cache, { log: () => {} });
    const out = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/${'f'.repeat(32)}` });
    assert.equal(out.status, 404);
  });
});

test('ETag 匹配时回 304 不重传字节', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 64 }) });
    const slides = [slide(1)];
    await cache.ensureSlides(slides);
    const key = cacheKeyForSlide(slides[0].imageUrl);
    const handler = createSlideHandler(cache);
    const first = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/${key}` });
    const second = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/${key}`, headers: { 'if-none-match': first.headers.etag } });
    assert.equal(second.status, 304);
    assert.equal(second.body.length, 0);
  });
});

test('路径穿越打不进前缀（规范化后已经不是本路由）', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    const handler = createSlideHandler(cache, { log: () => {} });
    for (const bad of [
      `${SLIDE_ROUTE_PREFIX}/../../etc/passwd`,
      `${SLIDE_ROUTE_PREFIX}/a/../../../secret`,
    ]) {
      const out = await callHandler(handler, { url: bad });
      assert.equal(out.status, 404, `${bad} 规范化后已不在本前缀下，应 404`);
    }
  });
});

test('%2F 编码的穿越留在键里，被键校验挡下', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    const handler = createSlideHandler(cache, { log: () => {} });
    // WHATWG URL 不把 %2F 解成 `/`，所以它既没有逃出前缀，也没有变成合法键 ——
    // 两道防线各挡一半，合起来是 400。这条断言把这个分工固定下来。
    const out = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/..%2F..%2Fpasswd` });
    assert.equal(out.status, 400);
  });
});

test('落在前缀内但键畸形回 400', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    const handler = createSlideHandler(cache, { log: () => {} });
    for (const bad of ['not-a-key', 'A'.repeat(32), 'a'.repeat(31), 'index.json']) {
      const out = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/${bad}` });
      assert.equal(out.status, 400, `${bad} 应该被拒`);
    }
  });
});

test('非 GET/HEAD 回 405', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload() });
    const handler = createSlideHandler(cache, { log: () => {} });
    const out = await callHandler(handler, { method: 'POST', url: `${SLIDE_ROUTE_PREFIX}/${'a'.repeat(32)}` });
    assert.equal(out.status, 405);
  });
});

test('status 子路径报出用量，供设置页显示', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 10 }) });
    await cache.ensureSlides([slide(1)]);
    const handler = createSlideHandler(cache);
    const out = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/status` });
    assert.equal(out.status, 200);
    const body = JSON.parse(out.body.toString());
    assert.equal(body.kind, 'slide-cache');
    assert.equal(body.files, 1);
    assert.equal(body.bytes, 10);
  });
});

test('索引被改成带路径的文件名 → 当未命中（回 404，不返回越权文件）', async () => {
  await withDir(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: fakeDownload({ bytes: 64 }) });
    const slides = [slide(1)];
    await cache.ensureSlides(slides);
    const key = cacheKeyForSlide(slides[0].imageUrl);
    // 直接篡改内存索引，模拟索引文件被改坏
    cache.index[key] = { file: '../../../secret.txt', bytes: 64, usedAt: 1 };
    const handler = createSlideHandler(cache, { log: () => {} });
    const out = await callHandler(handler, { url: `${SLIDE_ROUTE_PREFIX}/${key}` });
    assert.equal(out.status, 404);
    assert.equal(out.body.length, 0);
    assert.equal((await cache.snapshot())[key], undefined, '坏条目应该被清掉');
  });
});

test('isSlideFileName 只认单段文件名', () => {
  assert.equal(isSlideFileName('0001-0123456789ab.jpg'), true);
  assert.equal(isSlideFileName('index.json'), true, '单段名就合法，规则不猜语义');
  assert.equal(isSlideFileName('../x.jpg'), false);
  assert.equal(isSlideFileName('a/b.jpg'), false);
  assert.equal(isSlideFileName('a\\b.jpg'), false);
  assert.equal(isSlideFileName('C:x.jpg'), false);
  assert.equal(isSlideFileName('..'), false);
  assert.equal(isSlideFileName(''), false);
  assert.equal(isSlideFileName(null), false);
});

// ── 构造参数校验 ─────────────────────────────────────────

test('目录必须是绝对路径', () => {
  assert.throws(() => new SlideCache({ directory: 'relative/dir', download: () => {} }), TypeError);
});

test('并发须在 1–8', () => {
  assert.throws(() => new SlideCache({ directory: path.resolve(tmpdir()), download: () => {}, concurrency: 0 }), TypeError);
  assert.throws(() => new SlideCache({ directory: path.resolve(tmpdir()), download: () => {}, concurrency: 9 }), TypeError);
});
