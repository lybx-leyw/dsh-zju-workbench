import { createHash } from 'node:crypto';
import path from 'node:path';
import { Transport } from './transport.js';
import { SessionStore } from './session.js';
import { authenticate, inspectJwt, jwtFromTokenCookie } from './auth.js';
import { LiveSource } from './live.js';
import { ClassroomError, array, object, shape } from './errors.js';
import * as models from './models.js';
import { download } from './download.js';
export { ClassroomError } from './errors.js';
export { SessionStore } from './session.js';
export { Transport } from './transport.js';
export { LiveSource } from './live.js';

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
  return { items, meta: { source: 'zhiyun-classroom', fetchedAt: new Date().toISOString(), complete, reason, total, pages, version: digest(items), ...extra } };
}

export class ClassroomSource {
  constructor({ transport, sessionFile, protect, fetch, log, timeoutMs, maxPages = 20, pageSize = 100, onLogin } = {}) {
    if (!Number.isInteger(maxPages) || maxPages < 1 || !Number.isInteger(pageSize) || pageSize < 1) throw new TypeError('分页限制须为正整数');
    this.transport = transport ?? new Transport({ session: new SessionStore({ file: sessionFile, protect }), fetch, log, timeoutMs });
    // 直播与回放共用同一次登录（同一个 transport），但各自成类：
    // 回放回答「已完成的那节课有什么」，直播回答「此刻在播什么」，语义不该混。
    this.live = new LiveSource({ transport: this.transport });
    this.maxPages = maxPages; this.pageSize = pageSize; this.ready = this.transport.session.load();
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
        catch (error) { this.transport.log?.(`[zhiyun-classroom] 写入宿主凭据失败：${error?.message ?? error}`); }
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
  async getSubtitles(courseId, subId, { signal, onProgress } = {}) {
    await this.ready; models.id(courseId); subId = models.id(subId);
    const data = await this.transport.json(query(ENDPOINTS.subtitles, { sub_id: subId, format: 'json' }), '字幕', { signal });
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
    return { sourceId: models.lessonKey(courseId, subId), courseId: String(courseId), subId: String(subId), slides, subtitles,
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
  async downloadResource(options) { await this.ready; return download(this.transport, options); }
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
  async dispose() { this.transport.close(); await this.ready; await this.transport.session.pending; }
}
