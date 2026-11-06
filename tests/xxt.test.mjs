import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  parseXxtCookie, missingRequired, seedCookies, storedCookieNames, XXT_REQUIRED,
} from '../packages/dsh-zhiyun-source-xxt/src/cookie.js';
import {
  parseCourses, parseHomeworkList, parseHomeworkDetail, parseExams,
  parseSchedule, normalizeNotice, matchesNotice, isPending, nearestDate,
  stripTags, unescapeHtml, hiddenValue,
} from '../packages/dsh-zhiyun-source-xxt/src/parse.js';
import { XxtReader, XXT_METHODS, describeError } from '../packages/dsh-zhiyun-source-xxt/src/reads.js';
import { XxtClient, XXT_SETUP, withQuery } from '../packages/dsh-zhiyun-source-xxt/src/client.js';
import { XXT_HOSTS, isXxtHost, XXT_ENDPOINTS } from '../packages/dsh-zhiyun-source-xxt/src/hosts.js';
import { splitMethod, name, inject, ROUTE_PATH } from '../packages/dsh-zhiyun-source-xxt/src/index.js';
import { SessionStore, ClassroomError } from 'dsh-zhiyun-source-campus/http';

/**
 * 学习通数据源（`dsh-zhiyun-source-xxt`）。
 *
 * # 这份测试在钉什么
 *
 * 不是"能不能跑"，而是**移植过来的那些行为没被改坏**。逐条都有来源：
 *
 *   1. Cookie 的四种粘贴形态（cURL / 请求头 / DevTools 表格 / 裸串）；
 *   2. 课表、作业列表、考试、通知的 HTML/JSON 解析各是什么形状；
 *   3. 截止时间的年份推断（原文不带年份，跨年不能错 11 个月）；
 *   4. 9 个方法各自打的是哪个地址、带哪些参数；
 *   5. Windows 上不能出现 `pbpaste`（上游是 macOS 写的）。
 *
 * 测试**不碰网络、不碰 DPAPI**：`XxtClient` 的 `fetch` 与 `SessionStore` 的
 * `file` 都是可注入的，这里一律注入，`SessionStore` 永远不传 `file`。
 */

const fixture = (name) => readFile(
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)),
  'utf8',
);

/** 记录请求并按 URL 片段匹配回包。 */
function recorder(routes) {
  const calls = [];
  const impl = async (url, init) => {
    const target = String(url);
    calls.push({
      url: target,
      method: init?.method ?? 'GET',
      body: init?.body ?? null,
      headers: init?.headers ?? {},
    });
    for (const [match, handler] of routes) {
      if (target.includes(match)) return handler(target, init);
    }
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  impl.calls = calls;
  return impl;
}

const html = (body) => new Response(body, {
  status: 200,
  headers: { 'content-type': 'text/html; charset=utf-8' },
});
const json = (payload) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { 'content-type': 'application/json' },
});

/** 造一个已装 Cookie 的客户端（`file` 不传 → 纯内存，不碰 DPAPI）。 */
async function makeClient(fetcher, env = {}) {
  const client = new XxtClient({ session: new SessionStore({}), fetch: fetcher, env });
  await seedCookies(client.session.jar, 'UID=111; _uid=222; fid=333');
  return client;
}

/* ══════════════════════════════════════ Cookie 提取（四种输入） */

test('cookie：cURL 命令里认出 Cookie 头', () => {
  const curl = "curl 'https://mooc1.chaoxing.com/mooc2/work/list' \\\n"
    + "  -H 'Cookie: UID=111; _uid=222; fid=333' \\\n"
    + "  -H 'User-Agent: Mozilla/5.0'";
  const parsed = parseXxtCookie(curl);
  assert.equal(parsed.source, 'curl 命令');
  assert.equal(parsed.cookie, 'UID=111; _uid=222; fid=333');
  assert.deepEqual(parsed.names, ['UID', '_uid', 'fid']);
});

test('cookie：Cookie 请求头', () => {
  const parsed = parseXxtCookie('Cookie: UID=111; _uid=222; fid=333');
  assert.equal(parsed.source, '请求头');
  assert.deepEqual(parsed.names, ['UID', '_uid', 'fid']);
});

test('cookie：DevTools 表格（含表头与属性行，两者都必须排除）', () => {
  const table = [
    'Name\tValue\tDomain\tPath\tExpires',
    '_uid\t222\t.chaoxing.com\t/\tSession',
    'UID\t111\t.chaoxing.com\t/\tSession',
    'fid\t333\t.chaoxing.com\t/\tSession',
    // 这两行与 Cookie 排成同样的列，混进来就会存成"名为 Path 的 Cookie"
    'Path\t/\t.chaoxing.com\t/\tSession',
    'HttpOnly\t✓\t.chaoxing.com\t/\tSession',
  ].join('\n');
  const parsed = parseXxtCookie(table);
  assert.equal(parsed.source, 'DevTools 表格');
  assert.deepEqual(parsed.names, ['_uid', 'UID', 'fid']);
  assert.ok(!parsed.names.includes('Path'));
  assert.ok(!parsed.names.includes('HttpOnly'));
  assert.ok(!parsed.names.includes('Name'));
});

test('cookie：裸 Cookie 字符串', () => {
  const parsed = parseXxtCookie('UID=111; _uid=222; fid=333');
  assert.equal(parsed.source, 'Cookie 字符串');
  assert.equal(parsed.cookie, 'UID=111; _uid=222; fid=333');
});

test('cookie：空输入与噪声返回 null（不能产出空 Cookie）', () => {
  assert.equal(parseXxtCookie(''), null);
  assert.equal(parseXxtCookie('   \n  '), null);
  assert.equal(parseXxtCookie('这里没有任何键值对'), null);
});

test('cookie：缺必需键要能算出来', () => {
  assert.deepEqual(missingRequired(XXT_REQUIRED), []);
  assert.deepEqual(missingRequired(['UID', 'fid']), ['_uid']);
  assert.deepEqual(missingRequired([]), ['UID', '_uid', 'fid']);
});

test('cookie：种进罐后按 chaoxing 子域取得到，且不发给别的域', async () => {
  const store = new SessionStore({});
  const stored = await seedCookies(store.jar, 'UID=111; _uid=222; fid=333');
  assert.equal(stored, 3);
  for (const url of ['https://i.chaoxing.com/base', 'https://mooc1.chaoxing.com/x', 'https://mooc1-3.chaoxing.com/y']) {
    assert.deepEqual(await storedCookieNames(store.jar, url), ['UID', '_uid', 'fid'], url);
  }
  assert.deepEqual(await storedCookieNames(store.jar, 'https://evil.com/'), []);
});

test('cookie：单个非法值不拖垮整次导入', async () => {
  const store = new SessionStore({});
  const stored = await seedCookies(store.jar, 'UID=111; bad name=x; fid=333');
  assert.equal(stored, 2);
});

/* ══════════════════════════════════════ 主机白名单 */

test('主机：只认 chaoxing.com 与其子域，点边界不能漏', () => {
  assert.equal(isXxtHost('chaoxing.com'), true);
  assert.equal(isXxtHost('mooc1.chaoxing.com'), true);
  assert.equal(isXxtHost('passport2.chaoxing.com'), true);
  assert.equal(isXxtHost('MOOC1.CHAOXING.COM'), true);
  // 后缀相同但不是自己的域：放行等于把 Cookie 送给第三方
  assert.equal(isXxtHost('evilchaoxing.com'), false);
  assert.equal(isXxtHost('chaoxing.com.evil.com'), false);
  assert.equal(isXxtHost(''), false);
  assert.equal(XXT_HOSTS.has('mooc1-3.chaoxing.com'), true);
  assert.equal(XXT_HOSTS.has('evilchaoxing.com'), false);
});

/* ══════════════════════════════════════ HTML 基础 */

test('HTML：实体反转义（十进制 / 十六进制 / 命名）', () => {
  assert.equal(unescapeHtml('&amp;'), '&');
  assert.equal(unescapeHtml('&#39;'), "'");
  assert.equal(unescapeHtml('&#x27;'), "'");
  assert.equal(unescapeHtml('&#22269;'), '国');
  assert.equal(unescapeHtml('未知实体 &zzz; 原样'), '未知实体 &zzz; 原样');
});

test('HTML：去标签时脚本与样式整段丢掉，空白压成一个', () => {
  const text = stripTags('<div><style>.a{color:red}</style>作业<span>1</span>/<span>2</span>'
    + '<script>var x = "</div>";</script> 完成</div>');
  assert.equal(text.includes('color:red'), false);
  assert.equal(text.includes('var x'), false);
  assert.equal(text.includes('/'), true);
  // 标签换成空格 → 相邻文字不会被粘成一个词
  assert.match(text, /作业\s?1/);
});

test('HTML：隐藏域两种属性顺序都取得到', () => {
  assert.equal(hiddenValue('<input id="workEnc" value="abc">', 'workEnc'), 'abc');
  assert.equal(hiddenValue('<input value="xyz" id="workEnc">', 'workEnc'), 'xyz');
  assert.equal(hiddenValue('<input id="other" value="no">', 'workEnc'), '');
  // id 里的正则元字符不能再当通配符用
  assert.equal(hiddenValue('<input id="a.b" value="dot">', 'a.b'), 'dot');
});

/* ══════════════════════════════════════ 课表（HTML） */

test('课表：课程列表 HTML → 课程对象（去重、实体、缺教师）', async () => {
  const courses = parseCourses(await fixture('xxt-courselist.html'));
  assert.equal(courses.length, 3, '同一门课的第二个链接必须被去重');
  assert.deepEqual(courses[0], {
    name: '高等数学（甲）I',
    teacher: '张建国', // 第一个 overHidden2 与课程名相同，必须跳过
    courseid: '241122334',
    clazzid: '998877',
    cpi: '306112233',
  });
  assert.equal(courses[1].name, '大学物理 & 实验');
  assert.equal(courses[1].teacher, '李国华');
  assert.equal(courses[2].name, '形势与政策');
  assert.equal(courses[2].teacher, '', '没有教师名时是空串，不是 undefined');
});

test('课表：接口 JSON → 按星期与节次排好的课表', () => {
  const data = {
    curriculum: {
      schoolYear: '2025-2026',
      semester: '秋冬',
      realCurrentWeek: 3,
      // 第 1..12 节的时间段
      lessonTimeConfigArray: [
        '08:00-08:45', '08:55-09:40', '10:00-10:45', '10:55-11:40',
        '13:30-14:15', '14:25-15:10', '15:30-16:15', '16:25-17:10',
        '18:30-19:15', '19:25-20:10', '20:20-21:05', '21:15-22:00',
      ],
    },
    lessonArray: [
      { dayOfWeek: 3, beginNumber: 3, length: 2, name: '大学物理', teacherName: '李国华', location: '东1-201', weeks: '1-16' },
      { dayOfWeek: 1, beginNumber: 1, length: 2, name: '高等数学', teacherName: '张建国', location: '西2-105', weeks: '1-16' },
    ],
  };
  const schedule = parseSchedule(data);
  assert.equal(schedule.school_year, '2025-2026');
  assert.equal(schedule.semester, '秋冬');
  assert.equal(schedule.week, 3, '不传 week 时用平台当前周');
  assert.deepEqual(schedule.lessons.map((l) => l.course), ['高等数学', '大学物理'], '必须按星期排序');
  const math = schedule.lessons[0];
  assert.equal(math.weekday, 1);
  assert.equal(math.periods, '1-2');
  assert.equal(math.time, '08:00-09:40', '起止时间取第一节开始与最后一节结束');
  const physics = schedule.lessons[1];
  assert.equal(physics.periods, '3-4');
  assert.equal(physics.time, '10:00-11:40');

  // 指定 week 时用它覆盖
  assert.equal(parseSchedule(data, 7).week, 7);
});

/* ══════════════════════════════════════ 作业列表（HTML） */

test('作业列表：进度、条目、状态与解码后的详情地址', async () => {
  const result = parseHomeworkList(await fixture('xxt-worklist.html'));
  assert.deepEqual(result.progress, { done: 3, total: 5 });
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.items[0], {
    index: 1,
    title: '第三章 定积分 习题',
    status: '未提交',
    url: 'https://mooc1.chaoxing.com/mooc2/work/doHomeWorkNew?courseId=241122334&classId=998877&workId=7001',
  });
  assert.equal(result.items[1].title, '第二章 导数 & 微分', '作业名里的实体要还原');
  // 按域分配的详情主机名（mooc1-3）也要原样保留，别被改写成 mooc1
  assert.match(result.items[2].url, /^https:\/\/mooc1-3\.chaoxing\.com\//);
  assert.equal(result.items[3].status, '未知', '状态为空时给"未知"，不是空串');
});

test('作业列表：没有任何条目时 progress 为 null，不抛错', () => {
  const result = parseHomeworkList('<div>这门课没有作业</div>');
  assert.deepEqual(result, { progress: null, items: [] });
});

test('作业：完成判定不能把"未完成"算成完成', () => {
  assert.equal(isPending('未提交'), true);
  assert.equal(isPending('未完成'), true, '含"完成"二字但不是完成');
  assert.equal(isPending('已完成'), false);
  assert.equal(isPending('待批阅'), false);
  assert.equal(isPending('已批改'), false);
  assert.equal(isPending(''), true);
});

test('作业详情：标题、题量、满分、作答区间、得分', async () => {
  const detail = parseHomeworkDetail(await fixture('xxt-workdetail.html'));
  assert.equal(detail.title, '第三章 定积分 习题');
  assert.equal(detail.question_count, 10);
  assert.equal(detail.full_score, 100);
  assert.equal(detail.start_time, '03-15 08:00');
  assert.equal(detail.deadline, '03-22 23:59');
  assert.equal(detail.score, '88.5');
});

test('作业详情：字段缺失时一律 null（不能给 0 冒充"没有")', () => {
  const detail = parseHomeworkDetail('<div>作业详情</div>');
  assert.equal(detail.title, null);
  assert.equal(detail.question_count, null);
  assert.equal(detail.full_score, null);
  assert.equal(detail.deadline, null);
  assert.equal(detail.score, null);
});

/* ══════════════════════════════════════ 截止时间的年份推断 */

test('截止时间：无年份的时间补成最接近今天的年份（北京时间）', () => {
  // 2026-03-01 看 03-15 → 同一个年
  assert.equal(
    nearestDate('03-15 23:59', new Date('2026-03-01T00:00:00+08:00')),
    '2026-03-15T23:59:00+08:00',
  );
  // 2026-12-20 看 03-15 → 应该是 2027（三个月后），不是 2026（九个月前）
  assert.equal(
    nearestDate('03-15 23:59', new Date('2026-12-20T00:00:00+08:00')),
    '2027-03-15T23:59:00+08:00',
  );
  // 2026-01-05 看 12-20 → 应该是 2025（半个月前），不是 2026（十一个月后）
  assert.equal(
    nearestDate('12-20 23:59', new Date('2026-01-05T00:00:00+08:00')),
    '2025-12-20T23:59:00+08:00',
  );
});

test('截止时间：不存在的日期返回 null，不能滚到下个月', () => {
  assert.equal(nearestDate('02-30 10:00', new Date('2026-03-01T00:00:00+08:00')), null);
  assert.equal(nearestDate('13-01 10:00', new Date('2026-03-01T00:00:00+08:00')), null);
  assert.equal(nearestDate('乱码', new Date()), null);
});

/* ══════════════════════════════════════ 考试 */

test('考试：dataTr 行按列序解析，少列的行被丢掉', async () => {
  const result = parseExams(await fixture('xxt-examlist.html'));
  assert.equal(result.exams.length, 2, '"暂无考试数据"那行只有 1 列，必须丢掉');
  assert.deepEqual(result.exams[0], {
    name: '期中测验',
    time: '2026-04-10 14:00~16:00',
    minutes: '120',
    exam_status: '进行中',
    my_status: '未作答',
    score: null,
    mode: '线上',
  });
  assert.equal(result.exams[1].name, '单元小测 & 自测');
  assert.equal(result.exams[1].score, '92');
});

/* ══════════════════════════════════════ 通知 */

test('通知：归一化取正文纯文本并截断到 800 字', () => {
  const notice = normalizeNotice({
    title: '关于期末考试的通知',
    createrName: '教务处',
    completeTime: '2026-03-01 10:00',
    isread: 0,
    content: `<p>${'甲'.repeat(1000)}</p>`,
  });
  assert.equal(notice.title, '关于期末考试的通知');
  assert.equal(notice.sender, '教务处');
  assert.equal(notice.time, '2026-03-01 10:00');
  assert.equal(notice.read, false);
  assert.equal(notice.content.length, 800);
  assert.equal(notice.content.includes('<p>'), false);
});

test('通知：发送者字段的两种命名都认', () => {
  assert.equal(normalizeNotice({ senderName: '学工部' }).sender, '学工部');
  assert.equal(normalizeNotice({ createrName: '教务处' }).sender, '教务处');
});

test('通知：未读与关键词过滤', () => {
  const unread = { title: '甲', content: '', isread: 0 };
  const read = { title: '乙', content: '内容', isread: 1 };
  assert.equal(matchesNotice(unread, {}), true);
  assert.equal(matchesNotice(read, { unread_only: true }), false);
  assert.equal(matchesNotice(unread, { unread_only: true }), true);
  assert.equal(matchesNotice(read, { keyword: '内容' }), true, '关键词也搜正文');
  assert.equal(matchesNotice(read, { keyword: '不存在' }), false);
});

/* ══════════════════════════════════════ 9 个方法的 URL 构造 */

/** 覆盖 9 个方法的全套夹具回包。 */
async function fullRoutes({ workEnc = 'ENC123' } = {}) {
  const courseList = await fixture('xxt-courselist.html');
  const workList = await fixture('xxt-worklist.html');
  const workDetail = await fixture('xxt-workdetail.html');
  const examList = await fixture('xxt-examlist.html');
  return [
    ['i.chaoxing.com/base', () => html('<script>var fid = \'427\';</script>')],
    ['courselistdata', () => html(courseList)],
    ['stucoursemiddle', () => html(
      `<input id="workEnc" value="${workEnc}"><input id="openc" value="OPEN1"><input id="enc" value="STU1">`,
    )],
    ['mooc2/work/list', () => html(workList)],
    ['doHomeWorkNew', () => html(workDetail)],
    ['examcode/examlist', () => html(examList)],
    ['getNoticeList', () => json({
      status: true,
      notices: {
        list: [
          { title: '未读一', createrName: '教务处', completeTime: '2026-03-02', isread: 0, content: '<p>正文</p>' },
          { title: '已读二', senderName: '学工部', insertTime: '2026-03-01', isread: 1, content: 'x' },
        ],
        lastGetId: 'cursor-2',
        lastPage: true,
      },
    })],
    ['getMyLessons', () => json({
      result: 1,
      data: {
        curriculum: { schoolYear: '2025-2026', semester: '春夏', realCurrentWeek: 2, lessonTimeConfigArray: ['08:00-08:45', '08:55-09:40'] },
        lessonArray: [{ dayOfWeek: 2, beginNumber: 1, length: 2, name: '线性代数', teacherName: '王五', location: '西2-101' }],
      },
    })],
  ];
}

test('URL：courses() 先取 fid，再带 courseType 等参数拉课程列表', async () => {
  const fetcher = recorder(await fullRoutes());
  const reader = new XxtReader(await makeClient(fetcher));
  const courses = await reader.courses();

  assert.equal(courses.length, 3);
  assert.equal(fetcher.calls.length, 2);
  assert.match(fetcher.calls[0].url, /^https:\/\/i\.chaoxing\.com\/base$/);
  const list = new URL(fetcher.calls[1].url);
  assert.equal(list.origin + list.pathname, 'https://mooc2-ans.chaoxing.com/mooc2-ans/visit/courselistdata');
  assert.equal(list.searchParams.get('courseType'), '1');
  assert.equal(list.searchParams.get('courseFid'), '427', 'fid 要从个人主页里取出来');
  assert.equal(list.searchParams.get('courseTeacherid'), '0');
  assert.equal(list.searchParams.get('courseOrderBy'), '0');
});

test('URL：courses() 有 5 分钟缓存，第二次不再发请求', async () => {
  const fetcher = recorder(await fullRoutes());
  const reader = new XxtReader(await makeClient(fetcher));
  await reader.courses();
  const before = fetcher.calls.length;
  await reader.courses();
  assert.equal(fetcher.calls.length, before);
  // fresh 必须绕开缓存
  await reader.courses({ fresh: true });
  assert.equal(fetcher.calls.length, before + 2);
});

test('URL：listCourses() 只回页面要的四个字段', async () => {
  const reader = new XxtReader(await makeClient(recorder(await fullRoutes())));
  const result = await reader.listCourses();
  assert.deepEqual(result.courses[0], {
    course_id: '241122334',
    class_id: '998877',
    name: '高等数学（甲）I',
    teacher: '张建国',
  });
});

test('URL：findCourse() 支持 id / 全名 / 部分名字，找不到报 COURSE_NOT_FOUND', async () => {
  const reader = new XxtReader(await makeClient(recorder(await fullRoutes())));
  assert.equal((await reader.findCourse('241122334')).name, '高等数学（甲）I');
  assert.equal((await reader.findCourse('高等数学（甲）I')).name, '高等数学（甲）I');
  assert.equal((await reader.findCourse('大学物理')).name, '大学物理 & 实验');
  await assert.rejects(
    () => reader.findCourse('不存在的课'),
    (error) => error.code === 'COURSE_NOT_FOUND',
  );
  await assert.rejects(
    () => reader.findCourse('  '),
    (error) => error.code === 'INVALID_ARGUMENT',
  );
});

test('URL：homework() 两跳，第二跳要带签名与时间戳', async () => {
  const fetcher = recorder(await fullRoutes());
  const reader = new XxtReader(await makeClient(fetcher));
  const [course] = await reader.courses();
  const result = await reader.homework(course);

  assert.deepEqual(result.progress, { done: 3, total: 5 });
  // courses() 已经用掉前两次请求（base + courselistdata），作业的两跳排在后面
  const middle = new URL(fetcher.calls[2].url);
  assert.equal(middle.origin + middle.pathname, 'https://mooc1.chaoxing.com/visit/stucoursemiddle');
  assert.equal(middle.searchParams.get('courseid'), '241122334');
  assert.equal(middle.searchParams.get('clazzid'), '998877');
  assert.equal(middle.searchParams.get('cpi'), '306112233');
  assert.equal(middle.searchParams.get('ismooc2'), '1');
  assert.equal(middle.searchParams.get('v'), '2');

  const list = new URL(fetcher.calls[3].url);
  assert.equal(list.origin + list.pathname, 'https://mooc1.chaoxing.com/mooc2/work/list');
  assert.equal(list.searchParams.get('courseId'), '241122334', '作业列表用驼峰参数名');
  assert.equal(list.searchParams.get('classId'), '998877');
  assert.equal(list.searchParams.get('ut'), 's');
  assert.equal(list.searchParams.get('enc'), 'ENC123', 'enc 来自中间页隐藏域');
  assert.equal(list.searchParams.get('openc'), 'OPEN1');
  assert.equal(list.searchParams.get('stuenc'), 'STU1');
  assert.equal(list.searchParams.get('isdisplaytable'), '2');
  assert.ok(Number(list.searchParams.get('t')) > 0, 't 是防重放的时间戳');
});

test('URL：homework() 缺 workEnc 时报 HOMEWORK_UNAVAILABLE（那是正常情况，不是错误）', async () => {
  const reader = new XxtReader(await makeClient(recorder(await fullRoutes({ workEnc: '' }))));
  const [course] = await reader.courses();
  await assert.rejects(
    () => reader.homework(course),
    (error) => error.code === 'HOMEWORK_UNAVAILABLE',
  );
});

test('URL：homework() 签名被拒时明确报 SIGNATURE_REJECTED', async () => {
  const routes = await fullRoutes();
  // 第 3 条路由就是作业列表（前两条是 base 与 courselistdata）
  routes.splice(3, 1, ['mooc2/work/list', () => html('没有此页面访问权限')]);
  const reader = new XxtReader(await makeClient(recorder(routes)));
  const [course] = await reader.courses();
  await assert.rejects(
    () => reader.homework(course),
    (error) => error.code === 'SIGNATURE_REJECTED',
  );
});

test('URL：listHomework() 去掉签名 URL、补 pending 字段', async () => {
  const reader = new XxtReader(await makeClient(recorder(await fullRoutes())));
  const result = await reader.listHomework({ course: '高等数学' });
  assert.equal(result.course, '高等数学（甲）I');
  assert.deepEqual(result.progress, { done: 3, total: 5 });
  assert.equal(result.homework.length, 5);
  assert.equal('url' in result.homework[0], false, '带签名的地址不该出现在响应里');
  assert.equal(result.homework[0].pending, true);
  assert.equal(result.homework[1].pending, false);
});

test('URL：exams() 打考试列表地址', async () => {
  const fetcher = recorder(await fullRoutes());
  const reader = new XxtReader(await makeClient(fetcher));
  const result = await reader.exams();
  assert.equal(result.exams.length, 2);
  assert.equal(fetcher.calls[0].url, XXT_ENDPOINTS.examList);
});

test('URL：notices() 用 POST 表单，13 个筛选字段一个不少', async () => {
  const fetcher = recorder(await fullRoutes());
  const reader = new XxtReader(await makeClient(fetcher));
  const result = await reader.notices();

  assert.equal(result.notices.length, 2);
  const call = fetcher.calls[0];
  assert.equal(call.method, 'POST');
  assert.equal(new URL(call.url).origin + new URL(call.url).pathname, XXT_ENDPOINTS.noticeList);
  const form = new URLSearchParams(String(call.body));
  for (const field of ['type', 'notice_type', 'lastValue', 'sort', 'folderUUID', 'kw',
    'startTime', 'endTime', 'gKw', 'gName', 'year', 'tag', 'fidsCode',
    'filterSenderPuids', 'filterTags']) {
    assert.equal(form.has(field), true, `缺字段 ${field} 会被服务端当成条件缺失`);
  }
  assert.equal(form.get('lastValue'), '', '首页游标为空');
  assert.match(String(call.headers['Content-Type'] ?? ''), /x-www-form-urlencoded/);
});

test('URL：notices() 的 unread_only / keyword / limit 都是本地过滤', async () => {
  const reader = new XxtReader(await makeClient(recorder(await fullRoutes())));
  const unread = await reader.notices({ unread_only: true });
  assert.deepEqual(unread.notices.map((n) => n.title), ['未读一']);
  const hit = await reader.notices({ keyword: '已读' });
  assert.deepEqual(hit.notices.map((n) => n.title), ['已读二']);
  const limited = await reader.notices({ limit: 1 });
  assert.equal(limited.notices.length, 1);
});

test('URL：notices() 回非 JSON 时报 SCHEMA_CHANGED，不是"没有通知"', async () => {
  const reader = new XxtReader(await makeClient(recorder([
    ['getNoticeList', () => html('<html>换版了</html>')],
  ])));
  await assert.rejects(
    () => reader.notices(),
    (error) => error.code === 'SCHEMA_CHANGED',
  );
});

test('URL：notices() 业务失败（status 为假）报 PLATFORM_REJECTED', async () => {
  const reader = new XxtReader(await makeClient(recorder([
    ['getNoticeList', () => json({ status: false })],
  ])));
  await assert.rejects(
    () => reader.notices(),
    (error) => error.code === 'PLATFORM_REJECTED',
  );
});

test('URL：schedule() 不传 week 时只发空表单', async () => {
  const fetcher = recorder(await fullRoutes());
  const reader = new XxtReader(await makeClient(fetcher));
  const result = await reader.schedule();
  assert.equal(result.week, 2);
  assert.equal(result.lessons[0].course, '线性代数');
  assert.equal(fetcher.calls[0].method, 'POST');
  assert.equal(new URL(fetcher.calls[0].url).pathname, '/pc/curriculum/getMyLessons');
  assert.equal(String(fetcher.calls[0].body), '', '不传 week 时不带 week 字段');
});

test('URL：schedule() 传 week 时写进表单', async () => {
  const fetcher = recorder(await fullRoutes());
  const reader = new XxtReader(await makeClient(fetcher));
  assert.equal((await reader.schedule({ week: 8 })).week, 8);
  assert.equal(new URLSearchParams(String(fetcher.calls[0].body)).get('week'), '8');
});

test('URL：schedule() 的 result 不是 1 时报 PLATFORM_REJECTED', async () => {
  const reader = new XxtReader(await makeClient(recorder([
    ['getMyLessons', () => json({ result: 0 })],
  ])));
  await assert.rejects(
    () => reader.schedule(),
    (error) => error.code === 'PLATFORM_REJECTED',
  );
});

/* ══════════════════════════════════════ 截止时间聚合 */

test('聚合：只列未完成，按 DDL 排序（要做的 → 过期的 → 无 DDL）', async () => {
  const workList = await fixture('xxt-worklist.html');
  const routes = [
    ['i.chaoxing.com/base', () => html('<script>var fid = \'427\';</script>')],
    ['courselistdata', async () => html(await fixture('xxt-courselist.html'))],
    ['stucoursemiddle', () => html('<input id="workEnc" value="E"><input id="openc" value="O"><input id="enc" value="S">')],
    ['mooc2/work/list', () => html(workList)],
    // 两条未完成的作业：一条未来、一条过去
    ['workId=7001', () => html('<div>作业详情 未来 题量：10 满分：100 作答时间：04-10 08:00 至 04-20 23:59</div>')],
    // 第 4 条状态为空 → 也算待完成，且详情里没有作答时间 → deadline 为 null
    ['workId=7004', () => html('<div>作业详情 无时间</div>')],
  ];
  const reader = new XxtReader(await makeClient(recorder(routes)), {
    now: () => new Date('2026-04-01T00:00:00+08:00'),
  });
  const result = await reader.deadlines({ course: '高等数学' });

  assert.equal(result.courses_scanned, 1);
  assert.equal(result.complete, true);
  assert.deepEqual(result.errors, []);
  // 只有两条是"未完成"的（已完成的 3 条不能出现）
  assert.deepEqual(result.items.map((item) => item.title), ['第三章 定积分 习题', '第四章 级数']);
  assert.equal(result.items[0].deadline, '2026-04-20T23:59:00+08:00');
  assert.equal(result.items[1].deadline, null);
  assert.match(result.note, /只列未完成的作业/);
});

test('聚合：horizon_days 之外的不输出', async () => {
  const routes = [
    ['i.chaoxing.com/base', () => html('<script>var fid = \'427\';</script>')],
    ['courselistdata', async () => html(await fixture('xxt-courselist.html'))],
    ['stucoursemiddle', () => html('<input id="workEnc" value="E">')],
    ['mooc2/work/list', async () => html(await fixture('xxt-worklist.html'))],
    // 今天 = 04-01：7001 在 19 天后，7004 在 4 天后
    ['workId=7001', () => html('<div>作业详情 X 题量：1 满分：10 作答时间：03-25 08:00 至 04-20 23:59</div>')],
    ['workId=7004', () => html('<div>作业详情 Y 题量：1 满分：10 作答时间：03-25 08:00 至 04-05 23:59</div>')],
  ];
  const reader = new XxtReader(await makeClient(recorder(routes)), {
    now: () => new Date('2026-04-01T00:00:00+08:00'),
  });
  // 只看一门课：三门课会命中同一份夹具作业列表，混在一起断言不出分布
  const result = await reader.deadlines({ course: '高等数学', horizon_days: 10 });
  // 04-20 在 10 天之外 → 被丢掉；04-05 在范围内 → 保留
  assert.deepEqual(result.items.map((item) => item.title), ['第四章 级数']);
  assert.equal(result.items[0].deadline, '2026-04-05T23:59:00+08:00');

  // horizon 放宽后 04-20 那条要回来，并且排在后面（更晚）
  const wide = await reader.deadlines({ course: '高等数学', horizon_days: 90 });
  assert.deepEqual(wide.items.map((item) => item.title), ['第四章 级数', '第三章 定积分 习题']);
});

test('聚合：没开作业功能的课不算错误，其他失败记进 errors 并标 complete:false', async () => {
  const routes = [
    ['i.chaoxing.com/base', () => html('<script>var fid = \'427\';</script>')],
    ['courselistdata', async () => html(await fixture('xxt-courselist.html'))],
    // 只有第一门课（courseid=241122334）的中间页有作业签名；另外两门课没有
    // → HOMEWORK_UNAVAILABLE，那是"这门课没有作业"，不是错误
    ['stucoursemiddle', (url) => html(String(url).includes('courseid=241122334')
      ? '<input id="workEnc" value="E"><input id="openc" value="O"><input id="enc" value="S">'
      : '<div>这门课只有资料，没有作业</div>')],
    ['mooc2/work/list', async () => html(await fixture('xxt-worklist.html'))],
    ['workId=7001', () => new Response('boom', { status: 500 })],
    ['workId=7004', () => html('<div>作业详情 Y 题量：1 满分：10 作答时间：04-10 08:00 至 04-05 23:59</div>')],
  ];
  const reader = new XxtReader(await makeClient(recorder(routes)), {
    now: () => new Date('2026-04-01T00:00:00+08:00'),
  });
  const result = await reader.deadlines();
  assert.equal(result.courses_scanned, 3);
  assert.equal(result.complete, false);
  // 只有一条详情 500 → 记一次错误；另外两门课"没有作业功能"不进 errors
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].course, '高等数学（甲）I');
  assert.equal(result.errors[0].error.code, 'PLATFORM_ERROR');
  assert.deepEqual(result.errors[0].error.details, {
    http_status: 500,
    endpoint: '/mooc2/work/doHomeWorkNew',
  });
  // 读不到详情的作业仍然**保留**在列表里（deadline 为 null）：
  // 它确实还没做，把它吞掉等于告诉用户"你没有这项作业"。
  assert.deepEqual(result.items.map((item) => item.title), ['第四章 级数', '第三章 定积分 习题']);
  assert.equal(result.items[0].deadline, '2026-04-05T23:59:00+08:00');
  assert.equal(result.items[1].deadline, null);
});

test('聚合：参数校验', async () => {
  const reader = new XxtReader(await makeClient(recorder(await fullRoutes())));
  await assert.rejects(() => reader.deadlines({ horizon_days: -1 }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => reader.deadlines({ max_courses: 0 }), (e) => e.code === 'INVALID_ARGUMENT');
});

/* ══════════════════════════════════════ 客户端：会话、错误映射 */

test('客户端：没有 Cookie 时报 COOKIE_IMPORT_REQUIRED，且文案里没有 pbpaste', async () => {
  const client = new XxtClient({ session: new SessionStore({}), fetch: recorder([]), env: {} });
  const status = await client.status();
  assert.deepEqual(status, { configured: false, source: null });
  await assert.rejects(
    () => client.get(XXT_ENDPOINTS.base),
    (error) => {
      assert.equal(error.code, 'COOKIE_IMPORT_REQUIRED');
      assert.equal(/pbpaste|npm run cli/.test(error.message), false, 'Windows 上不能出现 macOS 命令');
      assert.match(error.message, /导入一次 Cookie/);
      return true;
    },
  );
  assert.equal(/pbpaste/.test(XXT_SETUP), false);
  assert.equal(/xxt-cookie/.test(XXT_SETUP), false);
});

test('客户端：importCookie 存会话并按必需键报告缺口', async () => {
  const client = new XxtClient({ session: new SessionStore({}), fetch: recorder([]), env: {} });
  const result = await client.importCookie('Cookie: UID=1; _uid=2; fid=3');
  assert.equal(result.source, '请求头');
  assert.deepEqual(result.cookie_names, ['UID', '_uid', 'fid']);
  assert.deepEqual(result.missing_required, []);
  assert.deepEqual(await client.status(), {
    configured: true,
    source: 'session',
    cookie_names: ['UID', '_uid', 'fid'],
    missing_required: [],
  });

  // 缺 fid 时要如实报出来（否则表现为"导入了但读不到"）
  const partial = new XxtClient({ session: new SessionStore({}), fetch: recorder([]), env: {} });
  assert.deepEqual((await partial.importCookie('UID=1; _uid=2')).missing_required, ['fid']);
});

test('客户端：识别不出 Cookie 时报 INVALID_ARGUMENT', async () => {
  const client = new XxtClient({ session: new SessionStore({}), fetch: recorder([]), env: {} });
  await assert.rejects(
    () => client.importCookie('这里什么都没有'),
    (error) => error.code === 'INVALID_ARGUMENT',
  );
});

test('客户端：环境变量 CHAOXING_COOKIE 优先于已存会话，且不写进会话文件', async () => {
  const fetcher = recorder([['i.chaoxing.com/base', () => html('<html>个人主页</html>')]]);
  const client = await makeClient(fetcher, { CHAOXING_COOKIE: 'UID=999; _uid=888; fid=777' });
  const status = await client.status();
  assert.equal(status.source, 'environment');
  assert.deepEqual(status.cookie_names, ['UID', '_uid', 'fid']);

  await client.get(XXT_ENDPOINTS.base);
  // 发出去的必须是环境变量那份（999），不是罐里的 111
  assert.match(String(fetcher.calls[0].headers.Cookie ?? ''), /UID=999/);
  // 环境变量那份是内存罐，落盘会话里还是原来那份
  assert.match(String((await storedCookieNames(client.session.jar)).join(',')), /UID/);
});

test('客户端：跳转到登录域 → COOKIE_EXPIRED', async () => {
  const client = await makeClient(recorder([
    ['i.chaoxing.com/base', () => new Response('', {
      status: 302,
      headers: { location: 'https://passport2.chaoxing.com/login?fid=&refer=' },
    })],
  ]));
  await assert.rejects(
    () => client.get(XXT_ENDPOINTS.base),
    (error) => error.code === 'COOKIE_EXPIRED',
  );
});

test('客户端：其他 3xx → UNEXPECTED_RESPONSE，403 → FORBIDDEN，5xx → PLATFORM_ERROR', async () => {
  const redirect = await makeClient(recorder([
    ['i.chaoxing.com/base', () => new Response('', { status: 302, headers: { location: 'https://mooc1.chaoxing.com/x' } })],
  ]));
  await assert.rejects(() => redirect.get(XXT_ENDPOINTS.base), (e) => e.code === 'UNEXPECTED_RESPONSE');

  const forbidden = await makeClient(recorder([
    ['i.chaoxing.com/base', () => new Response('no', { status: 403 })],
  ]));
  await assert.rejects(() => forbidden.get(XXT_ENDPOINTS.base), (e) => e.code === 'FORBIDDEN');

  const broken = await makeClient(recorder([
    ['i.chaoxing.com/base', () => new Response('boom', { status: 500 })],
  ]));
  await assert.rejects(
    () => broken.get(XXT_ENDPOINTS.base),
    (e) => e.code === 'PLATFORM_ERROR' && e.details.http_status === 500,
  );
});

test('客户端：回登录页 HTML → COOKIE_EXPIRED；但 JSON 里的"用户登录"不算', async () => {
  const asPage = await makeClient(recorder([
    ['i.chaoxing.com/base', () => html('<html><title>用户登录</title></html>')],
  ]));
  await assert.rejects(() => asPage.get(XXT_ENDPOINTS.base), (e) => e.code === 'COOKIE_EXPIRED');

  // 通知正文里出现"用户登录"四个字是正常数据，不能判成失效
  const asJson = await makeClient(recorder([
    ['getNoticeList', () => json({ status: true, notices: { list: [{ title: '用户登录异常提醒', isread: 0 }] } })],
  ]));
  const result = await new XxtReader(asJson).notices();
  assert.equal(result.notices.length, 1);
});

test('客户端：只允许 https 的 chaoxing.com，其他一律 INVALID_PATH', async () => {
  const client = await makeClient(recorder([]));
  await assert.rejects(() => client.get('https://evil.com/base'), (e) => e.code === 'INVALID_PATH');
  await assert.rejects(() => client.get('https://evilchaoxing.com/base'), (e) => e.code === 'INVALID_PATH');
  await assert.rejects(() => client.get('http://i.chaoxing.com/base'), (e) => e.code === 'INVALID_PATH');
});

test('客户端：checkLogin 把 Cookie 类错误收敛成 authenticated:false', async () => {
  const ok = await makeClient(recorder([['i.chaoxing.com/base', () => html('<html>主页</html>')]]));
  assert.deepEqual(await ok.checkLogin(), { authenticated: true });

  const expired = await makeClient(recorder([
    ['i.chaoxing.com/base', () => html('<html>用户登录</html>')],
  ]));
  assert.deepEqual(await expired.checkLogin(), { authenticated: false, reason: 'COOKIE_EXPIRED' });

  const missing = new XxtClient({ session: new SessionStore({}), fetch: recorder([]), env: {} });
  assert.deepEqual(await missing.checkLogin(), { authenticated: false, reason: 'COOKIE_IMPORT_REQUIRED' });
});

test('客户端：withQuery 用 URL 语义拼参数（中文与 & 不破坏查询串）', () => {
  assert.equal(
    withQuery('https://i.chaoxing.com/base', { kw: '高数 & 线代', skip: null, undef: undefined }),
    'https://i.chaoxing.com/base?kw=%E9%AB%98%E6%95%B0+%26+%E7%BA%BF%E4%BB%A3',
  );
});

/* ══════════════════════════════════════ 路由与插件形状 */

test('插件形状：name / inject 与路由常量', () => {
  assert.equal(name, 'zhiyun-xxt');
  assert.deepEqual(inject, ['profileContext']);
  assert.equal(ROUTE_PATH, '/api/zhiyun-xxt');
});

test('方法白名单：9 个只读方法，一个不多一个不少', () => {
  assert.deepEqual([...XXT_METHODS], [
    'courses', 'listCourses', 'findCourse', 'homework', 'listHomework',
    'deadlines', 'exams', 'notices', 'schedule',
  ]);
  // 读取器上确实有这些方法（白名单不能是空名单）
  const reader = new XxtReader({ get: async () => '', post: async () => '' });
  for (const method of XXT_METHODS) assert.equal(typeof reader[method], 'function', method);
});

test('方法名：允许省略前缀，拒绝别的平台前缀', () => {
  assert.equal(splitMethod('xxt.deadlines'), 'deadlines');
  assert.equal(splitMethod('deadlines'), 'deadlines');
  assert.throws(() => splitMethod('zdbk.timetable'), (e) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => splitMethod(''), (e) => e.code === 'INVALID_ARGUMENT');
});

test('错误形状：describeError 只回 code / message / details', () => {
  const shaped = describeError(new ClassroomError('SIGNATURE_REJECTED', '签名失效', { http_status: 403 }));
  assert.deepEqual(shaped, {
    code: 'SIGNATURE_REJECTED',
    message: '签名失效',
    details: { http_status: 403 },
  });
  // 非 Error 也要有稳定形状（不能把 undefined 塞进响应）
  const raw = describeError('炸了');
  assert.equal(raw.code, 'INTERNAL_ERROR');
  assert.equal(raw.message, '炸了');
  assert.deepEqual(raw.details, {});
});

test('读取器构造：缺 get/post 的门面直接报 CONFIG', () => {
  assert.throws(() => new XxtReader({}), (e) => e.code === 'CONFIG');
});

test('通知 / 课表参数校验', async () => {
  const reader = new XxtReader(await makeClient(recorder(await fullRoutes())));
  await assert.rejects(() => reader.notices({ limit: 0 }), (e) => e.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => reader.schedule({ week: 0 }), (e) => e.code === 'INVALID_ARGUMENT');
});


