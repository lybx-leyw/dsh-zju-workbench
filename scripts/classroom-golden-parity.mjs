#!/usr/bin/env node
/**
 * 课堂产物「与原版一致性」比对闸门（规范的 L4，判据 §1 第 1、2 条）。
 *
 *   node scripts/classroom-parity.mjs --a <dirA> --b <dirB> [--json]
 *
 * 输入是两份**课堂产物目录**，各自含 `html()` / `pptx()` 的落盘结果
 * （`classroom.html` / `classroom.pptx`，或目录下唯一的 `*.html` / `*.pptx`），
 * 可选 `classroom.json`（课堂文档，`{ stage, scenes }`）兜底。
 *
 * 三个维度各自独立判定，最后取最差一级：
 *
 *   1. 场景序列   类型 + 顺序 + 数量（顺序不同→equivalent，数量/类型不同→divergent）
 *   2. DOM 文本   从 html 产物里抽可见文本，逐场景 diff，给出首个差异上下文
 *   3. PPTX 结构  解 zip → `ppt/slides/*.xml` 的页数、每页 `<a:t>` 文本集合、
 *                 `<m:oMath>` 数量
 *
 * 分级：identical / equivalent（文本相同，顺序或空白不同）/ divergent（缺场景、缺文本）/
 *      broken（解不开、文件坏了）。退出码 0 = identical|equivalent，1 = divergent|broken。
 *
 * # 为什么自己解 zip
 *
 * 本仓不加依赖（规范 §5 的另一面）：`src/zip/stored-zip.js` 只有写端，这里按中央目录
 * 手写读端，stored(0) 与 deflate(8) 都吃，pptxgenjs 换成压缩输出也不用改。解压用
 * `node:zlib` 的 `inflateRawSync`。
 *
 * # 文本口径
 *
 * "可见文本" = 场景内容里用户会读到的字符串：幻灯片文本元素、公式源码、图表标签、
 * 题干与选项、互动页 HTML（去脚本去样式）、PBL 的项目/里程碑/人物描述。**不含**
 * 正确答案、解析、讲稿（`actions`）——它们要么是答题后才出现，要么不进画面，放进
 * 比对只会把"移植必然的措辞差"误判成回归。
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// ── 文本归一 ────────────────────────────────────────────────────────────────

const ZERO_WIDTH = /[\u200b\u200c\u200d\u2060\ufeff]/g;

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', times: '×', divide: '÷',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** 去零宽、压空白（两种口径：strict 保留单空格分词，loose 连空格一起去掉）。 */
export function normalizeText(value, { loose = false } = {}) {
  let text = decodeEntities(value ?? '')
    .replace(ZERO_WIDTH, '')
    .replace(/\s+/g, ' ');
  if (loose) text = text.replace(/ /g, '');
  else text = text.trim();
  return text;
}

/** HTML 片段 → 可见文本行（去注释/脚本/样式，块级标签断行）。 */
export function htmlToTextLines(html) {
  if (!html) return [];
  let text = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|blockquote|pre)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return text
    .split('\n')
    .map((line) => normalizeText(line))
    .filter(Boolean);
}

// ── 场景文本抽取 ────────────────────────────────────────────────────────────

function pushLines(target, value) {
  for (const line of htmlToTextLines(value)) target.push(line);
}

function fromElements(elements, out) {
  for (const element of elements ?? []) {
    if (!element || typeof element !== 'object') continue;
    switch (element.type) {
      case 'text':
        pushLines(out, element.content ?? element.text ?? '');
        break;
      case 'latex':
        if (element.latex) pushLines(out, element.latex);
        break;
      case 'chart': {
        const data = element.data ?? {};
        for (const label of data.labels ?? []) pushLines(out, label);
        for (const legend of data.legends ?? data.seriesNames ?? []) pushLines(out, legend);
        break;
      }
      case 'table':
        for (const row of element.data ?? element.rows ?? []) {
          for (const cell of row ?? []) pushLines(out, cell?.text ?? cell ?? '');
        }
        break;
      case 'group':
        fromElements(element.elements ?? element.children, out);
        break;
      default:
        // image / video / shape：没有可见文字（图注走 text 元素）。
        break;
    }
  }
}

function fromQuiz(content, out) {
  for (const question of content.questions ?? []) {
    pushLines(out, question.question ?? question.title ?? '');
    for (const option of question.options ?? []) pushLines(out, option.label ?? option.text ?? option.value ?? '');
  }
}

function fromPbl(content, out) {
  const project = content.projectV2 ?? content.project ?? content;
  pushLines(out, project.title ?? '');
  pushLines(out, project.description ?? '');
  pushLines(out, project.learningObjective ?? '');
  const scenario = project.scenario ?? {};
  pushLines(out, scenario.setting ?? '');
  pushLines(out, scenario.goal ?? '');
  pushLines(out, scenario.learnerRole ?? '');
  for (const character of scenario.characters ?? []) {
    pushLines(out, character.name ?? '');
    pushLines(out, character.persona ?? '');
  }
  for (const milestone of project.milestones ?? []) {
    pushLines(out, milestone.title ?? '');
    pushLines(out, milestone.description ?? '');
    for (const task of milestone.microtasks ?? []) {
      pushLines(out, task.title ?? '');
      pushLines(out, task.description ?? '');
      for (const hint of task.hints ?? []) pushLines(out, typeof hint === 'string' ? hint : hint?.text ?? '');
    }
  }
}

/** 未知场景类型：按对象顺序收字符串（跳过明显的机器字段）。 */
const MACHINE_KEYS = new Set([
  'id', 'type', 'stageId', 'src', 'url', 'href', 'color', 'fill', 'stroke', 'backgroundColor',
  'fontName', 'defaultFontName', 'defaultColor', 'themeColors', 'path', 'latex',
  'createdAt', 'updatedAt', 'language', 'status', 'uiPhase', 'proficiency', 'assignee',
]);

function fromUnknown(value, out, depth = 0) {
  if (depth > 6 || value == null) return;
  if (typeof value === 'string') { pushLines(out, value); return; }
  if (Array.isArray(value)) { for (const item of value) fromUnknown(item, out, depth + 1); return; }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (MACHINE_KEYS.has(key)) continue;
    fromUnknown(child, out, depth + 1);
  }
}

/** 单个场景 → 文本行（顺序即画面阅读顺序，标题在前）。 */
export function sceneTextLines(scene) {
  const out = [];
  const content = scene?.content ?? {};
  pushLines(out, scene?.title ?? '');
  const type = scene?.type ?? content.type;
  switch (type) {
    case 'slide':
      pushLines(out, content.canvas?.elements ? '' : content.title ?? '');
      fromElements(content.canvas?.elements ?? content.elements, out);
      break;
    case 'quiz':
      pushLines(out, content.title ?? '');
      fromQuiz(content, out);
      break;
    case 'interactive':
      pushLines(out, content.title ?? '');
      pushLines(out, content.html ?? '');
      break;
    case 'pbl':
      fromPbl(content, out);
      break;
    default:
      fromUnknown(content, out);
      break;
  }
  // 同一行重复（标题同时出现在内容里）只留一份，避免"改了个标题位置"变噪声。
  return out.filter((line, index) => line !== out[index - 1]);
}

// ── 产物读取 ────────────────────────────────────────────────────────────────

const MANIFEST_RE = /<script[^>]*\bid=["']openmaic-classroom["'][^>]*>([\s\S]*?)<\/script>/i;

async function firstFile(dir, preferred, extension) {
  try {
    if ((await stat(path.join(dir, preferred))).isFile()) return path.join(dir, preferred);
  } catch {
    // 落到"目录里唯一那个同类文件"。
  }
  const names = (await readdir(dir)).filter((name) => name.toLowerCase().endsWith(extension)).sort();
  return names.length === 0 ? null : path.join(dir, names[0]);
}

/** 目录 → 三个维度的原料。目录/文件读不开抛（判 broken）；pptx 结构坏只记在 pptx 维度。 */
export async function readArtifacts(dir) {
  const info = await stat(dir).catch(() => null);
  if (!info || !info.isDirectory()) throw new Error(`不是目录：${dir}`);

  const result = { dir, html: null, scenes: null, scenesSource: null, pptx: null, pptxError: null };

  const htmlPath = await firstFile(dir, 'classroom.html', '.html');
  if (htmlPath) {
    const html = await readFile(htmlPath, 'utf8');
    result.html = { file: path.basename(htmlPath), html };
    const match = html.match(MANIFEST_RE);
    if (match) {
      const manifest = JSON.parse(match[1]);
      result.scenes = manifest.scenes ?? [];
      result.scenesSource = 'html-manifest';
    }
  }

  if (!result.scenes) {
    // 没有 html（或 html 里没有清单）：退到目录里的课堂文档。
    const docPath = path.join(dir, 'classroom.json');
    let raw = null;
    try { raw = await readFile(docPath, 'utf8'); } catch { raw = null; }
    if (raw === null) {
      const names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort();
      for (const name of names) {
        // 目录里可能还有别的 json（meta、package），只认带 scenes 的那份。
        const text = await readFile(path.join(dir, name), 'utf8').catch(() => null);
        if (text === null) continue;
        try {
          if (Array.isArray(JSON.parse(text)?.scenes)) { raw = text; break; }
        } catch {
          continue;
        }
      }
    }
    if (raw !== null) {
      const doc = JSON.parse(raw);
      if (!Array.isArray(doc.scenes)) throw new Error('课堂文档缺少 scenes');
      result.scenes = doc.scenes;
      result.scenesSource = 'document';
    }
  }

  const pptxPath = await firstFile(dir, 'classroom.pptx', '.pptx');
  if (pptxPath) {
    const buffer = await readFile(pptxPath);
    try {
      result.pptx = { file: path.basename(pptxPath), ...readPptxStructure(buffer) };
    } catch (error) {
      result.pptxError = `${path.basename(pptxPath)}: ${error.message}`;
    }
  }

  if (!result.scenes && !result.pptx && !result.pptxError) {
    throw new Error('目录里既没有可解析的 html/文档，也没有 pptx');
  }
  return result;
}

// ── ZIP 读端 ────────────────────────────────────────────────────────────────

/**
 * 按中央目录解 zip。返回 `{ path → Buffer }`，顺序即中央目录顺序。
 * 结构坏了（无 EOCD、越界、CRC 不符、不支持的压缩法）一律抛。
 */
export function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('zip 太短');
  let eocd = -1;
  const floor = Math.max(0, buffer.length - 22 - 0xffff);
  for (let index = buffer.length - 22; index >= floor; index--) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { eocd = index; break; }
  }
  if (eocd < 0) throw new Error('找不到 zip 尾部目录（EOCD）');
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (count === 0 || centralOffset + centralSize > buffer.length) throw new Error('zip 中央目录越界');

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`zip 中央目录第 ${index} 条损坏`);
    }
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    cursor += 46 + nameLength + extraLength + commentLength;

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`zip 条目 ${name} 的本地头损坏`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > buffer.length) throw new Error(`zip 条目 ${name} 越界`);

    const raw = buffer.subarray(start, end);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = inflateRawSync(raw); } catch (error) { throw new Error(`zip 条目 ${name} 解压失败：${error.message}`); }
    } else throw new Error(`zip 条目 ${name} 用了不支持的压缩法 ${method}`);

    if (uncompressedSize !== data.length) throw new Error(`zip 条目 ${name} 长度不符（${data.length}≠${uncompressedSize}）`);
    entries.set(name, data);
  }
  return entries;
}

const SLIDE_RE = /^ppt\/slides\/slide(\d+)\.xml$/;

function xmlTextNodes(xml) {
  const nodes = [];
  for (const match of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
    const text = normalizeText(match[1]);
    if (text) nodes.push(text);
  }
  return nodes;
}

/** pptx → { pageCount, pages: [{index, text, textSet, math}], math }。 */
export function readPptxStructure(buffer) {
  const entries = readZipEntries(buffer);
  if (!entries.has('ppt/presentation.xml')) throw new Error('pptx 缺 ppt/presentation.xml');
  const slideNames = [...entries.keys()]
    .filter((name) => SLIDE_RE.test(name))
    .sort((left, right) => Number(left.match(SLIDE_RE)[1]) - Number(right.match(SLIDE_RE)[1]));
  if (slideNames.length === 0) throw new Error('pptx 里没有幻灯片');

  const pages = slideNames.map((name, index) => {
    const xml = entries.get(name).toString('utf8');
    const text = xmlTextNodes(xml);
    return {
      index: index + 1,
      name,
      text,
      textSet: [...new Set(text)].sort(),
      math: (xml.match(/<m:oMath(?=[\s>])/g) ?? []).length,
    };
  });
  return { pageCount: pages.length, pages, math: pages.reduce((sum, page) => sum + page.math, 0) };
}

// ── 比对 ────────────────────────────────────────────────────────────────────

const LEVEL = { identical: 0, equivalent: 1, divergent: 2, broken: 3 };

export function worst(levels) {
  return levels.reduce((acc, level) => (LEVEL[level] > LEVEL[acc] ? level : acc), 'identical');
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameMultiset(left, right) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

/**
 * 场景配对：类型 + 该类型内的出现序号。这样"顺序不同"能配对上，
 * 落成 equivalent 而不是一串假 divergent。
 */
function pairScenes(aScenes, bScenes) {
  const keyed = (scenes) => {
    const seen = new Map();
    return scenes.map((scene, index) => {
      const type = scene?.type ?? scene?.content?.type ?? 'unknown';
      const ordinal = seen.get(type) ?? 0;
      seen.set(type, ordinal + 1);
      return { scene, index, type, key: `${type}#${ordinal}` };
    });
  };
  const left = keyed(aScenes);
  const right = new Map(keyed(bScenes).map((entry) => [entry.key, entry]));
  const pairs = [];
  const missing = [];
  const extra = [];
  for (const entry of left) {
    const match = right.get(entry.key);
    if (match) { pairs.push({ a: entry, b: match }); right.delete(entry.key); }
    else missing.push(entry);
  }
  for (const entry of right.values()) extra.push(entry);
  return { pairs, missing, extra };
}

function typesOf(scenes) {
  return (scenes ?? []).map((scene) => scene?.type ?? scene?.content?.type ?? 'unknown');
}

export function compareScenes(aScenes, bScenes) {
  const a = typesOf(aScenes);
  const b = typesOf(bScenes);
  if (sameList(a, b)) return { status: 'identical', a, b, differences: [] };
  const differences = [];
  if (a.length !== b.length) {
    differences.push({ kind: 'count', a: a.length, b: b.length });
  }
  const limit = Math.max(a.length, b.length);
  for (let index = 0; index < limit; index++) {
    if (a[index] !== b[index]) {
      differences.push({ kind: 'sequence', index, a: a[index] ?? null, b: b[index] ?? null });
      break;
    }
  }
  return {
    status: sameMultiset(a, b) ? 'equivalent' : 'divergent',
    a,
    b,
    differences,
  };
}

/**
 * 文本分级的唯一依据：
 *   identical  —— 行序列（已压空白）逐行相等；
 *   equivalent —— 行序列不等，但**去掉空白后整段相等**（换行/段落边界的差异），
 *                 或只是行的先后不同（整行多重集相等）；
 *   divergent  —— 其余（缺字、改字、缺行、缺场景）。
 */
function gradeLines(aLines, bLines) {
  if (sameList(aLines, bLines)) return 'identical';
  const loose = (lines) => lines.map((line) => normalizeText(line, { loose: true })).join('');
  if (loose(aLines) === loose(bLines)) return 'equivalent';
  const looseSorted = (lines) => lines.map((line) => normalizeText(line, { loose: true })).sort();
  if (sameList(looseSorted(aLines), looseSorted(bLines))) return 'equivalent';
  return 'divergent';
}

function firstLineDifference(aLines, bLines) {
  const limit = Math.max(aLines.length, bLines.length);
  for (let index = 0; index < limit; index++) {
    if (aLines[index] !== bLines[index]) {
      const context = (lines) => lines.slice(Math.max(0, index - 1), index + 2).join(' / ');
      return {
        line: index + 1,
        a: aLines[index] ?? null,
        b: bLines[index] ?? null,
        contextA: truncate(context(aLines)),
        contextB: truncate(context(bLines)),
      };
    }
  }
  return null;
}

function truncate(text, max = 160) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function compareText(aScenes, bScenes) {
  const { pairs, missing, extra } = pairScenes(aScenes, bScenes);
  const scenes = [];
  const differences = [];
  let status = 'identical';

  for (const { a, b } of pairs) {
    const aStrict = sceneTextLines(a.scene);
    const bStrict = sceneTextLines(b.scene);
    const sceneStatus = gradeLines(aStrict, bStrict);
    const entry = { index: a.index, type: a.type, status: sceneStatus, lines: aStrict.length };
    if (sceneStatus !== 'identical') {
      entry.firstDifference = firstLineDifference(aStrict, bStrict);
      entry.orderOnly = sceneStatus === 'equivalent';
      differences.push(entry);
    }
    scenes.push(entry);
    status = worst([status, sceneStatus]);
  }

  for (const entry of missing) {
    scenes.push({ index: entry.index, type: entry.type, status: 'divergent', missingIn: 'b' });
    differences.push({ kind: 'missing-scene', index: entry.index, type: entry.type, missingIn: 'b' });
    status = worst([status, 'divergent']);
  }
  for (const entry of extra) {
    scenes.push({ index: entry.index, type: entry.type, status: 'divergent', missingIn: 'a' });
    differences.push({ kind: 'extra-scene', index: entry.index, type: entry.type, missingIn: 'a' });
    status = worst([status, 'divergent']);
  }

  return { status, scenes, differences };
}

function pageSignature(page) {
  return `${page.math}|${page.textSet.join('\u0001')}`;
}

export function comparePptx(a, b) {
  if (a.pageCount !== b.pageCount) {
    return {
      status: 'divergent',
      a: { pages: a.pageCount, math: a.math },
      b: { pages: b.pageCount, math: b.math },
      differences: [{ kind: 'page-count', a: a.pageCount, b: b.pageCount }],
    };
  }
  const differences = [];
  let status = 'identical';
  for (let index = 0; index < a.pageCount; index++) {
    const left = a.pages[index];
    const right = b.pages[index];
    if (sameList(left.textSet, right.textSet) && left.math === right.math) continue;
    const sceneStatus = left.math === right.math ? gradeLines(left.text, right.text) : 'divergent';
    differences.push({
      kind: 'page',
      page: index + 1,
      status: sceneStatus,
      math: [left.math, right.math],
      firstDifference: firstLineDifference(left.textSet, right.textSet),
    });
    status = worst([status, sceneStatus]);
  }
  if (status === 'identical' && !sameList(a.pages.map(pageSignature), b.pages.map(pageSignature))) {
    status = 'equivalent';
    differences.push({ kind: 'page-order' });
  }
  if (status === 'divergent' && sameMultiset(a.pages.map(pageSignature), b.pages.map(pageSignature))) {
    status = 'equivalent';
    for (const difference of differences) if (difference.status === 'divergent') difference.status = 'equivalent';
  }
  return {
    status,
    a: { pages: a.pageCount, math: a.math },
    b: { pages: b.pageCount, math: b.math },
    differences,
  };
}

/** 两份目录的整体比对。任何一侧读不开 → 该维度 broken。 */
export async function compareDirectories(dirA, dirB) {
  const report = {
    status: 'identical',
    a: path.resolve(dirA),
    b: path.resolve(dirB),
    checkedAt: new Date().toISOString(),
    dimensions: {},
  };

  let left = null;
  let right = null;
  try { left = await readArtifacts(dirA); } catch (error) {
    report.dimensions.read = { status: 'broken', error: `A: ${error.message}` };
    report.status = 'broken';
    return report;
  }
  try { right = await readArtifacts(dirB); } catch (error) {
    report.dimensions.read = { status: 'broken', error: `B: ${error.message}` };
    report.status = 'broken';
    return report;
  }

  if (left.scenes && right.scenes) {
    report.dimensions.scenes = {
      ...compareScenes(left.scenes, right.scenes),
      source: [left.scenesSource, right.scenesSource],
    };
  } else if (!left.scenes && !right.scenes) {
    report.dimensions.scenes = { status: 'skipped', reason: '两侧都没有场景来源（html 清单/课堂文档）' };
  } else {
    report.dimensions.scenes = {
      status: 'divergent',
      differences: [{ kind: 'missing-artifact', missingIn: left.scenes ? 'b' : 'a' }],
    };
  }

  if (left.scenes && right.scenes) {
    report.dimensions.text = compareText(left.scenes, right.scenes);
  } else {
    report.dimensions.text = { status: 'skipped', reason: '缺场景来源，无法逐场景比文本' };
  }

  const pptxErrors = [];
  if (left.pptxError) pptxErrors.push(`A: ${left.pptxError}`);
  if (right.pptxError) pptxErrors.push(`B: ${right.pptxError}`);
  if (pptxErrors.length > 0) {
    report.dimensions.pptx = { status: 'broken', error: pptxErrors.join('；') };
  } else if (left.pptx && right.pptx) {
    report.dimensions.pptx = comparePptx(left.pptx, right.pptx);
  } else if (!left.pptx && !right.pptx) {
    report.dimensions.pptx = { status: 'skipped', reason: '两侧都没有 pptx' };
  } else {
    report.dimensions.pptx = {
      status: 'divergent',
      differences: [{ kind: 'missing-artifact', missingIn: left.pptx ? 'b' : 'a' }],
    };
  }

  report.status = worst(
    Object.values(report.dimensions).filter((dim) => dim.status !== 'skipped').map((dim) => dim.status),
  );
  return report;
}

// ── 呈现 ────────────────────────────────────────────────────────────────────

const LABEL = {
  identical: 'identical',
  equivalent: 'equivalent',
  divergent: 'divergent',
  broken: 'broken',
  skipped: 'skipped',
};

function sceneLine(dimension, name) {
  const status = LABEL[dimension.status];
  if (dimension.status === 'skipped') return `${name.padEnd(7)} ${status.padEnd(10)} ${dimension.reason}`;
  if (name === 'scenes') {
    const left = (dimension.a ?? []).join('→') || '—';
    const right = (dimension.b ?? []).join('→') || '—';
    if (dimension.status === 'identical') return `${name.padEnd(7)} ${status.padEnd(10)} ${left}  ${left.split('→').length} 个场景`;
    const head = `${left}  ≠  ${right}`;
    const first = dimension.differences?.find((entry) => entry.kind === 'sequence')
      ?? dimension.differences?.[0];
    const tail = first && first.kind === 'sequence'
      ? `首个差异 @场景${first.index + 1}: ${first.a ?? '<缺>'}/${first.b ?? '<缺>'}`
      : first?.kind === 'count' ? `数量 ${first.a} vs ${first.b}` : '';
    return `${name.padEnd(7)} ${status.padEnd(10)} ${head}${tail ? `  ${tail}` : ''}`;
  }
  if (name === 'text') {
    const total = dimension.scenes?.length ?? 0;
    const bad = (dimension.scenes ?? []).filter((scene) => scene.status !== 'identical');
    const tail = bad.length === 0
      ? `${total} 个场景文本一致`
      : bad.slice(0, 3).map((scene) => {
        if (scene.missingIn) return `@场景${scene.index + 1}(${scene.type}) 在 ${scene.missingIn} 侧缺失`;
        const diff = scene.firstDifference;
        return `@场景${scene.index + 1}(${scene.type}) 第${diff?.line ?? '?'}行 A=${truncate(diff?.a, 48) || '<空>'} B=${truncate(diff?.b, 48) || '<空>'}`;
      }).join('；') + (bad.length > 3 ? `（另有 ${bad.length - 3} 处）` : '');
    return `${name.padEnd(7)} ${status.padEnd(10)} ${tail}`;
  }
  if (name === 'pptx') {
    if (dimension.status === 'broken') return `${name.padEnd(7)} ${status.padEnd(10)} ${dimension.error}`;
    const form = (side) => side ? `${side.pages}页/${side.math}公式` : '—';
    if (dimension.status === 'identical') {
      return `${name.padEnd(7)} ${status.padEnd(10)} ${dimension.a.pages} 页 / ${dimension.a.math} 个公式 / 每页文本一致`;
    }
    const first = dimension.differences?.[0];
    const tail = first
      ? first.kind === 'page-count' ? `页数 ${first.a} vs ${first.b}`
        : first.kind === 'page' ? `@第${first.page}页 ${first.status === 'equivalent' ? '空白/顺序差' : `A=${truncate(first.firstDifference?.a, 40) || '<空>'} B=${truncate(first.firstDifference?.b, 40) || '<空>'}`}`
          : '页顺序不同'
      : '页数、每页文本、公式数一致';
    return `${name.padEnd(7)} ${status.padEnd(10)} ${form(dimension.a)} vs ${form(dimension.b)}  ${tail}`;
  }
  return `${name.padEnd(7)} ${status.padEnd(10)} ${dimension.error ?? dimension.reason ?? ''}`;
}

export function formatReport(report) {
  const lines = [];
  lines.push(`A: ${report.a}`);
  lines.push(`B: ${report.b}`);
  lines.push('');
  for (const name of ['read', 'scenes', 'text', 'pptx']) {
    const dimension = report.dimensions[name];
    if (dimension) lines.push(sceneLine(dimension, name));
  }
  lines.push('');
  lines.push(`结论: ${report.status}`);
  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const options = { a: null, b: null, json: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--a' || arg === '--b') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 需要一个目录参数`);
      options[arg.slice(2)] = value;
      index++;
    } else throw new Error(`未知参数 ${arg}`);
  }
  return options;
}

const USAGE = '用法: node scripts/classroom-parity.mjs --a <dirA> --b <dirB> [--json]\n'
  + '  退出码 0 = identical/equivalent，1 = divergent/broken，2 = 用法错误\n';

export async function main(argv = process.argv.slice(2), io = process) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`classroom-parity: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (options.help) { io.stdout.write(USAGE); return 0; }
  if (!options.a || !options.b) {
    io.stderr.write(`classroom-parity: 需要 --a 与 --b\n${USAGE}`);
    return 2;
  }

  let report;
  try {
    report = await compareDirectories(options.a, options.b);
  } catch (error) {
    report = {
      status: 'broken',
      a: path.resolve(options.a),
      b: path.resolve(options.b),
      checkedAt: new Date().toISOString(),
      dimensions: { read: { status: 'broken', error: error.message } },
    };
  }

  if (options.json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else io.stdout.write(`${formatReport(report)}\n`);

  return report.status === 'identical' || report.status === 'equivalent' ? 0 : 1;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`classroom-parity: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
