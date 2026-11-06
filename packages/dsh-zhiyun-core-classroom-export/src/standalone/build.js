/**
 * 单文件 HTML 导出的编排层（纯 Node）。
 *
 * 源：ref/OpenMAIC/lib/export/standalone-html/build-standalone-html.ts:633-851
 *     ref/OpenMAIC/lib/export/standalone-html/build-standalone-html.ts:58-63（README）
 *     ref/OpenMAIC/lib/export/standalone-html/build-standalone-html.ts:604-631（体积估算）
 *     ref/OpenMAIC/lib/export/use-export-html.ts:22-50（是否需要旁白 / 视频）
 *
 * # 与源的对应关系
 *
 * 上游这一层负责四件事：① 收集媒体字节（archive payloads 优先，其次现抓 URL）；
 * ② 决定图片是内联成 `data:` 还是作为文件随包；③ 过大时改用 ZIP 变体；
 * ④ 取播放器产物并交给纯拼装器。
 *
 * 服务端没有浏览器 store，媒体字节由调用方以 `assets` 注入（见 `src/assets.js`），
 * 所以 ① 变成"查表"，③ 保留（同一个 400 MB 上限），④ 走 `player.js`。
 * ② 的两种形态都实现了：`format: 'html'` 内联；`format: 'zip'` 让图片与媒体以
 * 相对路径随包（`images/`、`media/`），页面 CSP 换成 `'self' data: blob:`。
 */

import { assembleStandaloneHtml, utf8Length } from './assemble.js';
import {
  STANDALONE_HTML_LINKED_FILES_CSP,
  STANDALONE_HTML_CSP,
  standalonePlayerConfig,
} from './contract.js';
import { STANDALONE_HTML_MAX_BYTES, StandaloneHtmlTooLargeError } from './limits.js';
import { resolvePlayerAssets } from './player.js';
import { prepareStandaloneManifest } from './prepare-manifest.js';
import { buildStoredZip } from '../zip/stored-zip.js';
import { playerStrings } from '../pptx/i18n.js';

/** 源：build-standalone-html.ts:48-59 */
export const STANDALONE_ZIP_PAGE_NAME = 'classroom.html';
export const STANDALONE_ZIP_README_NAME = 'README.txt';
export const STANDALONE_ZIP_IMAGE_DIR = 'images';
export const STANDALONE_ZIP_README_EN =
  'Extract this whole ZIP file first, then open classroom.html in a web browser. Keep the folders (images, audio, media) next to classroom.html: the page shows its images and plays its narration and video from them. Opened from inside the ZIP without extracting, the page cannot find them.';

/** 源：build-standalone-html.ts:766-773 —— BOM + CRLF，Windows 记事本也能读。 */
export function standaloneZipReadme(localized) {
  const texts = [localized?.trim(), STANDALONE_ZIP_README_EN].filter(
    (entry, index, all) => !!entry && all.indexOf(entry) === index,
  );
  return `\uFEFF${texts.join('\r\n\r\n')}\r\n`;
}

/** 源：build-standalone-html.ts:604-631 */
export function estimateStandaloneHtmlBytes(manifest, mediaBytes = 0) {
  const manifestBytes = utf8Length(JSON.stringify(manifest));
  return mediaBytes + manifestBytes + 1024 * 1024;
}

/**
 * 把课堂清单与媒体字节组装成完整 HTML 文档。
 *
 * @param {object} manifest      已内联互动页资源的 ClassroomManifest
 * @param {object} options
 * @param {'html'|'zip'} [options.format]
 * @param {Map<string,string>} [options.dataUris]  媒体引用 → data: URI
 * @param {Map<string,string>} [options.videoPosters]
 * @param {Map<string,string>} [options.chartImages]
 * @param {{audio?:Set<string>, videos?:Map<string,string>}} [options.playback]
 * @param {object} [options.playerAssets]
 * @param {string} [options.lang]
 * @param {string} [options.classroomUrl]
 * @param {number} [options.maxBytes]
 * @returns {Promise<{html:string, manifest:object, unresolved:string[], playbackMedia:string[], byteSize:number, format:string}>}
 */
export async function buildStandaloneHtml(manifest, options = {}) {
  const format = options.format ?? 'html';
  const prepared = prepareStandaloneManifest(manifest, {
    dataUris: options.dataUris,
    videoPosters: options.videoPosters,
    chartImages: options.chartImages,
    playback: options.playback,
  });

  const assets = options.playerAssets ?? (await resolvePlayerAssets(options));
  const lang = options.lang ?? 'en';
  const config = standalonePlayerConfig(playerStrings(lang), options.classroomUrl);

  const page = {
    manifest: prepared.manifest,
    config,
    playerScript: assets.script,
    playerStyle: assets.style,
    ...(assets.mathFonts ? { extraStyles: [assets.mathFonts] } : {}),
    ...(assets.charts ? { extraScripts: [assets.charts] } : {}),
    lang,
  };

  if (format === 'zip') {
    const { html } = buildZipVariant(page);
    return {
      html,
      manifest: prepared.manifest,
      unresolved: prepared.unresolved,
      playbackMedia: prepared.playbackMedia,
      byteSize: utf8Length(html),
      format: 'zip',
    };
  }

  const html = assembleStandaloneHtml(page);
  const byteSize = utf8Length(html);
  const maxBytes = options.maxBytes ?? STANDALONE_HTML_MAX_BYTES;
  if (byteSize > maxBytes) {
    throw new StandaloneHtmlTooLargeError(byteSize);
  }
  return {
    html,
    manifest: prepared.manifest,
    unresolved: prepared.unresolved,
    playbackMedia: prepared.playbackMedia,
    byteSize,
    format: 'html',
  };
}

/** ZIP 变体的页面本体（图片/媒体仍以 `data:` 或相对路径出现在清单里）。 */
function buildZipVariant(page) {
  const html = assembleStandaloneHtml(page);
  if (!html.includes(STANDALONE_HTML_CSP) && !html.includes(STANDALONE_HTML_LINKED_FILES_CSP)) {
    throw new Error('Standalone HTML: CSP 缺失');
  }
  return { html };
}

/**
 * 源：build-standalone-html.ts:799-851 —— ZIP 变体：`classroom.html` + 媒体 + README。
 *
 * @param {object} page      buildStandaloneHtml 的页对象（linkedFiles 形态）
 * @param {{files?: {path:string, data:Buffer|string}[], readme?: string, date?: Date}} content
 * @returns {Buffer}
 */
export function buildStandaloneZip(page, content = {}) {
  const files = content.files ?? [];
  const taken = new Set([STANDALONE_ZIP_PAGE_NAME, STANDALONE_ZIP_README_NAME]);
  for (const file of files) {
    if (taken.has(file.path)) throw new Error(`Standalone ZIP: duplicate path ${file.path}`);
    taken.add(file.path);
  }
  const html = assembleStandaloneHtml({ ...page, linkedFiles: true });
  const readme = standaloneZipReadme(content.readme);
  return buildStoredZip(
    [
      { path: STANDALONE_ZIP_PAGE_NAME, data: html },
      { path: STANDALONE_ZIP_README_NAME, data: readme },
      ...files.map((file) => ({ path: file.path, data: file.data })),
    ],
    { date: content.date },
  );
}
