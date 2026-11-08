// 源：ref/OpenMAIC/lib/web-search/index.ts:18-91（searchWeb 的 provider switch）
// 源：ref/OpenMAIC/lib/web-search/tavily.ts:16-81
// 源：ref/OpenMAIC/lib/web-search/exa.ts:15-94
// 源：ref/OpenMAIC/lib/web-search/bocha.ts:15-112
// 源：ref/OpenMAIC/lib/web-search/searxng.ts:20-118
// 源：ref/OpenMAIC/lib/web-search/brave.ts:28-258（API 模式 + 免 key 抓取模式）
// 源：ref/OpenMAIC/lib/web-search/minimax.ts:21-145
// 源：ref/OpenMAIC/lib/web-search/doubao.ts:21-124
// 源：ref/OpenMAIC/lib/web-search/kimi.ts:20-94
// 源：ref/OpenMAIC/lib/web-search/deepseek.ts:17-68 + deepseek-endpoint.ts:2-16
// 源：ref/OpenMAIC/lib/web-search/firecrawl.ts:21-83 + firecrawl-endpoint.ts:19-33
// 源：ref/OpenMAIC/lib/web-search/baidu.ts:23-271
// 源：ref/OpenMAIC/lib/web-search/claude.ts:18-173
// 源：ref/OpenMAIC/lib/web-search/format.ts:1-22、utils.ts:5-9、constants.ts:10-160
//
// # provider 分支一个不少
//
// tavily / exa / bocha / searxng / brave / minimax / doubao / kimi / deepseek /
// firecrawl / baidu / claude。
//
// # Claude 分支的改写
//
// 上游用 `@ai-sdk/anthropic` + `callLLM` 走 Anthropic 原生的 server-side
// `web_search` 工具。本仓不引 SDK，改成直接 `POST /v1/messages`：请求体形状与
// SDK 序列化出来的完全一致（`tools:[{type:'web_search_20250305', name:'web_search'}]`），
// 响应里从 `content[].citations` 取 url/title 去重 —— 这正是上游 `result.sources` 的来源。
// `allowed_callers: ['direct']` 那条补丁（claude.ts:49-67）保留：基础工具必须带它。

import { invalidInput, upstreamError, unsupportedProvider } from '../errors.js';
import { WEB_SEARCH_PROVIDERS } from '../providers.js';

const MAX_WEB_SEARCH_QUERY_LENGTH = 400;

/** source:web-search/utils.ts:5-9 */
export function normalizeWebSearchQuery(query) {
  return String(query ?? '').trim().slice(0, MAX_WEB_SEARCH_QUERY_LENGTH);
}

/** source:web-search/format.ts:6-22 */
export function formatSearchResultsAsContext(result) {
  if (!result?.answer && (result?.sources?.length ?? 0) === 0) return '';
  const lines = [];
  if (result.answer) {
    lines.push(result.answer);
    lines.push('');
  }
  if (result.sources.length > 0) {
    lines.push('Sources:');
    for (const src of result.sources) {
      lines.push(`- [${src.title}](${src.url}): ${String(src.content ?? '').slice(0, 200)}`);
    }
  }
  return lines.join('\n');
}

async function errorText(response) {
  return response.text().catch(() => response.statusText);
}

const clamp = (value, min, max) => Math.min(Math.max(Math.floor(value), min), max);

// ── tavily ────────────────────────────────────────────────────────────────
function buildTavilySearchUrl(baseUrl) {
  const trimmed = (baseUrl || 'https://api.tavily.com').replace(/\/$/, '');
  return trimmed.endsWith('/search') ? trimmed : `${trimmed}/search`;
}

/** source:tavily.ts:24-81 */
export async function searchWithTavily(ctx, params) {
  const { query, apiKey, maxResults = 5, baseUrl, signal } = params;
  const res = await ctx.fetch(buildTavilySearchUrl(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: query.slice(0, MAX_WEB_SEARCH_QUERY_LENGTH), // Tavily 超过 400 字直接 400
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: 'basic',
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw upstreamError('Tavily', res.status, await errorText(res));
  const data = await res.json();
  return {
    answer: data.answer || '',
    sources: (data.results || []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    })),
    query: data.query,
    responseTime: data.response_time,
  };
}

// ── exa ───────────────────────────────────────────────────────────────────
function buildExaSearchUrl(baseUrl) {
  const trimmed = (baseUrl || 'https://api.exa.ai').replace(/\/+$/, '');
  return trimmed.endsWith('/search') ? trimmed : `${trimmed}/search`;
}

/** source:exa.ts:30-47 */
function mapExaResult(result, index) {
  const url = (result.url || result.id || '').trim();
  if (!url) return undefined;
  const highlights = Array.isArray(result.highlights)
    ? result.highlights.map((h) => h.trim()).filter(Boolean).join('\n\n')
    : '';
  return {
    title: result.title?.trim() || url,
    url,
    content: highlights || result.summary?.trim() || result.text?.trim() || '',
    score: typeof result.score === 'number' ? result.score : Number((1 - index * 0.05).toFixed(2)),
  };
}

/** source:exa.ts:49-94 */
export async function searchWithExa(ctx, params) {
  const { apiKey, maxResults = 5, baseUrl, signal } = params;
  const query = normalizeWebSearchQuery(params.query);
  const numResults = clamp(maxResults, 1, 100);
  const startedAt = Date.now();

  const res = await ctx.fetch(buildExaSearchUrl(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, type: 'auto', numResults, contents: { highlights: true } }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw upstreamError('Exa', res.status, await errorText(res));

  const data = await res.json();
  const sources = (Array.isArray(data.results) ? data.results : [])
    .map((result, index) => mapExaResult(result, index))
    .filter(Boolean)
    .slice(0, numResults);
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── bocha ─────────────────────────────────────────────────────────────────
function buildBochaWebSearchUrl(baseUrl) {
  const trimmed = (baseUrl || 'https://api.bocha.cn').replace(/\/$/, '');
  if (trimmed.endsWith('/v1/web-search')) return trimmed;
  if (trimmed.endsWith('/v1')) return `${trimmed}/web-search`;
  return `${trimmed}/v1/web-search`;
}

/** source:bocha.ts:26-43 */
function formatBochaError(status, statusText, errorText) {
  if (!errorText) return `Bocha API error (${status}): ${statusText}`;
  try {
    const parsed = JSON.parse(errorText);
    const code = parsed.code ?? status;
    const message = parsed.message || parsed.msg || statusText;
    const logId = parsed.log_id ? `, log_id: ${parsed.log_id}` : '';
    return `Bocha API error (${code}): ${message}${logId}`;
  } catch {
    return `Bocha API error (${status}): ${errorText}`;
  }
}

/** source:bocha.ts:48-112 */
export async function searchWithBocha(ctx, params) {
  const { apiKey, maxResults = 10, baseUrl, signal } = params;
  const query = params.query;
  const startedAt = Date.now();
  const res = await ctx.fetch(buildBochaWebSearchUrl(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query,
      freshness: 'noLimit',
      summary: true,
      count: clamp(maxResults, 1, 50),
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw upstreamError('Bocha', res.status, formatBochaError(res.status, res.statusText, await errorText(res)));

  const raw = await res.json();
  if (raw.code !== undefined && String(raw.code) !== '200') {
    throw upstreamError(
      'Bocha',
      raw.code,
      `${raw.message || raw.msg || 'Request failed'}${raw.log_id ? `, log_id: ${raw.log_id}` : ''}`,
    );
  }
  const data = raw.data || raw;
  const pages = data.webPages?.value || [];
  const sources = pages
    .filter((page) => page.url)
    .map((page) => ({
      title: page.name || page.url,
      url: page.url,
      content: page.summary || page.snippet || '',
      score: 0,
    }));
  return {
    answer: '',
    sources,
    query: data.queryContext?.originalQuery || query,
    responseTime: (Date.now() - startedAt) / 1000,
  };
}

// ── searxng ───────────────────────────────────────────────────────────────
const SEARXNG_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (compatible; OpenMAIC/1.0; +https://github.com/THU-MAIC/OpenMAIC)',
};

/** source:searxng.ts:20-27 */
export function buildSearxngSearchUrl(baseUrl, query) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  const root = trimmed.endsWith('/search') ? trimmed.slice(0, -'/search'.length) : trimmed;
  const url = new URL(`${root}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'json');
  return url.toString();
}

/** source:searxng.ts:29-118 */
export async function searchWithSearxng(ctx, params) {
  const { maxResults = 5, baseUrl, signal } = params;
  const query = normalizeWebSearchQuery(params.query);
  if (!baseUrl?.trim()) {
    throw invalidInput('SearXNG 必须配置 baseURL（自建实例没有公共默认值）', 'baseUrl');
  }
  const startedAt = Date.now();
  const res = await ctx.fetch(buildSearxngSearchUrl(baseUrl, query), {
    method: 'GET',
    headers: SEARXNG_HEADERS,
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw upstreamError('SearXNG', res.status, await errorText(res));

  let data;
  try {
    data = JSON.parse(await res.text());
  } catch {
    // 上游原话：实例没开 json 输出格式时就是这段。
    throw upstreamError('SearXNG', 200, '返回非 JSON，请确认实例的 search.formats 开了 "json"');
  }
  const sources = (Array.isArray(data.results) ? data.results : [])
    .map((result, index) => {
      const url = (result.url || result.link || '').trim();
      if (!url) return undefined;
      return {
        title: (result.title || '').trim() || url,
        url,
        content: (result.content || '').trim(),
        score: typeof result.score === 'number' ? result.score : Number((1 - index * 0.05).toFixed(2)),
      };
    })
    .filter(Boolean)
    .slice(0, maxResults);
  return { answer: '', sources, query: data.query || query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── brave ─────────────────────────────────────────────────────────────────
const BRAVE_DEFAULT_BASE_URL = 'https://search.brave.com';
const BRAVE_API_BASE_URL = 'https://api.search.brave.com';
const BRAVE_MAX_ERROR_DETAIL = 200;

const BRAVE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** source:brave.ts:28-34 */
function buildBraveSearchUrl(query, baseUrl) {
  const trimmed = (baseUrl || BRAVE_DEFAULT_BASE_URL).replace(/\/+$/, '');
  const endpoint = trimmed.endsWith('/search') ? trimmed : `${trimmed}/search`;
  const url = new URL(endpoint);
  url.searchParams.set('q', query);
  return url.toString();
}

/** source:brave.ts:36-52 */
function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripHtml(value) {
  return decodeHtml(String(value ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function isBraveOwnedUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'brave.com' || host.endsWith('.brave.com');
  } catch {
    return true;
  }
}

/** source:brave.ts:63-109 —— 免 key 抓取模式的 HTML 解析。 */
export function parseBraveSearchHtml(html, maxResults) {
  const results = [];
  const snippetRegex =
    /<div[^>]*class="[^"]*\bsnippet\b[^"]*"[^>]*data-type="web"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bsnippet\b[^"]*"[^>]*data-type="web"|<footer|$)/gi;
  let snippetMatch;
  while ((snippetMatch = snippetRegex.exec(html)) !== null && results.length < maxResults) {
    const block = snippetMatch[1];
    const linkMatch = block.match(/<a[^>]*href="([^"]+)"[^>]*>/i);
    if (!linkMatch) continue;
    const url = decodeHtml(linkMatch[1].trim());
    if (!url || isBraveOwnedUrl(url)) continue;

    // 标题容器在 span / div 之间换过一次，两种都收；`\1` 让闭合标签必须配对。
    const titleMatch = block.match(/<(span|div)[^>]*class="[^"]*search-snippet-title[^"]*"[^>]*>([\s\S]*?)<\/\1>/i);
    const title = titleMatch ? stripHtml(titleMatch[2]) : '';
    if (!title) continue;

    const genericMatch = block.match(/<div[^>]*class="[^"]*generic-snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const descMatch = block.match(/<p[^>]*class="[^"]*snippet-description[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const content = stripHtml(genericMatch?.[1] || descMatch?.[1] || '')
      .replace(/^\d+ \w+ ago\s*-\s*/, '')
      .replace(/^[A-Z][a-z]+ \d+, \d{4}\s*-\s*/, '');

    results.push({ title, url, content, score: Number((1 - results.length * 0.1).toFixed(2)) });
  }
  return results;
}

/** source:brave.ts:120-162 */
function formatBraveError(mode, status, statusText, errorTextValue) {
  const label = mode === 'api' ? 'Brave API' : 'Brave Search';
  if (status === 429) {
    return mode === 'api'
      ? `${label} is rate-limited (429) by the Brave Search API plan. Retry later, switch to another web search provider, or raise the plan's rate limit.`
      : `${label} is temporarily rate-limited (429). Retry later, switch to another web search provider, or configure a Brave Search API key.`;
  }
  const detail = String(errorTextValue || '').trim();
  const isMarkup = detail.startsWith('<') || /<(!doctype|html)\b/i.test(detail);
  if (!detail || isMarkup || detail.length > BRAVE_MAX_ERROR_DETAIL) {
    return `${label} error (${status}): ${statusText || 'request failed'}`;
  }
  return `${label} error (${status}): ${detail}`;
}

/** source:brave.ts:168-235 */
async function searchWithBraveApi(ctx, query, apiKey, maxResults, signal) {
  const url = new URL('/res/v1/web/search', BRAVE_API_BASE_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(maxResults, 20)));
  const res = await ctx.fetch(url.toString(), {
    method: 'GET',
    headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw upstreamError('Brave API', res.status, formatBraveError('api', res.status, res.statusText, await errorText(res)));
  const data = await res.json();
  return (data.web?.results || [])
    .filter((r) => r.url)
    .slice(0, maxResults)
    .map((r, i) => ({
      title: r.title || '',
      url: r.url || '',
      content: stripHtml(r.description || ''),
      score: Number((1 - i * 0.05).toFixed(2)),
    }));
}

async function searchWithBraveScrape(ctx, query, maxResults, baseUrl, signal) {
  const res = await ctx.fetch(buildBraveSearchUrl(query, baseUrl), {
    method: 'GET',
    headers: BRAVE_HEADERS,
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    throw upstreamError('Brave Search', res.status, formatBraveError('scrape', res.status, res.statusText, await errorText(res)));
  }
  return parseBraveSearchHtml(await res.text(), maxResults);
}

/** source:brave.ts:237-258 —— 有 key 走 API，没 key 走抓取。 */
export async function searchWithBrave(ctx, params) {
  const { apiKey, maxResults = 5, baseUrl, signal } = params;
  const query = normalizeWebSearchQuery(params.query);
  const startedAt = Date.now();
  const sources = apiKey
    ? await searchWithBraveApi(ctx, query, apiKey, maxResults, signal)
    : await searchWithBraveScrape(ctx, query, maxResults, baseUrl, signal);
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── minimax ───────────────────────────────────────────────────────────────
const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com';
const MINIMAX_QUOTA_STATUS_CODES = new Set(['1008', '2056']);

function buildMiniMaxWebSearchUrl(baseUrl) {
  const trimmed = (baseUrl || MINIMAX_DEFAULT_BASE_URL).replace(/\/$/, '');
  if (trimmed.endsWith('/v1/coding_plan/search')) return trimmed;
  if (trimmed.endsWith('/v1/coding_plan')) return `${trimmed}/search`;
  if (trimmed.endsWith('/v1')) return `${trimmed}/coding_plan/search`;
  return `${trimmed}/v1/coding_plan/search`;
}

function getMiniMaxBaseResp(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw.base_resp || raw.baseResp;
  return value && typeof value === 'object' ? value : undefined;
}

/** source:minimax.ts:43-60 */
function formatMiniMaxError(status, statusText, errorTextValue) {
  if (!errorTextValue) return `MiniMax Web Search API error (${status}): ${statusText}`;
  try {
    const parsed = JSON.parse(errorTextValue);
    const baseResp = getMiniMaxBaseResp(parsed);
    const code = baseResp?.status_code ?? parsed.code ?? status;
    const message = baseResp?.status_msg || parsed.message || parsed.error?.message || statusText;
    return `MiniMax Web Search API error (${code}): ${message}`;
  } catch {
    return `MiniMax Web Search API error (${status}): ${errorTextValue}`;
  }
}

/** source:minimax.ts:85-145 */
export async function searchWithMiniMax(ctx, params) {
  const { apiKey, maxResults = 10, baseUrl, signal } = params;
  const query = params.query;
  const startedAt = Date.now();
  const res = await ctx.fetch(buildMiniMaxWebSearchUrl(baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'MM-API-Source': 'OpenMAIC',
    },
    body: JSON.stringify({ q: query }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    const body = await errorText(res);
    const statusCode = (() => {
      try {
        return getMiniMaxBaseResp(JSON.parse(body))?.status_code;
      } catch {
        return undefined;
      }
    })();
    if (statusCode !== undefined && MINIMAX_QUOTA_STATUS_CODES.has(String(statusCode))) {
      throw upstreamError('MiniMax Web Search', 402, formatMiniMaxError(res.status, res.statusText, body));
    }
    throw upstreamError('MiniMax Web Search', res.status, formatMiniMaxError(res.status, res.statusText, body));
  }

  const raw = await res.json();
  const baseResp = getMiniMaxBaseResp(raw);
  if (baseResp?.status_code !== undefined && String(baseResp.status_code) !== '0') {
    throw upstreamError(
      'MiniMax Web Search',
      baseResp.status_code,
      `${baseResp.status_msg || 'Request failed'}`,
    );
  }
  const organic = raw.organic || raw.data?.organic || raw.results || [];
  const sources = organic
    .map((item) => {
      const url = item.link || item.url || '';
      return {
        title: item.title || url,
        url,
        content: item.snippet || item.summary || item.content || item.date || '',
        score: 0,
      };
    })
    .filter((source) => source.url)
    .slice(0, Math.max(Math.floor(maxResults), 1));
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── doubao ────────────────────────────────────────────────────────────────
const DOUBAO_DEFAULT_BASE_URL = 'https://open.feedcoopapi.com';
const DOUBAO_SEARCH_PATH = '/search_api/web_search';
const DOUBAO_MAX_QUERY_LENGTH = 100;

function buildDoubaoSearchUrl(baseUrl) {
  const trimmed = (baseUrl || DOUBAO_DEFAULT_BASE_URL).replace(/\/$/, '');
  return trimmed.endsWith(DOUBAO_SEARCH_PATH) ? trimmed : `${trimmed}${DOUBAO_SEARCH_PATH}`;
}

/** source:doubao.ts:70-124 */
export async function searchWithDoubao(ctx, params) {
  const { apiKey, maxResults = 10, baseUrl, signal } = params;
  const query = params.query;
  const startedAt = Date.now();
  const limit = Math.max(Math.floor(maxResults), 1);

  const res = await ctx.fetch(buildDoubaoSearchUrl(baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      Query: query.slice(0, DOUBAO_MAX_QUERY_LENGTH),
      SearchType: 'web',
      Count: Math.min(limit, 50),
      NeedSummary: true,
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) throw upstreamError('Doubao Web Search', res.status, await errorText(res));

  const raw = await res.json();
  const err = raw.ResponseMetadata?.Error;
  // 豆包失败也常是 HTTP 200，错误放在 body 里。
  if (err && (err.Code || err.CodeN || err.Message)) {
    throw upstreamError(
      'Doubao Web Search',
      err.Code ?? err.CodeN ?? res.status,
      err.Message || res.statusText,
    );
  }
  const sources = (raw.Result?.WebResults || [])
    .map((item) => ({
      title: item.Title || item.Url || '',
      url: item.Url || '',
      content: item.Summary || item.Content || item.Snippet || '',
      score: typeof item.RankScore === 'number' ? item.RankScore : 0,
    }))
    .filter((source) => source.url)
    .slice(0, limit);
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── kimi ──────────────────────────────────────────────────────────────────
const KIMI_DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1';

/** source:kimi.ts:20-24 */
function kimiSearchEndpoint(baseUrl) {
  const base = baseUrl.replace(/\/+$/, '');
  const coding = new URL(base).pathname.replace(/\/+$/, '').endsWith('/coding/v1');
  return { url: `${base}${coding ? '/search' : '/tools/search_pro'}`, coding };
}

/** source:kimi.ts:26-94 */
export async function searchWithKimi(ctx, params) {
  const { apiKey, maxResults = 10, baseUrl, signal } = params;
  const query = normalizeWebSearchQuery(params.query);
  const startedAt = Date.now();
  const limit = Number.isFinite(maxResults) ? Math.min(20, Math.max(1, Math.floor(maxResults))) : 10;
  const { url, coding } = kimiSearchEndpoint(baseUrl || KIMI_DEFAULT_BASE_URL);

  const res = await ctx.fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      text_query: query,
      limit,
      timeout_seconds: 30,
      ...(coding ? { enable_page_crawling: true } : {}),
    }),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    const body = await errorText(res);
    let message = body || res.statusText;
    try {
      message = JSON.parse(body).error?.message || message;
    } catch {
      /* 非 JSON 错误体保留原文 */
    }
    throw upstreamError('Kimi Web Search', res.status, message);
  }

  const raw = await res.json();
  if (raw.error) throw upstreamError('Kimi Web Search', raw.error.code || res.status, raw.error.message || 'Request failed');
  if (!Array.isArray(raw.search_results)) {
    throw upstreamError('Kimi Web Search', 200, 'search_results 字段非法');
  }
  const sources = raw.search_results
    .map((item) => ({
      title: item.title || item.url || '',
      url: item.url || '',
      content:
        (coding
          ? item.content
          : item.chunks?.map((chunk) => chunk.text || '').filter((text) => text.trim()).join('\n\n'))
        || item.snippet
        || '',
      score: 0,
    }))
    .filter((source) => source.url)
    // Coding Plan 会忽略 limit，两端都在本地截一次。
    .slice(0, limit);
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── deepseek ──────────────────────────────────────────────────────────────
/** source:deepseek-endpoint.ts:2-16 */
export function deepseekToolsEndpoint(baseUrl, tool) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash || base.username || base.password) {
    throw invalidInput('DeepSeek API base URL 非法', 'baseUrl');
  }
  const path = base.hostname === 'api.deepseek.com' ? '/v1' : base.pathname.replace(/\/+$/, '');
  base.pathname = `${path || '/v1'}/tools/${tool}`;
  return base.href;
}

/** source:deepseek.ts:17-68 */
export async function searchWithDeepSeek(ctx, params) {
  const { apiKey, maxResults = 10, baseUrl = 'https://api.deepseek.com/v1', signal } = params;
  // 按码点切，避免 astral 字符被切成落单代理项。
  const query = Array.from(String(params.query ?? '').trim()).slice(0, 128).join('');
  if (!query) throw invalidInput('DeepSeek 检索需要非空 query', 'query');
  const count = Number.isFinite(maxResults) ? Math.min(50, Math.max(1, Math.floor(maxResults))) : 10;
  const startedAt = Date.now();

  const response = await ctx.fetch(deepseekToolsEndpoint(baseUrl, 'search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, count, need_content: false }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    const body = await errorText(response);
    let message = body || response.statusText;
    try {
      message = JSON.parse(body).error?.message || message;
    } catch {
      /* 保留原文 */
    }
    throw upstreamError('DeepSeek Web Search', response.status, message);
  }
  const raw = await response.json();
  if (raw?.error) throw upstreamError('DeepSeek Web Search', raw.error.code || response.status, raw.error.message || 'Request failed');
  if (!Array.isArray(raw?.results)) throw upstreamError('DeepSeek Web Search', 200, 'results 字段非法');

  const sources = raw.results
    .map((item) => ({
      title: item.title || item.url || '',
      url: item.url || '',
      content: item.summary?.trim() ? item.summary : item.snippet || '',
      score: item.rerank_score ?? 0,
    }))
    .filter((source) => source.url)
    .slice(0, count);
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── firecrawl ─────────────────────────────────────────────────────────────
export const FIRECRAWL_DEFAULT_BASE_URL = 'https://api.firecrawl.dev';

/** source:firecrawl-endpoint.ts:19-33 */
export function firecrawlEndpoint(baseUrl, tool) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.search || base.hash || base.username || base.password) {
    throw invalidInput('Firecrawl API base URL 非法', 'baseUrl');
  }
  const root = base.pathname.replace(/\/+$/, '').replace(/\/v2(?:\/(?:search|scrape))?$/, '');
  base.pathname = `${root}/v2/${tool}`;
  return base.href;
}

/** source:firecrawl.ts:36-83 */
export async function searchWithFirecrawl(ctx, params) {
  const { apiKey, maxResults = 5, baseUrl, signal } = params;
  const query = normalizeWebSearchQuery(params.query);
  const limit = Number.isFinite(maxResults) ? Math.max(1, Math.min(Math.floor(maxResults), 100)) : 5;
  const startedAt = Date.now();

  const res = await ctx.fetch(firecrawlEndpoint(baseUrl || FIRECRAWL_DEFAULT_BASE_URL, 'search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, limit, origin: 'openmaic' }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    // 不回传厂商原文：可能回显凭证或请求内容。
    throw upstreamError('Firecrawl', res.status, '');
  }

  const data = await res.json();
  const sources = (Array.isArray(data.data?.web) ? data.data.web : [])
    .map((result, index) => {
      const url = (result.url || '').trim();
      if (!url) return undefined;
      return {
        title: result.title?.trim() || url,
        url,
        content: (result.description || '').replace(/\s+/g, ' ').trim(),
        score: Number((1 - index * 0.05).toFixed(2)),
      };
    })
    .filter(Boolean)
    .slice(0, limit);
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── baidu ─────────────────────────────────────────────────────────────────
const BAIDU_QIANFAN_BASE_URL = 'https://qianfan.baidubce.com';
const BAIDU_BAIKE_BASE_URL = 'https://appbuilder.baidu.com';
const BAIDU_WEB_SEARCH_PATH = '/v2/ai_search/web_search';
const BAIDU_BAIKE_PATH = '/v2/baike/lemma/get_content';
const BAIDU_SCHOLAR_PATH = '/v2/tools/baidu_scholar/search';

function baiduHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'X-Appbuilder-From': 'openmaic',
    'Content-Type': 'application/json',
  };
}

function buildQianfanUrl(path, baseUrl) {
  return `${(baseUrl || BAIDU_QIANFAN_BASE_URL).replace(/\/+$/, '')}${path}`;
}

function buildBaikeUrl(query) {
  const url = new URL(`${BAIDU_BAIKE_BASE_URL}${BAIDU_BAIKE_PATH}`);
  url.searchParams.set('search_type', 'lemmaTitle');
  url.searchParams.set('search_key', query);
  return url.toString();
}

function buildScholarUrl(query, baseUrl) {
  const url = new URL(buildQianfanUrl(BAIDU_SCHOLAR_PATH, baseUrl));
  url.searchParams.set('wd', query);
  url.searchParams.set('pageNum', '0');
  url.searchParams.set('enable_ai_abstract', 'true');
  return url.toString();
}

/** source:baidu.ts:58-103 */
async function fetchBaiduWeb(ctx, query, apiKey, maxResults, baseUrl, signal) {
  try {
    const res = await ctx.fetch(buildQianfanUrl(BAIDU_WEB_SEARCH_PATH, baseUrl), {
      method: 'POST',
      headers: baiduHeaders(apiKey),
      body: JSON.stringify({
        messages: [{ content: query, role: 'user' }],
        search_source: 'baidu_search_v2',
        resource_type_filter: [{ type: 'web', top_k: maxResults }],
      }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code && data.code !== 0) return [];
    return (data.references || [])
      .filter((ref) => ref.url)
      .slice(0, maxResults)
      .map((ref, index) => ({
        title: ref.title || ref.site_name || ref.url || '',
        url: ref.url || '',
        content: ref.content || '',
        score: Number((0.9 - index * 0.05).toFixed(2)),
      }));
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return [];
  }
}

/** source:baidu.ts:105-141 */
async function fetchBaike(ctx, query, apiKey, signal) {
  try {
    const res = await ctx.fetch(buildBaikeUrl(query), {
      method: 'GET',
      headers: baiduHeaders(apiKey),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if ((data.errno !== undefined && data.errno !== 0) || !data.result) return [];
    const result = data.result;
    const title = result.lemma_title || query;
    return [
      {
        title: `${title} - Baidu Baike`,
        url: result.lemma_url || `https://baike.baidu.com/item/${encodeURIComponent(query)}`,
        content: result.abstract_text || result.lemma_desc || '',
        score: 0.95,
      },
    ];
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return [];
  }
}

/** source:baidu.ts:143-187 */
async function fetchScholar(ctx, query, apiKey, maxResults, baseUrl, signal) {
  try {
    const res = await ctx.fetch(buildScholarUrl(query, baseUrl), {
      method: 'GET',
      headers: baiduHeaders(apiKey),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.code && data.code !== '0') return [];
    return (data.data || [])
      .filter((paper) => paper.url)
      .slice(0, maxResults)
      .map((paper, index) => ({
        title: paper.title || paper.url || '',
        url: paper.url || '',
        content: [
          paper.abstract,
          paper.aiAbstract,
          paper.publishYear ? `(${paper.publishYear})` : '',
          paper.keyword,
        ]
          .filter(Boolean)
          .join(' '),
        score: Number((0.85 - index * 0.05).toFixed(2)),
      }));
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error;
    return [];
  }
}

/** source:baidu.ts:189-225 —— 三路并行、各自失败都不拖垮整体。 */
export async function searchWithBaidu(ctx, params) {
  const { apiKey, maxResults = 10, baseUrl, signal } = params;
  if (!apiKey) throw invalidInput('百度检索需要 API key', 'apiKey');
  const query = normalizeWebSearchQuery(params.query);
  const subSources = {
    webSearch: params.subSources?.webSearch ?? true,
    baike: params.subSources?.baike ?? true,
    scholar: params.subSources?.scholar ?? true,
  };
  const startedAt = Date.now();

  const [webResults, baikeResults, scholarResults] = await Promise.all([
    subSources.webSearch ? fetchBaiduWeb(ctx, query, apiKey, maxResults, baseUrl, signal) : [],
    subSources.baike ? fetchBaike(ctx, query, apiKey, signal) : [],
    subSources.scholar ? fetchScholar(ctx, query, apiKey, 3, baseUrl, signal) : [],
  ]);

  const seen = new Set();
  const sources = [...baikeResults, ...webResults, ...scholarResults].filter((source) => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
  return { answer: '', sources, query, responseTime: (Date.now() - startedAt) / 1000 };
}

// ── claude ────────────────────────────────────────────────────────────────
const CLAUDE_MAX_OUTPUT_TOKENS = 4096;
const BASIC_WEB_SEARCH_TOOL_TYPE = 'web_search_20250305';
const CLAUDE_DEFAULT_BASE_URL = 'https://api.anthropic.com/v1';
const CLAUDE_WEB_SEARCH_DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * source:claude.ts:34-39 —— 动态过滤版 web_search 只给 4.6+ Opus/Sonnet 与 5 系列。
 */
const DYNAMIC_WEB_SEARCH_MODEL =
  /^claude-(?:opus|sonnet)-4-[6-9](?:-|$)|^claude-(?:opus|sonnet|fable|mythos)-[5-9](?:-|$)/;

function usesBasicWebSearchTool(modelId) {
  return !DYNAMIC_WEB_SEARCH_MODEL.test(modelId);
}

/** source:claude.ts:76-89 */
function resolveClaudeBaseUrl(baseUrl) {
  const normalized = (baseUrl || CLAUDE_DEFAULT_BASE_URL).replace(/\/+$/, '');
  if (!normalized) return '';
  try {
    const parsed = new URL(normalized);
    const official = new URL(CLAUDE_DEFAULT_BASE_URL);
    // SDK 会在 baseURL 后直接拼 /messages；裸 origin 会打成 /messages 404。
    if (parsed.origin === official.origin && parsed.pathname === '/') return CLAUDE_DEFAULT_BASE_URL;
  } catch {
    /* 不可解析就交给请求层报错 */
  }
  return normalized;
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * source:claude.ts:103-173
 *
 * 换成直接 HTTP：请求体形状与 SDK 一致，`allowed_callers: ['direct']` 只补在
 * 基础工具上（动态过滤工具走 code-execution caller，钉死会让它失效）。
 */
export async function searchWithClaude(ctx, params) {
  const modelId = params.modelId || CLAUDE_WEB_SEARCH_DEFAULT_MODEL;
  const apiKey = String(params.apiKey ?? '').trim();
  const baseUrl = resolveClaudeBaseUrl(params.baseUrl?.trim());
  const basic = usesBasicWebSearchTool(modelId);

  const tool = {
    type: basic ? BASIC_WEB_SEARCH_TOOL_TYPE : 'web_search_20260209',
    name: 'web_search',
    ...(params.maxResults && params.maxResults > 0 ? { max_uses: params.maxResults } : {}),
    ...(basic ? { allowed_callers: ['direct'] } : {}),
  };

  const startedAt = Date.now();
  const response = await ctx.fetch(`${baseUrl}/messages`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: CLAUDE_MAX_OUTPUT_TOKENS,
      messages: [
        {
          role: 'user',
          content: `Search for the following and provide a comprehensive summary with source links: ${params.query}.`,
        },
      ],
      tools: [tool],
    }),
    ...(params.signal ? { signal: params.signal } : {}),
  });

  if (!response.ok) {
    throw upstreamError('Claude Web Search', response.status, await errorText(response));
  }

  const payload = await response.json();
  const sources = new Map();
  const texts = [];
  for (const block of payload?.content || []) {
    if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    // 引用就是 sources：Claude 的答案已经把页面内容消化掉了，这里只留引用。
    for (const citation of block?.citations || []) {
      const url = citation?.url;
      if (typeof url !== 'string' || !isHttpUrl(url) || sources.has(url)) continue;
      sources.set(url, {
        title: (typeof citation.title === 'string' && citation.title.trim()) || new URL(url).hostname,
        url,
        content: 'Referenced by the Claude web-search answer.',
        score: 1,
      });
    }
  }

  return {
    answer: texts.join('\n\n'),
    sources: [...sources.values()],
    query: params.query,
    responseTime: (Date.now() - startedAt) / 1000,
  };
}

// ── 路由 ──────────────────────────────────────────────────────────────────
const ROUTES = {
  tavily: searchWithTavily,
  exa: searchWithExa,
  bocha: searchWithBocha,
  searxng: searchWithSearxng,
  brave: searchWithBrave,
  minimax: searchWithMiniMax,
  doubao: searchWithDoubao,
  kimi: searchWithKimi,
  deepseek: searchWithDeepSeek,
  firecrawl: searchWithFirecrawl,
  baidu: searchWithBaidu,
  claude: searchWithClaude,
};

/**
 * 检索。source:web-search/index.ts:18-91 —— 参数透传与分支表逐条对应。
 *
 * @param {{fetch: Function}} ctx
 * @param {{providerId: string, apiKey?: string, baseUrl?: string, maxResults?: number,
 *          model?: string, subSources?: object, signal?: AbortSignal}} config
 * @param {string} query
 */
export async function searchWeb(ctx, config, query) {
  if (!query || !String(query).trim()) throw invalidInput('search(query) 需要非空查询串', 'query');
  const route = ROUTES[config.providerId];
  if (!route) throw unsupportedProvider('联网检索', config.providerId, Object.keys(ROUTES));
  const meta = WEB_SEARCH_PROVIDERS[config.providerId];
  if (meta?.requiresApiKey && !config.apiKey) {
    throw invalidInput(`${meta.name} 需要 API key`, 'apiKey');
  }

  return route(ctx, {
    query: String(query),
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    maxResults: config.maxResults,
    modelId: config.model,
    subSources: config.subSources,
    signal: config.signal,
  });
}
