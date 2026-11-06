/**
 * 教务响应的解析与 GPA 计算。
 *
 * 这一层**不碰网络**（除了 `requiredArray` 这类纯校验）：给定一条正方返回的
 * 原始条目，产出一个形状稳定的行。好处是 GPA 与解析规则能脱离登录态单独测 ——
 * 而它们恰恰是最容易算错、也最该被钉住的部分。
 *
 * 从 `dsh-zhiyun-source-omni/src/platforms/zdbk/parse.ts` 逐个函数移植，
 * **逻辑一字未改**（只把 TS 类型换成 JSDoc）。理由见 `gpaOf` 的注释：
 * 这套口径是踩出来的，简化任何一条都会让分数对不上学校成绩单。
 */

import { ClassroomError } from 'dsh-zhiyun-source-campus/http';

/** 四个学期（浙大按「秋/冬/春/夏」分，不是简单的上下半学期）。 */
export const TERMS = ['秋', '冬', '春', '夏'];

/** @typedef {'秋'|'冬'|'春'|'夏'} Term */

const YEAR = /^(\d{4})-(\d{4})$/;

/**
 * 校验学年格式 `2025-2026`（后一年必须正好是前一年 +1）。
 *
 * 为什么要卡这一条：学年是**要发给服务端的**（课表的 `xnm` 参数）。
 * 写错了正方不会报错，只回一份空课表 —— 用户看到的是「这学期没有课」，
 * 而问题其实是把 `2025-2026` 打成了 `2025-2027`。
 *
 * @param {string} value - 学年。
 * @returns {string} 原样返回（校验通过）。
 */
export function checkAcademicYear(value) {
  const m = String(value ?? '').match(YEAR);
  if (!m || Number(m[2]) !== Number(m[1]) + 1) throw new ClassroomError('INVALID_ARGUMENT', '学年格式应为 2025-2026。');
  return value;
}

/**
 * 正方课表接口的 `xqm` 值：`"<学期号>|<学期名>"`。
 *
 * 秋、冬属于第 1 学期（秋冬），春、夏属于第 2 学期（春夏）。
 * ⚠️ 必须带上 `|季` 那一半：只发 `1` 时正方把秋冬合并返回，
 * 「冬」的课会混进「秋」，而这是**服务端**的取舍，客户端改不回来。
 *
 * @param {Term} term - 学期。
 * @returns {string} 形如 `1|秋`。
 */
export function termCode(term) {
  return `${term === '秋' || term === '冬' ? 1 : 2}|${term}`;
}

/**
 * 学期 → 学期号（1 = 秋冬，2 = 春夏）。
 *
 * @param {Term} term - 学期。
 * @returns {1|2} 学期号。
 */
export function semesterOfTerm(term) {
  return term === '秋' || term === '冬' ? 1 : 2;
}

/**
 * 按**上海日历**推断当前学期。
 *
 * 为什么不能用本机时间：本机时区可能是 UTC、也可能被改过；而「现在是几月」
 * 决定的是「该看哪张课表」。用 `Intl` 拿到上海的年月日再判断，结果与本机时区无关。
 *
 * 分界点是学校的作息，不是自然季度：
 *   - 8 月开学 → 秋；11 月 15 日之后转冬（期中之后学校里就按冬季作息排课了）；
 *   - 11 月~次年 2 月 → 冬；3~4 月 → 春；5~7 月 → 夏。
 *
 * @param {Date} [now] - 参考时刻（默认现在）。
 * @returns {{academic_year: string, term: Term}} 学年与学期。
 */
export function currentTerm(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(now).map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  // 学年在 8 月切换：2026 年 3 月属于 2025-2026 学年。
  const start = month >= 8 ? year : year - 1;
  let term;
  if (month >= 8 && (month <= 10 || (month === 11 && day < 15))) term = '秋';
  else if (month >= 11 || month <= 2) term = '冬';
  else if (month <= 4) term = '春';
  else term = '夏';
  return { academic_year: `${start}-${start + 1}`, term };
}

/**
 * 从选课课号里取出学年与学期。
 *
 * 课号形如 `(2025-2026-1)-CS1001G-0012345-1`：括号里前两段是学年，第三段是学期号。
 *
 * @param {unknown} key - 选课课号。
 * @returns {{academic_year: string, semester: number}|null} 解析结果，格式不符时 null。
 */
export function semesterOfCourseKey(key) {
  const m = String(key ?? '').match(/^\((\d{4}-\d{4})-(\d)\)/);
  return m ? { academic_year: m[1], semester: Number(m[2]) } : null;
}

/**
 * 从选课课号里取出课程代码（`CS1001G`）。
 *
 * 单独取的原因是课号整体是**每次选课**唯一的（末段是选课序号），
 * 而课程代码用于跨学期认同一门课。
 *
 * @param {unknown} key - 选课课号。
 * @returns {string|null} 课程代码；格式不符时 null。
 */
export function courseCodeOfKey(key) {
  const m = String(key ?? '').match(/^\(\d{4}-\d{4}-\d\)-([^-]+)/);
  return m ? m[1] : null;
}

const text = (value) => (value == null ? '' : String(value)).trim();
// 半角括号统一成全角：同一门课在不同接口里括号写法不一致，
// 不统一的话「按课程名去重/比较」会认成两门课。
const normalizeName = (value) => value.replace(/\(/g, '（').replace(/\)/g, '）');
const stripTags = (value) => value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();

/**
 * 等级制 / 二级制成绩的常用百分制折算。
 *
 * ⚠️ 这是**本仓自己**的折算，不是学校公布的换算表。它只用于 `average_score`
 * 这一个参考指标；`gpa_5` / `gpa_4_3` 用的是教务直接给的绩点（`jd`），
 * 不经过这张表 —— 否则一旦折算表选得不同，两个 GPA 都会跟着变，很难归因。
 */
const LEVEL_SCORES = {
  'A+': 95, A: 90, 'A-': 87, 'B+': 83, B: 80, 'B-': 77, 'C+': 73, C: 70, 'C-': 67, D: 60, F: 0,
  优秀: 90, 良好: 80, 中等: 70, 及格: 60, 不及格: 0, 合格: 75, 不合格: 0,
};

/** 这些成绩状态**不计学分**（课还没上完 / 记录无效）。 */
const NOT_COUNTED = new Set(['弃修', '待录', '缓考', '无效']);

/** 二级制：只记通过与否，**不计入 GPA**（学校不把它们折成绩点）。 */
const PASS_FAIL = new Set(['合格', '不合格']);

/**
 * 4.3 制的映射表。
 *
 * 很多海外研究生项目要 4.3 制，而教务只给 5 分制绩点。学校承认的换算是：
 * `5.0→4.3`、`4.8→4.2`、`4.5→4.1`、`4.2→4.0`，**其余一律封顶 4.0**。
 *
 * ⚠️ 「其余封顶 4.0」这一条不能写成「按比例缩放」：`4.9` 在这套口径下是 4.0，
 * 而不是 4.9*0.86=4.21。按比例算会让高分段集体偏高，与开出来的成绩单不符。
 */
const FOUR_THREE = { 5: 4.3, '4.8': 4.2, '4.5': 4.1, '4.2': 4.0 };

/**
 * 成绩行。
 *
 * @typedef {object} GradeRow
 * @property {string} course_key - 选课课号（每次选课唯一）。
 * @property {string|null} course_code - 课程代码（跨学期稳定）。
 * @property {string} name - 课程名。
 * @property {string|null} academic_year - 学年。
 * @property {number|null} semester - 学期号。
 * @property {number} credit - 学分。
 * @property {string} score - 成绩原文。
 * @property {number|null} grade_point - 教务给的五分制绩点。
 * @property {boolean} counted_in_gpa - 是否计入 GPA。
 * @property {boolean} counted_in_credits - 是否计入学分。
 */

/**
 * 解析一条成绩记录。
 *
 * 三个判定要分开写，因为它们的口径不同：
 *   - `counted_in_credits`：弃修/待录/缓考/无效**不计学分**（课没完成）；
 *   - `counted_in_gpa`：还要排除「合格/不合格」（无绩点）、未知课程（`xtwkc`）
 *     与没有绩点的行；
 *   - 这三条都不能合并成一个布尔 —— 合并后「已修学分」会跟着 GPA 口径一起错。
 *
 * @param {Record<string, unknown>} item - 正方返回的一条成绩。
 * @returns {GradeRow} 解析后的行。
 */
export function parseGrade(item) {
  const key = text(item.xkkh);
  if (!key) throw new ClassroomError('SCHEMA_CHANGED', '成绩条目缺少选课课号 xkkh。');
  const score = text(item.cj);
  const credit = Number(item.xf);
  // ⚠️ `jd === ''` 要单独判：`Number('')` 是 0，会把「没有绩点」变成「绩点 0」，
  //    于是缓考/待录的行被当成 0 分计入 GPA，整学期绩点被拉低。
  const point = item.jd === '' || item.jd == null ? null : Number(item.jd);
  const sem = semesterOfCourseKey(key);
  const countedInCredits = !NOT_COUNTED.has(score);
  return {
    course_key: key,
    course_code: courseCodeOfKey(key),
    name: normalizeName(text(item.kcmc) || '未知课程'),
    academic_year: sem?.academic_year ?? null,
    semester: sem?.semester ?? null,
    credit: Number.isFinite(credit) ? credit : 0,
    score,
    grade_point: point != null && Number.isFinite(point) ? point : null,
    // `xtwkc` 是「校选修网络课」：有成绩但不计入绩点，学校口径如此。
    counted_in_gpa: countedInCredits && !PASS_FAIL.has(score) && !key.includes('xtwkc') && point != null && Number.isFinite(point),
    counted_in_credits: countedInCredits,
  };
}

/**
 * 一行成绩的百分制当量（用于 `average_score`，**不**用于绩点）。
 *
 * @param {GradeRow} row - 成绩行。
 * @returns {number|null} 百分制分数；无法折算时 null。
 */
function hundredOf(row) {
  if (Object.prototype.hasOwnProperty.call(LEVEL_SCORES, row.score)) return LEVEL_SCORES[row.score];
  const n = Number(row.score);
  return Number.isFinite(n) ? n : null;
}

const round = (n, digits = 3) => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * GPA 汇总。
 *
 * @typedef {object} GpaSummary
 * @property {number|null} gpa_5 - 五分制 GPA。
 * @property {number|null} gpa_4_3 - 4.3 制 GPA。
 * @property {number|null} average_score - 学分加权百分制均分（参考值）。
 * @property {number} gpa_credits - 计入 GPA 的学分。
 * @property {number} earned_credits - 已获得学分。
 * @property {number} courses - 参与统计的课程数。
 */

/**
 * 按学分加权算 GPA。
 *
 * # 三个口径必须分别算（这是本函数最容易写错的地方）
 *
 * 1. `gpa_5` / `gpa_4_3` 的分母是**计入 GPA 的学分**（`counted_in_gpa`），
 *    不是总学分 —— 用总学分会让分母偏大、GPA 集体偏低；
 * 2. `earned_credits`（已获学分）的口径更宽：学分有效、且绩点 > 0，
 *    **或者**成绩是「合格」，**或者**是校选修网络课。这几类都算拿到了学分，
 *    但只有前一类进 GPA；
 * 3. `average_score` 只统计**能折成百分制**的行，且自己的分母是这些行的学分 ——
 *    混用 GPA 的分母会让等级制课程把均分拉低。
 *
 * 空集合返回 `null` 而不是 0：0 会被界面当成「GPA 是 0」画成一条贴底的曲线，
 * 而真相是「还没有成绩」。
 *
 * @param {GradeRow[]} rows - 成绩行。
 * @returns {GpaSummary} 汇总。
 */
export function gpaOf(rows) {
  const counted = rows.filter((r) => r.counted_in_gpa);
  const credits = counted.reduce((s, r) => s + r.credit, 0);
  const earned = rows
    .filter((r) => r.counted_in_credits && ((r.grade_point ?? 0) > 0 || r.score === '合格' || r.course_key.includes('xtwkc')))
    .reduce((s, r) => s + r.credit, 0);
  if (!credits) return { gpa_5: null, gpa_4_3: null, average_score: null, gpa_credits: 0, earned_credits: round(earned, 1), courses: rows.length };
  const five = counted.reduce((s, r) => s + (r.grade_point ?? 0) * r.credit, 0) / credits;
  const four = counted.reduce((s, r) => s + (r.grade_point > 4 ? FOUR_THREE[String(r.grade_point)] ?? 4 : r.grade_point) * r.credit, 0) / credits;
  const scored = counted.filter((r) => hundredOf(r) != null);
  const scoredCredits = scored.reduce((s, r) => s + r.credit, 0);
  const avg = scoredCredits ? scored.reduce((s, r) => s + hundredOf(r) * r.credit, 0) / scoredCredits : null;
  return {
    gpa_5: round(five),
    gpa_4_3: round(four),
    average_score: avg == null ? null : round(avg, 2),
    gpa_credits: round(credits, 1),
    earned_credits: round(earned, 1),
    courses: rows.length,
  };
}

/**
 * 紫金港常规作息表（节次 → 起止时间）。
 *
 * 为什么写死而不是从接口取：正方只给节次号（`djj` + `skcd`），不给时间。
 * 界面上要显示「08:00-09:35」就必须有一张表，而它是**校区作息**，不是接口数据。
 */
export const PERIOD_TIMES = {
  1: ['08:00', '08:45'], 2: ['08:50', '09:35'], 3: ['10:00', '10:45'], 4: ['10:50', '11:35'], 5: ['11:40', '12:25'],
  6: ['13:25', '14:10'], 7: ['14:15', '15:00'], 8: ['15:05', '15:50'], 9: ['16:15', '17:00'], 10: ['17:05', '17:50'],
  11: ['18:50', '19:35'], 12: ['19:40', '20:25'], 13: ['20:30', '21:15'],
};

/**
 * 一节课（课表里的一条）。
 *
 * @typedef {object} ClassSession
 * @property {string} name - 课程名。
 * @property {string|null} teacher - 教师。
 * @property {string|null} location - 地点。
 * @property {number} weekday - 星期几（1=周一）。
 * @property {number[]} periods - 节次列表。
 * @property {string|null} time - 时段文本（`08:00-09:35`）。
 * @property {'all'|'odd'|'even'} weeks - 单双周。
 * @property {string|null} terms - 课程所跨学期（如「秋冬」）。
 * @property {boolean|null} confirmed - 是否已确认。
 */

/**
 * 解析一条课表记录。
 *
 * # `kcb` 是 HTML 片段，不能按「一列一字段」去取
 *
 * 正方的课表把课程信息塞在一个字段里：`课程名<br>学期信息<br>教师<br>地点zwf…`。
 * 所以必须按 `<br>` 切开、逐段去标签，然后再按下标取值。
 * 「地点」那一段尾部带一截 `zwf` 开头的内部编码，要切掉。
 *
 * 返回 null 表示**这条不是要显示的课**（`sfyjskc=1` 是「是否已排课」之类的标记行），
 * 与「解析失败」是两件事：前者不该计入 `skipped`。
 *
 * @param {Record<string, unknown>} item - 正方返回的一条课表记录。
 * @returns {ClassSession|null} 解析结果；该条不显示时 null。
 */
export function parseSession(item) {
  // `sfyjskc=1`：这一条不是实际排定的课（学校用来挂备注/占位）。
  if (text(item.sfyjskc) === '1') return null;
  const block = text(item.kcb);
  if (!block) return null;
  const parts = block.split(/<br\s*\/?>/i).map((p) => stripTags(p));
  const weekday = Number(item.xqj);
  const start = Number(item.djj);
  const length = Number(item.skcd);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || !Number.isInteger(start) || !Number.isInteger(length) || length < 1) {
    throw new ClassroomError('SCHEMA_CHANGED', '课表条目缺少有效的星期或节次。');
  }
  const periods = Array.from({ length }, (_, i) => start + i);
  const first = PERIOD_TIMES[periods[0]];
  const last = PERIOD_TIMES[periods[periods.length - 1]];
  // 地点那段以 `zwf` 分隔内部编码：`紫金港东1-101zwf...`，只取前面的可读部分。
  const rawLocation = (parts[3] ?? '').split('zwf')[0].trim();
  const dsz = text(item.dsz);
  return {
    name: normalizeName(parts[0] || '未知课程'),
    teacher: parts[2] || null,
    location: rawLocation || null,
    weekday,
    periods,
    time: first && last ? `${first[0]}-${last[1]}` : null,
    // 正方的单双周是反的直觉：`0` 是单周、`1` 是双周。写反的话整学期的课会错开一周。
    weeks: dsz === '0' ? 'odd' : dsz === '1' ? 'even' : 'all',
    terms: text(item.xxq) || null,
    confirmed: item.sfqd == null ? null : text(item.sfqd) === '1',
  };
}

/**
 * 一条考试安排。
 *
 * @typedef {object} ExamRow
 * @property {string} course_key - 选课课号。
 * @property {string} name - 课程名。
 * @property {number|null} credit - 学分。
 * @property {'midterm'|'final'} type - 期中/期末。
 * @property {string} time_text - 时间原文。
 * @property {string|null} start - ISO 起点（含 +08:00）；未排定时 null。
 * @property {string|null} end - ISO 终点。
 * @property {string|null} location - 地点。
 * @property {string|null} seat - 座位号。
 * @property {string|null} academic_year - 学年。
 * @property {number|null} semester - 学期号。
 */

/**
 * 把「2026年01月15日(08:00-10:00)」解析成带 `+08:00` 的 ISO 串。
 *
 * # 为什么必须写死 +08:00，而不是让 `Date` 去猜
 *
 * 正方给的时间**不带时区**。交给 `new Date('2026-01-15T08:00')` 会按**本机时区**
 * 解释 —— 同一份数据在 UTC 机器上会差 8 小时，于是「考试还有 8 小时」变成
 * 「考试已经开始了」。这是最危险的一类错误：它会让人错过考试。
 *
 * 只有日期没有时段（例如只写「考试周」）时返回 `null`：**不编造**时刻。
 *
 * @param {string} value - 时间原文。
 * @returns {{start: string|null, end: string|null}} ISO 起止。
 */
export function parseExamTime(value) {
  const date = String(value ?? '').match(/(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
  const range = String(value ?? '').match(/(\d{1,2}):(\d{2})\s*[-~—至]\s*(\d{1,2}):(\d{2})/);
  if (!date || !range) return { start: null, end: null };
  const pad = (n) => String(n).padStart(2, '0');
  const day = `${date[1]}-${pad(date[2])}-${pad(date[3])}`;
  return { start: `${day}T${pad(range[1])}:${range[2]}:00+08:00`, end: `${day}T${pad(range[3])}:${range[4]}:00+08:00` };
}

/**
 * 解析一条考试记录，**可能产出 0~2 行**（期中 + 期末）。
 *
 * 一条记录里同时挂着期中与期末两个时段。没有时间的那一种不产出 —— 正方对
 * 「没有期中考试」和「期中时间还没排」都给空串，两者都只能当作「没有这一条」。
 *
 * @param {Record<string, unknown>} item - 正方返回的一条考试记录。
 * @returns {ExamRow[]} 期中/期末行。
 */
export function parseExams(item) {
  const key = text(item.xkkh);
  if (!key) throw new ClassroomError('SCHEMA_CHANGED', '考试条目缺少选课课号 xkkh。');
  const sem = semesterOfCourseKey(key);
  const base = {
    course_key: key,
    name: normalizeName(text(item.kcmc) || '未知课程'),
    credit: item.xf == null || item.xf === '' ? null : Number(item.xf),
    academic_year: sem?.academic_year ?? null,
    semester: sem?.semester ?? null,
  };
  const out = [];
  const add = (type, time, location, seat) => {
    const timeText = text(time);
    if (!timeText) return;
    out.push({ ...base, type, time_text: timeText, ...parseExamTime(timeText), location: text(location) || null, seat: text(seat) || null });
  };
  add('midterm', item.qzkssj, item.qzjsmc, item.qzzwxh);
  add('final', item.kssj, item.jsmc, item.zwxh);
  return out;
}

/**
 * 从平台响应里取一个必有的数组字段。
 *
 * **缺字段是错误，不是空列表**。退回空数组的后果是：接口一变，
 * 界面显示「这学期没有成绩」——一个看起来正常的、彻底的谎言。
 *
 * @param {unknown} data - 平台响应。
 * @param {string} key - 字段名（成绩是 `items`，课表是 `kbList`）。
 * @returns {Record<string, unknown>[]} 数组。
 */
export function requiredArray(data, key) {
  const value = data && typeof data === 'object' ? data[key] : undefined;
  if (!Array.isArray(value)) {
    throw new ClassroomError('SCHEMA_CHANGED', `平台响应缺少 ${key} 数组。无法将异常响应当作空列表。`);
  }
  return value;
}
