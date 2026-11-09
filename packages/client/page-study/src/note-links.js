// 笔记正文里的 zy:// 链接点下去之后，落在本节的哪一页、哪一条字幕。
// 链接本身由学习工作台用笔记包的 timeLink / pageLink 生成，这里只做定位。

const LINK = /\[([^\]]+)\]\((zy:\/\/section\/[^)\s]+)\)/g;

/** 把笔记正文拆成普通文字和节内链，供页面渲染。 */
export function noteSegments(markdown = "") {
  const source = String(markdown);
  const parts = [];
  let last = 0;
  for (const match of source.matchAll(LINK)) {
    if (match.index > last) parts.push({ kind: "text", text: source.slice(last, match.index) });
    parts.push({ kind: "link", label: match[1], href: match[2] });
    last = match.index + match[0].length;
  }
  if (last < source.length) parts.push({ kind: "text", text: source.slice(last) });
  return parts;
}

/**
 * @param {object|null} target `parseZySectionUri` 的结果。
 * @param {{courseId?: string, sectionId?: string, slides?: object[], subtitles?: object[]}} here 当前节。
 * @returns {{kind: string, page?: number, index?: number|null, atSec?: number, subtitleIndex?: number|null}|null}
 */
export function focusFromParsed(target, { courseId, sectionId, slides = [], subtitles = [] } = {}) {
  if (!target) return null;
  if (String(target.courseId) !== String(courseId) || String(target.sectionId) !== String(sectionId)) return { kind: "other-section" };
  if (Number.isInteger(target.page) && target.page > 0) {
    const index = slides.findIndex((slide) => slide.page === target.page);
    return { kind: "page", page: target.page, index: index >= 0 ? index : null };
  }
  if (typeof target.atSec === "number" && target.atSec >= 0) {
    if (!subtitles.length) return { kind: "time", atSec: target.atSec, subtitleIndex: null };
    let subtitleIndex = 0;
    subtitles.forEach((line, index) => {
      const current = Math.abs((line.startMs ?? 0) - target.atSec * 1000);
      const best = Math.abs((subtitles[subtitleIndex].startMs ?? 0) - target.atSec * 1000);
      if (current < best) subtitleIndex = index;
    });
    return { kind: "time", atSec: target.atSec, subtitleIndex };
  }
  return { kind: "section" };
}
