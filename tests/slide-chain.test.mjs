/**
 * 宿主链路集成测试：从 `getLessonContent` 到 HTTP 路由的**完整一条路**。
 *
 * 前面几个测试各测一层：
 *   - `slide-cache` 测决策（要不要下、叫什么、淘汰谁）
 *   - `slide-store` 测文件层（索引、路由、安全）
 *   - `slide-prefetch` 测生命周期（去重、取消、降级）
 *
 * 但**没有一条测试证明它们接起来能用** —— 也就是：
 * 读课件 → 补 cacheKey → 后台预取 → 再读带 cacheUrl → 路由真的吐出那张图。
 * 这条链上任何一处字段名写错（`cacheUrl` vs `cacheURL`）、前缀不一致、
 * 或者装饰发生在预取之后，三层单测都会全绿而功能完全不工作。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ClassroomSource } from '../packages/dsh-zhiyun-source-classroom/src/source.js';
import {
  SlideCache, createSlideHandler, SLIDE_ROUTE_PREFIX,
} from '../packages/dsh-zhiyun-source-classroom/src/slide-store.js';

const IMG = (n) => `https://video.cmc.zju.edu.cn/c/99/100/slides/${String(n).padStart(4, '0')}.jpg?e=1&token=t`;

function makeSource(slides) {
  const source = new ClassroomSource({
    transport: {
      json: async () => { throw new Error('不该发请求'); },
      session: { load: async () => {}, pending: Promise.resolve(), jar: { getCookies: async () => [] } },
      close() {}, cancelAll() {}, log() {}, closed: false,
    },
  });
  source.getSlides = async () => ({
    items: slides.map((s) => ({ ...s, createdSec: s.startMs / 1000 })),
    meta: { complete: true, source: 'test' },
  });
  source.getSubtitles = async () => ({ items: [], meta: { complete: true, source: 'test' } });
  return source;
}

const downloader = (bytes = 321) => async ({ destination }) => {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.alloc(bytes, 0x7f));
  return { bytes };
};

async function serve(cache) {
  const handler = createSlideHandler(cache, { log: () => {} });
  const server = createServer((req, res) => { handler(req, res).catch(() => res.destroy()); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise((r) => server.close(r)),
  };
}

const settle = (ms = 80) => new Promise((r) => setTimeout(r, ms));

test('全链路：读课件 → 预取 → 带 cacheUrl → 路由真能取到图', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chain-'));
  let source;
  try {
    const slides = [
      { page: 1, imageUrl: IMG(1), startMs: 0 },
      { page: 2, imageUrl: IMG(2), startMs: 60_000 },
    ];
    source = makeSource(slides);
    const cache = new SlideCache({ directory: dir, download: downloader(321) });
    source.attachSlideCache(cache);

    // ① 首次读：还没缓存，只有 cacheKey、没有 cacheUrl
    const first = await source.getLessonContent('99', '100');
    assert.equal(first.slides.items.length, 2);
    for (const item of first.slides.items) {
      assert.match(item.cacheKey, /^[0-9a-f]{32}$/, '每页都要有 cacheKey');
      assert.equal(item.cacheUrl, undefined, '未缓存时不该有 cacheUrl');
      assert.ok(item.imageUrl, '原始地址必须保留，前端要能回退');
    }

    // ② 后台预取完成
    await settle(120);

    // ③ 再读：这次有 cacheUrl
    const second = await source.getLessonContent('99', '100');
    for (const item of second.slides.items) {
      assert.equal(item.cacheUrl, `${SLIDE_ROUTE_PREFIX}/${item.cacheKey}`);
    }

    // ④ 把 cacheUrl 真的打出去 —— 这一步是"接起来能不能用"的唯一证据
    const site = await serve(cache);
    try {
      for (const item of second.slides.items) {
        const res = await fetch(`${site.base}${item.cacheUrl}`);
        assert.equal(res.status, 200, `${item.cacheUrl} 应该能取到图`);
        assert.equal(res.headers.get('content-type'), 'image/jpeg');
        const body = Buffer.from(await res.arrayBuffer());
        assert.equal(body.length, 321);
      }
    } finally { await site.close(); }
  } finally {
    await source?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('全链路：cacheKey 前后一致（同一张图身份稳定）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chain-'));
  let source;
  try {
    const slides = [{ page: 1, imageUrl: IMG(1), startMs: 0 }];
    source = makeSource(slides);
    const cache = new SlideCache({ directory: dir, download: downloader(10) });
    source.attachSlideCache(cache);

    const a = await source.getLessonContent('99', '100');
    await settle(80);
    const b = await source.getLessonContent('99', '100');
    assert.equal(a.slides.items[0].cacheKey, b.slides.items[0].cacheKey);
  } finally {
    await source?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('全链路：没有缓存插件时 getLessonContent 形状不变', async () => {
  const source = makeSource([{ page: 1, imageUrl: IMG(1), startMs: 0 }]);
  const content = await source.getLessonContent('99', '100');
  const item = content.slides.items[0];
  assert.equal(item.cacheUrl, undefined);
  assert.equal(item.cacheKey, undefined);
  assert.equal(item.imageUrl, IMG(1));
  // 原有的字段不能被改动
  assert.equal(item.page, 1);
  assert.equal(item.startMs, 0);
});

test('全链路：课件重传（同页换图）→ cacheUrl 换成新键', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'chain-'));
  let source;
  try {
    const cache = new SlideCache({ directory: dir, download: downloader(10) });
    source = makeSource([{ page: 1, imageUrl: IMG(1), startMs: 0 }]);
    source.attachSlideCache(cache);
    const before = await source.getLessonContent('99', '100');
    await settle(80);

    // 老师重传：同页换了图片路径
    source.getSlides = async () => ({
      items: [{ page: 1, imageUrl: 'https://video.cmc.zju.edu.cn/c/99/100/v2/0001.jpg', startMs: 0, createdSec: 0 }],
      meta: { complete: true, source: 'test' },
    });
    const after = await source.getLessonContent('99', '100');
    assert.notEqual(before.slides.items[0].cacheKey, after.slides.items[0].cacheKey,
      '换了图就该换键，否则会永远显示旧的一页');
  } finally {
    // ⚠️ 必须先 dispose 再删目录：后台预取还在写文件时删目录会 ENOTEMPTY。
    // 这不是测试洁癖 —— 它反过来证明了 `dispose` 确实把预取掐断了，
    // 也是真实退出路径必须走同一个顺序的原因。
    await source?.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
