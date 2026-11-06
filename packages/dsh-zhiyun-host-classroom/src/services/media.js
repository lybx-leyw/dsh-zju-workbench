/**
 * 批 2：素材 / 媒体 / 解析（17 条）——`service.materials` 与 `service.media`。
 *
 * 上游：`ref/OpenMAIC/app/api/{materials,classroom-media,parse-pdf,transcription,proxy-media,comfyui-workflows,generate}/**\/route.ts`
 *
 * # 挂载
 *
 * ```js
 * import { mountMedia } from './services/media.js';
 * createClassroomService({ …, mounts: [mountMedia] });
 * ```
 *
 * `mountMedia` 只往 `service.materials` / `service.media` 上 `Object.assign`，
 * 不整体替换任何命名空间（挂载协议 §0）。
 *
 * # 端口面
 *
 * | 端口 | 方法 | 用在哪 |
 * |---|---|---|
 * | `ports.vault` | `materials.{put,get,list,remove}` | 会话范围内的素材（上游 `agent_session_materials`） |
 * | `ports.vault` | `assets.{put,get,bytes,list,remove}` | 素材原始字节 + 课堂媒体字节（上游的对象存储 / `public/` 文件） |
 * | `ports.vault` | `kv.{get,set,remove,keys}` | 素材库元数据（`material-library/<id>`）与素材文件夹（`material-folders/<id>`） |
 * | `ports.media` | `tts/asr/image/parsePdf` | `generate/*`、`parse-pdf`、`transcription` |
 *
 * 素材库的元数据落在 `kv` 上、字节落在 `assets` 上（`stageId` 用 `material-<id>` 占位），
 * 因为本包没有 `pg`：上游 `owner_material` 表 + 字节存储这两层，在这边就是
 * 「一个 kv 记录 + 一份 assets blob」。这条映射写在这里，是因为它是**唯一**
 * 与上游不同构的地方，读代码的人必须先知道。
 *
 * # 端口缺失时的行为（硬性，不许编数据）
 *
 * | 方法 | `ports.vault` 缺 | `ports.media` 缺 |
 * |---|---|---|
 * | `materials.list/get/create`（无 `sessionId`） | 纯文本 404（上游「没有持久层」分支，`materials/route.ts:130`） | 不影响 |
 * | `materials.*`（带 `sessionId`，或 library/folders/move/rename） | 纯文本 404（上游「没有 agent runtime」分支） | 不影响 |
 * | `materials.original` | 纯文本 404 | 不影响 |
 * | `media.asset` | 404 `{error:'Not found'}`（上游 `ENOENT` 分支） | 不影响 |
 * | `media.parsePdf` / `media.transcribe` | 不影响 | **抛** `E_NOT_IMPLEMENTED` |
 * | `media.image` / `media.tts` | 不影响 | **抛** `E_NOT_IMPLEMENTED` |
 * | `media.video` / `media.voice` | 不影响 | 端口有 `media` 但没有 `video`/`voice` 方法时同样**抛**（见方法注释） |
 * | `media.comfyuiWorkflows` | 不影响（只读 `dataDir/public/`） | 不影响 |
 * | `media.proxy` | 不影响（走上游 HTTP） | 不影响 |
 *
 * 上游的「有持久层 / 有 agent runtime」两个 feature flag，在本包里分别对应
 * `vault.kv`（持久层）与 `vault.kv + vault.materials`（素材库那一批 route 的闸门）。
 * 理由：上游这两个 flag 判的就是"库表建好没有"，这里判的是"端口在不在"。
 *
 * # 删掉的 Next 专有声明
 *
 * 17 条 route 里的 `export const runtime = 'nodejs'`、`revalidate`、
 * `req.formData()`、`req.body.getReader()`、`createReadStream` → web stream 桥
 * 全部删除（挂载协议 §0「搬运纪律」）。`req.formData()` 的两条改成入参收
 * `{ buffer, filename, mimeType }`；`req.body` 流式上传改成入参收 `{ buffer }`，
 * 逐块读 + 中途截断的计量逻辑改成对 buffer 的长度判断（语义等价：超限即 413）。
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import { notImplemented } from '../errors.js';
import {
  binaryResponse,
  hasSearchParam,
  jsonResponse,
  localOwner,
  plainResponse,
  searchParam,
  withOwner,
  NOT_FOUND,
} from './support.js';

// ── 上游常量（逐字照抄）────────────────────────────────────────────────────

/** `materials/route.ts:71`：store 的键集分页上限。 */
const MAX_MATERIAL_LIST_LIMIT = 200;
/** `materials/library/route.ts:35-36`。 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
/** `material-library.ts:82`：素材显示名上限。 */
const MATERIAL_NAME_MAX_LENGTH = 255;
/** `material-library.ts:85`：一次移动的上限。 */
const MAX_MOVE_MATERIALS = 100;
/** `folder-name-validation.ts:12,15`。 */
const FOLDER_NAME_MAX_WIDTH = 40;
const FOLDER_COUNT_LIMIT = 50;
/** `agent-runtime/config.ts:46-57` 的默认值（本包没有 env 装载器，用同一组默认）。 */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const MAX_MATERIALS_PER_OWNER = 100;
const MAX_MATERIAL_BYTES_PER_OWNER = 2 * 1024 * 1024 * 1024;
/** `upload-limits.ts:9-13`。 */
const MATERIAL_MEDIA_UPLOAD_LIMIT = MAX_UPLOAD_BYTES;
const MATERIAL_DOCUMENT_UPLOAD_LIMIT = Math.min(MAX_DOCUMENT_BYTES, MAX_UPLOAD_BYTES);
/** `proxy-media/route.ts:79`。 */
const MAX_PROXY_BYTES = 25 * 1024 * 1024;

// ── MIME 注册表（`lib/document/mime.ts` 的工作簿子集）──────────────────────

const DOCUMENT_MIME_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  markdown: 'text/markdown',
  csv: 'text/csv',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
};

const M = DOCUMENT_MIME_TYPES;

const MIME_BY_EXTENSION = {
  pdf: M.pdf,
  docx: M.docx,
  pptx: M.pptx,
  xlsx: M.xlsx,
  png: M.png,
  jpg: M.jpeg,
  jpeg: M.jpeg,
  webp: M.webp,
  txt: M.txt,
  md: M.markdown,
  markdown: M.markdown,
  csv: M.csv,
  mp4: M.mp4,
  mov: M.mov,
  webm: M.webm,
  mp3: M.mp3,
  m4a: M.m4a,
  wav: M.wav,
  aac: M.aac,
};

/** `mime.ts:134-140` 的 alias 表（只列工作簿接受的格式）。 */
const ALIAS_MIMES = {
  'image/jpg': M.jpeg,
  'audio/mp3': M.mp3,
  'audio/x-m4a': M.m4a,
  'audio/x-wav': M.wav,
  'text/x-markdown': M.markdown,
  'application/wps-office.docx': M.docx,
  'application/wps-office.pptx': M.pptx,
  'application/wps-office.xlsx': M.xlsx,
};

/** `mime.ts:265-276`：无格式信息的通用类型，交给扩展名决定。 */
const GENERIC_DOCUMENT_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/x-zip',
  'application/x-zip-compressed',
  'application/vnd.ms-office',
]);

/** `material-upload-policy.ts:19-33`：工作簿接受的 MIME（含 `audio/webm`）。 */
const WORKBENCH_MATERIAL_MIME_TYPES = [
  M.pdf, M.pptx, M.docx, M.xlsx, M.png, M.jpeg, M.webp, M.txt, M.markdown, M.csv,
  M.mp4, M.mov, M.webm, M.mp3, M.wav, M.m4a, M.aac, 'audio/webm',
];
const WORKBENCH_MIME_SET = new Set(WORKBENCH_MATERIAL_MIME_TYPES);

/** `material-upload-policy.ts:100-110`：音视频走媒体上限。 */
const MEDIA_MIME_SET = new Set([
  M.mp4, M.mov, M.webm, M.mp3, M.wav, M.m4a, M.aac, 'audio/webm',
]);

/** `classroom-storage.ts:31-49`。 */
const CLASSROOM_MEDIA_MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg',
};

/** `original-response.ts:15`：只有图片/音视频内联打开。 */
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/webm',
  'video/mp4', 'video/webm', 'video/quicktime',
]);

// ── 小工具（与上游逐行对应）───────────────────────────────────────────────

/** 上游 `apiError`（`lib/server/api-response.ts:61-74`）。 */
function apiError(httpStatus, code, error, details, reason, headers = new Headers()) {
  return jsonResponse(
    {
      success: false,
      errorCode: code,
      error,
      ...(details ? { details } : {}),
      ...(reason ? { reason } : {}),
    },
    httpStatus,
    headers,
  );
}

/** 上游 `apiSuccess`（`lib/server/api-response.ts:76-78`）。 */
function apiSuccess(data, httpStatus = 200, headers = new Headers()) {
  return jsonResponse({ success: true, ...data }, httpStatus, headers);
}

/** 上游 `libraryRefusal`（`materials/library-routes.ts:38-53`）。 */
function libraryRefusal(httpStatus, reason, message, headers, extra = {}, code = 'INVALID_REQUEST') {
  return jsonResponse(
    { success: false, errorCode: code, error: message, reason, ...extra },
    httpStatus,
    headers,
  );
}

/** 上游 `ownerNotFound`（`agent-runtime/route-response.ts:41-43`）。 */
function ownerNotFound(headers) {
  return plainResponse(404, NOT_FOUND, headers);
}

/** 上游 `contentDisposition`（`original-response.ts:41-53`）。 */
function contentDisposition(disposition, name, fallback) {
  const fileName = safeFileName(name, fallback);
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 上游 `safeFileName`（`original-response.ts:28-38`）。 */
function safeFileName(name, fallback) {
  const cleaned = Array.from(name ?? '')
    .filter((character) => {
      const code = character.codePointAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/[\\/]/g, '_')
    .trim();
  return cleaned || fallback;
}

/** 上游 `opensInline`（`original-response.ts:23-25`）。 */
function opensInline(mime) {
  return INLINE_TYPES.has((mime ?? '').toLowerCase());
}

/** 上游 `originalDownloadName`（`original-response.ts:60-70`）。 */
function originalDownloadName(displayName, originalName) {
  const name = displayName ?? originalName;
  if (!name) return name;
  const extension = extname(originalName ?? '');
  return extension && !name.toLowerCase().endsWith(extension.toLowerCase())
    ? `${name}${extension}`
    : name;
}

/** 上游 `originalResponseHeaders`（`original-response.ts:72-92`）。 */
function originalResponseHeaders({ materialId, mime, originalName, byteLength }) {
  const lower = (mime ?? '').toLowerCase();
  const inline = opensInline(lower);
  return new Headers({
    'Content-Type': inline ? lower : 'application/octet-stream',
    'Content-Length': String(byteLength),
    'Content-Disposition': contentDisposition(
      inline ? 'inline' : 'attachment',
      originalName,
      materialId,
    ),
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
  });
}

/** 上游 `materialMediaKind`（`owner-materials.ts:437-440`）。 */
function materialMediaKind(mime) {
  const value = (mime ?? '').toLowerCase();
  return value.startsWith('audio/') || value.startsWith('video/') ? 'media' : 'document';
}

/** 上游 `publicMaterial`（`owner-materials.ts:442-462`），字段顺序不变。 */
function publicMaterial(record) {
  const extraction = record.extraction ? { ...record.extraction } : undefined;
  if (extraction) {
    delete extraction.identityKey;
    delete extraction.resultKey;
    delete extraction.claimedAt;
    delete extraction.imagesRetryable;
  }
  return {
    materialId: record.id,
    kind: record.kind,
    ...(record.derivedFrom ? { derivedFrom: record.derivedFrom } : {}),
    ...(record.mime ? { mime: record.mime } : {}),
    bytes: record.bytes,
    ...(record.originalName ? { originalName: record.originalName } : {}),
    mediaKind: materialMediaKind(record.mime),
    ...(extraction ? { extraction } : {}),
    createdAt: new Date(record.createdAt).toISOString(),
  };
}

/** 上游 `createMaterialId`（`@openmaic/storage`：`mat_` + 26 位 Crockford base32）。 */
const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';
function createMaterialId() {
  let id = 'mat_';
  for (const byte of randomBytes(26)) id += CROCKFORD[byte % 32];
  return id;
}

/** 上游 `isMaterialId`（`materials/material-id.ts:7-11`）。 */
const MATERIAL_ID_PATTERN = /^mat_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

/** 上游 `resolveWorkbenchMaterialMime` / `normalizeDocumentMimeType`（`mime.ts:297-310`）。 */
function resolveWorkbenchMaterialMime({ mimeType, fileName }) {
  const mime = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  const extension = String(fileName ?? '').split('.').pop()?.toLowerCase();
  const fromExtension = extension ? MIME_BY_EXTENSION[extension] : undefined;
  if (!mime || GENERIC_DOCUMENT_MIME_TYPES.has(mime)) return fromExtension ?? mime;
  return ALIAS_MIMES[mime] ?? mime;
}

/** 上游 `isWorkbenchMaterialMime`（`material-upload-policy.ts:119-121`）。 */
function isWorkbenchMaterialMime(mime) {
  return WORKBENCH_MIME_SET.has(mime);
}

/** 上游 `materialTooLarge`（`materials/route.ts:79-89`）。 */
function materialTooLarge(maxBytes) {
  return jsonResponse(
    {
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: `upload exceeds ${maxBytes} bytes`,
      maxBytes,
    },
    413,
  );
}

/** 上游 `materialFilename`（`materials/route.ts:92-103`）：只留裸文件名。 */
function materialFilename(body) {
  const raw = body?.filename ?? body?.headers?.['x-material-filename'] ?? null;
  if (!raw) return null;
  let decoded = String(raw);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Preserve a plain header value; malformed percent escapes are not paths.
  }
  const name = basename(decoded.replace(/\\/g, '/')).trim().slice(0, 512);
  return name || null;
}

/** 上游 `materialUploadRequestId`（`materials/route.ts:105-108`）。 */
function materialUploadRequestId(body) {
  const upstream = String(body?.requestId ?? '').trim();
  return upstream && /^[A-Za-z0-9._:-]{1,128}$/.test(upstream) ? upstream : randomUUID();
}

/** 上游 `parseLimit`（`materials/route.ts:110-116`）。 */
function parseLimit(raw) {
  if (raw === null || raw === undefined || raw === '') return {};
  if (!/^\d+$/.test(String(raw))) return { invalid: true };
  const parsed = Number(raw);
  if (parsed < 1 || parsed > MAX_MATERIAL_LIST_LIMIT) return { invalid: true };
  return { limit: parsed };
}

/** 上游 `displayNameWidth`（`folder-name-validation.ts:65-71`）。 */
const FULL_WIDTH_CHARS =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F\u3040-\u30FF]/;

function displayNameWidth(str) {
  let width = 0;
  for (const ch of str) width += FULL_WIDTH_CHARS.test(ch) ? 2 : 1;
  return width;
}

/** 上游 `validateFolderName`（`folder-name-validation.ts:79-87`）。 */
function validateFolderName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { ok: false, kind: 'empty', width: 0 };
  const width = displayNameWidth(trimmed);
  if (width > FOLDER_NAME_MAX_WIDTH) return { ok: false, kind: 'tooLong', width };
  return { ok: true };
}

/** 上游 `normalizedFolderName`（`material-library.ts:100-102`）。 */
function normalizedFolderName(name) {
  return name.toLocaleLowerCase('en-US');
}

/** 上游 `parseRangeHeader`（`lib/server/http-range.ts:18-43`）。 */
function parseRangeHeader(header, size) {
  if (!header) return { kind: 'ignored' };
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(header).trim());
  if (!match) return { kind: 'ignored' };
  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) return { kind: 'ignored' };
  if (size <= 0) return { kind: 'unsatisfiable' };
  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (suffixLength <= 0) return { kind: 'unsatisfiable' };
    return { kind: 'range', start: Math.max(0, size - suffixLength), end: size - 1 };
  }
  const start = Number(startRaw);
  const end = endRaw ? Math.min(Number(endRaw), size - 1) : size - 1;
  if (start >= size || start > end) return { kind: 'unsatisfiable' };
  return { kind: 'range', start, end };
}

/**
 * 上游 `validateUrlForSSRF` 的**最小**等价物（`lib/server/ssrf-guard.ts`）。
 *
 * 只有协议与字面地址两层：`undici` 的 pinned dispatcher 在本仓不可用（不加依赖），
 * 所以 DNS 解析后的连接钉定没搬 —— 这一条差额记在 `ROUTES.md` §6 的「差异」列。
 * 仍然拦的是最常见的两类：非 http(s) 协议、直写内网/回环地址。
 */
function validateUrlForSSRF(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return 'Invalid URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only http(s) URLs are allowed';
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return 'Private network addresses are not allowed';
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    const priv = a === 0 || a === 10 || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127);
    if (priv) return 'Private network addresses are not allowed';
  }
  if (/^(fc|fd|fe80)/.test(host) && host.includes(':')) {
    return 'Private network addresses are not allowed';
  }
  return null;
}

// ── 素材库（`kv` 元数据 + `assets` 字节）──────────────────────────────────

const materialKey = (id) => `material-library/${id}`;
const folderKey = (id) => `material-folders/${id}`;

/** `assets` 是「按课堂分区」的 blob 存储，素材字节用它，`stageId` 用 `material-<id>` 占位。 */
const assetStage = (id) => `material-${id}`;

/**
 * 素材库的端口包装。
 *
 * 上游 `lib/persistence/{owner-materials,material-library}.ts` 是 SQL；这里是
 * 同一组操作的 kv/assets 版本。**不加锁**：上游那些 `FOR UPDATE` / advisory lock
 * 保护的是并发上传下的配额与文件夹唯一性；单机单用户的文件存储上，
 * 顺序调用就够了（多进程写同一个 owner 不在本包契约内）。
 */
function materialLibrary(vault) {
  return {
    async list(ownerId, options = {}) {
      const keys = await vault.kv.keys('material-library/');
      const rows = [];
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop
        const row = await vault.kv.get(key);
        if (!row || row.ownerId !== ownerId) continue;
        if (row.status !== 'ready' || row.deletedAt) continue;
        rows.push(row);
      }
      const { folderId, query, sourcesOnly, before, limit } = options;
      let filtered = rows;
      if (folderId !== undefined) filtered = filtered.filter((row) => (row.folderId ?? null) === folderId);
      if (sourcesOnly) filtered = filtered.filter((row) => row.kind === 'source');
      if (query) {
        const needle = query.toLowerCase();
        filtered = filtered.filter((row) => `${row.displayName ?? ''} ${row.originalName ?? ''}`.toLowerCase().includes(needle)
          || String(row.mime ?? '').toLowerCase().includes(needle));
      }
      filtered.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1));
      if (before) {
        const index = filtered.findIndex((row) => row.id === before);
        if (index >= 0) filtered = filtered.slice(index + 1);
      }
      return limit === undefined ? filtered : filtered.slice(0, limit);
    },

    async all(ownerId) {
      const keys = await vault.kv.keys('material-library/');
      const rows = [];
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop
        const row = await vault.kv.get(key);
        if (row && row.ownerId === ownerId && !row.deletedAt) rows.push(row);
      }
      return rows;
    },

    async get(ownerId, id) {
      const row = await vault.kv.get(materialKey(id));
      if (!row || row.ownerId !== ownerId) return null;
      if (row.status !== 'ready' || row.deletedAt) return null;
      return row;
    },

    async raw(ownerId, id) {
      const row = await vault.kv.get(materialKey(id));
      if (!row || row.ownerId !== ownerId) return null;
      return row;
    },

    async put(row) {
      await vault.kv.set(materialKey(row.id), row);
      return row;
    },

    async remove(id) {
      await vault.kv.remove(materialKey(id));
    },

    /**
     * 素材字节落盘。
     *
     * `meta.name` 存原始文件名：生成侧（`phases/material-analysis.js`）只拿得到
     * `materialId`，没有它会退化成 `material-<id>.pdf`，讲义在小标题里就认不出来了。
     */
    async putBytes(id, buffer, mime, meta) {
      return vault.assets.put({
        stageId: assetStage(id),
        id: assetStage(id),
        data: buffer,
        mime,
        ...(meta && Object.keys(meta).length > 0 ? { meta } : {}),
      });
    },

    async bytes(id) {
      return vault.assets.bytes(assetStage(id), assetStage(id));
    },

    async removeBytes(id) {
      try {
        await vault.assets.remove(assetStage(id), assetStage(id));
      } catch {
        // 字节已经不在：删除是幂等的（上游 `deleteMaterialObjects` 也是 best-effort）。
      }
    },

    /** 上游 `ownerLibraryUsage`：活着的 source 数与总字节。 */
    async usage(ownerId) {
      const rows = await this.all(ownerId);
      const sources = rows.filter((row) => row.kind === 'source');
      return {
        usedCount: sources.length,
        usedBytes: sources.reduce((sum, row) => sum + Number(row.bytes ?? 0), 0),
      };
    },

    async folders(ownerId, options = {}) {
      const keys = await vault.kv.keys('material-folders/');
      const folders = [];
      for (const key of keys) {
        // eslint-disable-next-line no-await-in-loop
        const folder = await vault.kv.get(key);
        if (folder && folder.ownerId === ownerId) folders.push(folder);
      }
      const rows = await this.all(ownerId);
      const withCounts = folders.map((folder) => ({
        ...folder,
        materialCount: rows.filter((row) => row.kind === 'source' && row.folderId === folder.id).length,
      }));
      const needle = options.query ? options.query.toLowerCase() : null;
      const filtered = needle
        ? withCounts.filter((folder) => folder.name.toLowerCase().includes(needle))
        : withCounts;
      return filtered.sort((a, b) => {
        const left = normalizedFolderName(a.name);
        const right = normalizedFolderName(b.name);
        return left < right ? -1 : left > right ? 1 : (a.id < b.id ? -1 : 1);
      });
    },

    async getFolder(ownerId, id) {
      const folder = await vault.kv.get(folderKey(id));
      return folder && folder.ownerId === ownerId ? folder : null;
    },

    async putFolder(folder) {
      await vault.kv.set(folderKey(folder.id), folder);
      return folder;
    },

    async removeFolder(id) {
      await vault.kv.remove(folderKey(id));
    },
  };
}

// ── 挂载 ───────────────────────────────────────────────────────────────────

/**
 * @param {object} service `createClassroomService` 的返回值
 * @param {object} deps `{ ports, log, dataDir, providerConfig }`
 */
export function mountMedia(service, deps) {
  const context = createMediaContext(deps);
  service.materials = Object.assign(service.materials ?? {}, context.materials);
  service.media = Object.assign(service.media ?? {}, context.media);
  return service;
}

/**
 * 把 `deps` 变成这一域真正用的东西：惰性端口取值 + owner 默认实现。
 *
 * 端口一律**调用时**取：`deps.ports.vault` 是 getter，挂载时读一次就永久绑死 null。
 */
function createMediaContext(deps) {
  const log = deps.log ?? {
    debug() {},
    info() {},
    warn() {},
    error() {},
  };

  const vaultPort = () => {
    try {
      return deps.ports?.vault ?? deps.vault ?? null;
    } catch {
      return null;
    }
  };
  const mediaPort = () => {
    try {
      return deps.ports?.media ?? deps.media ?? null;
    } catch {
      return null;
    }
  };
  const fetchImpl = (input, init) => {
    const injected = deps.fetch;
    return typeof injected === 'function' ? injected(input, init) : fetch(input, init);
  };

  // `support.withOwner` 要 `deps.owner.resolve`；没注入就是单机单用户。
  const ownerDeps = { ...deps, owner: deps.owner ?? localOwner };

  /** 上游 `isServerPersistenceConfigured()`：有持久层 = 有 kv。 */
  const hasPersistence = () => {
    const vault = vaultPort();
    return Boolean(vault?.kv?.get && vault?.kv?.set && vault?.kv?.keys);
  };
  /** 上游 `isAgentRuntimeConfigured()`：素材库那 6 条 route 的闸门。 */
  const hasLibrary = () => hasPersistence() && Boolean(vaultPort()?.materials?.list);

  /** 每次调用现取，避免把一次读到的东西缓存成"端口存在"。 */
  const library = () => materialLibrary(vaultPort());

  /** 素材字节：`assets` 是唯一能放二进制的地方，没有它就等于没有原始文件。 */
  const hasBytes = () => {
    const vault = vaultPort();
    return Boolean(vault?.assets?.put && vault?.assets?.bytes);
  };

  // ── service.materials ────────────────────────────────────────────────────

  const materials = {
    /**
     * `GET /api/materials`（源文件:app/api/materials/route.ts:123-165）。
     *
     * `q` 收 `URLSearchParams` 或 `{ query: URLSearchParams | { sessionId, limit, before }, ownerId }`。
     */
    async list(q) {
      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
      // A session named but empty is a mistake, not a request for the library.
      if (hasSearchParam(q, 'sessionId') && !String(searchParam(q, 'sessionId') ?? '').trim()) {
        return apiError(400, 'MISSING_REQUIRED_FIELD', 'sessionId must not be empty');
      }
      if (!hasSearchParam(q, 'sessionId')) {
        return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
          const records = await library().list(ownerId);
          return jsonResponse({ materials: records.map(publicMaterial) }, 200, headers);
        });
      }
      if (!hasLibrary()) return plainResponse(404, NOT_FOUND);

      const sessionId = String(searchParam(q, 'sessionId')).trim();
      const parsedLimit = parseLimit(searchParam(q, 'limit'));
      if ('invalid' in parsedLimit) {
        return apiError(
          400,
          'INVALID_REQUEST',
          `limit must be an integer between 1 and ${MAX_MATERIAL_LIST_LIMIT}`,
        );
      }
      const before = String(searchParam(q, 'before') ?? '').trim() || undefined;

      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const rows = await vaultPort().materials.list(sessionId);
        const owned = rows.filter((row) => !row.ownerId || row.ownerId === ownerId);
        const sorted = owned.sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0));
        const sliced = parsedLimit.limit === undefined ? sorted : sorted.slice(0, parsedLimit.limit);
        const after = before ? sliced.filter((row) => row.id !== before) : sliced;
        return jsonResponse(
          { materials: after.map((row) => sessionScopeMaterialView(row)) },
          200,
          headers,
        );
      });
    },

    /**
     * `POST /api/materials`（源文件:app/api/materials/route.ts:170-444）。
     *
     * `body` 收 `{ buffer, filename, mimeType, contentLength?, scope?, extract?, sessionId?, ownerId?, requestId? }`。
     * 上游的 `req.body` 流式读改成对 buffer 的长度判断：超过 `reservedBytes` 与
     * 超过 `uploadLimit` 的语义不变（都 413），只是不再需要 `getReader()`。
     */
    async create(body) {
      const requestId = materialUploadRequestId(body);
      const startedAt = Date.now();
      let phase = 'feature_gate';
      let materialId;
      let mime = '';
      let declaredMime = '';
      let declaredBytes = 0;
      let receivedBytes = 0;
      const context = (extra = {}) => ({
        requestId,
        phase,
        ...(materialId ? { materialId } : {}),
        ...(mime ? { mime } : {}),
        ...(declaredMime && declaredMime !== mime ? { declaredMime } : {}),
        declaredBytes,
        receivedBytes,
        durationMs: Date.now() - startedAt,
        ...extra,
      });
      const reject = (response, reason, headers) => {
        log.warn?.('material upload rejected', context({ status: response.httpStatus, reason }));
        response.headers.set('x-request-id', requestId);
        for (const [key, value] of headers) response.headers.append(key, value);
        return response;
      };

      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);

      return withOwner(ownerDeps, { ownerId: body?.ownerId }, async ({ ownerId, headers }) => {
        try {
          phase = 'validate_request';
          // Library uploads always enqueue; classic callers may defer extraction.
          const libraryUpload = body?.scope === 'library';
          if (libraryUpload && !hasLibrary()) return plainResponse(404, NOT_FOUND, headers);
          const extract = body?.extract !== false;
          const rawMime = String(body?.mimeType ?? '').split(';', 1)[0];
          declaredMime = rawMime;
          const originalName = materialFilename(body);
          // A generic content-type … is resolved from the filename extension; a
          // specific but unsupported type falls through verbatim for the
          // whitelist to reject.
          mime = resolveWorkbenchMaterialMime({ mimeType: rawMime, fileName: originalName });
          if (!isWorkbenchMaterialMime(mime)) {
            return reject(
              apiError(415, 'INVALID_REQUEST', `unsupported material mime type: ${mime || '(missing)'}`),
              'unsupported_mime',
              headers,
            );
          }
          const uploadLimit = MEDIA_MIME_SET.has(mime)
            ? MATERIAL_MEDIA_UPLOAD_LIMIT
            : MATERIAL_DOCUMENT_UPLOAD_LIMIT;

          declaredBytes = Number(body?.contentLength ?? 0);
          if (Number.isFinite(declaredBytes) && declaredBytes > uploadLimit) {
            return reject(materialTooLarge(uploadLimit), 'declared_body_too_large', headers);
          }
          if (!body?.buffer) {
            return reject(apiError(400, 'INVALID_REQUEST', 'empty body'), 'empty_body', headers);
          }
          if (!originalName) {
            return reject(
              apiError(400, 'MISSING_REQUIRED_FIELD', 'x-material-filename header is required'),
              'missing_filename',
              headers,
            );
          }
          const createdMaterialId = createMaterialId();
          materialId = createdMaterialId;

          const lib = library();
          // 配额（上游 `registerOwnerMaterial` 的两条检查，消息逐字一致）。
          const usage = await lib.usage(ownerId);
          const reservedBytes = Number.isFinite(declaredBytes) && declaredBytes > 0
            ? declaredBytes
            : uploadLimit;
          phase = 'reserve_material';
          if (usage.usedCount >= MAX_MATERIALS_PER_OWNER) {
            return reject(
              apiError(
                429,
                'INVALID_REQUEST',
                `material count quota exceeded (maximum ${MAX_MATERIALS_PER_OWNER})`,
              ),
              'quota_exceeded',
              headers,
            );
          }
          if (usage.usedBytes + reservedBytes > MAX_MATERIAL_BYTES_PER_OWNER) {
            return reject(
              apiError(
                429,
                'INVALID_REQUEST',
                `material byte quota exceeded (maximum ${MAX_MATERIAL_BYTES_PER_OWNER} bytes)`,
              ),
              'quota_exceeded',
              headers,
            );
          }

          phase = 'store_bytes';
          const bytes = Buffer.isBuffer(body.buffer) ? body.buffer : Buffer.from(body.buffer);
          receivedBytes = bytes.byteLength;
          if (bytes.byteLength > uploadLimit) {
            return reject(materialTooLarge(uploadLimit), 'streamed_body_too_large', headers);
          }
          if (bytes.byteLength === 0) {
            return reject(apiError(400, 'INVALID_REQUEST', 'empty body'), 'empty_stream', headers);
          }
          if (bytes.byteLength > reservedBytes) {
            return reject(
              apiError(413, 'INVALID_REQUEST', 'upload body exceeds its declared content length'),
              'declared_length_mismatch',
              headers,
            );
          }

          const hash = createHash('sha256').update(bytes).digest('hex');
          const row = {
            id: createdMaterialId,
            ownerId,
            kind: 'source',
            mime,
            bytes: bytes.byteLength,
            originalName,
            sha256: hash,
            displayName: null,
            folderId: null,
            derivedFrom: null,
            status: 'ready',
            // 上游：library 上传进池后排队，classic 看 `extract`。
            extraction: { status: libraryUpload || extract ? 'pending' : 'idle' },
            createdAt: Date.now(),
          };
          await lib.putBytes(createdMaterialId, bytes, mime, { name: originalName });
          await lib.put(row);
          // 会话附件：上游是 `agent_session_materials` 的一张链接表，这里并入同一张表。
          if (body?.sessionId) {
            await vaultPort().materials.put({
              ...row,
              sessionId: String(body.sessionId),
              extractionStatus: 'pending',
            });
          }

          const view = publicMaterial(row);
          phase = 'done';
          const response = jsonResponse(
            {
              materialId: view.materialId,
              originalName: view.originalName,
              bytes: view.bytes,
              mime: view.mime,
              mediaKind: view.mediaKind,
              extraction: view.extraction,
            },
            201,
          );
          response.headers.set('x-request-id', requestId);
          for (const [key, value] of headers) response.headers.append(key, value);
          log.info?.('material upload completed', context({ status: 201 }));
          return response;
        } catch (error) {
          log.error?.('material upload failed', context({ status: 500 }), error?.message ?? error);
          const response = apiError(500, 'INTERNAL_ERROR', 'material upload failed');
          response.headers.set('x-request-id', requestId);
          for (const [key, value] of headers) response.headers.append(key, value);
          return response;
        }
      });
    },

    /**
     * `GET /api/materials/[id]`（源文件:app/api/materials/[id]/route.ts:62-92）。
     *
     * `q` 同 `list`：可带 `sessionId` 走会话范围，不带就是库里的一条。
     */
    async get(id, q) {
      const sessionIdRaw = searchParam(q, 'sessionId');
      const sessionId = sessionIdRaw === null ? undefined : String(sessionIdRaw).trim();
      if (hasSearchParam(q, 'sessionId') && !sessionId) {
        return apiError(400, 'MISSING_REQUIRED_FIELD', 'sessionId must not be empty');
      }
      if (!sessionId) {
        if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
        return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
          if (!MATERIAL_ID_PATTERN.test(String(id))) return ownerNotFound(headers);
          const record = await library().get(ownerId, id);
          if (!record) return ownerNotFound(headers);
          return jsonResponse({ material: publicMaterial(record) }, 200, headers);
        });
      }
      if (!hasLibrary()) return plainResponse(404, NOT_FOUND);

      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const row = await vaultPort().materials.get(sessionId, String(id));
        if (!row || (row.ownerId && row.ownerId !== ownerId)) return ownerNotFound(headers);
        return jsonResponse({ material: sessionScopeMaterialView(row) }, 200, headers);
      });
    },

    /**
     * `DELETE /api/materials/[id]`（源文件:app/api/materials/[id]/route.ts:126-159）。
     *
     * classic 素材回 200 `{ materialId, deleted:true }`，库素材回 204 空 body ——
     * 上游按 `usesClassicExtraction(record)` 分这两条，这里同一判据换成
     * `record.extraction?.format === 'classic'`（本包上传的都是 classic 形态）。
     */
    async remove(id, q) {
      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const lib = library();
        const record = await lib.raw(ownerId, String(id));
        if (!record || record.deletedAt) return ownerNotFound(headers);
        if (record.derivedFrom) {
          return libraryRefusal(409, 'derivative', 'Delete the source instead', headers);
        }
        const classic = record.extraction?.format === 'classic'
          || record.extraction?.status === 'idle'
          || record.extraction?.status === 'pending';
        if (!classic && !hasLibrary()) return plainResponse(404, NOT_FOUND, headers);
        // 派生品随源一起删（上游 `deleteMaterial` 的同一语义）。
        const families = (await lib.all(ownerId)).filter((row) => row.derivedFrom === record.id);
        for (const derivative of families) {
          // eslint-disable-next-line no-await-in-loop
          await lib.remove(derivative.id);
          // eslint-disable-next-line no-await-in-loop
          await lib.removeBytes(derivative.id);
        }
        await lib.remove(record.id);
        if (hasBytes()) await lib.removeBytes(record.id);
        return classic
          ? jsonResponse({ materialId: String(id), deleted: true }, 200, headers)
          : { httpStatus: 204, body: null, headers };
      });
    },

    /**
     * `PATCH /api/materials/[id]`（源文件:app/api/materials/[id]/route.ts:94-124）。
     *
     * **表外的一条**：`ROUTES.md` 批 2 表只列了 GET/DELETE，上游还有 PATCH（改名），
     * 少了它「改名」就没有落点，所以一并搬进来（`ROUTES.md` §6 已记）。
     */
    async rename(id, body, q) {
      if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
      const name = body?.name;
      if (typeof name !== 'string') {
        return libraryRefusal(400, 'invalid_body', 'name is required', new Headers());
      }
      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const trimmed = name.trim();
        if (trimmed.length === 0 || trimmed.length > MATERIAL_NAME_MAX_LENGTH) {
          return libraryRefusal(400, 'invalid_name', 'The name is empty or too long', headers);
        }
        const lib = library();
        const record = await lib.raw(ownerId, String(id));
        if (!record || record.deletedAt || record.status !== 'ready') {
          return ownerNotFound(headers);
        }
        if (record.derivedFrom) {
          return libraryRefusal(409, 'derivative', 'Rename the source instead', headers);
        }
        const current = record.displayName ?? record.originalName;
        if (current === trimmed) {
          return jsonResponse({ status: 'unchanged', materialId: record.id, name: trimmed }, 200, headers);
        }
        await lib.put({ ...record, displayName: trimmed });
        return jsonResponse({ status: 'renamed', materialId: record.id, name: trimmed }, 200, headers);
      });
    },

    /**
     * `POST /api/materials/[id]/extraction`（源文件:app/api/materials/[id]/extraction/route.ts:26-72）。
     *
     * 上游是 `GET` 还是 `POST`：**上游只有 POST**（表里写的是 GET，见 `ROUTES.md` §6）。
     * 没有提取器进程：把 idle/failed 标成 pending 就返回 —— 上游注释也是
     * 「queueing is enough: instrumentation starts the scanner」。
     */
    async extraction(id, q) {
      if (!hasPersistence()) return plainResponse(404, NOT_FOUND);
      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const lib = library();
        const record = await lib.raw(ownerId, String(id));
        if (!record || record.kind !== 'source' || record.derivedFrom) {
          return ownerNotFound(headers);
        }
        const status = record.extraction?.status ?? 'idle';
        if (status !== 'idle' && status !== 'failed') {
          return apiError(
            409,
            'INVALID_REQUEST',
            `The material's extraction is ${status}`,
            undefined,
            undefined,
            headers,
          );
        }
        const current = await lib.put({ ...record, extraction: { ...(record.extraction ?? {}), status: 'pending' } });
        return jsonResponse({ material: publicMaterial(current) }, 200, headers);
      });
    },

    /**
     * `GET /api/materials/[id]/original`（源文件:app/api/materials/[id]/original/route.ts:42-83）。
     *
     * 二进制分支：`{ httpStatus, buffer, mimeType, headers }`，不用 Node stream。
     */
    async original(id, q) {
      if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const lib = library();
        const record = await lib.get(ownerId, String(id));
        if (!record || record.kind !== 'source') return ownerNotFound(headers);
        const displayName = record.displayName ?? null;
        const fileName = originalDownloadName(displayName, record.originalName);
        let bytes;
        try {
          if (!hasBytes()) throw new Error('assets 端口缺失');
          bytes = await lib.bytes(record.id);
        } catch (error) {
          log.warn?.(`original 读取失败 [materialId=${record.id}]`, error?.message ?? error);
          return libraryRefusal(
            503,
            'unavailable',
            'The original file cannot be read',
            headers,
            {},
            'ASSET_NOT_FOUND',
          );
        }
        const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        return binaryResponse(
          200,
          buffer,
          opensInline(record.mime) ? String(record.mime).toLowerCase() : 'application/octet-stream',
          originalResponseHeaders({
            materialId: record.id,
            mime: record.mime,
            originalName: fileName,
            byteLength: buffer.byteLength,
          }),
        );
      });
    },

    /** 素材文件夹（`GET/POST /api/materials/folders`、`PATCH/DELETE /api/materials/folders/[id]`）。 */
    folders: {
      /** 源文件:app/api/materials/folders/route.ts:28-37（GET）。 */
      async list(q) {
        if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
        const query = String(searchParam(q, 'query') ?? '').trim() || undefined;
        return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
          const folders = await library().folders(ownerId, query ? { query } : {});
          return jsonResponse({ folders }, 200, headers);
        });
      },

      /** 源文件:app/api/materials/folders/route.ts:39-67（POST）。 */
      async create(body, q) {
        if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
        const name = body?.name;
        if (typeof name !== 'string') {
          return libraryRefusal(400, 'invalid_body', 'name is required', new Headers());
        }
        return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
          const lib = library();
          const trimmed = name.trim();
          const check = validateFolderName(trimmed);
          if (!check.ok) {
            return libraryRefusal(400, `name_${check.kind}`, 'Invalid folder name', headers);
          }
          const existing = (await lib.folders(ownerId))
            .find((folder) => normalizedFolderName(folder.name) === normalizedFolderName(trimmed));
          if (existing) return jsonResponse({ folder: existing, created: false }, 200, headers);
          if ((await lib.folders(ownerId)).length >= FOLDER_COUNT_LIMIT) {
            return libraryRefusal(409, 'limit', `At most ${FOLDER_COUNT_LIMIT} folders`, headers);
          }
          const now = Date.now();
          const folder = await lib.putFolder({
            id: randomUUID(),
            ownerId,
            name: trimmed,
            materialCount: 0,
            createdAt: now,
            updatedAt: now,
          });
          return jsonResponse({ folder, created: true }, 201, headers);
        });
      },

      /** 源文件:app/api/materials/folders/[id]/route.ts:27-57（PATCH）。 */
      async update(id, body, q) {
        if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
        const name = body?.name;
        if (typeof name !== 'string') {
          return libraryRefusal(400, 'invalid_body', 'name is required', new Headers());
        }
        return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
          const lib = library();
          const trimmed = name.trim();
          const check = validateFolderName(trimmed);
          if (!check.ok) {
            return libraryRefusal(400, `name_${check.kind}`, 'Invalid folder name', headers);
          }
          const folder = await lib.getFolder(ownerId, String(id));
          if (!folder) return ownerNotFound(headers);
          if (folder.name === trimmed) {
            return jsonResponse({ status: 'unchanged', folder }, 200, headers);
          }
          const taken = (await lib.folders(ownerId)).some((other) => other.id !== folder.id
            && normalizedFolderName(other.name) === normalizedFolderName(trimmed));
          if (taken) {
            return libraryRefusal(409, 'name_taken', 'Another folder has that name', headers);
          }
          const updated = await lib.putFolder({ ...folder, name: trimmed, updatedAt: Date.now() });
          return jsonResponse({ status: 'renamed', folder: updated }, 200, headers);
        });
      },

      /** 源文件:app/api/materials/folders/[id]/route.ts:59-75（DELETE）。 */
      async remove(id, q) {
        if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
        return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
          const lib = library();
          const folder = await lib.getFolder(ownerId, String(id));
          if (!folder) return ownerNotFound(headers);
          // 内容回到顶层（`folder_id IS NULL`），素材本身不动。
          const rows = await lib.all(ownerId);
          for (const row of rows) {
            if (row.folderId !== folder.id) continue;
            // eslint-disable-next-line no-await-in-loop
            await lib.put({ ...row, folderId: null });
          }
          await lib.removeFolder(folder.id);
          return { httpStatus: 204, body: null, headers };
        });
      },
    },

    /**
     * `GET /api/materials/library`（源文件:app/api/materials/library/route.ts:38-98）。
     *
     * `sessionId` 的 `attached` 标记需要上游的链接表，本包没有 → **不返回该字段**
     * （不编 `attached:false`，那会让页面以为"没挂"）。同理，指向别人的/不存在的
     * `sessionId` 也不再有 404 oracle —— 没有会话表就无从判断。
     */
    async library(q) {
      if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
      const rawFolder = searchParam(q, 'folderId');
      const query = String(searchParam(q, 'query') ?? '').trim() || undefined;
      const before = String(searchParam(q, 'before') ?? '').trim() || undefined;
      const includeLimits = searchParam(q, 'limits') !== '0';
      const sourcesOnly = searchParam(q, 'sources') === '1';
      const rawLimit = searchParam(q, 'limit');
      const limit = rawLimit === null || rawLimit === '' ? DEFAULT_LIMIT : Number(rawLimit);
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        return libraryRefusal(
          400,
          'invalid_limit',
          `limit must be an integer between 1 and ${MAX_LIMIT}`,
          new Headers(),
        );
      }
      const folderId = rawFolder === null || rawFolder === ''
        ? undefined
        : rawFolder === 'unfiled' ? null : rawFolder;

      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const lib = library();
        const [entries, folders] = await Promise.all([
          lib.list(ownerId, {
            ...(folderId !== undefined ? { folderId } : {}),
            ...(query ? { query } : {}),
            ...(before ? { before } : {}),
            ...(sourcesOnly ? { sourcesOnly } : {}),
            limit,
          }),
          lib.folders(ownerId),
        ]);
        const usage = await lib.usage(ownerId);
        const limits = includeLimits
          ? {
            documentMaxBytes: MATERIAL_DOCUMENT_UPLOAD_LIMIT,
            mediaMaxBytes: MATERIAL_MEDIA_UPLOAD_LIMIT,
            maxCount: MAX_MATERIALS_PER_OWNER,
            maxTotalBytes: MAX_MATERIAL_BYTES_PER_OWNER,
            usedCount: usage.usedCount,
            usedBytes: usage.usedBytes,
            // 上游 `assetQuotaBytes` 取自部署配置；本包没有池配额 → null。
            assetQuotaBytes: null,
            assetUsedBytes: 0,
          }
          : undefined;
        const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]));
        const nextBefore = entries.length === limit ? entries[entries.length - 1].id : undefined;
        return jsonResponse(
          {
            materials: entries.map((entry) => libraryMaterialView(entry, { folderNames })),
            ...(limits !== undefined ? { limits } : {}),
            ...(nextBefore ? { nextBefore } : {}),
          },
          200,
          headers,
        );
      });
    },

    /**
     * `POST /api/materials/move`（源文件:app/api/materials/move/route.ts:28-75）。
     *
     * 全有或全无：有一个不能移动就 422，什么都不动。
     */
    async move(body, q) {
      if (!hasLibrary()) return plainResponse(404, NOT_FOUND);
      const materialIds = body?.materialIds;
      const folderId = body?.folderId;
      if (
        !Array.isArray(materialIds)
        || materialIds.length === 0
        || !materialIds.every((id) => typeof id === 'string' && id !== '')
        || !(folderId === null || (typeof folderId === 'string' && folderId !== ''))
      ) {
        return libraryRefusal(
          400,
          'invalid_body',
          'materialIds (non-empty strings) and folderId (a string or null) are required',
          new Headers(),
        );
      }
      return withOwner(ownerDeps, q, async ({ ownerId, headers }) => {
        const lib = library();
        if (folderId !== null && !(await lib.getFolder(ownerId, folderId))) {
          return ownerNotFound(headers);
        }
        if (materialIds.length > MAX_MOVE_MATERIALS) {
          return libraryRefusal(
            400,
            'too_many',
            `Move at most ${MAX_MOVE_MATERIALS} at a time`,
            headers,
          );
        }
        const notMovable = [];
        for (const id of materialIds) {
          // eslint-disable-next-line no-await-in-loop
          const record = await lib.get(ownerId, id);
          if (!record || record.kind !== 'source' || record.derivedFrom) notMovable.push(id);
        }
        if (notMovable.length > 0) {
          return libraryRefusal(
            422,
            'not_movable',
            'Some materials cannot be moved',
            headers,
            { materialIds: notMovable },
          );
        }
        const rows = await lib.all(ownerId);
        let movedCount = 0;
        for (const row of rows) {
          const named = materialIds.includes(row.id);
          const derived = row.derivedFrom && materialIds.includes(row.derivedFrom);
          if (!named && !derived) continue;
          if ((row.folderId ?? null) === folderId) continue;
          // eslint-disable-next-line no-await-in-loop
          await lib.put({ ...row, folderId });
          if (named) movedCount += 1;
        }
        return jsonResponse(
          {
            status: movedCount > 0 ? 'moved' : 'unchanged',
            materialIds,
            folderId,
            movedCount,
          },
          200,
          headers,
        );
      });
    },
  };

  // ── service.media ────────────────────────────────────────────────────────

  const media = {
    /**
     * `GET /api/classroom-media/[classroomId]/[...path]`
     * （源文件:app/api/classroom-media/[classroomId]/[...path]/route.ts:34-153）。
     *
     * 上游读 `CLASSROOMS_DIR/<id>/<media|audio>/<file>`；本包没有那个目录，
     * 改成读 `vault.assets`（`stageId = classroomId`，`assetId` = 文件名或资产 id）。
     * 二进制 + Range：`{ httpStatus, buffer, mimeType, headers }`，206/416 的头部照抄。
     */
    async asset(classroomId, pathSegments, request) {
      const SUCCESS_CACHE_HEADERS = { 'Cache-Control': 'private, max-age=300, must-revalidate' };
      const ERROR_CACHE_HEADERS = { 'Cache-Control': 'private, no-store' };

      // Validate classroomId
      if (!/^[a-zA-Z0-9_-]+$/.test(String(classroomId ?? ''))) {
        return jsonResponse({ error: 'Invalid classroom ID' }, 400, new Headers(ERROR_CACHE_HEADERS));
      }

      const segments = Array.isArray(pathSegments)
        ? pathSegments.map(String)
        : String(pathSegments ?? '').split('/').filter(Boolean);
      // Validate path segments — no traversal
      const joined = segments.join('/');
      if (joined.includes('..') || segments.some((segment) => segment.includes('\0'))) {
        return jsonResponse({ error: 'Invalid path' }, 400, new Headers(ERROR_CACHE_HEADERS));
      }

      // Only allow media/ and audio/ subdirectories
      const subDir = segments[0];
      if (subDir !== 'media' && subDir !== 'audio') {
        return jsonResponse({ error: 'Invalid path' }, 404, new Headers(ERROR_CACHE_HEADERS));
      }

      const vault = vaultPort();
      if (!vault?.assets?.bytes || !vault?.assets?.list) {
        // 上游 `ENOENT`：没有文件就没有课堂媒体。
        return jsonResponse({ error: 'Not found' }, 404, new Headers(ERROR_CACHE_HEADERS));
      }

      const fileName = segments[segments.length - 1];
      try {
        const entries = await vault.assets.list(String(classroomId));
        const hit = entries.find((entry) => entry?.meta?.name === fileName)
          ?? entries.find((entry) => entry?.id === fileName)
          ?? entries.find((entry) => `${entry?.id}` === joined);
        if (!hit) return jsonResponse({ error: 'Not found' }, 404, new Headers(ERROR_CACHE_HEADERS));

        const raw = await vault.assets.bytes(String(classroomId), hit.id);
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        const extension = extname(fileName).toLowerCase();
        const contentType = CLASSROOM_MEDIA_MIME_TYPES[extension] ?? 'application/octet-stream';

        // Range requests enable progressive playback and seeking for hosted media
        const range = parseRangeHeader(request?.range ?? request?.headers?.range ?? null, bytes.byteLength);

        if (range.kind === 'unsatisfiable') {
          return {
            httpStatus: 416,
            buffer: null,
            mimeType: null,
            headers: new Headers({
              ...ERROR_CACHE_HEADERS,
              'Content-Range': `bytes */${bytes.byteLength}`,
            }),
          };
        }

        if (range.kind === 'range') {
          return binaryResponse(
            206,
            bytes.subarray(range.start, range.end + 1),
            contentType,
            new Headers({
              ...SUCCESS_CACHE_HEADERS,
              'Content-Type': contentType,
              'Content-Length': String(range.end - range.start + 1),
              'Content-Range': `bytes ${range.start}-${range.end}/${bytes.byteLength}`,
              'Accept-Ranges': 'bytes',
            }),
          );
        }

        return binaryResponse(
          200,
          bytes,
          contentType,
          new Headers({
            ...SUCCESS_CACHE_HEADERS,
            'Content-Type': contentType,
            'Content-Length': String(bytes.byteLength),
            'Accept-Ranges': 'bytes',
          }),
        );
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'E_NOT_FOUND') {
          return jsonResponse({ error: 'Not found' }, 404, new Headers(ERROR_CACHE_HEADERS));
        }
        log.error?.(`Classroom media serving failed [classroomId=${classroomId}, path=${joined}]:`, error?.message ?? error);
        return jsonResponse({ error: 'Internal error' }, 500, new Headers(ERROR_CACHE_HEADERS));
      }
    },

    /**
     * `POST /api/parse-pdf`（源文件:app/api/parse-pdf/route.ts:27-127）。
     *
     * `file` = `{ buffer, filename, mimeType?, providerId? }`（上游 `req.formData()`）。
     * 上游那段「按 document 槽位解析 provider」在本包是 `ports.media.parsePdf`
     * 自己的事（领域包里就是 `pickProvider('pdf', …)`）。
     */
    async parsePdf(file) {
      const port = mediaPort();
      if (!port || typeof port.parsePdf !== 'function') {
        throw notImplemented(
          'zhiyunClassroomStudio.media.parsePdf',
          'app/api/parse-pdf/route.ts:99-105',
        );
      }
      if (!file || !file.buffer) {
        return apiError(400, 'MISSING_REQUIRED_FIELD', 'No PDF file provided');
      }
      const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
      const fileName = file.filename ?? 'document.pdf';
      try {
        const result = await port.parsePdf(buffer, {
          ...(file.providerId ? { providerId: file.providerId } : {}),
          fileName,
          mimeType: file.mimeType ?? 'application/pdf',
          textOnly: file.textOnly,
        });
        if (!result || result.ok === false) {
          return apiError(500, 'PARSE_FAILED', result?.message ?? 'Unknown error');
        }
        // 端口的 `ok` 是它自己的信封，`provider` 是它的诊断字段：都不进上游的 body。
        const { ok: _ok, provider: _provider, ...parsed } = result;
        const resultWithMetadata = {
          ...parsed,
          metadata: {
            ...(parsed.metadata ?? {}),
            pageCount: parsed.metadata?.pageCount ?? 0, // Ensure pageCount is always a number
            fileName,
            fileSize: buffer.byteLength,
          },
        };
        return apiSuccess({ data: resultWithMetadata });
      } catch (error) {
        log.error?.(`PDF parsing failed [file="${fileName}"]:`, error?.message ?? error);
        return apiError(500, 'PARSE_FAILED', error instanceof Error ? error.message : 'Unknown error');
      }
    },

    /**
     * `POST /api/transcription`（源文件:app/api/transcription/route.ts:29-115）。
     *
     * `file` = `{ buffer, filename, mimeType?, providerId?, language? }`；
     * `opts` = `{ providerId?, modelId?, language? }`（覆盖 file 上的同名字段）。
     */
    async transcribe(file, opts = {}) {
      const port = mediaPort();
      if (!port || typeof port.asr !== 'function') {
        throw notImplemented(
          'zhiyunClassroomStudio.media.transcribe',
          'app/api/transcription/route.ts:94-96',
        );
      }
      if (!file || !file.buffer) {
        return apiError(400, 'MISSING_REQUIRED_FIELD', 'Audio file is required');
      }
      const buffer = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer);
      // Trim the client model id and normalize empty → undefined（上游 line 39 的同一句）。
      const modelId = String(opts.modelId ?? file.modelId ?? '').trim() || undefined;
      const language = opts.language ?? file.language ?? 'auto';
      try {
        const result = await port.asr(buffer, {
          ...(opts.providerId ?? file.providerId
            ? { providerId: opts.providerId ?? file.providerId }
            : {}),
          ...(modelId ? { model: modelId } : {}),
          language,
        });
        if (!result || result.ok === false) {
          return apiError(500, 'TRANSCRIPTION_FAILED', 'Transcription failed', result?.message);
        }
        return apiSuccess({ text: result.text });
      } catch (error) {
        log.error?.('Transcription failed:', error?.message ?? error);
        return apiError(
          500,
          'TRANSCRIPTION_FAILED',
          'Transcription failed',
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
    },

    /**
     * `POST /api/proxy-media`（源文件:app/api/proxy-media/route.ts:23-114）。
     *
     * **上游是 POST**（`ROUTES.md` 批 2 表写的是 GET，见 §6）。
     * 二进制：`{ httpStatus, buffer, mimeType, headers }`。
     */
    async proxy(url, opts = {}) {
      try {
        const target = url ?? opts?.url;
        if (!target || typeof target !== 'string') {
          return apiError(400, 'MISSING_REQUIRED_FIELD', 'Missing or invalid url');
        }

        // Initial SSRF validation
        const ssrfError = validateUrlForSSRF(target);
        if (ssrfError) return apiError(403, 'INVALID_URL', ssrfError);

        const MAX_REDIRECTS = 5;
        let currentUrl = target;
        let response;
        const hopInit = { redirect: 'manual' };
        for (let hop = 0; ; hop += 1) {
          // eslint-disable-next-line no-await-in-loop
          response = await fetchImpl(currentUrl, hopInit);
          if (response.status < 300 || response.status >= 400) break; // not a redirect
          const location = response.headers.get('location');
          if (!location) {
            return apiError(502, 'UPSTREAM_ERROR', 'Redirect response without Location header');
          }
          if (hop >= MAX_REDIRECTS) {
            return apiError(502, 'TOO_MANY_REDIRECTS', 'Too many redirects');
          }
          let nextUrl;
          try {
            nextUrl = new URL(location, currentUrl).href; // resolve relative redirects
          } catch {
            return apiError(502, 'INVALID_URL', 'Invalid redirect Location');
          }
          // Re-validate each redirect hop to prevent redirect-to-internal SSRF (#398)
          const hopError = validateUrlForSSRF(nextUrl);
          if (hopError) return apiError(403, 'INVALID_URL', hopError);
          currentUrl = nextUrl;
        }

        if (!response.ok) {
          // Forward client (4xx) errors as-is …; collapse upstream 5xx to 502.
          const status = response.status >= 400 && response.status < 500 ? response.status : 502;
          return apiError(status, 'UPSTREAM_ERROR', `Upstream returned ${response.status}`);
        }

        const contentLength = Number(response.headers.get('content-length') ?? '');
        if (Number.isFinite(contentLength) && contentLength > MAX_PROXY_BYTES) {
          return apiError(502, 'UPSTREAM_ERROR', `Upstream asset too large (${contentLength} bytes)`);
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.byteLength > MAX_PROXY_BYTES) {
          return apiError(502, 'UPSTREAM_ERROR', `Upstream asset too large (${bytes.byteLength} bytes)`);
        }
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        return binaryResponse(200, bytes, contentType, new Headers({
          'Content-Type': contentType,
          'Content-Length': String(bytes.byteLength),
          'Cache-Control': 'private, max-age=3600',
        }));
      } catch (error) {
        // A connect-time refusal … is reported as INVALID_URL upstream; 本包的
        // SSRF 只有 URL 层（见 `validateUrlForSSRF`），这里就是普通失败。
        log.error?.('Proxy media failed:', error?.message ?? error);
        return apiError(500, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error));
      }
    },

    /**
     * `GET /api/comfyui-workflows`（源文件:app/api/comfyui-workflows/route.ts:16-23）。
     *
     * 上游读 `process.cwd()/public`；本包没有 `public/`：`dataDir` 为 null（或
     * `dataDir/public` 不存在）时走上游「目录不存在」的分支 —— 空清单 200。
     * 分支判断照抄 `lib/media/comfyui-workflows.ts:72-98`。
     */
    async comfyuiWorkflows() {
      try {
        const publicDir = deps.dataDir ? join(String(deps.dataDir), 'public') : null;
        if (!publicDir) return jsonResponse({ workflows: [] }, 200, new Headers());
        let entries;
        try {
          entries = await readdir(publicDir, { withFileTypes: true });
        } catch {
          return jsonResponse({ workflows: [] }, 200, new Headers());
        }
        const workflows = [];
        for (const entry of entries) {
          if (!isComfyuiWorkflowFilename(entry.name)) continue;
          // eslint-disable-next-line no-await-in-loop
          const info = await stat(join(publicDir, entry.name)).catch(() => null);
          if (!info || !info.isFile()) continue;
          workflows.push({ id: entry.name, name: filenameToDisplayName(entry.name) });
        }
        workflows.sort((a, b) => a.name.localeCompare(b.name));
        return jsonResponse({ workflows }, 200, new Headers());
      } catch (error) {
        log.error?.('[ComfyUI Workflows API] Failed to list workflows:', error?.message ?? error);
        return jsonResponse({ workflows: [] }, 200, new Headers());
      }
    },

    /**
     * `POST /api/generate/image`（源文件:app/api/generate/image/route.ts:47-103）。
     *
     * `body` = `{ prompt, negativePrompt?, width?, height?, aspectRatio?, providerId?, model? }`。
     * 上游从 `x-image-provider` 等 header 取 provider；本包的入参直接收同名字段。
     */
    async image(body) {
      const port = mediaPort();
      if (!port || typeof port.image !== 'function') {
        throw notImplemented(
          'zhiyunClassroomStudio.media.image',
          'app/api/generate/image/route.ts:70-77',
        );
      }
      if (!body?.prompt) {
        return apiError(400, 'MISSING_REQUIRED_FIELD', 'Missing prompt');
      }
      try {
        const result = await port.image(body.prompt, {
          ...(body.providerId ? { providerId: body.providerId } : {}),
          ...(body.model ? { model: body.model } : {}),
          width: body.width,
          height: body.height,
          aspectRatio: body.aspectRatio,
          negativePrompt: body.negativePrompt,
        });
        if (!result || result.ok === false) {
          const message = String(result?.message ?? '');
          if (message.includes('SensitiveContent') || message.includes('sensitive information')) {
            log.warn?.(`Image blocked by content safety filter: ${message}`);
            return apiError(
              400,
              'CONTENT_SENSITIVE',
              'The image provider rejected this prompt under its content safety policy',
            );
          }
          log.error?.(`Image generation failed: ${message}`);
          return apiError(500, 'INTERNAL_ERROR', 'Image generation failed');
        }
        const { ok: _ok, ...view } = result;
        return apiSuccess({ result: view });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error?.(`Image generation failed: ${message}`);
        return apiError(500, 'INTERNAL_ERROR', 'Image generation failed');
      }
    },

    /**
     * `POST /api/generate/tts`（源文件:app/api/generate/tts/route.ts:57-167）。
     *
     * `body` = `{ text, audioId, ttsVoice?, ttsProviderId?, ttsModelId?, ttsSpeed?, ttsProviderOptions? }`。
     * 上游的 `narration` 步骤＝`ports.media.tts`，base64 由这一层编码（同上游 line 125）。
     */
    async tts(body) {
      const port = mediaPort();
      if (!port || typeof port.tts !== 'function') {
        throw notImplemented(
          'zhiyunClassroomStudio.media.tts',
          'app/api/generate/tts/route.ts:109-131',
        );
      }
      const text = body?.text;
      const audioId = body?.audioId;
      const requestedVoice = typeof body?.ttsVoice === 'string' ? body.ttsVoice.trim() : undefined;
      // A voice that is sent must say something; an absent one means the default.
      if (!text || !audioId || (body?.ttsVoice !== undefined && !requestedVoice)) {
        return apiError(
          400,
          'MISSING_REQUIRED_FIELD',
          'Missing required fields: text, audioId (and a non-empty ttsVoice when sent)',
        );
      }
      try {
        const result = await port.tts(text, {
          ...(requestedVoice ? { voice: requestedVoice } : {}),
          ...(body?.ttsProviderId ? { providerId: body.ttsProviderId } : {}),
          ...(body?.ttsModelId ? { model: body.ttsModelId } : {}),
          speed: body?.ttsSpeed,
          providerOptions: body?.ttsProviderOptions,
        });
        if (!result || result.ok === false) {
          if (result?.code === 'E_RATE_LIMITED') {
            return apiError(429, 'RATE_LIMITED', result.message ?? 'Rate limited');
          }
          log.error?.(`TTS generation failed: ${result?.message ?? ''}`);
          return apiError(500, 'GENERATION_FAILED', result?.message ?? 'TTS generation failed');
        }
        const base64 = Buffer.from(result.bytes ?? []).toString('base64');
        return apiSuccess({ audioId, base64, format: result.format });
      } catch (error) {
        log.error?.('TTS generation failed:', error?.message ?? error);
        return apiError(500, 'GENERATION_FAILED', error instanceof Error ? error.message : String(error));
      }
    },

    /**
     * `POST /api/generate/video`（源文件:app/api/generate/video/route.ts:51-108）。
     *
     * **端口缺方法**：`ports.media` 的签名里没有 `video`
     * （`core-classroom-media/src/index.js:10-20` 只有 tts/asr/image/search/fetch/parsePdf/
     * timeline/providers/status），所以哪怕端口本身在，这条也抛 `E_NOT_IMPLEMENTED`：
     * 编一段视频结果比报错坏得多。要接 `ports.media.video`.
     */
    async video(body) {
      const port = mediaPort();
      if (!port || typeof port.video !== 'function') {
        throw notImplemented(
          'zhiyunClassroomStudio.media.video',
          'app/api/generate/video/route.ts:74-81',
        );
      }
      if (!body?.prompt) {
        return apiError(400, 'MISSING_REQUIRED_FIELD', 'Missing prompt');
      }
      try {
        const result = await port.video(body.prompt, {
          ...(body.providerId ? { providerId: body.providerId } : {}),
          ...(body.model ? { model: body.model } : {}),
          duration: body.duration,
          aspectRatio: body.aspectRatio,
          resolution: body.resolution,
        });
        if (!result || result.ok === false) {
          return apiError(500, 'INTERNAL_ERROR', 'Video generation failed');
        }
        const { ok: _ok, ...view } = result;
        return apiSuccess({ result: view });
      } catch (error) {
        log.error?.('Video generation failed:', error?.message ?? error);
        return apiError(500, 'INTERNAL_ERROR', 'Video generation failed');
      }
    },

    /**
     * `POST /api/generate/voice`（源文件:app/api/generate/voice/route.ts:74-339）。
     *
     * **端口缺方法**：上游这条走的是各 provider 的 `VoiceRegistrationAdapter`
     * （`registerVoice` / `voiceExists` / `bootstrapReferenceClip` / `deleteVoice`），
     * 本仓没有任何端口提供它 → 校验完入参就抛 `E_NOT_IMPLEMENTED`（不编 "registered"）。
     * 要接 `ports.media.voice`.
     */
    async voice(body) {
      const port = mediaPort();
      if (!port || typeof port.voice !== 'function') {
        throw notImplemented(
          'zhiyunClassroomStudio.media.voice',
          'app/api/generate/voice/route.ts:141-148',
        );
      }
      const voiceId = typeof body?.voiceId === 'string' ? body.voiceId.trim() : undefined;
      if (!voiceId) {
        return apiError(400, 'MISSING_REQUIRED_FIELD', 'voiceId is required');
      }
      const deleting = body?.action === 'delete';
      const design = normalizeVoiceDesign(body?.descriptor);
      if (!deleting && !design && !body?.referenceAudioBase64) {
        return apiError(
          400,
          'MISSING_REQUIRED_FIELD',
          'descriptor or referenceAudioBase64 is required',
        );
      }
      try {
        const result = await port.voice({
          ...body,
          voiceId,
          ...(deleting ? { action: 'delete' } : {}),
          ...(design ? { design } : {}),
        });
        if (!result || result.ok === false) {
          return apiError(500, 'GENERATION_FAILED', result?.message ?? 'Voice registration failed');
        }
        const { ok: _ok, ...view } = result;
        return apiSuccess(view);
      } catch (error) {
        log.error?.(`Voice registration failed [voiceId=${voiceId}]:`, error?.message ?? error);
        return apiError(500, 'GENERATION_FAILED', error instanceof Error ? error.message : String(error));
      }
    },
  };

  return { materials, media };
}

/** 上游 `libMaterialView`（`library-view.ts:52-85`）的工作簿子集。 */
function libraryMaterialView(entry, context = {}) {
  const status = entry.extraction?.status ?? 'idle';
  const folderName = entry.folderId ? context.folderNames?.get(entry.folderId) : undefined;
  return {
    materialId: entry.id,
    kind: entry.kind,
    name: entry.displayName ?? entry.originalName ?? entry.id,
    ...(entry.originalName ? { originalName: entry.originalName } : {}),
    ...(entry.mime ? { mime: entry.mime } : {}),
    bytes: entry.bytes,
    folderId: entry.folderId ?? null,
    ...(folderName ? { folderName } : {}),
    ...(entry.derivedFrom ? { derivedFrom: entry.derivedFrom } : {}),
    ...(entry.kind === 'source' ? { opensInline: opensInline(entry.mime) } : {}),
    ...(entry.kind === 'source' ? { extraction: { status } } : {}),
    createdAt: new Date(entry.createdAt).toISOString(),
  };
}

/** 上游 `sessionScopeMaterialView`（`library-view.ts:92-100`）在会话行上的投影。 */
function sessionScopeMaterialView(row) {
  return {
    materialId: row.id,
    kind: row.kind ?? 'source',
    ...(row.mime ? { mime: row.mime } : {}),
    bytes: Number(row.bytes ?? 0),
    ...(row.originalName ? { originalName: row.originalName } : {}),
    ...(row.derivedFrom ? { derivedFrom: row.derivedFrom } : {}),
    mediaKind: materialMediaKind(row.mime),
    extraction: { status: row.extractionStatus ?? row.extraction?.status ?? 'idle' },
    createdAt: new Date(Number(row.createdAt ?? Date.now())).toISOString(),
  };
}

/** 上游 `lib/media/comfyui-workflows.ts:49-55`。 */
function isComfyuiWorkflowFilename(filename) {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false;
  const lower = filename.toLowerCase();
  return lower.endsWith('.json') && (lower.startsWith('comfyui') || lower.includes('workflow'));
}

/** 上游 `lib/media/comfyui-workflows.ts:31-41`。 */
function filenameToDisplayName(filename) {
  return (
    filename
      .replace(/\.json$/i, '')
      .replace(/^comfyui[-_]?/i, '')
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase())
    || 'Default Workflow'
  );
}

/** 上游 `lib/audio/voice-design.ts:45-59`。 */
function normalizeVoiceDesign(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const pick = (value) => (typeof value === 'string' ? value.trim() : '');
  const gender = raw.gender === 'male' || raw.gender === 'female' ? raw.gender : undefined;
  const design = {
    identity: pick(raw.identity),
    texture: pick(raw.texture),
    delivery: pick(raw.delivery),
    ...(gender ? { gender } : {}),
  };
  if (!design.identity && !design.texture && !design.delivery) return undefined;
  return design;
}
