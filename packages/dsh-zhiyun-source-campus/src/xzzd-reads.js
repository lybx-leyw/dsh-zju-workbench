/**
 * 学在浙大的**深入读取**：作业详情、我的提交、课件材料。
 *
 * # 与 `xzzd.js` 的分工
 *
 * `xzzd.js` 负责「这门课有什么待办」—— 五个端点折成待办清单。那是**列表口径**。
 * 本文件负责「点进一门课看细节」：活动列表、作业要求、我交了什么、课件在哪。
 * 两者共用同一个 `XzzdApi`（也就是同一份 Transport 与会话），但读取的端点不同。
 *
 * 拆成独立文件而不是继续堆进 `xzzd.js`，是因为 `xzzd.js` 已经 442 行、
 * 讲的是「待办怎么拼」这一件事；把作业详情塞进去会让那件事被淹没。
 *
 * # 端点单复数（最容易写错的一处）
 *
 * 学在浙大的路径**不统一**，必须逐条照抄：
 *
 * ```text
 * 复数：/api/courses/<id>/activities            活动列表
 *       /api/courses/<id>/homework-activities   作业列表
 *       /api/courses/<id>                       课程详情
 * 单数：/api/course/<id>/coursewares            课件材料
 *       /api/course/<id>/activity-reads-for-user  谁读过（用来反推当前用户 id）
 * ```
 *
 * 写错不会报 404 —— 服务端会把它当成另一个资源，回一个结构不同的 JSON，
 * 然后解析层报「缺少字段」。这条坑在 `tests/campus.test.mjs` 里已钉住一次，
 * 新增端点时必须同样小心。
 */

import { ClassroomError } from './cas/errors.js';
import { normalizeDeadline } from './xzzd.js';

/* ────────────────────────────────────── 小工具 */

/** 取字符串。 */
const str = (value) => (value == null ? '' : String(value));

/**
 * 取正整数 id。
 *
 * ⚠️ **不能用 `Number()` 直接转再截断**：`'7.9'` 会被静默变成 7，
 * 于是任何拿错 id 的调用方都会去读**另一门课**的数据，且不报错。
 * 这里只接受纯数字串（可选前导 `+`），其余一律判非法。
 *
 * @param value - 原始值。
 * @returns 整数；非法时给 0（由调用方判 `<= 0` 抛错）。
 */
const int = (value) => {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : 0;
  const text = String(value ?? '').trim();
  if (!/^\d{1,15}$/.test(text)) return 0;
  const n = Number(text);
  return Number.isSafeInteger(n) ? n : 0;
};

/**
 * 长文本截断 —— 作业说明可能几万字，原样塞进响应会撑爆调用方。
 *
 * @param value - 原文。
 * @param limit - 上限。
 * @returns 截断后的文本，超出时带省略标记。
 */
export function boundedText(value, limit = 10000) {
  const text = str(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…（已截断，原文 ${text.length} 字符）`;
}

/**
 * 文件描述。
 *
 * @param file - 原始文件对象。
 * @returns 页面能直接用的形状。
 */
export function publicFile(file) {
  return {
    id: file?.id ?? file?.upload_id ?? null,
    name: str(file?.name ?? file?.file_name),
    size: file?.size ?? null,
    mimeType: file?.mime_type ?? file?.content_type ?? null,
    allowDownload: file?.allow_download ?? null,
    updatedAt: file?.updated_at ?? null,
  };
}

/**
 * 收集一条活动上的全部附件。
 *
 * 上游把附件放在**三个不同位置**（`uploads` / `data.uploads` / `data.files`），
 * 而且同一份文件可能重复出现。合并时有两个陷阱：
 *
 * 1. **`allow_download` 有否决权**：任一处说 false，结果就必须是 false ——
 *    否则"禁止下载"会被另一处覆盖成允许。
 * 2. **必须先合并原始字段、最后才转换**：`publicFile()` 会把 `mime_type`
 *    改名成 `mimeType`。若边合并边转换，下一轮 `{...previous, ...file}` 里的
 *    `previous` 已是 camelCase、而 `file` 是 snake_case，`publicFile()` 只认
 *    snake_case → 先出现那份的 `mimeType`/`updatedAt` 会被后出现那份的 null 覆盖。
 *    结果取决于字段出现在哪一处，属隐性不确定性。
 *
 * @param activity - 原始活动。
 * @returns 去重后的文件数组。
 */
export function filesOf(activity) {
  const sources = [activity?.uploads, activity?.data?.uploads, activity?.data?.files]
    .filter((value) => Array.isArray(value));
  /** key → 合并后的**原始**字段（全程 snake_case，不打散）。 */
  const merged = new Map();
  for (const source of sources) {
    for (const file of source) {
      if (!file || (file.id ?? file.upload_id) == null) continue;
      const key = String(file.id ?? file.upload_id);
      const previous = merged.get(key);
      if (!previous) {
        merged.set(key, { ...file });
        continue;
      }
      const next = { ...previous, ...file };
      // 只有「另一处明确说了 false」才否决；其它情况保留已有的非空值
      if (previous.allow_download === false || file.allow_download === false) {
        next.allow_download = false;
      } else if (next.allow_download == null && previous.allow_download != null) {
        next.allow_download = previous.allow_download;
      }
      merged.set(key, next);
    }
  }
  return [...merged.values()].map((file) => publicFile(file));
}

/**
 * 是不是小组作业。
 *
 * @param activity - 原始活动。
 * @returns 是否小组作业。
 */
export function isGroupHomework(activity) {
  return activity?.submit_by_group === true
    || activity?.data?.is_group === true
    || activity?.data?.is_group_submission === true;
}

/**
 * 由提交列表推出「我交没交」。
 *
 * 口径来自上游，但把 `unknown` 与 `unsubmitted` **严格分开**：
 * 列表为空时，只有平台明确说交过（`reported === true`）才算 unknown ——
 * 其余情况是「确实没交」。反过来若把 unknown 当成 unsubmitted，
 * 用户会看到"未提交"而实际上平台已经收了。
 *
 * @param list - 提交记录。
 * @param reported - 活动上的 `submitted` 字段。
 * @returns `'submitted' | 'draft' | 'unsubmitted' | 'unknown'`。
 */
export function submissionState(list, reported = null) {
  const latest = list.find((row) => row?.is_latest_version === true);
  const current = latest ? [latest] : list;
  const hasReal = current.some((row) => row?.is_draft === false
    && row?.is_redo !== true
    && (row?.submit_by_instructor !== true || row?.marked_submitted === true));
  if (hasReal) return 'submitted';
  if (list.some((row) => row?.is_draft === true || row?.is_redo === true)) return 'draft';
  if (list.length === 0) return reported === true ? 'unknown' : 'unsubmitted';
  return 'unknown';
}

/**
 * 活动摘要 —— 列表里的一行。
 *
 * @param activity - 原始活动。
 * @param courseId - 课程 id（活动里可能没带）。
 * @param baseUrl - 站点根地址。
 * @returns 摘要。
 */
export function activitySummary(activity, courseId, baseUrl) {
  const id = activity?.id == null ? '' : String(activity.id);
  const owner = activity?.course_id ?? courseId;
  return {
    id,
    courseId: owner == null ? null : String(owner),
    title: str(activity?.title).trim(),
    type: activity?.type ?? null,
    deadline: normalizeDeadline(activity?.end_time),
    startTime: normalizeDeadline(activity?.start_time),
    submitted: typeof activity?.submitted === 'boolean' ? activity.submitted : null,
    isClosed: typeof activity?.is_closed === 'boolean' ? activity.is_closed : null,
    isStarted: activity?.is_started ?? null,
    isGroup: isGroupHomework(activity),
    groupSetId: activity?.group_set_id == null ? null : String(activity.group_set_id),
    weightPercent: activity?.score_percentage ?? activity?.data?.score_percentage ?? null,
    files: filesOf(activity),
    url: owner == null ? null : `${baseUrl}/course/${owner}/learning-activity/full-screen#/${id}`,
  };
}

/**
 * 分页信息。
 *
 * 上游有时给 `pages`/`page`，有时只给 `total`，有时什么都不给。
 * 三种都要能算出一个对调用方有用的 `nextPage`。
 *
 * @param data - 原始响应。
 * @param page - 当前页。
 * @param pageSize - 单页条数。
 * @param received - 本次收到的条数。
 * @returns `{ page, pageSize, total, nextPage }`。
 */
export function pageInfo(data, page, pageSize, received) {
  const total = int(data?.total ?? data?.total_count) || null;
  let nextPage = null;
  if (total != null) nextPage = page * pageSize < total ? page + 1 : null;
  else nextPage = received >= pageSize ? page + 1 : null;
  return { page, pageSize, total, nextPage };
}

/* ────────────────────────────────────── 读取器 */

/**
 * 学在浙大的深入读取器。
 *
 * 只读：不提交作业、不改任何平台数据。
 */
export class XzzdReader {
  /**
   * @param api - 已登录的 `XzzdApi`。
   * @param baseUrl - 站点根地址（拼详情链接用）。
   */
  constructor(api, baseUrl) {
    this.api = api;
    this.baseUrl = baseUrl;
  }

  /**
   * 发一次列表请求，**按 `courseBundle()` 的既有口径降级**。
   *
   * 为什么需要这层：一门课的某个栏目没权限（403）或该课程没有这类内容（404）
   * 是很常见的事，而它不是"整门课挂了"。`xzzd.js` 的 `courseBundle()` 早就
   * 这么处理了（403 只丢那一类）；新加的列表方法若直接抛，同一门课在
   * "待办页"能看、"作业页"报错 —— 口径不一致比缺功能更让人困惑。
   *
   * 以下三类**必须抛**，不能降级：
   *   - `SESSION_EXPIRED`：那是整体失败，降级成空会让人以为"没有作业"；
   *   - `RATE_LIMITED`：等一下还能成功，静默成空会掩盖限流；
   *   - `API_SHAPE`：契约变了要如实说，否则会当成"没有数据"。
   *
   * @param url - 完整地址。
   * @param label - 出错时告诉用户是哪一类。
   * @param options.signal - 中止信号。
   * @returns 响应体；降级时返回 `null`。
   */
  async listRead(url, label, { signal } = {}) {
    try {
      return await this.api.json(url, { signal });
    } catch (error) {
      const code = error?.code;
      if (code === 'SESSION_EXPIRED' || code === 'RATE_LIMITED' || code === 'API_SHAPE') throw error;
      // 403 / 404 / HTTP 一律降级成"这类没有"
      if (code === 'FORBIDDEN' || code === 'HTTP') return null;
      throw error;
    }
  }

  /**
   * 活动列表（作业、材料、视频……，可按类型过滤）。
   *
   * @param courseId - 课程 id。
   * @param options.page - 页码（从 1 开始）。
   * @param options.pageSize - 单页条数。
   * @param options.type - 只看某个类型。
   * @param options.signal - 中止信号。
   * @returns `{ activities, ...分页 }`。
   */
  async activities(courseId, { page = 1, pageSize = 30, type = null, signal } = {}) {
    const id = int(courseId);
    if (id <= 0) throw new ClassroomError('INVALID_INPUT', '课程 id 不合法');
    const params = new URLSearchParams({ sub_course_id: '0', page: String(page), page_size: String(pageSize) });
    const data = await this.listRead(
      `https://courses.zju.edu.cn/api/courses/${id}/activities?${params}`,
      '学在浙大活动列表',
      { signal },
    );
    // 该课程没有这类内容（或没权限）→ 空列表，不是失败
    if (data == null) return { activities: [], page, pageSize, total: null, nextPage: null };
    if (!Array.isArray(data.activities)) {
      throw new ClassroomError('API_SHAPE', '学在浙大活动列表缺少 activities');
    }
    const rows = data.activities.filter((row) => !type || row?.type === type);
    return {
      activities: rows.map((row) => activitySummary(row, courseId, this.baseUrl)).filter((row) => row.id),
      ...pageInfo(data, page, pageSize, rows.length),
    };
  }

  /**
   * 作业列表（比 `activities` 更专一，只含 homework 类）。
   *
   * @param courseId - 课程 id。
   * @param options.page - 页码。
   * @param options.pageSize - 单页条数。
   * @param options.withSubmissions - 是否逐条补「我的提交」（默认否：那是 N+1）。
   * @param options.signal - 中止信号。
   * @returns `{ assignments, ...分页 }`。
   */
  async assignments(courseId, { page = 1, pageSize = 30, withSubmissions = false, signal } = {}) {
    const id = int(courseId);
    if (id <= 0) throw new ClassroomError('INVALID_INPUT', '课程 id 不合法');
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    const data = await this.listRead(
      `https://courses.zju.edu.cn/api/courses/${id}/homework-activities?${params}`,
      '学在浙大作业列表',
      { signal },
    );
    // 没有作业的课 / 没权限：空列表 + 如实说明，不是失败
    if (data == null) return { assignments: [], page, pageSize, total: null, nextPage: null };
    if (!Array.isArray(data.homework_activities)) {
      throw new ClassroomError('API_SHAPE', '学在浙大作业列表缺少 homework_activities');
    }
    const rows = data.homework_activities;

    let userId;
    let identityError = null;
    if (withSubmissions && rows.length) {
      try {
        userId = await this.currentUserId(id, { signal });
      } catch (error) {
        // 会话失效是整体失败 —— 不能让"请重新登录"降级成"提交状态未知"，
        // 否则页面会显示「未知」而用户以为作业还没交。
        if (error?.code === 'SESSION_EXPIRED') throw error;
        identityError = { code: error?.code ?? 'UNKNOWN', message: String(error?.message ?? error) };
      }
    }

    const assignments = [];
    for (const row of rows) {
      const summary = activitySummary(row, courseId, this.baseUrl);
      if (!summary.id) continue;
      if (withSubmissions) {
        if (identityError) Object.assign(summary, { submissionStatus: 'unknown', submissionError: identityError });
        else Object.assign(summary, await this.activitySubmission({ ...row, course_id: row?.course_id ?? courseId }, { userId, signal }));
      }
      assignments.push(summary);
    }
    return { assignments, ...pageInfo(data, page, pageSize, assignments.length) };
  }

  /**
   * 单条活动的详情（含附件与作业说明）。
   *
   * @param activityId - 活动 id。
   * @param options.signal - 中止信号。
   * @returns 活动详情。
   */
  async activity(activityId, { signal } = {}) {
    const id = int(activityId);
    if (id <= 0) throw new ClassroomError('INVALID_INPUT', '活动 id 不合法');
    const data = await this.api.json(
      `https://courses.zju.edu.cn/api/activities/${id}?sub_course_id=0`,
      { signal },
    );
    const row = data?.activity ?? data;
    if (!row || typeof row !== 'object' || row.id == null) {
      throw new ClassroomError('API_SHAPE', '学在浙大活动详情缺少 activity');
    }
    return {
      ...activitySummary(row, row.course_id ?? null, this.baseUrl),
      description: boundedText(row.description ?? row.data?.description ?? row.content),
    };
  }

  /**
   * 课件材料列表。
   *
   * ⚠️ 路径里的 `course` 是**单数**，与 `activities` 的 `courses` 相反。
   *
   * @param courseId - 课程 id。
   * @param options.page - 页码。
   * @param options.pageSize - 单页条数。
   * @param options.signal - 中止信号。
   * @returns `{ materials, activities, ...分页 }` —— `materials` 是正式键，
   *   `activities` 是平台原始字段名（保留是为了不打断既有消费方）。
   */
  async materials(courseId, { page = 1, pageSize = 30, signal } = {}) {
    const id = int(courseId);
    if (id <= 0) throw new ClassroomError('INVALID_INPUT', '课程 id 不合法');
    // conditions 决定「按章节排序、排除 lesson 类型」—— 不传会混进课堂互动，
    // 而那不是"材料"。这条口径照抄上游。
    const conditions = JSON.stringify({
      category: null,
      itemsSortBy: { predicate: 'chapter', reverse: false },
      ignore_activity_types: ['lesson'],
    });
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize), conditions });
    const data = await this.listRead(
      `https://courses.zju.edu.cn/api/course/${id}/coursewares?${params}`,
      '学在浙大课件列表',
      { signal },
    );
    if (data == null) {
      return { materials: [], activities: [], page, pageSize, total: null, nextPage: null };
    }
    if (!Array.isArray(data.activities)) {
      throw new ClassroomError('API_SHAPE', '学在浙大课件列表缺少 activities');
    }
    const materials = data.activities.map((row) => activitySummary(row, courseId, this.baseUrl)).filter((row) => row.id);
    return {
      materials,
      // 平台原始字段名，保留给按旧键名读的调用方
      activities: materials,
      ...pageInfo(data, page, pageSize, materials.length),
    };
  }

  /**
   * 当前学生 id —— 平台没直接给，要从「谁读过」的记录里反推。
   *
   * 为什么必须反推：查询本人的提交记录要 `students/<userId>/submission_list`，
   * 而账号接口只给学号不给内部 id。`activity-reads-for-user` 返回的每条记录
   * 都带 `created_for_id`，**恰好是本人**。
   *
   * 拿到多个不同 id 时**必须报错**：那说明平台行为变了，
   * 猜一个会去查别人的提交（既是错的，也是越权的）。
   *
   * @param courseId - 课程 id。
   * @param options.signal - 中止信号。
   * @returns 学生 id。
   */
  async currentUserId(courseId, { signal } = {}) {
    const id = int(courseId);
    if (id <= 0) throw new ClassroomError('INVALID_INPUT', '课程 id 不合法');
    const data = await this.api.json(`https://courses.zju.edu.cn/api/course/${id}/activity-reads-for-user`, { signal });
    const records = Array.isArray(data.activity_reads) ? data.activity_reads : [];
    // 空串也要滤掉：`created_for_id: ''` 会让 URL 拼成 `students//submission_list`，
    // 打出去是一条畸形路径而不是"没有 id"。
    const ids = [...new Set(
      records
        .map((row) => row?.created_for_id)
        .filter((value) => value != null && String(value).trim() !== '')
        .map((value) => String(value).trim()),
    )];
    if (ids.length !== 1) {
      throw new ClassroomError('IDENTITY_UNAVAILABLE', '平台未返回唯一的当前学生 ID，无法可靠查询本人的提交记录', { count: ids.length });
    }
    return ids[0];
  }

  /**
   * 我在某条作业上的提交。
   *
   * 小组作业走 `groups/<组id>/`，个人作业走 `students/<学号>/`。
   *
   * 失败**不抛**（除会话失效）：返回 `{ submissionStatus: 'unknown', submissionError }`。
   * 理由是「交没交」只是作业详情的一个字段，取不到不该让整条作业消失。
   *
   * @param activity - 活动（需含 `id`，小组作业还需 `group_set_id`）。
   * @param options.userId - 已解析的学生 id（省一次请求）。
   * @param options.signal - 中止信号。
   * @returns `{ submissionStatus, group, latestSubmission, submissionCount, draftIds }`。
   */
  async activitySubmission(activity, { userId, signal } = {}) {
    const activityId = int(activity?.id);
    if (activityId <= 0) throw new ClassroomError('INVALID_INPUT', '活动 id 不合法');
    try {
      const resolvedUser = userId ?? await this.currentUserId(activity?.course_id, { signal });
      let group = null;
      if (isGroupHomework(activity)) {
        const groupSetId = int(activity?.group_set_id);
        if (groupSetId <= 0) {
          throw new ClassroomError('GROUP_UNAVAILABLE', '小组作业未返回分组方案，无法确认本人小组');
        }
        const data = await this.api.json(`https://courses.zju.edu.cn/api/group-sets/${groupSetId}/group`, { signal });
        if (data?.group?.id == null) {
          throw new ClassroomError('GROUP_UNAVAILABLE', '当前账号尚未加入这份作业对应的小组');
        }
        group = {
          id: String(data.group.id),
          name: str(data.group.name),
          groupSetId: String(groupSetId),
        };
      }

      const target = group ? `groups/${group.id}` : `students/${resolvedUser}`;
      const data = await this.api.json(
        `https://courses.zju.edu.cn/api/activities/${activityId}/${target}/submission_list`,
        { signal },
      );
      const list = Array.isArray(data.list) ? data.list : [];
      const latest = list.find((row) => row?.is_latest_version === true)
        ?? list.find((row) => row?.is_draft === false && row?.is_redo !== true)
        ?? list[0]
        ?? null;

      return {
        submissionStatus: submissionState(list, activity?.submitted),
        group,
        latestSubmission: latest ? {
          id: latest.id ?? null,
          isDraft: latest.is_draft ?? null,
          isLatestVersion: latest.is_latest_version ?? null,
          canRetract: latest.can_retract ?? null,
          submittedAt: normalizeDeadline(latest.submitted_at),
          uploads: (Array.isArray(latest.uploads) ? latest.uploads : []).map(publicFile),
          comment: boundedText(latest.comment),
          score: latest.final_score ?? latest.score ?? latest.submission_correct?.instructor_score ?? null,
          gradedAt: normalizeDeadline(latest.score_at),
          instructorComment: boundedText(latest.instructor_comment ?? latest.submission_correct?.comment),
        } : null,
        submissionCount: list.length,
        draftIds: list.filter((row) => row?.is_draft === true).map((row) => row.id),
      };
    } catch (error) {
      // 会话失效是整体失败，必须抛
      if (error?.code === 'SESSION_EXPIRED') throw error;
      return {
        submissionStatus: 'unknown',
        submissionError: { code: error?.code ?? 'UNKNOWN', message: String(error?.message ?? error) },
      };
    }
  }
}
