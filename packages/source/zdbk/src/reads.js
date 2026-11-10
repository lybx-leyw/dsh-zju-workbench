/**
 * 教务数据读取器：成绩 / GPA 汇总 / 考试安排 / 课表 / 培养方案 / 选课查询。
 *
 * 这一层只做**编排**：发哪几个请求、怎么筛、怎么排、返回什么形状。
 * 解析与 GPA 在 `parse.js`（个人数据）、`plan.js`（培养方案）、`selection.js`（选课），
 * HTTP 在 `client.js` —— 几层的分界是「换掉任一层，另外几层不用动」。比如测试里可以塞
 * 一个假的 `ZdbkClient.post` 就把整条读取链路跑通，完全不碰网络与登录。
 *
 * # 只读边界（D17）
 *
 * 这里**只有读取**。上游 `xsxk.ts` 里的 `select` / `reorder` / `drop` 三个写方法
 * 按分层规则归 `packages/tool/campus-write`，本包**不实现、不导出**，
 * 连发写请求需要的 `postOnce` 语义（不跟随重定向、失效后不重放）都不在这里出现。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import {
  ZDBK_MODULES, ZDBK_PATHS, ZDBK_PLAN_PATHS, ZDBK_SELECTION_PATHS, planPdfUrl,
} from './hosts.js';
import {
  checkAcademicYear, currentTerm, gpaOf, parseExams, parseGrade, parseSession,
  requiredArray, semesterOfTerm, termCode,
} from './parse.js';
import { PLAN_PAGE_SIZE, parsePlan } from './plan.js';
import {
  assertSelectionTerm, courseView, ownedView, parseCapacity, parseMyPlan, parseSelectionContext,
  parseSelectionRow, sectionView, selectionPageForm, selectionSearchForm,
} from './selection.js';
import { uniqueMatch } from './match.js';

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

  /* ───────────────────────────── 培养方案（zdbk.planList / zdbk.planView） */

  /**
   * 取选课首页的 HTML 并解析成「本人」的年级与专业。
   *
   * # 为什么要借选课首页
   *
   * 培养方案接口需要 `nj`（年级）+ `zydm`（专业代码），而正方**没有**一个
   * 「我是谁、我哪一级、什么专业」的独立接口 —— 这两个值只出现在选课首页的
   * 隐藏 input 里。所以「我的培养方案」这条链必然经过 `/xsxk/` 首页。
   *
   * 代价是它在非选课期也可能不可用，因此 `planList` / `planView` 都允许调用方
   * **显式给 `year`** 从而完全不碰这个页面 —— 只给 `year` 时不会走这里。
   *
   * @returns {Promise<{id: string, year: string, major: string}>} 教学计划号与年级专业。
   * @throws {ClassroomError} `SCHEMA_CHANGED` —— 页面上没有年级/专业。
   */
  async myPlanIdentity() {
    const html = await this.api.html(ZDBK_SELECTION_PATHS.index, {
      query: { gnmkdm: ZDBK_MODULES.selection },
    });
    const mine = parseMyPlan(html);
    if (!mine) {
      throw new ClassroomError(
        'SCHEMA_CHANGED',
        '选课首页上没有年级（nj）或专业代码（zydm），无法确定本人的培养方案。'
        + ' 可以在参数里直接给 year 与 major 绕开这一步。',
      );
    }
    return mine;
  }

  /**
   * 某个年级的培养方案列表。
   *
   * # 默认年级是「本人年级」，而且会走一次选课首页
   *
   * 不给 `year` 时读本人年级（见 `myPlanIdentity`）。给了就**完全不碰**选课首页 ——
   * 这是非选课期唯一能用的形态。
   *
   * # 分页必须拉满
   *
   * 一个年级约 150 个方案，正方默认 `showCount=10`。不显式拉大会**静默截断**：
   * 界面显示「这个学院只有 10 个专业」，没人会想到是分页。所以这里先按
   * `PLAN_PAGE_SIZE` 取一页，再按 `totalPages` 补齐剩下的。
   *
   * # 学院/专业筛选在**本地**做
   *
   * 上游也是本地筛（`findPlans`）。理由是那两个参数在页面下拉框里是**代码**，
   * 而用户手里是「计算机科学与技术」这种名字；服务端只认代码，本地按名字包含
   * 匹配才符合「按学院名筛选」这个说法。代价是必须先把整个年级取回来。
   *
   * @param {{year?: string, college?: string, major?: string}} [options] - 筛选条件。
   * @returns {Promise<object>} `{ year, count, plans, skipped_items, note }`。
   * @throws {ClassroomError} `INVALID_ARGUMENT` —— 年级不是四位数字。
   */
  async planList(options = {}) {
    const mine = options.year ? null : await this.myPlanIdentity();
    const year = String(options.year ?? mine.year);
    if (!/^\d{4}$/.test(year)) {
      throw new ClassroomError('INVALID_ARGUMENT', `入学年份应为四位数字（如 2025），收到「${year}」。`);
    }
    const { plans, skipped } = await this.plansOfYear(year);
    const has = (value, wanted) => !wanted || String(value).includes(String(wanted).trim());
    const selected = plans.filter((p) => has(p.college, options.college) && has(p.major, options.major));
    return {
      year,
      count: selected.length,
      plans: selected,
      skipped_items: skipped,
      note: '只列出该年级的培养方案基本项；完整课程设置（各学期学分要求）在 PDF 里，用 planView 取链接。',
    };
  }

  /**
   * 取一个年级的全部培养方案（自动翻页）。
   *
   * @param {string} year - 四位入学年份。
   * @returns {Promise<{plans: object[], skipped: number}>} 方案与跳过的占位行数。
   * @throws {ClassroomError} `SCHEMA_CHANGED` —— 列表里一条可识别的都没有。
   */
  async plansOfYear(year) {
    const form = { synj: year, xydm: '', gjzydm: '', zydm: '', dlbs: '', jxjhh: '' };
    const sort = 'synj desc, xymc, jxjhh';
    const first = await this.api.grid(ZDBK_PLAN_PATHS.list, form, { page: 1, size: PLAN_PAGE_SIZE, sort });
    const raw = [...first.items];
    // `totalPages` 由 `grid` 按 `totalResult` 算出来；上限 20 页只是防一个
    // 「服务器把 totalResult 回成天文数字」的死循环，正常年级是 1 页。
    for (let page = 2; page <= Math.min(first.totalPages, 20); page++) {
      raw.push(...(await this.api.grid(ZDBK_PLAN_PATHS.list, form, { page, size: PLAN_PAGE_SIZE, sort })).items);
    }
    const { rows, skipped } = this.rows(raw, (item) => {
      const plan = parsePlan(item);
      // 没有教学计划号的行是占位（按设计不显示），用 `[]` 与解析失败区分。
      return plan ? [plan] : [];
    });
    return { plans: rows, skipped };
  }

  /**
   * 本人（或指定专业）的培养方案。
   *
   * # 只给 PDF 链接，**不下载**
   *
   * 上游会把 PDF 存到本地再返回路径。本包不这么做：`Transport` 返回的是**文本**
   * （`response.text()`），PDF 是二进制，为一条链接单独加一条二进制通道
   * 只会让这个只读包多一份「写本地文件」的职责 —— 而归 D17，那属于 tool 一侧。
   * 所以这里给的是可以直接交给浏览器的绝对地址。
   *
   * # 专业名要消歧义
   *
   * 「计算机」能命中好几个专业。这里用 `uniqueMatch` 保留歧义（抛
   * `NEEDS_DISAMBIGUATION` + 候选），而不是取第一个 —— 取第一个的后果是
   * 用户拿到一份**别人的**培养方案，而且两边都不报错。
   *
   * @param {{year?: string, major?: string}} [options] - 年级与专业名。
   * @returns {Promise<object>} 方案 + PDF 链接。
   * @throws {ClassroomError} `NEEDS_DISAMBIGUATION` / `SCHEMA_CHANGED`。
   */
  async planView(options = {}) {
    const mine = options.major && options.year ? null : await this.myPlanIdentity();
    const year = String(options.year ?? mine.year);
    if (!/^\d{4}$/.test(year)) {
      throw new ClassroomError('INVALID_ARGUMENT', `入学年份应为四位数字（如 2025），收到「${year}」。`);
    }
    let plan;
    if (options.major) {
      const { plans } = await this.plansOfYear(year);
      plan = uniqueMatch(plans, options.major, (p) => [p.major], describePlan, '培养方案');
    } else {
      // 没给专业名：用「年级 + 本人专业代码」拼出教学计划号，直接在列表里找同一条。
      const id = `${year}${mine.major}`;
      const { plans } = await this.plansOfYear(year);
      plan = plans.find((p) => p.id === id);
      if (!plan) {
        throw new ClassroomError(
          'NOT_FOUND',
          `没有找到 ${year} 级本专业（${mine.major}）的培养方案。`
          + ' 可以用 major 指定专业名，或先调 planList 看看这个年级有哪些方案。',
          { year, major_code: mine.major, plan_id: id },
        );
      }
    }
    return {
      ...plan,
      pdf_url: planPdfUrl(plan.id),
      note: 'pdf_url 是完整培养方案 PDF（各学期课程与学分要求）的地址，可直接在浏览器打开；本包不下载文件。',
    };
  }

  /* ───────────────────────────── 选课查询（6 条只读） */

  /**
   * 取选课首页并解析成上下文。
   *
   * 每次现取、不缓存：选课期与志愿数会变，缓存一份旧上下文会让后面的查询
   * 带着过期的学期去问。调用方若在一个方法内要连查多次，由该方法自己复用
   * 返回的上下文（`selectionCourses` / `selectionSections` 都是这样做的）。
   *
   * @returns {Promise<object>} 上下文（`academic_year` / `semester` / `categories` …）。
   */
  async selectionContextData() {
    const html = await this.api.html(ZDBK_SELECTION_PATHS.index, {
      query: { gnmkdm: ZDBK_MODULES.selection },
    });
    return parseSelectionContext(html);
  }

  /**
   * 当前选课上下文：学年学期、年级专业、可填志愿数、页签列表。
   *
   * ⚠️ **页面能读不代表现在允许选课**。这条只回答「系统里现在挂的是哪个学期」，
   * 不判断选课窗口是否开放（那个开关在服务端，正方不通过这个页面暴露它）。
   *
   * @returns {Promise<object>} `{ academic_year, semester, term, grade, major_code, plan_id, max_choices, categories, note }`。
   */
  async selectionContext() {
    const context = await this.selectionContextData();
    return {
      academic_year: context.academic_year,
      semester: context.semester,
      term: context.term,
      grade: context.grade,
      major_code: context.major_code,
      plan_id: context.plan_id,
      max_choices: context.max_choices,
      categories: context.categories.map((cat) => ({
        dl: cat.dl,
        lx: cat.lx,
        name: cat.name,
        kind: cat.kind,
      })),
      note: '这是选课系统当前挂着的学期与页签，不代表现在允许选课。categories 里的 dl 是查询其他选课接口时要回传的类别码。',
    };
  }

  /**
   * 某个页签下的课程列表（自动翻页取全）。
   *
   * # 页签必须用 `dl` + `name` 一起定位
   *
   * 同一个 `dl` 可能对应多个同名页签（「全部课程」在页面上显示为 `qbkc`，
   * 且可能有两个）。只按 `dl` 找会命中多个 → 明确报错而不是挑一个。
   *
   * # 三种页签三种走法
   *
   * - `courses`：走这条（`cxZzxkGhbKcList`）；
   * - `search`（`xk_9`）：不走这条，用 `selectionSearch`；
   * - `special`（补考、研究生选课…）：**未接入**，明确报错而不是返回空列表 ——
   *   空列表会被读成「这学期没有这种课」。
   *
   * @param {{category?: string, name?: string}} [options] - 页签的 `dl` 与名称。
   * @returns {Promise<object>} `{ category, count, courses, note }`。
   * @throws {ClassroomError} `INVALID_ARGUMENT` / `UNSUPPORTED`。
   */
  async selectionCourses(options = {}) {
    const context = await this.selectionContextData();
    const dl = String(options.category ?? 'xk_1');
    const matches = context.categories.filter((cat) => cat.dl === dl
      && (!options.name || cat.name === options.name));
    if (matches.length !== 1) {
      throw new ClassroomError(
        'INVALID_ARGUMENT',
        matches.length
          ? `类别码 ${dl} 下有不只一个页签，请再给 name 指定一个。`
          : `没有类别码 ${dl} 的页签。可用的有：`
            + `${context.categories.map((cat) => `${cat.dl}（${cat.name}）`).join('、') || '（空）'}。`,
        { categories: context.categories },
      );
    }
    const category = matches[0];
    if (category.kind === 'search') {
      throw new ClassroomError('UNSUPPORTED', '这个页签是条件搜索，请改用 selectionSearch。');
    }
    if (category.kind === 'special') {
      throw new ClassroomError(
        'UNSUPPORTED',
        `「${category.name}」是补考/特殊选课，走独立流程，本包未接入。`,
        { category: category.dl },
      );
    }
    const form = {
      dl,
      lx: category.lx,
      // 页签名叫 `qbkc` 的那一项在服务端要的是中文名，不能原样回传。
      xkmc: dl === 'Z' ? '竺可桢学院课程' : category.name,
      kcbs: category.kcbs,
      nj: context.grade,
      xn: context.academic_year,
      xq: String(context.semester),
      zydm: context.major_code,
      // `xk_6` 用的是一个虚拟教学计划号（当年 + cx01），那是正方自己的约定。
      jxjhh: dl === 'xk_6' ? `${context.academic_year.slice(0, 4)}cx01` : context.plan_id,
      xnxq: context.xnxq,
    };
    const rows = await this.selectionPages(ZDBK_SELECTION_PATHS.courses, form, 'courses');
    return {
      category: { dl: category.dl, name: category.name },
      count: rows.length,
      courses: rows.map((row) => courseView(row, dl)),
      note: 'courses 里的 pool 是这一条课程的课程号，selectionSections 要用它（不是 code）。',
    };
  }

  /**
   * 条件搜索本学期开设的课程（自动翻页取全）。
   *
   * @param {{keyword?: string, field?: string, conditions?: object[], relation?: 'and'|'or', only_available?: boolean}} [options] - 搜索条件。
   * @returns {Promise<object>} `{ count, courses, search, note }`。
   */
  async selectionSearch(options = {}) {
    const context = await this.selectionContextData();
    const search = {
      keyword: options.keyword,
      field: options.field,
      conditions: options.conditions,
      relation: options.relation,
      onlyAvailable: Boolean(options.only_available ?? options.onlyAvailable),
    };
    const form = selectionSearchForm(context, search);
    const rows = await this.selectionPages(ZDBK_SELECTION_PATHS.search, form, '搜索结果');
    return {
      count: rows.length,
      courses: rows.map((row) => courseView(row, 'xk_9')),
      search: {
        keyword: options.keyword ?? null,
        conditions: options.conditions ?? null,
        relation: search.relation ?? 'and',
        only_available: search.onlyAvailable,
      },
      note: '搜索结果里每一条的 pool 是课程号；展开教学班时要把同一套搜索条件一起传回 selectionSections。',
    };
  }

  /**
   * 一门课的教学班（教师、时间、地点、余量、容量）。
   *
   * # 必须回传 `pool` 与 `category`，不能只给课程代码
   *
   * 教学班接口要的是「这次查询的上下文」：`xkkh`（课程池）标识这一次查询，
   * `dl` 决定服务端按哪个页签的口径展开。只给课程代码的话，服务端不知道
   * 该在哪个池里找，回一份空列表 —— 不报错。
   *
   * # `xk_9`（搜索结果）必须把原搜索条件一起传回
   *
   * 搜索页签的教学班是按**搜索命中的那个池**展开的；不带条件时服务端
   * 找不到池。上游对这一点也是明确报错，不猜。
   *
   * @param {{course?: string, pool?: string, category?: string, search?: object}} [options] - 定位条件。
   * @returns {Promise<object>} `{ count, sections, note }`。
   * @throws {ClassroomError} `INVALID_ARGUMENT` —— 缺参数、课程池不属于本学期、页签不对。
   */
  async selectionSections(options = {}) {
    // ⚠️ **参数先校验，再取上下文**。反过来的话，一个拼错的参数会先发一次
    // 选课首页请求（校外可能还要先走一遍 CAS），然后才报参数错 —— 用户看到的
    // 延迟与「好像很慢」全归因错了，而且测试里「参数校验」这条永远撞在别的错误上。
    const course = String(options.course ?? '').trim();
    const pool = String(options.pool ?? '').trim();
    const dl = String(options.category ?? '').trim();
    if (!course) throw new ClassroomError('INVALID_ARGUMENT', '需要 course（课程代码，来自 selectionCourses 的 code）。');
    if (!pool) throw new ClassroomError('INVALID_ARGUMENT', '需要 pool（课程号，来自 selectionCourses 的 pool；不是课程代码）。');
    if (!dl) throw new ClassroomError('INVALID_ARGUMENT', '需要 category（页签类别码，来自 selectionContext 的 categories）。');
    const context = await this.selectionContextData();
    // 课程池带学年学期，拿上学期的池去查本学期会被服务端静默回空。
    assertSelectionTerm(pool, context, true);
    if (!context.categories.some((cat) => cat.dl === dl && cat.kind !== 'special')) {
      throw new ClassroomError(
        'INVALID_ARGUMENT',
        `页签 ${dl} 不在当前普通选课页签中（可用的有：`
        + `${context.categories.filter((cat) => cat.kind !== 'special').map((cat) => cat.dl).join('、') || '（空）'}）。`,
      );
    }
    if (dl === 'xk_9' && !options.search) {
      throw new ClassroomError(
        'INVALID_ARGUMENT',
        '展开搜索结果的教学班时必须把原搜索条件（search）一起传回，否则服务端找不到课程池。',
      );
    }
    const form = {
      dl,
      xn: context.academic_year,
      xq: String(context.semester),
      kcdm: course,
      xkkh: pool,
      ylxs: context.study_length,
      ...(dl === 'xk_9' ? selectionSearchForm(context, options.search) : {}),
    };
    const raw = await this.api.postArray(ZDBK_SELECTION_PATHS.sections, { form });
    // ⚠️ 教学班响应里**没有** `kcdm`：传 fallback 的课程代码，否则每条都会被判缺字段。
    const sections = raw.map((row) => parseSelectionRow(row, course)).map((row) => ({
      ...row,
      ...parseCapacity(row.rs),
    }));
    return {
      count: sections.length,
      sections: sections.map(sectionView),
      note: 'sections 里每条的 section 是教学班号；remaining/capacity 来自服务端的「余量/容量」字段，为 null 表示这条没给。',
    };
  }

  /**
   * 本人已选上的课与待筛选的志愿。
   *
   * `state` 只有三种：已选上（`sxbj=1`）、待筛选（`sxbj=0`）、未知（其他值）。
   * 「未知」**必须如实给**，猜一个会让用户以为志愿已提交或已录取。
   *
   * 学分汇总是可选的：它挂掉不该把志愿列表一起带走，所以失败时
   * `credits` 为 null、`credits_error` 记原因（与 `gpaSummary` 对专业 GPA 的
   * 处理是同一套取舍）。
   *
   * @param {{with_credits?: boolean}} [options] - 是否附学分汇总（默认 true）。
   * @returns {Promise<object>} `{ count, choices, credits, credits_error, note }`。
   */
  async selectionSelected(options = {}) {
    const context = await this.selectionContextData();
    const raw = await this.api.postArray(ZDBK_SELECTION_PATHS.chosen, {
      form: { xn: context.academic_year, xq: String(context.semester) },
    });
    const choices = raw.map((row) => parseSelectionRow(row)).map(ownedView);
    let credits = null;
    let creditsError = null;
    if (options.with_credits !== false) {
      try {
        credits = await this.selectionCreditsData();
      } catch (error) {
        creditsError = error?.code ?? 'INTERNAL_ERROR';
      }
    }
    return {
      count: choices.length,
      choices,
      credits,
      credits_error: creditsError,
      note: 'state=待筛选 表示志愿已提交、等学校筛选；已选上 表示已选中。order 是组内志愿次序，不是全局序号。',
    };
  }

  /**
   * 学分汇总的原始取数（供 `selectionSelected` 复用，失败时由它兜住）。
   *
   * @returns {Promise<{total: number, regular: number, short: number}>} 三档学分。
   * @throws {ClassroomError} `SCHEMA_CHANGED` —— 响应不完整或数值非法。
   */
  async selectionCreditsData() {
    const data = await this.api.post(ZDBK_SELECTION_PATHS.credits, { form: {} });
    const result = data?.result;
    if (data?.status !== 'success' || !result) {
      throw new ClassroomError('SCHEMA_CHANGED', '选课学分汇总响应不完整（缺少 status=success 或 result）。');
    }
    const fields = { total: 'xf9', regular: 'xf91', short: 'xf92' };
    const out = {};
    for (const [key, field] of Object.entries(fields)) {
      const value = result[field];
      // `Number('') === 0`，所以空串必须单独判 —— 否则「没给」会变成「0 学分」。
      if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
        throw new ClassroomError('SCHEMA_CHANGED', `选课学分汇总的 ${field} 不是有效数字（收到「${String(value)}」）。`);
      }
      out[key] = Number(value);
    }
    return out;
  }

  /**
   * 选课系统汇总的本学期学分（total 总计、regular 长学期、short 短学期）。
   *
   * @returns {Promise<object>} `{ total, regular, short, academic_year, semester, note }`。
   */
  async selectionCredits() {
    const context = await this.selectionContextData();
    const credits = await this.selectionCreditsData();
    return {
      ...credits,
      academic_year: context.academic_year,
      semester: context.semester,
      note: '这是选课系统按本人当前志愿/已选课程汇总的学分，不是已修学分。',
    };
  }

  /**
   * 逐页取全一个选课列表（翻页靠 `kspage`/`jspage` 行号区间）。
   *
   * # 为什么要查重
   *
   * 正方的分页在数据变动时会**回退**：第 3 页返回的可能是第 2 页的内容。
   * 不查重就会把同一门课列两次（用户看到重复课程），或者更糟 ——
   * 因为页数固定，有的课永远取不到。所以这里按 `xkkh + kcdm` 建 seen 集合，
   * 命中重复就直接报错（上游同一口径）：**宁可说"结果不完整"，也不给半份数据**。
   *
   * @param {string} path - 接口路径。
   * @param {Record<string, string>} form - 基础表单。
   * @param {string} label - 报错时的名字。
   * @returns {Promise<Record<string, unknown>[]>} 全部记录。
   */
  async selectionPages(path, form, label) {
    const size = 50;
    const rows = [];
    const seen = new Set();
    for (let page = 1; page <= 100; page++) {
      const raw = await this.api.postArray(path, { form: { ...form, ...selectionPageForm(page, size) } });
      for (const item of raw) {
        const parsed = parseSelectionRow(item);
        const key = `${parsed.xkkh}:${parsed.kcdm}`;
        if (seen.has(key)) {
          throw new ClassroomError(
            'PAGINATION_UNSTABLE',
            `${label}分页出现重复条目，无法确认结果完整。稍后重试；若持续如此，可能是教务系统正在改选课数据。`,
            { page, duplicated: key },
          );
        }
        seen.add(key);
        rows.push(parsed);
      }
      // 没取满一页就是最后一页：正方的行号区间不会"试探性"多给。
      if (raw.length < size) return rows;
    }
    throw new ClassroomError('PAGINATION_UNSTABLE', `${label}超过 100 页仍未取完，已停止。`);
  }
}

/**
 * 培养方案的候选展示（`NEEDS_DISAMBIGUATION` 的 details 用）。
 *
 * @param {object} plan - 方案。
 * @returns {object} 缩略。
 */
function describePlan(plan) {
  return { major: plan.major, college: plan.college, year: plan.year, category: plan.category, id: plan.id };
}

export { WEEKDAYS, ALL, describePlan };
