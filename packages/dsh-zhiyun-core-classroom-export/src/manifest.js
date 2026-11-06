/**
 * 课堂清单（ClassroomManifest）：`.maic.zip`、单文件 HTML、PPTX 三者的共同输入。
 *
 * 源：ref/OpenMAIC/lib/export/use-export-classroom.ts:174-330（清单组装）
 *     ref/OpenMAIC/lib/export/classroom-zip-types.ts:11-154（结构与版本号）
 *     ref/OpenMAIC/lib/export/use-export-classroom.ts:38-60（互动页资源内联）
 *     ref/OpenMAIC/lib/export/classroom-zip-utils.ts（媒体归档路径与 manifest 动作映射）
 *
 * # 服务端化后的两处替换
 *
 * - **互动页资源内联**：上游在这里调 `inlineHtmlAssets`（会去抓 CDN 上的库）；
 *   本包同样调自己的 `inlineHtmlAssets`，抓取器由调用方注入，默认 `fetch`。
 *   抓不到的记录进 `inlineFailures`，页面照旧可用。
 * - **媒体归档**：上游按 `buildStageAssetManifest` 枚举并落库。这里资产是注入的，
 *   归档路径由 `planMedia` 统一分配（`media/audio-N.ext` / `media/video-N.ext`），
 *   同一 ref 在三份产物里路径一致。
 */

import { planMedia } from './assets.js';
import { inlineHtmlAssets } from './inline/inline-assets.js';

export const CLASSROOM_ZIP_FORMAT_VERSION = 1;
export const CLASSROOM_ZIP_EXTENSION = '.maic.zip';

/** 源：use-export-classroom.ts:141-146 */
export function classroomExportBaseName(stageName) {
  return String(stageName ?? '').replace(/[\\/:*?"<>|]/g, '_') || 'classroom';
}

function emptyReport() {
  return { inlined: [], failed: [] };
}

/** 源：use-export-classroom.ts:62-70 */
export async function inlineSceneContent(content, options = {}) {
  if (content?.type !== 'interactive' || !content.html) {
    return { content, report: emptyReport() };
  }
  const { html, report } = await inlineHtmlAssets(content.html, options);
  return { content: { ...content, html }, report };
}

/**
 * 组装清单。
 *
 * @param {object} input
 * @param {object} input.stage
 * @param {object[]} input.scenes
 * @param {object} [input.assets]           normalizeAssets 的结果
 * @param {(url:string)=>Promise<{bytes:Buffer,mimeType?:string}>} [input.fetcher]
 * @param {string} [input.baseUrl]          互动页相对资源的基准地址
 * @param {string} [input.appVersion]
 * @returns {Promise<{manifest:object, files:{path:string,data:Buffer}[], media:object,
 *                    inlineFailures:{url:string,reason:string}[], missingAudioCount:number}>}
 */
export async function buildClassroomManifest(input) {
  const { stage = {}, scenes = [] } = input;
  const assets = input.assets ?? { uriByRef: new Map(), bytesByRef: new Map() };
  const media = planMedia(assets);

  const aggregate = emptyReport();
  const manifestScenes = [];
  for (const scene of scenes) {
    const { content, report } = await inlineSceneContent(scene.content, {
      fetcher: input.fetcher,
      baseUrl: input.baseUrl,
    });
    for (const url of report.inlined) {
      if (!aggregate.inlined.includes(url)) aggregate.inlined.push(url);
    }
    for (const failure of report.failed) {
      if (!aggregate.failed.some((existing) => existing.url === failure.url)) {
        aggregate.failed.push(failure);
      }
    }
    manifestScenes.push({
      type: scene.type ?? content?.type,
      title: scene.title ?? '',
      order: scene.order ?? 0,
      content,
      // 源：classroom-zip-utils.ts 的 actionsToManifest —— audioId 换成 audioRef
      // （归档路径命名空间与 ref 是两套），没有字节的旁白不写 audioRef。
      ...(scene.actions
        ? {
            actions: scene.actions.map((action) => {
              if (!action || action.type !== 'speech') return action;
              const { audioId, audioUrl: _audioUrl, ...rest } = action;
              const audioRef = audioId && media.playback.audio.has(audioId) ? audioId : undefined;
              return { ...rest, ...(audioRef ? { audioRef } : {}) };
            }),
          }
        : {}),
      ...(scene.whiteboards ? { whiteboards: scene.whiteboards } : {}),
    });
  }

  // 旁白引用了但拿不到字节的，记一条 missing 媒体行（源：use-export-classroom.ts:270-290）。
  const mediaIndexEntries = [];
  let missingAudioCount = 0;
  const audioRefs = new Set(media.playback.audio);
  for (const [position, scene] of scenes.entries()) {
    for (const action of scene.actions ?? []) {
      if (action?.type !== 'speech' || !action.audioId) continue;
      if (audioRefs.has(action.audioId)) continue;
      missingAudioCount += 1;
      mediaIndexEntries.push([
        `media/audio-missing-${position + 1}-${missingAudioCount}.mp3`,
        { type: 'audio', sourceRef: action.audioId, missing: true },
      ]);
    }
  }
  for (const [ref, uri] of assets.uriByRef) {
    const { mimeType } = assets.bytesByRef.get(ref) ?? {};
    const type = String(mimeType ?? '').startsWith('audio/')
      ? 'audio'
      : String(mimeType ?? '').startsWith('video/')
        ? 'generated'
        : 'image';
    mediaIndexEntries.push([
      `media/${type}-${mediaIndexEntries.length + 1}.${(mimeType ?? '').split('/')[1] ?? 'bin'}`,
      { type, sourceRef: ref, mimeType: mimeType ?? undefined, size: uri.length },
    ]);
  }

  const manifest = {
    formatVersion: CLASSROOM_ZIP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: input.appVersion ?? '0.0.0',
    stage: {
      name: stage.name ?? '',
      description: stage.description,
      language: stage.languageDirective ?? stage.language,
      style: stage.style,
      videoManifest: stage.videoManifest,
      createdAt: stage.createdAt,
      updatedAt: stage.updatedAt,
    },
    // 源：classroom-zip-types.ts:54-65 —— 代理名册进 manifest（按位置索引）。
    agents: (stage.generatedAgentConfigs ?? []).map((config) => ({
      name: config.name,
      role: config.role,
      persona: config.persona,
      avatar: config.avatar,
      color: config.color,
      priority: config.priority,
      ...(config.voiceConfig ? { voiceConfig: config.voiceConfig } : {}),
      ...(config.voiceDesign ? { voiceDesign: config.voiceDesign } : {}),
    })),
    scenes: manifestScenes,
    mediaIndex: Object.fromEntries(mediaIndexEntries),
  };

  return {
    manifest,
    files: media.files,
    media,
    inlineFailures: aggregate.failed,
    missingAudioCount,
  };
}
