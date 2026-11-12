/**
 * 学习通的只读读取方法。
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
 * # 分层：本文件只做「发哪个请求、拿哪段数据」
 *
 * 纯解析在 `parse.js`，名称匹配与圈定范围在 `files.js`，清单聚合与落盘在
 * `inventory.js`。本文件的方法负责把它们串成**一个能直接调用的基础函数**：
 * 参数收用户能给出的各种形式（课程名 / 课程 id / 课程页链接、章节标题 / 清单里
 * 的 `location`、文件名 / 不带扩展名 / 名字里的一段），返回固定形状。
 * 工具层不该再去调几个读方法自己拼 —— 那样每加一个工具就多一份拼法。
 *
 * # 只读边界
 *
 * 这些方法全部只发 GET/POST **查询**，没有一处提交、删除或修改。学习通里
 * 「交作业」「开始考试」这类动作**没有**对应方法 —— 那是用户自己的决定，
 * 不该由一个数据包替他做。**下载文件**不属于这一类：它读的是平台的文件、
 * 写的是本机磁盘，平台上的状态一点没变（判据是「有没有改别人的状态」）。
 *
 * # 唯一的写操作是导入 Cookie
 *
 * 它写在 `Client.importCookie()` 里，不在这里：本文件的方法只读数据。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import { XXT_BASE, XXT_ENDPOINTS, secureXxtUrl } from './hosts.js';
import {
  beijingMinute,
  fromWorkRow,
  homeworkKind,
  isPending,
  nearestDate,
  normalizeNotice,
  matchesNotice,
  parseChapters,
  parseCourses,
  parseExams,
  parseHomeworkDetail,
  parseHomeworkList,
  parseSchedule,
  parseStuWork,
  parseTaskKey,
  parseTaskList,
  parseTaskPlans,
  hiddenValue,
} from './parse.js';
import {
  chapterInventory,
  dataRows,
  groupedFiles,
  inventory,
  saveFiles,
  summarize,
} from './inventory.js';
import {
  KIND_GROUPS,
  distinctFiles,
  fileRow,
  groupBySection,
  pickFiles,
  splitPhrases,
} from './files.js';

/** 一节的卡片数上限。上游用 12 —— 正常一章不会有那么多张卡，超出就是异常页。 */
const MAX_CARDS = 12;

/** 超星课程服务（ananas 状态接口在这里）。 */
const MOOC1 = 'https://mooc1.chaoxing.com';

/**
 * 学习任务明细的缓存时长。
 *
 * 全部做完的任务不会再变，隔这么久重读一次就够；老师放着不管的课不必每次
 * 一项项读 —— 超星对密集请求会要验证码。
 */
const TASK_QUIET_MS = 6 * 3600_000;

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
   * @param {{get: Function, post: Function, stream?: Function}} client - 请求门面。
   * @param {object} [options]
   * @param {() => Date} [options.now] - 注入当前时间（截止时间的年份推断要用）。
   * @param {string} [options.downloadDir] - 下载根目录。**装配时**定，调用方不给路径。
   */
  constructor(client, { now = () => new Date(), downloadDir } = {}) {
    if (typeof client?.get !== 'function' || typeof client?.post !== 'function') {
      throw new ClassroomError('CONFIG', '学习通读取器需要一个带 get/post 的客户端');
    }
    this.client = client;
    this.now = now;
    /**
     * 下载根目录。
     *
     * 为什么由装配方给而不是由调用方传：让模型传路径等于让它往任意位置写文件。
     * 与 `source/cc98` 的 `downloadDir` 同一口径。
     */
    this.downloadDir = downloadDir;
    /** @type {Map<string, {at: number, courses: object[]}>} */
    this.courseCache = new Map();
    /**
     * 课程文件清单的缓存（按课程，30 分钟）。
     *
     * 先看清单再下载、连着下几次是常态；没有它，每次下载都要把 30 节的卡片
     * 重读一遍 —— 那是几十个请求，而学习通对突发请求很敏感。
     */
    this.inventoryCache = new Map();
    /** 学习任务明细的缓存（按课程 × 任务，进度与时间戳决定能不能复用）。 */
    this.taskCache = new Map();
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
   * 一门课的**章节目录 + 每节的文件**（一次给出「整门课有什么」）。
   *
   * # 为什么与 `chapters()` 并存而不是替换它
   *
   * `chapters()` 只读目录页，一次请求、很快；它是「我只想知道有哪几章」的答案。
   * 本方法要把每节的卡片都读一遍（30 节 → 几十个请求），只有当用户真的问
   * 「这门课有什么文件」时才值得付这个代价。两者的**成本差一个数量级**，
   * 合成一个就等于让「查章节目录」也要等十秒。
   *
   * @param {{course?: string, fresh?: boolean, signal?: AbortSignal}} [options]
   * @returns {Promise<{course: string, chapter_count: number, file_count: number, chapters: Array<object>, notOpen: string[], warning?: string, cached?: boolean, note: string}>}
   */
  async chapterList({ course, fresh = false, signal } = {}) {
    const { course: hit, chapters, inventory: full } = await chapterInventory(this, course, { fresh, signal });
    const files = distinctFiles(full.files);
    const sections = groupBySection(files);
    return {
      ...summarize(hit, files, full),
      // `count` 从 `summarize` 出来是**文件数**；这里再给两个更具体的数，
      // 因为「这门课有几节」与「有几个文件」是两个不同的问题。
      count: files.length,
      chapter_count: chapters.length,
      section_count: sections.length,
      chapters: sections,
    };
  }

  /**
   * 一门课的**课件等文件**清单（章节附件 + 「资料」栏，按 objectId 合并去重）。
   *
   * # 为什么默认两条通路都读
   *
   * 老师把课件放「资料」里是常态，而**资料栏不在章节卡片里**。只读章节会得到
   * 「这门课没有课件」的错误结论（审计 漏-6）。所以默认两条都读，并按课程里
   * 的层次合并 —— 章节里那份的准确字节数优先于资料栏的约数。
   *
   * # `chapter` 收三种写法
   *
   * 章节标题里的一段（「等厚干涉」「5.2」）、清单里原样的 `location`（「第一章 / 5.2 等厚干涉」）、
   * 或资料栏的文件夹名（「资料 / 课件」）。**这是「只下某一节」的前提** ——
   * 用户手里只有从页面上看到的标题，没有内部编号。
   *
   * @param {{course?: string, chapter?: string, fresh?: boolean, signal?: AbortSignal}} [options]
   * @returns {Promise<object>} `{ course, count, files: [...], notOpen, warning?, note }`
   */
  async materials({ course, chapter, fresh = false, signal } = {}) {
    const found = await groupedFiles(this, course, { chapter, fresh, signal });
    return {
      ...summarize(found.course, found.files, found),
      ...(found.scope ? { scope: found.scope.join(' / ') } : {}),
      files: found.files.map(fileRow),
    };
  }

  /**
   * 一门课的**视频**清单（章节里的视频 + 资料栏里的视频）。
   *
   * 与 `materials()` 同一套范围规则，只是筛出 `kind === 'video'`。
   * 单独一条而不是让调用方自己过滤：`kindOf` 认 16 种视频扩展名，
   * 让每个调用方各写一遍那个集合，迟早有一方漏掉 `rmvb`、`ts` 这些老格式。
   *
   * @param {{course?: string, chapter?: string, fresh?: boolean, signal?: AbortSignal}} [options]
   * @returns {Promise<object>}
   */
  async videos({ course, chapter, fresh = false, signal } = {}) {
    const found = await groupedFiles(this, course, { kinds: ['video'], chapter, fresh, signal });
    return {
      ...summarize(found.course, found.files, found),
      ...(found.scope ? { scope: found.scope.join(' / ') } : {}),
      files: found.files.map(fileRow),
    };
  }

  /**
   * 把课件 / 视频**下载到本地**。
   *
   * # 三种选文件的写法
   *
   * - `name`：文件名（全名、不带扩展名的名字，或名字里的一段；多个用 `|` / `、` 分隔）；
   * - `chapter`：只下这一章 / 这一节 / 这个资料文件夹的；
   * - `all`：这门课的全部（同一组内）。
   *
   * 三者必须说清一个 —— 都没给时**不发请求**就报错：一个「下载整门课」的
   * 意外动作代价是几百 MB 流量与磁盘，不该靠默认值发生。
   *
   * # 为什么落盘目录不由调用方给
   *
   * 目录在装配时定（`XxtReader` 的 `downloadDir`）。让调用方传路径等于让一次
   * 对话把文件写到任意位置；`outDir` 只在装配方明确传参时生效（排障与脚本用）。
   *
   * @param {object} options
   * @param {string} options.course - 课程（id / 名字 / 课程页链接）。
   * @param {'material'|'video'} [options.group] - 下载哪一组，默认课件。
   * @param {string} [options.name] - 文件名，多个用竖线或顿号分隔。
   * @param {string} [options.chapter] - 章节或资料栏文件夹。
   * @param {boolean} [options.all] - 这门课这一组的全部。
   * @param {boolean} [options.playback] - 视频要平台的播放版（体积约为原文件十分之一）。
   * @param {string} [options.outDir] - 覆盖根目录（仅装配方 / 脚本用）。
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<object>} `{ course, dir, count, files, failed? }`
   */
  async downloadFiles({
    course, group = 'material', name, chapter, all = false, playback = false, outDir, signal,
  } = {}) {
    const names = splitPhrases(name);
    if (all ? names.length > 0 || chapter !== undefined : !names.length && chapter === undefined) {
      throw new ClassroomError(
        'INVALID_ARGUMENT',
        `需要 name（文件名）、chapter（章节），或 all（这门课的全部${group === 'video' ? '视频' : '课件'}）。`,
      );
    }
    const found = await groupedFiles(this, course, { kinds: KIND_GROUPS[group] ?? KIND_GROUPS.material, chapter, signal });
    const choose = (files) => {
      if (!names.length) return files.filter((file) => file.downloadable !== false);
      return pickFiles(files, names, (file) => fileRow(file));
    };
    let wanted;
    try {
      wanted = choose(found.files);
    } catch (error) {
      // 清单来自缓存时，老师刚传的文件可能不在里面：重读一次再找。
      if (error?.code !== 'NEEDS_USER' || !found.cached) throw error;
      const again = await groupedFiles(this, course, { kinds: KIND_GROUPS[group] ?? KIND_GROUPS.material, chapter, fresh: true, signal });
      wanted = choose(again.files);
    }
    const saved = await saveFiles(this, found.course, wanted, found.files, { playback, outDir, signal });
    return {
      ...saved,
      ...(found.notOpen.length ? { notOpen: found.notOpen } : {}),
    };
  }

  /**
   * 一门课**资料栏**里的文件（只走资料栏，不看章节卡片）。
   *
   * # 什么时候需要它
   *
   * `materials()` 已经把两条通路合并了。这条单列的价值是**分开取证**：
   * 排查「资料栏到底读到没有」、或只要资料栏里那批文件时，不必把 30 节的
   * 卡片也读一遍。
   *
   * @param {{course?: string, signal?: AbortSignal}} [options] - `course` 是 id / 名字 / 课程页链接。
   * @returns {Promise<{files: Array<object>, count: number, note: string}>}
   */
  async dataFiles({ course, signal } = {}) {
    const hit = await this.findCourse(course, { signal });
    const files = await dataRows(this, hit, signal);
    return {
      files,
      count: files.length,
      note: '资料栏文件与章节附件是两条通路；本方法只读资料栏。'
        + '大小是页面上的约数（同一份文件在章节里可能有准确字节数）。',
    };
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
   * # 资料栏文件走另一条入口
   *
   * 章节附件的地址来自云盘对象状态接口；资料栏文件没有 `objectId`，
   * 它的下载入口是 `coursedata/downloadData`，**302 到带签名的真实地址**。
   * 所以传 `dataId` 时走那条入口，并顺带要求 `course`（平台要 classId/cpi）。
   *
   * @param {{objectId?: string, dataId?: string, course?: string, clazzid?: string, cpi?: string, playback?: boolean, signal?: AbortSignal}} [options]
   * @returns {Promise<{url: string, variant: 'original'|'playback'|'preview', filename?: string, size?: number, headers: Record<string,string>, note?: string}>}
   */
  async downloadParams({ objectId, dataId, course, clazzid, cpi, playback = false, signal } = {}) {
    const id = String(objectId ?? '').trim();
    const data = String(dataId ?? '').trim();
    if (!id && data) {
      // 资料栏文件：入口是 302，只有 `Location` 是能用的地址。
      if (!course) {
        throw new ClassroomError('INVALID_ARGUMENT', '资料栏文件需要同时给 course（课程 id 或名字）：平台的下载入口要 classId 与 cpi。');
      }
      const hit = await this.findCourse(course, { signal });
      const url = await this.client.redirect(XXT_ENDPOINTS.dataDownload, {
        query: {
          dataId: data,
          classId: clazzid ?? hit.clazzid,
          cpi: cpi ?? hit.cpi ?? '',
          courseId: hit.courseid,
          ut: 's',
        },
        signal,
      });
      return {
        url,
        variant: 'original',
        // 资料栏不给准确字节数（页面上只有约数），所以这里不编一个 size。
        headers: { Referer: `${MOOC1}/` },
        note: '资料栏文件：地址由平台 302 到带签名的真实位置，有效期有限，取到就下。',
      };
    }
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      throw new ClassroomError('INVALID_ARGUMENT', '下载需要 32 位 hex 的 objectId（从 materials() 的返回里取），或资料栏文件的 dataId。');
    }

    // `k` 是机构 id，从 Cookie 的 `fid` 取。取不到时留空 —— 平台多数情况下不校验它，
    // 但缺了会让部分资源 403，所以这里只报警不改行为。
    const fid = await this.fid();
    const status = await this.#json(
      `${MOOC1}/ananas/status/${id}`,
      { k: fid, flag: 'normal', _dc: String(Date.now()) },
      signal,
      '附件状态',
    );

    if (status?.status !== 'success') {
      throw new ClassroomError('REJECTED', `学习通没有给出这个文件：${status?.msg || status?.status || '状态未知'}`);
    }

    const original = status.download
      ? { url: secureXxtUrl(status.download), variant: 'original', ...(Number(status.length) > 0 ? { size: Number(status.length) } : {}) }
      : undefined;
    // 文档的 `http` 是在线阅读页，不是文件；只有视频的 `http` 才是播放版。
    const stream = status.http || status.httphd || status.httpmd;

    /** @type {{url: string, variant: string, size?: number, note?: string}} */
    let picked;
    if (playback && stream) picked = { url: secureXxtUrl(stream), variant: 'playback' };
    else if (original) {
      picked = playback ? { ...original, note: '平台没有这个视频的播放版，给的是原文件' } : original;
    } else if (stream) picked = { url: secureXxtUrl(stream), variant: 'playback', note: '平台没有给原文件，给的是播放版' };
    else if (status.pdf) picked = { url: secureXxtUrl(status.pdf), variant: 'preview', note: '平台没有给原文件，给的是预览用的 PDF' };
    else throw new ClassroomError('REJECTED', '学习通没有给出这个文件的下载地址');

    return {
      ...picked,
      ...(status.filename ? { filename: String(status.filename) } : {}),
      // 下载这几个域不带这个 Referer 会 403。执行下载的一方照抄即可。
      headers: { Referer: `${MOOC1}/` },
    };
  }

  /**
   * 取一个 JSON 接口。
   *
   * # 为什么不在调用点直接 `JSON.parse`
   *
   * 学习通在登录态失效、被风控、或接口换版时，会用 **HTTP 200 + 一段 HTML**
   * 顶替 JSON。`JSON.parse` 抛的是 `SyntaxError`，它没有 `code` —— 于是会被
   * 上层当作 `INTERNAL_ERROR` 报出去，用户看到的是「未知错误」而不是
   * 「Cookie 失效了」或「平台换了形状」。这里把它翻译成稳定的 code。
   *
   * @param {string} url - 完整地址。
   * @param {Record<string, unknown>|undefined} query - 查询参数。
   * @param {AbortSignal|undefined} signal - 取消信号。
   * @param {string} label - 出错时用来指认是哪个接口。
   * @returns {Promise<object>}
   */
  async #json(url, query, signal, label) {
    const text = await this.client.get(url, query, { signal });
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ClassroomError('SCHEMA_CHANGED', `${label}没有返回 JSON。`);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ClassroomError('SCHEMA_CHANGED', `${label}返回的不是对象。`);
    }
    return payload;
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
   * # 为什么这一条要合并三个来源
   *
   * 学习通里「要交的作业」分散在三处，**任何一处单独读都会漏**：
   *
   * | 来源 | 能读到什么 | 漏掉什么 |
   * | --- | --- | --- |
   * | 课程的作业栏（`mooc2/work/list`） | 老师直接发在这门课里的作业与进度 | 打包进「学习任务」的那些 |
   * | 课程「任务」栏（任务引擎） | 按周发的学习任务里附的作业、要求、开放与截止时间 | 老师不在任务里发的 |
   * | 手机端全局列表（`work/stu-work`） | 跨课程、不在上面两处的 | 没有截止时间、没有要求 |
   *
   * 老师常把作业打包进学习任务，而这类作业课程作业栏里**根本没有**；
   * 手机端列表也不全。所以三个来源都要读，并按「课程 + 标题」去重。
   *
   * # 去重为什么按「课程 + 标题」
   *
   * 同一份作业会同时出现在任务与手机端列表里，而两处都没有共同的 id。
   * 标题在同一门课里重复的情况极少（真重复时留在两处也不误导：它们确实
   * 是两条要交的东西）。
   *
   * # 单门课的作业栏读不到不算失败
   *
   * 很多课只用资料、没开作业功能（`HOMEWORK_UNAVAILABLE`）。把它记成错误会让
   * 「读了 29 门，1 门没开作业」看起来像出了问题。所以那种 code 静默跳过，
   * 其余失败记进 `failed` 并让调用方知道结果不完整。
   *
   * @param {{course?: string, fresh?: boolean, pending_only?: boolean, signal?: AbortSignal}} [options]
   *   `course` 给了就只看这门课，不给就是**全部课程**；`fresh` 不用学习任务明细的缓存；
   *   `pending_only` 只要还没交的（交过的仍有价值 —— 用户要区分「漏了没」与「交了没」，
   *   所以这是**可选**过滤，不是默认行为）。
   * @returns {Promise<object>} 给了 `course` 时是 `{course, progress, homework, failed}`；
   *   没给时是 `{count, homeworks, failed}`（全部课程合并）。
   */
  async listHomework({ course, fresh = false, pending_only: pendingOnly = false, signal } = {}) {
    if (course) {
      const hit = await this.findCourse(course, { signal });
      const one = await this.#courseHomework(hit, { fresh, signal });
      const rows = pendingOnly ? one.homework.filter((row) => row.pending) : one.homework;
      // 按截止时间从近到远，没有截止时间的在最后。
      return {
        course: hit.name,
        progress: one.progress,
        count: rows.length,
        homework: rows.sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9')),
        failed: one.failed,
      };
    }
    const courses = await this.courses({ signal });
    const homeworks = [];
    const failed = [];
    for (const hit of courses) {
      const one = await this.#courseHomework(hit, { fresh, signal });
      homeworks.push(...one.homework);
      failed.push(...one.failed);
    }
    const rows = pendingOnly ? homeworks.filter((row) => row.pending) : homeworks;
    return {
      count: rows.length,
      homeworks: rows.sort((a, b) => (a.deadline ?? '9').localeCompare(b.deadline ?? '9')),
      failed,
    };
  }

  /**
   * 一门课的作业（三个来源合并）。
   *
   * 拆出来是因为「全部课程」那一路要逐课调用它：把合并逻辑写在公开方法的循环里，
   * 单门课那一支就得复制一遍三个来源的读法 —— 那正是漏掉某个来源的经典成因。
   *
   * @param {object} hit - 原始课程对象。
   * @param {{fresh: boolean, signal?: AbortSignal}} options
   * @returns {Promise<{homework: object[], failed: Array<{course: string, reason: string}>}>}
   */
  async #courseHomework(hit, { fresh = false, signal } = {}) {
    const failed = [];
    const rows = [];
    let progress = null;

    try {
      const page = await this.homework(hit, { signal });
      progress = page.progress;
      for (const item of page.items) {
        rows.push({
          course: hit.name,
          task: '',
          title: item.title,
          // 作业栏没有「类型」字段，按名字判 —— 周测、小测在超星里也是作业。
          type: homeworkKind(item.title),
          index: item.index,
          status: item.status,
          // 作业栏不显示开题/截止时间；只有学习任务那条通路有。
          opens: null,
          deadline: null,
          done: !isPending(item.status),
          closed: false,
          requirement: '',
          otherLeft: 0,
        });
      }
    } catch (error) {
      if (error?.code !== 'HOMEWORK_UNAVAILABLE') {
        failed.push({ course: hit.name, reason: String(error?.message ?? error) });
      }
    }

    // 学习任务里的作业：逐任务读明细。失败按任务记，不影响其余来源。
    const now = this.now().getTime();
    try {
      rows.push(...await this.courseTaskHomework(hit, { fresh, now, signal }));
    } catch (error) {
      const fatal = ['COOKIE_EXPIRED', 'COOKIE_IMPORT_REQUIRED', 'RATE_LIMITED', 'CANCELLED'];
      if (fatal.includes(error?.code)) throw error;
      failed.push({ course: `${hit.name}（学习任务）`, reason: String(error?.message ?? error) });
    }

    // 手机端全局列表：补前两处都没有的（跨课程、或老师直接在 App 上发的）。
    // 这一页是**所有课混在一起**的，所以只挑这门课的行。
    try {
      const known = new Set(rows.map((row) => `${row.course}\n${row.title}`));
      const html = await this.client.get(XXT_ENDPOINTS.stuWork, undefined, { signal });
      for (const raw of parseStuWork(html)) {
        const row = fromWorkRow(raw, now);
        if (row.course !== hit.name || known.has(`${row.course}\n${row.title}`)) continue;
        rows.push(row);
      }
    } catch (error) {
      const fatal = ['COOKIE_EXPIRED', 'COOKIE_IMPORT_REQUIRED', 'RATE_LIMITED', 'CANCELLED'];
      if (fatal.includes(error?.code)) throw error;
      failed.push({ course: '手机端作业列表', reason: String(error?.message ?? error) });
    }

    return {
      progress,
      failed,
      homework: rows.map((row) => ({ ...row, pending: !row.done && !row.closed })),
    };
  }

  /**
   * 一门课「任务」栏里附的作业。
   *
   * # 两跳，且第二跳要一个加密编号
   *
   * 1. 任务列表（`getData`）给 `id` 与进度；
   * 2. 中间页（`jumpStudyPlanList`）的脚本里有 `eTaskUserId = "…"`，
   *    **它才是明细要的编号**，任务列表给的 `id` 不能直接用；
   * 3. 明细（`getUserStandard`）里 `planType === 4` 的才是作业。
   *
   * # 缓存口径：按进度与时间判能不能复用
   *
   * 进度变了（`finished/total` 变了）一定重读；全部做完的任务可以一直复用；
   * 没做完的看有没有还没截止的作业、以及隔了多久 —— 老师放着不管的课不必
   * 每次一项项读，超星对密集请求会要验证码。
   *
   * @param {object} course - 原始课程对象。
   * @param {{fresh: boolean, now: number, signal?: AbortSignal}} options
   * @returns {Promise<Array<object>>}
   */
  async courseTaskHomework(course, { fresh = false, now = this.now().getTime(), signal } = {}) {
    const payload = await this.#json(
      XXT_ENDPOINTS.taskList,
      { DB_STRATEGY: 'DEFAULT', courseId: course.courseid, classId: course.clazzid },
      signal,
      '学习任务列表',
    );
    const list = parseTaskList(payload);
    if (!list.available) {
      // 这门课没有「任务」栏（老师直接在作业栏发作业）。那是**正常情况**，
      // 不是失败 —— 报错会让每门只用作业栏的课都留一行 failed。
      return [];
    }
    if (list.malformed) {
      throw new ClassroomError('SCHEMA_CHANGED', '学习任务列表的结构不是预期的形状。', {
        course: course.name,
      });
    }

    const key = `${course.courseid}/${course.clazzid}`;
    const saved = this.taskCache.get(key) ?? { tasks: new Map() };
    /** 只留现在还存在的任务：读完这一次就不会再问那些已经消失的。 */
    const after = new Map();
    const rows = [];

    for (const task of list.tasks) {
      const signature = `${task.finished}/${task.total}`;
      const old = saved.tasks.get(task.id);
      const reusable = old
        && !fresh
        && old.signature === signature
        && (task.total > 0 && task.finished >= task.total
          || (!old.plans.some((plan) => !plan.done && plan.ends !== null && plan.ends > now)
            && now - old.at < TASK_QUIET_MS));
      let entry = old;
      if (!reusable) {
        const page = await this.client.get(XXT_ENDPOINTS.taskMiddlePage, {
          taskId: task.id,
          moocClassId: course.clazzid,
        }, { signal });
        const taskKey = parseTaskKey(page);
        if (!taskKey) {
          throw new ClassroomError('SCHEMA_CHANGED', '学习任务页里没有任务编号（页面结构变了）。');
        }
        const detail = await this.#json(
          XXT_ENDPOINTS.taskStandard,
          { encryTaskUserId: taskKey },
          signal,
          '学习任务明细',
        );
        entry = { ...parseTaskPlans(detail?.data), signature, at: now };
      }
      after.set(task.id, entry);
      for (const plan of entry.plans) {
        rows.push({
          course: course.name,
          task: task.name,
          title: plan.title,
          type: homeworkKind(plan.title),
          index: null,
          status: plan.done ? '已完成' : '未提交',
          opens: beijingMinute(plan.opens),
          deadline: beijingMinute(plan.ends),
          done: plan.done,
          closed: plan.ends !== null && plan.ends <= now,
          requirement: plan.requirement,
          // 同一个学习任务里作业以外还有几项没学完：用户要的是「这一周还有多少事」。
          otherLeft: entry.otherLeft,
        });
      }
    }
    saved.tasks = after;
    this.taskCache.set(key, saved);
    for (const stale of [...this.taskCache.keys()].slice(8)) {
      if (stale !== key) this.taskCache.delete(stale);
    }
    return rows;
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
   * @param {{course?: string, horizon_days?: number, max_courses?: number, fresh?: boolean, signal?: AbortSignal}} [options]
   *   `fresh` 跳过学习任务明细的缓存（用户说「老师刚发了作业」时用）。
   * @returns {Promise<{items: object[], courses_scanned: number, complete: boolean, errors: object[], note: string}>}
   */
  async deadlines({
    course, horizon_days: horizonDays = 90, max_courses: maxCourses = 30, fresh = false, signal,
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
      /**
       * 学习任务里的作业**自带截止时间**，不必逐条读详情页。
       *
       * 这条来源以前完全没接：只读作业栏时，那些打包进学习任务的作业
       * 连「存在」都看不到（老师常这么发），于是待办列表是空的 —— 而用户
       * 以为是自己看错了地方。它的时间来自任务明细，比详情页的
       * 「MM-DD HH:MM」还准（那里没有年份，要靠猜）。
       */
      let taskRows = [];
      try {
        taskRows = await this.courseTaskHomework(item, { fresh, now: now.getTime(), signal });
      } catch (error) {
        const fatal = ['COOKIE_EXPIRED', 'COOKIE_IMPORT_REQUIRED', 'RATE_LIMITED', 'CANCELLED'];
        if (fatal.includes(error?.code)) throw error;
        errors.push({ course: item.name, title: '学习任务', error: describeError(error) });
      }
      for (const row of taskRows) {
        if (row.done || row.closed) continue;
        if (row.deadline && Date.parse(row.deadline.replace(' ', 'T')) > horizon) continue;
        rows.push({
          course: item.name,
          title: row.title,
          status: row.status,
          deadline: row.deadline,
          task: row.task,
          ...(row.otherLeft ? { otherLeft: row.otherLeft } : {}),
        });
      }

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
      // 任务里已经列过的（同一门课同名）不再从作业栏重复列一次。
      const known = new Set(taskRows.map((row) => row.title));
      for (const pending of homework.items.filter((entry) => isPending(entry.status))) {
        if (known.has(pending.title)) continue;
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
      // 两种来源的时间形状不同：学习任务给的是「YYYY-MM-DD HH:mm」，
      // 详情页补出来的是带 +08:00 的 ISO 串。排序前统一成时间戳，
      // 直接比字符串会让「2026-04-20 23:59」永远排在「2026-04-05T23:59:00+08:00」后面。
      const at = (row) => (row.deadline == null ? null : Date.parse(row.deadline.replace(' ', 'T')));
      const rank = (row) => {
        const time = at(row);
        return time == null ? 2 : time < nowMs ? 1 : 0;
      };
      return rank(a) - rank(b) || (at(a) ?? 0) - (at(b) ?? 0);
    });
    return {
      items: rows,
      courses_scanned: courses.length,
      complete: errors.length === 0,
      errors,
      note: '只列未完成的作业；学习任务里的时间来自任务明细，作业栏里的来自详情页'
        + '（原文无年份，按最接近今天的年份补全，北京时间）。',
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
  'chapterList',
  'materials',
  'videos',
  'dataFiles',
  'downloadParams',
  'downloadFiles',
  'homework',
  'listHomework',
  'deadlines',
  'exams',
  'notices',
  'schedule',
]);


