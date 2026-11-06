/**
 * 教务数据读取器：成绩 / GPA 汇总 / 考试安排 / 课表。
 *
 * 这一层只做**编排**：发哪几个请求、怎么筛、怎么排、返回什么形状。
 * 解析与 GPA 在 `parse.js`，HTTP 在 `client.js` —— 三层的分界是「换掉任一层，
 * 另外两层不用动」。比如测试里可以塞一个假的 `ZdbkClient.post` 就把整条读取链路
 * 跑通，完全不碰网络与登录。
 */

import { ClassroomError } from 'dsh-zhiyun-source-campus/http';

import { ZDBK_PATHS } from './hosts.js';
import {
  checkAcademicYear, currentTerm, gpaOf, parseExams, parseGrade, parseSession,
  requiredArray, semesterOfTerm, termCode,
} from './parse.js';

/**
 * 一次把所有条目取回来的查询参数。
 *
 * 正方默认分页（`queryModel.showCount` 是 10）。不显式拉大就会**静默截断** ——
 * 一个学期被科目数一除，看起来像"系统里只有 10 条成绩"，没人会想到是分页。
 * 5000 足够覆盖一个学生的全部在校记录。
 */
const ALL = { doType: 'query', 'queryModel.showCount': 5000 };

/** 星期名。下标 0 留空，让 `WEEKDAYS[weekday]` 直接对上 1~7。 */
const WEEKDAYS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/**
 * 学期筛选条件。
 *
 * @typedef {object} SemesterFilter
 * @property {string} [academic_year] - 学年（`2025-2026`）。
 * @property {1|2} [semester] - 学期号（1=秋冬，2=春夏）。
 */

/**
 * 一行是否满足学期筛选。
 *
 * 没给的维度**不参与筛选**（而不是筛掉）—— 调用方只想按学年过滤时，
 * 不该被迫同时给出学期。
 *
 * @param {{academic_year: string|null, semester: number|null}} row - 行。
 * @param {SemesterFilter} filter - 筛选条件。
 * @returns {boolean} 是否保留。
 */
function matches(row, filter) {
  if (filter.academic_year && row.academic_year !== filter.academic_year) return false;
  if (filter.semester && row.semester !== filter.semester) return false;
  return true;
}

/**
 * 教务数据读取器。
 */
export class ZdbkReader {
  /**
   * @param {{post: (path: string, options?: object) => Promise<Record<string, unknown>|null>}} api - 教务客户端。
   * @param {() => Date} [now] - 时钟（测试注入，默认 `Date.now`）。
   */
  constructor(api, now = () => new Date()) {
    this.api = api;
    this.now = now;
  }

  /**
   * 取一个列表接口的 `items`。
   *
   * @param {string} path - 接口路径。
   * @returns {Promise<Record<string, unknown>[]>} 原始条目。
   */
  async items(path) {
    return requiredArray(await this.api.post(path, { query: ALL }), 'items');
  }

  /**
   * 逐条解析，把「解析不了的条目」单独计数。
   *
   * # 为什么不是一有错就炸
   *
   * 正方偶尔会混进一条结构异常的记录（多一条备注行、某个字段换了类型）。
   * 一条坏行让整份成绩单读不出来，代价远大于收益。所以：
   *   - 单条失败 → 计入 `skipped`，其余照旧；
   *   - **但「全都失败」是异常**，说明接口字段整体变了，必须明确报错 ——
   *     否则界面会显示「没有成绩」，一个看起来正常的、彻底的谎言。
   *
   * @param {Record<string, unknown>[]} items - 原始条目。
   * @param {(item: Record<string, unknown>) => any|any[]} parse - 解析器（可产出多行）。
   * @returns {{rows: any[], skipped: number}} 解析结果与跳过数。
   */
  rows(items, parse) {
    const rows = [];
    let skipped = 0;
    for (const item of items) {
      try {
        const parsed = parse(item);
        // 解析器返回空数组表示「这条按设计不显示」（如未排课的占位行），不算跳过。
        rows.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      } catch {
        skipped++;
      }
    }
    if (items.length && !rows.length && skipped) {
      throw new ClassroomError('SCHEMA_CHANGED', '教务系统返回的条目都无法识别，接口字段可能已变化。');
    }
    return { rows, skipped };
  }

  /**
   * 成绩（含该筛选范围的 GPA 汇总）。
   *
   * @param {SemesterFilter & {major_only?: boolean}} [filter] - 筛选条件。
   * @returns {Promise<object>} `{ scope, summary, grades, skipped_items, note }`。
   */
  async grades(filter = {}) {
    if (filter.academic_year) checkAcademicYear(filter.academic_year);
    const { rows, skipped } = this.rows(
      await this.items(filter.major_only ? ZDBK_PATHS.majorGrades : ZDBK_PATHS.grades),
      parseGrade,
    );
    const selected = rows
      .filter((r) => matches(r, filter))
      // 新的在前；同一学期内按课程名（中文）排，保证顺序稳定 —— 不排的话
      // 每次请求的顺序都可能不同，页面上的列表会无端跳动。
      .sort((a, b) => `${b.academic_year}${b.semester}`.localeCompare(`${a.academic_year}${a.semester}`) || a.name.localeCompare(b.name, 'zh'));
    return {
      scope: { academic_year: filter.academic_year ?? null, semester: filter.semester ?? null, major_only: filter.major_only ?? false },
      summary: gpaOf(selected),
      grades: selected,
      skipped_items: skipped,
      note: 'GPA 由本地按学分加权计算（五分制直接取教务绩点；4.3 制按 5.0→4.3、4.8→4.2、4.5→4.1、4.2→4.0，其余封顶 4.0）。弃修、待录、缓考、无效不计学分，合格/不合格不计 GPA。以学校官方成绩单为准。',
    };
  }

  /**
   * GPA 汇总：总体 / 专业 / 分学期。
   *
   * 「专业 GPA」走的是**另一个接口**（`majorGrades`），是服务端按培养方案筛过的
   * 口径，不是「从全部成绩里挑专业课」—— 两者结果常常不同，不能互相替代。
   *
   * 专业那一份允许失败：有些学生的培养方案还没配，接口会 403/空。此时
   * `major` 为 null、`major_error` 记下原因，**其余两份照常给** ——
   * 一个可选指标失败不该把整页成绩带走。
   *
   * @returns {Promise<object>} `{ overall, major, major_error, semesters, note }`。
   */
  async gpaSummary() {
    const all = this.rows(await this.items(ZDBK_PATHS.grades), parseGrade).rows;
    let major = null;
    let majorError = null;
    try {
      major = gpaOf(this.rows(await this.items(ZDBK_PATHS.majorGrades), parseGrade).rows);
    } catch (error) {
      majorError = error?.code ?? 'INTERNAL_ERROR';
    }
    const bySemester = new Map();
    for (const row of all) {
      const key = row.academic_year ? `${row.academic_year}-${row.semester}` : 'unknown';
      bySemester.set(key, [...(bySemester.get(key) ?? []), row]);
    }
    return {
      overall: gpaOf(all),
      major,
      major_error: majorError,
      // 倒序：最近学期在最上面。`localeCompare` 对 `unknown` 也稳定（会排在最后）。
      semesters: [...bySemester.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([key, rows]) => ({ semester: key, ...gpaOf(rows) })),
      note: 'semester 形如 2025-2026-1（1=秋冬，2=春夏）。GPA 为本地计算，以学校官方成绩单为准。',
    };
  }

  /**
   * 考试安排。
   *
   * @param {SemesterFilter & {upcoming_only?: boolean}} [filter] - 筛选条件。
   * @returns {Promise<object>} `{ scope, exams, skipped_items, note }`。
   */
  async exams(filter = {}) {
    if (filter.academic_year) checkAcademicYear(filter.academic_year);
    const { rows, skipped } = this.rows(await this.items(ZDBK_PATHS.exams), parseExams);
    const now = this.now().getTime();
    const selected = rows
      .filter((r) => matches(r, filter))
      // `end == null` 的保留：那是「只给了考试周、还没排具体日期」的考试，
      // 它不是"已经过去"，滤掉会让用户以为这学期没有这科考试。
      .filter((r) => !filter.upcoming_only || r.end == null || Date.parse(r.end) >= now)
      .sort((a, b) => (a.start ? Date.parse(a.start) : Infinity) - (b.start ? Date.parse(b.start) : Infinity) || a.name.localeCompare(b.name, 'zh'));
    return {
      scope: { academic_year: filter.academic_year ?? null, semester: filter.semester ?? null, upcoming_only: filter.upcoming_only ?? false },
      exams: selected,
      skipped_items: skipped,
      note: '时间为北京时间。start 为空表示教务只给出考试周等描述（time_text），尚未排定具体日期；upcoming_only 会保留这类考试。',
    };
  }

  /**
   * 课表。
   *
   * # 学期是**推断**出来的，而且要如实标注
   *
   * 正方课表接口必须显式给学年学期。调用方没给时按当前日期推断 —— 但推断
   * 可能是错的（寒暑假、补课周），所以返回值里带 `inferred_term`：
   * 页面据此可以提示「这是按今天推的学期」，而不是让用户以为系统认错了课表。
   *
   * @param {{academic_year?: string, term?: import('./parse.js').Term}} [args] - 学年与学期。
   * @returns {Promise<object>} 课表与推断标记。
   */
  async timetable(args = {}) {
    const guessed = currentTerm(this.now());
    const academic_year = checkAcademicYear(args.academic_year ?? guessed.academic_year);
    const term = args.term ?? guessed.term;
    // `allowNull`：学期不存在时正方回 `null`，那不是错误 —— 就是这一学期没课。
    const data = await this.api.post(ZDBK_PATHS.timetable, { form: { xnm: academic_year, xqm: termCode(term), captcha_value: '' }, allowNull: true });
    const items = data == null ? [] : requiredArray(data, 'kbList');
    const { rows, skipped } = this.rows(items, (item) => {
      const session = parseSession(item);
      // 占位行返回 `[]`（不是 `null`）：`rows()` 用「是不是数组」来区分
      // 「按设计不显示」与「解析失败」，这里必须按前者的语义返回。
      return session ? [session] : [];
    });
    // 按星期、再按起始节次排：页面直接按这个顺序往格子图上放。
    rows.sort((a, b) => a.weekday - b.weekday || a.periods[0] - b.periods[0]);
    return {
      academic_year,
      term,
      semester: semesterOfTerm(term),
      inferred_term: !args.academic_year || !args.term,
      sessions: rows.map((s) => ({ ...s, weekday_name: WEEKDAYS[s.weekday] })),
      skipped_items: skipped,
      note: '节次时间按紫金港常规作息推算；weeks=odd/even 表示单/双周；terms 为课程所跨学期（如“秋冬”）。未指定学年学期时按当前日期推断。',
    };
  }
}

export { WEEKDAYS, ALL };
