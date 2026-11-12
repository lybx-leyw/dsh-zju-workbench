/**
 * 学习通**新增能力**的 source 层测试（审计 B-1 的七条里，source 侧补的那部分）。
 *
 * # 与 `tests/source/xxt/xxt.test.mjs` 的分工
 *
 * 那一份钉的是「移植过来的行为没被改坏」；这一份钉的是**这一次补的东西**：
 *
 * | 能力 | 这里钉什么 |
 * | --- | --- |
 * | `chapter list` | 每节下挂课件/视频的聚合形状；锁住的节进 `notOpen` |
 * | `material list` | **资料栏**被读到了；两条通路按 `objectId` 合并、大小取章节的准确值 |
 * | `video list` | 按扩展名判类型（含 `rmvb` / `ts` 这类老格式），音频不算视频 |
 * | `material/video download` | **真落盘**：目录、分章子目录、重名加编号、播放版另起名、复用、只下某一节 |
 * | `homework list` | **三个来源**都读到；按「课程 + 标题」去重；单课作业栏没开不算失败 |
 *
 * # 全离线
 *
 * 客户端是假的（`get` / `post` / `redirect` / `stream` 都由测试给），落盘走真文件系统
 * 但目录是 `mkdtemp` 出来的临时目录 —— 跑完删掉。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { XxtReader } from '../../../packages/source/xxt/src/reads.js';
import {
  chapterScope,
  folderScope,
  groupBySection,
  inData,
  kindOf,
  localName,
  pickFiles,
  safeFileName,
  splitPhrases,
  variantName,
  resolveCourse,
} from '../../../packages/source/xxt/src/files.js';
import {
  beijingMinute,
  fromWorkRow,
  homeworkKind,
  parseStuWork,
  parseTaskKey,
  parseTaskList,
  parseTaskPlans,
} from '../../../packages/source/xxt/src/parse.js';
import { XXT_ENDPOINTS } from '../../../packages/source/xxt/src/hosts.js';

/* ══════════════════════════════════════ 夹具 */

/** 一门课在课程列表页里的卡片。 */
const COURSE_HTML = '<a href="https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=111&clazzid=222&cpi=333">'
  + '<span class="course-name" title="大学物理">大学物理</span></a>';
const COURSE_HTML_2 = '<a href="https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=999&clazzid=888&cpi=777">'
  + '<span class="course-name" title="线性代数">线性代数</span></a>';

/** 两章三节，其中第三节标了未解锁。 */
const CHAPTERS_HTML = `
<div class="chapter_unit">
  <div class="catalog_name">第一章 绪论</div>
  <ul>
    <li><div id="cur101"><span class="catalog_sbar">1.1</span><a class="clicktitle" title="测量基础">测量基础</a></div></li>
    <li><div id="cur102"><span class="catalog_sbar">1.2</span><a class="clicktitle" title="等厚干涉">等厚干涉</a></div></li>
  </ul>
</div>
<div class="chapter_unit">
  <div class="catalog_name">第二章 进阶</div>
  <ul>
    <li><div id="cur201"><span class="catalog_sbar">2.1</span><a class="clicktitle" title="锁住的一节">锁住的一节</a>
      <span class="bntHoverTips">需解锁后查看</span></div></li>
  </ul>
</div>`;

/** 造一段卡片 HTML（`mArg = {attachments:[…]}`）。 */
function cardsHtml(attachments) {
  return `<script>mArg = ${JSON.stringify({ attachments: attachments.map((a) => ({ property: a })) })};</script>`;
}

/** 造一行资料栏条目。 */
function dataRowHtml({ name, type = 'pdf', dataId = '1', objectId = '', enc = '', size = '14KB', downloadable = true, folder = false }) {
  const call = `toOpen('${name}','${type}','${dataId}','','${objectId}','0','0','0','0','${enc}')`;
  return `<ul class="dataBody_td" id="${dataId}" dataname="${name}" type="${folder ? 'afolder' : type}"`
    + ` objectid="${objectId}" isdown="${downloadable ? '1' : '0'}" onclick="${call}">`
    + `<li class="dataBody_name_stu">${name}</li><li class="dataBody_size_stu">${size}</li></ul>`;
}

const dataListHtml = (rows, totalPages = 1) => `<html><body>${rows.join('')}<input id="totalPages" value="${totalPages}"></body></html>`;

/**
 * 造一个假客户端。
 *
 * `stream` 是**下载**那条通路：它要回一个带 `body` 的 `Response`，由 `download.js`
 * 流式写盘。这里按 `routes` 里给的内容生成真 Response。
 */
function fakeClient({ routes = [], files = {} } = {}) {
  const calls = [];
  const match = (url, method) => {
    for (const [fragment, handler] of routes) {
      if (String(url).includes(fragment) && (!handler.method || handler.method === method)) return handler;
    }
    return undefined;
  };
  return {
    calls,
    async get(url, query, options) {
      calls.push({ method: 'GET', url: String(url), query, options });
      const handler = match(url, 'GET');
      return handler ? handler.run(url, query) : '';
    },
    async post(url, form, options) {
      calls.push({ method: 'POST', url: String(url), form, options });
      const handler = match(url, 'POST');
      return handler ? handler.run(url, form) : '';
    },
    async redirect(url, options) {
      calls.push({ method: 'REDIRECT', url: String(url), query: options?.query });
      const handler = match(url, 'REDIRECT');
      if (!handler) throw Object.assign(new Error('没有跳转'), { code: 'REJECTED' });
      return handler.run(url, options?.query);
    },
    async stream(url, options) {
      calls.push({ method: 'STREAM', url: String(url), options });
      const body = files[url];
      if (body == null) {
        return {
          response: new Response('not found', { status: 404 }),
          release: () => {},
          signal: new AbortController().signal,
        };
      }
      return {
        response: new Response(body, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream', 'content-length': String(body.length) },
        }),
        release: () => {},
        signal: new AbortController().signal,
      };
    },
  };
}

const route = (fragment, run, method) => [fragment, { run, method }];

/** 一套完整的课程夹具：课程列表 + 章节 + 卡片 + 资料栏。 */
function fullRoutes({ cards = {}, dataRows: dataPage } = {}) {
  return [
    route('i.chaoxing.com/base', () => "<script>var fid = '427';</script>"),
    route('courselistdata', () => `${COURSE_HTML}${COURSE_HTML_2}`),
    route('studentcourse', () => CHAPTERS_HTML),
    route('stucoursemiddle', () => '<input id="enc" value="STUENC">'),
    route('knowledge/cards', (url, query) => {
      const key = `${query.knowledgeid}:${query.num}`;
      if (cards[key] !== undefined) return cards[key];
      return '<html>没有卡片</html>';
    }),
    route('stu-datalist', () => (dataPage ? dataPage() : dataListHtml([]))),
  ];
}

/** 造一个读取器（临时下载目录，调用方负责清）。 */
async function readerWith(client, { downloadDir } = {}) {
  return new XxtReader(client, {
    now: () => new Date('2026-04-01T00:00:00+08:00'),
    downloadDir,
  });
}

/* ══════════════════════════════════════ 纯函数：类型与名称 */

test('kindOf：视频含老格式，音频单独一类，其余是文档', () => {
  for (const name of ['a.mp4', 'b.rmvb', 'c.ts', 'd.flv', 'e.f4v', 'f.MKV']) {
    assert.equal(kindOf(name), 'video', name);
  }
  assert.equal(kindOf('听力.mp3'), 'audio', '音频不是视频 —— 混进视频清单会让「有几个视频」永远偏大');
  assert.equal(kindOf('讲义.pdf'), 'document');
  // 没有扩展名的按文档处理：附件名经常是「第一章作业」这种
  assert.equal(kindOf('第一章作业'), 'document');
});

test('splitPhrases：竖线、顿号、逗号、分号、换行都算分隔，去重不分全半角', () => {
  assert.deepEqual(splitPhrases('讲义.pdf|课件.ppt'), ['讲义.pdf', '课件.ppt']);
  assert.deepEqual(splitPhrases('Ａ.pdf、a.pdf'), ['Ａ.pdf'], '全半角不同写法算同一个');
  assert.deepEqual(splitPhrases('  '), []);
  assert.deepEqual(splitPhrases('甲，乙；丙\n丁'), ['甲', '乙', '丙', '丁']);
});

test('pickFiles：全名、去扩展名、名字里的一段都认；歧义要抛而不是取第一个', () => {
  const files = [
    { name: '1.1.pdf', objectId: 'a'.repeat(32) },
    { name: '1.2.pdf', objectId: 'b'.repeat(32) },
    { name: '实验报告.docx', objectId: 'c'.repeat(32) },
  ];
  assert.equal(pickFiles(files, ['1.2.pdf'])[0].objectId, 'b'.repeat(32));
  assert.equal(pickFiles(files, ['1.2'])[0].objectId, 'b'.repeat(32), '不带扩展名也认');
  assert.equal(pickFiles(files, ['实验报告'])[0].objectId, 'c'.repeat(32), '名字里的一段也认');
  // `.pdf` 命中两个 → 必须抛候选，不能默默给第一个
  assert.throws(() => pickFiles(files, ['.pdf']), (error) => {
    assert.equal(error.code, 'NEEDS_USER');
    assert.equal(error.details.candidates.length, 2);
    return true;
  });
});

test('safeFileName：去掉 Windows 保留字符与控制字符，保留扩展名', () => {
  assert.equal(safeFileName('第1章/讲义.pdf'), '第1章_讲义.pdf');
  assert.equal(safeFileName('a:b*c?.txt'), 'a_b_c_.txt');
  assert.equal(safeFileName('结尾有点...'), '结尾有点');
  assert.equal(safeFileName('   '), '未命名');
});

test('localName：同一位置重名时加编号，不重名时原样', () => {
  const one = { name: '作业.pdf', location: ['第一章'], objectId: 'a'.repeat(32) };
  const two = { name: '作业.pdf', location: ['第一章'], objectId: 'b'.repeat(32) };
  const other = { name: '作业.pdf', location: ['第二章'], objectId: 'c'.repeat(32) };
  const all = [one, two, other];
  assert.equal(localName(one, all), '作业 (aaaaaa).pdf');
  assert.equal(localName(other, all), '作业.pdf', '不同章节不算重名（它们落在不同目录）');
});

test('variantName：播放版与预览 PDF 另起名字，不顶替原文件', () => {
  assert.equal(variantName('第一讲.mp4', 'original'), '第一讲.mp4');
  assert.equal(variantName('第一讲.mp4', 'playback'), '第一讲（播放版）.mp4');
  assert.equal(variantName('讲义.docx', 'preview'), '讲义.docx.pdf');
  assert.equal(variantName('已有.pdf', 'preview'), '已有.pdf');
});

/* ══════════════════════════════════════ 纯函数：章节与文件夹范围 */

const CHAPTERS = [
  { id: '101', title: '1.1 测量基础', path: ['第一章 绪论', '1.1 测量基础'], locked: false },
  { id: '102', title: '1.2 等厚干涉', path: ['第一章 绪论', '1.2 等厚干涉'], locked: false },
  { id: '201', title: '2.1 锁住的一节', path: ['第二章 进阶', '2.1 锁住的一节'], locked: true },
];

test('chapterScope：写大章命中它下面的全部节', () => {
  const scope = chapterScope(CHAPTERS, '第一章');
  assert.deepEqual(scope.chapters.map((item) => item.id), ['101', '102']);
  assert.deepEqual(scope.prefix, ['第一章 绪论']);
});

test('chapterScope.keep：范围要真的收窄 —— 同组之外的文件、资料栏的文件都不算', () => {
  // ⚠️ 这一条单独写，是因为「只断言 chapters」测不到收窄：把 keep 改成
  // `() => file.source === 'chapter'`（完全不看位置）时，只断言 chapters 的
  // 那几条仍然是绿的 —— 而实际上「只下这一节」会变成「下整门课的章节文件」。
  const scope = chapterScope(CHAPTERS, '等厚干涉');
  const inScope = { name: 'a.pdf', location: ['第一章 绪论', '1.2 等厚干涉'], source: 'chapter' };
  const otherSection = { name: 'b.pdf', location: ['第一章 绪论', '1.1 测量基础'], source: 'chapter' };
  const otherChapter = { name: 'c.pdf', location: ['第二章 进阶', '2.1 锁住的一节'], source: 'chapter' };
  // 位置恰好长得像这一节，但它是资料栏读出来的 —— 两条通路不能混
  const fromData = { name: 'd.pdf', location: ['第一章 绪论', '1.2 等厚干涉'], source: 'data' };

  assert.equal(scope.keep(inScope), true);
  assert.equal(scope.keep(otherSection), false, '同章别的节不算这个范围');
  assert.equal(scope.keep(otherChapter), false, '别的章不算这个范围');
  assert.equal(scope.keep(fromData), false, '资料栏的文件不属于章节范围');

  // 写大章时它下面的所有节都在范围内
  const broad = chapterScope(CHAPTERS, '第一章');
  assert.equal(broad.keep(otherSection), true);
  assert.equal(broad.keep(otherChapter), false);
});

test('chapterScope：写节标题只命中那一节，写整条 location 也一样', () => {
  assert.deepEqual(chapterScope(CHAPTERS, '等厚干涉').chapters.map((item) => item.id), ['102']);
  assert.deepEqual(chapterScope(CHAPTERS, '第一章 绪论 / 1.2 等厚干涉').chapters.map((item) => item.id), ['102']);
});

test('chapterScope：对不上时给 undefined（让调用方再去试资料栏）', () => {
  assert.equal(chapterScope(CHAPTERS, '资料'), undefined);
  assert.equal(chapterScope(CHAPTERS, '完全不存在的章节'), undefined);
});

test('chapterScope：只差一两个字的标题能对上（实验课表「测定」vs「测量」）', () => {
  const near = [{ id: '1', title: '金属线胀系数的测定', path: ['实验', '金属线胀系数的测定'] }];
  const scope = chapterScope(near, '金属线胀系数的测量');
  assert.equal(scope?.chapters[0].id, '1');
});

test('folderScope：只认资料栏的文件；写「资料」就是整个资料栏', () => {
  const files = [
    { name: 'a.pdf', location: ['资料', '第一章'], source: 'data' },
    { name: 'b.pdf', location: ['第一章 绪论', '1.1'], source: 'chapter' },
    { name: 'c.pdf', location: ['资料'], source: 'data' },
  ];
  const keep = folderScope(files, '资料');
  assert.deepEqual(files.filter(keep).map((file) => file.name), ['a.pdf', 'c.pdf']);
  const inner = folderScope(files, '第一章');
  assert.deepEqual(files.filter(inner).map((file) => file.name), ['a.pdf']);
  assert.equal(folderScope(files, '不存在'), undefined);
});

test('inData：课程自己有一章叫「资料」时，那个词指的是章节而不是资料栏', () => {
  assert.equal(inData(CHAPTERS, '资料'), true);
  assert.equal(inData(CHAPTERS, '资料 / 课件'), true);
  const named = [{ id: '1', title: '资料', path: ['资料'] }];
  assert.equal(inData(named, '资料'), false, '这种课里按资料栏解释会读到另一个地方去');
});

test('groupBySection：按 location 分组，视频与课件分开，音频归课件', () => {
  const sections = groupBySection([
    { name: 'a.pdf', kind: 'document', location: ['第一章', '1.1'], size: 10 },
    { name: 'b.mp4', kind: 'video', location: ['第一章', '1.1'], size: 20 },
    { name: 'c.mp3', kind: 'audio', location: ['第一章', '1.1'], size: 30 },
    { name: 'd.docx', kind: 'document', location: ['资料'], size: 40 },
  ]);
  assert.equal(sections.length, 2);
  assert.equal(sections[0].location, '第一章 / 1.1');
  assert.deepEqual(sections[0].materials.map((item) => item.name), ['a.pdf', 'c.mp3']);
  assert.deepEqual(sections[0].videos.map((item) => item.name), ['b.mp4']);
  // location 保持数组（页面按它取层级），另给可复制的 locationText
  assert.deepEqual(sections[0].path, ['第一章', '1.1']);
  assert.equal(sections[0].materials[0].locationText, '第一章 / 1.1');
});

test('resolveCourse：课程页链接、id、全名、简称都认；不是本人课程的链接要拒', () => {
  const courses = [
    { name: '大学物理', teacher: '李', courseid: '111', clazzid: '222', cpi: '333' },
    { name: '线性代数', teacher: '王', courseid: '999', clazzid: '888', cpi: '777' },
  ];
  assert.equal(resolveCourse(courses, '111').name, '大学物理');
  assert.equal(resolveCourse(courses, '线性代数').courseid, '999');
  assert.equal(resolveCourse(courses, '线代').courseid, '999', '简称按字序命中');
  assert.equal(
    resolveCourse(courses, 'https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=999&clazzid=888&cpi=777').courseid,
    '999',
    '课程页链接是无歧义的写法',
  );
  assert.throws(
    () => resolveCourse(courses, 'https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3'),
    (error) => error.code === 'COURSE_NOT_FOUND',
  );
});

/* ══════════════════════════════════════ 纯函数：作业 */

test('parseTaskPlans：只取 planType 4 的当作业，其余项只数「还剩几项」', () => {
  const standard = {
    userTaskQualifyDTO: {
      passStandardCalcResultDTOList: [
        { planUserBO: { finish: 0, plan: { planType: 4, name: '第三章习题', introduce: '<b>做完</b>', startDate: '2026-04-01T00:00:00Z', endDate: '2026-04-10T15:59:00Z' } } },
        { planUserBO: { finish: 1, plan: { planType: 1, name: '看视频' } } },
        { planUserBO: { finish: 0, plan: { planType: 1, name: '讨论' } } },
      ],
    },
  };
  const plans = parseTaskPlans(standard);
  assert.equal(plans.plans.length, 1);
  assert.equal(plans.plans[0].title, '第三章习题');
  assert.equal(plans.plans[0].requirement, '做完', '要求是富文本，要拍平');
  assert.equal(plans.plans[0].done, false);
  assert.equal(plans.otherLeft, 1, '没做完的非作业项');
});

test('parseTaskPlans：结构不对时报 SCHEMA_CHANGED，不静默当作「没有作业」', () => {
  assert.throws(() => parseTaskPlans({}), (error) => error.code === 'SCHEMA_CHANGED');
});

test('parseTaskList：接口说「没有任务」不算错，结构不对才算', () => {
  assert.deepEqual(parseTaskList({ result: 0 }), { available: false, tasks: [], malformed: false });
  assert.deepEqual(parseTaskList({ result: 1, data: 'oops' }), { available: true, tasks: [], malformed: true });
  const ok = parseTaskList({ result: 1, data: [{ id: 7, name: '第 3 周', planCount: 5, planFinishCount: 2 }] });
  assert.equal(ok.available, true);
  assert.equal(ok.tasks[0].id, '7');
  assert.equal(ok.tasks[0].name, '第 3 周');
  assert.equal(ok.tasks[0].total, 5);
  // 没有 id 的任务读不了明细，直接丢掉
  assert.deepEqual(parseTaskList({ result: 1, data: [{ name: '没有 id' }] }).tasks, []);
});

test('parseTaskKey：从中间页脚本里取加密的任务编号', () => {
  assert.equal(parseTaskKey('<script>const eTaskUserId = "abc123";</script>'), 'abc123');
  assert.equal(parseTaskKey('<html>换版了</html>'), '', '取不到给空串，让调用方报结构错误');
});

test('parseStuWork：只认带《课程》的行，剩余时间折成分钟', () => {
  const html = `
<ul>
  <li><p>第三章习题</p><span>未提交</span><span>《大学物理》</span><span>剩余 1天 2小时 30分钟</span></li>
  <li><p>分组标题</p></li>
  <li><p>第四章</p><span>已完成</span><span>《大学物理》</span><span>剩余 3小时</span></li>
</ul>`;
  const rows = parseStuWork(html);
  assert.equal(rows.length, 2, '第二个 li 没有课程名，是分组标题');
  assert.deepEqual(rows[0], {
    title: '第三章习题', status: '未提交', course: '大学物理',
    leftMinutes: 1 * 1440 + 2 * 60 + 30,
  });
  assert.equal(rows[1].status, '已完成');
});

test('fromWorkRow：剩余分钟数按整分钟往上补成绝对时间（页面是向下取整的）', () => {
  const now = Date.parse('2026-04-01T00:00:00+08:00');
  const row = fromWorkRow({ title: '周测', status: '未提交', course: '物理', leftMinutes: 60 }, now);
  assert.equal(row.deadline, '2026-04-01 01:00', '北京时间，且不是本地时区');
  assert.equal(row.type, '测试', '名字带「测」算测试');
  assert.equal(row.done, false);
  assert.equal(row.closed, false);

  const none = fromWorkRow({ title: '无时间', status: '未提交', course: '物理', leftMinutes: null }, now);
  assert.equal(none.deadline, null, '页面没写剩余时间就不编一个');
});

test('homeworkKind 与 beijingMinute：类型判定与跨时区显示', () => {
  assert.equal(homeworkKind('第三章习题'), '作业');
  assert.equal(homeworkKind('第 5 周小测'), '测试');
  // 输入是 UTC 的 ISO 串，输出必须是北京时间
  assert.equal(beijingMinute('2026-04-10T15:59:00Z'), '2026-04-10 23:59');
  assert.equal(beijingMinute(null), null);
  assert.equal(beijingMinute('不是时间'), null);
});

/* ══════════════════════════════════════ chapterList */

test('chapterList：每一节下挂课件与视频，锁住的节进 notOpen 且不发卡片请求', async () => {
  const client = fakeClient({
    routes: fullRoutes({
      cards: {
        '101:0': cardsHtml([{ objectid: 'a'.repeat(32), name: '讲义', type: '.pdf', size: 1024 }]),
        '102:0': cardsHtml([
          { objectid: 'b'.repeat(32), name: '演示', type: '.mp4', size: 5000 },
          { objectid: 'c'.repeat(32), name: '录音', type: '.mp3', size: 800 },
        ]),
      },
    }),
  });
  const reader = await readerWith(client);
  const result = await reader.chapterList({ course: '大学物理' });

  assert.equal(result.course, '大学物理');
  assert.equal(result.chapter_count, 3);
  assert.equal(result.section_count, 2, '有两节有文件（锁住那节没有）');
  assert.equal(result.count, 3);
  assert.deepEqual(result.notOpen, ['2.1 锁住的一节']);
  const first = result.chapters.find((item) => item.location === '第一章 绪论 / 1.1 测量基础');
  assert.deepEqual(first.materials.map((item) => item.name), ['讲义.pdf']);
  const second = result.chapters.find((item) => item.location === '第一章 绪论 / 1.2 等厚干涉');
  assert.deepEqual(second.videos.map((item) => item.name), ['演示.mp4']);
  assert.deepEqual(second.materials.map((item) => item.name), ['录音.mp3'], '音频归课件');

  const locked = client.calls.filter((call) => String(call.url).includes('knowledge/cards') && call.query?.knowledgeid === '201');
  assert.equal(locked.length, 0, '锁住的节读了也是空页，不该发请求');
});

/* ══════════════════════════════════════ materialList（含资料栏） */

test('materials：资料栏被读到了，且与章节按 objectId 合并、大小取章节的准确值', async () => {
  const SHARED = 'd'.repeat(32);
  const client = fakeClient({
    routes: fullRoutes({
      cards: {
        '101:0': cardsHtml([{ objectid: SHARED, name: '讲义', type: '.pdf', size: 2048 }]),
      },
      dataRows: () => dataListHtml([
        // 同一份文件（objectId 相同）在资料栏里也有，页面只给约数
        dataRowHtml({ name: '讲义', type: 'pdf', dataId: '11', objectId: SHARED, size: '14KB' }),
        dataRowHtml({ name: '只在资料栏', type: 'pptx', dataId: '12', size: '2MB' }),
        dataRowHtml({ name: '老师没开放', type: 'pdf', dataId: '13', downloadable: false }),
      ]),
    }),
  });
  const reader = await readerWith(client);
  const result = await reader.materials({ course: '大学物理' });

  assert.deepEqual(result.files.map((file) => file.name).sort(), ['只在资料栏.pptx', '老师没开放.pdf', '讲义.pdf'].sort());
  const shared = result.files.find((file) => file.name === '讲义.pdf');
  assert.equal(shared.size, 2048, '章节里那份的准确字节数优先于资料栏的约数');
  assert.deepEqual(shared.location, ['第一章 绪论', '1.1 测量基础']);
  const only = result.files.find((file) => file.name === '只在资料栏.pptx');
  assert.equal(only.dataId, '12');
  assert.equal(only.size, 2 * 1024 * 1024, '资料栏只有约数，折算成字节');
  const closed = result.files.find((file) => file.name === '老师没开放.pdf');
  assert.equal(closed.downloadable, false);
  assert.match(result.note, /两条通路/);
});

test('materials：写「资料」时只读资料栏，不把整门课的卡片都读一遍', async () => {
  const client = fakeClient({
    routes: fullRoutes({
      dataRows: () => dataListHtml([dataRowHtml({ name: '大纲', type: 'pdf', dataId: '1' })]),
    }),
  });
  const reader = await readerWith(client);
  const result = await reader.materials({ course: '大学物理', chapter: '资料' });
  assert.deepEqual(result.files.map((file) => file.name), ['大纲.pdf']);
  assert.deepEqual(result.files[0].location, ['资料']);
  const cardCalls = client.calls.filter((call) => String(call.url).includes('knowledge/cards'));
  assert.equal(cardCalls.length, 0, '只要资料栏时不该读章节卡片');
});

test('materials：写章节时只读那几节，不读资料栏', async () => {
  const client = fakeClient({
    routes: fullRoutes({
      cards: { '102:0': cardsHtml([{ objectid: 'e'.repeat(32), name: '干涉', type: '.pdf', size: 10 }]) },
      dataRows: () => dataListHtml([dataRowHtml({ name: '不该出现', type: 'pdf', dataId: '1' })]),
    }),
  });
  const reader = await readerWith(client);
  const result = await reader.materials({ course: '大学物理', chapter: '等厚干涉' });
  assert.deepEqual(result.files.map((file) => file.name), ['干涉.pdf']);
  assert.equal(result.scope, '第一章 绪论 / 1.2 等厚干涉');
  const dataCalls = client.calls.filter((call) => String(call.url).includes('stu-datalist'));
  assert.equal(dataCalls.length, 0, '指定了章节就不读资料栏');
});

test('materials：对不上的章节给 NEEDS_USER 与候选，不静默返回整门课', async () => {
  const client = fakeClient({ routes: fullRoutes() });
  const reader = await readerWith(client);
  await assert.rejects(
    () => reader.materials({ course: '大学物理', chapter: '完全没有这一章' }),
    (error) => {
      assert.equal(error.code, 'NEEDS_USER');
      assert.ok(error.details.candidates.length > 0);
      return true;
    },
  );
});

test('materials：资料栏读失败时章节那部分照常返回，warning 说清原因', async () => {
  const { ClassroomError } = await import('@lybx-leyw/dsh-zju-source-http');
  const client = fakeClient({
    routes: [
      // ⚠️ 这条必须排在 `fullRoutes()` 之前：路由是**先匹配者胜**，
      // 放后面会被 fullRoutes 里那条「回空列表」的抢走，于是测试变成
      // 「资料栏读到了 0 个文件」而不是「读失败」—— 那正好是假绿。
      route('stu-datalist', () => {
        // 必须是数据源自己的错误类型：非 `ClassroomError` 一律当程序缺陷抛出，
        // 那条规则是「别把 TypeError 当成平台故障悄悄吞掉」。
        throw new ClassroomError('PLATFORM_ERROR', '资料栏炸了');
      }),
      ...fullRoutes({ cards: { '101:0': cardsHtml([{ objectid: 'f'.repeat(32), name: '讲义', type: '.pdf', size: 9 }]) } }),
    ],
  });
  const reader = await readerWith(client);
  const result = await reader.materials({ course: '大学物理' });
  assert.deepEqual(result.files.map((file) => file.name), ['讲义.pdf']);
  assert.match(result.warning, /资料栏没有读到/);
  assert.match(result.warning, /资料栏炸了/);
});

/* ══════════════════════════════════════ videoList */

test('videos：只回视频，资料栏里的视频也算', async () => {
  const client = fakeClient({
    routes: fullRoutes({
      cards: {
        '102:0': cardsHtml([
          { objectid: '1'.repeat(32), name: '演示', type: '.mp4', size: 5000 },
          { objectid: '2'.repeat(32), name: '讲义', type: '.pdf', size: 100 },
          { objectid: '3'.repeat(32), name: '老录像', type: '.rmvb', size: 9000 },
        ]),
      },
      dataRows: () => dataListHtml([dataRowHtml({ name: '资料栏视频', type: 'mp4', dataId: '21', size: '3MB' })]),
    }),
  });
  const reader = await readerWith(client);
  const result = await reader.videos({ course: '大学物理' });
  assert.deepEqual(
    result.files.map((file) => file.name).sort(),
    ['资料栏视频.mp4', '演示.mp4', '老录像.rmvb'].sort(),
    'rmvb 这类老格式必须认出来，否则「有几个视频」会少',
  );
  assert.equal(result.files.every((file) => file.kind === 'video'), true);
});

/* ══════════════════════════════════════ download（真落盘） */

/** 造一个临时目录，用完删。 */
async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'xxt-dl-'));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  return dir;
}

/** 递归列出一个目录下的文件（相对路径，正斜杠）。 */
async function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out.sort();
}

test('downloadFiles：真落盘，按章节分子目录，播放版另起名字', async (t) => {
  const dir = await tempDir(t);
  const VIDEO = '4'.repeat(32);
  const DOC = '5'.repeat(32);
  const client = fakeClient({
    routes: [
      ...fullRoutes({
        cards: {
          '102:0': cardsHtml([
            { objectid: VIDEO, name: '演示', type: '.mp4', size: 5 },
            { objectid: DOC, name: '讲义', type: '.pdf', size: 5 },
          ]),
        },
      }),
      // ananas 状态：视频只有播放版（平台常这样），文档只有原文件
      route(`ananas/status/${VIDEO}`, () => JSON.stringify({
        status: 'success',
        length: 5,
        http: 'https://mooc1.chaoxing.com/f/playback.mp4',
      })),
      route(`ananas/status/${DOC}`, () => JSON.stringify({
        status: 'success', length: 5, download: 'https://cldisk.chaoxing.com/f/doc.pdf',
      })),
    ],
    files: {
      'https://mooc1.chaoxing.com/f/playback.mp4': 'hello',
      'https://cldisk.chaoxing.com/f/doc.pdf': 'world',
    },
  });
  const reader = await readerWith(client, { downloadDir: dir });

  // 两组各下一次：`group` 决定要哪一组（课件 / 视频），两组落在同一个课程目录下。
  const docs = await reader.downloadFiles({ course: '大学物理', group: 'material', all: true });
  const videos = await reader.downloadFiles({ course: '大学物理', group: 'video', all: true });

  assert.equal(docs.count, 1, '课件那一组只含文档');
  assert.equal(videos.count, 1, '视频那一组只含视频');
  assert.equal(videos.dir, path.join(dir, '大学物理'));
  assert.deepEqual(await listFiles(dir), [
    '大学物理/第一章 绪论/1.2 等厚干涉/ed.4d4d4d.mp4'.replace('ed.4d4d4d', '演示（播放版）'),
    '大学物理/第一章 绪论/1.2 等厚干涉/讲义.pdf',
  ].sort());
  assert.equal(await readFile(path.join(dir, '大学物理/第一章 绪论/1.2 等厚干涉/演示（播放版）.mp4'), 'utf8'), 'hello');
  // 播放版那一行要带 note：用户得知道拿到的不是原文件
  const played = videos.files.find((file) => file.name.includes('播放版'));
  assert.match(played.note, /播放版/);
  // 下载请求要带 Referer（不带会 403）
  const stream = client.calls.find((call) => call.method === 'STREAM');
  assert.equal(stream.options.headers.Referer, 'https://mooc1.chaoxing.com/');
});

test('downloadFiles：下载过的直接复用，不再取地址', async (t) => {
  const dir = await tempDir(t);
  const DOC = '6'.repeat(32);
  // 先手工放一份「已下载」的文件（大小与清单一致）
  const target = path.join(dir, '大学物理/第一章 绪论/1.2 等厚干涉/讲义.pdf');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, '12345');

  const client = fakeClient({
    routes: fullRoutes({
      cards: { '102:0': cardsHtml([{ objectid: DOC, name: '讲义', type: '.pdf', size: 5 }]) },
    }),
  });
  const reader = await readerWith(client, { downloadDir: dir });
  const result = await reader.downloadFiles({ course: '大学物理', name: '讲义.pdf' });

  assert.equal(result.files[0].reused, true);
  assert.equal(client.calls.filter((call) => String(call.url).includes('ananas/status')).length, 0,
    '复用就不该再取地址');
  assert.equal(client.calls.filter((call) => call.method === 'STREAM').length, 0);
});

test('downloadFiles：大小对不上时不复用，重下', async (t) => {
  const dir = await tempDir(t);
  const DOC = '7'.repeat(32);
  // 磁盘上是 3 字节（上次被截断），清单说 5 字节
  const target = path.join(dir, '大学物理/第一章 绪论/1.2 等厚干涉/讲义.pdf');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, 'abc');

  const client = fakeClient({
    routes: [
      ...fullRoutes({ cards: { '102:0': cardsHtml([{ objectid: DOC, name: '讲义', type: '.pdf', size: 5 }]) } }),
      route(`ananas/status/${DOC}`, () => JSON.stringify({
        status: 'success', length: 5, download: 'https://cldisk.chaoxing.com/f/doc.pdf',
      })),
    ],
    files: { 'https://cldisk.chaoxing.com/f/doc.pdf': 'world' },
  });
  const reader = await readerWith(client, { downloadDir: dir });
  const result = await reader.downloadFiles({ course: '大学物理', name: '讲义.pdf' });

  assert.equal(result.files[0].reused, undefined);
  assert.equal(await readFile(target, 'utf8'), 'world');
});

test('downloadFiles：没配下载目录时报 CONFIG，不自己猜一个位置', async () => {
  const client = fakeClient({ routes: fullRoutes() });
  const reader = new XxtReader(client);
  await assert.rejects(
    () => reader.downloadFiles({ course: '大学物理', all: true }),
    (error) => error.code === 'CONFIG' && /下载目录/.test(error.message),
  );
});

test('downloadFiles：范围没说清时不发请求就报错', async () => {
  const client = fakeClient({ routes: fullRoutes() });
  const reader = await readerWith(client, { downloadDir: '/tmp/none' });
  await assert.rejects(
    () => reader.downloadFiles({ course: '大学物理' }),
    (error) => error.code === 'INVALID_ARGUMENT' && /name/.test(error.message),
  );
  assert.deepEqual(client.calls, [], '参数没通过校验就不该发任何请求');
});

test('downloadFiles：只给章节时只下那一节的', async (t) => {
  const dir = await tempDir(t);
  const INSIDE = '8'.repeat(32);
  const OUTSIDE = '9'.repeat(32);
  const client = fakeClient({
    routes: [
      ...fullRoutes({
        cards: {
          '101:0': cardsHtml([{ objectid: OUTSIDE, name: '别的节', type: '.pdf', size: 1 }]),
          '102:0': cardsHtml([{ objectid: INSIDE, name: '这一节', type: '.pdf', size: 5 }]),
        },
      }),
      route(`ananas/status/${INSIDE}`, () => JSON.stringify({
        status: 'success', length: 5, download: 'https://cldisk.chaoxing.com/f/in.pdf',
      })),
    ],
    files: { 'https://cldisk.chaoxing.com/f/in.pdf': 'hello' },
  });
  const reader = await readerWith(client, { downloadDir: dir });
  const result = await reader.downloadFiles({ course: '大学物理', chapter: '等厚干涉' });
  assert.equal(result.count, 1);
  assert.deepEqual(await listFiles(dir), ['大学物理/第一章 绪论/1.2 等厚干涉/这一节.pdf']);
});

test('downloadFiles：一个失败不影响其余，全失败才抛', async (t) => {
  const dir = await tempDir(t);
  const OK = 'a'.repeat(32);
  const BAD = 'b'.repeat(32);
  const client = fakeClient({
    routes: [
      ...fullRoutes({
        cards: {
          '102:0': cardsHtml([
            { objectid: OK, name: '好的', type: '.pdf', size: 5 },
            { objectid: BAD, name: '坏的', type: '.pdf', size: 5 },
          ]),
        },
      }),
      route(`ananas/status/${OK}`, () => JSON.stringify({
        status: 'success', length: 5, download: 'https://cldisk.chaoxing.com/f/ok.pdf',
      })),
      route(`ananas/status/${BAD}`, () => JSON.stringify({ status: 'fail', msg: '文件已删除' })),
    ],
    files: { 'https://cldisk.chaoxing.com/f/ok.pdf': 'hello' },
  });
  const reader = await readerWith(client, { downloadDir: dir });
  const result = await reader.downloadFiles({ course: '大学物理', all: true });
  assert.equal(result.count, 1);
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /文件已删除/);
});

test('downloadTo：内容比预期大时中止，且目标文件名不会出现', async (t) => {
  const dir = await tempDir(t);
  const { downloadTo } = await import('../../../packages/source/xxt/src/download.js');
  const client = {
    async stream() {
      return {
        response: new Response('x'.repeat(100), { status: 200, headers: { 'content-length': '100' } }),
        release: () => {},
        signal: new AbortController().signal,
      };
    },
  };
  const target = path.join(dir, 'too-big.bin');
  await assert.rejects(
    () => downloadTo(client, { url: 'https://cldisk.chaoxing.com/x', destination: target, maxBytes: 10 }),
    (error) => error.code === 'REJECTED' && /比清单里写的大/.test(error.message),
  );
  assert.equal(await listFiles(dir).then((files) => files.includes('too-big.bin')), false,
    '没下完的文件不能以目标名出现 —— 否则复用逻辑会把它当成已下载');
});

test('downloadTo：403 翻译成「地址过期」，不是「Cookie 失效」', async (t) => {
  const dir = await tempDir(t);
  const { downloadTo } = await import('../../../packages/source/xxt/src/download.js');
  const client = {
    async stream() {
      return { response: new Response('no', { status: 403 }), release: () => {}, signal: new AbortController().signal };
    },
  };
  await assert.rejects(
    () => downloadTo(client, { url: 'https://cldisk.chaoxing.com/x', destination: path.join(dir, 'x.bin') }),
    (error) => error.code === 'REJECTED' && /地址可能已过期/.test(error.message),
  );
});

/* ══════════════════════════════════════ homeworkList（三个来源） */

/** 一套作业夹具：课程作业栏 + 学习任务 + 手机端列表。 */
function homeworkRoutes({ workEnc = 'ENC', tasks, standards = {}, stuw = '' } = {}) {
  return [
    // ⚠️ 这几条必须在 `fullRoutes()` 之前：路由先匹配者胜，而 fullRoutes 里那条
    // `stucoursemiddle` 只回 `enc`（没有 `workEnc`）—— 放后面会让每一门课都
    // 变成 `HOMEWORK_UNAVAILABLE`，测试于是「通过了」但什么也没测到。
    route('stucoursemiddle', () => (workEnc
      ? `<input id="workEnc" value="${workEnc}"><input id="openc" value="OPEN"><input id="enc" value="STUENC">`
      : '<div>这门课只有资料</div>')),
    route('mooc2/work/list', () => (workEnc
      ? '<div><span>1/2</span></div></div>'
        + '<li onclick="goTask(this);" data="https%3A%2F%2Fmooc1.chaoxing.com%2Fwork%2Fx%3Fid%3D1">'
        + '<p class="overHidden2 fl">作业栏里的作业</p><p class="status fl">未提交</p></li>'
        + '<li onclick="goTask(this);" data="https%3A%2F%2Fmooc1.chaoxing.com%2Fwork%2Fx%3Fid%3D2">'
        + '<p class="overHidden2 fl">已经交了的</p><p class="status fl">已完成</p></li>'
      : '')),
    route('getData', () => JSON.stringify(tasks ?? { result: 0 })),
    route('jumpStudyPlanList', () => '<script>const eTaskUserId = "TASKKEY";</script>'),
    route('getUserStandard', (url) => JSON.stringify({ data: standards[url] ?? standards.default ?? {} })),
    route('work/stu-work', () => stuw),
    ...fullRoutes(),
  ];
}

test('listHomework：三个来源合并，并按「课程 + 标题」去重', async () => {
  const standards = {
    // 任务明细形状：一条作业 + 一条别的（没做完）
    default: {
      userTaskQualifyDTO: {
        passStandardCalcResultDTOList: [
          {
            planUserBO: {
              finish: 0,
              plan: {
                planType: 4,
                name: '任务里的作业',
                introduce: '第 3 章做完',
                startDate: '2026-04-01T00:00:00Z',
                endDate: '2026-04-10T15:59:00Z',
              },
            },
          },
          { planUserBO: { finish: 0, plan: { planType: 1, name: '看视频' } } },
        ],
      },
    },
  };
  const stuw = `
<ul>
  <li><p>手机端独有</p><span>未提交</span><span>《大学物理》</span><span>剩余 2小时</span></li>
  <li><p>任务里的作业</p><span>未提交</span><span>《大学物理》</span><span>剩余 5小时</span></li>
  <li><p>别的课的作业</p><span>未提交</span><span>《线性代数》</span><span>剩余 5小时</span></li>
</ul>`;
  const client = fakeClient({
    routes: homeworkRoutes({
      tasks: { result: 1, data: [{ id: 7, name: '第 3 周', planCount: 2, planFinishCount: 0 }] },
      standards,
      stuw,
    }),
  });
  const reader = await readerWith(client);
  const result = await reader.listHomework({ course: '大学物理' });

  assert.equal(result.course, '大学物理');
  const titles = result.homework.map((row) => row.title).sort();
  assert.deepEqual(titles, ['作业栏里的作业', '任务里的作业', '手机端独有', '已经交了的'].sort());
  // 手机端里那条同名的是任务里的作业，被去重了
  assert.equal(result.homework.filter((row) => row.title === '任务里的作业').length, 1);
  // 别的课的行不能混进来
  assert.equal(result.homework.some((row) => row.title === '别的课的作业'), false);

  const taskRow = result.homework.find((row) => row.title === '任务里的作业');
  assert.equal(taskRow.task, '第 3 周');
  assert.equal(taskRow.deadline, '2026-04-10 23:59', '北京时间');
  assert.equal(taskRow.requirement, '第 3 章做完');
  assert.equal(taskRow.otherLeft, 1, '同一任务里还有一项没做完');
  assert.equal(taskRow.type, '作业');

  const courseRow = result.homework.find((row) => row.title === '作业栏里的作业');
  assert.equal(courseRow.task, '');
  assert.equal(courseRow.deadline, null, '作业栏不显示截止时间就不编');
  assert.equal(courseRow.pending, true);

  const done = result.homework.find((row) => row.title === '已经交了的');
  assert.equal(done.done, true);
  assert.equal(done.pending, false);
});

test('listHomework：单独一条作业栏作业允许自己失败，其余来源照常返回', async () => {
  const client = fakeClient({
    routes: [
      // 中间页要有作业签名（否则整门课是 HOMEWORK_UNAVAILABLE，测不到「签名被拒」），
      // 而作业列表页回权限页 → SIGNATURE_REJECTED
      route('stucoursemiddle', () => '<input id="workEnc" value="E"><input id="openc" value="O"><input id="enc" value="S">'),
      route('mooc2/work/list', () => '没有此页面访问权限'),
      route('getData', () => JSON.stringify({ result: 0 })),
      route('work/stu-work', () => `
<ul><li><p>手机端独有</p><span>未提交</span><span>《大学物理》</span><span>剩余 1小时</span></li></ul>`),
      ...fullRoutes(),
    ],
  });
  const reader = await readerWith(client);
  const result = await reader.listHomework({ course: '大学物理' });
  assert.equal(result.homework.length, 1, '作业栏签名失败不该把手机端那条也吞掉');
  assert.equal(result.failed.length, 1);
  assert.match(result.failed[0].reason, /签名校验失败/);
});

test('listHomework：课程没开作业功能不算失败', async () => {
  const client = fakeClient({
    routes: [
      // 中间页没有 workEnc → HOMEWORK_UNAVAILABLE（很多课只用资料）
      route('stucoursemiddle', () => '<div>这门课只有资料</div>'),
      route('getData', () => JSON.stringify({ result: 0 })),
      route('work/stu-work', () => ''),
      ...fullRoutes(),
    ],
  });
  const reader = await readerWith(client);
  const result = await reader.listHomework({ course: '大学物理' });
  assert.deepEqual(result.failed, [], '「没开作业功能」是正常情况，不是错误');
  assert.deepEqual(result.homework, []);
});

test('listHomework：pending_only 只留还没交的，但同一个结果里交过的不再出现', async () => {
  const client = fakeClient({
    routes: homeworkRoutes({ tasks: { result: 0 }, stuw: '' }),
  });
  const reader = await readerWith(client);
  const all = await reader.listHomework({ course: '大学物理' });
  assert.equal(all.homework.length, 2);
  const pending = await reader.listHomework({ course: '大学物理', pending_only: true });
  assert.deepEqual(pending.homework.map((row) => row.title), ['作业栏里的作业']);
});

test('listHomework：不给 course 时汇总全部课程', async () => {
  const client = fakeClient({
    routes: homeworkRoutes({ tasks: { result: 0 }, stuw: '' }),
  });
  const reader = await readerWith(client);
  const result = await reader.listHomework();
  assert.ok(result.count >= 2, '两门课各有两条作业栏里的作业');
  assert.equal(result.homeworks.length, result.count);
  assert.equal(typeof result.count, 'number');
});

test('deadlines：学习任务里的作业自带截止时间，也进待办聚合', async () => {
  const standards = {
    default: {
      userTaskQualifyDTO: {
        passStandardCalcResultDTOList: [{
          planUserBO: {
            finish: 0,
            plan: {
              planType: 4,
              name: '任务里的作业',
              startDate: '2026-04-01T00:00:00Z',
              // 2026-04-10 23:59 北京时间
              endDate: '2026-04-10T15:59:00Z',
            },
          },
        }],
      },
    },
  };
  const client = fakeClient({
    routes: [
      ...fullRoutes(),
      route('mooc2/work/list', () => ''),
      route('getData', () => JSON.stringify({ result: 1, data: [{ id: 7, name: '第 3 周', planCount: 1, planFinishCount: 0 }] })),
      route('jumpStudyPlanList', () => '<script>const eTaskUserId = "K";</script>'),
      route('getUserStandard', () => JSON.stringify({ data: standards.default })),
    ],
  });
  const reader = await readerWith(client);
  const result = await reader.deadlines({ course: '大学物理' });
  const row = result.items.find((item) => item.title === '任务里的作业');
  assert.ok(row, '学习任务里的作业必须出现在待办里');
  assert.equal(row.deadline, '2026-04-10 23:59');
  assert.equal(row.task, '第 3 周');
});

/* ══════════════════════════════════════ 客户端下载白名单 */

test('客户端 stream：只放 chaoxing.com 与 cldisk.com，且 http 地址升成 https', async () => {
  const { XxtClient } = await import('../../../packages/source/xxt/src/client.js');
  const { SessionStore } = await import('@lybx-leyw/dsh-zju-source-http');
  const calls = [];
  const client = new XxtClient({
    session: new SessionStore({}),
    fetch: async (url, init) => {
      calls.push({ url: String(url), headers: init.headers });
      return new Response('x', { status: 200 });
    },
    env: {},
  });

  await client.stream('http://cldisk.chaoxing.com/f/x.pdf');
  assert.equal(calls[0].url, 'https://cldisk.chaoxing.com/f/x.pdf', '平台常给 http 的 download 地址');
  assert.equal(calls[0].headers.Referer, 'https://mooc1.chaoxing.com/', '不带 Referer 会 403');
  assert.equal('Cookie' in calls[0].headers, false, '签名地址本身就是授权，不该把会话 Cookie 交给文件主机');

  // ⚠️ 这一条单独钉：原文件还会落在 **`cldisk.com`**（独立域，不是 chaoxing 的子域）。
  // 只放 `chaoxing.com` 的表现是「清单列得出来、文件一个都下不下来」，而错误落在
  // `INVALID_PATH` 上 —— 看起来像参数写错，实际是白名单没收这一个域。
  await client.stream('https://file.cldisk.com/signed/x.pdf');
  assert.equal(calls.length, 2, 'cldisk.com 必须放行，否则章节与资料栏的原文件都下不来');

  await assert.rejects(
    () => client.stream('https://evil.com/x'),
    (error) => error.code === 'INVALID_PATH',
  );
  await assert.rejects(
    () => client.stream('https://cldisk.com.evil.com/x'),
    (error) => error.code === 'INVALID_PATH',
    '后缀相同但不是自己的域',
  );
});


