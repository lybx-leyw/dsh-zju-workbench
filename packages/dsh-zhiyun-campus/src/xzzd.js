/**
 * 学在浙大待办：先读取学期与课程，再逐课读取五类接口。
 *
 * 接口名称与字段由平台契约决定，不按词义猜复数、字段或请求格式：
 * - 课程使用 GET 与数组 conditions；提交状态是 homework_activities / exam_ids。
 * - 仅作业提交状态的 404 表示该课无作业；其他未知错误和字段漂移明确失败。
 * - 默认所有子请求串行；429 立即停止，不把限流放大为自动重试。
 * - 只读请求的会话失效由宿主认证一次，只重试该请求，第二次失败直接报告。
 * - 时间固定按平台的上海时区解释；数字标志与无截止时间的互动有单独规则。
 *
 * 离线全链路验收见 tests/campus-planning-contract.test.mjs，使用虚构夹具。
 */

import { ClassroomError } from './cas/errors.js';
import { XZZD_BASE, XZZD_HOST } from './hosts.js';

/* ────────────────────────────────── 端点（集中在此，避免魔数散落） */

/** 我参与的学期（含 `is_active`）。 */
export const API_MY_SEMESTERS = `${XZZD_BASE}/api/my-semesters?fields=id,name,sort,is_active,code`;

/** 我的课程（参数见 `myCoursesBody`）。 */
export const API_MY_COURSES = `${XZZD_BASE}/api/my-courses`;

/** 逐门课的子端点。 */
export const courseApis = (courseId) => ({
  activities: `${XZZD_BASE}/api/courses/${courseId}/activities`,
  exams: `${XZZD_BASE}/api/courses/${courseId}/exams`,
  // ⚠️ 这里是 `/api/course/`（**单数**），不是 `/api/courses/`。
  //    上游就是这么写的，别"改整齐"—— 改成复数会 404。
  homeworkSubmissionStatus: `${XZZD_BASE}/api/course/${courseId}/homework/submission-status?no-intercept=true`,
  submittedExams: `${XZZD_BASE}/api/courses/${courseId}/submitted-exams?no-intercept=true`,
  classroomList: `${XZZD_BASE}/api/courses/${courseId}/classroom-list`,
});

/** 只要"进行中 / 未开始"的课：已结束的课不可能有待办，排除掉能省大量逐课请求。 */
export const ONGOING_STATUS = Object.freeze(['ongoing', 'notStarted']);

/** 单次 `my-courses` 返回上限。 */
export const COURSE_PAGE_SIZE = 1000;

/** 并发拉课程的条数（全并发容易触发风控）。 */
export const COURSE_CONCURRENCY = 1;
const flag = value => value === true || value === 1 || value === "1";

/* ────────────────────────────────── 时间 */

/** Platform datetimes without an offset are Asia/Shanghai; invalid values stay null. */
export function normalizeDeadline(value) {
  if (value == null || value === '') return { iso: null, text: null };
  const raw = String(value).trim();
  if (!raw) return { iso: null, text: null };
  // The platform's unzoned datetime fields are in Asia/Shanghai. Never use
  // the machine's local timezone, which may differ from the student's campus.
  const valueWithZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw
    : /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(raw) ? raw.replace(' ', 'T') + '+08:00' : null;
  const at = valueWithZone === null ? NaN : Date.parse(valueWithZone);
  if (Number.isNaN(at)) return { iso: null, text: raw };
  return { iso: new Date(at).toISOString(), text: raw };
}

/* ────────────────────────────────── 过滤口径 */

/**
 * 判一条活动/考试**是不是还要做的**。
 *
 * 照抄 Flutter 版的 `isPendingTodo` —— 六个条件缺一不可：
 * 已发布、有截止时间、还没截止、已开始（或没写开始）、没提交、没拿满分。
 *
 * @param options - 见下。
 * @returns 要不要留。
 */
export function isPendingTodo({ published, startTime, endTime, submitted, fullyScored, now = new Date() }) {
  if (published !== true) return false;
  const end = normalizeDeadline(endTime);
  if (end.iso == null) return false;
  if (!(Date.parse(end.iso) > now.getTime())) return false;

  const start = normalizeDeadline(startTime);
  // 有开始时间且还没到 → 不算待办（还没开放）
  if (start.iso != null && Date.parse(start.iso) > now.getTime()) return false;

  if (submitted) return false;
  if (fullyScored) return false;
  return true;
}

/* ────────────────────────────────── 客户端 */

/**
 * 学在浙大客户端。
 *
 * 只负责"带会话发 JSON 请求"与"把各端点拼成待办"。**不做**自动重登 ——
 * 重登要账号密码，不该在读一次待办时偷偷发生。
 */
export class XzzdApi {
  /**
   * @param transport - 带会话的 Transport。
   */
  constructor(transport, { refreshSession = null } = {}) {
    if (typeof transport?.request !== 'function') {
      throw new ClassroomError('CONFIG', '学在浙大客户端需要一个 Transport');
    }
    this.transport = transport;
    this.refreshSession = refreshSession;
  }

  /**
   * 读一个 JSON 接口。
   *
   * @param url - 完整 URL（本站或已带 query）。
   * @param options - `{ method, body, signal }`。
   * @returns 解析后的 JSON。
   */
  async json(url, options = {}) {
    const epoch = this.transport.session?.epoch;
    try { return await this.requestJson(url, options); }
    catch (error) {
      if (error.code !== 'SESSION_EXPIRED' || !this.refreshSession
          || !['GET','HEAD'].includes(String(options.method ?? 'GET').toUpperCase())) throw error;
      options.signal?.throwIfAborted();
      await this.refreshSession(epoch);
      // Retry only this expired read once, never an entire completed crawl.
      return this.requestJson(url, options);
    }
  }

  async requestJson(url, { method = 'GET', body, signal } = {}) {
    const target = new URL(url);
    if (target.hostname !== XZZD_HOST) {
      throw new ClassroomError('INVALID_PATH', '只允许学在浙大的接口');
    }
    const result = await this.transport.request(url, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: {
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: XZZD_BASE,
        Referer: `${XZZD_BASE}/user/index`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      signal,
    });

    // 会话失效：302 或 401
    if (result.status === 401 || (result.status >= 300 && result.status < 400)) {
      throw new ClassroomError('SESSION_EXPIRED', '学在浙大登录态已过期', { status: result.status });
    }
    if (result.status === 403) {
      // 单个端点没权限 ≠ 会话失效。抛出来让调用方按"这一类条目丢掉"处理。
      throw new ClassroomError('FORBIDDEN', '学在浙大拒绝访问该接口', { status: 403 });
    }
    if (result.status === 429) throw new ClassroomError('RATE_LIMITED', '学在浙大请求受限，请稍后再试');
    if (result.status >= 400) {
      throw new ClassroomError('HTTP', `学在浙大返回 HTTP ${result.status}`, { status: result.status });
    }
    // 登录页 HTML 必须判成"会话失效"，不是"结构异常"
    if (/^\s*</.test(result.text)) {
      if (/name=["']execution["']|cas\/login|统一身份认证/i.test(result.text)) {
        throw new ClassroomError('SESSION_EXPIRED', '学在浙大返回了登录页，会话已失效');
      }
      throw new ClassroomError('API_SHAPE', '学在浙大返回的不是 JSON');
    }
    let data;
    try {
      data = JSON.parse(result.text);
    } catch {
      throw new ClassroomError('API_SHAPE', '学在浙大返回的 JSON 无法解析');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new ClassroomError('API_SHAPE', '学在浙大返回的不是对象');
    }
    return data;
  }

  /**
   * 取活跃学期 id（含相邻的 id+1 / id+2）。
   *
   * 为什么把相邻 id 也算进去：浙大有短学期，`my-semesters` 的 `is_active`
   * 未必覆盖正在用的那一个。照抄 Flutter 版的做法。
   *
   * @returns 学期 id 列表。
   */
  async activeSemesterIds({ signal } = {}) {
    const data = await this.json(API_MY_SEMESTERS, { signal });
    if (!Array.isArray(data.semesters)) throw new ClassroomError('API_SHAPE', '学在浙大学期列表缺少 semesters');
    const rows = data.semesters;
    const ids = new Set();
    for (const row of rows) {
      if (!flag(row?.is_active)) continue;
      const id = Number(row.id);
      if (!Number.isFinite(id)) continue;
      ids.add(id);
      ids.add(id + 1);
      ids.add(id + 2);
    }
    return [...ids].sort((a, b) => a - b);
  }

  /**
   * 拉课程。
   *
   * @param semesterIds - 学期 id。
   * @returns 课程列表（`id` / `name`）。
   */
  async courses(semesterIds, { signal } = {}) {
    if (semesterIds.length === 0) return [];
    const conditions = {
      role: [], semester_id: semesterIds, academic_year_id: [],
      status: [...ONGOING_STATUS], course_type: [], effectiveness: [],
      published: [], display_studio_list: false,
    };
    const params = new URLSearchParams({
      page: '1', page_size: String(COURSE_PAGE_SIZE), sort: 'all',
      normal: JSON.stringify({ version: 7, apiVersion: '1.1.0' }),
      conditions: JSON.stringify(conditions), fields: 'id,name,course_code',
    });
    const data = await this.json(API_MY_COURSES + '?' + params, { signal });
    if (!Array.isArray(data.courses)) throw new ClassroomError('API_SHAPE', '学在浙大课程列表缺少 courses');
    const rows = data.courses;
    return rows
      .map((row) => ({ id: row?.id == null ? '' : String(row.id), name: String(row?.name ?? '').trim() }))
      .filter((row) => row.id);
  }

  /**
   * 拉一门课的原始数据（5 个端点）。
   *
   * **单个端点坏掉不拖垮整课**：403 之类只丢那一类，返回空数组。
   * 但**会话失效**必须抛出去 —— 那是整体失败。
   *
   * @param courseId - 课程 id。
   * @returns `{ activities, exams, homeworkActivities, submittedExamIds, classrooms }`。
   */
  async courseBundle(courseId, { signal } = {}) {
    const urls = courseApis(courseId);

    // Read the five endpoints serially. Course fan-out must not multiply a
    // nominal course concurrency into dozens of simultaneous requests.
    const labels = { activities: '活动列表', exams: '测验列表', homeworkSubmissionStatus: '作业提交状态', submittedExams: '已交测验', classroomList: '课堂互动' };
    const read = async (stage, fields, { empty404 = false } = {}) => {
      try {
        const data = await this.json(urls[stage], { signal });
        for (const field of fields) if (Array.isArray(data[field])) return data[field];
        throw new ClassroomError('API_SHAPE', '学在浙大' + labels[stage] + '响应缺少 ' + fields.join('/'));
      } catch (error) {
        if (empty404 && error.code === 'HTTP' && error.details?.status === 404) return [];
        // An inaccessible activity list contributes no activities. A missing
        // submission status is different: do not invent unsubmitted work.
        if (error.code === 'FORBIDDEN' && ['activities', 'exams', 'classroomList'].includes(stage)) return [];
        if (error.code === 'SESSION_EXPIRED' || error.code === 'RATE_LIMITED') throw error;
        throw new ClassroomError(error.code ?? 'CAMPUS_FAILED', '学在浙大' + labels[stage] + '读取失败：' + error.message, { stage });
      }
    };
    const activities = await read('activities', ['activities']);
    const exams = await read('exams', ['exams']);
    const homeworkActivities = await read('homeworkSubmissionStatus', ['homework_activities', 'activities'], { empty404: true });
    const submittedExamIds = await read('submittedExams', ['exam_ids', 'submitted_exams', 'submittedExams']);
    const classrooms = await read('classroomList', ['classrooms']);
    return { activities, exams, homeworkActivities, submittedExamIds, classrooms };
  }

  /**
   * 拉全部待办。
   *
   * @param options.now - 注入当前时间（测试用）。
   * @returns `{ todos, courses, note }`。
   */
  async todos({ now = () => new Date(), signal, concurrency = COURSE_CONCURRENCY } = {}) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 2) throw new ClassroomError('CONFIG', '课程并发只能为 1 或 2');
    const semesterIds = await this.activeSemesterIds({ signal });
    const courses = await this.courses(semesterIds, { signal });
    if (courses.length === 0) {
      return { todos: [], courses: [], note: '活跃学期里没有进行中的课程。' };
    }

    const at = now();
    const todos = [];

    // 分批并发：全并发容易触发风控
    for (let start = 0; start < courses.length; start += concurrency) {
      const batch = courses.slice(start, start + concurrency);
      const bundles = await Promise.all(
        batch.map(async (course) => ({ course, bundle: await this.courseBundle(course.id, { signal }) })),
      );
      for (const { course, bundle } of bundles) {
        todos.push(...buildCourseTodos(course, bundle, at));
      }
    }

    todos.sort((a, b) => {
      const av = a.due ? Date.parse(a.due) : Infinity;
      const bv = b.due ? Date.parse(b.due) : Infinity;
      return av - bv;
    });

    return { todos, courses, note: '按「已发布 + 未截止 + 未提交」过滤。' };
  }
}

/* ────────────────────────────────── 拼装 */

/** 取数字字段，非法给 0。 */
const int = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** 取字符串字段，缺失给空串。 */
const str = (value) => (value == null ? '' : String(value));

/**
 * 把一门课的原始数据折成待办。
 *
 * 照抄 Flutter 版的 `buildCourseTodos`：activities + exams + classrooms 三类，
 * 用 `homework/submission-status` 与 `submitted-exams` 排掉已交的。
 *
 * @param course - `{ id, name }`。
 * @param bundle - `courseBundle()` 的结果。
 * @param now - 当前时间。
 * @returns 待办数组。
 */
export function buildCourseTodos(course, bundle, now = new Date()) {
  // 已提交作业：认 `status_code === 'submitted'` **或** `status === 'finished'`。
  // 上游两个版本口径不一致，这里两个都认 —— 漏判会让已交的作业一直挂在待办里。
  const submittedHomework = new Set();
  for (const row of bundle.homeworkActivities ?? []) {
    const code = str(row?.status_code).toLowerCase();
    const status = str(row?.status).toLowerCase();
    if (code === 'submitted' || status === 'finished') {
      const id = int(row?.id);
      if (id > 0) submittedHomework.add(String(id));
    }
  }
  const submittedExams = new Set(
    (bundle.submittedExamIds ?? []).map((id) => String(int(id))).filter((id) => id !== '0'),
  );

  const out = [];

  // ── activities（作业、课堂互动…）
  for (const row of bundle.activities ?? []) {
    const id = int(row?.id);
    if (id <= 0) continue;
    const submitted = submittedHomework.has(String(id));
    // `completion_criterion_key === 'score'` 的活动：拿满才算完成
    const fullyScored = str(row?.completion_criterion_key) === 'score'
      && Number(row?.score_percentage) >= 1;
    if (!isPendingTodo({
      published: flag(row?.published),
      startTime: str(row?.start_time) || null,
      endTime: str(row?.end_time) || null,
      submitted,
      fullyScored,
      now,
    })) continue;

    const title = str(row?.title).trim();
    out.push({
      id: String(id),
      title: title || '（无标题活动）',
      courseId: course.id,
      courseName: course.name,
      type: str(row?.type) || 'activity',
      due: normalizeDeadline(row?.end_time).iso,
      dueText: normalizeDeadline(row?.end_time).text,
      url: `${XZZD_BASE}/course/${course.id}/learning-activity#/${id}`,
      source: 'xzzd',
    });
  }

  // ── exams（测验）
  for (const row of bundle.exams ?? []) {
    const id = int(row?.id);
    if (id <= 0) continue;
    if (submittedExams.has(String(id))) continue;
    if (!isPendingTodo({
      published: flag(row?.published),
      startTime: str(row?.start_time) || null,
      endTime: str(row?.end_time) || null,
      submitted: false,
      fullyScored: false,
      now,
    })) continue;

    const title = str(row?.title).trim();
    out.push({
      id: String(id),
      title: title || '（无标题测验）',
      courseId: course.id,
      courseName: course.name,
      type: 'quiz',
      due: normalizeDeadline(row?.end_time).iso,
      dueText: normalizeDeadline(row?.end_time).text,
      url: `${XZZD_BASE}/course/${course.id}/learning-activity#/${id}`,
      source: 'xzzd',
    });
  }

  // ── classrooms（进行中的课堂互动）
  for (const row of bundle.classrooms ?? []) {
    if (str(row?.status) !== 'start') continue;
    const id = int(row?.id);
    if (id <= 0) continue;
    // classroom-list 没有 published 字段：status === 'start' 即已开始
    const start = normalizeDeadline(row?.start_at).iso;
    const end = normalizeDeadline(row?.end_at).iso;
    if (start && Date.parse(start) > now.getTime()) continue;
    if (end && Date.parse(end) <= now.getTime()) continue;

    const title = str(row?.title).trim();
    out.push({
      id: String(id),
      title: title || '（无标题课堂互动）',
      courseId: course.id,
      courseName: course.name,
      type: 'classroom',
      due: normalizeDeadline(row?.end_at).iso,
      dueText: normalizeDeadline(row?.end_at).text,
      url: `${XZZD_BASE}/course/${course.id}/classroom-list`,
      source: 'xzzd',
    });
  }

  return out;
}

/**
 * 这份会话是否覆盖学在浙大。
 *
 * @param transport - 带会话的 Transport。
 * @returns 有没有 `session` cookie。
 */
export async function hasXzzdSession(transport) {
  try {
    const cookies = await transport.session.jar.getCookies(`${XZZD_BASE}/user/index`);
    return cookies.some((cookie) => cookie.key === 'session' && cookie.value);
  } catch {
    return false;
  }
}
