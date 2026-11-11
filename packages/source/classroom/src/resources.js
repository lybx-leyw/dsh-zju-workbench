/**
 * 「某几次课有哪些资源」：**只看不下载**。
 *
 * 对应上游 `zhiyun search resources`（`core/zju/lib/zhiyun/cli.ts:73-93`）。
 *
 * # 为什么不复用 `lesson.resources`
 *
 * `models.js` 的 `resources(content)` 是**课次响应里那一段**的规范化结果：它给出
 * 「有没有回放、课件叫什么、时长多少」，但**没有种类标签**，也不含课堂截图与
 * 字幕句数 —— 后两者要另外请求。上游的做法是把「课次里带的资源」和「另外查到的
 * 数量」拼成同一个 `resources` 数组，每项带 `kind`。
 *
 * 所以这里做两件事：
 *
 *   1. `assetsOf()` —— 把 `models.lesson().resources` 摊平成一串带 `kind` 的条目；
 *   2. `parseKinds()` —— 解析 `kind` 参数（`video,audio,ppt,slides,subtitles`）。
 *
 * 截图与字幕的**数量**不在这里取：它们各要一次（或多次分页）网络请求，
 * 由 `source.js` 的 `searchResources` 按需调用 `getSlides` / `getSubtitles`。
 */

import { ClassroomError } from './errors.js';

/** 与上游 `selection.ts` 的 KINDS 一致；`all` 只作为入参别名。 */
export const KINDS = Object.freeze(['video', 'audio', 'ppt', 'slides', 'subtitles']);

/**
 * 解析 `kind` 参数。
 *
 * 接受 `'all'`、逗号分隔字符串、或数组。**认不出的值直接拒绝**，不静默忽略 ——
 * 上游同样如此（`selection.ts:20`）：拼错一个种类却拿到「什么都没有」，
 * 比报错难查得多。
 *
 * @param {string|string[]|undefined} value
 * @returns {string[]} 去重后的种类列表。
 */
export function parseKinds(value) {
  if (value === undefined || value === null || value === '' || value === 'all') return [...KINDS];
  const list = Array.isArray(value) ? value.map(String) : String(value).split(',');
  const unique = [...new Set(list.map((item) => item.trim()).filter(Boolean))];
  if (!unique.length) return [...KINDS];
  const unknown = unique.filter((item) => !KINDS.includes(item));
  if (unknown.length) {
    throw new ClassroomError('INVALID_INPUT', `kind 只能是 ${KINDS.join(' / ')}，多种用逗号分隔`, { unknown });
  }
  return unique;
}

/**
 * 从 URL 或文件名里推断视频高度。
 *
 * 上游 `quality.ts:1-8` 的做法：优先找 `1920x1080` 这类**真实尺寸**，其次找
 * `1080p` 这类标注。**绝不**把门户里的「清晰度编号 1/2/3」当成高度 ——
 * 那些编号在不同课程里指向不同的分辨率。
 *
 * @param {unknown} value
 * @returns {number|null}
 */
export function videoHeight(value) {
  let text = String(value ?? '');
  try { text = decodeURIComponent(new URL(text).pathname); } catch { /* 可能只是一个标签 */ }
  const dimensions = [...text.matchAll(/(?:^|[_./\s-])(\d{2,5})[_x](\d{2,5})(?=[_./\s-]|$)/gi)];
  const height = dimensions.length ? Number(dimensions.at(-1)[2]) : Number(text.match(/(?:^|\D)(\d{3,4})p(?:\b|_)/i)?.[1]);
  return Number.isSafeInteger(height) && height > 0 ? height : null;
}

const AUDIO = /\.(?:mp3|m4a|aac|wav|ogg|flac)(?:[?#]|$)/i;
const VIDEO = /\.(?:mp4|m3u8|webm|mkv|flv)(?:[?#]|$)/i;

/** 只收 http(s) 绝对地址；`file_name` 里偶尔是空串或相对路径，那些没有可用性。 */
function webUrl(value) {
  const text = String(value ?? '').trim();
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    if (url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}

/**
 * 把一节次的资源摊平成 `{kind,name,url,height?,durationMs?}` 列表。
 *
 * 去重键是 `kind + url`：同一路回放在 `playback.url` 与 `file_list` 里各出现一次
 * 是常态，算两遍会让「有几个视频」直接翻倍。
 *
 * @param {object} lesson `models.lesson()` 的结果。
 * @returns {Array<object>}
 */
export function assetsOf(lesson) {
  const content = lesson?.resources;
  const items = [];
  const seen = new Set();
  const add = (kind, name, rawUrl, extra = {}) => {
    const url = webUrl(rawUrl);
    if (!url) return;
    const identity = `${kind}\u0000${url}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    items.push({ kind, name: String(name ?? ''), url, ...extra });
  };

  add('video', '回放', content?.videoUrl, {
    ...(videoHeight(content?.videoUrl) === null ? {} : { height: videoHeight(content?.videoUrl) }),
    ...(Number.isFinite(content?.videoDurationMs) ? { durationMs: content.videoDurationMs } : {}),
  });
  add('ppt', content?.pptFileName ?? '课件', content?.pptUrl);

  for (const file of Array.isArray(content?.files) ? content.files : []) {
    // 上游把 `file_name` 当**地址**用（`courses.ts:126`），这里的模型也是这么存的。
    const url = file?.url;
    if (!url) continue;
    if (AUDIO.test(String(url))) add('audio', file?.type || '音频', url);
    else if (VIDEO.test(String(url))) add('video', file?.type || '回放', url, {
      ...(videoHeight(url) === null ? {} : { height: videoHeight(url) }),
    });
  }
  return items;
}

/**
 * 「独立音轨缺失」时补一条说明项。
 *
 * 上游在 `search resources` 里补一条 `{kind:'audio', source:'下载时从视频里提取'}`
 * （`cli.ts:83`）—— 它**不是**一个可下载地址，只是告诉调用方「想要音频得先取视频」。
 * 本仓没有落地的视频→音频压制链路，所以这里把 `available` 显式置 false：
 * 报一个能下但下不下来的地址，比报「没有」更糟。
 *
 * @returns {{kind:'audio',name:string,available:false,source:string,url:null}}
 */
export function extractedAudioNotice() {
  return { kind: 'audio', name: '音频', available: false, url: null, source: '需从视频压制（FFmpeg），本方法不下载' };
}
