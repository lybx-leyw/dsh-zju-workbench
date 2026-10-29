/**
 * 课件图片缓存决策逻辑的测试。
 *
 * 核心张力：**"命中"不能变成"假装命中"**。
 *   - 键没剥掉签名 → 刷新一次全量重下（缓存等于没有）
 *   - 键剥得太多 → 不同图撞成同一个键，显示错页
 *   - 淘汰按创建时间 → 最常看的课被最先删掉
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SLIDE_BYTES,
  CACHE_QUOTA_BYTES,
  cacheKeyForSlide,
  slideFileName,
  lookupCached,
  mergeIndex,
  touchIndex,
  planEviction,
  removeKeys,
  missingSlides,
} from '../packages/dsh-zhiyun-source-classroom/src/slide-cache.js';

const IMG = 'https://video.cmc.zju.edu.cn/course/86582/slides/0001.jpg';

// ── 缓存键 ───────────────────────────────────────────────

test('签名变化不改变缓存键（缓存能命中的关键）', () => {
  const a = cacheKeyForSlide(`${IMG}?e=1730000000&token=aaa`);
  const b = cacheKeyForSlide(`${IMG}?e=1799999999&token=bbb`);
  assert.equal(a, b);
});

test('不同页不撞键', () => {
  const a = cacheKeyForSlide('https://h/c/1/slides/0001.jpg');
  const b = cacheKeyForSlide('https://h/c/1/slides/0002.jpg');
  assert.notEqual(a, b);
});

test('不同主机不撞键（同 pathname 不同源）', () => {
  const a = cacheKeyForSlide('https://a.example/x/slides/0001.jpg');
  const b = cacheKeyForSlide('https://b.example/x/slides/0001.jpg');
  assert.notEqual(a, b);
});

test('fragment 也不影响键', () => {
  assert.equal(cacheKeyForSlide(`${IMG}#frag`), cacheKeyForSlide(IMG));
});

test('键是 32 位十六进制', () => {
  assert.match(cacheKeyForSlide(IMG), /^[0-9a-f]{32}$/);
});

test('非 http(s) 与非 URL 返回 null', () => {
  assert.equal(cacheKeyForSlide(''), null);
  assert.equal(cacheKeyForSlide(null), null);
  assert.equal(cacheKeyForSlide(undefined), null);
  assert.equal(cacheKeyForSlide('   '), null);
  assert.equal(cacheKeyForSlide('不是地址'), null);
  assert.equal(cacheKeyForSlide('file:///c:/x.jpg'), null);
  assert.equal(cacheKeyForSlide('data:image/jpeg;base64,AAAA'), null);
});

// ── 文件名 ───────────────────────────────────────────────

test('文件名带 4 位页序，可人工按页排', () => {
  assert.equal(slideFileName(1, '0123456789abcdef'), '0001-0123456789ab.jpg');
  assert.equal(slideFileName(83, '0123456789abcdef'), '0083-0123456789ab.jpg');
});

test('页序非法时不抛，退化成 0000', () => {
  assert.equal(slideFileName(0, '0123456789abcdef'), '0000-0123456789ab.jpg');
  assert.equal(slideFileName(-3, '0123456789abcdef'), '0000-0123456789ab.jpg');
  assert.equal(slideFileName('x', '0123456789abcdef'), '0000-0123456789ab.jpg');
  assert.equal(slideFileName(1.5, '0123456789abcdef'), '0000-0123456789ab.jpg');
});

test('键太短时退化成 unknown 前缀而不是截断出半个名字', () => {
  const name = slideFileName(5, 'abc');
  assert.match(name, /^0005-unknown/);
  assert.equal(slideFileName(5, null), '0005-unknown000000.jpg');
});

test('同一页换图（键变）会换文件名，不张冠李戴', () => {
  const a = slideFileName(7, cacheKeyForSlide('https://h/c/1/slides/0007.jpg?v=1'));
  const b = slideFileName(7, cacheKeyForSlide('https://h/c/2/slides/0007.jpg?v=1'));
  assert.notEqual(a, b);
});

// ── 查索引 ───────────────────────────────────────────────

const KEY = 'k'.repeat(32);

test('命中返回条目', () => {
  const index = { [KEY]: { file: '0001-ab.jpg', bytes: 100, usedAt: 1 } };
  assert.deepEqual(lookupCached(KEY, index), { file: '0001-ab.jpg', bytes: 100, usedAt: 1 });
});

test('未命中返回 null', () => {
  assert.equal(lookupCached('nope', { [KEY]: { file: 'a.jpg', bytes: 1 } }), null);
  assert.equal(lookupCached(KEY, {}), null);
  assert.equal(lookupCached(KEY, null), null);
  assert.equal(lookupCached(KEY, undefined), null);
});

test('损坏条目当未命中，不把坏文件名传出去', () => {
  assert.equal(lookupCached(KEY, { [KEY]: null }), null);
  assert.equal(lookupCached(KEY, { [KEY]: {} }), null);
  assert.equal(lookupCached(KEY, { [KEY]: { file: '' } }), null);
  assert.equal(lookupCached(KEY, { [KEY]: { file: 123 } }), null);
});

test('空键不命中（避免整个索引被当成一张图）', () => {
  assert.equal(lookupCached('', { '': { file: 'a.jpg', bytes: 1 } }), null);
  assert.equal(lookupCached(null, { '': { file: 'a.jpg', bytes: 1 } }), null);
});

// ── 合并索引 ─────────────────────────────────────────────

test('合并写入新条目并打上时间戳', () => {
  const next = mergeIndex({}, [{ key: KEY, file: 'a.jpg', bytes: 200 }], 1234);
  assert.deepEqual(next[KEY], { file: 'a.jpg', bytes: 200, usedAt: 1234 });
});

test('合并不就地改原索引', () => {
  const before = {};
  mergeIndex(before, [{ key: KEY, file: 'a.jpg', bytes: 200 }], 1);
  assert.deepEqual(before, {});
});

test('丢弃残缺结果（缺键/缺文件/大小非法）', () => {
  const next = mergeIndex(
    {},
    [
      { file: 'a.jpg', bytes: 1 },
      { key: 'x' },
      { key: 'y', file: 'b.jpg', bytes: 0 },
      { key: 'z', file: 'c.jpg', bytes: NaN },
      { key: 'w', file: 'c.jpg', bytes: -5 },
      null,
      { key: KEY, file: 'good.jpg', bytes: 10 },
    ],
    7,
  );
  assert.deepEqual(Object.keys(next), [KEY]);
});

test('大小超过单张上限的结果仍会记录 —— 上限由下载层把关', () => {
  // 这里只断言 mergeIndex 不偷偷按 MAX_SLIDE_BYTES 截断：
  // 截断大小会让容量统计撒谎，真正的拒绝应该发生在上游。
  const next = mergeIndex({}, [{ key: KEY, file: 'big.jpg', bytes: MAX_SLIDE_BYTES + 1 }], 1);
  assert.equal(next[KEY].bytes, MAX_SLIDE_BYTES + 1);
});

// ── 触碰 ─────────────────────────────────────────────────

test('touch 只更新已存在的键的时间戳', () => {
  const index = { [KEY]: { file: 'a.jpg', bytes: 100, usedAt: 1 } };
  const next = touchIndex(index, [KEY], 999);
  assert.deepEqual(next[KEY], { file: 'a.jpg', bytes: 100, usedAt: 999 });
});

test('touch 不新增未知键（否则容量统计凭空变大）', () => {
  const next = touchIndex({}, ['ghost'], 999);
  assert.deepEqual(next, {});
});

// ── 淘汰 ─────────────────────────────────────────────────

test('配额内不淘汰', () => {
  const index = { a: { file: 'a.jpg', bytes: 10, usedAt: 1 } };
  const plan = planEviction(index, 100);
  assert.deepEqual(plan.evict, []);
  assert.equal(plan.totalBytes, 10);
  assert.equal(plan.evictedBytes, 0);
});

test('超配额时先删最久未用的（LRU 而非 FIFO）', () => {
  const index = {
    old: { file: 'old.jpg', bytes: 60, usedAt: 1 },
    hot: { file: 'hot.jpg', bytes: 60, usedAt: 300 }, // 创建晚但一直在看
    mid: { file: 'mid.jpg', bytes: 60, usedAt: 100 },
  };
  const plan = planEviction(index, 100);
  assert.deepEqual(plan.evict, ['old', 'mid']);
  assert.equal(plan.totalBytes, 180);
  assert.equal(plan.evictedBytes, 120);
});

test('常看的旧课不会被新课挤掉', () => {
  const index = {
    favourite: { file: 'f.jpg', bytes: 60, usedAt: 9_999 }, // 最早下的，但一直在看
    fresh: { file: 'n.jpg', bytes: 60, usedAt: 5_000 },
  };
  const plan = planEviction(index, 60);
  assert.deepEqual(plan.evict, ['fresh']);
});

test('单条超过整个配额也会被删', () => {
  const index = { huge: { file: 'h.jpg', bytes: 5_000, usedAt: 1 } };
  const plan = planEviction(index, 1_000);
  assert.deepEqual(plan.evict, ['huge']);
});

test('淘汰到刚好进配额就停手，不多删', () => {
  const index = {
    a: { file: 'a.jpg', bytes: 50, usedAt: 1 },
    b: { file: 'b.jpg', bytes: 50, usedAt: 2 },
    c: { file: 'c.jpg', bytes: 50, usedAt: 3 },
  };
  const plan = planEviction(index, 100);
  assert.deepEqual(plan.evict, ['a']);
});

test('缺失 usedAt 的条目按最久未用处理（先删）', () => {
  const index = {
    broken: { file: 'b.jpg', bytes: 60 },
    used: { file: 'u.jpg', bytes: 60, usedAt: 100 },
  };
  const plan = planEviction(index, 60);
  assert.deepEqual(plan.evict, ['broken']);
});

test('空索引与 null 索引不炸', () => {
  assert.deepEqual(planEviction({}, 100), { evict: [], totalBytes: 0, evictedBytes: 0 });
  assert.deepEqual(planEviction(null, 100), { evict: [], totalBytes: 0, evictedBytes: 0 });
});

test('默认配额是 2 GB', () => {
  assert.equal(CACHE_QUOTA_BYTES, 2 * 1024 * 1024 * 1024);
  const index = { a: { file: 'a.jpg', bytes: 10, usedAt: 1 } };
  assert.deepEqual(planEviction(index).evict, []);
});

// ── 删键 ─────────────────────────────────────────────────

test('删键不就地改原索引', () => {
  const index = { [KEY]: { file: 'a.jpg', bytes: 1, usedAt: 1 } };
  const next = removeKeys(index, [KEY]);
  assert.deepEqual(next, {});
  assert.deepEqual(Object.keys(index), [KEY]);
});

// ── 挑出待下载 ───────────────────────────────────────────

test('已缓存的页不再下载', () => {
  const slides = [
    { page: 1, imageUrl: 'https://h/s/0001.jpg' },
    { page: 2, imageUrl: 'https://h/s/0002.jpg' },
  ];
  const key1 = cacheKeyForSlide(slides[0].imageUrl);
  const index = mergeIndex({}, [{ key: key1, file: '0001-x.jpg', bytes: 10 }], 1);
  const todo = missingSlides(slides, index);
  assert.equal(todo.length, 1);
  assert.equal(todo[0].page, 2);
});

test('待下载项带齐 page/url/key/file，供下载层直接用', () => {
  const todo = missingSlides([{ page: 3, imageUrl: IMG }], {});
  assert.equal(todo.length, 1);
  assert.equal(todo[0].page, 3);
  assert.equal(todo[0].imageUrl, IMG);
  assert.match(todo[0].key, /^[0-9a-f]{32}$/);
  assert.equal(todo[0].file, slideFileName(3, todo[0].key));
});

test('签名换了但内容没换 → 不重下', () => {
  const slides = [{ page: 1, imageUrl: `${IMG}?e=1&token=a` }];
  const key = cacheKeyForSlide(slides[0].imageUrl);
  const index = mergeIndex({}, [{ key, file: '0001-x.jpg', bytes: 10 }], 1);
  // 模拟刷新后签名变化
  const refreshed = [{ page: 1, imageUrl: `${IMG}?e=2&token=b` }];
  assert.deepEqual(missingSlides(refreshed, index), []);
});

test('无效地址的页被跳过而不是产出坏键', () => {
  const todo = missingSlides(
    [
      { page: 1, imageUrl: null },
      { page: 2, imageUrl: 'blob:x' },
      { page: 3, imageUrl: IMG },
    ],
    {},
  );
  assert.deepEqual(todo.map((item) => item.page), [3]);
});

test('空输入与 null 返回空数组', () => {
  assert.deepEqual(missingSlides([], {}), []);
  assert.deepEqual(missingSlides(null, {}), []);
  assert.deepEqual(missingSlides(undefined, null), []);
});
