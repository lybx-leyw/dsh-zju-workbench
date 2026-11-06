/**
 * **HTTP 层**：只做「发请求 → 认出风控 → 认出业务错误 → 交出 JSON」。
 *
 * # 与上游 `jget` 的差别（为什么不照抄）
 *
 * 上游那 39 行里，有一半是**它自己的产品需要**、本包不需要的：
 * 网络错误中文翻译、`last-error.json` 落盘诊断、200ms 抖动重试。
 * 本包是同进程服务，错误要**带 `code` 抛出去**让集成层处置，
 * 而不是打印成中文再返回一个 `{code:-999}`。
 *
 * 但上游有**两条判据必须保留**，它们是踩出来的：
 *
 * 1. **HTTP 412 = 风控**，要单独成码（不是「网络错误」，重试没用）。
 * 2. **HTTP 200 也可能是风控** —— 返回的是 HTML 验证页。
 *    只判 `!r.ok` 会让它落到 `JSON.parse` 失败，被当成「响应不是 JSON」的
 *    普通错误，调用方以为改改代码就好，实际是账号被拦了。
 */

import { BilibiliError, ERROR_CODE, explainCode, isCredentialIssue, isRiskControl, isUnavailable } from './errors.js';

/** 默认请求头：B 站对 `User-Agent` 与 `Referer` 有要求（缺 Referer 会被 CDN 拒）。 */
export const BASE_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://www.bilibili.com/',
});

/** 默认超时（毫秒）。B 站接口多数在 1s 内返回；字幕 CDN 可能稍慢。 */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 把凭证对象转成 `Cookie` 请求头。
 *
 * 上游的四字段判据（缺一不可）：`sessdata` / `bili_jct` / `buvid3` / `buvid4`。
 * 为什么不是「有 sessdata 就够了」：残缺凭证在部分接口会返回 401 或**空数据**，
 * 比匿名更难排查 —— 匿名至少行为一致，残缺凭证是「有时行有时不行」。
 *
 * @param credential - `{ sessdata, bili_jct, buvid3, buvid4 }`，可为 null（匿名）。
 * @returns 请求头对象。匿名时**不带 Cookie 键**（不是带空串）。
 */
export function headersFor(credential) {
  if (!credential) return { ...BASE_HEADERS };
  const parts = [];
  if (credential.sessdata) parts.push(`SESSDATA=${credential.sessdata}`);
  if (credential.bili_jct) parts.push(`bili_jct=${credential.bili_jct}`);
  if (credential.buvid3) parts.push(`buvid3=${credential.buvid3}`);
  if (credential.buvid4) parts.push(`buvid4=${credential.buvid4}`);
  return parts.length ? { ...BASE_HEADERS, Cookie: parts.join('; ') } : { ...BASE_HEADERS };
}

/**
 * 发一个 GET 并返回解析后的 JSON。
 *
 * @param url - 完整 URL。
 * @param options - `{ headers, signal, timeoutMs }`。
 * @returns 解析后的 JSON 对象。
 * @throws BilibiliError（`RISK_CONTROL` / `NETWORK` / `API_SHAPE`）
 */
export async function getJson(url, { headers = BASE_HEADERS, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response;
  try {
    response = await fetch(url, { headers, signal: combined });
  } catch (error) {
    // 调用方主动取消不算网络错误 —— 它要的是「停下」，不是「重试」。
    if (signal?.aborted) throw error;
    const code = error?.cause?.code ?? error?.name ?? 'FETCH';
    throw new BilibiliError(ERROR_CODE.NETWORK, `网络错误（${code}）：请检查网络连接后重试`, {
      transport: code, host: safeHost(url),
    });
  }

  const text = await response.text();

  // ① HTTP 412：风控。**不重试**，要换登录态或等一等。
  if (response.status === 412) {
    throw new BilibiliError(ERROR_CODE.RISK_CONTROL, '触发风控（HTTP 412）：请稍后重试或使用已登录凭证', {
      status: 412, host: safeHost(url),
    });
  }

  // ② HTTP 200 但返回 HTML：也是风控（验证页 /「请求过于频繁」页）。
  const contentType = String(response.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new BilibiliError(ERROR_CODE.RISK_CONTROL,
      `触发风控（HTTP ${response.status} 返回 HTML 而非接口 JSON）：请稍后重试或使用已登录凭证`, {
        status: response.status, host: safeHost(url),
      });
  }

  if (!response.ok) {
    throw new BilibiliError(ERROR_CODE.NETWORK, `HTTP ${response.status}：${safeHost(url)}`, {
      status: response.status, host: safeHost(url),
    });
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new BilibiliError(ERROR_CODE.API_SHAPE, `响应不是合法 JSON（${safeHost(url)}，前 80 字：${text.slice(0, 80)}）`, {
      host: safeHost(url),
    });
  }
}

/**
 * 发一个 GET 并**按 B 站业务码**判错，返回 `data`。
 *
 * 这是本包内部最主要的一层：调用方拿到的要么是 `data`，要么是一个
 * **带处置意图的错误**（`CREDENTIAL_EXPIRED` 去登录 / `RISK_CONTROL` 等一会儿 /
 * `VIDEO_UNAVAILABLE` 别重试）。
 *
 * @param url - 完整 URL。
 * @param options - `{ headers, signal, timeoutMs, what }`；`what` 用于错误文案（如「字幕轨」）。
 * @returns 上游 `data` 字段（可能为 `null`）。
 */
export async function getData(url, { headers = BASE_HEADERS, signal, timeoutMs = DEFAULT_TIMEOUT_MS, what = '接口' } = {}) {
  const payload = await getJson(url, { headers, signal, timeoutMs });
  const code = payload?.code;
  if (code === 0) return payload.data ?? null;

  const message = explainCode(code, payload?.message ?? '');
  const details = { code, host: safeHost(url), what };

  if (isRiskControl(undefined, code)) throw new BilibiliError(ERROR_CODE.RISK_CONTROL, message, details);
  if (isCredentialIssue(code)) throw new BilibiliError(ERROR_CODE.CREDENTIAL_EXPIRED, message, details);
  if (isUnavailable(code)) throw new BilibiliError(ERROR_CODE.VIDEO_UNAVAILABLE, message, details);
  throw new BilibiliError(ERROR_CODE.API_SHAPE, `${what}返回异常：${message}`, details);
}

/** 只保留主机名 —— URL 里可能带签名参数，不该进日志或错误详情。 */
function safeHost(url) {
  try { return new URL(url).host; } catch { return 'unknown'; }
}
