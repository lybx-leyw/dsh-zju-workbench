/**
 * 智云核心「互动课堂」导出层（L2 领域包）。
 *
 * 把 OpenMAIC 的导出层搬成 `ctx.zhiyunClassroomExport`：
 *
 *   pptx(classroom)          → Buffer，一个 .pptx（PPT/ZIP 容器）
 *   html(classroom)          → string，完整单文件 HTML 文档（可直接进 <iframe srcdoc>）
 *   zip(classroom)           → Buffer，classroom.html + 媒体 + README
 *   video(classroom, opts)   → 时间轴/字幕计划；注入了渲染器才真的出片
 *
 * # 依赖方向
 *
 * `inject: ['zhiyunClassroomStudio']` 只声明**硬依赖**（规范 §4）：课堂文档从
 * 宿主服务取。`apply()` **永不抛** —— 服务照常 provide，拿不到文档时方法在自己的
 * 错误里说明原因（与 `host-deeptutor` / `host-classroom` 同一条约定）。
 *
 * 本包不 import 任何别的包的 `src/`：PPTX / HTML / ZIP 三条链路全部自带，媒体字节
 * 由调用方以 `assets` 注入（见 README 的"需要宿主提供什么"）。
 *
 * # 为什么方法都是 async
 *
 * `html()` 要展开互动页的 `@import` 与字体，`pptx()` 要把 LaTeX 转 OMML —— 上游
 * 那边同样是异步的（浏览器里还要等 fetch）。`pptx`/`zip` 返回 `Buffer`，`html`
 * 返回 `string`，都**不是**待拼装的分片。
 */

import { ClassroomExportError } from './errors.js';
import { resolveClassroom, ratiosFor, viewportOf } from './doc.js';
import { buildClassroomManifest } from './manifest.js';
import { normalizeAssets, planMedia } from './assets.js';
import { buildPptxBuffer } from './pptx/deck.js';
import { planPptxDeck } from './pptx/placeholders.js';
import { buildStandaloneHtml, buildStandaloneZip } from './standalone/build.js';
import { assembleStandaloneHtml } from './standalone/assemble.js';
import { prepareStandaloneManifest } from './standalone/prepare-manifest.js';
import { resolvePlayerAssets } from './standalone/player.js';
import { playerStrings, resolveLang } from './pptx/i18n.js';
import { exportVideo } from './video.js';
import { orderManifestScenes } from './standalone/order-scenes.js';

export const name = 'zhiyun-core-classroom-export';

/** 规范 §4：业务包只认服务，不认实现。 */
export const inject = ['zhiyunClassroomStudio'];

export const PACKAGE_VERSION = '0.1.0';

function makeLogger(ctx, config) {
  if (config.logger) return config.logger;
  return {
    debug: (...args) => ctx.logger?.debug?.('[zhiyun-classroom-export]', ...args),
    info: (...args) => ctx.logger?.info?.('[zhiyun-classroom-export]', ...args),
    warn: (...args) => ctx.logger?.warn?.('[zhiyun-classroom-export]', ...args),
    error: (...args) => ctx.logger?.error?.('[zhiyun-classroom-export]', ...args),
  };
}

/**
 * 服务面：每个方法自己取 `ctx.get('zhiyunClassroomStudio')`（宿主可能被重挂），
 * 因此不缓存实例。
 */
function createExportService(ctx, config, log) {
  const studio = () => ctx.get?.('zhiyunClassroomStudio');

  const load = async (classroom, options) => {
    const resolved = await resolveClassroom(studio(), classroom);
    const assets = normalizeAssets(options?.assets ?? resolved.assets);
    // 场景一律按 `order` 重排后再进任何产物（源：order-scenes.ts，导出与播放器共用）。
    // 上游的 store 本来就按播放顺序持有 scenes；文档直传时顺序没有保证，所以在这里统一。
    return { ...resolved, scenes: orderManifestScenes(resolved.scenes ?? []), assets };
  };

  const manifestFor = async (resolved, options) => {
    const manifest = await buildClassroomManifest({
      stage: resolved.stage,
      scenes: resolved.scenes,
      assets: resolved.assets,
      fetcher: options?.fetcher,
      baseUrl: options?.baseUrl,
      appVersion: PACKAGE_VERSION,
    });
    return manifest;
  };

  return {
    /** 诊断：宿主是否就位、四个方法的可用性。 */
    status() {
      const current = studio();
      return {
        state: current ? 'ready' : 'degraded',
        version: PACKAGE_VERSION,
        detail: {
          studio: Boolean(current),
          methods: ['pptx', 'html', 'zip', 'video'],
          player: 'builtin',
        },
      };
    },

    /**
     * PPTX。源：use-export-pptx.ts:530-1309 + pptx-scene-placeholders.ts。
     * @returns {Promise<Buffer>}
     */
    async pptx(classroom, options = {}) {
      const resolved = await load(classroom, options);
      const lang = resolveLang(options.lang ?? resolved.stage?.language ?? 'en');
      const deck = planPptxDeck(resolved.scenes, {
        linkInteractivePages: options.linkInteractivePages === true,
        classroomUrl: options.classroomUrl,
        includePlaceholders: options.includePlaceholders !== false,
        lang,
      });
      // deck 里的 slideIndex 指向 resolved.scenes 里"幻灯片场景"的序号，
      // 与 slides / slideScenes 两个数组的下标一一对应（源：buildPptxBlob 的入参约定）。
      const slideEntries = deck.filter((entry) => entry.kind === 'slide');
      const sceneBySlideIndex = [];
      for (const entry of slideEntries) {
        sceneBySlideIndex[entry.slideIndex] = resolved.scenes.filter((scene) => scene.content?.type === 'slide')[entry.slideIndex];
      }
      const slides = sceneBySlideIndex.filter(Boolean).map((scene) => scene.content.canvas);

      if (slides.length === 0) {
        throw new ClassroomExportError('E_EMPTY', '这份课堂没有可放进 PPTX 的幻灯片');
      }

      const { viewportSize, viewportRatio } = viewportOf(resolved.scenes);
      const media = planMedia(resolved.assets);
      const resolveMedia = async (ref) => {
        if (!ref) return '';
        const direct = resolved.assets.uriByRef.get(ref);
        if (direct) return direct;
        return '';
      };

      const buffer = await buildPptxBuffer(slides, sceneBySlideIndex, ratiosFor(viewportSize, viewportRatio), {
        deck,
        lang,
        resolveMedia,
        allowRemote: options.allowRemote !== false,
        fetch: options.fetch,
        media,
      });

      if (options.report === true) {
        return {
          buffer,
          fileName: `${fileNameOf(resolved.stage)}.pptx`,
          byteSize: buffer.length,
          slideCount: slides.length,
          placeholderCount: deck.filter((entry) => entry.kind === 'placeholder').length,
        };
      }
      return buffer;
    },

    /**
     * 单文件 HTML。源：standalone-html/build-standalone-html.ts:633-851。
     * @returns {Promise<string>} 完整文档（`<!doctype html>` … `</html>`）
     */
    async html(classroom, options = {}) {
      const resolved = await load(classroom, options);
      const built = await manifestFor(resolved, options);
      const lang = options.lang ?? resolved.stage?.language ?? 'en';
      const media = planMedia(resolved.assets);
      const playerAssets = options.playerAssets ?? (await resolvePlayerAssets(options));

      const page = await buildStandaloneHtml(built.manifest, {
        format: 'html',
        dataUris: options.includeMedia === false ? new Map() : media.dataUris,
        videoPosters: media.videoPosters,
        chartImages: media.chartImages,
        playback: options.includeMedia === false ? undefined : media.playback,
        playerAssets,
        lang,
        classroomUrl: options.classroomUrl,
        maxBytes: options.maxBytes,
      });

      if (options.report === true) {
        return {
          html: page.html,
          fileName: `${fileNameOf(resolved.stage)}.html`,
          byteSize: page.byteSize,
          unresolvedMedia: page.unresolved,
          inlineFailures: built.inlineFailures,
          missingAudioCount: built.missingAudioCount,
          player: playerAssets.source ?? 'builtin',
        };
      }
      return page.html;
    },

    /**
     * ZIP：`classroom.html` + 媒体 + README（源：build-standalone-html.ts:799-851）。
     * @returns {Promise<Buffer>}
     */
    async zip(classroom, options = {}) {
      const resolved = await load(classroom, options);
      const built = await manifestFor(resolved, options);
      const lang = options.lang ?? resolved.stage?.language ?? 'en';
      const media = planMedia(resolved.assets);
      const playerAssets = options.playerAssets ?? (await resolvePlayerAssets(options));

      // 图片与媒体都以相对路径随包：清单里写 `images/image-N.ext`，
      // 页面 CSP 换成 `'self' data: blob:`（源同一取舍，见 assemble.ts:33-52）。
      const prepared = prepareStandaloneManifest(built.manifest, {
        dataUris: new Map(media.imagePaths),
        videoPosters: media.videoPosters,
        chartImages: media.chartImages,
        playback: media.playback,
      });

      const page = {
        manifest: prepared.manifest,
        config: {
          strings: playerStrings(lang),
          ...(options.classroomUrl ? { classroomUrl: options.classroomUrl } : {}),
        },
        playerScript: playerAssets.script,
        playerStyle: playerAssets.style,
        ...(playerAssets.mathFonts ? { extraStyles: [playerAssets.mathFonts] } : {}),
        ...(playerAssets.charts ? { extraScripts: [playerAssets.charts] } : {}),
        lang,
      };
      const buffer = buildStandaloneZip(page, {
        files: media.files,
        readme: options.readme,
      });

      if (options.report === true) {
        return {
          buffer,
          fileName: `${fileNameOf(resolved.stage)}.zip`,
          byteSize: buffer.length,
          entries: media.files.map((file) => file.path),
          unresolvedMedia: prepared.unresolved,
        };
      }
      return buffer;
    },

    /**
     * 视频：时间轴 + 字幕（源：video-export/*，渲染部分委派给宿主）。
     */
    async video(classroom, options = {}) {
      const resolved = await load(classroom, options);
      return exportVideo(
        { stage: resolved.stage, scenes: resolved.scenes },
        {
          ...options,
          playbackSpeed: options.playbackSpeed,
        },
      );
    },
  };
}

function fileNameOf(stage) {
  return String(stage?.name ?? '').replace(/[\\/:*?"<>|]/g, '_') || 'classroom';
}

export function apply(ctx, config = {}) {
  const log = makeLogger(ctx, config);
  let remove = () => {};

  try {
    const service = createExportService(ctx, config, log);
    try {
      remove = ctx.provide('zhiyunClassroomExport', service) ?? (() => {});
    } catch (error) {
      // 服务名被占用：能力缺席比整个 profile 起不来好（CONTRIBUTING 3.1）。
      log.error('zhiyunClassroomExport 注册失败，导出能力本次不可用', error?.message ?? error);
    }
    try {
      ctx.on?.('dispose', () => {
        try {
          remove();
        } catch (error) {
          log.warn('卸载时注销 zhiyunClassroomExport 失败', error?.message ?? error);
        }
      });
    } catch (error) {
      log.warn('注册 dispose 钩子失败（已忽略）', error?.message ?? error);
    }
    log.info('课堂导出层就绪：pptx / html / zip / video');
  } catch (error) {
    // 装配阶段任何意外都不该炸掉 profile。
    log.error('课堂导出层装配失败（已降级）', error?.message ?? error);
  }

  return () => {
    try {
      remove();
    } catch (error) {
      log.warn('卸载课堂导出层时出错', error?.message ?? error);
    }
  };
}

export {
  ClassroomExportError,
  buildClassroomManifest,
  buildPptxBuffer,
  buildStandaloneHtml,
  buildStandaloneZip,
  assembleStandaloneHtml,
  planPptxDeck,
  planMedia,
  normalizeAssets,
  exportVideo,
  ratiosFor,
  viewportOf,
};
