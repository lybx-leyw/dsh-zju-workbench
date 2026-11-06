/**
 * 媒体资产表：把"调用方给的字节/URI"归一成导出各层要的三张表。
 *
 * 源：ref/OpenMAIC/lib/export/use-export-classroom.ts:118-215（媒体收集）
 *     ref/OpenMAIC/lib/export/standalone-html/build-standalone-html.ts:192-305（图片编码）
 *     ref/OpenMAIC/lib/export/classroom-zip-utils.ts:1-465（媒体归档路径）
 *
 * 上游的字节来自浏览器 IndexedDB / 对象 URL（`resolveStoredBytes`、媒体生成 store）。
 * 宿主侧没有这些 store，所以字节由调用方注入 —— 这正是本包对宿主的要求之一：
 * **给我 ref → bytes（或 ref → data: URI）**，其余（内联、归档路径、播放表）我负责。
 *
 * 接受三种写法（同一个 Map 里可以混用）：
 *   ref → 'data:image/png;base64,…'
 *   ref → { bytes: Uint8Array|Buffer, mimeType: 'image/png' }
 *   ref → { path: '/abs/file.png' }            // 由宿主读好后传 bytes 亦可
 */

const MIME_EXTENSION = {
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

const EXTENSION_MIME = Object.fromEntries(
  Object.entries(MIME_EXTENSION).map(([mime, extension]) => [extension, mime]),
);

function extensionOf(mime, ref) {
  const normalized = String(mime ?? '').split(';')[0].trim().toLowerCase();
  if (MIME_EXTENSION[normalized]) return MIME_EXTENSION[normalized];
  const path = String(ref ?? '').split(/[?#]/)[0];
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (EXTENSION_MIME[extension]) return extension;
  if (normalized.startsWith('image/')) return normalized.slice(6) || 'bin';
  if (normalized.startsWith('audio/')) return normalized.slice(6) || 'bin';
  if (normalized.startsWith('video/')) return normalized.slice(6) || 'bin';
  return 'bin';
}

function mimeOf(entry, ref) {
  if (entry?.mimeType) return String(entry.mimeType);
  if (typeof entry === 'string') return dataUriMime(entry) ?? guessMimeFromRef(ref);
  return guessMimeFromRef(ref);
}

function guessMimeFromRef(ref) {
  const extension = extensionOf('', ref);
  return EXTENSION_MIME[extension] ?? 'application/octet-stream';
}

function dataUriMime(uri) {
  const match = /^data:([^;,]*)/i.exec(String(uri));
  return match && match[1] ? match[1].toLowerCase() : null;
}

/**
 * @param {Map<string, any>|Record<string, any>|Array<{ref:string}>|undefined} input
 * @returns {{uriByRef: Map<string,string>, bytesByRef: Map<string,{bytes:Buffer, mimeType:string}>}}
 */
export function normalizeAssets(input) {
  const uriByRef = new Map();
  const bytesByRef = new Map();
  if (!input) return { uriByRef, bytesByRef };

  const entries =
    input instanceof Map
      ? [...input.entries()]
      : Array.isArray(input)
        ? input.filter((entry) => entry && entry.ref).map((entry) => [entry.ref, entry])
        : Object.entries(input);

  for (const [ref, entry] of entries) {
    if (!ref) continue;
    if (typeof entry === 'string') {
      if (!/^data:/i.test(entry)) continue;
      uriByRef.set(ref, entry);
      bytesByRef.set(ref, { bytes: dataUriToBuffer(entry), mimeType: dataUriMime(entry) ?? guessMimeFromRef(ref) });
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    if (typeof entry.dataUri === 'string') {
      uriByRef.set(ref, entry.dataUri);
      bytesByRef.set(ref, {
        bytes: dataUriToBuffer(entry.dataUri),
        mimeType: entry.mimeType || dataUriMime(entry.dataUri) || guessMimeFromRef(ref),
      });
      continue;
    }
    if (entry.bytes) {
      const bytes = Buffer.isBuffer(entry.bytes) ? entry.bytes : Buffer.from(entry.bytes);
      if (!bytes.length) continue;
      const mimeType = entry.mimeType || guessMimeFromRef(ref);
      uriByRef.set(ref, `data:${mimeType};base64,${bytes.toString('base64')}`);
      bytesByRef.set(ref, { bytes, mimeType });
    }
  }
  return { uriByRef, bytesByRef };
}

export function dataUriToBuffer(uri) {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(String(uri));
  if (!match) return Buffer.alloc(0);
  const meta = match[1];
  if (/;base64/i.test(meta)) return Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  try {
    return Buffer.from(decodeURIComponent(match[2]), 'utf8');
  } catch {
    return Buffer.from(match[2], 'utf8');
  }
}

/**
 * 把资产表拆成"内联用"与"随包用"两套视图。
 *
 * - `dataUris`：所有图片类引用 → `data:`（单文件 HTML 用）；
 * - `playback.audio`：有字节的音频 ref 集合；
 * - `playback.videos`：视频 ref → 归档路径（`media/<n>.<ext>`）；
 * - `files`：归档路径 → 字节（ZIP 变体用）。
 *
 * 源：build-standalone-html.ts:198-281（同样的三路：archive / 现抓 / 丢弃）。
 */
export function planMedia(assets) {
  const dataUris = new Map();
  const imagePaths = new Map();
  const chartImages = new Map();
  const videoPosters = new Map();
  const audio = new Set();
  const videos = new Map();
  const files = [];
  let index = 0;

  for (const [ref, uri] of assets.uriByRef) {
    const { mimeType } = assets.bytesByRef.get(ref) ?? { mimeType: guessMimeFromRef(ref) };
    if (mimeType.startsWith('audio/')) {
      audio.add(ref);
      const path = `media/audio-${++index}.${extensionOf(mimeType, ref)}`;
      files.push({ path, data: assets.bytesByRef.get(ref)?.bytes ?? dataUriToBuffer(uri) });
      continue;
    }
    if (mimeType.startsWith('video/')) {
      const path = `media/video-${++index}.${extensionOf(mimeType, ref)}`;
      videos.set(ref, path);
      files.push({ path, data: assets.bytesByRef.get(ref)?.bytes ?? dataUriToBuffer(uri) });
      continue;
    }
    if (mimeType.startsWith('image/')) {
      dataUris.set(ref, uri);
      // ZIP 变体把图片落成文件（相对路径），单文件仍用 data: URI。
      const extension = extensionOf(mimeType, ref);
      const path = `${STANDALONE_IMAGE_DIR}/image-${dataUris.size}.${extension}`;
      imagePaths.set(ref, path);
      files.push({
        path,
        data: assets.bytesByRef.get(ref)?.bytes ?? dataUriToBuffer(uri),
      });
    }
  }

  return {
    dataUris,
    imagePaths,
    chartImages,
    videoPosters,
    playback: { audio, videos },
    files,
  };
}

const STANDALONE_IMAGE_DIR = 'images';

/** 源：build-standalone-html.ts:61-75 —— 图片 MIME → 扩展名。 */
export { MIME_EXTENSION as IMAGE_EXTENSION_MIME, extensionOf };
