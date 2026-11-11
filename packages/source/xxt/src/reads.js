/**
 * 学习通的 9 个**只读**读取方法。
 *
 * # 与上游（ZJU-Omni · xxt/reads.ts）的关系
 *
 * 方法与返回结构**逐字段保持一致** —— 页面和脚本已经按那个形状写好了，
 * "顺手改好看一点"等于让调用方全部改动。差别只在下面这几处，都是本仓必须改的：
 *
 * | 上游 | 这里 | 为什么 |
 * | --- | --- | --- |
 * | `ToolError` + `safeError` | 共享层 `ClassroomError` + `describeError` | 全仓一套错误形状；`details` 只放安全元数据 |
 * | 抛错文案里的 `setup_command` | `descriptor.setup` 中性文案 | 见 `client.js` 的 `XXT_SETUP` |
 * | `this.api.get(url, query)` | `XxtClient.get(url, query, { signal })` | 支持取消；页面切走时不该还占着连接 |
 *
 * # 只读边界
 *
 * 这 9 个方法全部只发 GET/POST **查询**，没有一处提交、删除或修改。学习通里
 * 「交作业」「开始考试」这类动作**没有**对应方法 —— 那是用户自己的决定，
 * 不该由一个数据包替他做。
 *
 * # 唯一的写操作是导入 Cookie
 *
 * 它写在 `Client.importCookie()` 里，不在这里：本文件的方法只读数据。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import { XXT_ENDPOINTS } from './hosts.js';

/** 一节的卡片数上限。上游用 12 —— 正常一章不会有那么多张卡，超出就是异常页。 */
const MAX_CARDS = 12;

/** 超星课程服务（nanas 状态接口在这里）。 */
const MOOC1 = 'https://mooc1.chaoxing.com';

/** 视频扩展名。kindOf 用它们把附件分成视频/音频/文档。 */
const VIDEO_EXT = new Set(['mp4', 'flv', 'm3u8', 'avi', 'mov', 'wmv', 'mkv']);

/**
 * 按扩展名判附件类型。
 *
 * @param {string} name - 文件名。
 * @returns {'video'|'audio'|'document'}
 */
function kindOf(name) {
  const extension = String(name ?? '').split('.').pop()?.toLowerCase() ?? '';
  return VIDEO_EXT.has(extension) ? 'video' : 'document';
}
import {
  hiddenValue,
  isPending,
  nearestDate,
  normalizeNotice,
  matchesNotice,
  parseCards,
  parseChapters,
  parseCourses,
  parseExams,
  parseHomeworkDetail,
  parseHomeworkList,
  parseSchedule,
} from './parse.js';

/** 课程列表的缓存时长。 */
const COURSES_TTL_MS = 5 * 60 * 1000;

/**
 * 课程列表缓存上限。
 *
 * 为什么要有上限：`XxtClient` 是长生命周期的（插件跑多久它就在多久），
 * 而缓存的键是端点地址。固定端点的缓存不会无限增长，但把上限写出来是为了
 * 让后来加"按课程缓存"的人看到这条约束，而不是等他上线后才发现内存慢慢涨。
 */
const COURSES_CACHE_MAX = 4;

/**
 * 把任意错误收成 `{ code, message }`。
 *
 * 与上游 `safeError` 的差别：不把 `details` 整个摊平到顶层 —— 那会把
 * `http_status` / `endpoint` 混进业务字段里。详情单独一层，调用方想用再用。
 *
 * @param {unknown} error - 任意错误。
 * @returns {{code: string, message: string, details: object}}
 */
export function describeError(error) {
  const code = typeof error?.code === 'string' && error.code ? error.code : 'INTERNAL_ERROR';
  return {
    code,
    message: String(error?.message ?? error ?? '未知错误'),
    details: (error && typeof error.details === 'object' && error.details) ? error.details : {},
  };
}

/**
 * 学习通读取器。
 *
 * 构造时只拿一个「能取文本」的门面（`XxtClient` 或测试替身），不关心 Cookie 从哪来。
 */
export class XxtReader {
  /**
   * @param {{get: Function, post: Function}} client - 请求门面。
   * @param {object} [options]
   * @param {() => Date} [options.now] - 注入当前时间（截止时间的年份推断要用）。
   */
  constructor(client, { now = () => new Date() } = {}) {
    if (typeof client?.get !== 'function' || typeof client?.post !== 'function') {
      throw new ClassroomError('CONFIG', '学习通读取器需要一个带 get/post 的客户端');
    }
    this.client = client;
    this.now = now;
    /** @type {Map<string, {at: number, courses: object[]}>} */
    this.courseCache = new Map();
  }

  /**
   * 课程列表（带 5 分钟缓存）。
   *
   * # 为什么需要缓存
   *
   * `deadlines()` 要逐课读作业、每门课还要读一次详情页。30 门课就是 60+ 请求，
   * 而每一步都可能问「这门课叫什么」。不缓存的话，一次配额读取会把课程列表
   * 重拉几十遍 —— 学习通对突发请求很敏感。
   *
   * @param {{signal?: AbortSignal, fresh?: boolean}} [options] - `fresh` 跳过缓存。
   * @returns {Promise<object[]>}
   */
  async courses({ signal, fresh = false } = {}) {
    const key = XXT_ENDPOINTS.courseList;
    const cached = this.courseCache.get(key);
    const now = Date.now();
    if (!fresh && cached && now - cached.at < COURSES_TTL_MS) return cached.courses;

    const base = await this.client.get(XXT_ENDPOINTS.base, undefined, { signal });
    // `fid`（学校/机构 id）有两种写法：JS 配置里的 `"fid": 123` 与内联脚本里的
    // `var fid = '123'`。两条都试，最后退回 427（上游的兜底值）——
    // 435/427 这类机构 id 只影响课程筛选，用错了通常是"课程少了几门"而不是报错。
    const fid = base.match(/"fid"\s*:\s*"?(\d+)"?/)?.[1]
      ?? base.match(/var fid = '(\d+)'/)?.[1]
      ?? '427';
    const html = await this.client.get(XXT_ENDPOINTS.courseList, {
      courseType: 1, courseFid: fid, courseTeacherid: 0, courseOrderBy: 0,
    }, { signal });
    const courses = parseCourses(html);
    this.courseCache.set(key, { at: now, courses });
    // 只保留最近几条（见 COURSES_CACHE_MAX 的注释）
    for (const stale of [...this.courseCache.keys()].slice(COURSES_CACHE_MAX)) {
      this.courseCache.delete(stale);
    }
    return courses;
  }

  /**
   * 课程清单（页面形状）。
   *
   * @param {{signal?: AbortSignal, fresh?: boolean}} [options]
   * @returns {Promise<{courses: Array<{course_id: string, class_id: string, name: string, teacher: string|null}>}>}
   */
  async listCourses({ signal, fresh } = {}) {
    const courses = await this.courses({ signal, fresh });
    return {
      courses: courses.map((course) => ({
        course_id: course.courseid,
        class_id: course.clazzid,
        name: course.name,
        // 空字符串归一成 null：页面据 null 显示「未标注」
        teacher: course.teacher || null,
      })),
    };
  }

  /**
   * 按 id 或名字找一门课。
   *
   * 三级匹配：精确 id → 精确名字 → 名字包含。为什么留"包含"：用户会说
   * 「高数」，而课名是「高等数学（甲）I」。
   *
   * @param {string} course - 课程 id 或名字。
   * @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<object>} 命中的原始课程对象。
   */
  async findCourse(course, { signal } = {}) {
    const wanted = String(course ?? '').trim();
    if (!wanted) throw new ClassroomError('INVALID_ARGUMENT', '需要给出课程 id 或课程名。');
    const courses = await this.courses({ signal });
    const hit = courses.find((item) => item.courseid === wanted)
      ?? courses.find((item) => item.name === wanted)
      ?? courses.find((item) => item.name.includes(wanted));
    if (!hit) throw new ClassroomError('COURSE_NOT_FOUND', `学习通中没有找到“${wanted}”这门课。`);
    return hit;
  }

  /**
   * 一门课的**章节目录**。
   *
   * 学习通的课程页是 `mooc2-ans` 那套：每个大章一个 `div.chapter_unit`，
   * 里面 `id="cur<编号>"` 的块是能点开的节，节还能再套一层 `li`。
   * 解析用 parse5 建 DOM 再遍历 —— 正则数不清嵌套层级（见 `parse.js` 的说明）。
   *
   * `course` 收课程 **id 或名字**（不是原始对象）：路由与页面手里只有这个，
   * 让它们先自己 `findCourse` 再传对象，等于把同一个约定抄两遍。
   *
   * @param {{course?: string, signal?: AbortSignal}} [options] - `course` 是 id 或名字。
   * @returns {Promise<{chapters: Array<{id: string, title: string, path: string[], locked: boolean}>, count: number}>}
   */
  async chapters({ course, signal } = {}) {
    const hit = await this.findCourse(course, { signal });
    const html = await this.client.get(XXT_ENDPOINTS.chapterList, {
      courseid: hit.courseid,
      clazzid: hit.clazzid,
      cpi: hit.cpi ?? '',
      ut: 's',
      t: String(Date.now()),
    }, { signal });
    const chapters = parseChapters(html);
    return { chapters, count: chapters.length };
  }

  /**
   * 一门课的**课件/附件清单**（逐节的卡片附件）。
   *
   * # 为什么是一串请求
   *
   * 学习通没有「整门课的附件列表」这种接口：附件挂在**每节的卡片**里，
   * 而一节可以有多张卡片（`num` 从 0 递增，取到 `found: false` 为止）。
   * 所以这个方法的请求数是 `节数 × 每节卡片数`，最坏情况不小。
   *
   * 上游对 `num` 设了 12 的上限，这里沿用 —— 超过 12 张卡片的节会被截断，
   * 那属于异常页面（正常一章不会有那么多卡）。
   *
   * 按 `objectId` 去重：同一份附件在多个卡片里重复出现是常态。
   *
   * @param {{course?: string, signal?: AbortSignal}} [options]
   * @returns {Promise<{files: Array<{name: string, kind: string, location: string[], objectId: string, size: number|null}>, notOpen: string[], count: number}>}
   */
  async materials({ course, signal } = {}) {
    const hit = await this.findCourse(course, { signal });
    const { chapters } = await this.chapters({ course: hit.courseid, signal });

    const files = [];
    const notOpen = [];
    const seen = new Set();

    for (const chapter of chapters) {
      // 锁住的节读了也是空页，直接记下名字跳过 —— 省一次请求，也让用户知道漏了哪节。
      if (chapter.locked) {
        notOpen.push(chapter.title);
        continue;
      }
      let closed = false;
      for (let num = 0; num < MAX_CARDS; num += 1) {
        const html = await this.client.get(XXT_ENDPOINTS.chapterCards, {
          clazzid: hit.clazzid,
          courseid: hit.courseid,
          knowledgeid: chapter.id,
          num,
          ut: 's',
          cpi: hit.cpi ?? '',
          mooc2: '1',
        }, { signal });
        const card = parseCards(html);
        if (card.notOpen) {
          notOpen.push(chapter.title);
          closed = true;
          break;
        }
        if (!card.found) break; // num 已越过最后一张
        for (const file of card.files) {
          if (seen.has(file.objectId)) continue;
          seen.add(file.objectId);
          files.push({ ...file, kind: kindOf(file.name), location: chapter.path });
        }
      }
      if (closed) continue;
    }

    return { files, notOpen, count: files.length };
  }

  /**
   * 一个附件的**下载参数**。**本方法不下载任何东西。**
   *
   * # 为什么只给参数（D21）
   *
   * 下载的执行归 `packages/core/*`：只有那一层知道用户想把文件放哪、要不要限速、
   * 磁盘够不够。数据源若自己写盘，就得同时决定目录约定、并发、断点续传 ——
   * 那些都是宿主的决定，不是「学习通有什么」这个事实的一部分。
   *
   * 所以这里把执行下载需要的东西**一次给全**：地址、请求头、建议文件名、
   * 预期字节数、以及「这份是不是原文件」。
   *
   * # 三种变体
   *
   * 平台对同一个附件可能给多个地址：
   * - `original` —— 老师上传的原文件（有 `download` 字段时）
   * - `playback` —— 视频转码后的播放版（体积小得多，只有视频有）
   * - `preview`  —— 文档预览用的 PDF（没有原文件时才有）
   *
   * 默认取原文件；视频可以要播放版。要的那种平台没给时退回另一种，
   * 并在 `note` 里说明 —— 不让调用方以为自己拿到的是原文件。
   *
   * @param {{objectId?: string, playback?: boolean, signal?: AbortSignal}} [options]
   * @returns {Promise<{url: string, variant: 'original'|'playback'|'preview', filename?: string, size?: number, headers: Record<string,string>, note?: string}>}
   */
  async downloadParams({ objectId, playback = false, signal } = {}) {
    const id = String(objectId ?? '').trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      throw new ClassroomError('INVALID_ARGUMENT', '下载需要 32 位 hex 的 objectId（从 materials() 的返回里取）。');
    }

    // `k` 是机构 id，从 Cookie 的 `fid` 取。取不到时留空 —— 平台多数情况下不校验它，
    // 但缺了会让部分资源 403，所以这里只报警不改行为。
    const fid = await this.fid();
    const status = JSON.parse(await this.client.get(`${MOOC1}/ananas/status/${id}`, {
      k: fid,
      flag: 'normal',
      _dc: String(Date.now()),
    }, { signal }));

    if (status?.status !== 'success') {
      throw new ClassroomError('REJECTED', `学习通没有给出这个文件：${status?.msg || status?.status || '状态未知'}`);
    }

    const secure = (url) => String(url).replace(/^http:\/\/([^/]*(?:chaoxing\.com|cldisk\.com))/i, 'https://$1');
    const original = status.download
      ? { url: secure(status.download), variant: 'original', ...(Number(status.length) > 0 ? { size: Number(status.length) } : {}) }
      : undefined;
    // 文档的 `http` 是在线阅读页，不是文件；只有视频的 `http` 才是播放版。
    const stream = status.http || status.httphd || status.httpmd;

    /** @type {{url: string, variant: string, size?: number, note?: string}} */
    let picked;
    if (playback && stream) picked = { url: secure(stream), variant: 'playback' };
    else if (original) {
      picked = playback ? { ...original, note: '平台没有这个视频的播放版，给的是原文件' } : original;
    } else if (stream) picked = { url: secure(stream), variant: 'playback', note: '平台没有给原文件，给的是播放版' };
    else if (status.pdf) picked = { url: secure(status.pdf), variant: 'preview', note: '平台没有给原文件，给的是预览用的 PDF' };
    else throw new ClassroomError('REJECTED', '学习通没有给出这个文件的下载地址');

    return {
      ...picked,
      ...(status.filename ? { filename: String(status.filename) } : {}),
      // 下载这几个域不带这个 Referer 会 403。执行下载的一方照抄即可。
      headers: { Referer: `${MOOC1}/` },
    };
  }

  /**
   * 从会话 Cookie 里取机构 id（`fid`）。
   *
   * 客户端不保证能访问 jar，所以拿不到时返回空串 —— 调用方（`downloadParams`）
   * 把它当可选参数用，不因此失败。
   *
   * @returns {Promise<string>}
   */
  async fid() {
    try {
      const jar = this.client?.session?.jar;
      if (!jar?.getCookies) return '';
      const cookies = await jar.getCookies(XXT_BASE);
      return String(cookies.find((c) => c.key === 'fid')?.value ?? '');
    } catch {
      return '';
    }
  }

  /**
   * 一门课的作业列表。
   *
   * # 两跳，缺一不可
   *
   * 1. 课程中间页：拿隐藏域里的作业签名（`workEnc` / `openc` / `enc`）。
   *    没有 `workEnc` 说明这门课没开作业功能 —— 那是**正常的**（很多课只用资料），
   *    所以要报一个专门的 code，让聚合读取悄悄跳过它而不是记成错误。
   * 2. 作业列表页：拿进度与逐条作业。
   *
   * @param {object} course - `courses()` 里的原始课程对象。
   * @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<{progress: {done: number, total: number}|null, items: object[]}>}
   */
  async homework(course, { signal } = {}) {
    const page = await this.client.get(XXT_ENDPOINTS.stuMiddle, {
      courseid: course.courseid,
      clazzid: course.clazzid,
      cpi: course.cpi,
      ismooc2: 1,
      v: 2,
    }, { signal });
    const workEnc = hiddenValue(page, 'workEnc');
    if (!workEnc) {
      throw new ClassroomError('HOMEWORK_UNAVAILABLE', '这门课没有开放作业功能（缺少作业签名）。');
    }
    const html = await this.client.get(XXT_ENDPOINTS.workList, {
      courseId: course.courseid,
      classId: course.clazzid,
      cpi: course.cpi,
      ut: 's',
      openc: hiddenValue(page, 'openc'),
      enc: workEnc,
      // 时间戳参与签名校验：它让每个链接一次性有效
      t: Date.now(),
      stuenc: hiddenValue(page, 'enc'),
      isdisplaytable: 2,
    }, { signal });
    if (html.includes('没有此页面访问权限')) {
      throw new ClassroomError('SIGNATURE_REJECTED', '作业页签名校验失败，请稍后重试。');
    }
    return parseHomeworkList(html);
  }

  /**
   * 一门课的作业清单（页面形状，去掉详情 URL）。
   *
   * 去掉 `url` 是有意的：那是带签名的地址，复制到别处就会失效，
   * 摆在响应里只会让人误以为可以点。
   *
   * @param {{course: string, signal?: AbortSignal}} options
   * @returns {Promise<{course: string, progress: object|null, homework: object[]}>}
   */
  async listHomework({ course, signal } = {}) {
    const hit = await this.findCourse(course, { signal });
    const result = await this.homework(hit, { signal });
    return {
      course: hit.name,
      progress: result.progress,
      homework: result.items.map(({ url: _url, ...rest }) => ({
        ...rest,
        pending: isPending(rest.status),
      })),
    };
  }

  /**
   * 汇总所有课的**未完成**作业与截止时间。
   *
   * # 为什么这么贵，以及为什么还是这么做
   *
   * 作业列表页**不显示截止时间**（只有状态栏），截止时间在每条作业的详情页里。
   * 所以要让用户看到"什么时候到期"，只能逐条读详情 —— 一个 30 门课的账号
   * 可能是上百个请求。
   *
   * 之所以没有"再请求一次 JSON 接口"的省事做法：学习通没有这样一个接口，
   * 列表页是服务端渲染的 HTML，时间只存在于详情页。于是控制成本的三个手段是：
   *
   *   - 只看**未完成**的（已完成的不需要知道 DDL）；
   *   - `max_courses` 限制扫描的课程数（默认 30，与上游一致）；
   *   - `horizon_days` 之外的结果**不输出**（详情已经读过了，但用户要的是
   *     近期的事，远处的不占屏）。
   *
   * # 错误不吞、也不炸
   *
   * 单门课没有作业功能（`HOMEWORK_UNAVAILABLE`）是**正常情况**，不记错误；
   * 其他失败记进 `errors` 并让 `complete: false`。这样"读了 29 门，1 门超时"
   * 仍然给出 29 门的数据，同时如实说明不完整 —— 比整批失败有用得多。
   *
   * @param {{course?: string, horizon_days?: number, max_courses?: number, signal?: AbortSignal}} [options]
   * @returns {Promise<{items: object[], courses_scanned: number, complete: boolean, errors: object[], note: string}>}
   */
  async deadlines({
    course, horizon_days: horizonDays = 90, max_courses: maxCourses = 30, signal,
  } = {}) {
    if (!Number.isFinite(horizonDays) || horizonDays < 0) {
      throw new ClassroomError('INVALID_ARGUMENT', 'horizon_days 必须是非负数。');
    }
    if (!Number.isFinite(maxCourses) || maxCourses < 1) {
      throw new ClassroomError('INVALID_ARGUMENT', 'max_courses 必须是正整数。');
    }
    const courses = course
      ? [await this.findCourse(course, { signal })]
      : (await this.courses({ signal })).slice(0, maxCourses);
    const now = this.now();
    const horizon = now.getTime() + horizonDays * 86400000;
    const rows = [];
    const errors = [];
    for (const item of courses) {
      let homework;
      try {
        homework = await this.homework(item, { signal });
      } catch (error) {
        // 这门课没开作业功能 = 没有待办，不是错误
        if (!(error instanceof ClassroomError && error.code === 'HOMEWORK_UNAVAILABLE')) {
          errors.push({ course: item.name, error: describeError(error) });
        }
        continue;
      }
      for (const pending of homework.items.filter((entry) => isPending(entry.status))) {
        let due = null;
        // 只读 https 的详情地址：页面偶尔给出 `javascript:` 或相对路径，
        // 那些既不能读、也不该被当成数据返回。
        if (pending.url.startsWith('https://')) {
          try {
            const detail = parseHomeworkDetail(await this.client.get(pending.url, undefined, { signal }));
            due = detail.deadline ? nearestDate(detail.deadline, now) : null;
          } catch (error) {
            errors.push({ course: item.name, title: pending.title, error: describeError(error) });
          }
        }
        if (due && Date.parse(due) > horizon) continue;
        rows.push({ course: item.name, title: pending.title, status: pending.status, deadline: due });
      }
    }
    const nowMs = now.getTime();
    // 排序：还要做的（按时间正序）→ 已过期的 → 没有截止时间的。
    // 用户打开这个列表是为了知道"下一步做什么"，过期的排在后面但仍然可见。
    rows.sort((a, b) => {
      const rank = (row) => (row.deadline == null ? 2 : Date.parse(row.deadline) < nowMs ? 1 : 0);
      return rank(a) - rank(b) || (a.deadline ?? '').localeCompare(b.deadline ?? '');
    });
    return {
      items: rows,
      courses_scanned: courses.length,
      complete: errors.length === 0,
      errors,
      note: '只列未完成的作业；截止时间来自作业详情页（原文无年份，按最接近今天的年份补全，北京时间）。',
    };
  }

  /**
   * 考试列表。
   *
   * @param {{signal?: AbortSignal}} [options]
   * @returns {Promise<{exams: object[]}>}
   */
  async exams({ signal } = {}) {
    const html = await this.client.get(XXT_ENDPOINTS.examList, undefined, { signal });
    return parseExams(html);
  }

  /**
   * 通知列表（分页拉取，最多 5 页）。
   *
   * # 为什么是 POST
   *
   * 通知接口的筛选条件太多（13 个字段），学习通把它做成了表单 POST。字段一个都不能
   * 少：少一个可能被服务端当成"条件缺失"而回空列表，表现是"通知页打不开"。
   *
   * # 提前退出的三个条件
   *
   * 本页空、`lastPage` 为真、已收集够 `limit` 条。少了任何一个都会把
   * 5 页全拉完 —— 对一个"看一眼有没有新通知"的场景，那是 5 倍的等待。
   *
   * @param {{limit?: number, unread_only?: boolean, keyword?: string, signal?: AbortSignal}} [options]
   * @returns {Promise<{notices: object[]}>}
   */
  async notices({ limit = 20, unread_only: unreadOnly = false, keyword = '', signal } = {}) {
    if (!Number.isFinite(limit) || limit < 1) {
      throw new ClassroomError('INVALID_ARGUMENT', 'limit 必须是正整数。');
    }
    const filter = { unread_only: unreadOnly, keyword };
    const items = [];
    let last = '';
    for (let page = 0; page < 5; page += 1) {
      const text = await this.client.post(XXT_ENDPOINTS.noticeList, {
        type: '0',
        notice_type: '0',
        lastValue: last,
        sort: '0',
        folderUUID: '',
        kw: '',
        startTime: '',
        endTime: '',
        gKw: '',
        gName: '',
        year: '',
        tag: '',
        fidsCode: '',
        filterSenderPuids: '',
        filterTags: '',
      }, { signal });
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        // 回 HTML 通常是登录态没了，但那条判定已经在 `XxtClient.inspect` 里做过；
        // 走到这里就是接口真的换了形状 —— 报结构错误，别报成"没有通知"。
        throw new ClassroomError('SCHEMA_CHANGED', '学习通通知接口未返回 JSON。');
      }
      if (!payload?.status) {
        throw new ClassroomError('PLATFORM_REJECTED', '学习通通知接口返回失败。');
      }
      const data = payload.notices ?? {};
      const list = Array.isArray(data.list) ? data.list : [];
      items.push(...list);
      last = data.lastGetId ?? '';
      // 游标没前进就别再翻页了：否则同一个 lastValue 会被反复请求，
      // 5 次全返回同一页，白等 5 个往返。
      if (!list.length || !last || data.lastPage || items.filter((entry) => matchesNotice(entry, filter)).length >= limit) {
        break;
      }
    }
    return {
      notices: items
        .filter((entry) => matchesNotice(entry, filter))
        .slice(0, limit)
        .map(normalizeNotice),
    };
  }

  /**
   * 我的课表。
   *
   * @param {{week?: number, signal?: AbortSignal}} [options]
   * @returns {Promise<object>}
   */
  async schedule({ week, signal } = {}) {
    if (week != null && (!Number.isFinite(week) || week < 1)) {
      throw new ClassroomError('INVALID_ARGUMENT', 'week 必须是正整数。');
    }
    const text = await this.client.post(
      XXT_ENDPOINTS.schedule,
      week ? { week: String(week) } : {},
      { signal },
    );
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ClassroomError('SCHEMA_CHANGED', '学习通课表接口未返回 JSON。');
    }
    // `result` 是数字 1，不是布尔 true —— 用 `!== 1` 判，别写成 `!payload.result`
    if (payload?.result !== 1) {
      throw new ClassroomError('PLATFORM_REJECTED', '学习通课表接口返回失败。');
    }
    return parseSchedule(payload.data, week);
  }
}

/**
 * 读取器暴露的方法名。
 *
 * 路由据此白名单校验：**只看这张表**，不从读取器身上做任意属性访问。
 * 少了这层，"调一个数据方法"就等于"在插件进程里执行任意方法"
 * （`constructor`、`__proto__` 之类都能拨）。
 */
export const XXT_METHODS = Object.freeze([
  'courses',
  'listCourses',
  'findCourse',
  'chapters',
  'materials',
  'downloadParams',
  'homework',
  'listHomework',
  'deadlines',
  'exams',
  'notices',
  'schedule',
]);
