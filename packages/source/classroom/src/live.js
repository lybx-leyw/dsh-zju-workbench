import { createHash } from 'node:crypto';
import { ClassroomError, array, object, shape } from './errors.js';
import { jwtFromTokenCookie } from './auth.js';
import * as models from './models.js';

// 直播与回放是两条互不相交的通路：回放走 course/catalogue 与已录制资源（source.js），
// 直播要走 live-course 网关，还要按「时段」把此刻在上的课挑出来。
// 两者混在一个类里会让「已完成」和「此刻在线」的语义互相污染，所以独立成类；
// 但登录态仍用调用方的 transport —— 同一次登录不该存在第二份 cookie。
export const liveEndpoints = Object.freeze({
  // 两个 base：课程列表与取流地址在 classroom，流详情在 yjapi。两者的成功码都是字符串 '0'。
  courses: 'https://classroom.zju.edu.cn/courseapi/v2/course-live/search-live-course-list',
  streams: 'https://yjapi.cmc.zju.edu.cn/courseapi/v2/course-live/search-live-course-list',
  screenstream: 'https://classroom.zju.edu.cn/courseapi/index.php/v2/meta/getscreenstream',
});

// 浙大在智云上只有一个租户号；写成常量而不是散在参数表里，避免各处抄错。
const TENANT = 112;
const query = (url, params) => `${url}?${new URLSearchParams(params)}`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// models.js 的规范化小工具是模块私有的；本任务不改其他文件，这里只补直播用得到的三个。
const str = v => v == null ? '' : String(v);
const optional = v => v == null || v === '' ? null : String(v);
const integer = v => Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : 0;

function rows(value, label, field, parse) {
  return array(value, label, field).map((row, i) => {
    if (!object(row)) throw shape(label, `${field}[${i}]`);
    return parse(row, i + 1);
  });
}
function result(items, { complete = true, reason = 'single-response', total = null, pages = 1, ...extra } = {}) {
  return { items, meta: { source: 'zhiyun-classroom', fetchedAt: new Date().toISOString(), complete, reason, total, pages, version: digest(items), ...extra } };
}
// 上游把成功码写成字符串 '0'，不是 HTTP 200。数字 0 一并认，其余任何值都按失败处理：
// 把未知状态读成「当天没有课」比抛错难查得多。
function liveList(data, label) {
  if (String(data.code ?? '') !== '0') throw new ClassroomError('BUSINESS', `${label}请求未成功`, { label });
  return array(data.list, label, 'list');
}

const M3U8 = /\.m3u8(?:[?#]|$)|format=m3u8|type=m3u8/i;
const FLV = /\.flv(?:[?#]|$)|format=flv|type=flv|http-?flv/i;
const IMAGE = /\.(?:png|jpe?g|gif|webp|bmp|svg)(?:[?#]|$)/i;
const PUSH_HOST = /mcloudpush\.cmc\.zju\.edu\.cn$/i;
const URL_SCHEME = /^(?:https?|rtmp|webrtc|wss?):\/\//i;
// 只有这三种能直接播；mp4/image/webrtc/unknown 一律进 dropped，不静默吞掉。
const PLAYABLE = new Set(['hls', 'flv', 'rtmp']);

function parseUrl(raw) { try { const url = new URL(raw); return url.hostname ? url : null; } catch { return null; } }
function hostOf(raw) { return parseUrl(str(raw).trim())?.hostname ?? null; }

// 判定顺序照抄上游实网逻辑：先协议头，再 m3u8/flv，最后才是推送域名与静态文件。
// 顺序一换就会把查询串里带 .flv 的 webrtc 地址读成 flv。
export function mediaType(url) {
  const raw = str(url).trim();
  if (!raw) return 'unknown';
  if (/^rtmp:\/\//i.test(raw)) return 'rtmp';
  if (/^webrtc:\/\//i.test(raw) || /webrtc|rtc|sdp/i.test(raw)) return 'webrtc';
  if (M3U8.test(raw)) return 'hls';
  if (FLV.test(raw)) return 'flv';
  const target = parseUrl(raw);
  if (target && PUSH_HOST.test(target.hostname) && target.pathname.startsWith('/live/')) return 'flv';
  if (/\.mp4(?:[?#]|$)/i.test(raw)) return 'mp4';
  if (IMAGE.test(raw)) return 'image';
  return 'unknown';
}
// 机位只区分到「教师 / 屏幕 / 学生 / 其他」四路：再细就得靠上游给标签，名字里没有。
// stream_type 与 type 是两套编号，同一个机位在两条通路上落在不同字段，所以都看。
export function cameraKey(name, streamType, type) {
  const label = str(name).toLowerCase();
  if (/教师/.test(label) || streamType === 3) return 'teacher';
  if (/ppt|屏幕|白板|板书/.test(label) || type === 1 || type === 2) return 'screen';
  if (/学生|教室/.test(label) || type === 4) return 'student';
  return 'extra';
}

function streamOf(entry) {
  const url = str(entry.url).trim();
  return { key: cameraKey(entry.name, integer(entry.streamType), integer(entry.type)),
    label: optional(str(entry.name).trim()), type: mediaType(url), host: hostOf(url), watchUrl: url, recordUrl: url };
}
// 同一路流会在 sub_content 的多个字段里重复出现；watchUrl 与 recordUrl 同源，
// 所以三者一起做身份：不会把不同机位合成一条，也不会把同一机位算两遍。
function pack(entries) {
  const streams = [], dropped = [], seen = new Set(), droppedSeen = new Set();
  for (const entry of entries) {
    const stream = streamOf(entry);
    if (!PLAYABLE.has(stream.type)) {
      // dropped 只留安全元数据（key/label/type/host），不回传 URL 本体。
      const identity = `${stream.key}\u0000${stream.type}\u0000${stream.host}`;
      if (!droppedSeen.has(identity)) { droppedSeen.add(identity); dropped.push({ key: stream.key, label: stream.label, type: stream.type, host: stream.host }); }
      continue;
    }
    const identity = `${stream.key}\u0000${stream.watchUrl}\u0000${stream.recordUrl}`;
    if (seen.has(identity)) continue;
    seen.add(identity); streams.push(stream);
  }
  return { streams, dropped, source: 'live' };
}

// sub_content 会把下一层 JSON 再编码成字符串；遇到的字符串先试着当 JSON 拆，
// 否则嵌套里的流地址永远遍历不到。
function collect(value, name, out, depth = 0) {
  if (depth > 6 || out.length >= 32) return;
  if (typeof value === 'string') {
    const nested = models.embedded(value);
    if (nested) return collect(nested, name, out, depth + 1);
    const url = value.trim();
    if (URL_SCHEME.test(url)) out.push({ name, url });
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collect(item, name, out, depth + 1); return; }
  if (!object(value)) return;
  // stream_m3u8 与 stream_play 是同一路流的两种封装，不是两路流：合一条（m3u8 优先）。
  // 分开收会让每个机位凭空多出一份 hls 和一份 flv。
  const packed = str(value.stream_m3u8).trim() || str(value.stream_play).trim();
  if (packed) { out.push({ name: str(value.stream_name).trim() || name, url: packed, streamType: value.stream_type, type: value.type }); return; }
  for (const [key, item] of Object.entries(value)) collect(item, key, out, depth + 1);
}
// 没有直出地址时才用 stream_id 换流清单。只认纯数字：别的形状传过去只会换回空 result。
function streamIdOf(value, depth = 0) {
  if (depth > 6) return null;
  if (typeof value === 'string') { const nested = models.embedded(value); return nested ? streamIdOf(nested, depth + 1) : null; }
  if (Array.isArray(value)) { for (const item of value) { const found = streamIdOf(item, depth + 1); if (found) return found; } return null; }
  if (!object(value)) return null;
  for (const [key, item] of Object.entries(value)) {
    if (/^stream_?id$/i.test(key) && /^\d+$/.test(str(item).trim())) return str(item).trim();
    const found = streamIdOf(item, depth + 1);
    if (found) return found;
  }
  return null;
}

// 上游的 search_time 要不补零的 2026-6-3，补零会被当成空日期换回空列表；
// 而本仓对外一律 YYYY-MM-DD。两种写法都收，最后统一用 models.date 验真伪
// （它拒 2026-02-31），返回值仍是 YYYY-MM-DD。
function day8(value) {
  const text = str(value).trim();
  const loose = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return models.date(loose ? `${loose[1]}-${loose[2].padStart(2, '0')}-${loose[3].padStart(2, '0')}` : text);
}
function searchTime(day) {
  const [year, month, date] = day8(day).split('-');
  return `${year}-${Number(month)}-${Number(date)}`;
}
// 时段边界上游给过 HH:MM 也给过当天秒数，两种都收；认不出就留 null ——
// 宁可没有时间窗，也不要凭空编一个把别处的课算进「当前」。
function clockSec(value) {
  const text = str(value).trim();
  if (!text) return null;
  const clock = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (clock) { const sec = Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0); return sec < 86400 ? sec : null; }
  const total = Number(text);
  return Number.isFinite(total) && total >= 0 && total < 86400 ? Math.trunc(total) : null;
}
function shanghaiSecond(now) {
  return Math.floor((((now.getTime() + 8 * 3600000) % 86400000) + 86400000) % 86400000 / 1000);
}
function quantumRow(row) {
  // 0 被上游占作「探路」语义，绝不能当成一个真实时段混进来。
  const quantumId = Number(row.id ?? row.quantum_id);
  if (!Number.isSafeInteger(quantumId) || quantumId <= 0) throw shape('直播时段', 'id');
  return { quantumId, name: str(row.name).trim(),
    beginTime: optional(row.class_begin_time), endTime: optional(row.class_end_time),
    beginSec: clockSec(row.class_begin_time), endSec: clockSec(row.class_end_time) };
}
function liveCourse(row, quantum) {
  const courseId = models.id(row.course_id, '直播课程'), subId = models.id(row.sub_id, '直播节次');
  return { courseId, subId, sourceId: models.lessonKey(courseId, subId),
    title: str(row.title) || str(row.sub_title), subTitle: optional(row.sub_title),
    lecturerName: optional(row.lecturer_name ?? row.realname), collegeName: optional(row.kkxy_name),
    roomName: optional(row.room_name), studentType: optional(row.course_student_type),
    statusLabel: optional(row.status_label), live: /直播/.test(str(row.status_label)),
    quantumId: quantum.quantumId, beginSec: quantum.beginSec, endSec: quantum.endSec };
}

export class LiveSource {
  constructor({ transport, endpoints = liveEndpoints } = {}) {
    // transport 归调用方（通常是 ClassroomSource 那一个），共享登录态；
    // 本类不 close 它，否则会把课堂数据源一起打死。
    if (typeof transport?.json !== 'function') throw new TypeError('直播数据源须注入 transport');
    this.transport = transport;
    this.endpoints = { ...liveEndpoints, ...endpoints };
  }
  listParams(day, quantumId) {
    return { need_time_quantum: 1, unique_course: 1, with_sub_duration: 1, with_sub_data: 1,
      search_time: searchTime(day), quantum_id: quantumId, tenant: TENANT };
  }
  /**
   * 直播网关要的是 `Authorization: Bearer <JWT>`，不是 cookie。
   *
   * 这是直播通路与回放通路**最容易被漏掉的一处差异**：回放的每条请求靠 cookie 就够了，
   * 所以 transport 默认只带 cookie；直播接口却要显式带 Bearer，否则一律回业务失败，
   * 看起来像「今天没有课」。上游 zju-recorder 的每个请求都带这个头。
   *
   * JWT 来源按可靠性排：先取登录后落进 jar 的 `_token`（含 JWT 的 Yii 包裹），
   * 再退回各业务域上的 `JWTUser`。拿不到就**不带**这个头 —— 让上游如实拒绝，
   * 而不是自己编一个空 Bearer 把真实错误盖成 401。
   */
  async authHeaders() {
    const jar = this.transport?.session?.jar;
    if (!jar) return {};
    const token = jwtFromTokenCookie(await jar.getCookies('https://classroom.zju.edu.cn/'));
    if (!token) return {};
    return { authorization: `Bearer ${token}` };
  }
  // quantum_id=0 返回的是时段元信息而不是课，行里没有 course_id，因此单独解析。
  async listQuantum(date, { signal } = {}) {
    const day = day8(date);
    const headers = await this.authHeaders();
    const data = await this.transport.json(query(this.endpoints.courses, this.listParams(day, 0)), '直播时段', { signal, headers });
    // The gateway includes a quantum_id=0 aggregate group alongside timed groups.
    // It has no clock window and must not invalidate the real quantums.
    const timed = liveList(data, '直播时段').filter(row => !object(row) || ![0, '0'].includes(row.id ?? row.quantum_id));
    return rows(timed, '直播时段', 'list', quantumRow);
  }
  async coursesOf(day, quantum, { signal } = {}) {
    const headers = await this.authHeaders();
    const data = await this.transport.json(query(this.endpoints.courses, this.listParams(day, quantum.quantumId)), '直播课程', { signal, headers });
    const list = liveList(data, '直播课程');
    // need_time_quantum keeps the response grouped even for a selected quantum.
    // Retain flat responses for gateways that omit the grouping envelope.
    const grouped = list.some(row => object(row) && Array.isArray(row.list));
    const courses = grouped
      ? list.flatMap(row => {
        if (!object(row)) throw shape('直播课程', 'list[]');
        if (String(row.id ?? row.quantum_id) !== String(quantum.quantumId)) return [];
        return array(row.list, '直播课程', 'list[].list');
      })
      : list;
    return rows(courses, '直播课程', 'list', row => liveCourse(row, quantum));
  }
  async listLiveDay(date, { signal } = {}) {
    const day = day8(date);
    const quantums = await this.listQuantum(day, { signal });
    // 上游没有全天聚合接口，只有按 quantum_id 分片，所以每个时段一次请求。
    const settled = quantums.length ? await Promise.allSettled(quantums.map(q => this.coursesOf(day, q, { signal }))) : [];
    const failed = settled.filter(entry => entry.status === 'rejected');
    // 单个时段失败不该废掉全天结果；全失败才说明是登录或网关问题，必须抛。
    if (failed.length && failed.length === settled.length) throw failed[0].reason;
    const items = [], seen = new Set();
    for (const entry of settled) {
      if (entry.status !== 'fulfilled') continue;
      for (const item of entry.value) {
        // 同一节课可能同时挂在相邻两个时段下，按课程 + 节次去重。
        const identity = `${item.courseId}\u0000${item.subId}`;
        if (!seen.has(identity)) { seen.add(identity); items.push(item); }
      }
    }
    const pages = quantums.length;
    return failed.length
      ? result(items, { complete: false, reason: 'partial-quantum', pages, failedQuantums: failed.length })
      : result(items, { pages });
  }
  async listCurrent({ signal, now = new Date() } = {}) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError('now 须为有效日期');
    const day = models.shanghaiDate(now), second = shanghaiSecond(now);
    const quantums = await this.listQuantum(day, { signal });
    // 没有时段就是当天没排课（假期、周末），不是异常。
    if (!quantums.length) return result([]);
    // 时段表给不出时间窗就没法判断「当前」；宁可报结构异常，也不要用空列表冒充课间。
    if (!quantums.some(q => q.beginSec != null && q.endSec != null)) throw shape('直播时段', 'class_begin_time/class_end_time');
    const current = quantums.find(q => q.beginSec != null && q.endSec != null && second >= q.beginSec && second < q.endSec);
    // 课间没有课时段：返回空列表，而不是最近一节课 —— 否则「当前直播」会指向还没开始或已结束的课。
    if (!current) return result([]);
    return result(await this.coursesOf(day, current, { signal }));
  }
  async screenStreams(courseId, subId, streamId, { signal } = {}) {
    const headers = await this.authHeaders();
    const data = await this.transport.json(query(this.endpoints.screenstream, { course_id: courseId, sub_id: subId, stream_id: streamId }), '直播流', { signal, headers });
    // 这个接口没有业务码，成功只看 result.data；缺字段就是结构漂移，不能读成「没有流」。
    return rows(data.result?.data, '直播流', 'result.data', row => ({
      name: str(row.stream_name),
      // 两字段都可能缺：优先 m3u8，退回 play；都不给就交给 pack 记成 unknown 进 dropped。
      url: str(row.stream_m3u8).trim() || str(row.stream_play).trim(),
      streamType: row.stream_type, type: row.type,
    }));
  }
  async resolveStreams(courseId, subId, { signal } = {}) {
    courseId = models.id(courseId, '直播课程'); subId = models.id(subId, '直播节次');
    const headers = await this.authHeaders();
    const data = await this.transport.json(query(this.endpoints.streams, { all: 1, course_id: courseId, sub_id: subId,
      with_sub_data: 1, with_room_data: 1, show_all: 1, show_delete: 2 }), '直播流', { signal, headers });
    const list = liveList(data, '直播流');
    const row = list.find(object);
    if (!row) { if (list.length) throw shape('直播流', 'list[0]'); return pack([]); }
    const sub = models.embedded(row.sub_content), direct = [];
    collect(sub, 'sub_content', direct);
    // 直出地址可用时不再问 getscreenstream；但必须先确认里面真有能播的地址，
    // 否则一张封面图就会把后面取流的路径整个挡掉。
    if (direct.some(entry => PLAYABLE.has(mediaType(entry.url)))) return pack(direct);
    const streamId = streamIdOf(sub);
    if (streamId) return pack(await this.screenStreams(courseId, subId, streamId, { signal }));
    return pack(direct);
  }
}
