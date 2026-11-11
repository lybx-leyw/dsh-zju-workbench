/**
 * 查老师数据源的行为测试。
 *
 * # 为什么全部用合成索引
 *
 * 站点在国内**不可达**（上游与本站开发机都实测过），任何真实网络测试都会失败。
 * 而本包的核心价值恰好是「有缓存时完全离线可用」—— 那正是合成索引能测死的部分。
 *
 * 所以这里测三件事：打分排序、查询拆分、缓存与降级语义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  SITE, ChalaoshiError, IndexCache, fetchCourseGpa, fetchIndex, parseGpaTable, parseRate, searchIndex,
  splitQuery, teacherFromIndex,
} from '../../../packages/source/chalaoshi/src/chalaoshi.js';

/** 一份小索引：两位同姓教师、一位外教、一位拼音易混的。 */
const INDEX = {
  version: 1,
  fetchedAt: Date.now(),
  colleges: [
    { id: 1, name: '数学科学学院' },
    { id: 2, name: '计算机科学与技术学院' },
  ],
  teachers: [
    { id: 100, name: '王伟', py: 'wangwei', sx: 'ww', xy: 1, hot: 90, rate: '9.4' },
    { id: 101, name: '王伟华', py: 'wangweihua', sx: 'wwh', xy: 2, hot: 40, rate: '7.2' },
    { id: 102, name: '李娜', py: 'lina', sx: 'ln', xy: 2, hot: 10, rate: '0.0' },
    { id: 103, name: 'John Smith', py: 'johnsmith', sx: 'js', xy: 1, hot: 5, rate: 'N/A' },
  ],
};

test('评分字符串：有分 / 无分 / 无数据 三态', () => {
  assert.equal(parseRate('9.4'), 9.4);
  assert.equal(parseRate('0.0'), null, '0.0 是「无评分」，不是「0 分」');
  assert.equal(parseRate('N/A'), null);
  assert.equal(parseRate(undefined), null);
});

test('姓名全等排最前', () => {
  const hits = searchIndex(INDEX, '王伟');
  assert.equal(hits[0].name, '王伟');
  assert.equal(hits[0].match, 'name');
  assert.equal(hits[0].exact, true);
  assert.equal(hits[0].rating, 9.4);
  assert.equal(hits[0].college, '数学科学学院');
});

test('同姓的其他人也命中，但排在后面', () => {
  const hits = searchIndex(INDEX, '王伟');
  assert.ok(hits.some((h) => h.name === '王伟华'), '王伟华 应作为「姓名开头」命中');
  const exact = hits.findIndex((h) => h.name === '王伟');
  const prefixed = hits.findIndex((h) => h.name === '王伟华');
  assert.ok(exact < prefixed, '全等要排在开头匹配之前');
});

test('拼音与首字母都能搜', () => {
  assert.equal(searchIndex(INDEX, 'wangwei')[0].name, '王伟');
  assert.equal(searchIndex(INDEX, 'ln')[0].name, '李娜');
  assert.equal(searchIndex(INDEX, 'lina')[0].name, '李娜');
});

test('外教的英文名可以直接搜', () => {
  const hits = searchIndex(INDEX, 'smith');
  assert.equal(hits[0].name, 'John Smith');
});

test('「姓名 学院」混合查询：学院被拆成过滤条件', () => {
  const split = splitQuery(INDEX, '王伟 计算机');
  assert.deepEqual(split.tokens, ['王伟']);
  assert.deepEqual([...split.collegeIds], [2]);
});

test('单 token 且对上学院名（≥3 字）时按学院浏览', () => {
  const split = splitQuery(INDEX, '数学科学学院');
  assert.deepEqual(split.tokens, []);
  assert.deepEqual([...split.collegeIds], [1]);

  const hits = searchIndex(INDEX, '数学科学学院');
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((h) => h.college === '数学科学学院'), '按学院浏览只返回该学院的');
});

test('短 token 不会被误当学院（「王」是姓，不是学院）', () => {
  const split = splitQuery(INDEX, '王');
  assert.deepEqual(split.tokens, ['王'], '单字必须当姓名');
  assert.equal(split.collegeIds, undefined);
});

test('ratedOnly 滤掉无评分的', () => {
  const hits = searchIndex(INDEX, '王', { ratedOnly: true });
  assert.ok(hits.every((h) => h.rating !== null));
});

test('sort=rate 按评分降序，无评分的排最后', () => {
  // 查询用「王」（单字姓名 token），覆盖两位王姓教师，其中一位无评分。
  const hits = searchIndex(INDEX, '王', { sort: 'rate' });
  assert.deepEqual(hits.map((h) => h.name), ['王伟', '王伟华']);
});

test('sort=rate 时无评分的排在最后', () => {
  // 「李」命中李娜（无评分）；「John」命中外教（也无评分）。
  // 用一个能同时命中「有评分」与「无评分」的查询：按学院浏览计算机学院。
  const hits = searchIndex(INDEX, '计算机科学与技术学院', { sort: 'rate' });
  assert.deepEqual(hits.map((h) => h.name), ['王伟华', '李娜'], '7.2 在前，无评分在后');
});

test('空查询返回空数组，不返回全部教师', () => {
  assert.deepEqual(searchIndex(INDEX, ''), []);
  assert.deepEqual(searchIndex(INDEX, '   '), []);
});

test('limit 生效', () => {
  assert.equal(searchIndex(INDEX, '王', { limit: 1 }).length, 1);
});

test('teacherFromIndex 映射字段', () => {
  const mapped = teacherFromIndex(INDEX.teachers[0], new Map([[1, '数学科学学院']]));
  assert.equal(mapped.name, '王伟');
  assert.equal(mapped.pinyin, 'wangwei');
  assert.equal(mapped.initials, 'ww');
  assert.equal(mapped.college, '数学科学学院');
});

/* ────────────────────────────── 缓存与降级 ── */

/** 造一个 IndexCache，内存里存一份。 */
function memoryCache({ initial, now = () => Date.now() } = {}) {
  let stored = initial;
  const cache = new IndexCache({
    load: () => stored,
    save: async (index) => { stored = JSON.parse(JSON.stringify(index)); },
    now,
  });
  return { cache, get stored() { return stored; } };
}

test('缓存形状不对时当作没有（不让坏文件变成空索引）', () => {
  const { cache } = memoryCache({ initial: { version: 99 } });
  assert.equal(cache.read(), undefined);
});

test('缓存新鲜期内不联网', () => {
  const fixed = Date.now();
  const { cache } = memoryCache({ initial: { ...INDEX, fetchedAt: fixed }, now: () => fixed + 1000 });
  assert.equal(cache.read() !== undefined, true);
  assert.equal(cache.fresh(cache.read()), true);
});

test('缓存过期后不新鲜', () => {
  const fixed = Date.now();
  const { cache } = memoryCache({ initial: { ...INDEX, fetchedAt: fixed }, now: () => fixed + 8 * 24 * 3600 * 1000 });
  assert.equal(cache.fresh(cache.read()), false);
});

test('拉索引失败但**有缓存**时沿用缓存，并如实标记降级', async () => {
  const { request } = fakeRequest(() => { throw new Error('ECONNRESET'); });
  const result = await fetchIndex({ request, cached: { ...INDEX, fetchedAt: 1 } });

  assert.equal(result.sync.source, 'cache');
  assert.match(String(result.sync.degraded), /ECONNRESET/, '要记下为什么降级');
  assert.equal(result.index.teachers.length, INDEX.teachers.length);
});

test('拉索引失败且**没有缓存**时抛 UNREACHABLE，并说明需要出海', async () => {
  const { request } = fakeRequest(() => { throw new Error('ECONNRESET'); });
  await assert.rejects(() => fetchIndex({ request }), (error) => {
    assert.equal(error.code, 'UNREACHABLE');
    assert.match(error.message, /出海/);
    assert.match(error.message, /WebVPN 帮不上忙/);
    return true;
  });
});

test('304 只更新 fetchedAt，不重写数据', async () => {
  const cached = { ...INDEX, fetchedAt: 1, etag: '"abc"' };
  const { request, calls } = fakeRequest(() => ({ status: 304, headers: {}, text: '' }));
  const result = await fetchIndex({ request, cached });

  assert.equal(result.sync.source, 'not-modified');
  assert.ok(result.index.fetchedAt > 1, 'fetchedAt 要刷新');
  assert.equal(result.index.teachers.length, INDEX.teachers.length, '数据不动');
  assert.equal(calls[0].headers['If-None-Match'], '"abc"', '要带条件头');
});

test('200 时下载并记下 ETag', async () => {
  const { request } = fakeRequest(() => ({
    status: 200,
    headers: { etag: '"xyz"', 'last-modified': 'Wed, 01 Oct 2026 00:00:00 GMT' },
    text: JSON.stringify({ teachers: INDEX.teachers, colleges: INDEX.colleges }),
  }));
  const result = await fetchIndex({ request });

  assert.equal(result.sync.source, 'downloaded');
  assert.equal(result.index.etag, '"xyz"');
  assert.equal(result.index.lastModified, 'Wed, 01 Oct 2026 00:00:00 GMT');
});

test('索引 JSON 形状不对时抛 SHAPE', async () => {
  const { request } = fakeRequest(() => ({ status: 200, headers: {}, text: JSON.stringify({ teachers: [] }) }));
  await assert.rejects(() => fetchIndex({ request }), (error) => {
    assert.equal(error.code, 'SHAPE');
    return true;
  });
});

test('站点地址常量正确', () => {
  assert.equal(SITE, 'https://chalaoshi.de');
});

/**
 * 造一个假 request。
 *
 * @param handler - `(url, init) => response`。
 * @returns `{ request, calls }`。
 */
function fakeRequest(handler) {
  const calls = [];
  const request = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    return handler(String(url), init);
  };
  return { request, calls };
}

/* ────────────────────────────── hot 加成（回归守卫） ── */

/**
 * 这一段专门守审核查出的 M1：`hot` 加成不能用固定除数。
 *
 * 原来的实现是 `Math.min(3, hot / 10)`，而上游是 `(hot / maxHot) * 3`。
 * 差别在 `hot >= 30` 之后：固定除数会一律封顶 3 分，人气差异被完全抹平。
 *
 * ⚠️ 之前那版夹具用 hot 90 与 40 —— **两个都 >= 30**，所以在两种公式下
 * 分数差一模一样，测试全绿也抓不到公式被改坏。这里改用**热度差一个数量级**
 * 的两人，让固定除数与按 maxHot 归一化的结果分道扬镳。
 */
test('hot 加成按索引内最高人气归一化，不是固定除数', () => {
  const index = {
    version: 1,
    fetchedAt: Date.now(),
    colleges: [{ id: 1, name: '数学科学学院' }],
    teachers: [
      // 两人姓名完全相同（都用「王伟」的问号都无法区分时改用同一前缀），
      // 只有 hot 不同 —— 于是分数差只能来自 hot 加成。
      { id: 1, name: '张一', py: 'zhangyi', sx: 'zy', xy: 1, hot: 1000, rate: '8.0' },
      { id: 2, name: '张二', py: 'zhanger', sx: 'ze', xy: 1, hot: 10, rate: '8.0' },
    ],
  };
  const hits = searchIndex(index, '张');
  const hot1 = hits.find((hit) => hit.name === '张一');
  const hot10 = hits.find((hit) => hit.name === '张二');

  // maxHot = 1000：
  //   张一 hot 加成 = (1000/1000)*3 = 3.0
  //   张二 hot 加成 = (10/1000)*3  = 0.03
  // 两者差 ≈ 2.97。
  const gap = hot1.score - hot10.score;
  assert.ok(gap > 2.5, `hot 1000 与 hot 10 的分数差应约 2.97，实际 ${gap.toFixed(3)}`);

  // 反证：若用固定除数 /10，两者都会被 Math.min(3, ...) 封顶到 3，差距变成 0。
  assert.ok(gap > 0.5, '固定除数 /10 会让两者都封顶 3 分、差距归零 —— 这条断言就是防它');
});

test('hot 全为 0 时不会除零', () => {
  const index = {
    version: 1,
    fetchedAt: Date.now(),
    colleges: [{ id: 1, name: '数学科学学院' }],
    teachers: [{ id: 1, name: '张一', py: 'zhangyi', sx: 'zy', xy: 1, hot: 0, rate: '8.0' }],
  };
  const hits = searchIndex(index, '张');
  assert.equal(hits.length, 1);
  assert.ok(Number.isFinite(hits[0].score), '分数必须是有限数，不能是 NaN');
});

/* ────────────────────────────── 课程绩点表（W-14） ────────────────────────── */

/**
 * 课程绩点表（`api /gpa?course=`）。
 *
 * ⚠️ 夹具按上游 `chalaoshi/index.ts` 的 `parseGpaTable` 正则手写，**未经真实页面验证**；
 * 站点在国内不可达，拿不到真实响应。
 */

const GPA_TABLE = `<table><tr><th>教师</th><th>平均绩点</th><th>样本</th></tr>
<tr><td class="course_name">王伟</td><td>4.12<span class="sd">±0.31</span></td><td>500+</td></tr>
<tr><td class="course_name">李娜</td><td>3.80</td><td>42</td></tr>
<tr><td class="course_name">Smith &amp; Co</td><td>2.55</td><td>7</td></tr>
</table>`;

test('parseGpaTable：姓名、均绩点、标准差、样本（保留 500+ 的「至少」语义）', () => {
  const rows = parseGpaTable(GPA_TABLE);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].teacher, '王伟');
  assert.equal(rows[0].gpa, 4.12);
  assert.equal(rows[0].sd, 0.31);
  assert.equal(rows[0].sampleText, '500+');
  assert.equal(rows[0].sample, 500, '`+` 只影响 sampleText，不改变数字');
  assert.equal(rows[1].sd, null, '没有 ± 时给 null，不编一个 0');
  assert.equal(rows[2].teacher, 'Smith & Co', '实体要反转义');
});

test('parseGpaTable：结构不符时给空数组，不抛（调用方据 count 说话）', () => {
  assert.deepEqual(parseGpaTable('<html>没有这门课</html>'), []);
  assert.deepEqual(parseGpaTable(null), []);
});

test('fetchCourseGpa：课程名编码一次；404 说清「没有数据」而不是「网络失败」', async () => {
  const calls = [];
  const ok = await fetchCourseGpa({
    request: async (url) => { calls.push(url); return { status: 200, text: GPA_TABLE }; },
    course: '微积分（甲）Ⅰ',
  });
  assert.equal(ok.course, '微积分（甲）Ⅰ');
  assert.equal(ok.count, 3);
  assert.match(calls[0], /^https:\/\/api\.chalaoshi\.de\/gpa\?course=/);
  assert.match(calls[0], /%E5%BE%AE%E7%A7%AF%E5%88%86/, '课程名要编码');

  await assert.rejects(
    () => fetchCourseGpa({ request: async () => ({ status: 404, text: '' }), course: '没有这门课' }),
    (error) => {
      assert.equal(error.code, 'NOT_FOUND');
      assert.match(error.message, /没有课程/);
      return true;
    },
  );
});

test('fetchCourseGpa：空课程名当场拒绝，不发请求', async () => {
  let called = false;
  await assert.rejects(
    () => fetchCourseGpa({ request: async () => { called = true; return { status: 200, text: '' }; }, course: '  ' }),
    (error) => error.code === 'INVALID_INPUT',
  );
  assert.equal(called, false);
});

test('apply()：服务面把 course 列进 methods，路由也认这个动作', async () => {
  const { apply, ROUTE_PATH } = await import('../packages/source/chalaoshi/src/index.js');
  const services = new Map();
  const routes = [];
  const ctx = {
    profileContext: { dir: mkdtempSync(path.join(tmpdir(), 'chalaoshi-')) },
    effect(fn) { return fn() ?? (() => {}); },
    provide(name, value) { services.set(name, value); return () => services.delete(name); },
    inject(names, callback) { callback({ webServer: { register(entry) { routes.push(entry); return () => {}; } } }); },
    get() { return undefined; },
  };
  const dispose = apply(ctx);
  try {
    const service = services.get('zhiyunChalaoshi');
    assert.ok(service, '必须 provide zhiyunChalaoshi');
    assert.deepEqual([...service.methods].sort(), ['chalaoshi.course', 'chalaoshi.search', 'chalaoshi.teacher']);
    assert.equal(typeof service.course, 'function');
    assert.equal(routes[0].path, ROUTE_PATH);
  } finally {
    await dispose?.();
  }
});
