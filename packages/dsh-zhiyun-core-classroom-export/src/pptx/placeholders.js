/**
 * 非幻灯片场景（互动 / 测验 / PBL）在 PPTX 里的"占位页"。
 *
 * 源：ref/OpenMAIC/lib/export/pptx-scene-placeholders.ts:1-655
 *
 * 覆盖三块：① 互动页的包内路径与相对超链接（`interactive/01_标题.html`）；
 * ② 讲义顺序的 deck 计划（幻灯片 / 占位页交替）；③ 占位卡片的排版（左栏标签
 * 标题描述要点，右栏二维码 + 在线地址，底部"在线打开"按钮与离线副本链接）。
 *
 * 与源的两处差别，都在报告里写明：
 * - 二维码图（源 qr-png.ts：`uqr` 生成矩阵 + 手写 PNG）本仓无 `uqr`，不新增依赖，
 *   因此 `qrDataUrl` 恒为空 —— 按钮与 URL 文本仍在，只是没有可扫的图；
 * - 场景标题截断用 `Intl.Segmenter`（Node 22 自带），与源同一策略。
 */

import { placeholderText } from './i18n.js';
import { parseColor } from './colors.js';
import { pblBriefing } from '../pbl.js';

// ── Interactive page naming（源：pptx-scene-placeholders.ts:8-72）─────────────

const ILLEGAL_FILE_NAME_CHARS = /[\\/:*?"<>|]/g;

/** 源：18-20 */
export function normalizeSceneTitle(title) {
  return typeof title === 'string' ? title.trim() : '';
}

/** 源：27-32 */
export function interactivePagePath(index, title) {
  const number = String(index).padStart(2, '0');
  const name = normalizeSceneTitle(title);
  if (!name) return `interactive/${number}.html`;
  return `interactive/${number}_${name.replace(ILLEGAL_FILE_NAME_CHARS, '_')}.html`;
}

/** 源：47-59 */
export function listInteractivePages(scenes) {
  const pages = [];
  for (const scene of scenes) {
    if (scene.content?.type === 'interactive' && scene.content.html) {
      pages.push({
        scene,
        html: scene.content.html,
        path: interactivePagePath(pages.length + 1, scene.title),
      });
    }
  }
  return pages;
}

/** 源：67-72 */
export function relativeHyperlinkTarget(path) {
  return path.replace(
    // eslint-disable-next-line no-control-regex
    /[\u0000- "#%<>?[\\\]^`{|}\u007f]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`,
  );
}

// ── 截断（源：138-193）──────────────────────────────────────────────────────

const graphemeSegmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function graphemes(text) {
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), (part) => part.segment)
    : Array.from(text);
}

const oneLine = (text) => text.replace(/\s+/g, ' ').trim();

/** 源：158-161 */
export function truncate(text, max) {
  const clusters = graphemes(oneLine(text));
  return clusters.length > max ? `${clusters.slice(0, max - 1).join('')}…` : clusters.join('');
}

/** 源：164-166 */
const WIDE_CHAR = /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u;
const EMOJI_CLUSTER = /\p{Emoji_Presentation}|\p{Regional_Indicator}|\uFE0F/u;

/** 源：174-178 */
function clusterWidth(cluster) {
  if (WIDE_CHAR.test(cluster) || EMOJI_CLUSTER.test(cluster)) return 2;
  if (cluster.includes('\u200D') && /\p{Extended_Pictographic}/u.test(cluster)) return 2;
  return 1;
}

/** 源：181-193 */
export function truncateToWidth(text, maxWidth) {
  const clusters = graphemes(oneLine(text));
  const widths = clusters.map(clusterWidth);
  if (widths.reduce((sum, w) => sum + w, 0) <= maxWidth) return clusters.join('');
  let width = 0;
  let count = 0;
  while (count < clusters.length && width + widths[count] <= maxWidth - 1) {
    width += widths[count];
    count++;
  }
  return `${clusters.slice(0, count).join('')}…`;
}

const asText = (value) => (typeof value === 'string' ? value.trim() : '');

function readPblBriefing(content) {
  try {
    return pblBriefing(content);
  } catch {
    return null;
  }
}

// ── deck 计划（源：206-360）─────────────────────────────────────────────────

const MAX_QUIZ_ITEMS = 4;
const MAX_QUIZ_ITEM_LENGTH = 90;
const MAX_PBL_MILESTONES = 4;
const MAX_PBL_MILESTONE_WIDTH = 66;
const MAX_PBL_GOAL_WIDTH = 64;
const MAX_TITLE_LENGTH = 120;

/** 源：212-224 */
export function pptxDeckScenes(scenes, { includePlaceholders = true } = {}) {
  return scenes.filter(
    (scene) =>
      scene.content?.type === 'slide' ||
      (includePlaceholders &&
        (scene.content?.type === 'quiz' ||
          scene.content?.type === 'pbl' ||
          (scene.content?.type === 'interactive' && !!scene.content.html))),
  );
}

/** 源：232-334 */
export function planPptxDeck(scenes, options) {
  const {
    linkInteractivePages = false,
    classroomUrl,
    includePlaceholders = true,
    lang = 'en',
  } = options ?? {};
  const t = (key, vars) => placeholderText(lang, key, vars);
  const pagePaths = new Map(listInteractivePages(scenes).map((page) => [page.scene, page.path]));
  const deck = [];
  let slideIndex = 0;

  const onlineLink = (scene) =>
    classroomUrl
      ? {
          url: classroomSceneUrl(classroomUrl, scene.id),
          label: t('openOnline'),
        }
      : undefined;

  for (const scene of pptxDeckScenes(scenes, { includePlaceholders })) {
    const content = scene.content;
    const title = truncate(normalizeSceneTitle(scene.title), MAX_TITLE_LENGTH);
    if (content.type === 'slide') {
      deck.push({ kind: 'slide', slideIndex: slideIndex++ });
    } else if (content.type === 'interactive') {
      const path = pagePaths.get(scene);
      if (!path) continue;
      const typeLabel = t('interactiveLabel');
      deck.push({
        kind: 'placeholder',
        placeholder: {
          scene,
          sceneType: 'interactive',
          typeLabel,
          title: title || typeLabel,
          description: t('interactiveDesc'),
          online: onlineLink(scene),
          offline: linkInteractivePages
            ? {
                label: t('openOffline'),
                hint: t('offlineHint'),
                target: relativeHyperlinkTarget(path),
                path,
              }
            : undefined,
        },
      });
    } else if (content.type === 'quiz') {
      const questions = content.questions ?? [];
      const typeLabel = t('quizLabel');
      const items = questions
        .slice(0, MAX_QUIZ_ITEMS)
        .map((question) => truncate(question.question ?? '', MAX_QUIZ_ITEM_LENGTH))
        .filter(Boolean);
      if (questions.length > MAX_QUIZ_ITEMS) items.push('…');
      deck.push({
        kind: 'placeholder',
        placeholder: {
          scene,
          sceneType: 'quiz',
          typeLabel,
          title: title || typeLabel,
          description: t('quizDesc'),
          online: onlineLink(scene),
          meta: t('quizQuestionCount', { count: questions.length }),
          items,
        },
      });
    } else if (content.type === 'pbl') {
      const typeLabel = t('pblLabel');
      const briefing = readPblBriefing(content);
      const goal = asText(briefing?.learningObjective) || asText(briefing?.scenario?.goal);
      const milestones = (briefing?.milestones ?? [])
        .slice()
        .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      const items = milestones
        .slice(0, MAX_PBL_MILESTONES)
        .map((milestone) => truncateToWidth(asText(milestone.title), MAX_PBL_MILESTONE_WIDTH))
        .filter(Boolean);
      deck.push({
        kind: 'placeholder',
        placeholder: {
          scene,
          sceneType: 'pbl',
          typeLabel,
          title: title || truncate(asText(briefing?.title), MAX_TITLE_LENGTH) || typeLabel,
          description: t('pblDesc'),
          online: onlineLink(scene),
          lead: goal ? t('pblGoal', { goal: truncateToWidth(goal, MAX_PBL_GOAL_WIDTH) }) : undefined,
          meta: milestones.length ? t('pblMilestoneCount', { count: milestones.length }) : undefined,
          items,
        },
      });
    }
  }
  return deck;
}

/** 源：337-342 */
export function slidesOnlyDeck(slideCount) {
  return Array.from({ length: slideCount }, (_, slideIndex) => ({ kind: 'slide', slideIndex }));
}

/** 源：348-360 */
export function pptxSlideNumbers(deck, slides) {
  const numbers = new Map();
  deck.forEach((entry, position) => {
    if (entry.kind === 'slide') {
      const slide = slides[entry.slideIndex];
      if (slide) numbers.set(slide.id, position + 1);
    }
  });
  return numbers;
}

/** 源：lib/classroom/scene-deep-link.ts:11-20 */
export function classroomPageUrl(origin, classroomId) {
  return `${origin.replace(/\/+$/, '')}/classroom/${encodeURIComponent(classroomId)}`;
}

export function classroomSceneUrl(classroomUrl, sceneId) {
  try {
    const url = new URL(classroomUrl);
    url.searchParams.set('scene', sceneId);
    return url.toString();
  } catch {
    return classroomUrl;
  }
}

// ── 占位页排版（源：362-655）────────────────────────────────────────────────

const FALLBACK_THEME = {
  backgroundColor: '#ffffff',
  fontColor: '#333333',
  fontName: 'Microsoft YaHei',
  accent: '#5b6cf9',
};

function opaqueHex(color, fallback) {
  const parsed = parseColor(color || '');
  return parsed.isValid() && parsed.getAlpha() > 0 ? parsed.setAlpha(1).toHexString() : fallback;
}

/** 源：384-392 */
export function placeholderStyleFor(slides) {
  const theme = slides[0]?.theme;
  return {
    backgroundColor: opaqueHex(theme?.backgroundColor, FALLBACK_THEME.backgroundColor),
    fontColor: opaqueHex(theme?.fontColor, FALLBACK_THEME.fontColor),
    fontName: theme?.fontName || FALLBACK_THEME.fontName,
    accent: opaqueHex(theme?.themeColors?.[0], FALLBACK_THEME.accent),
  };
}

/** 源：395 — 二维码在设计画布上约五分之一宽。 */
const QR_SIZE = 210;

/** 源：408-419 */
function addLinkHotspot(pptxSlide, bounds, hyperlink) {
  pptxSlide.addShape('rect', {
    ...bounds,
    fill: { color: '#ffffff', transparency: 100 },
    line: { color: '#ffffff', transparency: 100 },
    hyperlink,
  });
}

/**
 * 源：430-655 —— 在一张空幻灯片上画占位卡片。
 *
 * `qrDataUrl` 由调用方给（本仓没有 `uqr`，见文件头），缺省时不画二维码，
 * 右下角的 URL 与两个热点照旧。
 */
export function renderScenePlaceholder(
  pptxSlide,
  placeholder,
  style,
  viewport,
  ratios,
  qrDataUrl,
) {
  const { viewportSize, viewportRatio } = viewport;
  const { ratioPx2Inch, ratioPx2Pt } = ratios;
  const u = viewportSize / 1000;
  const height = viewportSize * viewportRatio;
  const inch = (px) => px / ratioPx2Inch;
  const pt = (px) => px / ratioPx2Pt;
  const left = 80 * u;
  const online = placeholder.online;
  const qrLeft = viewportSize - (80 + QR_SIZE) * u;
  const width = online ? qrLeft - left - 40 * u : viewportSize - 160 * u;
  const actionsTop = height - 130 * u;
  const font = { fontFace: style.fontName, color: style.fontColor };

  pptxSlide.background = { color: style.backgroundColor };

  pptxSlide.addShape('rect', {
    x: inch(left),
    y: inch(92 * u),
    w: inch(6 * u),
    h: inch(26 * u),
    fill: { color: style.accent },
    line: { type: 'none' },
  });
  pptxSlide.addText(placeholder.typeLabel, {
    x: inch(left + 16 * u),
    y: inch(88 * u),
    w: inch(width - 16 * u),
    h: inch(34 * u),
    fontFace: style.fontName,
    color: style.accent,
    fontSize: pt(20 * u),
    bold: true,
    margin: 0,
    valign: 'middle',
  });

  pptxSlide.addText(placeholder.title, {
    ...font,
    x: inch(left),
    y: inch(132 * u),
    w: inch(width),
    h: inch(96 * u),
    fontSize: pt(36 * u),
    bold: true,
    margin: 0,
    valign: 'top',
    fit: 'shrink',
  });

  pptxSlide.addText(placeholder.description, {
    ...font,
    x: inch(left),
    y: inch(238 * u),
    w: inch(width),
    h: inch(56 * u),
    fontSize: pt(18 * u),
    margin: 0,
    valign: 'top',
    transparency: 20,
  });

  const compact = !!placeholder.lead;
  const listFontSize = compact ? 15 : 16;
  let y = (compact ? 288 : 300) * u;
  if (placeholder.lead) {
    pptxSlide.addText(placeholder.lead, {
      ...font,
      x: inch(left),
      y: inch(y),
      w: inch(width),
      h: inch(22 * u),
      fontSize: pt(15 * u),
      margin: 0,
      valign: 'middle',
    });
    y += 24 * u;
  }
  if (placeholder.meta) {
    pptxSlide.addText(placeholder.meta, {
      ...font,
      x: inch(left),
      y: inch(y),
      w: inch(width),
      h: inch((compact ? 22 : 30) * u),
      fontSize: pt((compact ? 16 : 18) * u),
      bold: true,
      margin: 0,
      valign: 'middle',
    });
    y += (compact ? 26 : 38) * u;
  }

  if (placeholder.items?.length) {
    const items = placeholder.items;
    pptxSlide.addText(
      items.map((text, index) => ({
        text: text === '…' ? text : `${index + 1}. ${text}`,
        options: { breakLine: index < items.length - 1 },
      })),
      {
        ...font,
        x: inch(left),
        y: inch(y),
        w: inch(width),
        h: inch(Math.max(actionsTop - y - (compact ? 6 : 12) * u, 30 * u)),
        fontSize: pt(listFontSize * u),
        margin: 0,
        valign: 'top',
        paraSpaceBefore: pt((compact ? 2 : 4) * u),
        fit: 'shrink',
      },
    );
  }

  if (online) {
    const button = { x: inch(left), y: inch(actionsTop), w: inch(260 * u), h: inch(52 * u) };
    const hyperlink = { url: online.url, tooltip: online.url };
    pptxSlide.addShape('roundRect', {
      ...button,
      fill: { color: style.accent },
      line: { type: 'none' },
      rectRadius: inch(10 * u),
      hyperlink,
    });
    pptxSlide.addText(
      [
        {
          text: online.label,
          options: {
            hyperlink,
            color: '#ffffff',
            bold: true,
            underline: { style: 'none' },
            fontFace: style.fontName,
          },
        },
      ],
      { ...button, fontSize: pt(20 * u), align: 'center', valign: 'middle', margin: 0 },
    );
    addLinkHotspot(pptxSlide, button, hyperlink);

    if (qrDataUrl) {
      pptxSlide.addImage({
        data: qrDataUrl,
        x: inch(qrLeft),
        y: inch(132 * u),
        w: inch(QR_SIZE * u),
        h: inch(QR_SIZE * u),
      });
    }
    const urlText = {
      x: inch(qrLeft),
      y: inch((132 + QR_SIZE + 8) * u),
      w: inch(QR_SIZE * u),
      h: inch(48 * u),
    };
    pptxSlide.addText([{ text: online.url, options: { hyperlink, color: style.fontColor } }], {
      ...urlText,
      fontFace: style.fontName,
      fontSize: pt(10 * u),
      align: 'left',
      valign: 'top',
      margin: 0,
    });
    addLinkHotspot(
      pptxSlide,
      qrDataUrl
        ? {
            x: inch(qrLeft),
            y: inch(132 * u),
            w: urlText.w,
            h: urlText.y + urlText.h - inch(132 * u),
          }
        : urlText,
      hyperlink,
    );
  }

  if (placeholder.offline) {
    const offline = placeholder.offline;
    const hyperlink = { url: offline.target, tooltip: offline.path };
    const line = {
      x: inch(left),
      y: inch(online ? actionsTop + 62 * u : actionsTop),
      w: inch(width),
      h: inch(28 * u),
    };
    pptxSlide.addText(
      [
        {
          text: offline.label,
          options: { hyperlink, color: style.accent, bold: true, fontFace: style.fontName },
        },
        { text: ` · ${offline.hint}`, options: { color: style.fontColor } },
      ],
      { ...line, fontFace: style.fontName, fontSize: pt(14 * u), margin: 0, valign: 'middle' },
    );
    addLinkHotspot(pptxSlide, line, hyperlink);
  }
}
