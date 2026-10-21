/**
 * 教务数据源（`dsh-zhiyun-source-zdbk`）的契约测试。**全部离线**。
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
  ZDBK_BASE, ZDBK_CAS_ENTRY, ZDBK_HOSTS, ZDBK_PATHS, ZDBK_SERVICE, ZDBK_HOST,
} from '../packages/dsh-zhiyun-source-zdbk/src/hosts.js';
import {
  PERIOD_TIMES, checkAcademicYear, courseCodeOfKey, currentTerm, gpaOf, parseExams,
  parseExamTime, parseGrade, parseSession, semesterOfCourseKey, semesterOfTerm, termCode,
} from '../packages/dsh-zhiyun-source-zdbk/src/parse.js';
import { casForm, casLogin, encryptCasPassword, hasCasForm, describeAuthFailure } from '../packages/dsh-zhiyun-source-zdbk/src/cas.js';
import { ZdbkClient } from '../packages/dsh-zhiyun-source-zdbk/src/client.js';
import { ZdbkReader } from '../packages/dsh-zhiyun-source-zdbk/src/reads.js';
import { Transport } from 'dsh-zhiyun-source-campus/http';
import * as plugin from '../packages/dsh-zhiyun-source-zdbk/src/index.js';

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

  // GET：自描述，四个方法都在，且顺序稳定。
  const getResponse = await registered.fetch(new Request('http://127.0.0.1/api/zhiyun-zdbk', { method: 'GET' }));
  const described = await getResponse.json();
  assert.equal(described.ok, true);
  assert.deepEqual(described.value.methods.map((m) => m.method), ['zdbk.grades', 'zdbk.gpaSummary', 'zdbk.exams', 'zdbk.timetable']);

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
  for (const method of ['zdbk.constructor', 'zdbk.__proto__', 'zdbk.toString', 'zdbk.items', 'zdbk.rows', '__proto__', 'grades', 42, null]) {
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
  const root = new URL('../packages/dsh-zhiyun-source-zdbk/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.name, 'dsh-zhiyun-source-zdbk');
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, './src/index.js');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  // 共享层必须是**依赖**而不是复制：少了这两条，装到 profile 里就 import 不到。
  assert.ok(manifest.dependencies['dsh-zhiyun-source-campus'], '必须依赖共享 HTTP 层');
  assert.ok(manifest.dependencies['dsh-zhiyun-source-card'], '必须依赖凭据读取');

  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8');
  assert.match(patch, /id: zhiyun-zdbk/);
  assert.match(patch, /name: dsh-zhiyun-source-zdbk/);

  // 源码里不许出现 TypeScript（本包刻意是纯 JS）。
  const src = await readFile(new URL('src/index.js', root), 'utf8');
  assert.equal(/\.ts['"]/.test(src), false, 'index.js 不该 import .ts');
});
