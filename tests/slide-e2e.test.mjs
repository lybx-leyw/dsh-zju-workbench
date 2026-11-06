/**
 * 端到端：起一个真的 HTTP 服务器，用真的 `SlideCache` 打它。
 *
 * 单测证明的是"逻辑对"；这个文件证明的是"**真的能跑起来**"——
 * 真的端口、真的 `node:http`、真的 `createReadStream` 管道、真的 ETag 往返。
 * 单测里 `res` 是桩，桩通过不等于真服务器通过（桩曾经就假通过过一次）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SlideCache, createSlideHandler, SLIDE_ROUTE_PREFIX } from '../packages/dsh-zhiyun-source-classroom/src/slide-store.js';
import { cacheKeyForSlide } from '../packages/dsh-zhiyun-source-classroom/src/slide-cache.js';

const IMG = 'https://video.cmc.zju.edu.cn/c/1/slides/0001.jpg';

/** 起服务器并交出 `{ base, close }`。端口用 0 让系统挑，避免撞端口。 */
async function serve(cache) {
  const handler = createSlideHandler(cache, { log: () => {} });
  const server = createServer((req, res) => { handler(req, res).catch(() => res.destroy()); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}${SLIDE_ROUTE_PREFIX}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withCache(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'slide-e2e-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 假下载器：写 N 个字节的 jpg。 */
const downloader = (bytes = 128) => async ({ destination }) => {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, Buffer.alloc(bytes, 0xff));
  return { bytes };
};

test('真实服务器：预取后 GET 到完整 jpg', async () => {
  await withCache(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: downloader(128) });
    const slides = [{ page: 1, imageUrl: IMG }];
    await cache.ensureSlides(slides);
    const key = cacheKeyForSlide(IMG);

    const site = await serve(cache);
    try {
      const res = await fetch(`${site.base}/${key}`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'image/jpeg');
      assert.equal(res.headers.get('content-length'), '128');
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(body.length, 128);
    } finally { await site.close(); }
  });
});

test('真实服务器：第二次请求带 ETag 拿到 304 且零字节', async () => {
  await withCache(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: downloader(256) });
    await cache.ensureSlides([{ page: 1, imageUrl: IMG }]);
    const key = cacheKeyForSlide(IMG);
    const site = await serve(cache);
    try {
      const first = await fetch(`${site.base}/${key}`);
      const etag = first.headers.get('etag');
      await first.arrayBuffer();
      assert.ok(etag, '首次响应必须带 ETag');

      const second = await fetch(`${site.base}/${key}`, { headers: { 'if-none-match': etag } });
      assert.equal(second.status, 304);
      assert.equal((await second.arrayBuffer()).byteLength, 0);
    } finally { await site.close(); }
  });
});

test('真实服务器：未缓存键 404，前端据此回退原地址', async () => {
  await withCache(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: downloader() });
    const site = await serve(cache);
    try {
      const res = await fetch(`${site.base}/${'a'.repeat(32)}`);
      assert.equal(res.status, 404);
    } finally { await site.close(); }
  });
});

test('真实服务器：status 报出用量', async () => {
  await withCache(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: downloader(100) });
    await cache.ensureSlides([{ page: 1, imageUrl: IMG }]);
    const site = await serve(cache);
    try {
      const body = await (await fetch(`${site.base}/status`)).json();
      assert.equal(body.kind, 'slide-cache');
      assert.equal(body.files, 1);
      assert.equal(body.bytes, 100);
      assert.equal(body.quotaBytes, 2 * 1024 * 1024 * 1024);
    } finally { await site.close(); }
  });
});

test('真实服务器：穿越请求打不到缓存目录外', async () => {
  await withCache(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: downloader() });
    const site = await serve(cache);
    try {
      // 用 fetch 时 URL 规范化会先发生；这里直接拼原始路径字符串。
      const res = await fetch(`${site.base}/../../../../etc/passwd`);
      assert.ok(res.status === 400 || res.status === 404, `应被拒，实际 ${res.status}`);
    } finally { await site.close(); }
  });
});

test('真实服务器：并发 20 个请求全部成功（管道不被背压搞坏）', async () => {
  await withCache(async (dir) => {
    const cache = new SlideCache({ directory: dir, download: downloader(4096) });
    const slides = Array.from({ length: 5 }, (_, i) => ({
      page: i + 1,
      imageUrl: `https://video.cmc.zju.edu.cn/c/1/slides/${String(i + 1).padStart(4, '0')}.jpg`,
    }));
    await cache.ensureSlides(slides);
    const site = await serve(cache);
    try {
      const keys = slides.map((s) => cacheKeyForSlide(s.imageUrl));
      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, i) => fetch(`${site.base}/${keys[i % keys.length]}`)),
      );
      const bodies = await Promise.all(responses.map((r) => r.arrayBuffer()));
      for (let i = 0; i < responses.length; i += 1) {
        assert.equal(responses[i].status, 200, `第 ${i} 个请求失败`);
        assert.equal(bodies[i].byteLength, 4096);
      }
    } finally { await site.close(); }
  });
});
