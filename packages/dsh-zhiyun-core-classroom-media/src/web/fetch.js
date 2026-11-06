// 源：ref/OpenMAIC/lib/web-fetch/builtin-extraction.ts:26-560（内置读取器：限额、重定向、
//     反爬标记、HTML→Markdown、PDF 委派）
// 源：ref/OpenMAIC/lib/web-fetch/providers/builtin.ts:3-14
// 源：ref/OpenMAIC/lib/web-fetch/providers/kimi.ts:6-151
// 源：ref/OpenMAIC/lib/web-fetch/providers/deepseek.ts:27-155
// 源：ref/OpenMAIC/lib/web-fetch/providers/firecrawl.ts:10-126
// 源：ref/OpenMAIC/lib/web-fetch/registry.ts:8-16、types.ts:10-16、abort.ts:2-16
//
// # 与上游的差别（两处，都很关键）
//
// 1. **HTML→Markdown 不再用 linkedom + @mozilla/readability + turndown**。
//    那三个包不在本仓依赖里，而硬约束是"不新增 npm 依赖"。这里给了一个
//    保守的自研抽取器：去脚本/样式、优先 `<article>/<main>`、按标题/段落/列表/
//    链接/代码块转 Markdown。**它比 Readability 弱**（正文打分、噪声剔除都没有），
//    对结构规整的教材页/文档页够用，对营销页会多留导航文字 —— 这是已知取舍。
// 2. **连接层不再用 undici Agent + DNS 钉扎**。出口策略（私网/回环/重定向白名单）
//    是本仓 `source-netproxy` 的职责，本包只做"不跟随重定向 + 协议/凭证校验"。

import { MediaError, invalidInput, unsupportedProvider, upstreamError } from '../errors.js';
import { WEB_FETCH_PROVIDERS } from '../providers.js';
import { deepseekToolsEndpoint, firecrawlEndpoint, FIRECRAWL_DEFAULT_BASE_URL } from './search.js';

const ALLOWED_CONTENT_TYPES = new Set([
  'text/html',
  'text/plain',
  'application/pdf',
  'application/xhtml+xml',
]);
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MIN_CHARS = 200;
const MAX_REDIRECTS = 5;
const BODY_TIMEOUT_MS = 30_000;
const FETCH_HEADERS_TIMEOUT_MS = 10_000;

/** source:builtin-extraction.ts:40-47 */
const DEFAULT_BLOCKED_MARKERS = [
  '你似乎来到了没有知识存在的荒原',
  '环境异常',
  '完成验证',
  '访问过于频繁',
  '请完成安全验证',
  'captcha',
];

/** source:builtin-extraction.ts:332-343 —— 阈值与标记都可被运维覆盖（非密钥，允许读 env）。 */
export function contentThreshold() {
  const configured = Number(process.env.FETCH_URL_MIN_CONTENT_CHARS);
  return Number.isFinite(configured) && configured >= 1 ? configured : DEFAULT_MIN_CHARS;
}

export function antiBotMarkers() {
  const extra = (process.env.FETCH_URL_BLOCKED_MARKERS ?? '')
    .split(/[\n,]/u)
    .map((marker) => marker.trim())
    .filter(Boolean);
  return [...DEFAULT_BLOCKED_MARKERS, ...extra];
}

/** source:builtin-extraction.ts:209-223 */
export function normalizeUntrustedText(value) {
  return String(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u2060\uFEFF]/gu, '')
    .replace(/[\u061C\u202A-\u202E\u2066-\u2069]/gu, '')
    .replace(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}]/gu, '')
    .replace(/\r\n?/g, '\n');
}

export function cleanMarkdown(value) {
  return normalizeUntrustedText(value)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/** source:builtin-extraction.ts:141-207 —— 带**绝对**截止时间的读取（防"滴一滴字节"续命）。 */
export async function readWithTruncation(response, maxBytes, signal, timeoutMs = BODY_TIMEOUT_MS) {
  if (!response.body) throw new MediaError('E_UPSTREAM_ERROR', '抓取响应没有 body', { retryable: true });
  const declared = Number(response.headers.get('content-length'));
  let truncated = Number.isFinite(declared) && declared > maxBytes;
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;

  try {
    for (;;) {
      const remainingTime = deadline - Date.now();
      if (remainingTime <= 0) throw new MediaError('E_UPSTREAM_ERROR', '读取响应体超时', { retryable: true });
      if (signal?.aborted) throw signal.reason ?? new MediaError('E_CANCELLED', '操作已取消');

      let timer;
      const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new MediaError('E_UPSTREAM_ERROR', '读取响应体超时', { retryable: true })),
          remainingTime,
        );
        timer.unref?.();
      });

      const { done, value } = await Promise.race([reader.read(), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (done) break;
      if (!value) continue;

      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) chunks.push(Buffer.from(value.subarray(0, remaining)));
        total += Math.max(0, remaining);
        truncated = true;
        await reader.cancel().catch(() => undefined);
        break;
      }
      chunks.push(Buffer.from(value));
      total += value.byteLength;
      if (total === maxBytes && truncated) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  return { bytes: Buffer.concat(chunks, total), truncated };
}

// ── HTML → Markdown（见文件头第 1 条）────────────────────────────────────────

const ENTITY_MAP = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»', middot: '·', copy: '©',
};

function decodeEntities(value) {
  return String(value).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITY_MAP[body.toLowerCase()] ?? whole;
  });
}

function stripTags(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, '')).replace(/[ \t]+/g, ' ').trim();
}

/** 极简的"取某个标签的内容"。够用即可，不做完整 HTML 解析（依赖约束见文件头）。 */
function sliceTag(html, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html);
  return match ? match[1] : '';
}

function htmlToMarkdownBody(html) {
  // 先去掉不会产出正文的部分，再在剩下的结构上做转换。
  let work = String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|template|svg|iframe|form|nav|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

  const article = sliceTag(work, 'article') || sliceTag(work, 'main') || sliceTag(work, 'body') || work;
  work = article;

  const blocks = [];
  const pushBlock = (text) => {
    const cleaned = cleanMarkdown(text);
    if (cleaned) blocks.push(cleaned);
  };

  // 按块级标签切，逐块转换；行内标签在同一块内处理。
  const pattern = /<(h[1-6]|p|li|pre|blockquote|figcaption|td|th|div|section)\b[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(work)) !== null) {
    if (match[0].startsWith('<img')) {
      const src = /src=["']([^"']+)["']/i.exec(match[0])?.[1];
      const alt = /alt=["']([^"']*)["']/i.exec(match[0])?.[1] ?? '';
      if (src) pushBlock(`![${alt}](${src})`);
      continue;
    }
    const tag = match[1].toLowerCase();
    let inner = match[2];

    inner = inner
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
        const label = stripTags(text);
        return label ? `[${label}](${href})` : '';
      })
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, text) => `**${stripTags(text)}**`)
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, text) => `*${stripTags(text)}*`)
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, text) => `\`${stripTags(text)}\``)
      .replace(/<br\s*\/?>/gi, '\n');

    if (tag.startsWith('h')) {
      pushBlock(`${'#'.repeat(Number(tag[1]))} ${stripTags(inner)}`);
    } else if (tag === 'li') {
      pushBlock(`- ${stripTags(inner)}`);
    } else if (tag === 'pre') {
      pushBlock(`\`\`\`\n${decodeEntities(inner.replace(/<[^>]*>/g, ''))}\n\`\`\``);
    } else if (tag === 'blockquote') {
      pushBlock(stripTags(inner).split('\n').map((line) => `> ${line}`).join('\n'));
    } else {
      pushBlock(stripTags(inner));
    }
  }

  if (blocks.length === 0) pushBlock(stripTags(work));
  // 段落之间空一行；列表项与相邻列表项之间不空行（保持 Markdown 的紧凑列表）。
  return cleanMarkdown(blocks.join('\n\n'));
}

/**
 * source:builtin-extraction.ts:225-241
 *
 * 上游是 Readability + turndown；本包是自研抽取（见文件头）。
 * 返回 `{ title, markdown }`，空正文时两者都为空串 —— 调用的 `assertContentSuccess`
 * 会把它判成 `empty`，与上游一致。
 */
export function extractHtmlToMarkdown(html, url) {
  const title = stripTags(sliceTag(html, 'title'));
  const markdown = htmlToMarkdownBody(html);
  void url; // Readability 会用 URL 解析相对链接；本包不做相对链接补全（已知取舍）
  return {
    title: normalizeUntrustedText(title).trim(),
    markdown,
  };
}

/** source:builtin-extraction.ts:345-364 */
function matchingBlockedMarker(content, markers) {
  const compact = normalizeUntrustedText(content).replace(/\s+/gu, '').toLowerCase();
  return markers.find((marker) => compact.includes(marker.toLowerCase()));
}

export function assertContentSuccess(markdown, markers, minChars) {
  const compact = markdown.replace(/\s+/gu, '');
  const blocked = matchingBlockedMarker(compact, markers);
  if (blocked) {
    throw new MediaError('E_UPSTREAM_ERROR', `页面被反爬验证拦下（${blocked}）`, {
      reason: 'blocked',
      retryable: false,
    });
  }
  if (compact.length === 0) {
    throw new MediaError('E_UPSTREAM_ERROR', '抽取到的正文为空', { reason: 'empty', retryable: false });
  }
  if (compact.length < minChars) {
    throw new MediaError(
      'E_UPSTREAM_ERROR',
      `抽取到的正文太短（${compact.length} 字，阈值 ${minChars}）`,
      { reason: 'empty', retryable: false },
    );
  }
}

/** source:builtin-extraction.ts:366-375 —— 只做协议/凭证校验，出口策略交给宿主。 */
export function normalizeUrlForFetch(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    throw invalidInput(`不是合法 URL：${input}`, 'url');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw invalidInput(`不支持的协议：${url.protocol}`, 'url');
  if (url.username || url.password) throw invalidInput('URL 不允许带凭证', 'url');
  if (Array.from(String(input)).length > 8192) throw invalidInput('URL 过长', 'url');
  return url;
}

/**
 * 内置读取器：下载 → 限额 → 反爬检查 → 抽正文。
 *
 * source:builtin-extraction.ts:366-560，重定向/内容类型/大小/正文阈值全部保留。
 * `extractPdf` 是可选的 PDF 委派（上游走 document service；本包直接复用本包的 PDF 解析）。
 */
export async function fetchAndExtractUrl(ctx, input, options = {}) {
  const source = normalizeUrlForFetch(input);
  const fetchImpl = ctx.fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const bodyTimeoutMs = options.bodyTimeoutMs ?? BODY_TIMEOUT_MS;
  const markers = options.blockedMarkers ?? antiBotMarkers();

  let current = source;
  let headers = { accept: [...ALLOWED_CONTENT_TYPES].join(', ') };

  for (let redirects = 0; ; redirects += 1) {
    if (options.signal?.aborted) throw new MediaError('E_CANCELLED', '操作已取消');

    const response = await fetchImpl(current.href, {
      method: 'GET',
      redirect: 'manual',
      headers,
      signal: options.signal,
    });

    if (response.status >= 300 && response.status < 400) {
      if (redirects >= MAX_REDIRECTS) {
        throw new MediaError('E_UPSTREAM_ERROR', `重定向过多（上限 ${MAX_REDIRECTS}）`, { retryable: false });
      }
      const location = response.headers.get('location');
      if (!location) throw new MediaError('E_UPSTREAM_ERROR', '重定向响应没有 Location', { retryable: false });
      const next = normalizeUrlForFetch(new URL(location, current.href).href);
      await response.body?.cancel().catch(() => undefined);
      if (options.isUrlAllowed && !(await options.isUrlAllowed(next.href))) {
        throw new MediaError('E_UPSTREAM_ERROR', '重定向目标不被会话信任门允许', { reason: 'blocked' });
      }
      if (next.origin !== current.origin) {
        // 跨源时丢掉可能带了凭证的请求头（上游同样处理）。
        const { authorization: _a, cookie: _c, ...safe } = headers;
        headers = safe;
      }
      current = next;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw upstreamError('网页抓取', response.status, '');
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new MediaError('E_UPSTREAM_ERROR', `不支持的内容类型：${contentType || '(缺失)'}`, {
        reason: 'unsupported_content_type',
        retryable: false,
      });
    }

    const downloaded = await readWithTruncation(response, maxBytes, options.signal, bodyTimeoutMs);

    if (contentType !== 'application/pdf') {
      const blocked = matchingBlockedMarker(downloaded.bytes.toString('utf8'), markers);
      if (blocked) {
        throw new MediaError('E_UPSTREAM_ERROR', `页面被反爬验证拦下（${blocked}）`, { reason: 'blocked' });
      }
    }

    let extracted;
    let extraTruncated = false;
    if (contentType === 'text/html' || contentType === 'application/xhtml+xml') {
      extracted = extractHtmlToMarkdown(downloaded.bytes.toString('utf8'), current.href);
    } else if (contentType === 'application/pdf') {
      if (typeof options.extractPdf !== 'function') {
        throw new MediaError('E_UNSUPPORTED_PROVIDER', '这个页面是 PDF，但调用方没有启用 PDF 解析', {
          contentType,
        });
      }
      const parsed = await options.extractPdf(downloaded.bytes);
      extracted = { title: parsed.title ?? '', markdown: parsed.text ?? '' };
      extraTruncated = parsed.truncated === true;
    } else {
      extracted = { title: '', markdown: cleanMarkdown(downloaded.bytes.toString('utf8')) };
    }

    assertContentSuccess(extracted.markdown, markers, options.minChars ?? contentThreshold());

    const fallbackTitle = decodeURIComponent(
      current.pathname.split('/').filter(Boolean).at(-1) ?? current.hostname,
    );
    return {
      sourceUrl: source.href,
      finalUrl: current.href,
      title: extracted.title || fallbackTitle,
      markdown: extracted.markdown,
      fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
      contentType,
      truncated: downloaded.truncated || extraTruncated,
      downloadedBytes: downloaded.bytes.byteLength,
    };
  }
}

// ── 托管抓取 provider ───────────────────────────────────────────────────────

/**
 * source:providers/kimi.ts:6-15 —— 端点由 baseURL 决定（`/coding/v1` 用 `/fetch`）。
 */
export function kimiFetchEndpoint(baseUrl) {
  const base = new URL(baseUrl);
  if (base.search || base.hash || base.username || base.password) {
    throw invalidInput('网页抓取的 baseURL 非法', 'baseUrl');
  }
  const coding =
    ['api.kimi.com', 'api.kimi.ai'].includes(base.hostname)
    && base.pathname.replace(/\/+$/, '') === '/coding/v1';
  return `${base.href.replace(/\/+$/, '')}${coding ? '/fetch' : '/tools/fetch'}`;
}

/** source:providers/kimi.ts:18-35 —— 只重试传输层错误，HTTP/解析错误不重试。 */
function isTransportError(error) {
  const seen = new Set();
  while (error && typeof error === 'object' && !seen.has(error)) {
    if (error instanceof TypeError) return true;
    seen.add(error);
    const { code, cause } = error;
    if (
      typeof code === 'string'
      && (/^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN)$/.test(code)
        || /^(ERR_TLS_|ERR_SSL_|CERT_)/.test(code))
    ) {
      return true;
    }
    error = cause;
  }
  return false;
}

/** source:providers/kimi.ts:56-150 */
export async function fetchWithKimi(ctx, url, options = {}) {
  const apiKey = options.apiKey;
  if (!apiKey) throw invalidInput('Kimi 抓取需要 API key', 'apiKey');
  const deadlineMs = options.bodyTimeoutMs ?? 30_000;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(deadlineMs)])
    : AbortSignal.timeout(deadlineMs);
  const endpoint = kimiFetchEndpoint(options.baseUrl || 'https://api.moonshot.cn/v1');

  let response;
  for (let attempt = 0; ; attempt += 1) {
    if (signal.aborted) throw signal.reason ?? new MediaError('E_CANCELLED', '操作已取消');
    try {
      response = await ctx.fetch(endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal,
      });
      break;
    } catch (error) {
      if (attempt !== 0 || !isTransportError(error)) throw error;
    }
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw upstreamError('Kimi 抓取', response.status, '');
  }

  const body = await readWithTruncation(
    response,
    4 * (options.maxBytes ?? DEFAULT_MAX_BYTES) + 65_536,
    signal,
    deadlineMs,
  );
  if (body.truncated) throw new MediaError('E_UPSTREAM_ERROR', '抓取响应超过传输字节上限');
  let result;
  try {
    result = JSON.parse(body.bytes.toString('utf8'));
  } catch {
    throw new MediaError('E_INVALID_RESPONSE', '抓取返回的不是合法 JSON');
  }
  const markdown = result?.markdown ?? result?.content;
  if (typeof markdown !== 'string') throw new MediaError('E_INVALID_RESPONSE', '抓取响应没有 Markdown 正文');
  return {
    markdown,
    ...(typeof result.title === 'string' ? { title: result.title } : {}),
    ...(typeof result.url === 'string' ? { finalUrl: result.url } : {}),
  };
}

/** source:providers/deepseek.ts:44-149 */
export async function fetchWithDeepSeek(ctx, url, options = {}) {
  normalizeUrlForFetch(url);
  const apiKey = options.apiKey;
  if (!apiKey) throw invalidInput('DeepSeek 抓取需要 API key', 'apiKey');
  const deadlineMs = options.bodyTimeoutMs ?? 30_000;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(deadlineMs)])
    : AbortSignal.timeout(deadlineMs);
  const endpoint = deepseekToolsEndpoint(options.baseUrl || 'https://api.deepseek.com/v1', 'fetch');

  const response = await ctx.fetch(endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
    signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 403) {
      throw new MediaError('E_UPSTREAM_ERROR', '无法抓取：DeepSeek 安全策略拒绝了该 URL（HTTP 403）', {
        retryable: false,
      });
    }
    if (response.status === 404) {
      throw new MediaError('E_UPSTREAM_ERROR', '无法抓取：DeepSeek 没有取到可用内容（HTTP 404）', {
        retryable: false,
      });
    }
    throw upstreamError('DeepSeek 抓取', response.status, '');
  }

  const body = await readWithTruncation(
    response,
    4 * (options.maxBytes ?? DEFAULT_MAX_BYTES) + 65_536,
    signal,
    deadlineMs,
  );
  if (body.truncated) throw new MediaError('E_UPSTREAM_ERROR', '抓取响应超过传输字节上限');
  let result;
  try {
    result = JSON.parse(body.bytes.toString('utf8'));
  } catch {
    throw new MediaError('E_INVALID_RESPONSE', '抓取返回的不是合法 JSON');
  }
  if (typeof result?.content !== 'string') {
    throw new MediaError('E_INVALID_RESPONSE', '抓取响应没有 Markdown 正文');
  }
  return {
    markdown: result.content,
    ...(typeof result.title === 'string' && result.title.trim() ? { title: result.title } : {}),
  };
}

/** source:providers/firecrawl.ts:30-124 */
export async function fetchWithFirecrawl(ctx, url, options = {}) {
  const apiKey = options.apiKey;
  if (!apiKey) throw invalidInput('Firecrawl 抓取需要 API key', 'apiKey');
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 30_000;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(bodyTimeoutMs)])
    : AbortSignal.timeout(bodyTimeoutMs);
  const endpoint = firecrawlEndpoint(options.baseUrl || FIRECRAWL_DEFAULT_BASE_URL, 'scrape');

  // 不重试：一次 scrape 是计费请求，可能已经跑过。
  const response = await ctx.fetch(endpoint, {
    method: 'POST',
    redirect: 'manual',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      timeout: bodyTimeoutMs,
      origin: 'openmaic',
    }),
    signal,
  });

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw upstreamError('Firecrawl 抓取', response.status, '');
  }

  const body = await readWithTruncation(
    response,
    4 * (options.maxBytes ?? DEFAULT_MAX_BYTES) + 65_536,
    signal,
    bodyTimeoutMs,
  );
  if (body.truncated) throw new MediaError('E_UPSTREAM_ERROR', '抓取响应超过传输字节上限');
  let result;
  try {
    result = JSON.parse(body.bytes.toString('utf8'));
  } catch {
    throw new MediaError('E_INVALID_RESPONSE', '抓取返回的不是合法 JSON');
  }
  if (result?.success !== true || !result.data || typeof result.data !== 'object') {
    throw new MediaError('E_INVALID_RESPONSE', '抓取响应格式非法');
  }
  const { markdown, metadata } = result.data;
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  // Firecrawl 对"上游页面失败"也回 200，按内置读取器的口径报错。
  if (typeof meta.statusCode === 'number' && meta.statusCode >= 400) {
    throw new MediaError('E_UPSTREAM_ERROR', `远端返回 HTTP ${meta.statusCode}`, { retryable: false });
  }
  if (typeof markdown !== 'string') throw new MediaError('E_INVALID_RESPONSE', '抓取响应没有 Markdown 正文');
  return {
    markdown,
    ...(typeof meta.title === 'string' ? { title: meta.title } : {}),
    ...(typeof meta.url === 'string' ? { finalUrl: meta.url } : {}),
  };
}

const ROUTES = {
  builtin: (ctx, url, options) => fetchAndExtractUrl(ctx, url, options),
  kimi: fetchWithKimi,
  deepseek: fetchWithDeepSeek,
  firecrawl: fetchWithFirecrawl,
};

/**
 * 抓一页。
 *
 * source:web-fetch/registry.ts:8-16 的 provider 表 + `builtin` 作为默认。
 * `config.providerId` 缺省时由服务层按 `WEB_FETCH_PRIORITY` 选第一个可用的。
 */
export async function fetchPage(ctx, config, url, options = {}) {
  const route = ROUTES[config.providerId];
  if (!route) throw unsupportedProvider('网页抓取', config.providerId, Object.keys(WEB_FETCH_PROVIDERS));
  return route(ctx, url, {
    ...options,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  });
}

export { FETCH_HEADERS_TIMEOUT_MS };
