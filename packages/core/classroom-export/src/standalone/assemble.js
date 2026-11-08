/**
 * 单文件 HTML 的纯拼装：一个文档，内含播放器脚本/样式、课堂清单与播放器配置。
 *
 * 源：ref/OpenMAIC/lib/export/standalone-html/assemble.ts:1-275
 *
 * 零 IO、零 DOM。`html()` 直接返回这里的字符串 —— 页面包把它塞进
 * `<iframe srcdoc>`，因此**必须**是完整文档（`<!doctype html>` 起、`</html>` 止），
 * 不能是待二次拼装的分片。上游还有个 `assembleStandaloneHtmlParts` 供 Blob 拼接
 * （V8 单字符串上限）；这里保留同一入口但返回 `string[]`，`html()` 用它的
 * `join('')`，需要时调用方可自行分片写出。
 */

import {
  STANDALONE_CONFIG_ELEMENT_ID,
  STANDALONE_FALLBACK_CLASS,
  STANDALONE_HTML_CSP,
  STANDALONE_HTML_LINKED_FILES_CSP,
  STANDALONE_MANIFEST_ELEMENT_ID,
  STANDALONE_MEDIA_BLOCK_ID_PREFIX,
  STANDALONE_MEDIA_TABLE_ELEMENT_ID,
  STANDALONE_ROOT_ELEMENT_ID,
} from './contract.js';

/**
 * 源：assemble.ts:79-86 —— 把值序列化进 `<script type="application/json">`。
 * `<`、`>`、`&` 写成 JSON 的 unicode 转义，raw text 里就不会出现 `</script>`、
 * `<!--` 或 `<script`，元素不会被提前结束或重新进入。
 */
export function serializeJsonForHtmlScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** 源：assemble.ts:89-96 */
export function escapeHtmlText(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 源：assemble.ts:98-114 —— raw text（脚本、样式）不能转义，只能拒收。
 * 一段 `</script` 会结束元素；`<!--` 会让解析器进入 escaped 状态。
 */
function assertRawText(payload, element, label) {
  const closing = new RegExp(`</${element}`, 'i');
  if (closing.test(payload) || (element === 'script' && payload.includes('<!--'))) {
    throw new Error(
      `Standalone HTML: ${label} contains a sequence that would end its <${element}>`,
    );
  }
  return payload;
}

/** 源：assemble.ts:116-127 */
const FALLBACK_STYLE = [
  `#${STANDALONE_ROOT_ELEMENT_ID}:empty{display:none}`,
  '.openmaic-message{box-sizing:border-box;max-width:32rem;margin:2rem auto;padding:1rem 1.25rem;',
  'font:16px/1.5 system-ui,-apple-system,sans-serif;color:#334155;text-align:center}',
  `.${STANDALONE_FALLBACK_CLASS}{opacity:0;animation:openmaic-fallback-in 0s 2s forwards}`,
  `.${STANDALONE_FALLBACK_CLASS}[data-failed]{opacity:1;animation:none}`,
  '@keyframes openmaic-fallback-in{to{opacity:1}}',
].join('');

const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

/** 源：assemble.ts:181-204 */
function mediaBlocks(media = [], linked = []) {
  if (media.length === 0 && linked.length === 0) return [];
  const table = {};
  const blocks = [];
  media.forEach((entry, index) => {
    const pieces = typeof entry.base64 === 'string' ? [entry.base64] : entry.base64;
    if (!pieces.every((piece) => BASE64_PATTERN.test(piece))) {
      throw new Error(`Standalone HTML: media ${entry.key} is not base64`);
    }
    const id = `${STANDALONE_MEDIA_BLOCK_ID_PREFIX}${index + 1}`;
    table[entry.key] = { mimeType: entry.mimeType, embedded: id };
    blocks.push(`<script type="application/octet-stream" id="${id}">`, ...pieces, '</script>\n');
  });
  for (const entry of linked) {
    table[entry.key] = { mimeType: entry.mimeType, src: entry.src };
  }
  return [
    `<script type="application/json" id="${STANDALONE_MEDIA_TABLE_ELEMENT_ID}">${serializeJsonForHtmlScript(table)}</script>\n`,
    ...blocks,
  ];
}

/**
 * 源：assemble.ts:216-275 —— 按行拼装，返回可 `join('')` 的分片数组。
 *
 * @param {{
 *   manifest: object,
 *   config: object,
 *   playerScript: string,
 *   playerStyle: string,
 *   extraStyles?: string[],
 *   extraScripts?: string[],
 *   embeddedMedia?: {key:string, mimeType:string, base64:string|string[]}[],
 *   linkedMedia?: {key:string, mimeType:string, src:string}[],
 *   linkedFiles?: boolean,
 *   lang: string,
 * }} input
 * @returns {string[]}
 */
export function assembleStandaloneHtmlParts(input) {
  const title = input.manifest?.stage?.name || 'Classroom';
  const styles = [input.playerStyle, ...(input.extraStyles ?? [])]
    .map((css, index) => `<style>${assertRawText(css, 'style', `style sheet ${index + 1}`)}</style>`)
    .join('\n');
  const line = (text) => `${text}\n`;
  const linkedMedia = input.linkedMedia ?? [];
  if (linkedMedia.length > 0 && !input.linkedFiles) {
    throw new Error('Standalone HTML: linked media needs a document with linked files');
  }
  const csp = input.linkedFiles ? STANDALONE_HTML_LINKED_FILES_CSP : STANDALONE_HTML_CSP;
  const strings = input.config?.strings ?? {};
  const fallbackText = strings.scriptRequired ? escapeHtmlText(strings.scriptRequired) : '';
  const fallbackRoot = fallbackText
    ? `<p class="openmaic-message ${STANDALONE_FALLBACK_CLASS}" data-testid="script-fallback" data-failed-text="${escapeHtmlText(strings.startFailed ?? '')}">${fallbackText}</p>`
    : '';
  return [
    '<!doctype html>',
    `<html lang="${escapeHtmlText(input.lang || 'en')}">`,
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="generator" content="OpenMAIC">',
    `<title>${escapeHtmlText(title)}</title>`,
    styles,
    `<style>${FALLBACK_STYLE}</style>`,
    ...(fallbackText
      ? [`<noscript><style>.${STANDALONE_FALLBACK_CLASS}{display:none}</style></noscript>`]
      : []),
    '</head>',
    '<body>',
    `<div id="${STANDALONE_ROOT_ELEMENT_ID}"></div>`,
    `<script type="application/json" id="${STANDALONE_MANIFEST_ELEMENT_ID}">${serializeJsonForHtmlScript(input.manifest)}</script>`,
    `<script type="application/json" id="${STANDALONE_CONFIG_ELEMENT_ID}">${serializeJsonForHtmlScript(input.config)}</script>`,
  ]
    .map(line)
    .concat(
      mediaBlocks(input.embeddedMedia ?? [], linkedMedia),
      [
        ...(fallbackText
          ? [fallbackRoot, `<noscript><p class="openmaic-message">${fallbackText}</p></noscript>`]
          : []),
        ...(input.extraScripts ?? []).map(
          (js, index) => `<script>${assertRawText(js, 'script', `script ${index + 1}`)}</script>`,
        ),
        `<script>${assertRawText(input.playerScript, 'script', 'player script')}</script>`,
        '</body>',
        '</html>',
      ].map(line),
    );
}

/** 源：assemble.ts:207-209 */
export function assembleStandaloneHtml(input) {
  return assembleStandaloneHtmlParts(input).join('');
}

/** 源：assemble.ts:328-331（build-standalone-html 的字节估算用 UTF-8 长度）。 */
export function utf8Length(text) {
  return new TextEncoder().encode(text).length;
}
