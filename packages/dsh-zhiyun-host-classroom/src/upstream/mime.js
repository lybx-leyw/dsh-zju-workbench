/**
 * 文档格式注册表 + 工作台素材 MIME 策略
 * （源文件:lib/document/mime.ts、lib/workbench/material-upload-policy.ts）。
 *
 * # 搬了什么
 *
 * `POST /api/materials` 的 415 判据完全由这两块决定：
 * `resolveWorkbenchMaterialMime({mimeType, fileName})` 归一到规范 MIME，再用
 * `isWorkbenchMaterialMime()` 过白名单。两张表**逐条照抄**上游注册表
 * （pdf/docx/pptx/xlsx/png/jpeg/webp/txt/markdown/csv/mp4/mov/webm/mp3/wav/m4a/aac，
 * 外加 `audio/webm`），别名表也照抄，否则 `application/wps-office.docx` 之类
 * 会被错判成不支持。
 *
 * # 没搬什么
 *
 * 上游注册表还有 doc/ppt/xls/gif/bmp/jp2/avi/mkv/wmv 等格式——它们**不在工作台
 * 白名单里**（`WORKBENCH_MATERIAL_FORMAT_IDS` 只列了 17 个 + 1 个额外 MIME），
 * 所以对本 route 的可观测行为无影响；为了让 `normalizeDocumentMimeType` 的
 * 「扩展名→MIME」回退与上游一致，仍把它们留在表里（它们只是最终会被白名单拒掉）。
 */

/** 上游 `DOCUMENT_FORMATS` 的 id → { mime, extensions, aliasMimes }。 */
const DOCUMENT_FORMATS = [
  { id: 'pdf', mime: 'application/pdf', extensions: ['.pdf'] },
  { id: 'doc', mime: 'application/msword', extensions: ['.doc'], aliasMimes: ['application/x-msword'] },
  {
    id: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extensions: ['.docx'],
    aliasMimes: ['application/wps-office.docx'],
  },
  { id: 'ppt', mime: 'application/vnd.ms-powerpoint', extensions: ['.ppt'] },
  {
    id: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extensions: ['.pptx'],
    aliasMimes: ['application/wps-office.pptx'],
  },
  { id: 'xls', mime: 'application/vnd.ms-excel', extensions: ['.xls'] },
  {
    id: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extensions: ['.xlsx'],
    aliasMimes: ['application/wps-office.xlsx'],
  },
  { id: 'txt', mime: 'text/plain', extensions: ['.txt'] },
  {
    id: 'markdown',
    mime: 'text/markdown',
    extensions: ['.md', '.markdown'],
    aliasMimes: ['text/x-markdown'],
  },
  { id: 'csv', mime: 'text/csv', extensions: ['.csv'] },
  { id: 'png', mime: 'image/png', extensions: ['.png'] },
  { id: 'jpeg', mime: 'image/jpeg', extensions: ['.jpg', '.jpeg'], aliasMimes: ['image/jpg'] },
  { id: 'webp', mime: 'image/webp', extensions: ['.webp'] },
  { id: 'gif', mime: 'image/gif', extensions: ['.gif'] },
  { id: 'bmp', mime: 'image/bmp', extensions: ['.bmp'], aliasMimes: ['image/x-ms-bmp'] },
  { id: 'jp2', mime: 'image/jp2', extensions: ['.jp2'], aliasMimes: ['image/jpeg2000'] },
  { id: 'mp4', mime: 'video/mp4', extensions: ['.mp4'] },
  { id: 'mov', mime: 'video/quicktime', extensions: ['.mov'] },
  { id: 'avi', mime: 'video/x-msvideo', extensions: ['.avi'] },
  { id: 'mkv', mime: 'video/x-matroska', extensions: ['.mkv'] },
  { id: 'wmv', mime: 'video/x-ms-wmv', extensions: ['.wmv'] },
  { id: 'webm', mime: 'video/webm', extensions: ['.webm'] },
  { id: 'mp3', mime: 'audio/mpeg', extensions: ['.mp3'], aliasMimes: ['audio/mp3'] },
  { id: 'm4a', mime: 'audio/mp4', extensions: ['.m4a'], aliasMimes: ['audio/x-m4a'] },
  { id: 'wav', mime: 'audio/wav', extensions: ['.wav'], aliasMimes: ['audio/x-wav'] },
  { id: 'aac', mime: 'audio/aac', extensions: ['.aac'] },
];

const MIME_BY_EXTENSION = {};
const CANONICAL_BY_ALIAS = {};
for (const format of DOCUMENT_FORMATS) {
  for (const extension of format.extensions) MIME_BY_EXTENSION[extension.slice(1)] = format.mime;
  for (const alias of format.aliasMimes ?? []) CANONICAL_BY_ALIAS[alias] = format.mime;
}

/** 上游 `GENERIC_DOCUMENT_MIME_TYPES`（源:mime.ts:265-276）。 */
const GENERIC_DOCUMENT_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/x-zip',
  'application/x-zip-compressed',
  'application/vnd.ms-office',
]);

/** 工作台接受的格式（源:material-upload-policy.ts:17-35）。 */
const WORKBENCH_MATERIAL_FORMAT_IDS = [
  'pdf', 'pptx', 'docx', 'xlsx', 'png', 'jpeg', 'webp',
  'txt', 'markdown', 'csv', 'mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'aac',
];

const MIME_OF = Object.fromEntries(DOCUMENT_FORMATS.map((format) => [format.id, format.mime]));

/** `audio/webm` 没有独立扩展名，只作为额外 MIME 存在（源:41）。 */
const WORKBENCH_EXTRA_MEDIA_MIMES = ['audio/webm'];

export const WORKBENCH_MATERIAL_MIME_TYPES = Object.freeze([
  ...WORKBENCH_MATERIAL_FORMAT_IDS.map((id) => MIME_OF[id]),
  ...WORKBENCH_EXTRA_MEDIA_MIMES,
]);

/** 媒体（音频/视频）MIME：上传限额按这个集合二分（源:82-88）。 */
export const MEDIA_MIME_TYPES = Object.freeze([
  ...['mp4', 'mov', 'webm', 'mp3', 'wav', 'm4a', 'aac'].map((id) => MIME_OF[id]),
  ...WORKBENCH_EXTRA_MEDIA_MIMES,
]);

const WORKBENCH_MIME_SET = new Set(WORKBENCH_MATERIAL_MIME_TYPES);

/** 上游 `normalizeDocumentMimeType`（源:mime.ts:297-310）。 */
export function normalizeDocumentMimeType({ mimeType, fileName } = {}) {
  const mime = mimeType?.split(';')[0]?.trim().toLowerCase();
  const extension = fileName?.split('.').pop()?.toLowerCase();
  const mimeFromExtension = extension ? MIME_BY_EXTENSION[extension] : undefined;

  if (!mime || GENERIC_DOCUMENT_MIME_TYPES.has(mime)) {
    return mimeFromExtension ?? mime ?? '';
  }
  return CANONICAL_BY_ALIAS[mime] ?? mime;
}

/** 上游 `resolveWorkbenchMaterialMime`（源:material-upload-policy.ts:102-107）。 */
export function resolveWorkbenchMaterialMime(input) {
  return normalizeDocumentMimeType(input);
}

/** 上游 `isWorkbenchMaterialMime`（源:109-111）。 */
export function isWorkbenchMaterialMime(mime) {
  return WORKBENCH_MIME_SET.has(normalizeDocumentMimeType({ mimeType: mime }));
}

/** 素材的媒体/文档二分（源:persistence/owner-materials.ts 的 `materialMediaKind`）。 */
export function materialMediaKind(mime) {
  return mime && MEDIA_MIME_TYPES.includes(normalizeDocumentMimeType({ mimeType: mime }))
    ? 'media'
    : 'document';
}
