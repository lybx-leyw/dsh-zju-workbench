/**
 * **字幕通道**：B 站视频 → 本仓 `subtitles[]`。
 *
 * # 完整链路（实测可用，2026-10-29）
 *
 * ```text
 * ① nav                 GET api.bilibili.com/x/web-interface/nav
 *                       → 拿 wbi_img.img_url / sub_url（两个 32 字符 key）
 *                       ⚠️ 匿名时 code=-101，但 wbi_img **照样给** —— 所以这一步不要求登录
 * ② 签名                wbiSign({ aid, cid }, imgKey, subKey, wts)   （纯函数，见 wbi.js）
 * ③ 字幕轨列表           GET .../x/player/wbi/v2?<签名>
 *                       → data.subtitle.subtitles[]，取第一个有 subtitle_url 的轨
 * ④ 字幕文件             GET <subtitle_url>
 *                       → { body: [{ from, to, content }] }        （秒）
 * ⑤ 规范化              cuesToSubtitles()                            （纯函数，见 subtitles.js）
 * ```
 *
 * # 必须登录（实测，不是推测）
 *
 * 2026-10-29 匿名实测 92 个视频，`data.subtitle.subtitles` **100% 为空**。
 * 而签名路径本身是通的（`wbi/v2` 回 `code=0`）—— 所以**不是签名错、不是被拦，
 * 是服务端在匿名态下就不返回字幕轨**。
 *
 * → 出 `NO_CREDENTIAL` 时**不要重试**，要提示用户去登录。
 *
 * # 两种失败必须分开
 *
 * | 情况 | 错误码 | 含义 |
 * | --- | --- | --- |
 * | 有登录态，但这条视频确实没字幕轨 | `NO_SUBTITLE_TRACK` | **确定结果**，重试无用 → 走 ASR 或告知用户 |
 * | 没登录态 | `NO_CREDENTIAL` | 可以登录后成功 |
 *
 * 混成一个「没拿到字幕」会让用户不知道「登录一下就好」还是「这视频就没字幕」。
 */

import { BilibiliError, ERROR_CODE } from './errors.js';
import { getData, getJson, headersFor } from './http.js';
import { keysFromNav, keysLookValid, wbiSign } from './wbi.js';
import { cuesToSubtitles } from './subtitles.js';
import { REQUIRED_COOKIE_FIELDS } from './upstream.js';

const API = 'https://api.bilibili.com';

/**
 * 校验凭证形状。
 *
 * @param credential - 候选凭证对象（可为 null）。
 * @returns `{ ok, missing }`。`ok=false` 时 `missing` 列出缺的字段。
 */
export function inspectCredential(credential) {
  if (!credential || typeof credential !== 'object') return { ok: false, missing: [...REQUIRED_COOKIE_FIELDS] };
  const missing = REQUIRED_COOKIE_FIELDS.filter((key) => !String(credential[key] ?? '').trim());
  return { ok: missing.length === 0, missing };
}

/**
 * 取 wbi key（**不需要登录**）。
 *
 * ⚠️ 匿名请求 `nav` 会得到 `code=-101`（未登录），**但 `data.wbi_img` 照样有值**。
 * 所以这里必须用 `getJson` 拿**原始 payload**、只判 `data.wbi_img` 在不在，
 * **绝不能走 `getData`** —— 后者把 `-101` 翻成 `CREDENTIAL_EXPIRED` 直接抛，
 * 于是匿名态连签名都拿不到，与「匿名也能取字幕轨列表」的实测事实矛盾。
 *
 * > 这条是**实跑踩出来的**：注释里写对了，第一版实现仍然用了 `getData`，
 * > 结果匿名调用直接抛 `CREDENTIAL_EXPIRED`。单测里有一条专门盯它。
 *
 * @returns `{ imgKey, subKey }`。
 * @throws BilibiliError（`API_SHAPE`，key 取不到时）
 */
export async function fetchWbiKeys({ headers = headersFor(null), signal } = {}) {
  const nav = await getJson(`${API}/x/web-interface/nav`, { headers, signal });
  const keys = keysFromNav(nav);
  if (!keysLookValid(keys)) {
    throw new BilibiliError(ERROR_CODE.API_SHAPE,
      '未从 nav 取到 WBI 签名参数（img_key/sub_key）—— 可能是接口变更，或请求被 CDN 拦截', {
        what: 'WBI 参数', navCode: nav?.code ?? null,
      });
  }
  return keys;
}

/**
 * 取一条视频的字幕。
 *
 * @param options.aid - 视频 AV 号（正整数）。
 * @param options.cid - 分 P 的 CID（正整数）。
 * @param options.credential - `{ sessdata, bili_jct, buvid3, buvid4 }`；`null` 表示匿名。
 * @param options.signal - 中止信号。
 * @param options.now - 秒级时间戳（**测试注入点**；不传则取当前时间）。
 * @returns `{ subtitles, cues, lan, dropped, anonymous }` —— `subtitles` 直接可喂 `parse()`。
 * @throws BilibiliError（见 `errors.js` 的码表）
 */
export async function fetchSubtitles({ aid, cid, credential = null, signal, now } = {}) {
  if (!Number.isSafeInteger(aid) || aid <= 0) throw new BilibiliError(ERROR_CODE.INPUT, '需要正整数 aid', { field: 'aid' });
  if (!Number.isSafeInteger(cid) || cid <= 0) throw new BilibiliError(ERROR_CODE.INPUT, '需要正整数 cid', { field: 'cid' });

  const headers = headersFor(credential);
  const anonymous = !credential;
  const keys = await fetchWbiKeys({ headers, signal });
  const wts = Number.isFinite(now) ? Math.trunc(now) : Math.trunc(Date.now() / 1000);
  const query = wbiSign({ aid, cid }, keys.imgKey, keys.subKey, wts);

  const player = await getData(`${API}/x/player/wbi/v2?${query}`, { headers, signal, what: '字幕轨' });
  const tracks = player?.subtitle?.subtitles;
  const list = Array.isArray(tracks) ? tracks : [];
  const track = list.find((item) => typeof item?.subtitle_url === 'string' && item.subtitle_url !== '');

  if (!track) {
    // 「没有字幕轨」是**确定结果**：重试不会变。但要区分「因为没登录」。
    if (anonymous) {
      throw new BilibiliError(ERROR_CODE.NO_CREDENTIAL,
        '该视频的字幕需要登录态才能读取（匿名实测恒为空）—— 请先登录 B 站后重试', {
          tracks: list.length, anonymous: true,
        });
    }
    throw new BilibiliError(ERROR_CODE.NO_SUBTITLE_TRACK,
      `该视频没有可用的字幕轨（共 ${list.length} 条轨道）—— 需要走本地 ASR 或人工核对`, {
        tracks: list.length, anonymous: false,
      });
  }

  const url = track.subtitle_url.startsWith('//') ? `https:${track.subtitle_url}` : track.subtitle_url;
  // 字幕文件本身**不校验登录**（上游实测），所以这里只带 UA，不带 Cookie ——
  // 少一次凭证出现在 CDN 的 QPS 日志里。
  const payload = await getData(url, { headers: { 'User-Agent': headers['User-Agent'] }, signal, what: '字幕文件' });
  const cues = Array.isArray(payload?.body) ? payload.body : [];
  const { subtitles, dropped, empty } = cuesToSubtitles(cues);

  if (empty) {
    throw new BilibiliError(ERROR_CODE.NO_SUBTITLE_TRACK,
      `字幕轨存在（lan=${track.lan ?? '?'}）但内容为空 —— 该视频配了轨却没填内容`, {
        lan: track.lan ?? null, cues: cues.length, dropped,
      });
  }

  return { subtitles, cues, lan: track.lan ?? null, dropped, anonymous };
}

/**
 * 一次取齐「元数据 + 字幕」，产出可以直接喂 `parse()` 的载荷。
 *
 * # 元数据与字幕的失败**不对称**
 *
 * | 哪一步失败 | 处置 |
 * | --- | --- |
 * | 元数据（`view`） | **抛错** —— 没有 `aid`/`cid` 后面全做不了 |
 * | 字幕 | **不抛** —— 元数据已经拿到了，字幕失败只记进 `warnings` |
 *
 * 早先版本让字幕失败把元数据一起丢掉：匿名调用会得到 `NO_CREDENTIAL` 的整包失败，
 * 而**标题、aid、cid 其实都已经取到了**。调用方（比如抽帧）明明只需要
 * `aid`/`cid`，却被一个它不关心的失败挡住。
 *
 * → 现在字幕失败时 `subtitles: []` + `subtitleError: { code, message }`，
 *   并把 `NO_CREDENTIAL` 单独标出来（那是「去登录就能好」，
 *   与「这视频真没字幕」是两回事）。
 *
 * @returns `{ aid, cid, bvid, title, owner, durationSec, lan, subtitles, slides, warnings, subtitleError }`。
 *          `slides` 恒为 `[]` —— 画面那一半见 `lesson.js`。
 */
export async function resolveLesson({ bvid, credential = null, signal, now } = {}) {
  const id = String(bvid ?? '').trim();
  if (!/^BV[0-9A-Za-z]{10}$/.test(id)) {
    throw new BilibiliError(ERROR_CODE.INPUT, `BVID 形状不对（应为 BV + 10 位）：收到 ${JSON.stringify(bvid)}`, { field: 'bvid' });
  }
  const headers = headersFor(credential);
  const view = await getData(`${API}/x/web-interface/view?bvid=${encodeURIComponent(id)}`, {
    headers, signal, what: '视频元数据',
  });
  const aid = Number(view?.aid);
  const cid = Number(view?.cid);
  if (!Number.isSafeInteger(aid) || !Number.isSafeInteger(cid)) {
    throw new BilibiliError(ERROR_CODE.API_SHAPE, '视频元数据缺少 aid/cid —— 接口可能已变更', { what: '视频元数据' });
  }

  const warnings = [];
  let fetched = null;
  let subtitleError = null;
  try {
    fetched = await fetchSubtitles({ aid, cid, credential, signal, now });
  } catch (error) {
    // 取消要往上抛 —— 那是调用方的意志，不是「字幕失败」。
    if (error?.code === ERROR_CODE.CANCELLED) throw error;
    subtitleError = { code: error?.code ?? 'UNKNOWN', message: String(error?.message ?? error) };
    warnings.push(
      error?.code === ERROR_CODE.NO_CREDENTIAL
        ? '字幕需要登录态才能读取；本次只取到元数据与画面。登录后重跑可补上正文。'
        : `字幕未取到：${error?.message ?? error}`,
    );
  }

  return {
    aid, cid, bvid: id,
    title: String(view?.title ?? ''),
    owner: String(view?.owner?.name ?? ''),
    durationSec: Number(view?.duration) || null,
    lan: fetched?.lan ?? null,
    subtitles: fetched?.subtitles ?? [],
    slides: [],
    warnings,
    subtitleError,
  };
}
