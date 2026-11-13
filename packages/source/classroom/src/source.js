import { createHash } from 'node:crypto';
import path from 'node:path';
import { Transport } from './transport.js';
import { SessionStore } from './session.js';
import { authenticate, inspectJwt, jwtFromTokenCookie } from './auth.js';
import { LiveSource } from './live.js';
import { LiveCollector } from './live-caption.js';
import { ClassroomError, array, object, shape } from './errors.js';
import * as models from './models.js';
// 下载器住在 tier 0 的 `source-http`：Range 怎么续、半截文件叫什么、什么时候算
// 发布成功是**传输层知识**，不是智云课堂的知识。本包原先自带一份同语义实现，
// 2026-11-12 合并到共享层（那份多支持重定向跟随与 HTTPS 校验，是本包的超集）。
import { download } from '@lybx-leyw/dsh-zju-source-http';
import { KINDS, assetsOf, extractedAudioNotice, parseKinds } from './resources.js';
import { DEFAULT_MAX_CHARACTERS, DEFAULT_TRANSCRIBE_TIMEOUT_MS, renderTranscript, transcribeFile } from './asr.js';
import { checkComponents, setupPlan as planLocalSetup } from './diagnostics.js';
export { ClassroomError } from './errors.js';
export { SessionStore } from './session.js';
export { Transport } from './transport.js';
export { LiveSource } from './live.js';
export { LiveCollector, decodeFrame, subtitleEndpoint, normalizeCaption, missingIntervals } from './live-caption.js';
export { KINDS, parseKinds, assetsOf, videoHeight } from './resources.js';
export { transcribeFile, withTimeout, normalizeSegments, renderTranscript, DEFAULT_TRANSCRIBE_TIMEOUT_MS } from './asr.js';
export { checkComponents, checkMedia, checkAsr, resolveFfmpeg, COMPONENTS } from './diagnostics.js';

export const ENDPOINTS = Object.freeze({
  courses: 'https://education.cmc.zju.edu.cn/personal/courseapi/vlabpassportapi/v1/account-profile/course',
  lessons: 'https://yjapi.cmc.zju.edu.cn/courseapi/v2/course/catalogue',
  slides: 'https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt',
  subtitles: 'https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result',
  schedule: 'https://yjapi.cmc.zju.edu.cn/courseapi/v2/schedule/get-week-schedules',
  /**
   * 「我这天有什么课」—— 与 `schedule` 是两个端点、两种口径。
   *
   * `schedule` 按周给排课（可能含非本人课程，以课程为单位）；
   * 这个按**天**返回我本人课表里的节次，带直播所需的 `sub_id`。
   */
  myDay: 'https://classroom.zju.edu.cn/courseapi/v2/course-live/get-my-course-day',
  /** 课程搜索：能搜到「我选的」之外的课（旁听、按老师找课）。 */
  search: 'https://classroom.zju.edu.cn/pptnote/v1/searchlist',
});
const query = (url, params) => `${url}?${new URLSearchParams(params)}`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const loginQueues = new Map();
function rows(value, label, field, parse) {
  return array(value, label, field).map((row, i) => {
    if (!object(row)) throw shape(label, `${field}[${i}]`);
    return parse(row, i + 1);
  });
}
function totalOf(value) {
  for (const name of ['total', 'totalCount', 'total_count', 'total-count']) {
    if (value?.[name] != null && Number.isSafeInteger(Number(value[name])) && Number(value[name]) >= 0) return Number(value[name]);
  }
  return null;
}
function result(items, { complete = true, reason = 'single-response', total = null, pages = 1, ...extra } = {}) {
  return { items, meta: { source: 'zw-classroom', fetchedAt: new Date().toISOString(), complete, reason, total, pages, version: digest(items), ...extra } };
}

export class ClassroomSource {
  constructor({ transport, sessionFile, protect, fetch, log, timeoutMs, maxPages = 20, pageSize = 100, onLogin, transcriber = null, dataDirectory = null, asrHome = null } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(pageSize) || pageSize < 1) throw new TypeError('分页限制须为正整数');
    this.transport = transport ?? new Transport({ session: new SessionStore({ file: sessionFile, protect }), fetch, log, timeoutMs });
    // 直播与回放共用同一次登录（同一个 transport），但各自成类：
    // 回放回答「已完成的那节课有什么」，直播回答「此刻在播什么」，语义不该混。
    this.live = new LiveSource({ transport: this.transport });
    this.maxPages = maxPages; this.pageSize = pageSize; this.ready = this.transport.session.load();
    /** 课件缓存（可选，见 `attachSlideCache`）。 */
    this.slideCache = null;
    /** 进行中的预取：`Map<lessonKey, Promise>`，用来避免同一节课重复下载。 */
    this.prefetching = new Map();
    /** 预取自己的中止控制器集合，`dispose` 时一次性取消。 */
    this.prefetchAbort = new Set();
    /**
     * 本地转写的识别内核（可选，见 `setTranscriber`）。
     *
     * **默认 null，并且不会自动回退到「假装转写成功」**：本包不含 sherpa-onnx
     * 运行库与 SenseVoice 模型（见 `asr.js` 文件头）。没注入时 `transcribeAudio`
     * 报 `DEPENDENCY_MISSING`，而不是返回空文本。
     */
    this.transcriber = transcriber;
    /** 本包的数据目录（课件缓存、诊断用的托管 FFmpeg 路径都从它推）。 */
    this.dataDirectory = dataDirectory;
    /** 语音模型的 DSH home；null 时诊断回退到 `process.env.DSH_HOME`。 */
    this.asrHome = asrHome;
    /** 进行中的实时字幕采集任务（`Map<scope, LiveCollector>`）。 */
    this.liveTasks = new Map();
    // 登录成功后的回调。用于把账号与会话交给**宿主凭据服务**，
    // 让 dsh-zhiyun-source-omni 不必再要一次同样的账号（见 index.js 的装配）。
    // 失败不影响登录本身 —— 课堂能用了，只是别的包还读不到。
    this.onLogin = onLogin ?? null;
  }
  async restoreSession(options = {}) {
    await this.ready;
    try { await this.listCourses(options); return { authenticated: true, user: await this.getCurrentUser() }; }
    catch (error) { if (error.code === 'SESSION_EXPIRED') return { authenticated: false, user: null }; throw error; }
  }
  async login(credentials, options = {}) {
    await this.ready;
    const account = createHash('sha256').update(String(credentials?.username ?? '')).digest('hex');
    const previous = Promise.allSettled([loginQueues.get(account) ?? Promise.resolve(), this.loginTask ?? Promise.resolve()]);
    const task = previous.then(async () => {
      options.signal?.throwIfAborted();
      if (!options.reuseSso) await this.transport.session.clear();
      await authenticate(this.transport, credentials, options);
      this.transport.session.accountKey = account;
      await this.transport.session.save();
      await this.listCourses(options);
      const user = await this.getCurrentUser({ connect: false });
      // 只在这个时刻把凭据交给宿主：用户刚刚亲口提供了账号，写下去是"记住我"，
      // 不是偷偷收集。失败只记日志，绝不回滚已成功的登录。
      if (this.onLogin) {
        try { await this.onLogin({ credentials, jar: this.transport.session.jar, user }); }
        catch (error) { this.transport.log?.(`[zw-classroom] 写入宿主凭据失败：${error?.message ?? error}`); }
      }
      return { authenticated: true, user };
    });
    loginQueues.set(account, task);
    this.loginTask = task;
    try { return await task; } finally { if (loginQueues.get(account) === task) loginQueues.delete(account); }
  }
  // 登出必须**立即**落盘：延迟写 + 进程退出 = 旧会话在磁盘上复活（安全问题）
  async logout() { await this.ready; this.transport.cancelAll(); await this.transport.session.clear({ persist: true }); }
  async getCurrentUser() {
    await this.ready;
    for (const host of ['interactivemeta.cmc.zju.edu.cn', 'yjapi.cmc.zju.edu.cn', 'education.cmc.zju.edu.cn', 'classroom.zju.edu.cn']) {
      const cookie = (await this.transport.session.jar.getCookies(`https://${host}/`)).find(c => c.key === 'JWTUser');
      if (!cookie) continue;
      try {
        const user = JSON.parse(decodeURIComponent(cookie.value));
        const id = user.sub ?? user.user_id ?? user.id;
        if (id != null) return { id: String(id), name: user.realname ?? user.real_name ?? null };
      } catch { /* User cookie may be malformed; no raw contents in errors. */ }
    }
    return null;
  }
  /**
   * 按关键词 / 教师名**搜索**课程 —— 用于找旁听课、或按老师找一门课。
   *
   * 与 `listCourses()` 的区别：那个只返回**我选的**课；这个能搜到全部可见课程。
   *
   * 端点要求带上当前用户的 `user_id` 与 `user_name`，所以必须先登录
   * （搜索结果是按"这个人能看到什么"过滤的，不是公开检索）。
   *
   * @param options.keyword - 课程名关键词。
   * @param options.teacher - 教师名。
   * @param options.page - 页码（从 1 开始，每页 16 条）。
   * @param options.signal - 中止信号。
   * @returns `{ courses, total, nextPage }`。
   */
  async searchCourses({ keyword = '', teacher = '', page = 1, signal } = {}) {
    await this.ready;
    const me = await this.getCurrentUser();
    if (!me?.id) {
      throw new ClassroomError('SESSION_EXPIRED', '搜索课程需要先登录智云课堂');
    }
    const perPage = 16;
    const data = await this.transport.json(
      query(ENDPOINTS.search, {
        tenant_id: 112,
        tenant_code: 112,
        user_id: me.id,
        user_name: me.name ?? '',
        page,
        per_page: perPage,
        title: String(keyword ?? ''),
        realname: String(teacher ?? ''),
        trans: '',
      }),
      '搜索课程',
      { signal },
    );

    const list = data?.total?.list;
    if (!Array.isArray(list)) {
      throw new ClassroomError('API_SHAPE', '智云课堂搜索结果缺少 total.list');
    }
    const total = Number(data.total?.total);
    const courses = list.map((row) => ({
      courseId: String(row?.course_id ?? row?.id ?? ''),
      title: String(row?.title ?? row?.course_title ?? '').trim(),
      teacher: row?.realname ? String(row.realname) : null,
      term: row?.term_name ? String(row.term_name) : null,
    })).filter((row) => row.courseId);

    const end = page * perPage;
    return {
      courses,
      total: Number.isFinite(total) ? total : null,
      nextPage: Number.isFinite(total) && end < total ? page + 1 : null,
    };
  }

  async listCourses({ signal } = {}) {
    await this.ready;
    const items = [], seen = new Set(), fingerprints = new Set();
    let total = null;
    for (let page = 1; page <= this.maxPages; page++) {
      const data = await this.transport.json(query(ENDPOINTS.courses, { nowpage: page, 'per-page': this.pageSize, force_mycourse: 1 }), '课程', { signal });
      const payload = data.params?.result;
      const raw = array(payload?.data, '课程', 'params.result.data');
      const parsed = rows(raw, '课程', 'data', models.course);
      total = totalOf(payload) ?? totalOf(payload?.pagination) ?? total;
      const fingerprint = digest(parsed.map(c => c.id));
      if (raw.length && fingerprints.has(fingerprint)) return result(items, { complete: total !== null && items.length >= total, reason: 'repeated-page', total, pages: page });
      fingerprints.add(fingerprint);
      for (const item of parsed) if (!seen.has(item.id)) { seen.add(item.id); items.push(item); }
      if (total !== null && items.length >= total) return result(items, { reason: 'total', total, pages: page });
      if (!raw.length) return result(items, { complete: total === null || items.length >= total, reason: 'empty-page', total, pages: page });
      if (total === null && raw.length < this.pageSize) return result(items, { complete: null, reason: 'short-page-unverified', pages: page });
    }
    return result(items, { complete: false, reason: 'page-limit', total, pages: this.maxPages });
  }
  async listLessons(courseId, { onlyPlayable = true, signal } = {}) {
    await this.ready; courseId = models.id(courseId);
    const data = await this.transport.json(query(ENDPOINTS.lessons, { course_id: courseId }), '节次', { signal });
    const items = rows(data.result?.data, '节次', 'result.data', models.lesson);
    return result(onlyPlayable ? items.filter(l => l.isPlayable) : items);
  }
  async getSlides(courseId, subId, { signal, onProgress } = {}) {
    await this.ready; courseId = models.id(courseId); subId = models.id(subId);
    const items = [], seen = new Set(), fingerprints = new Set(), records = new Set();
    let total = null, received = 0;
    for (let page = 1; page <= this.maxPages; page++) {
      const data = await this.transport.json(query(ENDPOINTS.slides, { course_id: courseId, sub_id: subId, page, per_page: this.pageSize }), 'PPT', { signal });
      const raw = array(data.list, 'PPT', 'list'); total = totalOf(data) ?? total;
      const fingerprint = digest(raw);
      if (raw.length && fingerprints.has(fingerprint)) return result(items, { complete: total !== null && received >= total, reason: 'repeated-page', total, pages: page, received });
      fingerprints.add(fingerprint);
      const parsed = rows(raw, 'PPT', 'list', models.slide);
      // Overlapping pages must not count the same upstream record twice toward
      // total, otherwise partial responses could be mislabeled complete.
      raw.forEach((row, index) => records.add(digest([row.old_id ?? row.id ?? null, parsed[index].createdSec, parsed[index].imageUrl])));
      received = records.size;
      for (const item of parsed) {
        // Preserve a repeated image at a different time: these are distinct events.
        const key = `${item.imageUrl}\u0000${item.createdSec}`;
        if (!seen.has(key)) { seen.add(key); items.push({ ...item, page: items.length + 1 }); }
      }
      onProgress?.({ phase: 'slides', completed: received, total });
      if (total !== null && received >= total) return result(items, { reason: 'total', total, pages: page, received });
      if (!raw.length) return result(items, { complete: total === null || received >= total, reason: 'empty-page', total, pages: page, received });
      if (total === null && raw.length < this.pageSize) return result(items, { complete: null, reason: 'short-page-unverified', pages: page, received });
    }
    return result(items, { complete: false, reason: 'page-limit', total, pages: this.maxPages, received });
  }
  /**
   * 站点字幕。
   *
   * `options.tolerateNoSpeech` 是给 `searchResources` 用的：当天的课课后才有字幕，
   * 上游对这类课次是**拒绝**（`未查询到语音数据`）而不是给空表。开这个开关时，
   * 那**一种**业务失败按空表处理；其余失败照抛。
   *
   * 判定必须在 transport 里做（那里能看到上游 `msg`），这里只把开关传下去。
   */
  async getSubtitles(courseId, subId, { signal, onProgress, tolerateNoSpeech = false } = {}) {
    await this.ready; models.id(courseId); subId = models.id(subId);
    const data = await this.transport.json(
      query(ENDPOINTS.subtitles, { sub_id: subId, format: 'json' }),
      '字幕',
      {
        signal,
        ...(tolerateNoSpeech
          ? { tolerate: (payload) => /未查询到语音数据|没有语音/.test(String(payload?.msg ?? payload?.message ?? '')) }
          : {}),
      },
    );
    // 被容忍的那一种：上游没有 list，按「0 句」返回，不是伪装成有数据。
    if (!Array.isArray(data.list)) {
      if (tolerateNoSpeech) return result([]);
      throw shape('字幕', 'list');
    }
    const items = rows(data.list, '字幕', 'list', row => rows(row.all_content, '字幕', 'all_content', models.subtitle))
      .flat().filter(s => s.text).sort((a, b) => a.startMs - b.startMs);
    onProgress?.({ phase: 'subtitles', completed: items.length, total: items.length });
    return result(items);
  }

  /**
   * 逐字稿：把字幕拼成**可翻页的纯文本**。
   *
   * # 为什么不复用 `getSubtitles` 的返回值直接拼
   *
   * 它拼了。但「要文本」和「要时间轴」是两个用法：
   *
   * - 时间轴（播放器跳转）要**每条**都带 `startMs`，越精确越好；
   * - 逐字稿（阅读、喂给 AI）要的是**可读的段落**，几十个时间戳把正文切碎反而难读。
   *
   * 所以这里给一个 `timestampEverySec` 旋钮：传 0 时每段都带时间戳（与原字幕一一对应）；
   * 传 60 时按分钟聚成块，只在块首标一次 —— 读数不变，行数骤降。
   *
   * # 分页是为了**不把整节课塞进一次响应**
   *
   * 一节 90 分钟的课约 3–5 万字。一次返回会撑爆调用方的上下文，
   * 所以用 `offset` / `maxCharacters` 切片，并给出 `nextOffset`，让调用方自己决定读多少。
   *
   * @param courseId - 课程 id。
   * @param subId - 节次 id。
   * @param options.offset - 从第几个字符开始（默认 0）。
   * @param options.maxCharacters - 本次最多返回多少字符（默认 16000）。
   * @param options.withTimestamps - 是否带时间戳（默认带）。
   * @param options.timestampEverySec - 时间戳聚合间隔；0 表示每段都标。
   * @param options.signal - 中止信号。
   * @returns `{ available, text, nextOffset, totalCharacters, segments, duration }`。
   */
  async getTranscript(courseId, subId, {
    offset = 0, maxCharacters = 16000, withTimestamps = true, timestampEverySec = 0, signal,
  } = {}) {
    const { items } = await this.getSubtitles(courseId, subId, { signal });
    const clock = (ms) => {
      const total = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    };

    if (!items.length) {
      return {
        available: false, text: '', nextOffset: null, totalCharacters: 0, segments: 0, duration: null,
      };
    }

    let full;
    if (timestampEverySec > 0) {
      const blocks = [];
      let block = -1;
      for (const item of items) {
        const line = String(item.text ?? '').trim();
        if (!line) continue;
        const index = Math.floor((item.startMs ?? 0) / (timestampEverySec * 1000));
        if (index !== block) {
          block = index;
          blocks.push(withTimestamps ? `[${clock(item.startMs ?? 0)}] ${line}` : line);
        } else {
          blocks[blocks.length - 1] += ` ${line}`;
        }
      }
      full = blocks.join('\n');
    } else {
      full = items
        .map((item) => (withTimestamps ? `[${clock(item.startMs ?? 0)}] ${item.text}` : item.text))
        .join('\n');
    }

    const last = items[items.length - 1];
    const duration = Number.isFinite(last?.endMs) ? clock(last.endMs) : null;
    const end = offset + maxCharacters;
    return {
      available: true,
      segments: items.length,
      duration,
      text: full.slice(offset, end),
      nextOffset: end < full.length ? end : null,
      totalCharacters: full.length,
    };
  }

  /**
   * 在录播字幕里搜关键词（对应上游 `zhiyun search subtitles`，审计 漏-5 / W-13）。
   *
   * # 为什么它必须存在
   *
   * 「老师有没有说点名」「考试范围讲到哪」这类问题，用字幕时间轴一条条读是读不动的：
   * 一学期几十节课、每节几百句。上游就是靠这个方法把问题压成「命中的那几句 +
   * 前后文」。
   *
   * # 两条输入路径
   *
   * - 给 `lessons`（`[{courseId, subId, date?}]`）时直接搜这些课次 —— 调用方手里
   *   已经有课次时不必再查一遍课表；
   * - 只给 `courseId` 时用 `getMyLectures({days})` 展开我最近的课次，跳过
   *   `upcoming`（还没上课的课次没有字幕）。
   *
   * # 没有字幕是正常情况，不是失败
   *
   * 当天的课课后才有字幕，站点对这类课次是**拒绝**（`未查询到语音数据`）。
   * 这里按「这一节没有字幕」记进 `lessonsWithoutCaptions` —— 那是用户要看到的
   * 事实（「这几节还没生成字幕」），不是要吞掉的错误。其余失败照抛。
   *
   * @param {object} [options]
   * @param {string} [options.keyword] - 关键词，几个说法用顿号或竖线分隔（如 `点名、签到`）。
   * @param {Array<{courseId: string|number, subId: string|number, date?: string, lesson?: number}>} [options.lessons] - 要搜的课次。
   * @param {string|number} [options.courseId] - 不给 `lessons` 时用它展开最近课次。
   * @param {number} [options.days] - 展开几天（1–14，默认 7）。
   * @param {number} [options.limit] - 最多回多少条命中（默认 100）。
   * @param {AbortSignal} [options.signal] - 中止信号。
   * @returns `{ keywords, lessonsSearched, lessonsWithoutCaptions, counts, total, hits, truncated? }`。
   */
  async searchCaptions({ keyword, lessons, courseId, days = 7, limit = 100, signal } = {}) {
    await this.ready;
    const keywords = splitPhrases(keyword);
    if (!keywords.length) {
      throw new ClassroomError('INVALID_INPUT', '需要 keyword（例如「点名」「考试范围」，几个说法用顿号分隔）。');
    }
    if (!Number.isInteger(limit) || limit < 1) throw new ClassroomError('INVALID_INPUT', 'limit 要是正整数');

    /** @type {Array<{courseId: string, subId: string, date: string|null, lesson: number}>} */
    let rows;
    if (Array.isArray(lessons) && lessons.length) {
      rows = lessons.map((row, index) => ({
        courseId: String(models.id(row?.courseId, '课程')),
        subId: String(models.id(row?.subId, '节次')),
        date: row?.date ? String(row.date) : null,
        lesson: Number.isInteger(row?.lesson) ? row.lesson : index + 1,
      }));
    } else {
      if (courseId == null) {
        throw new ClassroomError('INVALID_INPUT', '要么给 lessons（课次清单），要么给 courseId（它会展开最近 days 天的课次）。');
      }
      const { lectures } = await this.getMyLectures({ days, signal });
      const wanted = String(models.id(courseId, '课程'));
      rows = lectures
        // 还没上课的课次没有字幕；它们进 lessonsWithoutCaptions 只会误导。
        .filter((row) => !row.upcoming && row.courseId === wanted)
        .map((row, index) => ({ courseId: row.courseId, subId: row.subId, date: row.date, lesson: index + 1 }));
    }

    const clock = (ms) => {
      const total = Math.max(0, Math.floor(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      const pad = (n) => String(n).padStart(2, '0');
      return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    };

    const counts = Object.fromEntries(keywords.map((word) => [word, 0]));
    const hits = [];
    const withoutCaptions = [];
    let searched = 0;
    let total = 0;

    for (const row of rows) {
      signal?.throwIfAborted();
      const { items } = await this.getSubtitles(row.courseId, row.subId, { signal, tolerateNoSpeech: true });
      if (!items.length) {
        withoutCaptions.push(row.lesson);
        continue;
      }
      searched += 1;
      items.forEach((caption, index) => {
        const text = String(caption.text ?? '');
        const found = keywords.filter((word) => text.includes(word));
        if (!found.length) return;
        total += 1;
        for (const word of found) counts[word] += 1;
        if (hits.length >= limit) return;
        hits.push({
          lesson: row.lesson,
          courseId: row.courseId,
          subId: row.subId,
          date: row.date,
          at: clock(caption.startMs ?? 0),
          atMs: caption.startMs ?? 0,
          keywords: found,
          // 前后各一句：命中词常常是「点名」这种孤立的两三个字，
          // 只给那一句看不出老师到底在说什么。
          text: [items[index - 1]?.text, text, items[index + 1]?.text].filter(Boolean).join(' '),
        });
      });
    }

    return {
      keywords,
      lessonsSearched: searched,
      lessonsWithoutCaptions: withoutCaptions,
      counts,
      total,
      hits,
      ...(total > hits.length ? { truncated: true } : {}),
    };
  }

  /**
   * 按天列出「我的课」—— 与我本人课表相关的节次（含直播状态）。
   *
   * 与 `getSchedule()` 的区别：那个是**时间段**内的排课（可能含别人的课、
   * 以课程为单位），这个是以**我**为口径按天倒序取，且带上 `upcoming` 标记。
   *
   * @param options.date - 起始日（`YYYY-MM-DD`，默认今天，北京时间）。
   * @param options.days - 往前取几天（1–14，默认 1）。
   * @param options.signal - 中止信号。
   * @returns `{ from, to, lectures }`。
   */
  async getMyLectures({ date, days = 1, signal } = {}) {
    await this.ready;
    if (!Number.isInteger(days) || days < 1 || days > 14) {
      throw new ClassroomError('INVALID_INPUT', 'days 取 1–14');
    }
    const end = models.date(date ?? models.shanghaiDate());
    const shift = (day, delta) => {
      const at = new Date(`${day}T00:00:00+08:00`);
      at.setDate(at.getDate() + delta);
      return models.shanghaiDate(at);
    };
    const nowSec = Math.floor(Date.now() / 1000);
    const lectures = [];
    const seen = new Set();

    for (let i = 0; i < days; i += 1) {
      const day = shift(end, -i);
      const data = await this.transport.json(
        query(ENDPOINTS.myDay, { day }),
        '当天课程',
        { signal },
      );
      const groups = data?.list == null
        ? null
        : Array.isArray(data.list) ? data.list : Object.values(data.list);
      if (!groups) continue;
      for (const group of groups) {
        const courses = group?.course == null
          ? []
          : Array.isArray(group.course) ? group.course : Object.values(group.course);
        for (const row of courses) {
          const subId = String(row?.sub_id ?? '');
          if (!subId || seen.has(subId)) continue;
          seen.add(subId);
          const begin = Number(row?.course_begin ?? row?.class_begin);
          lectures.push({
            courseId: String(row?.id ?? row?.course_id ?? ''),
            courseTitle: String(row?.title ?? '').trim(),
            subId,
            teacher: row?.realname ? String(row.realname) : null,
            room: row?.room_name ? String(row.room_name) : null,
            beginsAt: Number.isFinite(begin) ? new Date(begin * 1000).toISOString() : null,
            date: day,
            ...(Number.isFinite(begin) && begin > nowSec ? { upcoming: true } : {}),
          });
        }
      }
    }

    lectures.sort((a, b) => String(b.beginsAt ?? b.date).localeCompare(String(a.beginsAt ?? a.date)));
    return { from: shift(end, -(days - 1)), to: end, lectures };
  }

  async getLessonContent(courseId, subId, options = {}) {
    const [slides, subtitles] = await Promise.all([this.getSlides(courseId, subId, options), this.getSubtitles(courseId, subId, options)]);
    /**
     * 给课件页补上缓存地址。
     *
     * 命中时多一个 `cacheUrl`（本机 `/zw-slides/<key>`），前端优先用它 —— 
     * 那是磁盘读取，翻页不再吃一次带签名的网络往返。未命中的页**没有**这个字段，
     * 前端回退到 `imageUrl`（原始签名地址），所以这条路径在缓存空着时行为和以前
     * 完全一致。
     *
     * 同时给每一页带上 `cacheKey`：它是"这张图的身份"（剥掉签名后的 URL 摘要），
     * 前端拿它去请求预取，不必自己算一遍摘要、也不必知道剥签名的规则。
     *
     * 补字段失败（索引损坏等）时**原样返回** —— 逐页补是加速手段，
     * 不能因为它把"打开一节课"变成报错。
     */
    let decorated = slides;
    if (this.slideCache) {
      try {
        decorated = { ...slides, items: await this.slideCache.decorate(slides.items) };
      } catch (error) {
        this.transport.log?.(`[zw-classroom] 课件缓存信息补全失败，改用原始地址：${error?.message ?? error}`);
      }
    }
    /**
     * 后台把这一节的课件补齐。
     *
     * # 为什么是"读完再补"而不是"读之前先补"
     *
     * 先补等于让用户对着空屏等 83 页下载完 —— 缓存是加速手段，不能变成前置门禁。
     * 现在这样：第一次打开照旧用网络图（有图可看），补完之后**同一节课的后续
     * 翻页**全部走本地。用户真正感知到的改善发生在第二次打开和之后的每一次翻页。
     *
     * 三个必须的约束：
     *
     *   - **不 await**，失败只记日志：补不齐是常态（网络抖动），不该冒泡成"读课件失败"。
     *   - **按节去重**：`prefetching` 里已有这个 key 就不再发 —— 翻页、切栏、重渲染
     *     都会重复调 `getLessonContent`，不去重就是一节课下十几遍。
     *   - **不跟调用方的 signal**：那个 signal 是"这次读请求"的，读完就该结束了，
     *     拿它去中断预取会让每次只补到一半。
     */
    this.prefetchInBackground(courseId, subId, slides.items);
    return { sourceId: models.lessonKey(courseId, subId), courseId: String(courseId), subId: String(subId), slides: decorated, subtitles,
      slidesProcessingSuspected: subtitles.items.length > 50 && slides.items.length <= 2 };
  }
  async getSchedule({ start = models.shanghaiDate(), end = start, userId, signal } = {}) {
    await this.ready; models.date(start); models.date(end);
    if (end < start) throw new TypeError('结束日期早于开始日期');
    if ((Date.parse(end) - Date.parse(start)) / 86400000 >= 31) throw new TypeError('单次课表窗口不能超过 31 天');
    userId ??= (await this.getCurrentUser())?.id;
    if (!userId) throw new ClassroomError('SESSION_EXPIRED', '会话缺少课表所需用户标识');
    const data = await this.transport.json(query(ENDPOINTS.schedule, { user_id: userId, tenant_id: '112', start_at: start, end_at: end }), '课表', { signal });
    const payload = data.result;
    if (object(payload) && payload.list == null && payload.code != null && /课表/.test(String(payload.msg)) && /空/.test(String(payload.msg))) return result([], { reason: 'explicit-empty' });
    const items = rows(payload?.list, '课表', 'result.list', row => ({ day: models.date(row.day),
      courses: rows(row.course, '课表', 'course', models.scheduleEntry).sort((a, b) => a.startAt - b.startAt) })).sort((a, b) => a.day.localeCompare(b.day));
    return result(items);
  }
  /**
   * 「这场比赛有哪些资源」—— **只看不下载**（对应上游 `zhiyun search resources`）。
   *
   * # 为什么不直接读 `lesson.resources`
   *
   * `models.lesson()` 已经给出「有没有回放、课件叫什么」，但那是**课次响应里的
   * 那一段**，没有种类标签，也不含课堂截图与字幕句数 —— 后两者要另外请求。
   * 上游的做法就是把它们拼成同一个带 `kind` 的数组（`cli.ts:73-93`）。
   *
   * # `kind` 决定要不要发额外请求
   *
   * 只问 `video` 时**不该**因为「顺便」去拉一遍 83 页 PPT 和整份字幕。
   * 所以 `slides` / `subtitles` 的计数是**按需**取的：
   *
   *   - `slides` 走 `getSlides`（分页，可能好几次往返）；
   *   - `subtitles` 走 `getSubtitles`，并且**吞掉「还没有语音数据」这一种**
   *     —— 当天的课本来就是课后才有字幕，把它当成整条命令失败，
   *     会让「只想看看这节有没有回放」变成报错。**只吞这一种**，其余照抛。
   *
   * # `audio` 缺独立音轨时的那一条
   *
   * 上游会补 `{kind:'audio', source:'下载时从视频里提取'}`。本仓没有落地的
   * 视频→音频压制链路，所以这里给的是 `available:false` 的说明项 ——
   * 报一个下不下来的地址比报「没有」更糟。
   *
   * @param {string} courseId
   * @param {string} subId
   * @param {object} [options]
   * @param {string|string[]} [options.kind] - `video,audio,ppt,slides,subtitles` 或 `all`（默认）。
   * @param {AbortSignal} [options.signal]
   * @returns {Promise<{courseId, subId, title, playable, kinds:string[], resources:object[], meta}>}
   */
  async searchResources(courseId, subId, { kind, signal } = {}) {
    await this.ready;
    courseId = models.id(courseId, '课程'); subId = models.id(subId, '节次');
    const wanted = parseKinds(kind);
    const data = await this.transport.json(query(ENDPOINTS.lessons, { course_id: courseId }), '节次', { signal });
    const lessons = rows(data.result?.data, '节次', 'result.data', models.lesson);
    // 用 subId 精确定位：只按「第几次课」定位在上游是另一套编号，容易错一课。
    const lesson = lessons.find((item) => item.subId === subId);
    if (!lesson) throw new ClassroomError('NOT_FOUND', '该课次不属于这门课', { courseId, subId });

    const resources = [];
    const seen = new Set();
    for (const asset of assetsOf(lesson)) {
      // `ppt` 与 `video` / `audio` 都受 `kind` 约束：只要 `slides` 时不返回视频条目。
      if (!wanted.includes(asset.kind)) continue;
      const identity = `${asset.kind}\u0000${asset.url}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      resources.push({ ...asset, available: true });
    }
    if (wanted.includes('audio') && !resources.some((item) => item.kind === 'audio')) {
      const notice = extractedAudioNotice();
      if (!seen.has(`audio\u0000${notice.url}`)) resources.push(notice);
    }
    if (wanted.includes('slides')) {
      const slides = await this.getSlides(courseId, subId, { signal });
      resources.push({ kind: 'slides', name: '课堂截图', available: slides.items.length > 0, count: slides.items.length });
    }
    if (wanted.includes('subtitles')) {
      // 当天的课要点播之后才有字幕：上游对这类课次是**拒绝**而不是空表。
      // 只把这一种当「0 句」（判定在 transport 层，那里看得到上游 msg），
      // 其余照抛 —— 把网络错误吞成「没有字幕」会让人白等到下课。
      const subtitles = await this.getSubtitles(courseId, subId, { signal, tolerateNoSpeech: true });
      const count = subtitles.items.length;
      resources.push({ kind: 'subtitles', name: '站点字幕', available: count > 0, count });
    }
    return {
      courseId,
      subId,
      title: lesson.title,
      playable: lesson.isPlayable,
      kinds: wanted,
      resources,
      meta: { source: 'zw-classroom', fetchedAt: new Date().toISOString(), version: digest(resources) },
    };
  }

  /**
   * 本地组件诊断（对应上游 `zhiyun check`）。
   *
   * **只读**：不装任何东西、不下模型、不写文件。
   *
   * 上游的 `zhiyun setup`（`setup.ts`，`npm install ffmpeg-static` + 下 240 MB 模型）
   * 是**写操作**，不在本包的只读面上 —— 理由与替代路径写在 README「已知限制」。
   *
   * @param {string|string[]} [component] - `'asr'` / `'media'` / `'all'`（默认）。
   * @returns {Promise<{component:string, available:boolean, results:object[]}>}
   */
  async check(component = 'all', options = {}) {
    return checkComponents(component, {
      dataDirectory: this.dataDirectory,
      ...(this.asrHome === null ? {} : { home: this.asrHome }),
      ...options,
    });
  }

  /**
   * 本地组件的安装**计划**（对应上游 `zhiyun setup`，但只给计划不执行）。
   *
   * # 为什么只给计划
   *
   * 上游 `setup.ts` 是两件**写操作**：`npm install ffmpeg-static@5.3.0`
   * 与从 HuggingFace 下约 241 MB 权重（`ASR_TOTAL_BYTES = 241357257`）。
   * 前者本仓硬禁止（见 `docs/contributing/AGENTS.md` 的依赖规则），
   * 后者属安装层（裁决 N-3）。**硬做就是造假** —— 装不上却报装好了，
   * 用户会以为能用，直到真的去转写才失败。
   *
   * # 但「什么都不给」也不行
   *
   * `check()` 只说缺 `model.int8.onnx`，用户不知道那是哪个文件、放哪个目录、
   * 多大、下完怎么校验。所以这里给出每一步的**确切信息**：
   * 目标路径、下载 URL（含镜像）、字节数、SHA-256。用户照着自己装即可。
   *
   * # `executed` 恒为 `false`
   *
   * 这不是「暂时返回 false，以后会真装」，而是**契约**：这个方法永远不执行
   * 任何安装步骤。有测试钉住（谎报 `true` 会红）—— 因为一个会撒谎的
   * 「装好了」比「没装」危险得多。
   *
   * 已就位的组件标 `satisfied: true`，避免用户重下 241 MB。
   *
   * @param {string|string[]} [component] - `'asr'` / `'media'` / `'all'`（默认）。
   * @returns {Promise<{component:string, executed:false, steps:object[]}>}
   */
  async setupPlan(component = 'all') {
    return planLocalSetup(component, {
      ...(this.dataDirectory ? { dataDirectory: this.dataDirectory } : {}),
      ...(this.asrHome ? { home: this.asrHome } : {}),
    });
  }

  /**
   * 注入本地转写的识别内核。
   *
   * 形状：`({file, directory, signal}) => Promise<{segments:[{start,end,text}], engine?}>`
   * （`start` / `end` 单位秒）。传对象也行：只要有 `transcribe` 方法。
   *
   * 为什么是注入而不是内置：本包不含 `sherpa-onnx-node` 与 SenseVoice 模型
   * （见 `asr.js` 文件头）。返回撤销函数，方便宿主卸载时还原。
   */
  setTranscriber(transcriber) {
    const previous = this.transcriber;
    this.transcriber = transcriber ?? null;
    return () => { if (this.transcriber === (transcriber ?? null)) this.transcriber = previous; };
  }

  /**
   * 本地音视频转写（对应上游 `zhiyun trans audio`）。
   *
   * # 代价（必须让调用方看见）
   *
   * 上游实测：一节 148 分钟的录播在 CPU 上要跑**几分钟**，模型首次下载约 **240 MB**。
   * 所以这个方法是本包**唯一**一个「分钟级」的调用，默认上限 30 分钟，
   * 并且必须能被 `signal` 取消。转写期间不要在同一线程上等 UI。
   *
   * # 落盘归本包
   *
   * D17：写自己的数据目录不算写上游。产物在 `directory` 下
   * （`segments.json` / `transcript.txt` / `transcript.md` / `transcribe.json`），
   * 中间 WAV 在 `finally` 里删掉 —— 一节课近 300 MB。
   *
   * @param {object} options
   * @param {string} options.file - 本地音视频的**绝对路径**。
   * @param {string} options.directory - 输出目录的**绝对路径**。
   * @param {AbortSignal} [options.signal]
   * @param {number} [options.timeoutMs] - 默认 `DEFAULT_TRANSCRIBE_TIMEOUT_MS`（30 分钟）。
   * @returns `{directory, markdown, segments, text, totalCharacters, durationMs, engine, reused, bytes}`
   */
  async transcribeAudio({ file, directory, signal, timeoutMs = DEFAULT_TRANSCRIBE_TIMEOUT_MS } = {}) {
    await this.ready;
    return transcribeFile(this.transcriber, {
      file,
      directory,
      signal,
      timeoutMs,
      engine: typeof this.transcriber?.engine === 'string' ? this.transcriber.engine : null,
    });
  }

  /**
   * 开始采一节课的**官方实时字幕**（`zhiyun live start`）。
   *
   * ⚠️ 语义与其余方法**不同**，见 `live-caption.js` 文件头的长说明。要点：
   *
   *   - 这是**长连接（HTTP comet 长轮询）**，不是请求-响应；
   *   - `liveStart` **只建立会话**：起后台循环后立刻返回，**不**等到收到第一条字；
   *   - 生命周期由本包管：`liveStatus` 观察、`liveStop` 结束、`dispose()` 兜底；
   *   - **进程退出 = 采集停止**（没有上游那种脱离进程的守护进程）。
   *
   * 同一范围（courseId+subId 集合）重复调用返回**同一个任务**，不重复发请求。
   *
   * @param {object} options
   * @param {string} options.courseId
   * @param {string} options.subId
   * @param {string} [options.title] - 只用于展示。
   * @param {string} [options.room]
   * @param {number} [options.startsAt] - 开课时间（毫秒）。缺省按「现在」处理。
   * @param {number} [options.endsAt] - 下课时间（毫秒）。缺省为「开课后 2 小时」。
   * @returns {Promise<object>} 与 `liveStatus()` 同形状。
   */
  async liveStart({ courseId, subId, title = '', room = null, startsAt, endsAt } = {}) {
    await this.ready;
    courseId = models.id(courseId, '直播课程'); subId = models.id(subId, '直播节次');
    const begin = Number.isFinite(startsAt) ? Number(startsAt) : Date.now();
    const finish = Number.isFinite(endsAt) ? Number(endsAt) : begin + 2 * 3600000;
    if (finish <= begin) throw new ClassroomError('INVALID_INPUT', '下课时间须晚于开课时间');
    const scope = `${courseId}:${subId}`;
    const existing = this.liveTasks.get(scope);
    if (existing && !['stopped', 'ended', 'failed'].includes(existing.status)) {
      return { ...existing.statusView(), reused: true };
    }
    const collector = new LiveCollector({
      live: this.live,
      lessons: [{ courseId, subId, title, room, startsAt: begin, endsAt: finish }],
      log: (event) => this.transport.log?.(`[zw-classroom] live ${JSON.stringify(event)}`),
    });
    this.liveTasks.set(scope, collector);
    collector.start();
    return { ...collector.statusView(), reused: false };
  }

  /**
   * 实时字幕采集的状态（`zhiyun live status`）。
   *
   * **纯本地**：不联网、不改状态。`receiving` 显式区分「连上了」和「真的收到字了」——
   * 这两件事在用户眼里是一句话，在协议上是两回事。
   *
   * @param {object} [options]
   * @param {string} [options.courseId]
   * @param {string} [options.subId] - 不传时返回所有任务。
   */
  liveStatus({ courseId, subId } = {}) {
    if (courseId != null || subId != null) {
      const scope = `${models.id(courseId, '直播课程')}:${models.id(subId, '直播节次')}`;
      const collector = this.liveTasks.get(scope);
      if (!collector) return { status: 'not-running', message: '这节课没有正在进行的字幕采集。', lessons: [], sentences: 0, receiving: false };
      return collector.statusView();
    }
    const tasks = [...this.liveTasks.values()];
    if (!tasks.length) {
      return { status: 'not-running', message: '尚未启动实时字幕采集。', tasks: [], lessons: [], sentences: 0, receiving: false };
    }
    return {
      status: tasks.some((task) => task.status === 'running') ? 'running' : tasks[0].status,
      tasks: tasks.map((task) => task.statusView()),
      lessons: tasks.flatMap((task) => task.statusView().lessons),
      sentences: tasks.reduce((sum, task) => sum + task.statusView().sentences, 0),
      receiving: tasks.some((task) => task.statusView().receiving),
    };
  }

  /**
   * 停止采集（`zhiyun live stop`）。**已收到的字不删**，只是不再继续收。
   *
   * @returns {Promise<object>} 停止后的状态快照。
   */
  async liveStop({ courseId, subId } = {}) {
    if (courseId != null || subId != null) {
      const scope = `${models.id(courseId, '直播课程')}:${models.id(subId, '直播节次')}`;
      const collector = this.liveTasks.get(scope);
      if (!collector) return { status: 'not-running', message: '这节课没有正在进行的字幕采集。', lessons: [], sentences: 0, receiving: false };
      const view = await collector.stop();
      this.liveTasks.delete(scope);
      return view;
    }
    const views = [];
    for (const [scope, collector] of [...this.liveTasks]) {
      views.push(await collector.stop());
      this.liveTasks.delete(scope);
    }
    return {
      status: 'stopped',
      tasks: views,
      lessons: views.flatMap((view) => view.lessons),
      sentences: views.reduce((sum, view) => sum + view.sentences, 0),
      receiving: false,
    };
  }

  /**
   * 取窗口内的**已收**文字（`zhiyun live text`）。
   *
   * 与上游的差别：**不等待未来**。上游 `liveText` 会为 `--after` 阻塞到点
   * （`live-task.ts:186-194`），那是 CLI 的一次性语义；本包是长驻服务，
   * 阻塞式等待会把宿主的一个请求挂上几分钟。未来部分由 `pending` 标出来，
   * 调用方自己决定要不要再查一次。
   *
   * @param {object} [options]
   * @param {string} [options.courseId]
   * @param {string} [options.subId]
   * @param {number} [options.at] - 窗口中心（毫秒），默认现在。
   * @param {number} [options.before] - 往前多少毫秒，默认 5 分钟。
   * @param {number} [options.after] - 往后多少毫秒，默认 0。
   * @returns 窗口结果；多课次命中时报 `INVALID_INPUT` 并在 details 里给候选。
   */
  liveText({ courseId, subId, at, before = 5 * 60000, after = 0 } = {}) {
    if (courseId != null || subId != null) {
      const scope = `${models.id(courseId, '直播课程')}:${models.id(subId, '直播节次')}`;
      const collector = this.liveTasks.get(scope);
      if (!collector) {
        return { status: 'unavailable', message: '这节课没有正在进行的字幕采集。', text: '', segments: [], gaps: [] };
      }
      return collector.text({ at, before, after });
    }
    const tasks = [...this.liveTasks.values()];
    if (!tasks.length) {
      return { status: 'unavailable', message: '尚未启动实时字幕采集。', text: '', segments: [], gaps: [] };
    }
    // 多任务时逐个试：某个窗口只对应一个任务才不会歧义。
    const hits = [];
    const misses = [];
    for (const task of tasks) {
      try { hits.push(task.text({ at, before, after })); } catch (error) { misses.push(error); }
    }
    const live = hits.filter((hit) => hit.status !== 'unavailable');
    if (live.length === 1) return live[0];
    if (live.length > 1) {
      throw new ClassroomError('INVALID_INPUT', '文字窗口对应多个课次，请指定课程或缩小时间范围', {
        candidates: live.map((hit) => ({ course: hit.course, window: hit.window })),
      });
    }
    if (hits.length === 1) return hits[0];
    throw misses[0] ?? new ClassroomError('INVALID_INPUT', '文字窗口没有对应的采集任务');
  }

  async downloadResource(options) { await this.ready; return download(this.transport, options); }

  /**
   * 挂上课件缓存。
   *
   * 注入而不是构造时必填：缓存是**可选加速**，没有它回放和解析必须照常能用。
   * 一旦挂上，`getLessonContent` 就会给每一页补 `cacheKey` / `cacheUrl`，
   * 前端据此优先走本地文件、未命中再退回原始签名地址。
   *
   * @param {import('./slide-store.js').SlideCache} cache
   */
  attachSlideCache(cache) {
    this.slideCache = cache ?? null;
    return this;
  }

  /**
   * 后台补齐一节课件（去重、不抛错、不阻塞）。
   *
   * @param {string} courseId
   * @param {string} subId
   * @param {Array<object>} slides - 已经拿到的课件页，直接复用，不再请求一次列表。
   */
  prefetchInBackground(courseId, subId, slides) {
    if (!this.slideCache) return null;
    if (!Array.isArray(slides) || slides.length === 0) return null;
    const key = models.lessonKey(courseId, subId);
    const pending = this.prefetching.get(key);
    if (pending) return pending;
    // 预取用的是**自己的** controller：调用方读到内容就返回了，
    // 生命周期与预取无关（`dispose` 会一次性取消全部）。
    const controller = new AbortController();
    this.prefetchAbort.add(controller);
    const task = (async () => {
      try {
        const result = await this.slideCache.ensureSlides(slides, { signal: controller.signal });
        this.transport.log?.(`[zw-classroom] 课件缓存 ${key}：新增 ${result.downloaded}，命中 ${result.skipped}，失败 ${result.failed}`);
        return result;
      } catch (error) {
        this.transport.log?.(`[zw-classroom] 课件缓存 ${key} 中断：${error?.message ?? error}`);
        return null;
      } finally {
        this.prefetchAbort.delete(controller);
        this.prefetching.delete(key);
      }
    })();
    this.prefetching.set(key, task);
    return task;
  }

  /**
   * 把一节课的课件页**预取**进缓存。
   *
   * 与 `getLessonContent` 分开，是因为两者节奏不同：读页面要立刻返回（先给
   * 原始 URL 让它马上有图可看），预取可以慢慢在后台把剩下的页补齐 ——
   * 用户真正翻到那一页时，图已经在磁盘上了。
   *
   * @returns `{ downloaded, skipped, failed, total }`；没有缓存时全为 0。
   */
  async prefetchSlides(courseId, subId, { signal, onProgress } = {}) {
    if (!this.slideCache) return { downloaded: 0, skipped: 0, failed: 0, total: 0, cached: false };
    const slides = await this.getSlides(courseId, subId, { signal });
    return { ...await this.slideCache.ensureSlides(slides.items, { signal, onProgress }), cached: true };
  }

  async downloadSlides(courseId, subId, { directory, concurrency = 6, signal, onProgress } = {}) {
    if (!path.isAbsolute(directory ?? '')) throw new TypeError('图片目录须为绝对路径');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new TypeError('图片并发须为 1–8');
    const slides = await this.getSlides(courseId, subId, { signal });
    const results = new Array(slides.items.length); let cursor = 0, completed = 0;
    const worker = async () => {
      while (cursor < slides.items.length && !signal?.aborted && !this.transport.closed) {
        const index = cursor++, slide = slides.items[index];
        // Fixed safe names with content identity; never use URL-supplied paths.
        const name = `${String(index + 1).padStart(4, '0')}-${digest([slide.imageUrl, slide.createdSec]).slice(0, 12)}.jpg`;
        try { results[index] = { page: slide.page, ok: true, ...await this.downloadResource({ url: slide.imageUrl, destination: path.join(directory, name), signal, maxBytes: 50 * 1024 * 1024 }) }; }
        catch (error) { results[index] = { page: slide.page, ok: false, code: error.code ?? 'DOWNLOAD' }; }
        completed++; onProgress?.({ phase: 'download-slides', completed, total: slides.items.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, slides.items.length) }, worker));
    if (signal?.aborted || this.transport.closed) throw new ClassroomError('CANCELLED', '图片下载已取消');
    return { results, succeeded: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, sourceMeta: slides.meta };
  }
  async dispose() {
    /**
     * 先掐掉预取，并**等它们真的收手**。
     *
     * 只 `abort()` 不 `await` 是不够的：`abort` 只是把信号翻成 aborted，正在写
     * 磁盘的那一次 `writeFile` 还会继续跑完。宿主退出后这些写操作会落在已被删除
     * 的目录上（`ENOTEMPTY` / `ENOENT` 噪声），更糟的是它们持有 transport ——
     * 下面 `transport.close()` 会把正在进行的请求打断成错误日志。
     *
     * `allSettled` 而不是 `all`：某个预取自己炸掉不该阻止退出。
     */
    const pending = [...this.prefetching.values()];
    for (const controller of this.prefetchAbort) controller.abort();
    this.prefetchAbort.clear();
    this.prefetching.clear();
    /**
     * 实时字幕的采集循环也必须**先停干净**再关 transport。
     *
     * 只 abort 不 await 是不够的：轮询循环正在 `await post()`，它握着的
     * 就是这个 transport —— 下面 `close()` 会把它打断成一条无主错误，
     * 而且 `u<uid>&cl` 退订请求根本发不出去，服务端会留着那路订阅。
     *
     * 顺序反过来（先 close 再 stop）等于让 stop 里的退订必然失败。
     */
    const live = [...this.liveTasks.values()];
    this.liveTasks.clear();
    for (const collector of live) {
      try { await collector.stop(); } catch (error) { this.transport.log?.(`[zw-classroom] 停止实时字幕失败：${error?.message ?? error}`); }
    }
    await Promise.allSettled(pending);
    this.transport.close();
    await this.ready;
    await this.transport.session.pending;
  }
}

/**
 * 把「几个说法」拆成关键词表。
 *
 * 用户会写「点名、签到」「点名|签到」或一行一个；这里统一按那几种分隔符切，
 * 去空白、按归一化后的写法去重（全角/大小写差异不该算两个关键词）。
 *
 * 与上游 `core/match.ts` 的 `splitPhrases` 同一口径 —— 分隔符是照着它抄的，
 * 少一种就会让「、」这种中文习惯写法整串不拆。
 *
 * @param {string} raw - 原始输入。
 * @returns {string[]} 关键词（保序、去重）。
 */
export function splitPhrases(raw) {
  const seen = new Set();
  return String(raw ?? '')
    .split(/[|｜、，,；;\n]+/)
    .map((word) => word.trim())
    .filter((word) => {
      if (!word) return false;
      const key = word.normalize('NFKC').toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
