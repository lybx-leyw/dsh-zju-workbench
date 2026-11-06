/**
 * 课件预取的**生命周期**测试。
 *
 * 核心张力：**"后台补缓存"不能变成"后台拖垮一切"**。
 *   - 不 await → 打开一节课不等 83 页下载
 *   - 去重     → 翻页/切栏/重渲染不重复下同一节
 *   - 失败静默 → 补不齐是常态，不该冒泡成"读课件失败"
 *   - 可取消   → 退出不卡在"再下一张图"
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ClassroomSource } from '../packages/dsh-zhiyun-source-classroom/src/source.js';
import { SlideCache } from '../packages/dsh-zhiyun-source-classroom/src/slide-store.js';

/**
 * 造一个**不碰网络**的 ClassroomSource。
 *
 * 只替换真正会发请求的两个方法，其余（预取、缓存接线）全走生产代码 ——
 * 那些才是这个文件要测的东西。
 */
function makeSource({ slides, download, log = [] } = {}) {
  const source = new ClassroomSource({
    transport: {
      // `LiveSource` 的构造要求注入一个带 `json()` 的 transport（它自己会用到），
      // 这个测试不打直播，给一个明确抛错的桩 —— 真被调到就是测试写错了。
      json: async () => { throw new Error('这个测试不该发网络请求'); },
      session: { load: async () => {}, pending: Promise.resolve(), jar: { getCookies: async () => [] } },
      close() {}, cancelAll() {}, log: (message) => log.push(message), closed: false,
    },
  });
  source.getSlides = async () => ({ items: slides, meta: { complete: true, source: 'test' } });
  source.getSubtitles = async () => ({ items: [], meta: { complete: true, source: 'test' } });
  if (download) {
    source.downloadResource = async (options) => download(options);
  }
  return { source, log };
}

const slideOf = (n) => ({
  page: n,
  imageUrl: `https://video.cmc.zju.edu.cn/c/1/slides/${String(n).padStart(4, '0')}.jpg`,
  startMs: n * 60_000,
  createdSec: n * 60,
});

/** 假下载：写指定字节数。 */
function fakeDownload({ bytes = 64, delayMs = 0, fail = false, calls = [] } = {}) {
  const fn = async ({ destination }) => {
    calls.push(destination);
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    if (fail) throw Object.assign(new Error('nope'), { code: 'DOWNLOAD_HTTP' });
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, Buffer.alloc(bytes, 0x41));
    return { bytes };
  };
  fn.calls = calls;
  return fn;
}

async function withDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'prefetch-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

/** 等一轮 microtask + 定时器，让后台任务跑完。 */
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));

// ── 不阻塞 ───────────────────────────────────────────────

test('getLessonContent 不等预取 —— 慢下载也立刻返回', async () => {
  await withDir(async (dir) => {
    const slides = [slideOf(1), slideOf(2), slideOf(3)];
    const download = fakeDownload({ delayMs: 200 });
    const { source } = makeSource({ slides, download });
    const cache = new SlideCache({ directory: dir, download });
    source.attachSlideCache(cache);

    const started = Date.now();
    const content = await source.getLessonContent('1', '2');
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 150, `读取应该立刻返回，实际 ${elapsed}ms`);
    assert.equal(content.slides.items.length, 3);
    // 初次全部未缓存 → 没有 cacheUrl，前端回退原地址
    assert.ok(content.slides.items.every((item) => item.cacheUrl === undefined));
    assert.ok(content.slides.items.every((item) => typeof item.cacheKey === 'string'));
  });
});

test('预取在后台把缓存填上，之后再读就带 cacheUrl', async () => {
  await withDir(async (dir) => {
    const slides = [slideOf(1), slideOf(2)];
    const download = fakeDownload({ bytes: 100 });
    const { source } = makeSource({ slides, download });
    const cache = new SlideCache({ directory: dir, download });
    source.attachSlideCache(cache);

    await source.getLessonContent('1', '2');
    await settle(50);

    const again = await source.getLessonContent('1', '2');
    assert.equal(again.slides.items.length, 2);
    for (const item of again.slides.items) {
      assert.equal(item.cacheUrl, `/zhiyun-slides/${item.cacheKey}`);
    }
    assert.equal(download.calls.length, 2, '两张图只该下次，第二次全命中');
  });
});

// ── 去重 ─────────────────────────────────────────────────

test('连续多次读取同一节只触发一次预取', async () => {
  await withDir(async (dir) => {
    const slides = [slideOf(1), slideOf(2)];
    const download = fakeDownload({ bytes: 50, delayMs: 40 });
    const { source } = makeSource({ slides, download });
    const cache = new SlideCache({ directory: dir, download });
    source.attachSlideCache(cache);

    // 三次并发读取，模拟翻页/切栏导致的重渲染
    await Promise.all([
      source.getLessonContent('1', '2'),
      source.getLessonContent('1', '2'),
      source.getLessonContent('1', '2'),
    ]);
    await settle(120);
    assert.equal(download.calls.length, 2, `两页应各下一次，实际 ${download.calls.length}`);
  });
});

test('不同节各自预取，互不去重', async () => {
  await withDir(async (dir) => {
    const download = fakeDownload({ bytes: 10 });
    const cache = new SlideCache({ directory: dir, download });
    const { source } = makeSource({ slides: [slideOf(1)] });
    source.attachSlideCache(cache);
    source.getSlides = async (courseId, subId) => ({
      items: [{ ...slideOf(1), imageUrl: `https://video.cmc.zju.edu.cn/c/${courseId}/${subId}/0001.jpg` }],
      meta: { complete: true },
    });

    await source.getLessonContent('1', '10');
    await source.getLessonContent('1', '11');
    await settle(60);
    assert.equal(download.calls.length, 2);
  });
});

// ── 降级 ─────────────────────────────────────────────────

test('下载全失败时读取照常返回，不抛错', async () => {
  await withDir(async (dir) => {
    const slides = [slideOf(1)];
    const download = fakeDownload({ fail: true });
    const { source, log } = makeSource({ slides, download });
    const cache = new SlideCache({ directory: dir, download, log: (m) => log.push(m) });
    source.attachSlideCache(cache);

    const content = await source.getLessonContent('1', '2');
    assert.equal(content.slides.items.length, 1);
    await settle(50);
    // 失败被记录，但没冒泡
    assert.ok(log.some((line) => /缓存/.test(line)), `应记一条缓存日志，实际：${JSON.stringify(log)}`);
  });
});

test('没有挂缓存时一切照旧（getLessonContent 不报错、不带 cacheUrl）', async () => {
  const { source } = makeSource({ slides: [slideOf(1)] });
  const content = await source.getLessonContent('1', '2');
  assert.equal(content.slides.items[0].cacheUrl, undefined);
  assert.equal(content.slides.items[0].cacheKey, undefined, '没缓存就不该塞 cacheKey');
});

test('空课件不触发预取', async () => {
  await withDir(async (dir) => {
    const download = fakeDownload();
    const cache = new SlideCache({ directory: dir, download });
    const { source } = makeSource({ slides: [] });
    source.attachSlideCache(cache);
    await source.getLessonContent('1', '2');
    await settle(30);
    assert.equal(download.calls.length, 0);
  });
});

// ── 取消 ─────────────────────────────────────────────────

test('dispose 取消进行中的预取，不卡在下载上', async () => {
  await withDir(async (dir) => {
    const slides = Array.from({ length: 8 }, (_, i) => slideOf(i + 1));
    let seen = 0;
    const download = async ({ destination, signal }) => {
      seen += 1;
      // 慢到一定能被 dispose 撞上
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 500);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(Object.assign(new Error('aborted'), { code: 'CANCELLED' })); });
      });
      return { bytes: 1, destination };
    };
    const { source } = makeSource({ slides, download });
    const cache = new SlideCache({ directory: dir, download });
    source.attachSlideCache(cache);

    await source.getLessonContent('1', '2');
    await settle(30);
    assert.ok(seen > 0, '预取应该已经启动');

    const started = Date.now();
    await source.dispose();
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 300, `dispose 不该等下载跑完，实际 ${elapsed}ms`);
    assert.equal(source.prefetching.size, 0);
    assert.equal(source.prefetchAbort.size, 0);
  });
});

// ── prefetchSlides 显式接口 ──────────────────────────────

test('prefetchSlides 可显式等待，返回统计', async () => {
  await withDir(async (dir) => {
    const slides = [slideOf(1), slideOf(2), slideOf(3)];
    const download = fakeDownload({ bytes: 30 });
    const { source } = makeSource({ slides, download });
    const cache = new SlideCache({ directory: dir, download });
    source.attachSlideCache(cache);

    const result = await source.prefetchSlides('1', '2');
    assert.equal(result.cached, true);
    assert.equal(result.downloaded, 3);
    assert.equal(result.skipped, 0);
    assert.equal(result.total, 3);
  });
});

test('prefetchSlides 没有缓存时返回 cached:false 而不是报错', async () => {
  const { source } = makeSource({ slides: [slideOf(1)] });
  const result = await source.prefetchSlides('1', '2');
  assert.deepEqual(result, { downloaded: 0, skipped: 0, failed: 0, total: 0, cached: false });
});
