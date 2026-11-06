/**
 * 智云课堂的**增量读取**能力：逐字稿、按天查课、课程搜索。
 *
 * 这三块原先只在 omni（TypeScript 移植岗）里有，现在长进本仓的
 * `ClassroomSource`。测试用假 fetch，**不联网**。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ClassroomSource, ENDPOINTS } from '../packages/dsh-zhiyun-source-classroom/src/source.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
});

/** 造一个已登录的 source：JWTUser cookie 带 user id，供 searchCourses 使用。 */
async function loggedIn(handler) {
  const source = new ClassroomSource({ fetch: handler });
  await source.transport.session.jar.setCookie(
    `JWTUser=${encodeURIComponent(JSON.stringify({ sub: '42', realname: '张三' }))}; Domain=classroom.zju.edu.cn; Path=/; Secure`,
    'https://classroom.zju.edu.cn/',
  );
  return source;
}

/* ────────────────────────────────────── 逐字稿 */

const subtitles = (items) => json({ list: [{ all_content: items }] });

test('逐字稿：每段带时间戳、按 offset/maxCharacters 分页', async () => {
  const source = await loggedIn(async () => subtitles([
    { BeginSec: '0', EndSec: '3', Text: '第一句' },
    { BeginSec: '3', EndSec: '9', Text: '第二句' },
    { BeginSec: '65', EndSec: '70', Text: '一分零五秒' },
  ]));

  const whole = await source.getTranscript('7', '9');
  assert.equal(whole.available, true);
  assert.equal(whole.segments, 3);
  assert.equal(whole.duration, '01:10');
  assert.match(whole.text, /\[00:00\] 第一句/);
  assert.match(whole.text, /\[01:05\] 一分零五秒/);
  assert.equal(whole.nextOffset, null, '一次读完就不该给下一页');

  // 只取前 20 个字符：必须给出 nextOffset，且两次拼接等于全文
  const head = await source.getTranscript('7', '9', { maxCharacters: 20 });
  assert.equal(head.nextOffset, 20);
  const tail = await source.getTranscript('7', '9', { offset: head.nextOffset });
  assert.equal(head.text + tail.text, whole.text, '分页拼接必须等于全文');
  assert.equal(tail.nextOffset, null);
});

test('逐字稿：timestampEverySec 聚合后行数下降但文字不丢', async () => {
  const source = await loggedIn(async () => subtitles([
    { BeginSec: '0', EndSec: '5', Text: '甲' },
    { BeginSec: '10', EndSec: '15', Text: '乙' },
    { BeginSec: '70', EndSec: '75', Text: '丙' },
  ]));

  const plain = await source.getTranscript('7', '9');
  const grouped = await source.getTranscript('7', '9', { timestampEverySec: 60 });

  assert.equal(plain.text.split('\n').length, 3, '不聚合时一行一句');
  assert.equal(grouped.text.split('\n').length, 2, '按分钟聚成两块');
  // 文字一个都不能少
  for (const word of ['甲', '乙', '丙']) assert.ok(grouped.text.includes(word), `丢了 ${word}`);
  assert.ok(grouped.text.includes('[00:00] 甲 乙'), '同一分钟内应合并成一段');
});

test('逐字稿：withoutTimestamps 时只给正文', async () => {
  const source = await loggedIn(async () => subtitles([
    { BeginSec: '0', EndSec: '3', Text: '只有正文' },
  ]));
  const { text } = await source.getTranscript('7', '9', { withTimestamps: false });
  assert.equal(text, '只有正文');
  assert.doesNotMatch(text, /\[/);
});

test('逐字稿：没有转录时如实说不可用，不编空串当成功', async () => {
  const source = await loggedIn(async () => subtitles([]));
  const out = await source.getTranscript('7', '9');
  assert.equal(out.available, false);
  assert.equal(out.text, '');
  assert.equal(out.segments, 0);
  assert.equal(out.nextOffset, null);
});

/* ────────────────────────────────────── 按天查课 */

test('按天查课：按天倒序、去重、标记 upcoming', async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const seenDays = [];
  const source = await loggedIn(async (url) => {
    const target = new URL(url);
    const day = target.searchParams.get('day');
    seenDays.push(day);
    if (day === '2026-10-20') {
      return json({
        list: [{
          course: [
            { id: 7, title: '数据结构', sub_id: 70, realname: '李老师', room_name: 'A101', course_begin: nowSec - 3600 },
            { id: 7, title: '重复节次', sub_id: 70, course_begin: nowSec },
          ],
        }],
      });
    }
    return json({
      list: [{
        course: [{ id: 8, title: '操作系统', sub_id: 80, course_begin: nowSec + 7200 }],
      }],
    });
  });

  const out = await source.getMyLectures({ date: '2026-10-20', days: 2 });
  assert.deepEqual(seenDays.sort(), ['2026-10-19', '2026-10-20'], '两天各请求一次');
  assert.equal(out.from, '2026-10-19');
  assert.equal(out.to, '2026-10-20');

  const subIds = out.lectures.map((l) => l.subId);
  assert.equal(new Set(subIds).size, subIds.length, '同一节次不能重复');
  assert.equal(out.lectures.length, 2);

  const upcoming = out.lectures.find((l) => l.subId === '80');
  assert.equal(upcoming.upcoming, true, '未来的课要标 upcoming');
  const past = out.lectures.find((l) => l.subId === '70');
  assert.equal(past.upcoming, undefined, '已经开始的课不标');
});

test('按天查课的 days 越界要拦，且不发请求', async () => {
  let calls = 0;
  const source = await loggedIn(async () => { calls += 1; return json({ list: [] }); });
  for (const days of [0, 15, 1.5, 'x']) {
    await assert.rejects(() => source.getMyLectures({ days }), (error) => {
      assert.equal(error.code, 'INVALID_INPUT', `days=${days} 应被拦`);
      return true;
    });
  }
  assert.equal(calls, 0, '参数不合法时不该发请求');
});

/* ────────────────────────────────────── 课程搜索 */

test('课程搜索：带上 user_id/user_name 与关键词，支持翻页', async () => {
  let seenUrl = null;
  const source = await loggedIn(async (url) => {
    seenUrl = String(url);
    return json({ total: { total: 20, list: [
      { course_id: 501, title: '编译原理', realname: '王老师', term_name: '2025-2026 秋冬' },
      // 上游有两种 id 形状：`course_id` 与 `id`，两个都要认
      { id: 502, course_title: '只有 id 的行' },
      // 两个都没有的行没有身份，必须丢掉（否则页面会拿到一条点不开的课）
      { title: '没有 id 的行' },
    ] } });
  });

  const out = await source.searchCourses({ keyword: '编译', teacher: '王' });
  const target = new URL(seenUrl);

  assert.equal(target.searchParams.get('user_id'), '42', '必须带当前用户 id');
  assert.equal(target.searchParams.get('title'), '编译');
  assert.equal(target.searchParams.get('realname'), '王');
  assert.equal(target.searchParams.get('tenant_code'), '112');

  assert.equal(out.courses.length, 2, '没有 id 的行要丢掉');
  assert.equal(out.courses[0].title, '编译原理');
  assert.equal(out.courses[1].courseId, '502', '`id` 也要能当课程 id');
  assert.equal(out.total, 20);
  assert.equal(out.nextPage, 2, '20 > 16 应该还有下一页');
});

test('课程搜索：未登录时明确报会话失效，而不是发一个空用户请求', async () => {
  let calls = 0;
  const source = new ClassroomSource({ fetch: async () => { calls += 1; return json({ total: { list: [] } }); } });
  await assert.rejects(() => source.searchCourses({ keyword: 'x' }), (error) => {
    assert.equal(error.code, 'SESSION_EXPIRED');
    return true;
  });
  assert.equal(calls, 0);
});

test('课程搜索命中正确端点（不是我选的课那个）', async () => {
  let seenUrl = null;
  const source = await loggedIn(async (url) => {
    seenUrl = String(url);
    return json({ total: { total: 0, list: [] } });
  });
  await source.searchCourses({});
  assert.ok(seenUrl.startsWith(ENDPOINTS.search), `实际打到 ${seenUrl}`);
  assert.equal(seenUrl.includes(ENDPOINTS.courses), false, '不该落到 listCourses 的端点');
});
