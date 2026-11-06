/**
 * **取播放地址**：`aid` + `cid` → mp4 直链。
 *
 * # 为什么用 `fnval=1&platform=html5`
 *
 * B 站有两条取流路径，返回形状**完全不同**：
 *
 * | 参数 | 返回 | 能不能直接给 `<video>` |
 * | --- | --- | --- |
 * | `fnval=16`（DASH） | `dash.video[].baseUrl` + `dash.audio[]`，**音视频分离** | ❌ 是分片流，要自己拼 |
 * | `fnval=1&platform=html5`（老接口） | `durl[]`，**单个 mp4、音视频合一** | ✅ **能** |
 *
 * 实测（2026-10-29，`BV11DXrYeE5D`）：
 *
 * ```text
 * durl 分片数: 1          ← 单文件
 * format: mp4
 * moov@36（在 mdat 之前） ← faststart，可边下边 seek
 * ```
 *
 * 所以本包走 DASH 以外的这条：**下游 ffmpeg 只需要一个 `-i <url>`**，
 * 不用处理音轨合并、也不用解析 m3u8。
 *
 * # 清晰度不是随便给的
 *
 * `qn` 只是**请求值**，服务端按账号权限降级。实测同一条视频：
 *
 * | qn | 实际体积（34 分钟） |
 * | ---: | ---: |
 * | 16 | 55.2 MB |
 * | 32 | 55.2 MB（与 16 相同 → 降级了） |
 * | 64 | 93.7 MB |
 *
 * 抽帧只需要能看清文字，`16`（360P）足够，且**省 2/3 流量**。
 * 需要更高清的重抽时把 `qn` 调大即可，接口不用改。
 */

import { BilibiliError, ERROR_CODE } from './errors.js';
import { getData, headersFor } from './http.js';

const API = 'https://api.bilibili.com';

/** 默认清晰度：360P。抽帧只为判同与 OCR，不需要更高。 */
export const DEFAULT_QUALITY = 16;

/** 单次取流返回的 `durl` 数量上限。超过它说明服务端在切片，我们不吃那种形状。 */
export const MAX_DURL_SEGMENTS = 8;

/**
 * 取一条分 P 的播放直链。
 *
 * @param options.aid - 视频 AV 号（正整数）。
 * @param options.cid - 分 P 的 CID（正整数）。
 * @param options.bvid - BV 号（可选；与 `aid` 二选一，服务端两个都认）。
 * @param options.quality - 清晰度 `qn`（默认 16 = 360P）。
 * @param options.credential - 登录凭证；高清晰度需要，360P 匿名即可。
 * @param options.signal - 中止信号。
 * @returns `{ url, quality, segments, format, lengthBytes }`。
 * @throws BilibiliError（`INPUT` / `VIDEO_UNAVAILABLE` / `API_SHAPE` / 见 `errors.js`）
 */
export async function fetchPlayUrl({ aid, cid, bvid = null, quality = DEFAULT_QUALITY, credential = null, signal } = {}) {
  if (!Number.isSafeInteger(cid) || cid <= 0) {
    throw new BilibiliError(ERROR_CODE.INPUT, '需要正整数 cid', { field: 'cid' });
  }
  if (!Number.isSafeInteger(aid) || aid <= 0) {
    // `aid` 与 `bvid` 至少要有一个；服务端两个都认，但我们的契约要求显式给。
    throw new BilibiliError(ERROR_CODE.INPUT, '需要正整数 aid（或改用 bvid）', { field: 'aid' });
  }
  const qn = Number.isFinite(quality) && quality > 0 ? Math.trunc(quality) : DEFAULT_QUALITY;

  const headers = headersFor(credential);
  const query = new URLSearchParams({
    avid: String(aid),
    cid: String(cid),
    qn: String(qn),
    // `fnval=1` = 老接口（单个 mp4）；`platform=html5` 是服务端认这个组合的必要标记。
    fnval: '1',
    fnver: '0',
    fourk: '0',
    platform: 'html5',
  });
  if (bvid) query.set('bvid', bvid);

  const data = await getData(`${API}/x/player/playurl?${query.toString()}`, {
    headers, signal, what: '播放地址',
  });

  const segments = Array.isArray(data?.durl) ? data.durl : [];
  if (segments.length === 0) {
    throw new BilibiliError(ERROR_CODE.API_SHAPE,
      '播放地址返回里没有 durl —— 可能是接口变更，或该视频需要大会员/付费', {
        what: '播放地址', quality: data?.quality ?? null,
      });
  }
  if (segments.length > MAX_DURL_SEGMENTS) {
    // 少数长视频会被切成多段。我们不处理拼接（那要下载后 concat），
    // 宁可如实报错，也不要只取第一段然后产出一份「只有前半段」的帧。
    throw new BilibiliError(ERROR_CODE.API_SHAPE,
      `播放地址被切成 ${segments.length} 段（上限 ${MAX_DURL_SEGMENTS}）：本包不拼接多段流`, {
        what: '播放地址', segments: segments.length,
      });
  }
  const first = segments[0];
  if (typeof first?.url !== 'string' || !/^https?:\/\//i.test(first.url)) {
    throw new BilibiliError(ERROR_CODE.API_SHAPE, '播放地址里的 url 不是 http(s) 链接', { what: '播放地址' });
  }
  // 生产环境不该出现 http 直链（B 站全是 https）；出现说明响应被改过。
  if (!/^https:\/\//i.test(first.url)) {
    throw new BilibiliError(ERROR_CODE.API_SHAPE, '播放地址不是 https —— 拒绝使用（可能被中间人改写）', {
      what: '播放地址',
    });
  }

  return {
    url: first.url,
    /** 服务端**实际给出**的清晰度，可能低于请求值。 */
    quality: Number(data?.quality) || qn,
    segments: segments.length,
    format: String(data?.format ?? ''),
    /** 单段字节数（多段时是本段）。 */
    lengthBytes: Number(first.size) || null,
  };
}
