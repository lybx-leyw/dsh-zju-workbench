/**
 * 互动页 HTML 的资产内联：样式、字体、脚本、图片、`srcset` 全部就地写入。
 *
 * 源：ref/OpenMAIC/lib/export/inline-assets.ts:1-858
 *     ref/OpenMAIC/lib/export/inline-assets-shared.ts:1-34（toDataUri / InlineReport）
 *     ref/OpenMAIC/lib/export/inline-assets-importmap.ts:1-163（importmap 相关，本包不搬）
 *
 * # 做了什么
 *
 * 1. `<style>`：递归展开 `@import`（保留 layer / supports / media 条件），把
 *    `url(...)` 换成 `data:` —— 字体（`@font-face src`）、背景图都在这一步进内联。
 * 2. `<link rel="stylesheet">`：抓取后换成 `<style>`。
 * 3. `<script src>`：抓取后换成内联脚本（保留 type 等属性；模块语法原样保留）。
 * 4. 资源属性：`img/src`、`img|source/srcset`（逐个候选解析后回写）、`video/src|poster`、
 *    `audio/src`、`track/src`、`embed/src`、`object/data`、`input/src`、
 *    `image/href|xlink:href`，以及任意元素 `style` 里的 `url(...)`。
 * 5. `<iframe srcdoc>`：递归处理嵌套文档（深度上限 4，与上游 stripMediaPayloads 同一上限）。
 *
 * # 与源的两处差别
 *
 * - **抓取失败的外链被丢弃。** 上游保留原 URL（导出的 CSP 会拦住它，页面上只是空图）。
 *   本仓的消费方式是 `<iframe srcdoc>`，且验收要求"不含外链 http 资源"，所以失败
 *   即移除该属性并记进 `report.failed`；`data:` 与已内联的值原样保留。
 * - **`importmap` 重写不搬。** 上游会把 bare specifier 映射到内联后的模块
 *   （inline-assets-importmap.ts），那要完整的 ESM 依赖图；本包只内联带 `src`
 *   的脚本，`<script type="module">` 里残留的裸导入记一条 failed，由页面包决定
 *   是否补 importmap。这一点在报告里单列。
 */

import { applyPatches, quoteAttributeValue, scanHtml } from './html-inventory.js';
import { cssImports, cssUrlReferences, rewriteCssValue, wrapImportedCss } from './css.js';
import { parseSrcset, stringifySrcset } from './srcset.js';

/** 源：inline-assets-shared.ts:1-34 —— `Blob` → `data:` URI（Node 侧用 Buffer）。 */
export function toDataUri(bytes, mimeType) {
  return `data:${mimeType || 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}`;
}

const MAX_SRDOC_DEPTH = 4;
const DEFAULT_TIMEOUT_MS = 15000;

/** 源：inline-assets.ts:22-35 —— 资源属性表，逐 tag 列举。 */
const RESOURCE_ATTRIBUTES = {
  img: ['src'],
  video: ['src', 'poster'],
  audio: ['src'],
  source: ['src'],
  track: ['src'],
  embed: ['src'],
  iframe: ['src'],
  object: ['data'],
  input: ['src'],
  image: ['href', 'xlink:href'],
};
const SRCSET_TAGS = new Set(['img', 'source']);
/** 无 `src` 可抓的标签：连到外网也没有意义，直接留给页面包处理。 */
const SCRIPT_TAGS = new Set(['script']);

const isDataUri = (value) => /^data:/i.test(String(value ?? '').trim());
const isHttp = (value) => /^https?:\/\//i.test(String(value ?? '').trim());

function guessMime(url, fallback = 'application/octet-stream') {
  const path = String(url).split(/[?#]/)[0];
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const table = {
    avif: 'image/avif',
    bmp: 'image/bmp',
    css: 'text/css',
    gif: 'image/gif',
    ico: 'image/x-icon',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    js: 'text/javascript',
    json: 'application/json',
    m4a: 'audio/mp4',
    mp3: 'audio/mpeg',
    mp4: 'video/mp4',
    ogg: 'audio/ogg',
    otf: 'font/otf',
    png: 'image/png',
    svg: 'image/svg+xml',
    ttf: 'font/ttf',
    wav: 'audio/wav',
    webm: 'video/webm',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };
  return table[extension] ?? fallback;
}

async function defaultFetcher(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) throw new Error('empty response');
    const header = response.headers?.get?.('content-type')?.split(';')[0]?.trim();
    return { bytes: buffer, mimeType: header || guessMime(url) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 内联一份 HTML 里的全部外部资产。
 *
 * @param {string} html
 * @param {{ fetcher?: (url:string)=>Promise<{bytes:Buffer|Uint8Array, mimeType?:string}>,
 *           baseUrl?: string, skipMedia?: boolean, depth?: number }} [options]
 * @returns {Promise<{html:string, report:{inlined:string[], failed:{url:string, reason:string}[]}}>}
 */
export async function inlineHtmlAssets(html, options = {}) {
  const report = { inlined: [], failed: [] };
  const source = typeof html === 'string' ? html : '';
  if (!source) return { html: source, report };

  const fetcher = typeof options.fetcher === 'function' ? options.fetcher : defaultFetcher;
  const baseUrl = options.baseUrl;
  const depth = options.depth ?? 0;
  const cache = new Map();

  const resolveUrl = (raw) => {
    const value = String(raw ?? '').trim();
    if (!value) return null;
    if (isDataUri(value)) return value;
    if (isHttp(value)) return value;
    if (baseUrl) {
      try {
        return new URL(value, baseUrl).toString();
      } catch {
        return null;
      }
    }
    return null;
  };

  /** 抓取并转成 data: URI；失败返回 null 并记账。 */
  const assetToDataUri = async (raw) => {
    const url = resolveUrl(raw);
    if (!url) {
      if (!isDataUri(raw)) report.failed.push({ url: String(raw), reason: 'unresolvable' });
      return null;
    }
    if (isDataUri(url)) return url;
    if (cache.has(url)) return cache.get(url);
    const pending = (async () => {
      try {
        const { bytes, mimeType } = await fetcher(url);
        const uri = toDataUri(bytes, mimeType || guessMime(url));
        report.inlined.push(url);
        return uri;
      } catch (error) {
        report.failed.push({ url, reason: error?.message ?? 'fetch-failed' });
        return null;
      }
    })();
    cache.set(url, pending);
    return pending;
  };

  /** `<style>` / `<link>` 里的样式表：展开 @import + 内联 url()。 */
  const inlineCss = async (css, cssUrl, seen = new Set()) => {
    let output = String(css ?? '');

    // @import：先递归展开（按源顺序，保留条件包装），再整条移除。
    const imports = cssImports(output);
    const replacements = [];
    for (const entry of imports) {
      const target = resolveUrl(entry.url);
      if (!target || isDataUri(target) || seen.has(target)) continue;
      const nextSeen = new Set(seen).add(target);
      try {
        const { bytes, mimeType } = await fetcher(target);
        const imported = await inlineCss(Buffer.from(bytes).toString('utf8'), target, nextSeen);
        report.inlined.push(target);
        replacements.push({
          start: entry.start,
          end: entry.end,
          replacement: wrapImportedCss(imported, entry.conditions || ''),
        });
      } catch (error) {
        report.failed.push({ url: target, reason: error?.message ?? 'import-failed' });
        replacements.push({ start: entry.start, end: entry.end, replacement: '' });
      }
    }
    if (replacements.length) output = applyPatches(output, replacements);

    // url(...)：逐条抓取（字体、背景图）；失败的引用换成空 url() 以免残留外链。
    const refs = cssUrlReferences(output);
    const patches = [];
    for (const ref of refs) {
      if (isDataUri(ref.raw)) continue;
      const uri = await assetToDataUri(ref.raw);
      patches.push({ start: ref.start, end: ref.end, replacement: `url(${uri ?? ''})` });
    }
    if (patches.length) output = applyPatches(output, patches);
    return output;
  };

  const patches = [];
  const segments = scanHtml(source);

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    if (segment.kind === 'raw' && segment.name === 'style') {
      const next = await inlineCss(segment.text, baseUrl);
      if (next !== segment.text) {
        patches.push({ start: segment.start, end: segment.end, replacement: guardRawText(next, 'style') });
      }
      continue;
    }
    if (segment.kind !== 'tag' || segment.closing) continue;

    const { name, attributes } = segment;

    // <link rel="stylesheet">
    if (name === 'link') {
      const rel = attributes.find((attr) => attr.name === 'rel')?.value.toLowerCase() ?? '';
      const href = attributes.find((attr) => attr.name === 'href')?.value ?? '';
      if (rel.split(/\s+/).includes('stylesheet') && href) {
        const target = resolveUrl(href);
        if (target && !isDataUri(target)) {
          try {
            const { bytes } = await fetcher(target);
            const css = await inlineCss(Buffer.from(bytes).toString('utf8'), target);
            report.inlined.push(target);
            patches.push({
              start: segment.start,
              end: segment.end,
              replacement: `<style>${guardRawText(css, 'style')}</style>`,
            });
            continue;
          } catch (error) {
            report.failed.push({ url: target, reason: error?.message ?? 'link-failed' });
            patches.push({ start: segment.start, end: segment.end, replacement: '' });
            continue;
          }
        }
      }
      continue;
    }

    // <script src>
    if (SCRIPT_TAGS.has(name)) {
      const src = attributes.find((attr) => attr.name === 'src')?.value ?? '';
      if (!src) {
        // 模块脚本里残留的裸导入：记账，交给页面包补 importmap。
        const text = segments.slice(index + 1).find((s) => s.kind === 'raw' && s.name === 'script');
        if (attributes.some((attr) => attr.name === 'type' && /module/i.test(attr.value)) && text) {
          for (const match of text.text.matchAll(/(?:^|\s)(?:import|export)\s[^'"]*from\s*['"]([^'"]+)['"]/g)) {
            if (!/^[./]|^https?:|^data:/.test(match[1])) {
              report.failed.push({ url: match[1], reason: 'bare-module-specifier' });
            }
          }
        }
        continue;
      }
      const target = resolveUrl(src);
      if (!target || isDataUri(target)) continue;
      try {
        const { bytes } = await fetcher(target);
        const kept = attributes
          .filter((attr) => attr.name !== 'src')
          .map((attr) => `${attr.name}="${attr.value.replace(/"/g, '&quot;')}"`)
          .join(' ');
        const js = guardRawText(Buffer.from(bytes).toString('utf8'), 'script');
        report.inlined.push(target);
        patches.push({
          start: segment.start,
          end: segment.end,
          replacement: `<script${kept ? ` ${kept}` : ''}>${js}</script>`,
        });
      } catch (error) {
        report.failed.push({ url: target, reason: error?.message ?? 'script-failed' });
        patches.push({ start: segment.start, end: segment.end, replacement: '' });
      }
      continue;
    }

    // 资源属性
    const resourceNames = RESOURCE_ATTRIBUTES[name];
    if (resourceNames) {
      for (const attr of attributes) {
        if (!resourceNames.includes(attr.name)) continue;
        const value = attr.value.trim();
        if (!value || isDataUri(value)) continue;
        const uri = await assetToDataUri(value);
        patches.push({
          start: attr.start,
          end: attr.end,
          replacement: uri ? uri : '',
        });
      }
    }

    // srcset：逐候选解析后回写（失败的候选从集合里去掉）
    if (SRCSET_TAGS.has(name)) {
      const attr = attributes.find((item) => item.name === 'srcset');
      if (attr && !isDataUri(attr.value)) {
        const candidates = parseSrcset(attr.value);
        const rewritten = [];
        for (const candidate of candidates) {
          if (isDataUri(candidate.url)) {
            rewritten.push(candidate);
            continue;
          }
          const uri = await assetToDataUri(candidate.url);
          if (uri) rewritten.push({ url: uri, descriptor: candidate.descriptor });
        }
        patches.push({
          start: attr.start,
          end: attr.end,
          replacement: rewritten.length ? stringifySrcset(rewritten) : '',
        });
      }
    }

    // 行内 style 里的 url(...)
    const styleAttr = attributes.find((attr) => attr.name === 'style');
    if (styleAttr && /url\s*\(/i.test(styleAttr.value)) {
      const refs = cssUrlReferences(styleAttr.value);
      let value = styleAttr.value;
      const localPatches = [];
      for (const ref of refs) {
        if (isDataUri(ref.raw)) continue;
        const uri = await assetToDataUri(ref.raw);
        localPatches.push({ start: ref.start, end: ref.end, replacement: `url(${uri ?? ''})` });
      }
      value = applyPatches(value, localPatches);
      patches.push({ start: styleAttr.start, end: styleAttr.end, replacement: value });
    }

    // <iframe srcdoc>：递归（深度上限 4，与上游一致）
    const srcdoc = attributes.find((attr) => attr.name === 'srcdoc');
    if (name === 'iframe' && srcdoc && srcdoc.value) {
      if (depth >= MAX_SRDOC_DEPTH) {
        patches.push({ start: srcdoc.start, end: srcdoc.end, replacement: '' });
      } else {
        const nested = await inlineHtmlAssets(srcdoc.value, {
          fetcher,
          baseUrl,
          skipMedia: options.skipMedia,
          depth: depth + 1,
        });
        for (const item of nested.report.inlined) report.inlined.push(item);
        for (const item of nested.report.failed) report.failed.push(item);
        if (nested.html !== srcdoc.value) {
          patches.push({
            start: srcdoc.start,
            end: srcdoc.end,
            replacement: nested.html.replace(/&/g, '&amp;').replace(/"/g, '&quot;'),
          });
        }
      }
    }
  }

  // 属性被清空（抓取失败）时，把 `src=""` 这类空壳也去掉，避免怪异行为。
  let output = patches.length ? applyPatches(source, patches) : source;
  output = output.replace(/\s(?:src|href|poster|data|srcset)=""/gi, '');

  return { html: output, report };
}

/** raw text 不能带 `</style` / `</script`，否则会提前结束元素。 */
function guardRawText(text, element) {
  return text.replace(new RegExp(`</${element}`, 'gi'), `<\\/${element}`);
}

/** `<link>` 之外的 `href`（如 `<a>`）不动：外链文本仍可点，只是不会被预取。 */
export { quoteAttributeValue };
