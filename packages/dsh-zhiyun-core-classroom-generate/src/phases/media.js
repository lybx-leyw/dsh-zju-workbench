// 源：ref/OpenMAIC/lib/server/generation/run/plan.ts:150-166（mediaItemsOf：按大纲顺序、按 elementId 去重）
// 源：ref/OpenMAIC/lib/server/generation/run/media.ts:1-96（媒体车道：只生成槽位可用的种类、失败不暂停 run）
// 源：ref/OpenMAIC/lib/server/generation/run/media.ts:96-200（checkpoint `media:<elementId>` 与资产落地）
// 源：ref/OpenMAIC/lib/generation-run-client/run-media.ts:1-60（媒体状态投影：done 才有 assetId）
// 源：ref/OpenMAIC/lib/audio/tts-selection.ts:1-60（口播由一个 tts 槽位决定，缺槽位就没配音）

import { describeError } from '../errors.js';

/**
 * 第 3 段：媒体（配图/配视频/配音），**可选**。
 *
 * 输入：`{ outlines, scenes, media, vault, stageId }`；
 * 输出：`{ items, results, skipped, generated }`。
 *
 * # 为什么整段可以跳过
 *
 * 上游媒体车道的前提是「槽位解析成功」（`services.mediaTarget`）；槽位关掉时
 * 占位符原样留在文档里，渲染成「已禁用」。本仓没有图像/TTS provider 服务，
 * 所以这一段的输入是**注入的端口** `config.media`：
 *
 *   ```
 *   media = {
 *     image?:  async ({ prompt, elementId, aspectRatio, style }) => Buffer | { data, mime },
 *     video?:  async ({ prompt, elementId, aspectRatio, style }) => Buffer | { data, mime },
 *     speech?: async ({ text, sceneId, actionId }) => Buffer | { data, mime },
 *   }
 *   ```
 *
 * 端口缺席（或 `opts.media === false`）时本段只发一条 `phase-done`，`generated: 0`、
 * `skipped: <项数>` —— 文档结构不变，只是没有媒体资产。这与上游「槽位关掉」等价。
 *
 * # 失败不终止管线
 *
 * 上游：一项媒体失败不影响场景也不影响其它媒体（`media.ts:25-27`）。这里照办：
 * 失败记 `phase-progress`（`status: 'failed'` + code），继续下一项。
 */

export async function produceMedia({ outlines, scenes, media, vault, stageId, emit, phase = 'media', signal }) {
  const items = collectMediaItems(outlines, scenes);
  const results = [];
  const failures = [];

  if (!media || items.length === 0) {
    if (items.length > 0) {
      emit(phase, 'phase-progress', { step: 'skip', status: 'skipped', reason: 'no-media-port', items: items.length });
    }
    return { items, results, failures, generated: 0, skipped: items.length };
  }

  for (let index = 0; index < items.length; index += 1) {
    if (signal?.aborted) break;
    const item = items[index];
    emit(phase, 'phase-progress', {
      index,
      total: items.length,
      step: 'generate',
      status: 'started',
      mediaType: item.mediaType,
      elementId: item.elementId,
      sceneId: item.sceneId,
    });

    const producer = pickProducer(media, item.mediaType);
    if (!producer) {
      emit(phase, 'phase-progress', {
        index, total: items.length, step: 'generate', status: 'skipped',
        mediaType: item.mediaType, elementId: item.elementId, sceneId: item.sceneId,
        reason: 'no-media-slot',
      });
      continue;
    }

    try {
      const output = await producer(item, { stageId, signal });
      let bytes = toBytes(output, item.mediaType);
      // 端口给了远程 URL：自己下载（带字节上限），不要把它当图片字节。
      if (bytes?.url) bytes = await downloadMedia(bytes.url, item.mediaType, signal);
      if (!bytes || !bytes.data) throw new Error('媒体端口没有返回字节');

      const asset = await vault.assets.put({
        stageId,
        data: bytes.data,
        mime: bytes.mime,
        meta: { elementId: item.elementId, mediaType: item.mediaType, prompt: item.prompt ?? null },
      });

      results.push({
        elementId: item.elementId,
        sceneId: item.sceneId,
        mediaType: item.mediaType,
        assetId: asset.id,
        mime: bytes.mime,
      });
      emit(phase, 'phase-progress', {
        index, total: items.length, step: 'generate', status: 'done',
        mediaType: item.mediaType, elementId: item.elementId, sceneId: item.sceneId, assetId: asset.id,
      });
    } catch (error) {
      if (signal?.aborted) break;
      const described = describeError(error, 'E_UPSTREAM_ERROR');
      failures.push({ elementId: item.elementId, code: described.code, message: described.message });
      emit(phase, 'phase-progress', {
        index, total: items.length, step: 'generate', status: 'failed',
        mediaType: item.mediaType, elementId: item.elementId, sceneId: item.sceneId,
        code: described.code, message: described.message,
      });
    }
  }

  return {
    items,
    results,
    failures,
    generated: results.length,
    skipped: items.length - results.length,
  };
}

/**
 * 待生成的媒体项：图片/视频来自大纲的 `mediaGenerations`（按大纲顺序、
 * 同 `elementId` 只生成一次 —— 上游 `mediaItemsOf`），配音来自场景里的
 * `speech` action（每个场景一条）。
 */
export function collectMediaItems(outlines, scenes) {
  const seen = new Set();
  const items = [];

  outlines.forEach((outline, sceneIndex) => {
    const sceneId = `scene-${Number(outline.order) > 0 ? Number(outline.order) : sceneIndex + 1}`;
    for (const request of outline.mediaGenerations ?? []) {
      const key = request.elementId;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        ...request,
        mediaType: request.type,
        sceneId,
        sceneIndex,
      });
    }
  });

  for (const scene of scenes) {
    // 配音要覆盖**每一条** speech：actions 段产出的旁白是多条（上游 5-10 段），
    // 原先用 `.find` 只取第一条，其余旁白就没有音频 —— 播到那里会静默跳读。
    const speeches = (scene.actions ?? []).filter((action) => action.type === 'speech' && action.text);
    for (const [speechIndex, speech] of speeches.entries()) {
      items.push({
        mediaType: 'audio',
        sceneId: scene.id,
        sceneIndex: scene.order,
        // 用 action.id 做键（唯一），不再硬编码 `-speech-1`：
        // buildScene 的回退路径确实叫 `-speech-1`，但 actions 段的产物叫
        // `-text-<n>`；硬编码会让后者全部对不上，配音就永远挂不上去。
        elementId: speech.id,
        prompt: speech.text,
        text: speech.text,
        actionId: speech.id,
        speechIndex,
      });
    }
  }

  return items;
}

function pickProducer(media, mediaType) {
  if (mediaType === 'audio') {
    return typeof media.speech === 'function' ? media.speech : null;
  }
  const direct = mediaType === 'video' ? media.video : media.image;
  if (typeof direct === 'function') return direct;
  return typeof media.generate === 'function' ? media.generate : null;
}

/**
 * 字节上限（照上游 `lib/media/bounded-download.ts:11-12`）。
 * 配图 20 MiB；视频 200 MiB。超限直接失败，不把超大响应读进内存。
 */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;

function byteCapOf(mediaType) {
  return mediaType === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

/**
 * 把端口的各种返回形态统一成 `{data, mime}`。
 *
 * 支持的形态（按顺序判定）：
 * - `Uint8Array` / `Buffer`
 * - `{data|bytes|base64, mime?}`
 * - `data:` URL（解码）
 * - `http(s)://` URL（交给调用方下载，带字节上限）
 *
 * ⚠️ **不再把任意字符串当原始字节**。原先那条分支会把"服务返回了一个 URL"
 * 静默写成一段 URL 文本当成图片 —— 产出坏资产且不报错。URL 只能走下载，
 * 下载有上限、失败会报错。
 */
function toBytes(output, mediaType = 'image') {
  if (!output) return null;
  const cap = byteCapOf(mediaType);

  if (output instanceof Uint8Array) {
    if (output.byteLength > cap) {
      throw Object.assign(new Error(`媒体超过字节上限（${output.byteLength} > ${cap}）`), {
        code: 'E_MEDIA_TOO_LARGE',
      });
    }
    return { data: output, mime: 'application/octet-stream' };
  }

  if (typeof output === 'string') {
    const dataUrl = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(output);
    if (dataUrl) {
      const mime = dataUrl[1] || 'application/octet-stream';
      const payload = dataUrl[3] ?? '';
      const data = dataUrl[2] ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));
      if (data.byteLength > cap) {
        throw Object.assign(new Error(`媒体超过字节上限（${data.byteLength} > ${cap}）`), {
          code: 'E_MEDIA_TOO_LARGE',
        });
      }
      return { data, mime };
    }
    if (/^https?:\/\//i.test(output)) return { url: output };
    throw Object.assign(new Error('媒体端口返回了无法识别的字符串（既不是 data: 也不是 http URL）'), {
      code: 'E_MEDIA_BAD_OUTPUT',
    });
  }

  if (typeof output === 'object') {
    if (output.url && !output.data && !output.bytes && !output.base64) return { url: String(output.url) };
    let data = output.data ?? output.bytes;
    if (!data && typeof output.base64 === 'string') data = Buffer.from(output.base64, 'base64');
    if (!data) return null;
    if (data instanceof Uint8Array && data.byteLength > cap) {
      throw Object.assign(new Error(`媒体超过字节上限（${data.byteLength} > ${cap}）`), {
        code: 'E_MEDIA_TOO_LARGE',
      });
    }
    return {
      data,
      mime: typeof output.mime === 'string' ? output.mime : 'application/octet-stream',
    };
  }
  return null;
}

/** 远程媒体下载（带字节上限）。上游走 `readResponseBodyWithLimit`。 */
async function downloadMedia(url, mediaType, signal) {
  const cap = byteCapOf(mediaType);
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw Object.assign(new Error(`媒体下载失败：HTTP ${response.status}`), {
      code: 'E_MEDIA_DOWNLOAD_FAILED',
    });
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > cap) {
    throw Object.assign(new Error(`媒体超过字节上限（${buffer.byteLength} > ${cap}）`), {
      code: 'E_MEDIA_TOO_LARGE',
    });
  }
  const mime = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream';
  return { data: buffer, mime };
}
