/**
 * **WBI 签名**（B 站 `x/player/wbi/v2` 等接口的必需参数）。
 *
 * # 它是什么
 *
 * B 站给一批接口加了 `w_rid` 校验：请求参数按字典序 urlencode，末尾拼一个
 * 由 `img_key + sub_key` 经固定置换表算出的 `mixin_key`，再取 md5。
 * 少这个参数，接口回 `code=0` 但**数据字段是空的**（比报错更难查）。
 *
 * # 为什么本包自己写，而不是挂 `dsh-bili-watch`
 *
 * 见 `upstream.js` 的 `SELF_BUILD_VERDICT`：整条字幕通道只要 50 行，
 * 而挂上游要背 116 KB 宿主代码、48 KB 客户端面板、两个命令面和一个 `qrcode` 依赖。
 * 其中**纯函数部分只有 24 行**（本文件 + `subtitles.js`）。
 *
 * # 这个文件是纯函数批
 *
 * 无 IO、无网络、**不读时钟**（`wts` 由调用方传入）。因此可离线单测：
 * 拿固定的 key + 固定 `wts`，断言 `w_rid` 与线上一致。
 */

import { createHash } from 'node:crypto';

/**
 * `mixin_key` 的置换表（B 站前端固定常量，**64 项**）。
 *
 * ⚠️ 这是一张**位置表**，不是权重：`mixinKey = TAB.map(i => raw[i]).join('').slice(0, 32)`。
 *    抄错任何一项都会得到 32 位看起来正常、但服务端不认的 key —— 而接口回的是
 *    `code=0` + 空数据，不会报「签名错」。所以本文件配了逐项断言。
 */
export const MIXIN_KEY_ENC_TAB = Object.freeze([
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38,
  41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52,
]);

/** `mixin_key` 的长度（B 站口径）——置换表 64 项只是素材池，取前 32 位。 */
export const MIXIN_KEY_LENGTH = 32;

/** WBI 要求剔除的字符（B 站前端口径：`!'()*`）。 */
const STRIP_RE = /[!'()*]/g;

/**
 * 从 `img_key + sub_key` 算出 `mixin_key`。
 *
 * @param raw - `img_key + sub_key` 拼起来的原串（各 32 字符）。
 * @returns 32 字符的 mixin key。
 */
export function mixinKey(raw) {
  const source = String(raw ?? '');
  return MIXIN_KEY_ENC_TAB.map((index) => source[index] ?? '').join('').slice(0, MIXIN_KEY_LENGTH);
}

/**
 * 生成 WBI 签名后的查询串（已含 `wts` 与 `w_rid`）。
 *
 * @param params - 业务参数（如 `{ aid, cid }`）。
 * @param imgKey - `nav` 返回的 `wbi_img.img_url` 的文件名主部。
 * @param subKey - `nav` 返回的 `wbi_img.sub_url` 的文件名主部。
 * @param wts - **秒级**时间戳。必须由调用方传入：本文件不读时钟，
 *              否则单测无法固定结果（而签名错的表现是「静默空数据」）。
 * @returns `a=1&b=2&wts=...&w_rid=<32 位 hex>`。
 */
export function wbiSign(params, imgKey, subKey, wts) {
  if (!Number.isFinite(wts)) throw new TypeError('wbiSign 需要秒级 wts（不要传毫秒，也不要省略）');
  const merged = { ...params, wts };
  const query = Object.keys(merged)
    .sort()
    .map((name) => {
      const value = String(merged[name] ?? '').replace(STRIP_RE, '');
      return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const signature = createHash('md5').update(query + mixinKey(`${imgKey ?? ''}${subKey ?? ''}`)).digest('hex');
  return `${query}&w_rid=${signature}`;
}

/**
 * 从 `nav` 的 `wbi_img` 两个 URL 里取 key。
 *
 * 形如 `https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png`
 * → `7cd084941338484aae1ad9425b84077c`（取末段文件名、去扩展名）。
 *
 * @returns `{ imgKey, subKey }`，任一取不到时为空字符串（调用方据此判「nav 异常」）。
 */
export function keysFromNav(nav) {
  const pick = (url) => {
    const tail = String(url ?? '').split('/').pop() ?? '';
    return tail.split('.')[0] ?? '';
  };
  return {
    imgKey: pick(nav?.data?.wbi_img?.img_url),
    subKey: pick(nav?.data?.wbi_img?.sub_url),
  };
}

/**
 * 两个 key 是否都取到了（各 32 字符）。取不到时签名一定错，宁可提前报错。
 *
 * ⚠️ 参数可以是 `null`（`keysFromNav(null)` 会回空串，但集成层可能直接传 `null`）。
 *    默认参数 `= {}` 只接管 `undefined`，**接管不了 `null`** —— 早先写成
 *    `({ imgKey, subKey } = {})` 时，传 `null` 会抛 `TypeError: Cannot destructure`。
 */
export function keysLookValid(keys) {
  const { imgKey, subKey } = keys ?? {};
  return typeof imgKey === 'string' && typeof subKey === 'string'
    && imgKey.length === 32 && subKey.length === 32;
}
