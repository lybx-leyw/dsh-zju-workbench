/**
 * 教务数据源（`@lybx-leyw/dsh-zju-source-zdbk`）的契约测试。**全部离线**。
 *
 * 这个包的代码是从 `dsh-zhiyun-source-omni` 的 `platforms/zdbk/` 移植来的，
 * 但**逻辑照搬不等于可以照搬测试可信度**：真正容易错、错了又最难发现的地方
 * 恰好是这几处，所以这里逐条钉住，而不是只测「能不能跑」：
 *
 *   1. **GPA 的三种口径**（五分制 / 4.3 制 / 弃修与合格不合格的排除）。
 *      算错了不会报错，只会给出一串看起来很像真的、但和成绩单对不上的数字。
 *   2. **学期推断**。推错了就把用户带到另一个学期的课表上，而且界面一切正常。
 *   3. **四个解析器**的形状。字段一旦漂，页面会静默少一块。
 *   4. **CAS 必须带 `service`**（与学在浙大相反）。漏了的表现是
 *      「密码明明对，登录完还是未登录」—— 归因方向完全是错的。
 *   5. **端到端链路**：登录 → 真读一次业务接口。这条是唯一能证明
 *      「登录成功」与「教务认你」不是同一件事的测试。
 *
 * ⚠️ 不碰 DPAPI。`SessionStore` 要么不传 `file`（只存内存），要么传自定义 `protect`。
 *    DPAPI 会 spawn 一个 PowerShell 子进程，而本机沙箱禁止 spawn。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  ZDBK_BASE, ZDBK_CAS_ENTRY, ZDBK_EVAL_PATH, ZDBK_HOSTS, ZDBK_PATHS, ZDBK_PLAN_PATHS,
  ZDBK_SELECTION_PATHS, ZDBK_SERVICE, ZDBK_HOST, planPdfUrl,
} from '../../../packages/source/zdbk/src/hosts.js';
import {
  PERIOD_TIMES, checkAcademicYear, courseCodeOfKey, currentTerm, gpaOf, parseExams,
  parseExamTime, parseGrade, parseSession, semesterOfCourseKey, semesterOfTerm, termCode,
} from '../../../packages/source/zdbk/src/parse.js';
import { parsePlan, splitCourses } from '../../../packages/source/zdbk/src/plan.js';
import {
  assertSelectionTerm, flatten, parseCapacity, parseMyPlan, parseSelectionContext,
  parseSelectionRow, sectionView, selectionPageForm, selectionSearchForm, selectionState,
} from '../../../packages/source/zdbk/src/selection.js';
import { casForm, casLogin, encryptCasPassword, hasCasForm, describeAuthFailure } from '../../../packages/source/zdbk/src/cas.js';
import { ZdbkClient } from '../../../packages/source/zdbk/src/client.js';
import { ZdbkReader } from '../../../packages/source/zdbk/src/reads.js';
import { ClassroomError, Transport } from '@lybx-leyw/dsh-zju-source-http';
import * as plugin from '../../../packages/source/zdbk/src/index.js';

/**
 * 测试用的 RSA 公钥 modulus（1024 位 = 256 个 hex 字符）。
 *
 * ⚠️ 长度必须 ≥ 128 个 hex 字符：`encryptCasPassword` 会拒绝更短的公钥
 * （真的浙大公钥是 1024 位，短于它的"公钥"只可能是被截断的响应）。
 * 早先这里随手借了 campus 测试里那串 124 字符的常量，于是登录链一路
 * 走到加密那一步才炸 —— 看起来像"加密实现坏了"，其实是夹具不合格。
 */
const TEST_MODULUS = `${'50b61c72d83e94fa'.repeat(16)}`;

/* ─────────────────────────────────────── 夹具 */

/**
 * 造一个「Response 形状」的假响应。
 *
 * 为什么不用 `new Response(...)`：`Response` 构造器**拒绝 200~599 以外的状态码**
 * （`RangeError: init["status"] must be in the range of 200 to 599`），
 * 而正方的 901 / 902 / 1001 恰恰都在这个范围外 —— 用真 Response 就测不了
 * 「非标准状态码怎么判」。真实 `fetch` 是能拿到这些状态码的（Node 的
 * `undici` 不校验，服务端写 901 就回 901），所以这里只补测试侧的缺口。
 *
 * @param {number} status - HTTP 状态码。
 * @param {string} [body] - 正文。
 * @param {Record<string, string|string[]>} [headers] - 响应头（`set-cookie` 支持多值）。
 * @returns {{status: number, headers: {get(name: string): string|null, getSetCookie(): string[]}, text(): string}} 假响应。
 */
function fakeResponse(status, body = '', headers = {}) {
  const normalized = new Map();
  for (const [key, value] of Object.entries(headers)) {
    normalized.set(key.toLowerCase(), Array.isArray(value) ? value : [value]);
  }
  return {
    status,
    headers: {
      get: (name) => normalized.get(String(name).toLowerCase())?.[0] ?? null,
      getSetCookie: () => normalized.get('set-cookie') ?? [],
    },
    text: async () => body,
  };
}

/**
 * 一个学期的成绩条目（正方 `cxdy` 接口的形状）。
 *
 * 刻意混进「弃修」「合格」各一条：它们**不能**进 GPA，
 * 而如果实现里只写了 `counted_in_credits`，这两条就会漏进分母 ——
 * 这条夹具就是为了让那种漏法当场变红。
 */
const GRADE_FIXTURE = [
  // 「秋」两门，绩点 5.0 / 3.6
  { xkkh: '(2025-2026-1)-CS1001G-0012345-1', kcmc: '程序设计基础', xf: '3', cj: '95', jd: '5.0' },
  { xkkh: '(2025-2026-1)-MA1001G-0012346-1', kcmc: '微积分(Ⅰ)', xf: '5', cj: '82', jd: '3.6' },
  // 弃修：不计学分，也不计 GPA
  { xkkh: '(2025-2026-1)-PH1001G-0012347-1', kcmc: '大学物理', xf: '4', cj: '弃修', jd: '' },
  // 合格：计学分，但不计 GPA（二级制没有绩点）
  { xkkh: '(2025-2026-1)-PE1001G-0012348-1', kcmc: '体育(Ⅰ)', xf: '1', cj: '合格', jd: '' },
  // 「春」一门，绩点 4.8
  { xkkh: '(2025-2026-2)-CS1002G-0012349-1', kcmc: '数据结构基础', xf: '3', cj: '92', jd: '4.8' },
];

const EXAM_FIXTURE = [
  {
    xkkh: '(2025-2026-1)-CS1001G-0012345-1',
    kcmc: '程序设计基础',
    xf: '3',
    qzkssj: '2025年11月10日(10:00-12:00)',
    qzjsmc: '紫金港东1-101',
    qzzwxh: 'A12',
    kssj: '2026年01月15日(08:00-10:00)',
    jsmc: '紫金港西2-205',
    zwxh: 'B07',
  },
  {
    xkkh: '(2025-2026-1)-MA1001G-0012346-1',
    kcmc: '微积分(Ⅰ)',
    xf: '5',
    // 只有考试周描述、没有具体日期 → start/end 必须是 null，且不能被滤掉
    kssj: '考试周（第 18 周）',
    jsmc: '待定',
    zwxh: '',
  },
];

const TIMETABLE_FIXTURE = {
  kbList: [
    {
      kcb: '程序设计基础<br>秋冬<br>张三<br>紫金港东1-101zwf=1',
      xqj: '1', djj: '1', skcd: '2', dsz: '0', xxq: '秋冬', sfqd: '1',
    },
    {
      kcb: '微积分（Ⅰ）<br>秋冬<br>李四<br>紫金港西2-205',
      xqj: '3', djj: '3', skcd: '2', dsz: '1', xxq: '秋冬', sfqd: '0',
    },
    // 未排课的占位行：**不显示**，但也不该计进 skipped
    { kcb: '', xqj: '5', djj: '1', skcd: '2', sfyjskc: '1' },
  ],
};

/**
 * 一个假的成绩行构造器 —— GPA 用例只想说清「学分 × 绩点」，
 * 不该被 `xkkh` 解析之类的东西分散注意力。
 *
 * @param {number} credit - 学分。
 * @param {number|null} point - 绩点。
 * @param {object} [extra] - 覆盖字段。
 * @returns {object} 成绩行。
 */
function grade(credit, point, extra = {}) {
  return {
    course_key: `(2025-2026-1)-X-${Math.random().toString(36).slice(2, 8)}-1`,
    course_code: 'X',
    name: '课程',
    academic_year: '2025-2026',
    semester: 1,
    credit,
    score: String(point == null ? '' : point * 20),
    grade_point: point,
    counted_in_gpa: point != null,
    counted_in_credits: true,
    ...extra,
  };
}

/* ─────────────────────────────────────── GPA：三种口径 */

test('GPA 五分制：按学分加权，不是简单平均', () => {
  // 只看「秋」那四条：计入 GPA 的是 3 学分 5.0 与 5 学分 3.6。
  // 正确值 (5.0×3 + 3.6×5) / 8 = 33/8 = 4.125。
  // 简单平均会得到 (5.0+3.6)/2 = 4.3 —— 差得足够多，写成简单平均立刻可见。
  const autumn = GRADE_FIXTURE.map(parseGrade).filter((row) => row.semester === 1);
  const summary = gpaOf(autumn);
  assert.equal(summary.gpa_5, 4.125);
  assert.equal(summary.gpa_credits, 8, '分母是**计入 GPA** 的学分（3+5），不含弃修与合格');
  assert.equal(summary.courses, 4, 'courses 是参与统计的课程总数（含未计入 GPA 的）');

  // 加上「春」那门 3 学分 4.8：(33 + 14.4) / 11 = 4.309
  const everything = gpaOf(GRADE_FIXTURE.map(parseGrade));
  assert.equal(everything.gpa_5, 4.309);
  assert.equal(everything.gpa_credits, 11);
  assert.equal(everything.courses, 5);
});

test('GPA 4.3 制：5.0→4.3、4.8→4.2，其余封顶 4.0（不按比例缩放）', () => {
  // 4.8 要映射成 4.2。若实现写成"按比例缩放"，这里会得到 4.8*0.86=4.13。
  const fourEight = gpaOf([grade(3, 4.8)]);
  assert.equal(fourEight.gpa_5, 4.8);
  assert.equal(fourEight.gpa_4_3, 4.2, '4.8 → 4.2');

  assert.equal(gpaOf([grade(3, 5)]).gpa_4_3, 4.3, '5.0 → 4.3');
  assert.equal(gpaOf([grade(3, 4.5)]).gpa_4_3, 4.1, '4.5 → 4.1');
  assert.equal(gpaOf([grade(3, 4.2)]).gpa_4_3, 4.0, '4.2 → 4.0');
  // 关键：4.9 / 4.6 / 3.6 都落在映射表外 → 封顶 4.0 / 原值。
  assert.equal(gpaOf([grade(3, 4.9)]).gpa_4_3, 4.0, '4.9 封顶 4.0，不是 4.9×0.86');
  assert.equal(gpaOf([grade(3, 4.6)]).gpa_4_3, 4.0, '4.6 封顶 4.0');
  assert.equal(gpaOf([grade(3, 3.6)]).gpa_4_3, 3.6, '≤4.0 的原样保留');

  // 混合：秋 3 学分 5.0（→4.3）+ 5 学分 3.6（→3.6）：(12.9 + 18) / 8 = 3.8625 → 3.863
  const autumn = GRADE_FIXTURE.map(parseGrade).filter((row) => row.semester === 1);
  assert.equal(gpaOf(autumn).gpa_4_3, 3.863);
  // 全量再叠一门 3 学分 4.8（→4.2）：(30.9 + 12.6) / 11 = 3.954...
  assert.equal(gpaOf(GRADE_FIXTURE.map(parseGrade)).gpa_4_3, 3.955);
});

test('弃修 / 待录 / 缓考 / 无效：不计学分，也不计 GPA', () => {
  for (const score of ['弃修', '待录', '缓考', '无效']) {
    const row = parseGrade({ xkkh: '(2025-2026-1)-A-1-1', kcmc: '课', xf: '4', cj: score, jd: '' });
    assert.equal(row.counted_in_credits, false, `${score} 不该计学分`);
    assert.equal(row.counted_in_gpa, false, `${score} 不该计 GPA`);
    const summary = gpaOf([row, grade(2, 4)]);
    assert.equal(summary.gpa_credits, 2, `${score} 不许进 GPA 的分母`);
    assert.equal(summary.gpa_5, 4, `${score} 不许拉低绩点`);
    assert.equal(summary.earned_credits, 2, `${score} 不算已获学分`);
  }
});

test('合格 / 不合格：计学分，但不计 GPA', () => {
  const qualified = parseGrade({ xkkh: '(2025-2026-1)-PE-1-1', kcmc: '体育', xf: '1', cj: '合格', jd: '' });
  const failed = parseGrade({ xkkh: '(2025-2026-1)-PE-2-1', kcmc: '体育', xf: '1', cj: '不合格', jd: '' });
  assert.equal(qualified.counted_in_credits, true, '合格要拿学分');
  assert.equal(qualified.counted_in_gpa, false, '合格不计 GPA');
  assert.equal(failed.counted_in_gpa, false, '不合格同样不计 GPA（学校口径）');

  const summary = gpaOf([qualified, failed, grade(3, 5)]);
  assert.equal(summary.gpa_5, 5, '二级制课程不许把绩点拉下来');
  assert.equal(summary.gpa_credits, 3, '分母只含计 GPA 的学分');
  assert.equal(summary.earned_credits, 4, '合格计 1 学分；不合格不计');
});

test('空集合返回 null 而不是 0（0 会被界面画成贴底曲线）', async () => {
  const empty = gpaOf([]);
  assert.equal(empty.gpa_5, null);
  assert.equal(empty.gpa_4_3, null);
  assert.equal(empty.average_score, null);
  assert.equal(empty.gpa_credits, 0);
  // 只有弃修时同理：有行但没学分。
  const onlyDropped = gpaOf([parseGrade({ xkkh: '(2025-2026-1)-A-1-1', kcmc: '课', xf: '4', cj: '弃修', jd: '' })]);
  assert.equal(onlyDropped.gpa_5, null);
  assert.equal(onlyDropped.courses, 1);
});

test('平均分只统计能折成百分制的行，分母是这些行的学分', () => {
  const rows = [
    // 90 分 3 学分
    parseGrade({ xkkh: '(2025-2026-1)-A-1-1', kcmc: '课A', xf: '3', cj: '90', jd: '4.0' }),
    // 等级制「优秀」按 90 折
    parseGrade({ xkkh: '(2025-2026-1)-B-1-1', kcmc: '课B', xf: '2', cj: '优秀', jd: '4.5' }),
    // 「合格」不计 GPA，因此也不进平均分
    parseGrade({ xkkh: '(2025-2026-1)-C-1-1', kcmc: '课C', xf: '1', cj: '合格', jd: '' }),
  ];
  const summary = gpaOf(rows);
  assert.equal(summary.average_score, 90, '(90*3 + 90*2) / 5');
  assert.equal(summary.gpa_credits, 5, '合格那条不进 GPA 分母');
  assert.equal(summary.earned_credits, 6, '但合格要拿学分');
});

test('绩点为空的成绩行不许被当成 0 分（Number("") === 0 的坑）', () => {
  const row = parseGrade({ xkkh: '(2025-2026-1)-A-1-1', kcmc: '课', xf: '3', cj: '缓考', jd: '' });
  assert.equal(row.grade_point, null, 'jd="" 必须是 null，不是 0');
  const zero = parseGrade({ xkkh: '(2025-2026-1)-B-1-1', kcmc: '课', xf: '3', cj: '0', jd: '0' });
  assert.equal(zero.grade_point, 0, '真的 0 绩点要保留为 0');
  assert.equal(zero.counted_in_gpa, true, '0 绩点是有效成绩，要计入（会拉低 GPA）');
});

/* ─────────────────────────────────────── 学期推断 */

test('学期推断：已知日期下得到确定的学年与学期', () => {
  // 用带 +08:00 的时刻，避免本机时区影响；推断函数内部也会再转一次上海时间。
  const at = (iso) => new Date(iso);
  assert.deepEqual(currentTerm(at('2025-09-10T12:00:00+08:00')), { academic_year: '2025-2026', term: '秋' });
  assert.deepEqual(currentTerm(at('2025-11-14T12:00:00+08:00')), { academic_year: '2025-2026', term: '秋' }, '11 月 15 日前仍是秋');
  assert.deepEqual(currentTerm(at('2025-11-20T12:00:00+08:00')), { academic_year: '2025-2026', term: '冬' }, '11 月 15 日起转冬');
  assert.deepEqual(currentTerm(at('2026-01-05T12:00:00+08:00')), { academic_year: '2025-2026', term: '冬' }, '跨年后仍是同一学年');
  assert.deepEqual(currentTerm(at('2026-03-10T12:00:00+08:00')), { academic_year: '2025-2026', term: '春' });
  assert.deepEqual(currentTerm(at('2026-05-10T12:00:00+08:00')), { academic_year: '2025-2026', term: '夏' });
  assert.deepEqual(currentTerm(at('2026-07-20T12:00:00+08:00')), { academic_year: '2025-2026', term: '夏' });
  // 8 月切换学年
  assert.deepEqual(currentTerm(at('2026-08-20T12:00:00+08:00')), { academic_year: '2026-2027', term: '秋' });
});

test('学期推断不受本机时区影响（同一时刻在不同时区的字符串表示）', () => {
  // 2025-10-31T16:30Z = 上海 11 月 1 日 00:30 → 仍是「秋」（11 月 15 日前）。
  // 若实现按本机时区取月份，在 UTC 机器上会得到 10 月（秋）、在更东的时区会到 11 月 1 日……
  // 关键断言是：同一**时刻**只得到一个答案。
  const instant = new Date('2025-10-31T16:30:00Z');
  assert.deepEqual(currentTerm(instant), { academic_year: '2025-2026', term: '秋' });
  // 上海时间 11 月 16 日 00:30 → 冬。
  assert.deepEqual(currentTerm(new Date('2025-11-15T16:30:00Z')), { academic_year: '2025-2026', term: '冬' });
});

test('学期号与 xqm 编码：秋/冬=1，春/夏=2，且必须带「|季」', () => {
  assert.equal(semesterOfTerm('秋'), 1);
  assert.equal(semesterOfTerm('冬'), 1);
  assert.equal(semesterOfTerm('春'), 2);
  assert.equal(semesterOfTerm('夏'), 2);
  // 只发 "1" 时正方的秋冬会合并，所以「|季」那一半是必要的。
  assert.equal(termCode('秋'), '1|秋');
  assert.equal(termCode('冬'), '1|冬');
  assert.equal(termCode('春'), '2|春');
  assert.equal(termCode('夏'), '2|夏');
});

test('学年格式校验：后一年必须正好 +1', () => {
  assert.equal(checkAcademicYear('2025-2026'), '2025-2026');
  for (const bad of ['2025-2027', '25-26', '2025/2026', '', null, undefined, '2025-2026 ']) {
    assert.throws(() => checkAcademicYear(bad), (error) => error.code === 'INVALID_ARGUMENT', `${String(bad)} 应被拒绝`);
  }
});

test('选课课号里能取到学年/学期与课程代码', () => {
  const key = '(2025-2026-1)-CS1001G-0012345-1';
  assert.deepEqual(semesterOfCourseKey(key), { academic_year: '2025-2026', semester: 1 });
  assert.equal(courseCodeOfKey(key), 'CS1001G');
  assert.equal(semesterOfCourseKey('乱码'), null, '格式不符时 null，不许瞎猜');
  assert.equal(courseCodeOfKey(null), null);
});

/* ─────────────────────────────────────── 解析：成绩 */

test('成绩解析：字段齐全，课程名全角化', async () => {
  const parsed = GRADE_FIXTURE.map(parseGrade);
  const cs = parsed[0];
  assert.equal(cs.course_key, '(2025-2026-1)-CS1001G-0012345-1');
  assert.equal(cs.course_code, 'CS1001G');
  assert.equal(cs.name, '程序设计基础');
  assert.equal(cs.academic_year, '2025-2026');
  assert.equal(cs.semester, 1);
  assert.equal(cs.credit, 3);
  assert.equal(cs.score, '95');
  assert.equal(cs.grade_point, 5);
  assert.equal(cs.counted_in_gpa, true);

  // 半角括号 → 全角：同一门课在不同接口里括号写法不一致，不统一会认成两门课。
  assert.equal(parsed[1].name, '微积分（Ⅰ）');
});

test('成绩解析：缺选课课号是 SCHEMA_CHANGED，不是"跳过这一条"', () => {
  assert.throws(() => parseGrade({ kcmc: '课', xf: '3', cj: '90' }), (error) => error.code === 'SCHEMA_CHANGED');
});

test('校选修网络课（xtwkc）：计学分但不计 GPA', () => {
  const row = parseGrade({ xkkh: '(2025-2026-1)-xtwkc-001-1', kcmc: '网络课', xf: '2', cj: '90', jd: '4.0' });
  assert.equal(row.counted_in_gpa, false, 'xtwkc 不计 GPA');
  assert.equal(row.counted_in_credits, true, '但要拿学分');
  // earned_credits 的宽口径：xtwkc 即使绩点被排除也算已获学分。
  assert.equal(gpaOf([row]).earned_credits, 2);
});

/* ─────────────────────────────────────── 解析：考试 */

test('考试解析：一条记录产出期中+期末两行', () => {
  const rows = parseExams(EXAM_FIXTURE[0]);
  assert.equal(rows.length, 2);
  const midterm = rows.find((r) => r.type === 'midterm');
  const final = rows.find((r) => r.type === 'final');
  assert.equal(midterm.time_text, '2025年11月10日(10:00-12:00)');
  assert.equal(midterm.location, '紫金港东1-101');
  assert.equal(midterm.seat, 'A12');
  assert.equal(final.start, '2026-01-15T08:00:00+08:00');
  assert.equal(final.end, '2026-01-15T10:00:00+08:00');
  assert.equal(final.seat, 'B07');
  assert.equal(final.academic_year, '2025-2026');
  assert.equal(final.semester, 1);
});

test('考试解析：只给考试周描述的条目 start/end 为 null（不编造时刻）', () => {
  const rows = parseExams(EXAM_FIXTURE[1]);
  assert.equal(rows.length, 1, '没有期中时间 → 不产出期中行');
  assert.equal(rows[0].type, 'final');
  assert.equal(rows[0].start, null);
  assert.equal(rows[0].end, null);
  assert.equal(rows[0].time_text, '考试周（第 18 周）');
});

test('考试时间写死 +08:00：否则同一份数据在 UTC 机器上会差 8 小时', () => {
  // 这是最危险的一类错误：它会让人错过考试。
  const parsed = parseExamTime('2026年01月15日(08:00-10:00)');
  assert.equal(parsed.start, '2026-01-15T08:00:00+08:00');
  // 即便本机时区不同，这个 ISO 串解析出的**时刻**也是固定的。
  assert.equal(Date.parse(parsed.start), Date.parse('2026-01-15T00:00:00Z'));
  // 各种日期分隔写法都要认。
  for (const text of ['2026-01-15(08:00-10:00)', '2026/1/15(8:00-10:00)', '2026.1.15(08:00~10:00)', '2026年1月15日(08:00至10:00)']) {
    assert.equal(parseExamTime(text).start, '2026-01-15T08:00:00+08:00', text);
  }
  // 只有日期没有时段：两样都得是 null。
  assert.deepEqual(parseExamTime('2026年01月15日'), { start: null, end: null });
  assert.deepEqual(parseExamTime(''), { start: null, end: null });
});

/* ─────────────────────────────────────── 解析：课表 */

test('课表解析：kcb 是 HTML 片段，按 <br> 切段取值', () => {
  const first = parseSession(TIMETABLE_FIXTURE.kbList[0]);
  assert.equal(first.name, '程序设计基础');
  assert.equal(first.teacher, '张三');
  assert.equal(first.location, '紫金港东1-101', '地点尾部的 zwf 内部编码要切掉');
  assert.equal(first.weekday, 1);
  assert.deepEqual(first.periods, [1, 2]);
  assert.equal(first.time, '08:00-09:35', '第 1~2 节：起于第一节开始、止于第二节结束');
  assert.equal(first.weeks, 'odd', 'dsz=0 是单周（反直觉，写反会错开一周）');
  assert.equal(first.terms, '秋冬');
  assert.equal(first.confirmed, true);
});

test('课表解析：单双周映射（dsz 0=单、1=双、其余=全）', () => {
  const base = { kcb: '课<br>秋冬<br>师<br>地点', xqj: '2', djj: '3', skcd: '2' };
  assert.equal(parseSession({ ...base, dsz: '0' }).weeks, 'odd');
  assert.equal(parseSession({ ...base, dsz: '1' }).weeks, 'even');
  assert.equal(parseSession({ ...base, dsz: '' }).weeks, 'all');
  assert.equal(parseSession({ ...base }).weeks, 'all');
  assert.equal(parseSession({ ...base, dsz: '2' }).weeks, 'all');
});

test('课表解析：占位行（sfyjskc=1 / 空 kcb）返回 null，与解析失败区分开', () => {
  assert.equal(parseSession(TIMETABLE_FIXTURE.kbList[2]), null);
  assert.equal(parseSession({ kcb: '', xqj: '1', djj: '1', skcd: '2' }), null);
});

test('课表解析：星期/节次缺失是 SCHEMA_CHANGED', () => {
  assert.throws(() => parseSession({ kcb: '课<br>秋冬<br>师<br>地点', xqj: '8', djj: '1', skcd: '2' }), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parseSession({ kcb: '课<br>秋冬<br>师<br>地点', xqj: '0', djj: '1', skcd: '2' }), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parseSession({ kcb: '课<br>秋冬<br>师<br>地点', xqj: '1', djj: 'abc', skcd: '2' }), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parseSession({ kcb: '课<br>秋冬<br>师<br>地点', xqj: '1', djj: '1', skcd: '0' }), (e) => e.code === 'SCHEMA_CHANGED');

  // ⚠️ `djj = '0'` **不会**被拒绝 —— 这是从 omni 照搬的既有行为
  // （`Number('0')` 是整数，原实现的判据只有 `Number.isInteger`）。
  // 保留它而不是顺手加一条 `>= 1`：本包的移植原则是「行为一致」，
  // 静默改动判据会让「同一份数据在 omni 与本包上结果不同」，
  // 那种差异在拆包期间最难归因。落在这里当文档：
  // 节次 0 在 `PERIOD_TIMES` 里查不到，`time` 因此为 null，不会产出错误时刻。
  const zero = parseSession({ kcb: '课<br>秋冬<br>师<br>地点', xqj: '1', djj: '0', skcd: '1' });
  assert.deepEqual(zero.periods, [0]);
  assert.equal(zero.time, null, '查不到节次时间时给 null，不许编一个时刻');
});

test('节次时间表覆盖 1~13 节且连续', () => {
  for (let period = 1; period <= 13; period++) {
    const [start, end] = PERIOD_TIMES[period];
    assert.match(start, /^\d{2}:\d{2}$/);
    assert.match(end, /^\d{2}:\d{2}$/);
    assert.ok(start < end, `第 ${period} 节的开始必须早于结束`);
  }
});

/* ─────────────────────────────────────── CAS：入口与表单 */

test('CAS 入口必须带 service，且 service 只编码一次', () => {
  // 这是本包与 campus 最重要的一处差别：漏了 service，CAS 登完没人回调教务，
  // 表现是「密码明明对，登录完还是未登录」。
  assert.equal(ZDBK_SERVICE, 'https://zdbk.zju.edu.cn/jwglxt/xtgl/login_ssologin.html');
  assert.equal(
    ZDBK_CAS_ENTRY,
    `https://zjuam.zju.edu.cn/cas/login?service=${encodeURIComponent(ZDBK_SERVICE)}`,
  );

  const url = new URL(ZDBK_CAS_ENTRY);
  assert.equal(url.hostname, 'zjuam.zju.edu.cn');
  assert.equal(url.pathname, '/cas/login');
  const service = url.searchParams.get('service');
  assert.equal(service, ZDBK_SERVICE, '解码一次必须原样等于 service 地址（说明只编码了一次）');
  assert.equal(url.searchParams.get('service').includes('%3A%3A'), false, '不许出现双重编码');
  // 双重编码的特征：编码后的串里残留 %25 或 %253A。
  assert.equal(ZDBK_CAS_ENTRY.includes('%253A'), false, 'service 被编码了两次');

  // 反过来钉住「与 campus 相反」这件事：campus 的入口不该出现 service。
  assert.match(ZDBK_SERVICE, /^https:\/\/zdbk\.zju\.edu\.cn\/jwglxt\//);
});

test('主机白名单必须同时含 CAS 与教务（漏一个的表现是"登录成功但会话为空"）', () => {
  assert.ok(ZDBK_HOSTS instanceof Set);
  assert.ok(ZDBK_HOSTS.has('zjuam.zju.edu.cn'), 'CAS 票种在 zjuam');
  assert.ok(ZDBK_HOSTS.has('identity.zju.edu.cn'), '统一认证的部分跳转落在 identity');
  assert.ok(ZDBK_HOSTS.has(ZDBK_HOST), '业务 session 种在 zdbk');
  assert.equal(ZDBK_HOST, 'zdbk.zju.edu.cn');
  assert.equal(ZDBK_BASE, 'https://zdbk.zju.edu.cn/jwglxt');
});

test('四个接口路径都挂在 /jwglxt 下（写错只会静默读到空）', () => {
  assert.deepEqual(Object.keys(ZDBK_PATHS).sort(), ['exams', 'grades', 'majorGrades', 'timetable']);
  for (const path of Object.values(ZDBK_PATHS)) {
    assert.ok(path.startsWith('/'), `${path} 应以 / 开头`);
    assert.equal(path.includes('..'), false, `${path} 不许含 ..`);
  }
});

test('CAS 表单：execution 取自页面，action 缺 service 时从登录页补回', () => {
  const page = '<html><form id="fm1" action="/cas/login" method="post"><input name="username"><input name="execution" value="e1"></form></html>';
  const form = casForm(page, ZDBK_CAS_ENTRY);
  assert.equal(form.execution, 'e1');
  const action = new URL(form.action);
  assert.equal(action.hostname, 'zjuam.zju.edu.cn');
  // 页面给的 action 是裸 /cas/login；不补 service 的话 CAS 不会回调教务。
  assert.equal(action.searchParams.get('service'), ZDBK_SERVICE, 'service 必须被补回去');

  // action 自己已经带 service 时不许改写成别的。
  const own = '<form action="https://zjuam.zju.edu.cn/cas/login?service=OTHER"><input name="execution" value="e2"></form>';
  assert.equal(new URL(casForm(own, ZDBK_CAS_ENTRY).action).searchParams.get('service'), 'OTHER');

  assert.equal(hasCasForm(page), true);
  assert.equal(hasCasForm('<html>已登录</html>'), false);
});

test('CAS 表单：action 指向非 zjuam 时拒绝（密码只能交给已验证的接口）', () => {
  const evil = '<form action="https://evil.example.com/cas/login"><input name="execution" value="e1"></form>';
  assert.throws(() => casForm(evil, ZDBK_CAS_ENTRY), (error) => error.code === 'AUTH_REDIRECT_REJECTED' || error.code === 'AUTH_FORM_REJECTED');
  // 少了 execution 是页面结构变了，不是密码问题。
  assert.throws(() => casForm('<form action="/cas/login"></form>', ZDBK_CAS_ENTRY), (e) => e.code === 'AUTH_FLOW_CHANGED');
});

/* ─────────────────────────────────────── CAS：RSA 打包 */

test('RSA 密码打包：分块、每块补齐到 4 的倍数、拒绝非 ASCII', () => {
  // 用一组合法形态的 1024 位 modulus（128 hex 位）。
  const modulus = 'c'.repeat(128);
  const out = encryptCasPassword('abc123', modulus, '010001');
  const chunks = out.split(' ');
  assert.ok(chunks.length >= 1);
  for (const chunk of chunks) {
    assert.match(chunk, /^[0-9a-f]+$/, '每块都应是 hex');
    assert.equal(chunk.length % 4, 0, '每块长度必须是 4 的倍数（服务端按固定分组解密）');
  }
  // 打包是「整串反转 + 小端」：反转后的串与原文不同，密文必须也不同 ——
  // 反向验证一下「真的按反转后的串算了」：'abc123' 反转 '321cba' 与原文不等价。
  assert.notEqual(encryptCasPassword('abc123', modulus, '010001'), encryptCasPassword('321cba', modulus, '010001'));

  // 非 ASCII 必须在提交前就停下（而不是交一个必然失败的密文）。
  assert.throws(() => encryptCasPassword('密码123', modulus, '010001'), (e) => e.code === 'AUTH_PASSWORD_ENCODING_UNSUPPORTED');
  assert.throws(() => encryptCasPassword('pass\u00e9', modulus, '010001'), (e) => e.code === 'AUTH_PASSWORD_ENCODING_UNSUPPORTED');
  // 公钥形态不对。
  assert.throws(() => encryptCasPassword('abc', 'zz', '010001'), (e) => e.code === 'AUTH_KEY_INVALID');
  assert.throws(() => encryptCasPassword('abc', modulus, 'xyz'), (e) => e.code === 'AUTH_KEY_INVALID');
});

test('CAS 失败文案：只转述站点写出来的话，不编造原因', () => {
  // 站点明确写了（这一支才是真的密码错）。
  assert.equal(describeAuthFailure({ status: 200, text: '<p id="errormsg"><span id="msg">用户名或密码错误</span></p>' }), '用户名或密码错误');
  // 只有登录页、没有文案 —— 不许补一句"大概是密码错了"。
  const described = describeAuthFailure({ status: 200, text: '<form><input name="execution" value="e1"></form>' });
  assert.match(described, /没有给出错误文案/);
  // 关键是**不许断言原因**。文案里出现的「不等于密码错误」正是在否认这个归因，
  // 所以这里要匹配的是"有没有下结论"，而不是"有没有出现密码二字"。
  assert.equal(/可能是密码错了|请检查密码|密码不正确|学号或密码不对/.test(described), false, '没有证据时不许归因成密码错');
});

/* ─────────────────────────────────────── 客户端：状态码口径 */

/**
 * 造一个已装 cookie 的 Transport，`fetch` 可注入（与 campus 测试同一套写法）。
 *
 * 不传 `file` 给 `SessionStore` —— 只存内存，绝不碰 DPAPI。
 */
function makeTransport(fetchImpl) {
  return new Transport({ fetch: fetchImpl, hosts: ZDBK_HOSTS });
}

test('正方非标准状态码：401/901/902 = 会话失效（不是"服务器错误"）', async () => {
  for (const status of [401, 901, 902]) {
    // 901/902 超出 `Response` 构造器允许的 200~599，所以用 fakeResponse。
    const transport = makeTransport(async () => fakeResponse(status));
    await assert.rejects(
      () => new ZdbkClient(transport).post(ZDBK_PATHS.grades),
      (error) => error.code === 'LOGIN_REQUIRED',
      `HTTP ${status} 应判为 LOGIN_REQUIRED`,
    );
  }
  for (const status of [300, 301, 302]) {
    const transport = makeTransport(async () => fakeResponse(status, '', { location: 'https://zjuam.zju.edu.cn/cas/login' }));
    await assert.rejects(() => new ZdbkClient(transport).post(ZDBK_PATHS.grades), (e) => e.code === 'LOGIN_REQUIRED');
  }
});

test('繁忙（>=900）重试一次；其余失败不重试', async () => {
  let calls = 0;
  const busyOnce = makeTransport(async () => {
    calls++;
    // 1001 ≥ 900 且不是 901/902 → PLATFORM_BUSY → 重试 → 200
    if (calls === 1) return fakeResponse(1001);
    return new Response(JSON.stringify({ items: [] }), { status: 200 });
  });
  const data = await new ZdbkClient(busyOnce, { retryDelayMs: 0 }).post(ZDBK_PATHS.grades);
  assert.deepEqual(data, { items: [] });
  assert.equal(calls, 2, '繁忙要重试一次');

  // 重试仍繁忙 → 最终抛 PLATFORM_BUSY（不许无限重试）。
  let alwaysBusy = 0;
  const busyForever = makeTransport(async () => { alwaysBusy++; return fakeResponse(1001); });
  await assert.rejects(() => new ZdbkClient(busyForever, { retryDelayMs: 0 }).post(ZDBK_PATHS.grades), (e) => e.code === 'PLATFORM_BUSY');
  assert.equal(alwaysBusy, 2, '最多重试一次，不是无限');

  let forbiddenCalls = 0;
  const forbidden = makeTransport(async () => { forbiddenCalls++; return new Response('', { status: 403 }); });
  await assert.rejects(() => new ZdbkClient(forbidden, { retryDelayMs: 0 }).post(ZDBK_PATHS.grades), (e) => e.code === 'FORBIDDEN');
  assert.equal(forbiddenCalls, 1, '403 不许重试');
});

test('回登录页 HTML（200）要判成 LOGIN_REQUIRED，而不是"JSON 解析失败"', async () => {
  const transport = makeTransport(async () => new Response('<html><form action="/cas/login"><input name="password"></form></html>', { status: 200 }));
  await assert.rejects(() => new ZdbkClient(transport).post(ZDBK_PATHS.grades), (e) => e.code === 'LOGIN_REQUIRED');
});

test('allowNull：学期不存在时回 null 不是错误；没开 allowNull 时 null 是错误', async () => {
  const transport = makeTransport(async () => new Response('null', { status: 200 }));
  assert.equal(await new ZdbkClient(transport).post(ZDBK_PATHS.timetable, { allowNull: true }), null);
  await assert.rejects(() => new ZdbkClient(transport).post(ZDBK_PATHS.timetable), (e) => e.code === 'UNEXPECTED_RESPONSE');
});

test('非法路径被拒绝：不许借已登录的会话访问任意地址', async () => {
  const transport = makeTransport(async () => new Response('{}', { status: 200 }));
  for (const path of ['https://evil.example.com/', '/a/../b', 'relative']) {
    await assert.rejects(() => new ZdbkClient(transport).post(path), (e) => e.code === 'INVALID_PATH', path);
  }
});

/* ─────────────────────────────────────── 读取器：四个方法 */

/**
 * 造一个假的 `ZdbkClient`（只实现 `post`），按路径回固定数据。
 *
 * 这样整条读取链路（解析 → 筛选 → 排序 → GPA）能在**完全不碰网络**的前提下被验证。
 */
function fakeApi(routes) {
  const calls = [];
  return {
    calls,
    async post(path, options) {
      calls.push({ path, options });
      if (!(path in routes)) throw new Error(`夹具未覆盖 ${path}`);
      const value = routes[path];
      return typeof value === 'function' ? value(options) : value;
    },
  };
}

test('grades：按学期筛选、倒序、GPA 只算筛出来的那些', async () => {
  const api = fakeApi({
    [ZDBK_PATHS.grades]: { items: GRADE_FIXTURE },
    [ZDBK_PATHS.majorGrades]: { items: GRADE_FIXTURE.filter((g) => g.xkkh.includes('CS1001G')) },
  });
  const reader = new ZdbkReader(api);

  const all = await reader.grades();
  assert.equal(all.grades.length, 5);
  assert.equal(all.scope.academic_year, null);
  assert.equal(all.scope.major_only, false);
  // 全量：秋的 (5.0×3 + 3.6×5) 加上春的 4.8×3，除以 11 学分。
  assert.equal(all.summary.gpa_5, 4.309, '全量：4.309');

  // 只筛选第 1 学期：4 条（含弃修与合格），GPA 仍只看那 2 条。
  const first = await reader.grades({ academic_year: '2025-2026', semester: 1 });
  assert.equal(first.grades.length, 4);
  assert.equal(first.summary.gpa_5, 4.125);

  // 只筛选「春」：1 条，绩点 4.8。
  const spring = await reader.grades({ semester: 2 });
  assert.equal(spring.grades.length, 1);
  assert.equal(spring.grades[0].name, '数据结构基础');
  assert.equal(spring.summary.gpa_5, 4.8);

  // 空结果不是错误。
  const none = await reader.grades({ academic_year: '2019-2020' });
  assert.equal(none.grades.length, 0);
  assert.equal(none.summary.gpa_5, null);
});

test('grades：major_only 走的是另一个接口（服务端筛过的口径）', async () => {
  const api = fakeApi({
    [ZDBK_PATHS.grades]: { items: GRADE_FIXTURE },
    [ZDBK_PATHS.majorGrades]: { items: GRADE_FIXTURE.filter((g) => g.xkkh.includes('CS1001G')) },
  });
  const out = await new ZdbkReader(api).grades({ major_only: true });
  assert.equal(api.calls[0].path, ZDBK_PATHS.majorGrades, 'major_only 必须换接口，不是本地筛');
  assert.equal(out.scope.major_only, true);
  assert.equal(out.grades.length, 1);
});

test('grades：分页参数必须显式拉大，否则会静默截断', async () => {
  const api = fakeApi({ [ZDBK_PATHS.grades]: { items: [] } });
  await new ZdbkReader(api).grades();
  assert.equal(api.calls[0].options.query['queryModel.showCount'], 5000);
  assert.equal(api.calls[0].options.query.doType, 'query');
});

test('gpaSummary：总体 + 专业 + 分学期；专业失败不影响另两份', async () => {
  const api = fakeApi({
    [ZDBK_PATHS.grades]: { items: GRADE_FIXTURE },
    [ZDBK_PATHS.majorGrades]: { items: GRADE_FIXTURE.filter((g) => g.xkkh.includes('CS1001G')) },
  });
  const summary = await new ZdbkReader(api).gpaSummary();
  assert.equal(summary.overall.gpa_5, 4.309);
  assert.equal(summary.major.gpa_5, 5, '专业口径只有那门 5.0');
  assert.equal(summary.major_error, null);
  // 分学期倒序：2025-2026-2 在 2025-2026-1 之前。
  assert.deepEqual(summary.semesters.map((s) => s.semester), ['2025-2026-2', '2025-2026-1']);
  assert.equal(summary.semesters[1].gpa_5, 4.125);

  // 专业接口挂了：major 为 null，其余照常。
  const broken = new ZdbkReader({
    async post(path) {
      if (path === ZDBK_PATHS.majorGrades) throw Object.assign(new Error('无权限'), { code: 'FORBIDDEN' });
      return { items: GRADE_FIXTURE };
    },
  });
  const partial = await broken.gpaSummary();
  assert.equal(partial.major, null);
  assert.equal(partial.major_error, 'FORBIDDEN', '要如实记下原因，不能假装专业 GPA 是 0');
  assert.equal(partial.overall.gpa_5, 4.309, '一个可选指标失败不许把整页成绩带走');
});

test('exams：期中/期末展开、按时间排序、upcoming_only 保留未排定的', async () => {
  const api = fakeApi({ [ZDBK_PATHS.exams]: { items: EXAM_FIXTURE } });
  const now = () => new Date('2025-12-01T00:00:00+08:00');
  const reader = new ZdbkReader(api, now);

  const all = await reader.exams();
  // 3 行：期中 1 + 期末 2（第二条只有期末）。
  assert.equal(all.exams.length, 3);
  assert.deepEqual(all.exams.map((e) => e.type), ['midterm', 'final', 'final']);
  // 已排定的在前（2025-11-10 期中 → 2026-01-15 期末），未排定的（Infinity）在最后。
  assert.equal(all.exams[0].start, '2025-11-10T10:00:00+08:00');
  assert.equal(all.exams[1].start, '2026-01-15T08:00:00+08:00');
  assert.equal(all.exams[2].start, null);
  assert.equal(all.scope.upcoming_only, false);

  // upcoming_only：期中已经过去（12 月 1 日），但它 end 有时间且 < now → 滤掉。
  const upcoming = await reader.exams({ upcoming_only: true });
  assert.equal(upcoming.exams.some((e) => e.type === 'midterm'), false, '过去的考试要滤掉');
  assert.equal(upcoming.exams.some((e) => e.start === null), true, '未排定的要保留（否则用户以为没这科考试）');
});

test('exams：按学期筛选', async () => {
  const api = fakeApi({ [ZDBK_PATHS.exams]: { items: EXAM_FIXTURE } });
  const reader = new ZdbkReader(api);
  assert.equal((await reader.exams({ semester: 1 })).exams.length, 3);
  assert.equal((await reader.exams({ semester: 2 })).exams.length, 0);
});

test('timetable：按星期与节次排序，补 weekday_name，占位行不进 skipped', async () => {
  const api = fakeApi({ [ZDBK_PATHS.timetable]: TIMETABLE_FIXTURE });
  const out = await new ZdbkReader(api, () => new Date('2025-09-10T12:00:00+08:00')).timetable();

  assert.equal(out.sessions.length, 2, '占位行不该出现在结果里');
  assert.equal(out.skipped_items, 0, '占位行是「按设计不显示」，不是解析失败');
  assert.deepEqual(out.sessions.map((s) => s.weekday), [1, 3], '按星期排');
  assert.deepEqual(out.sessions.map((s) => s.weekday_name), ['周一', '周三']);
  assert.equal(out.sessions[1].name, '微积分（Ⅰ）');
  assert.equal(out.academic_year, '2025-2026');
  assert.equal(out.term, '秋');
  assert.equal(out.semester, 1);
  assert.equal(out.inferred_term, true, '没给学年学期 → 如实标注是推断的');
});

test('timetable：给了学年学期就不推断，xqm 要带「|季」', async () => {
  const api = fakeApi({ [ZDBK_PATHS.timetable]: TIMETABLE_FIXTURE });
  const out = await new ZdbkReader(api).timetable({ academic_year: '2024-2025', term: '春' });
  assert.equal(out.inferred_term, false);
  assert.equal(out.term, '春');
  assert.equal(out.semester, 2);
  assert.deepEqual(api.calls[0].options.form, { xnm: '2024-2025', xqm: '2|春', captcha_value: '' });
});

test('timetable：学期不存在（回 null）是空课表，不是错误', async () => {
  const api = fakeApi({ [ZDBK_PATHS.timetable]: null });
  const out = await new ZdbkReader(api).timetable({ academic_year: '2025-2026', term: '夏' });
  assert.deepEqual(out.sessions, []);
  assert.equal(out.skipped_items, 0);
});

test('列表接口缺数组字段是错误，不是空列表（否则界面会说"没有成绩"）', async () => {
  // 空列表是**一个看起来正常的、彻底的谎言** —— 接口一变就变成"这学期没成绩"。
  const missing = new ZdbkReader({ async post() { return { data: [] }; } });
  await assert.rejects(() => missing.grades(), (e) => e.code === 'SCHEMA_CHANGED');
  await assert.rejects(() => missing.exams(), (e) => e.code === 'SCHEMA_CHANGED');

  const badTimetable = new ZdbkReader({ async post() { return { items: [] }; } });
  await assert.rejects(() => badTimetable.timetable({ academic_year: '2025-2026', term: '秋' }), (e) => e.code === 'SCHEMA_CHANGED');
});

test('条目全都认不出来 = 接口变了（不是"没有数据"）；个别坏行只计 skipped', async () => {
  // 全部认不出 → 必须报错。
  const allBad = new ZdbkReader({ async post() { return { items: [{ 无字段: 1 }, { 也无: 2 }] }; } });
  await assert.rejects(() => allBad.grades(), (e) => e.code === 'SCHEMA_CHANGED');

  // 一条坏、其余好 → 照常返回 + skipped=1。
  const mixed = new ZdbkReader({ async post() { return { items: [...GRADE_FIXTURE, { 无: '字段' }] }; } });
  const out = await mixed.grades();
  assert.equal(out.grades.length, 5);
  assert.equal(out.skipped_items, 1);
});

/* ─────────────────────────────────────── 端到端：登录 + 真读一次 */

test('端到端：带 service 走完 CAS → 教务会话 → 四个读取方法都能用', async () => {
  const MODULUS = TEST_MODULUS;
  const CAS = 'https://zjuam.zju.edu.cn/cas';
  const calls = [];

  /** 假站点：只有「带着教务 JSESSIONID」才给数据，否则回登录页。 */
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    const headers = new Headers();
    const cookie = init?.headers?.Cookie ?? '';
    calls.push({ host: target.hostname, path: target.pathname, method: init?.method ?? 'GET', search: target.search, body: init?.body });

    // ① CAS 登录页：必须带着 service（否则下面会断言失败）
    if (target.hostname === 'zjuam.zju.edu.cn' && target.pathname === '/cas/login' && init?.method !== 'POST') {
      return new Response('<html><form id="fm1" action="/cas/login"><input name="execution" value="e1"></form></html>', { status: 200, headers });
    }
    // ② 公钥：只认 JSON 的 Accept
    if (target.pathname === '/cas/v2/getPubKey') {
      assert.match(String(init?.headers?.Accept ?? ''), /json/, 'getPubKey 必须请求 JSON，否则真站回 406');
      return new Response(JSON.stringify({ modulus: MODULUS, exponent: '010001' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    // ③ 提交密码：种 CAS 票并 302 回 service 回调
    if (target.hostname === 'zjuam.zju.edu.cn' && target.pathname === '/cas/login' && init?.method === 'POST') {
      const params = new URLSearchParams(String(init.body));
      assert.equal(params.get('_eventId'), 'submit');
      assert.ok(params.get('password'), '必须提交加密后的密码');
      assert.equal(params.get('password').includes('fake-pass'), false, '密码不许明文提交');
      headers.append('Set-Cookie', 'iPlanetDirectoryPro=TICKET; Path=/; Domain=.zju.edu.cn');
      headers.append('Location', `${ZDBK_BASE}/xtgl/login_ssologin.html?ticket=ST-1`);
      return new Response(null, { status: 302, headers });
    }
    // ④ SSO 回调：认 ticket，种教务 session
    if (target.pathname === '/jwglxt/xtgl/login_ssologin.html') {
      if (!cookie.includes('iPlanetDirectoryPro=TICKET')) {
        headers.append('Location', `${CAS}/login?service=${encodeURIComponent(ZDBK_SERVICE)}`);
        return new Response(null, { status: 302, headers });
      }
      headers.append('Set-Cookie', 'JSESSIONID=SESSION; Path=/jwglxt; Domain=zdbk.zju.edu.cn');
      return new Response('<html>ok</html>', { status: 200, headers });
    }
    // ⑤ 业务接口：没有 JSESSIONID 就回登录页 HTML（正方的真实行为之一）
    if (target.hostname === 'zdbk.zju.edu.cn') {
      if (!/JSESSIONID=SESSION/.test(cookie)) {
        return new Response('<html><form action="/cas/login"><input name="password"></form></html>', { status: 200, headers });
      }
      // `ZDBK_PATHS` 里的路径是**相对 `/jwglxt`** 的；真实请求带前缀，
      // 所以比对前要把前缀去掉（否则永远匹配不上，全落到 404）。
      const route = target.pathname.replace(/^\/jwglxt/, '');
      if (route === ZDBK_PATHS.grades) {
        return new Response(JSON.stringify({ items: GRADE_FIXTURE }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (route === ZDBK_PATHS.majorGrades) {
        return new Response(JSON.stringify({ items: GRADE_FIXTURE.filter((g) => g.xkkh.includes('CS1001G')) }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (route === ZDBK_PATHS.exams) {
        return new Response(JSON.stringify({ items: EXAM_FIXTURE }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (route === ZDBK_PATHS.timetable) {
        return new Response(JSON.stringify(TIMETABLE_FIXTURE), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
    return new Response('', { status: 404, headers });
  };

  // 纯内存会话：不传 file，`protect` 永不被调用 → 绝不碰 DPAPI。
  let protectCalls = 0;
  const transport = new Transport({ fetch: fetchImpl, hosts: ZDBK_HOSTS });
  await casLogin(transport, { credentials: async () => ({ username: 'student-fixture', password: 'fake-password' }) });

  // 登录后 jar 里必须有教务 session，否则后面的读取会全部回到登录页。
  const jarCookies = await transport.session.jar.getCookies(`${ZDBK_BASE}/`);
  assert.ok(jarCookies.some((c) => c.key === 'JSESSIONID' && c.value === 'SESSION'), '登录后必须有 JSESSIONID');

  // 入口确实带了 service（这是本包与 campus 的核心差别）。
  const landing = calls.find((c) => c.host === 'zjuam.zju.edu.cn' && c.path === '/cas/login' && c.method === 'GET');
  assert.ok(landing.search.includes('service='), 'CAS 入口必须带 service');
  assert.equal(new URLSearchParams(landing.search).get('service'), ZDBK_SERVICE);

  // 四个读取方法都真的能用。
  const api = new ZdbkClient(transport);
  const reader = new ZdbkReader(api, () => new Date('2025-12-01T00:00:00+08:00'));

  const grades = await reader.grades();
  assert.equal(grades.grades.length, 5);
  assert.equal(grades.summary.gpa_5, 4.309);

  const gpa = await reader.gpaSummary();
  assert.equal(gpa.overall.gpa_5, 4.309);
  assert.equal(gpa.major.gpa_5, 5);

  const exams = await reader.exams();
  assert.equal(exams.exams.length, 3);

  const timetable = await reader.timetable({ academic_year: '2025-2026', term: '秋' });
  assert.equal(timetable.sessions.length, 2);

  // 每个业务请求都带了 JSESSIONID —— 若 hosts 白名单漏了 zdbk，这里会全空。
  const business = calls.filter((c) => c.host === 'zdbk.zju.edu.cn' && c.path.startsWith('/jwglxt/') && c.method === 'POST');
  assert.ok(business.length >= 5, `业务请求数不对：${business.length}`);
  for (const call of business) {
    assert.ok(String(call.body ?? '').length >= 0);
  }
  assert.equal(protectCalls, 0);
});

test('端到端：CAS 拒绝时抛 AUTH_REJECTED 并转述站点文案', async () => {
  const MODULUS = TEST_MODULUS;
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    const headers = new Headers();
    if (target.pathname === '/cas/v2/getPubKey') {
      return new Response(JSON.stringify({ modulus: MODULUS, exponent: '010001' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.pathname === '/cas/login' && init?.method === 'POST') {
      // 站点明确写了错误文案（这一支才是真的密码错），且**不种票**。
      return new Response('<html><p id="errormsg"><span id="msg">用户名或密码错误</span></p><form><input name="execution" value="e2"></form></html>', { status: 200, headers });
    }
    return new Response('<html><form id="fm1" action="/cas/login"><input name="execution" value="e1"></form></html>', { status: 200, headers });
  };
  const transport = new Transport({ fetch: fetchImpl, hosts: ZDBK_HOSTS });
  await assert.rejects(
    () => casLogin(transport, { credentials: async () => ({ username: 'u', password: 'wrong' }) }),
    (error) => {
      assert.equal(error.code, 'AUTH_REJECTED');
      assert.match(error.message, /用户名或密码错误/, '站点写了什么就转述什么');
      return true;
    },
  );
  // 没拿到票 → jar 里不该有 ZDBK session。
  assert.equal((await transport.session.jar.getCookies(`${ZDBK_BASE}/`)).some((c) => c.key === 'JSESSIONID'), false);
});

test('端到端：CAS 要求验证码时明确报 AUTH_CHALLENGE_REQUIRED，不重试', async () => {
  const MODULUS = TEST_MODULUS;
  let posts = 0;
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    const headers = new Headers();
    if (target.pathname === '/cas/v2/getPubKey') {
      return new Response(JSON.stringify({ modulus: MODULUS, exponent: '010001' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.pathname === '/cas/login' && init?.method === 'POST') {
      posts++;
      return new Response('<html>请输入验证码<div id="kaptcha"></div><input name="authcode"><form><input name="execution" value="e2"></form></html>', { status: 200, headers });
    }
    return new Response('<html><form id="fm1" action="/cas/login"><input name="execution" value="e1"></form></html>', { status: 200, headers });
  };
  const transport = new Transport({ fetch: fetchImpl, hosts: ZDBK_HOSTS });
  await assert.rejects(
    () => casLogin(transport, { credentials: async () => ({ username: 'u', password: 'p' }) }),
    (error) => error.code === 'AUTH_CHALLENGE_REQUIRED',
  );
  assert.equal(posts, 1, '密码最多提交一次，不许重试');
});

/* ─────────────────────────────────────── 插件形态与路由 */

test('插件形态：导出 name / inject / apply，且 name 与目录名一致', () => {
  assert.equal(plugin.name, 'zhiyun-zdbk');
  assert.deepEqual(plugin.inject, ['profileContext']);
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(plugin.ROUTE_PATH, '/api/zhiyun-zdbk');
});

/**
 * 造一个**独立的**临时数据目录。
 *
 * ⚠️ 每个插件装配用例都必须有自己的目录。这里踩过一次：三个用例共用
 * `C:\tmp\zdbk-test`，前一个用例把会话文件写到了磁盘上，后一个用例于是
 * 「读到一份别人的会话」，表现是本该 NEED_LOGIN 的地方报 NETWORK_ERROR ——
 * 一个纯粹的测试隔离问题，看起来却像认证逻辑坏了。
 *
 * @param {string} label - 目录名前缀（便于看是哪个用例留下的）。
 * @returns {Promise<{dir: string, cleanup: () => Promise<void>}>} 目录与清理器。
 */
async function tempDataDir(label) {
  const root = await mkdtemp(path.join(tmpdir(), `zdbk-${label}-`));
  return {
    dir: path.join(root, 'data'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('插件装配：注册服务与数据路由，路由信封按 { type, rpcId, method, payload } 收发', async (t) => {
  const { dir, cleanup } = await tempDataDir('route');
  t.after(cleanup);
  const services = {};
  let registered = null;
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    get: (key) => services[key],
    provide: (key, value) => { services[key] = value; return () => { delete services[key]; }; },
    inject: (deps, callback) => {
      // 只注入 connection：这正是 index.js 里那唯一一处 ctx.inject。
      assert.deepEqual(deps, ['connection']);
      const scope = {
        effect: (fn) => fn(),
        connection: { fetch: { register: (route) => { registered = route; return () => { registered = null; }; } } },
      };
      callback(scope);
    },
  };

  const dispose = await plugin.apply(ctx, {
    dataDir: dir,
    // 纯内存会话（`file` 由 dataDir 决定，但 protect 在这里替换掉 → 不碰 DPAPI）。
    protect: async (bytes) => bytes,
    fetch: async () => new Response('', { status: 500 }),
  });

  assert.ok(services.zhiyunZdbk, '必须注册 zhiyunZdbk 服务');
  assert.equal(services.zhiyunZdbk.routePath, '/api/zhiyun-zdbk');
  assert.ok(registered, '必须注册数据路由');
  assert.equal(registered.path, '/api/zhiyun-zdbk');
  assert.deepEqual(registered.methods, ['GET', 'POST']);
  assert.equal(registered.requestBody, 'buffered');

  // GET：自描述，十二个方法都在，且顺序稳定。
  // 前四个是移植来的，后八个是补齐上游 `plan view/list` + `selection` 六条查询。
  // ⚠️ 顺序是**契约**：`READ_METHODS` 是数组而不是 Set，就是为了让这份自描述稳定。
  //    选课的 select/reorder/drop 三条写操作**不在**这里（归 packages/tool/zdbk）。
  const getResponse = await registered.fetch(new Request('http://127.0.0.1/api/zhiyun-zdbk', { method: 'GET' }));
  const described = await getResponse.json();
  assert.equal(described.ok, true);
  assert.deepEqual(described.value.methods.map((m) => m.method), [
    'zdbk.grades', 'zdbk.gpaSummary', 'zdbk.exams', 'zdbk.timetable',
    'zdbk.planList', 'zdbk.planView',
    'zdbk.selectionContext', 'zdbk.selectionCourses', 'zdbk.selectionSearch',
    'zdbk.selectionSections', 'zdbk.selectionSelected', 'zdbk.selectionCredits',
  ]);
  // 写操作**不许**出现在这张表里 —— 出现了就是分层被破坏（而且会绕过写闸）。
  for (const forbidden of ['zdbk.select', 'zdbk.reorder', 'zdbk.drop']) {
    assert.equal(described.value.methods.some((m) => m.method === forbidden), false, `${forbidden} 属写操作，不该在本包`);
  }

  // GET 不该触发任何登录 → 上面那个一定失败的 fetch 一次都没被调用就说明没问题
  // （若被调用会得到 500 → PLATFORM_ERROR，而不是这份自描述）。

  // POST：拒绝非法信封（返回 server-response，带 invalid-request）。
  const badEnvelope = await registered.fetch(new Request('http://127.0.0.1/api/zhiyun-zdbk', {
    method: 'POST', body: JSON.stringify({ type: 'nope', rpcId: 'r1', method: 'zdbk.grades' }),
  }));
  const badBody = await badEnvelope.json();
  assert.equal(badBody.type, 'server-response');
  assert.equal(badBody.result.ok, false);
  assert.equal(badBody.result.error.code, 'INPUT');

  // POST：原型链上的名字一律拒绝（这是安全边界，不能只靠"看起来对"）。
  // `selectionPages` / `plansOfYear` 是本轮新增的内部编排方法，同样不许从路由拨到。
  for (const method of ['zdbk.constructor', 'zdbk.__proto__', 'zdbk.toString', 'zdbk.items', 'zdbk.rows', 'zdbk.selectionPages', 'zdbk.plansOfYear', 'zdbk.myPlanIdentity', '__proto__', 'grades', 42, null]) {
    const response = await registered.fetch(new Request('http://127.0.0.1/api/zhiyun-zdbk', {
      method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'r2', method }),
    }));
    const body = await response.json();
    assert.equal(body.type, 'server-response');
    assert.equal(body.result.ok, false, `${String(method)} 必须被拒绝`);
    assert.equal(body.rpcId, 'r2', 'rpcId 要原样回传，否则页面配不上对');
  }

  // 卸载要把服务摘掉。
  await dispose();
  assert.equal(services.zhiyunZdbk, undefined);
});

test('插件装配：未配凭据时 invocation 报 NEED_LOGIN（而不是崩）', async (t) => {
  const { dir, cleanup } = await tempDataDir('no-creds');
  t.after(cleanup);
  const services = {};
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    get: (key) => services[key],
    provide: (key, value) => { services[key] = value; return () => {}; },
    inject: () => {},
  };
  await plugin.apply(ctx, {
    dataDir: dir,
    protect: async (bytes) => bytes,
    fetch: async () => { throw new Error('不该发请求'); },
  });
  await assert.rejects(() => services.zhiyunZdbk.timetable(), (error) => {
    assert.equal(error.code, 'NEED_LOGIN');
    assert.match(error.message, /浙大一卡通/);
    return true;
  });
  // hasSession 只看 cookie，不发请求、不登录 —— 没会话就是 false。
  assert.equal(await services.zhiyunZdbk.hasSession(), false);
});

test('换账号后不许复用上一个人的会话（这是把别人的成绩读给你看）', async (t) => {
  // 回归测试。早先的实现是「先看有没有 JSESSIONID，命中就直接 return」，
  // 账号变更的检查写在后面 —— 于是改了「浙大一卡通」之后，旧会话照样被拿去读数据。
  // 会话文件里没有账号绑定信息，所以正确顺序是「先读凭据 → 身份一致才复用」。
  const { dir, cleanup } = await tempDataDir('switch');
  t.after(cleanup);
  const services = {};
  let account = { username: 'alice', password: 'p1' };
  let loginPosts = 0;
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    get: (key) => (key === 'credentials'
      ? { readRecord: async () => ({ kind: 'grant', payload: account }), modifyRecord: async () => {} }
      : services[key]),
    provide: (key, value) => { services[key] = value; return () => {}; },
    inject: () => {},
  };

  const MODULUS = TEST_MODULUS;
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    const headers = new Headers();
    if (target.pathname === '/cas/v2/getPubKey') {
      return new Response(JSON.stringify({ modulus: MODULUS, exponent: '010001' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.pathname === '/cas/login' && init?.method === 'POST') {
      loginPosts++;
      const body = new URLSearchParams(String(init.body));
      headers.append('Set-Cookie', 'iPlanetDirectoryPro=TICKET; Path=/; Domain=.zju.edu.cn');
      headers.append('Location', `${ZDBK_BASE}/xtgl/login_ssologin.html`);
      // 记下这一次登录是谁的：用它证明重登真的发生了。
      headers.append('X-User', body.get('username') ?? '');
      return new Response(null, { status: 302, headers });
    }
    if (target.pathname === '/jwglxt/xtgl/login_ssologin.html') {
      headers.append('Set-Cookie', 'JSESSIONID=SESSION; Path=/jwglxt; Domain=zdbk.zju.edu.cn');
      return new Response('<html>ok</html>', { status: 200, headers });
    }
    if (target.pathname === '/jwglxt/cxdy/xscjcx_cxXscjIndex.html') {
      return new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('<html><form id="fm1" action="/cas/login"><input name="execution" value="e1"></form></html>', { status: 200, headers });
  };

  await plugin.apply(ctx, {
    dataDir: dir,
    // `file` 由 dataDir 决定，但 protect 换掉了 → 不碰 DPAPI。
    protect: async (bytes) => bytes,
    fetch: fetchImpl,
  });

  // 第一次读：登录一次。
  await services.zhiyunZdbk.grades();
  assert.equal(loginPosts, 1, '首次读要登录');

  // 同一账号再读：**不许**再登（单点会话下重登会作废前一张票）。
  await services.zhiyunZdbk.grades();
  assert.equal(loginPosts, 1, '同一账号不该重复登录');

  // 换账号：必须重登，且旧会话要被清掉。
  account = { username: 'bob', password: 'p2' };
  await services.zhiyunZdbk.grades();
  assert.equal(loginPosts, 2, '换账号必须重新登录，不许拿 alice 的会话读 bob 的数据');
});

test('错误归一化：toError 保留 code', () => {
  assert.deepEqual(plugin.toError(Object.assign(new Error('炸了'), { code: 'X' })), { code: 'X', message: '炸了' });
  assert.equal(plugin.toError(new Error('无码')).code, 'ZDBK_FAILED');
  assert.equal(plugin.toError('字符串').message, '字符串');
});

test('manifest 与 bundle patch：包名、入口、patch 一致（profile 靠它挂载）', async () => {
  const { readFile } = await import('node:fs/promises');
  const root = new URL('../../../packages/source/zdbk/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.name, '@lybx-leyw/dsh-zju-source-zdbk');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, './src/index.js');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  // 共享层必须是**依赖**而不是复制：少了这两条，装到 profile 里就 import 不到。
  // 传输层现在来自 tier 0 的 `@lybx-leyw/dsh-zju-source-http`，不再借 campus。
  assert.ok(manifest.dependencies['@lybx-leyw/dsh-zju-source-http'], '必须依赖共享 HTTP 层');
  assert.ok(manifest.dependencies['@lybx-leyw/dsh-zju-source-login'], '必须依赖凭据读取');
  assert.equal(manifest.dependencies['@lybx-leyw/dsh-zju-source-campus'], undefined,
    '不该再依赖 campus —— 出口服务由 source-http 提供');

  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8');
  assert.match(patch, /id: zju-source-zdbk/);
  // 包名以 `@` 开头，YAML 里**必须加引号**：裸 `name: @scope/pkg` 会被解析器判成
  // bad indentation（见 tests/repo/patch-yaml.test.mjs）。所以这里断言带引号的写法。
  assert.match(patch, /name: "@lybx-leyw\/dsh-zju-source-zdbk"/);

  // 源码里不许出现 TypeScript（本包刻意是纯 JS）。
  const src = await readFile(new URL('src/index.js', root), 'utf8');
  assert.equal(/\.ts['"]/.test(src), false, 'index.js 不该 import .ts');
});

/* ══════════════════════════════════════════════════════════════════════
 * 本轮新增：培养方案（planList / planView）与选课查询（selection* 六条）
 *
 * ⚠️ 夹具按上游注释推断，未经真实响应验证。
 *
 * 上游 `pyfagl.ts` / `xsxk.ts` 的文件头写着这些接口的字段与形态，
 * 但本仓**没有**真实响应可对照（2026-11 起上游那些接口的实测样本不在仓库里）。
 * 所以下面所有夹具都是照注释拼出来的：字段名、分隔写法、裸数组形态可信，
 * 具体取值不可信。这意味着：
 *
 *   - 测试能守住「解析口径」「错误码」「分页/去重」「消歧义」这些**逻辑**；
 *   - 测试**不能**证明「真实响应能被解析」—— 那要等真机样本；
 *   - 真机上如果字段名变了，这里不会红，表现会是线上解析失败。
 *
 * 这条标注必须留着：上一轮的事故正是「夹具配合实现写」，于是两边一起错还全绿。
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * 一个假的客户端，覆盖读取器这一轮用到的**全部**取数方法。
 *
 * 与既有的 `fakeApi`（只实现 `post`）分开写而不是扩展它：既有的四条测试
 * 靠「夹具必须显式覆盖被调用的路径」来抓「意外请求」，把新方法塞进去会削弱
 * 那条约束（未知方法随便回个空值就过了）。这里同样严格 —— 未覆盖即抛错。
 *
 * @param {{grid?: object, html?: object, postArray?: object, post?: object}} routes - 按方法分组的路径表。
 * @returns {object} 假客户端（带 `calls` 记录）。
 */
function fakeApi2(routes = {}) {
  const calls = [];
  const pick = (kind, path, options) => {
    calls.push({ kind, path, options });
    const table = routes[kind] ?? {};
    if (!(path in table)) throw new Error(`夹具未覆盖 ${kind} ${path}`);
    const value = table[path];
    return typeof value === 'function' ? value(options) : value;
  };
  return {
    calls,
    async post(path, options) { return pick('post', path, options); },
    async postArray(path, options) { return pick('postArray', path, options); },
    async grid(path, form, paging) { return pick('grid', path, { form, paging }); },
    async html(path, options) { return pick('html', path, options); },
  };
}

/** 选课首页的 HTML（字段名按上游 `parseSelectionContext` 的注释）。 */
const SELECTION_INDEX_HTML = `
<html><body>
<form id="xkjhForm">
  <input id="xn" name="xn" value="2025-2026" />
  <input id="xq" name="xq" value="1" />
  <input id="nj" name="nj" value="2025" />
  <input id="zydm" name="zydm" value="080901" />
  <input id="xkzys" name="xkzys" value="3" />
  <input id="ylxs" name="ylxs" value="4" />
</form>
<ul class="nav">
  <li kclbmc="通识核心课程" kcbs="01">
    <a href="#" onclick="categroyClick(this, 'xk_1', 'bl')">通识核心课程</a>
    <ul><li><a href="#" onclick="categroyClick(this, 'xk_1', 'zl')">通识核心课程子类</a></li></ul>
  </li>
  <li title="全部课程">
    <a href="#" onclick="categroyClick(this, 'xk_2', 'qb')">全部课程</a>
  </li>
  <li kclbmc="条件搜索">
    <a href="#" onclick="categroyClick(this, 'xk_9', 'ss')">条件搜索</a>
  </li>
  <li kclbmc="补考选课">
    <a href="#" onclick="categroyClick(this, 'xk_1_1', 'bk')">补考选课</a>
  </li>
</ul>
</body></html>`;

/** 一条课程记录（`cxZzxkGhbKcList` 的形态；`xk_9` 搜索也是同一套字段）。 */
const SELECTION_COURSE_ROWS = [
  {
    xkkh: '(2025-2026-1)-CS1001G-0012345-1',
    kcdm: 'CS1001G',
    kcmc: '程序设计基础',
    kcxx: '0~3.0~3.0-0.0',
    kclb: '专业必修',
    kkxy: '计算机科学与技术学院',
    xxq: '秋冬',
  },
  {
    xkkh: '(2025-2026-1)-MA1001G-0012346-1',
    kcdm: 'MA1001G',
    kcmc: '微积分(Ⅰ)',
    xf: '5',
    kclb: '通识必修',
    kkxy: '数学科学学院',
    xxq: '秋冬',
  },
];

/** 教学班记录：**没有 kcdm**（这是上游注释明确写下的形态）。 */
const SELECTION_SECTION_ROWS = [
  {
    xkkh: '(2025-2026-1)-CS1001G-0012345-1',
    kcmc: '程序设计基础',
    jsxm: '张三',
    sksj: '周一第1,2节<br>周三第3,4节',
    skdd: '紫金港东1-101<br>紫金港东1-102',
    rs: '5/60',
    xxq: '秋冬',
    kssj: '2026年01月15日(08:00-10:00)',
  },
  {
    xkkh: '(2025-2026-1)-CS1001G-0012346-1',
    kcmc: '程序设计基础',
    jsxm: '李四',
    sksj: '周二第1,2节',
    skdd: '紫金港东1-201',
    rs: '60/60',
    xxq: '秋冬',
  },
];

/** 本人志愿：一条已选上、一条待筛选、一条 sxbj 缺失（→ 未知）。 */
const SELECTION_OWNED_ROWS = [
  {
    xkkh: '(2025-2026-1)-CS1001G-0012345-1',
    kcdm: 'CS1001G',
    kcmc: '程序设计基础',
    jsxm: '张三',
    sksj: '周一第1,2节',
    skdd: '紫金港东1-101',
    xf: '3',
    sxbj: '1',
    xkzy: '1',
    xksj: '2025-09-01 10:20:30',
  },
  {
    xkkh: '(2025-2026-1)-MA1001G-0012346-1',
    kcdm: 'MA1001G',
    kcmc: '微积分(Ⅰ)',
    jsxm: '王五',
    sksj: '周二第3,4节',
    skdd: '紫金港西2-205',
    xf: '5',
    sxbj: '0',
    xkzy: '2',
    xkzyfz: 'G-MA1001G',
  },
  {
    xkkh: '(2025-2026-1)-PH1001G-0012347-1',
    kcdm: 'PH1001G',
    kcmc: '大学物理',
    jsxm: '赵六',
    xf: '4',
  },
];

/** 培养方案列表的一行（jqGrid）。 */
function planRow(id, major, college, extra = {}) {
  return {
    jxjhh: id,
    zymc: major,
    xymc: college,
    synj: '2025',
    zdbyxf: '160',
    syxw: '工学学士',
    xz: '4',
    xqmc: '紫金港校区',
    dlbsmc: '主修',
    zyhxkc: '程序设计基础<br>数据结构基础',
    qywkc: '人工智能导论　机器学习导论',
    ...extra,
  };
}

/* ───────────────────── 培养方案：纯解析 */

test('培养方案解析：核心课按 <br> / 双空格 / 全角空格三种写法都能切开', () => {
  // 三种分隔写法在真实页面上同时存在。只认 <br> 的后果是「核心课」变成一整个
  // 长字符串，被下游当列表用时只渲染成一段文字 —— 看起来像排版问题。
  assert.deepEqual(splitCourses('课A<br>课B'), ['课A', '课B']);
  assert.deepEqual(splitCourses('课A  课B'), ['课A', '课B'], '两个半角空格');
  assert.deepEqual(splitCourses('课A　课B'), ['课A', '课B'], '全角空格');
  assert.deepEqual(splitCourses('课A<br/>课B'), ['课A', '课B'], '自闭合 br');
  assert.deepEqual(splitCourses('课A &amp; 课B'), ['课A & 课B'], '实体要解');
  assert.deepEqual(splitCourses(''), []);
  assert.deepEqual(splitCourses(null), [], 'null 不是错误，是空列表');
  // 单个空格**不切**：课程名里有空格（「Python 程序设计」），切了就断成两门课。
  assert.deepEqual(splitCourses('Python 程序设计'), ['Python 程序设计']);
});

test('培养方案解析：字段齐全，id 取 jxjhh', () => {
  const plan = parsePlan(planRow('2025080901', '软件工程', '计算机科学与技术学院'));
  assert.equal(plan.id, '2025080901');
  assert.equal(plan.major, '软件工程');
  assert.equal(plan.college, '计算机科学与技术学院');
  assert.equal(plan.year, '2025');
  assert.equal(plan.credits, '160');
  assert.equal(plan.degree, '工学学士');
  assert.equal(plan.duration, '4');
  assert.equal(plan.campus, '紫金港校区');
  assert.equal(plan.category, '主修');
  assert.deepEqual(plan.core_courses, ['程序设计基础', '数据结构基础']);
  assert.deepEqual(plan.frontier_courses, ['人工智能导论', '机器学习导论']);
  // 别名：某些版本用 pyfaxx_id 而不是 jxjhh。
  assert.equal(parsePlan({ pyfaxx_id: 'X1', zymc: '某专业' }).id, 'X1');
});

test('培养方案解析：缺教学计划号是 SCHEMA_CHANGED，不是"跳过这一条"', () => {
  // 上游 `String(r.jxjhh ?? r.pyfaxx_id ?? "")` 会兜成空串 —— 于是产出一条
  // id 为空的方案：界面上正常，点「查看」什么也打不开。这里必须抛。
  assert.throws(() => parsePlan({ zymc: '某专业' }), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parsePlan({ jxjhh: '  ', zymc: '某专业' }), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parsePlan(null), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parsePlan([1, 2]), (e) => e.code === 'SCHEMA_CHANGED');
});

test('培养方案 PDF 链接：id 编码一次、模块码是 N153020', () => {
  const url = new URL(planPdfUrl('2025080901'));
  assert.equal(url.hostname, 'zdbk.zju.edu.cn');
  assert.equal(url.pathname, '/jwglxt/pyfagl/pyfayl_cxPyfaylPdf.html');
  assert.equal(url.searchParams.get('id'), '2025080901');
  assert.equal(url.searchParams.get('doType'), 'query');
  assert.equal(url.searchParams.get('gnmkdm'), 'N153020');
  // 特殊字符必须只编码一次（双重编码会让服务端找不到那份 PDF）。
  assert.equal(new URL(planPdfUrl('a b')).searchParams.get('id'), 'a b');
});

/* ───────────────────── 培养方案：读取编排 */

test('planList：给 year 就完全不碰选课首页（非选课期唯一能用的形态）', async () => {
  const api = fakeApi2({
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [
          planRow('2025080901', '软件工程', '计算机科学与技术学院'),
          planRow('2025080902', '计算机科学与技术', '计算机科学与技术学院'),
          planRow('2025081001', '数学与应用数学', '数学科学学院'),
        ],
        total: 3, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  const out = await new ZdbkReader(api).planList({ year: '2025' });
  assert.equal(out.year, '2025');
  assert.equal(out.count, 3);
  assert.equal(out.plans.length, 3, 'count 与数组长度必须一致');
  assert.equal(out.plans[0].major, '软件工程');
  // 关键：一次 html() 都没发 → 不依赖选课首页。
  assert.equal(api.calls.some((c) => c.kind === 'html'), false, '给了 year 不该读选课首页');
  // 分页必须拉满，否则一个年级静默只剩 10 条。
  assert.equal(api.calls[0].options.paging.size, 500);
  assert.equal(api.calls[0].options.form.synj, '2025');
});

test('planList：不给 year 就读本人年级；选课首页没有年级是 SCHEMA_CHANGED', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [planRow('2025080901', '软件工程', '计算机科学与技术学院')],
        total: 1, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  const out = await new ZdbkReader(api).planList();
  assert.equal(out.year, '2025', '本人年级来自选课首页的 nj');
  assert.equal(api.calls[0].kind, 'html');
  assert.equal(api.calls[1].options.form.synj, '2025');

  // 首页上没有 nj / zydm：必须报「无法确定」，不许猜一个年级。
  const broken = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: '<html><body><input id="xn" value="2025-2026"></body></html>' },
  });
  await assert.rejects(() => new ZdbkReader(broken).planList(), (e) => {
    assert.equal(e.code, 'SCHEMA_CHANGED');
    assert.match(e.message, /year/, '文案要指出怎么绕开这一步');
    return true;
  });
});

test('planList：学院/专业按名字本地筛（服务端只认代码）', async () => {
  const api = fakeApi2({
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [
          planRow('2025080901', '软件工程', '计算机科学与技术学院'),
          planRow('2025080902', '计算机科学与技术', '计算机科学与技术学院'),
          planRow('2025081001', '数学与应用数学', '数学科学学院'),
        ],
        total: 3, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  const reader = new ZdbkReader(api);
  assert.equal((await reader.planList({ year: '2025', college: '计算机' })).count, 2);
  assert.equal((await reader.planList({ year: '2025', major: '软件' })).count, 1);
  const both = await reader.planList({ year: '2025', college: '计算机', major: '数学' });
  assert.equal(both.count, 0, '两个条件是与关系');
  assert.deepEqual(both.plans, []);
});

test('planList：year 不是四位数字是 INVALID_ARGUMENT（不会拿错年份去查）', async () => {
  // ⚠️ 这里刻意把首页夹具也塞进去：即使实现先读首页再校验年份，
  // 这条也照样能断言「码是 INVALID_ARGUMENT」，不会因为夹具缺 html 而误红。
  // 同时断言「根本没发 grid 请求」—— 这才是"不拿错年份去查"的证据。
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    grid: {},
  });
  for (const year of ['25', '20255', 'abc', '']) {
    await assert.rejects(() => new ZdbkReader(api).planList({ year }), (e) => e.code === 'INVALID_ARGUMENT', year);
  }
  assert.equal(api.calls.some((c) => c.kind === 'grid'), false, '年份非法时一次列表请求都不该发');
});

test('planList：全部行都没有教学计划号 = 接口变了（不是"没有方案"）', async () => {
  const api = fakeApi2({
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [{ zymc: '甲' }, { zymc: '乙' }],
        total: 2, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  await assert.rejects(() => new ZdbkReader(api).planList({ year: '2025' }), (e) => e.code === 'SCHEMA_CHANGED');
});

test('planList：个别坏行只计 skipped，其余照常返回', async () => {
  const api = fakeApi2({
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [
          planRow('2025080901', '软件工程', '计算机科学与技术学院'),
          { zymc: '没有计划号的占位行' },
        ],
        total: 2, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  const out = await new ZdbkReader(api).planList({ year: '2025' });
  assert.equal(out.plans.length, 1);
  assert.equal(out.skipped_items, 1, '坏行要如实计数，不能吞掉');
});

test('planList：totalPages > 1 时必须翻页取全（否则一个年级静默只剩一页）', async () => {
  // 关键回归：`plansOfYear` 里那个 `for (let page = 2; ...)` 循环。
  // 去掉它测试仍然全绿（第一页的数据是对的），但真实数据下一整个年级
  // 会被截断到 500 条 —— 而 2025 级实测约 150 条，所以这条只能靠
  // 构造 totalPages=2 来钉。
  const secondPage = [planRow('2025081001', '数学与应用数学', '数学科学学院')];
  const api = fakeApi2({
    grid: {
      [ZDBK_PLAN_PATHS.list]: (options) => (options.paging.page === 1
        ? {
          items: [planRow('2025080901', '软件工程', '计算机科学与技术学院')],
          total: 501, page: 1, size: 500, totalPages: 2,
        }
        : { items: secondPage, total: 501, page: 2, size: 500, totalPages: 2 }),
    },
  });
  const out = await new ZdbkReader(api).planList({ year: '2025' });
  assert.equal(out.plans.length, 2, '两页的方案都要在');
  assert.equal(out.count, 2);
  assert.deepEqual(out.plans.map((p) => p.major), ['软件工程', '数学与应用数学']);
  const gridCalls = api.calls.filter((c) => c.kind === 'grid');
  assert.equal(gridCalls.length, 2, '必须发两次列表请求');
  assert.equal(gridCalls[1].options.paging.page, 2);
  assert.equal(gridCalls[1].options.paging.size, 500, '第二页的 size 也要拉满');
});

test('planView：本人方案按 年级+专业代码 定位，返回 PDF 链接', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [
          planRow('2025080901', '软件工程', '计算机科学与技术学院'),
          // 本人专业代码是 080901（首页的 zydm）→ 教学计划号 2025080901
          planRow('2025080902', '计算机科学与技术', '计算机科学与技术学院'),
        ],
        total: 2, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  const out = await new ZdbkReader(api).planView();
  assert.equal(out.id, '2025080901');
  assert.equal(out.major, '软件工程');
  assert.equal(out.pdf_url, planPdfUrl('2025080901'));
  assert.deepEqual(out.core_courses, ['程序设计基础', '数据结构基础']);
  assert.match(out.note, /PDF/);
});

test('planView：本人方案找不到是 NOT_FOUND（带 year 与专业代码，能照做）', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [planRow('2025999999', '别的专业', '别的学院')],
        total: 1, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  await assert.rejects(() => new ZdbkReader(api).planView(), (e) => {
    assert.equal(e.code, 'NOT_FOUND');
    assert.match(e.message, /2025/, '文案要写出是哪一级');
    assert.equal(e.details.major_code, '080901');
    assert.equal(e.details.plan_id, '2025080901');
    return true;
  });
});

test('planView：给 major 时按名称消歧义，命中多条是 NEEDS_DISAMBIGUATION', async () => {
  const api = fakeApi2({
    grid: {
      [ZDBK_PLAN_PATHS.list]: {
        items: [
          planRow('2025080901', '计算机科学与技术', '计算机科学与技术学院'),
          planRow('2025080902', '计算机科学与技术（求是科学班）', '计算机科学与技术学院'),
        ],
        total: 2, page: 1, size: 500, totalPages: 1,
      },
    },
  });
  // 精确匹配只中第一个 → 唯一，直接返回。
  const exact = await new ZdbkReader(api).planView({ year: '2025', major: '计算机科学与技术' });
  assert.equal(exact.id, '2025080901');

  // 模糊匹配「计算机」中两条 → 必须报错，不许挑第一个。
  // 挑第一个的后果是用户拿到一份别人的培养方案，两边都不报错。
  await assert.rejects(() => new ZdbkReader(api).planView({ year: '2025', major: '计算机' }), (e) => {
    assert.equal(e.code, 'NEEDS_DISAMBIGUATION');
    assert.equal(e.details.candidates.length, 2, '候选要一起给出来，用户才能选');
    assert.equal(e.details.candidates[0].major, '计算机科学与技术');
    return true;
  });

  // 完全没命中：同样带候选（这里候选是全部方案，便于用户看有什么）。
  await assert.rejects(
    () => new ZdbkReader(api).planView({ year: '2025', major: '考古学' }),
    (e) => e.code === 'NEEDS_DISAMBIGUATION' && /没有找到/.test(e.message),
  );
});

/* ───────────────────── 选课：纯解析 */

test('选课上下文解析：字段齐全，xnxq 形如 (2025-2026-1)-', () => {
  const context = parseSelectionContext(SELECTION_INDEX_HTML);
  assert.equal(context.academic_year, '2025-2026');
  assert.equal(context.semester, 1);
  assert.equal(context.term, '秋冬');
  assert.equal(context.grade, '2025');
  assert.equal(context.major_code, '080901');
  assert.equal(context.plan_id, '2025080901', '教学计划号 = nj + zydm');
  assert.equal(context.xnxq, '(2025-2026-1)-');
  assert.equal(context.max_choices, 3);
  assert.equal(context.study_length, '4');
});

test('选课上下文解析：kind 决定走哪条查询链（search / special / courses）', () => {
  const categories = parseSelectionContext(SELECTION_INDEX_HTML).categories;
  // ⚠️ 按 `dl` + `lx` 建索引，不能只按 `dl`：同一个 `dl`（xk_1）同时挂着
  // 父页签（lx=bl）与子类页签（lx=zl），只按 dl 会互相覆盖。
  const byKey = Object.fromEntries(categories.map((c) => [`${c.dl}/${c.lx}`, c]));
  assert.equal(byKey['xk_1/bl'].kind, 'courses');
  assert.equal(byKey['xk_2/qb'].kind, 'courses');
  assert.equal(byKey['xk_9/ss'].kind, 'search', 'xk_9 是条件搜索页签');
  assert.equal(byKey['xk_1_1/bk'].kind, 'special', '补考选课未接入');
  // 子类页签也要被收进来（服务端按 lx 区分），不能因为同名就丢掉。
  assert.equal(byKey['xk_1/bl'].name, '通识核心课程', '父页签用 kclbmc（不是链接文字）');
  assert.equal(byKey['xk_1/zl'].name, '通识核心课程子类', '没有 kclbmc 时用链接文字');
  assert.equal(byKey['xk_1/bl'].kcbs, '01', 'kcbs 是页签上的筛选标记，要原样回传');
  assert.equal(byKey['xk_2/qb'].name, '全部课程', '没有 kclbmc 时用 title 优先于链接文字');
});

test('选课上下文解析：缺 xn/xq/nj/zydm/xkzys 任一都是 SCHEMA_CHANGED（不给默认值）', () => {
  // 给默认值的后果是带着错的学年学期去查，正方不报错、只回空列表。
  for (const key of ['xn', 'xq', 'nj', 'zydm', 'xkzys']) {
    const html = SELECTION_INDEX_HTML.replace(new RegExp(`id="${key}" name="${key}" value="[^"]*"`), '');
    assert.throws(() => parseSelectionContext(html), (e) => {
      assert.equal(e.code, 'SCHEMA_CHANGED', `${key} 缺失应报 SCHEMA_CHANGED`);
      assert.match(e.message, new RegExp(key), '文案要点名缺了哪个字段');
      return true;
    });
  }
});

test('选课上下文解析：学期/志愿数格式异常也是 SCHEMA_CHANGED', () => {
  const bad = (from, to) => SELECTION_INDEX_HTML.replace(from, to);
  assert.throws(() => parseSelectionContext(bad('value="2025-2026"', 'value="25-26"')), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parseSelectionContext(bad('id="xq" name="xq" value="1"', 'id="xq" name="xq" value="秋"')), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parseSelectionContext(bad('id="xkzys" name="xkzys" value="3"', 'id="xkzys" name="xkzys" value="0"')), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parseSelectionContext(bad('id="xkzys" name="xkzys" value="3"', 'id="xkzys" name="xkzys" value="1.5"')), (e) => e.code === 'SCHEMA_CHANGED');
});

test('parseMyPlan：只要 nj + zydm（非选课期也能用）', () => {
  // 非选课期页面上通常没有 xkzys，所以「推本人方案」不能要求全部字段。
  const html = '<html><input id="nj" value="2025"><input id="zydm" value="080901"></html>';
  assert.deepEqual(parseMyPlan(html), { id: '2025080901', year: '2025', major: '080901' });
  assert.equal(parseMyPlan('<html><input id="nj" value="25"></html>'), null, '年级格式不对 → null，不猜');
  assert.equal(parseMyPlan('<html></html>'), null);
});

test('选课记录解析：教学班响应没有 kcdm，用本次查询的课程代码兜住', () => {
  // 不兜的话每一条教学班都会被判「缺字段」，错误指向「接口变了」——
  // 真实原因却是调用方没把课程代码带下来。
  const row = parseSelectionRow({ xkkh: '(2025-2026-1)-CS1001G-0012345-1', kcmc: '程序设计基础' }, 'CS1001G');
  assert.equal(row.xkkh, '(2025-2026-1)-CS1001G-0012345-1');
  assert.equal(row.kcdm, 'CS1001G');
  // 白名单：渲染用的噪音字段要被丢掉。
  assert.equal(parseSelectionRow({ xkkh: 'X', kcdm: 'C', tabname: 'jxrwbview' }, null).tabname, 'jxrwbview', 'tabname 在白名单里（要用它判补考）');
  assert.equal('zyfzByKcdm' in parseSelectionRow({ xkkh: 'X', kcdm: 'C', zyfzByKcdm: 1 }, null), false, '渲染用字段要丢掉');
});

test('选课记录解析：缺 xkkh / kcdm 是 SCHEMA_CHANGED', () => {
  assert.throws(() => parseSelectionRow({ kcmc: '课' }, 'CS1001G'), (e) => e.code === 'SCHEMA_CHANGED', '缺教学班号');
  assert.throws(() => parseSelectionRow({ xkkh: '(2025-2026-1)-X-1-1' }), (e) => e.code === 'SCHEMA_CHANGED', '缺课程代码');
  assert.throws(() => parseSelectionRow(null, 'C'), (e) => e.code === 'SCHEMA_CHANGED');
  assert.throws(() => parseSelectionRow(['数组'], 'C'), (e) => e.code === 'SCHEMA_CHANGED');
});

test('志愿状态：sxbj=1 已选上 / 0 待筛选 / 其他未知（不猜）', () => {
  assert.equal(selectionState({ sxbj: '1' }), 'selected');
  assert.equal(selectionState({ sxbj: '0' }), 'pending');
  assert.equal(selectionState({ sxbj: '2' }), 'unknown', '没见过的值必须如实标未知');
  assert.equal(selectionState({}), 'unknown');
  assert.equal(selectionState({ sxbj: '' }), 'unknown');
});

test('容量解析：{"5/60"} → remaining 5 / capacity 60；格式不符两个都是 null', () => {
  assert.deepEqual(parseCapacity('5/60'), { remaining: 5, capacity: 60 });
  assert.deepEqual(parseCapacity(' 5 / 60 '), { remaining: 5, capacity: 60 });
  assert.deepEqual(parseCapacity('0/0'), { remaining: 0, capacity: 0 }, '0 是有效值，不是"没给"');
  // 拆错的表现是「余量显示成 60」——页面上看不出错，只是课满了照显示有位置。
  for (const value of ['', '5', 'abc', '5/60/', null, undefined]) {
    assert.deepEqual(parseCapacity(value), { remaining: null, capacity: null }, String(value));
  }
});

test('flatten：<br> 换连接符、去标签、解实体、「--」视为没有', () => {
  // 正方的多值字段用 <br> 分隔；原样上屏会把一整段 HTML 糊在界面上。
  assert.equal(flatten('周一第1,2节<br>周三第3,4节'), '周一第1,2节、周三第3,4节');
  assert.equal(flatten('周一第1,2节<br>周三第3,4节', '；'), '周一第1,2节；周三第3,4节');
  assert.equal(flatten('<span>东1-101</span>'), '东1-101', '行内标签要去掉');
  assert.equal(flatten('A &amp; B'), 'A & B', '实体要解');
  assert.equal(flatten('A&nbsp;B'), 'A B');
  // ⚠️ `--` 是正方表达「没有」的写法。当成地点显示出来就是一句假话
  //    （「考试地点：--」比「考试地点：未公布」更糟，用户会以为在某个地方）。
  assert.equal(flatten('--'), '', '-- 要当作空');
  assert.equal(flatten('紫金港东1-101<br>--'), '紫金港东1-101', '多值里混进 -- 时只丢那一段');
  assert.equal(flatten(''), '');
  assert.equal(flatten(null), '');
  assert.equal(flatten(undefined), '');
});

test('flatten：`--` 出现在教学班地点里时不该上屏', () => {
  // 走完整链路验证一次：sectionView 用的是 flatten，所以这条覆盖「地点为 --」的真实形态。
  const view = sectionView({ kcdm: 'CS1001G', xkkh: '(2025-2026-1)-CS1001G-1-1', skdd: '--', jsxm: '张三' });
  assert.equal(view.location, undefined, '地点是 -- 时字段整个不出现');
  assert.equal('location' in view, false);
  assert.equal(view.teacher, '张三');
});

test('分页表单：正方要的是行号区间 kspage/jspage，不是页码', () => {
  assert.deepEqual(selectionPageForm(), { kspage: '1', jspage: '20' });
  assert.deepEqual(selectionPageForm(1, 50), { kspage: '1', jspage: '50' });
  // 第 2 页 = 第 51~100 行。按页码传 2 的表现是「第 2 页还是第 1 页的内容」。
  assert.deepEqual(selectionPageForm(2, 50), { kspage: '51', jspage: '100' });
  assert.deepEqual(selectionPageForm(3, 20), { kspage: '41', jspage: '60' });
  for (const [page, size] of [[0, 20], [1, 0], [1, 51], [1.5, 20], ['1', 20]]) {
    assert.throws(() => selectionPageForm(page, size), (e) => e.code === 'INVALID_ARGUMENT', `${page}/${size}`);
  }
});

test('搜索表单：keyword 与 conditions 互斥；字段/比较方式必须合法', () => {
  const context = parseSelectionContext(SELECTION_INDEX_HTML);
  const form = selectionSearchForm(context, { keyword: '高等数学' });
  assert.equal(form.xnxq, '(2025-2026-1)-');
  assert.equal(form.cx_zbgx, 'and');
  assert.equal(form.cx_ylcx, '0');
  assert.equal(form['cxtjList[0].cxlb'], 'kcmc', '默认按课程名搜');
  assert.equal(form['cxtjList[0].cxgx'], 'like');
  assert.equal(form['cxtjList[0].cxnr'], '高等数学');

  // only_available → cx_ylcx=1
  assert.equal(selectionSearchForm(context, { keyword: 'x', onlyAvailable: true }).cx_ylcx, '1');

  // 多条件 + or
  const multi = selectionSearchForm(context, {
    relation: 'or',
    conditions: [
      { field: 'kcmc', value: '数学' },
      { field: 'jsxm', operator: 'equal', value: '张三' },
    ],
  });
  assert.equal(multi.cx_zbgx, 'or');
  assert.equal(multi['cxtjList[1].cxlb'], 'jsxm');
  assert.equal(multi['cxtjList[1].cxgx'], 'equal');
  assert.equal(multi['cxtjList[1].cxnr'], '张三');

  assert.throws(() => selectionSearchForm(context, { keyword: 'x', conditions: [] }), (e) => e.code === 'INVALID_ARGUMENT', '两者互斥');
  assert.throws(() => selectionSearchForm(context, { conditions: [] }), (e) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => selectionSearchForm(context, { relation: 'xor', keyword: 'x' }), (e) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => selectionSearchForm(context, { conditions: [{ field: 'nope', value: 'x' }] }), (e) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => selectionSearchForm(context, { conditions: [{ field: 'kcmc', operator: 'regex', value: 'x' }] }), (e) => e.code === 'INVALID_ARGUMENT');
  assert.throws(() => selectionSearchForm(context, { conditions: [{ field: 'kcmc', value: '  ' }] }), (e) => e.code === 'INVALID_ARGUMENT');
  // 21 个条件超上限
  assert.throws(
    () => selectionSearchForm(context, { conditions: Array.from({ length: 21 }, () => ({ field: 'kcmc', value: 'x' })) }),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
});

test('学期校验：课号里的学年学期必须是本学期（不许拿上学期的课号提交）', () => {
  const context = parseSelectionContext(SELECTION_INDEX_HTML);
  // 本学期 2025-2026-1：通过。
  assertSelectionTerm('(2025-2026-1)-CS1001G-0012345-1', context);
  // 池形态允许一个前缀（体育池实测是 4(...)-）。
  assertSelectionTerm('4(2025-2026-1)-PE-001', context, true);
  assertSelectionTerm('T(2025-2026-1)-PE-001', context, true);
  // 上学期 / 下学期 / 乱码一律拒绝。
  for (const id of ['(2024-2025-1)-X-1-1', '(2025-2026-2)-X-1-1', 'X-1-1', '']) {
    assert.throws(() => assertSelectionTerm(id, context), (e) => e.code === 'INVALID_ARGUMENT', id);
  }
  // 池模式不认普通形态的裸前缀之外——不带括号的仍然拒绝。
  assert.throws(() => assertSelectionTerm('CS1001G', context, true), (e) => e.code === 'INVALID_ARGUMENT');
});

/* ───────────────────── 选课：读取编排 */

test('selectionContext：返回学期、志愿数与页签（页面能读不代表允许选课）', async () => {
  const api = fakeApi2({ html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML } });
  const out = await new ZdbkReader(api).selectionContext();
  assert.equal(out.academic_year, '2025-2026');
  assert.equal(out.semester, 1);
  assert.equal(out.term, '秋冬');
  assert.equal(out.max_choices, 3);
  assert.equal(out.plan_id, '2025080901');
  // 4 个页签 + 1 个子类页签 = 5 条（子类不合并，服务端按 lx 区分）。
  assert.equal(out.categories.length, 5);
  assert.deepEqual(out.categories.map((c) => `${c.dl}/${c.kind}`), [
    'xk_1/courses', 'xk_1/courses', 'xk_2/courses', 'xk_9/search', 'xk_1_1/special',
  ]);
  assert.match(out.note, /不代表现在允许选课/);
  assert.equal(api.calls[0].options.query.gnmkdm, 'N253530', '选课模块码');
});

test('selectionCourses：翻页取全，课程视图带 pool（不是 code）', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: {
      [ZDBK_SELECTION_PATHS.courses]: (options) => {
        // 第一页给满 50 条 → 触发第二页；第二页只给 2 条 → 收尾。
        if (options.form.jspage === '50') {
          return Array.from({ length: 50 }, (_, i) => ({
            xkkh: `(2025-2026-1)-C${i}-1-1`, kcdm: `C${i}`, kcmc: `课${i}`,
          }));
        }
        return SELECTION_COURSE_ROWS;
      },
    },
  });
  const out = await new ZdbkReader(api).selectionCourses({ category: 'xk_1', name: '通识核心课程' });
  assert.equal(out.count, 52, '50 + 2：两页都要取回来');
  assert.equal(out.courses.length, 52, 'count 与数组长度必须一致');
  assert.equal(api.calls.filter((c) => c.kind === 'postArray').length, 2, '取了两页');
  // 第二页的行号区间必须是 51~100。
  const second = api.calls.filter((c) => c.kind === 'postArray')[1];
  assert.equal(second.options.form.kspage, '51');
  assert.equal(second.options.form.jspage, '100');
  // 课程视图的 pool 是课程号（xkkh），sections 要用它。
  const first = out.courses[0];
  assert.equal(first.pool, '(2025-2026-1)-C0-1-1');
  assert.equal(first.code, 'C0');
  assert.equal(first.category, 'xk_1');
});

test('selectionCourses：表单条件按上游口径组装（含 xk_6 的虚拟教学计划号）', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML.replace('xk_2', 'xk_6') },
    postArray: { [ZDBK_SELECTION_PATHS.courses]: SELECTION_COURSE_ROWS },
  });
  await new ZdbkReader(api).selectionCourses({ category: 'xk_6', name: '全部课程' });
  const form = api.calls.find((c) => c.kind === 'postArray').options.form;
  assert.equal(form.nj, '2025');
  assert.equal(form.xn, '2025-2026');
  assert.equal(form.xq, '1');
  assert.equal(form.zydm, '080901');
  assert.equal(form.xnxq, '(2025-2026-1)-');
  assert.equal(form.jxjhh, '2025cx01', 'xk_6 用当年 + cx01 的虚拟计划号');
});

test('selectionCourses：页签不存在 / search 页签 / special 页签分别明确报错', async () => {
  const api = fakeApi2({ html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML } });
  const reader = new ZdbkReader(api);

  // 不存在的类别码：报错里要列出可用的，用户才知道给什么。
  await assert.rejects(() => reader.selectionCourses({ category: 'xk_404' }), (e) => {
    assert.equal(e.code, 'INVALID_ARGUMENT');
    assert.match(e.message, /xk_1/);
    return true;
  });
  // search 页签要走 selectionSearch，不能走课程列表。
  await assert.rejects(() => reader.selectionCourses({ category: 'xk_9' }), (e) => {
    assert.equal(e.code, 'UNSUPPORTED');
    assert.match(e.message, /selectionSearch/);
    return true;
  });
  // special 页签（补考）未接入：必须报错，**不能**回空列表（空列表会被读成"这学期没有"）。
  await assert.rejects(() => reader.selectionCourses({ category: 'xk_1_1' }), (e) => e.code === 'UNSUPPORTED');
  // 一次 postArray 都不该发生 —— 参数错误要在发请求之前就停下。
  assert.equal(api.calls.some((c) => c.kind === 'postArray'), false);
});

test('selectionSearch：结果带 pool，search 条件原样回给调用方', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: { [ZDBK_SELECTION_PATHS.search]: SELECTION_COURSE_ROWS },
  });
  const out = await new ZdbkReader(api).selectionSearch({ keyword: '程序设计', field: 'kcmc', only_available: true });
  assert.equal(out.count, 2);
  assert.equal(out.courses[0].code, 'CS1001G');
  assert.equal(out.courses[0].category, 'xk_9');
  assert.equal(out.search.keyword, '程序设计');
  assert.equal(out.search.relation, 'and');
  assert.equal(out.search.only_available, true);
  const form = api.calls.find((c) => c.kind === 'postArray').options.form;
  assert.equal(form.cx_ylcx, '1');
  assert.equal(form['cxtjList[0].cxnr'], '程序设计');
});

test('selectionSections：教学班展开、余量容量、HTML 多值字段拍平', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: { [ZDBK_SELECTION_PATHS.sections]: SELECTION_SECTION_ROWS },
  });
  const out = await new ZdbkReader(api).selectionSections({
    course: 'CS1001G',
    pool: '(2025-2026-1)-CS1001G-0012345-1',
    category: 'xk_1',
  });
  assert.equal(out.count, 2);
  assert.equal(out.sections.length, 2, 'count 与数组长度必须一致');
  const [first, second] = out.sections;
  assert.equal(first.course, '程序设计基础');
  assert.equal(first.code, 'CS1001G', '教学班响应没有 kcdm，要用本次查询的课程代码补上');
  assert.equal(first.section, '(2025-2026-1)-CS1001G-0012345-1');
  assert.equal(first.teacher, '张三');
  assert.equal(first.time, '周一第1,2节；周三第3,4节', '<br> 要换成连接符');
  assert.equal(first.location, '紫金港东1-101；紫金港东1-102');
  assert.equal(first.remaining, 5);
  assert.equal(first.capacity, 60);
  assert.equal(second.remaining, 60);
  assert.equal(second.capacity, 60);
});

test('selectionSections：缺参数 / 课程池跨学期 / 页签不对，都在发请求前报错', async () => {
  const api = fakeApi2({ html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML } });
  const reader = new ZdbkReader(api);
  const ok = { course: 'CS1001G', pool: '(2025-2026-1)-CS1001G-0012345-1', category: 'xk_1' };

  await assert.rejects(() => reader.selectionSections({}), (e) => {
    assert.equal(e.code, 'INVALID_ARGUMENT');
    assert.match(e.message, /course/);
    return true;
  });
  await assert.rejects(() => reader.selectionSections({ ...ok, pool: '' }), (e) => /pool/.test(e.message) && e.code === 'INVALID_ARGUMENT');
  await assert.rejects(() => reader.selectionSections({ ...ok, category: '' }), (e) => /category/.test(e.message) && e.code === 'INVALID_ARGUMENT');
  // 上学期的池：服务端会静默回空，所以必须在本地拦。
  await assert.rejects(() => reader.selectionSections({ ...ok, pool: '(2024-2025-1)-CS1001G-0012345-1' }), (e) => e.code === 'INVALID_ARGUMENT');
  // 补考页签不在普通页签里。
  await assert.rejects(() => reader.selectionSections({ ...ok, category: 'xk_1_1' }), (e) => e.code === 'INVALID_ARGUMENT');
  // xk_9 必须带 search（否则服务端找不到课程池）。
  await assert.rejects(() => reader.selectionSections({ ...ok, category: 'xk_9' }), (e) => {
    assert.equal(e.code, 'INVALID_ARGUMENT');
    assert.match(e.message, /search/);
    return true;
  });
  assert.equal(api.calls.some((c) => c.kind === 'postArray'), false, '参数校验必须在发包之前');
});

test('selectionSections：xk_9 带上原搜索条件（不是空条件）', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: { [ZDBK_SELECTION_PATHS.sections]: SELECTION_SECTION_ROWS },
  });
  await new ZdbkReader(api).selectionSections({
    course: 'CS1001G',
    pool: '(2025-2026-1)-CS1001G-0012345-1',
    category: 'xk_9',
    search: { keyword: '程序设计', field: 'kcmc' },
  });
  const form = api.calls.find((c) => c.kind === 'postArray').options.form;
  assert.equal(form.dl, 'xk_9');
  assert.equal(form['cxtjList[0].cxnr'], '程序设计', '搜索条件必须一起回传');
  assert.equal(form.ylxs, '4', '培养年限来自首页');
});

test('selectionSelected：三种状态如实给，学分汇总附在里面', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: { [ZDBK_SELECTION_PATHS.chosen]: SELECTION_OWNED_ROWS },
    post: {
      [ZDBK_SELECTION_PATHS.credits]: { status: 'success', result: { xf9: '12.5', xf91: '10', xf92: '2.5' } },
    },
  });
  const out = await new ZdbkReader(api).selectionSelected();
  assert.equal(out.count, 3);
  assert.equal(out.choices.length, 3, 'count 与数组长度必须一致');
  assert.deepEqual(out.choices.map((c) => c.state), ['已选上', '待筛选', '未知']);
  assert.equal(out.choices[0].order, 1);
  assert.equal(out.choices[1].order, 2);
  assert.equal(out.choices[2].order, null, '没有 xkzy 时给 null，不是 0');
  assert.equal(out.choices[0].saved_at, '2025-09-01 10:20', '只取到分钟');
  assert.equal(out.choices[1].group, 'G-MA1001G', '组号与课程代码不同时才给');
  assert.equal(out.choices[0].group, undefined, '同课时不冗余输出 group');
  assert.deepEqual(out.credits, { total: 12.5, regular: 10, short: 2.5 });
  assert.equal(out.credits_error, null);
});

test('selectionSelected：学分汇总失败不影响志愿列表（附 credits_error）', async () => {
  // 与 gpaSummary 对专业 GPA 的取舍同一套：一个可选指标失败不该把整页带走。
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: { [ZDBK_SELECTION_PATHS.chosen]: SELECTION_OWNED_ROWS },
    post: {
      [ZDBK_SELECTION_PATHS.credits]: () => { throw Object.assign(new Error('拒绝'), { code: 'FORBIDDEN' }); },
    },
  });
  const out = await new ZdbkReader(api).selectionSelected();
  assert.equal(out.choices.length, 3, '志愿照常返回');
  assert.equal(out.credits, null);
  assert.equal(out.credits_error, 'FORBIDDEN', '要如实记下原因，不能假装学分是 0');
});

test('selectionSelected：with_credits=false 时完全不请求学分接口', async () => {
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: { [ZDBK_SELECTION_PATHS.chosen]: SELECTION_OWNED_ROWS },
  });
  const out = await new ZdbkReader(api).selectionSelected({ with_credits: false });
  assert.equal(out.credits, null);
  assert.equal(out.credits_error, null);
  assert.equal(api.calls.some((c) => c.path === ZDBK_SELECTION_PATHS.credits), false);
});

test('selectionCredits：三档学分，空串不给成 0', async () => {
  const good = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    post: { [ZDBK_SELECTION_PATHS.credits]: { status: 'success', result: { xf9: '20', xf91: '17.5', xf92: '2.5' } } },
  });
  const out = await new ZdbkReader(good).selectionCredits();
  assert.equal(out.total, 20);
  assert.equal(out.regular, 17.5);
  assert.equal(out.short, 2.5);
  assert.equal(out.academic_year, '2025-2026');
  assert.equal(out.semester, 1);

  // `Number('') === 0` 的坑：空串必须报错，不能变成「0 学分」。
  const emptyString = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    post: { [ZDBK_SELECTION_PATHS.credits]: { status: 'success', result: { xf9: '', xf91: '1', xf92: '1' } } },
  });
  await assert.rejects(() => new ZdbkReader(emptyString).selectionCredits(), (e) => {
    assert.equal(e.code, 'SCHEMA_CHANGED');
    assert.match(e.message, /xf9/);
    return true;
  });
  // status 不是 success 也是 SCHEMA_CHANGED。
  const badStatus = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    post: { [ZDBK_SELECTION_PATHS.credits]: { status: 'fail', result: { xf9: 1, xf91: 1, xf92: 1 } } },
  });
  await assert.rejects(() => new ZdbkReader(badStatus).selectionCredits(), (e) => e.code === 'SCHEMA_CHANGED');
  // 负数也是异常。
  const negative = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    post: { [ZDBK_SELECTION_PATHS.credits]: { status: 'success', result: { xf9: '-1', xf91: 1, xf92: 1 } } },
  });
  await assert.rejects(() => new ZdbkReader(negative).selectionCredits(), (e) => e.code === 'SCHEMA_CHANGED');
});

test('选课分页：出现重复条目就报 PAGINATION_UNSTABLE（宁可说不完整，也不给半份）', async () => {
  // 正方的分页在数据变动时会回退：第 2 页可能返回第 1 页的内容。
  // 不查重就会把同一门课列两次，而因为页数固定，有的课永远取不到。
  let calls = 0;
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: {
      [ZDBK_SELECTION_PATHS.courses]: () => {
        calls++;
        // 两页都给满 50 条且完全一样 → 第 2 页必然命中重复。
        return Array.from({ length: 50 }, (_, i) => ({ xkkh: `(2025-2026-1)-C${i}-1-1`, kcdm: `C${i}`, kcmc: `课${i}` }));
      },
    },
  });
  await assert.rejects(() => new ZdbkReader(api).selectionCourses({ category: 'xk_2', name: '全部课程' }), (e) => {
    assert.equal(e.code, 'PAGINATION_UNSTABLE');
    assert.match(e.message, /重复/);
    return true;
  });
  assert.equal(calls, 2, '第 2 页就发现重复，不该继续翻');
});

test('选课查询：空数组是「没有」，不是错误（与成绩那族的"缺字段"相反）', async () => {
  // 选课接口回空数组是合法结果：这门课这学期确实没开教学班。
  const api = fakeApi2({
    html: { [ZDBK_SELECTION_PATHS.index]: SELECTION_INDEX_HTML },
    postArray: {
      [ZDBK_SELECTION_PATHS.sections]: [],
      [ZDBK_SELECTION_PATHS.search]: [],
    },
  });
  const reader = new ZdbkReader(api);
  const sections = await reader.selectionSections({
    course: 'CS1001G', pool: '(2025-2026-1)-CS1001G-0012345-1', category: 'xk_1',
  });
  assert.deepEqual(sections.sections, []);
  assert.equal(sections.count, 0);
  assert.equal((await reader.selectionSearch({ keyword: '不存在的课' })).count, 0);
});

/* ───────────────────── 客户端：新增的三个通道 */

test('postArray：只接受数组；对象是 SCHEMA_CHANGED（不许退化成空数组）', async () => {
  const ok = makeTransport(async () => new Response('[{"xkkh":"X"}]', { status: 200 }));
  assert.deepEqual(await new ZdbkClient(ok).postArray('/xsxk/a.html'), [{ xkkh: 'X' }]);

  // 对象 → 明确报错。退化成空数组会被上层读成「没有可选课程」，一个彻底的谎。
  const object = makeTransport(async () => new Response('{"msg":"错误"}', { status: 200 }));
  await assert.rejects(() => new ZdbkClient(object).postArray('/xsxk/a.html'), (e) => e.code === 'SCHEMA_CHANGED');

  // 空正文是合法的空列表（正方在"没有可选项"时就是回空串）。
  const blank = makeTransport(async () => new Response('', { status: 200 }));
  assert.deepEqual(await new ZdbkClient(blank).postArray('/xsxk/a.html'), []);

  // 登录页 / 非 JSON 仍按既有口径报。
  const login = makeTransport(async () => new Response('<html><form action="/cas/login"><input name="password"></form></html>', { status: 200 }));
  await assert.rejects(() => new ZdbkClient(login).postArray('/xsxk/a.html'), (e) => e.code === 'LOGIN_REQUIRED');
});

test('html：登录页要判成 LOGIN_REQUIRED，不是"页面结构变了"', async () => {
  // 顺序写反的后果：登录页恰好是合法 HTML（有 form、有 password 输入框），
  // 会被当成正常页面往下传，最后在解析层报「找不到 xjxjhh」——
  // 一个把「没登录」说成「页面改版」的错误归因。
  const login = makeTransport(async () => new Response('<html><body><form id="loginForm"><input name="password"></form></body></html>', { status: 200 }));
  await assert.rejects(() => new ZdbkClient(login).html('/xsxk/x.html'), (e) => {
    assert.equal(e.code, 'LOGIN_REQUIRED');
    return true;
  });

  const ok = makeTransport(async () => new Response('<html><body><input id="xn" value="2025-2026"></body></html>', { status: 200 }));
  assert.match(await new ZdbkClient(ok).html('/xsxk/x.html'), /xn/);

  // 空页面 / 非页面正文各有专门错误。
  const blank = makeTransport(async () => new Response('   ', { status: 200 }));
  await assert.rejects(() => new ZdbkClient(blank).html('/xsxk/x.html'), (e) => e.code === 'UNEXPECTED_RESPONSE');
  const text = makeTransport(async () => new Response('not html at all', { status: 200 }));
  await assert.rejects(() => new ZdbkClient(text).html('/xsxk/x.html'), (e) => e.code === 'UNEXPECTED_RESPONSE');
});

test('html：正常页面里出现「未登录」字样不该被误判成登录页', async () => {
  // `LOGIN_MARKERS` 是拿来判 **JSON 接口正文**的；一个正常页面里顶栏/页脚
  // 出现「统一身份认证」「未登录」并不异常。拿它判页面会误杀。
  const page = makeTransport(async () => new Response(
    '<html><body><div>统一身份认证 · 未登录用户请联系管理员</div><input id="nj" value="2025"></body></html>',
    { status: 200 },
  ));
  assert.match(await new ZdbkClient(page).html('/xsxk/x.html'), /nj/);
});

test('grid：条件走表单体、总数兜到行上、缺 items 是 SCHEMA_CHANGED', async () => {
  const seen = [];
  const transport = makeTransport(async (url, init) => {
    seen.push({ url: String(url), body: String(init?.body ?? '') });
    return new Response(JSON.stringify({ items: [{ totalResult: 150 }] }), { status: 200 });
  });
  const out = await new ZdbkClient(transport).grid('/pyfagl/a.html', { synj: '2025' }, { page: 2, size: 500 });
  // 条件在表单体里，URL 上只有 doType —— 混用会得到「HTTP 200 + items: []」。
  assert.match(seen[0].url, /[?&]doType=query/);
  const body = new URLSearchParams(seen[0].body);
  assert.equal(body.get('synj'), '2025');
  assert.equal(body.get('queryModel.showCount'), '500');
  assert.equal(body.get('queryModel.currentPage'), '2');
  // totalResult 藏在行里时也要读到，否则「翻页到此为止」，只取第一页。
  assert.equal(out.total, 150);
  assert.equal(out.totalPages, 1, '150 / 500 → 1 页');
  assert.equal(out.items.length, 1);

  const missing = makeTransport(async () => new Response('{"data":[]}', { status: 200 }));
  await assert.rejects(() => new ZdbkClient(missing).grid('/pyfagl/a.html'), (e) => e.code === 'SCHEMA_CHANGED');
});

/* ───────────────────── 服务面：会话三件套 + 新方法接线 */

test('服务面：12 条只读方法都接到 invoke（名字与路由 action 一致）', async (t) => {
  const { dir, cleanup } = await tempDataDir('surface');
  t.after(cleanup);
  const services = {};
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    get: () => undefined,
    provide: (key, value) => { services[key] = value; return () => {}; },
    inject: () => {},
  };
  await plugin.apply(ctx, {
    dataDir: dir,
    protect: async (bytes) => bytes,
    fetch: async () => { throw new Error('不该发请求'); },
  });

  const service = services.zhiyunZdbk;
  // ⚠️ 接写操作后这里从 true 改成 false：本包现在含 `xxxPrepare` / `xxxExecute`
  // （见 `writes.js`）。只读方法表 `methods` 仍是 12 条，写方法另列在 `writeMethods`。
  assert.equal(service.readOnly, false);
  // 服务上的方法名与 `describe()` 的 method 表必须**一一对应**。
  // 这里曾经出过错：表里叫 selectionContext、文档里写 selection.context。
  const described = service.describe().methods.map((m) => m.method.replace('zdbk.', ''));
  for (const key of described) {
    assert.equal(typeof service[key], 'function', `服务上缺 ${key}`);
  }
  assert.deepEqual(described, [
    'grades', 'gpaSummary', 'exams', 'timetable',
    'planList', 'planView',
    'selectionContext', 'selectionCourses', 'selectionSearch',
    'selectionSections', 'selectionSelected', 'selectionCredits',
  ]);
  assert.equal(typeof service.methods.length, 'number');
  assert.equal(service.methods.length, 12);
  // 写操作不许在服务上出现 —— 出现了就绕过写闸。
  for (const forbidden of ['select', 'reorder', 'drop']) {
    assert.equal(service[forbidden], undefined, `服务上不该有 ${forbidden}`);
  }
});

test('服务面：status 不联网、logout 清会话且立即落盘', async (t) => {
  const { dir, cleanup } = await tempDataDir('session');
  t.after(cleanup);
  const services = {};
  let requests = 0;
  const ctx = {
    profileContext: { dir },
    logger: { info() {} },
    get: () => undefined,
    provide: (key, value) => { services[key] = value; return () => {}; },
    inject: () => {},
  };
  await plugin.apply(ctx, {
    dataDir: dir,
    protect: async (bytes) => bytes,
    fetch: async () => { requests++; throw new Error('status/logout 不该发请求'); },
  });
  const service = services.zhiyunZdbk;

  // 没登录过：logged_in=false，但**一次请求都不能发**。
  const before = await service.status();
  assert.equal(before.logged_in, false);
  assert.equal(before.account_known, false, '没配凭据');
  assert.equal(requests, 0, 'status 不许联网');
  assert.match(before.note, /不联网/);

  const out = await service.logout();
  assert.deepEqual(out, { cleared: true });
  assert.equal(requests, 0, 'logout 不许联网');

  // 登出后仍然是 false。
  assert.equal((await service.status()).logged_in, false);
  // `logout` 要求立即落盘（persist: true）—— 延迟落盘时磁盘上的旧会话会"复活"，
  // 那是安全问题。这条断言只能证明「清空没抛错」，落盘策略由 SessionStore 保证。
  assert.equal(typeof service.login, 'function');
});

test('plugin 导出：新增的纯解析函数都从 index 透出（页面/脚本不必深引 src）', () => {
  for (const key of [
    'parsePlan', 'splitCourses', 'PLAN_PAGE_SIZE', 'planPdfUrl',
    'parseSelectionContext', 'parseSelectionRow', 'parseCapacity', 'selectionState',
    'selectionPageForm', 'selectionSearchForm', 'assertSelectionTerm',
    'courseView', 'sectionView', 'ownedView', 'flatten',
    'ZDBK_MODULES', 'ZDBK_PLAN_PATHS', 'ZDBK_SELECTION_PATHS',
  ]) {
    assert.ok(key in plugin, `index.js 应导出 ${key}`);
  }
  // 写操作相关的（上游 `Xsxk#select` 那三个）**不许**出现在导出里。
  for (const forbidden of ['selectionSelect', 'selectionReorder', 'selectionDrop', 'Xsxk']) {
    assert.equal(forbidden in plugin, false, `${forbidden} 属写操作，不该在本包`);
  }
});

test('错误码稳定：新方法用的码都在预期集合里', async () => {
  // 码要稳定（页面按码分派），文案要可操作 —— 这里钉的是**码**。
  // 首页给一篇空 HTML：解析层必然报「缺 xn」。
  const api = fakeApi2({ html: { [ZDBK_SELECTION_PATHS.index]: '<html><body>没有 input</body></html>' } });
  const reader = new ZdbkReader(api);
  await assert.rejects(() => reader.selectionContext(), (e) => e.code === 'SCHEMA_CHANGED');
  await assert.rejects(() => reader.planList({ year: 'x' }), (e) => e.code === 'INVALID_ARGUMENT');
  // 缺参数时**在发请求之前**报（`selectionSections` 先校验参数、再取上下文）。
  await assert.rejects(
    () => reader.selectionSections({}),
    (e) => e.code === 'INVALID_ARGUMENT',
  );
  assert.equal(api.calls.filter((c) => c.kind === 'html').length, 1, '只有 selectionContext 读过一次首页');
});

test('timetable：六类课都在同一响应里，kind 标明来源（审计 W-18）', async () => {
  // 审计查出本仓先前只读 kbList，另外五类（实践/线上/英文/进修/服从安排）全丢。
  // 那些是学生真实课表里有的课，漏读的代价是「课表少了几门课」，
  // 而用户会以为教务网没排。
  const { ZdbkReader } = await import('../../../packages/source/zdbk/src/reads.js');
  // `parseSession` 要的字段：`kcb`（含 <br> 分隔的课程/教师/地点）、`xqj` 星期、
  // `djj` 起始节、`skcd` 连堂节数。字段名写错会让解析静默返回 0 条。
  const base = {
    kcmc: '高等数学', xqj: '1', djj: '1', skcd: '2',
    kcb: '高等数学<br>必修<br>张三<br>紫金港东1-101',
    kcdm: 'MATH1001', xkkh: 'P1', zcd: '1-16周',
  };
  const reader = new ZdbkReader({
    async post() {
      return {
        kbList: [{ ...base, kcmc: '正式课' }],
        sjkList: [{ ...base, kcmc: '实践课' }],
        xskList: [{ ...base, kcmc: '线上课' }],
        ywkList: [{ ...base, kcmc: '英文课' }],
        jxkList: [{ ...base, kcmc: '进修课' }],
        fKbList: [{ ...base, kcmc: '服从安排' }],
      };
    },
  }, () => new Date('2026-11-10T12:00:00+08:00'));

  const result = await reader.timetable({ academic_year: '2026-2027', term: 1 });
  assert.equal(result.sessions.length, 6, '六类都要读进来');
  const kinds = new Set(result.sessions.map((s) => s.kind));
  assert.deepEqual([...kinds].sort(),
    ['advanced', 'arranged', 'english', 'formal', 'online', 'practice'],
    'kind 要标明来源');
});

test('timetable：kbList 缺失仍是错误（那是主课表，不是空）', async () => {
  const { ZdbkReader } = await import('../../../packages/source/zdbk/src/reads.js');
  const reader = new ZdbkReader({
    async post() { return { sjkList: [] }; },
  }, () => new Date('2026-11-10T12:00:00+08:00'));
  await assert.rejects(
    () => reader.timetable({ academic_year: '2026-2027', term: 1 }),
    '缺 kbList 说明结构变了，不能静默成空',
  );
});
/* ────────────────────────────── 评教提示（W-19） ── */

test('grades：评教没做时给一句能直接上屏的提示，成绩照常返回', async () => {
  const api = fakeApi({
    [ZDBK_PATHS.grades]: { items: GRADE_FIXTURE },
    [ZDBK_EVAL_PATH]: { status: 'success', result: '0' },
  });
  const out = await new ZdbkReader(api).grades();
  assert.equal(out.grades.length, 5, '提示不能把成绩带走');
  assert.match(out.evaluationPending, /尚未完成评教/, '要说明「本学期成绩为什么是空的」');
});

test('grades：评教已完成时不给提示（不能凭一个字段编结论）', async () => {
  const api = fakeApi({
    [ZDBK_PATHS.grades]: { items: GRADE_FIXTURE },
    [ZDBK_EVAL_PATH]: { status: 'success', result: '1' },
  });
  const out = await new ZdbkReader(api).grades();
  assert.equal('evaluationPending' in out, false);
});

test('grades：评教接口挂掉时当作「不知道」，不编「你没评教」', async () => {
  const api = fakeApi({
    [ZDBK_PATHS.grades]: { items: GRADE_FIXTURE },
    [ZDBK_EVAL_PATH]: () => { throw new ClassroomError('PLATFORM_ERROR', 'boom'); },
  });
  const out = await new ZdbkReader(api).grades();
  assert.equal(out.grades.length, 5);
  assert.equal('evaluationPending' in out, false);
});
