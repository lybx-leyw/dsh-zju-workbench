/**
 * 离线单文件 HTML 的固定契约（元素 id、CSP、沙箱参数）。
 *
 * 源：ref/OpenMAIC/lib/export/standalone-html/contract.ts:1-133
 *
 * 这份契约是「导出层」与「播放器产物」之间的唯一约定：页面包里编译好的播放器
 * 从这些 id 读数据，导出层只负责把数据放进去。因此 id 与 CSP 必须逐字一致 ——
 * 改一个字符，页面包的 iframe srcdoc 就打不开课堂了。
 */

/** 源：contract.ts:11 —— `<script type="application/json">` 持有 ClassroomManifest。 */
export const STANDALONE_MANIFEST_ELEMENT_ID = 'openmaic-classroom';

/** 源：contract.ts:14 */
export const STANDALONE_CONFIG_ELEMENT_ID = 'openmaic-player-config';

/** 源：contract.ts:21 —— 播放媒体的索引（旁白音频、视频片段）。 */
export const STANDALONE_MEDIA_TABLE_ELEMENT_ID = 'openmaic-media';

/** 源：contract.ts:30 */
export const STANDALONE_MEDIA_BLOCK_ID_PREFIX = 'openmaic-media-';

/** 源：contract.ts:47 */
export const STANDALONE_FALLBACK_CLASS = 'openmaic-fallback';

/** 源：contract.ts:50 */
export const STANDALONE_ROOT_ELEMENT_ID = 'openmaic-player';

/** 源：contract.ts:78 —— 互动场景的沙箱标志，必须与教室里的 iframe 一致。 */
export const STANDALONE_INTERACTIVE_SANDBOX = 'allow-scripts allow-forms allow-popups';

/** 源：contract.ts:56-64 —— 播放器产物在 public/ 下的位置（页面包负责产出）。 */
export const STANDALONE_PLAYER_ASSET_DIR = 'vendor/standalone-player';
export const STANDALONE_PLAYER_ASSETS = {
  script: `${STANDALONE_PLAYER_ASSET_DIR}/player.min.js`,
  style: `${STANDALONE_PLAYER_ASSET_DIR}/player.min.css`,
  mathFonts: `${STANDALONE_PLAYER_ASSET_DIR}/katex-fonts.min.css`,
  charts: `${STANDALONE_PLAYER_ASSET_DIR}/charts.min.js`,
};

/** 源：contract.ts:72 */
export const STANDALONE_CHARTS_GLOBAL = '__OPENMAIC_CHARTS__';

/** 源：assemble.ts:33-69 */
export const STANDALONE_HTML_CSP = standaloneHtmlCsp('data: blob:');

export const STANDALONE_HTML_LINKED_FILES_CSP = standaloneHtmlCsp("'self' data: blob:");

function standaloneHtmlCsp(linkedSources) {
  return [
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' data: blob:",
    "style-src 'unsafe-inline' data:",
    `img-src ${linkedSources}`,
    `media-src ${linkedSources}`,
    'font-src data:',
    'frame-src data: blob:',
    'worker-src data: blob:',
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

/** 源：contract.ts:126-133 */
export function standalonePlayerConfig(strings, classroomUrl) {
  return {
    strings,
    ...(classroomUrl ? { classroomUrl } : {}),
  };
}
