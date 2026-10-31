/**
 * 把课堂清单改成"离线自足"的那一版（单文件 HTML 播放器要吃这份）。
 *
 * 源：ref/OpenMAIC/lib/export/standalone-html/prepare-manifest.ts:1-531
 *
 * 改动点与上游一一对应：
 * - 幻灯片富文本过一遍持久化白名单（`sanitize.js`），掉出来的资源记进 unresolved；
 * - 幻灯片图片 / 背景 / 形状图案 / 图表点图 / 视频封面全部换成 `data:`（拿不到就丢）；
 * - 视频源换成"内嵌字节的 key"（`mediaRef`，由播放器的媒体表解析），拿不到就丢；
 * - 播放动作只留离线播放器会重放的那几种；旁白保留文本，只有字节随包才保留 audioRef；
 * - 互动页按 iframe 适配一次；PBL 只留简报；
 * - 播放器用不到的（whiteboards / multiAgent / agents / videoManifest / mediaIndex）全部不写。
 */

import { pblBriefing } from '../pbl.js';
import { patchHtmlForIframe } from './iframe.js';
import { sanitizeSlideRichText } from './sanitize.js';
import { orderManifestScenes } from './order-scenes.js';

export const isDataUri = (value) =>
  typeof value === 'string' && /^data:/i.test(value.trimStart());

function slidesOf(scene) {
  return scene.content?.type === 'slide' ? [scene.content.canvas] : [];
}

/**
 * 源：prepare-manifest.ts:160-195 —— 玩家会显示的每个媒体引用，按文档顺序。
 */
function collectMediaSlots(manifest, keep) {
  const refs = [];
  const seen = new Set();
  const add = (ref, role) => {
    if (!ref || !keep(ref, role)) return;
    const key = `${role}\u0000${ref}`;
    if (seen.has(key)) return;
    seen.add(key);
    refs.push({ ref, role });
  };
  for (const scene of manifest.scenes ?? []) {
    for (const slide of slidesOf(scene)) {
      if (slide.background?.type === 'image') add(slide.background.image?.src, 'background');
      for (const element of slide.elements ?? []) {
        if (element.type === 'image') add(element.src, 'image');
        if (element.type === 'shape') add(element.pattern, 'pattern');
        if (element.type === 'chart') {
          for (const series of element.importedStyle?.series ?? []) {
            for (const image of Object.values(series?.pointImages ?? {})) add(image, 'chart-image');
          }
        }
        if (element.type === 'video') {
          add(element.poster, 'poster');
          add(element.src, 'video');
          add(element.mediaRef, 'video');
        }
      }
    }
  }
  return refs;
}

/** 源：prepare-manifest.ts:138-142 */
export function collectStandaloneMediaReferences(manifest) {
  return collectMediaSlots(manifest, (ref) => !isDataUri(ref));
}

/** 源：prepare-manifest.ts:149-158 */
export function collectInlineImageSources(manifest) {
  return [
    ...new Set(
      collectMediaSlots(manifest, (ref, role) => isDataUri(ref) && role !== 'chart-image' && role !== 'video')
        .map(({ ref }) => ref),
    ),
  ];
}

/** 源：prepare-manifest.ts:209-267 */
function prepareElement(element, media, resolver) {
  const { resolve, lookup } = resolver;
  switch (element.type) {
    case 'image':
      return { ...element, src: resolve(element.src) ?? '' };
    case 'shape': {
      if (!element.pattern) return element;
      const pattern = resolve(element.pattern);
      const { pattern: _dropped, ...rest } = element;
      return pattern ? { ...rest, pattern } : rest;
    }
    case 'chart': {
      if (!element.importedStyle?.series) return element;
      const series = element.importedStyle.series.map((entry) => {
        if (!entry?.pointImages) return entry;
        const pointImages = {};
        for (const [point, image] of Object.entries(entry.pointImages)) {
          const src = resolver.resolveChartImage(image);
          if (src) pointImages[point] = src;
        }
        return { ...entry, pointImages };
      });
      return { ...element, importedStyle: { ...element.importedStyle, series } };
    }
    case 'video': {
      const { mediaRef, poster: rawPoster, src, ...rest } = element;
      const poster =
        lookup(rawPoster) ??
        (src ? media.videoPosters?.get(src) : undefined) ??
        (mediaRef ? media.videoPosters?.get(mediaRef) : undefined);
      if (!poster && rawPoster) resolver.markUnresolved(rawPoster);
      const videos = media.playback?.videos;
      const playable =
        (src ? videos?.get(src) : undefined) ?? (mediaRef ? videos?.get(mediaRef) : undefined);
      if (playable) resolver.usePlaybackMedia(playable);
      else if (videos && (src || mediaRef)) resolver.markUnresolved(src || mediaRef);
      return {
        ...rest,
        src: '',
        ...(poster ? { poster } : {}),
        ...(playable ? { mediaRef: playable } : {}),
      };
    }
    case 'audio':
      return { ...element, src: '' };
    default:
      return element;
  }
}

/** 源：prepare-manifest.ts:269-286 */
function prepareSlide(slide, media, resolver) {
  let background = slide.background;
  if (background?.type === 'image' && background.image) {
    const src = resolver.resolve(background.image.src);
    background = src
      ? { ...background, image: { ...background.image, src } }
      : { ...background, type: 'solid', image: undefined };
  }
  return {
    ...slide,
    ...(background ? { background } : {}),
    elements: (slide.elements ?? []).map((element) => prepareElement(element, media, resolver)),
  };
}

/** 源：prepare-manifest.ts:292-297 */
function preparePblContent(content) {
  const briefing = pblBriefing(content);
  if (!briefing) return { type: 'pbl' };
  return { type: 'pbl', projectV2: briefing };
}

/** 源：prepare-manifest.ts:316-326 */
const REPLAYED_ACTION_TYPES = new Set([
  'speech',
  'spotlight',
  'laser',
  'play_video',
  'discussion',
  'widget_highlight',
  'widget_setState',
  'widget_annotation',
  'widget_reveal',
]);

/** 源：prepare-manifest.ts:338-406 */
export function prepareStandaloneActions(actions, shippedAudio, resolver) {
  const prepared = [];
  for (const entry of actions ?? []) {
    if (!entry || !REPLAYED_ACTION_TYPES.has(entry.type)) continue;
    const base = { id: entry.id };
    switch (entry.type) {
      case 'speech': {
        const audioRef =
          entry.audioRef && shippedAudio?.has(entry.audioRef) ? entry.audioRef : undefined;
        if (audioRef) resolver?.usePlaybackMedia(audioRef);
        prepared.push({
          ...base,
          type: 'speech',
          text: typeof entry.text === 'string' ? entry.text : '',
          ...(audioRef ? { audioRef } : {}),
        });
        break;
      }
      case 'spotlight':
        prepared.push({
          ...base,
          type: 'spotlight',
          elementId: entry.elementId,
          ...(entry.dimOpacity !== undefined ? { dimOpacity: entry.dimOpacity } : {}),
        });
        break;
      case 'laser':
        prepared.push({
          ...base,
          type: 'laser',
          elementId: entry.elementId,
          ...(entry.color ? { color: entry.color } : {}),
        });
        break;
      case 'play_video':
        prepared.push({ ...base, type: 'play_video', elementId: entry.elementId });
        break;
      case 'discussion':
        prepared.push({ ...base, type: 'discussion', topic: entry.topic ?? '' });
        break;
      case 'widget_highlight':
      case 'widget_annotation':
      case 'widget_reveal':
        prepared.push({
          ...base,
          type: entry.type,
          target: entry.target,
          ...(entry.content ? { content: entry.content } : {}),
        });
        break;
      case 'widget_setState':
        prepared.push({
          ...base,
          type: 'widget_setState',
          state: entry.state ?? {},
          ...(entry.content ? { content: entry.content } : {}),
        });
        break;
      default:
        break;
    }
  }
  return prepared;
}

/** 源：prepare-manifest.ts:450-494 */
function prepareScene(scene, media, resolver, mediaId) {
  const actions = prepareStandaloneActions(scene.actions, media.playback?.audio, resolver);
  const rest = {
    type: scene.type,
    title: scene.title,
    order: scene.order,
    content: scene.content,
    ...(actions.length > 0 ? { actions } : {}),
  };
  const content = scene.content ?? {};

  if (content.type === 'slide') {
    const { content: sanitized, discarded } = sanitizeSlideRichText(content);
    for (const resource of discarded) resolver.markUnresolved(resource);
    return {
      ...rest,
      content: { ...sanitized, canvas: prepareSlide(sanitized.canvas, media, resolver) },
    };
  }
  if (content.type === 'pbl') return { ...rest, content: preparePblContent(content) };
  if (content.type === 'interactive') {
    const { url: _url, ...interactive } = content;
    return {
      ...rest,
      content: content.html
        ? {
            ...interactive,
            html: patchHtmlForIframe(content.html, undefined, { processed: true, mediaId }),
          }
        : { ...interactive, html: undefined },
    };
  }
  return rest;
}

/**
 * 源：prepare-manifest.ts:496-531
 * @param {object} manifest
 * @param {{dataUris?: Map<string,string>, videoPosters?: Map<string,string>,
 *          chartImages?: Map<string,string>, playback?: {audio:Set<string>, videos:Map<string,string>}}} media
 * @returns {{manifest: object, unresolved: string[], playbackMedia: string[]}}
 */
export function prepareStandaloneManifest(manifest, media = {}) {
  const unresolved = new Set();
  const playbackMedia = new Set();
  const dataUris = media.dataUris ?? new Map();

  const lookup = (ref) => {
    if (!ref) return undefined;
    return dataUris.get(ref) ?? (isDataUri(ref) ? ref : undefined);
  };
  const lookupChartImage = (ref) => {
    if (!ref) return undefined;
    if (isDataUri(ref)) return ref;
    return media.chartImages?.get(ref) ?? dataUris.get(ref);
  };
  const resolved = (source, ref) => {
    if (!source && ref) unresolved.add(ref);
    return source;
  };
  const resolver = {
    lookup,
    resolve: (ref) => resolved(lookup(ref), ref),
    resolveChartImage: (ref) => resolved(lookupChartImage(ref), ref),
    markUnresolved: (ref) => unresolved.add(ref),
    usePlaybackMedia: (path) => playbackMedia.add(path),
  };

  const scenes = orderManifestScenes(manifest.scenes ?? []).map((scene, index) =>
    prepareScene(scene, media, resolver, `standalone-${index}`),
  );
  const { videoManifest: _videoManifest, ...stage } = manifest.stage ?? {};

  return {
    manifest: { ...manifest, stage, agents: [], scenes, mediaIndex: {} },
    unresolved: [...unresolved],
    playbackMedia: [...playbackMedia],
  };
}
