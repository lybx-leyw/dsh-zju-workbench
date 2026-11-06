#!/usr/bin/env node
/**
 * 课堂「渲染层 + 导出层」真凭据：三件事一次跑完，任何一件不成立就红。
 *
 *   node scripts/classroom-render-parity.mjs [--doc <path>] [--reference <path>] [--json]
 *
 * 三件事（维度）与判据：
 *
 *   1. render  同一份课堂文档里的每张幻灯片，用**上游 OpenMAIC renderer**
 *              (`ref/OpenMAIC/packages/@openmaic/renderer/dist`) 与**我们 vendor 的
 *              renderer** (`packages/dsh-zhiyun-classroom-renderer/vendor/renderer`)
 *              分别 `renderToStaticMarkup`，抽出的文本**多重集**必须相等。
 *              实现差异（缺字、多字）→ divergent；仅顺序/空白不同 → equivalent。
 *
 *   2. html    `ctx.zhiyunClassroomExport.html(doc)` 的产物里，每个场景的标题与正文
 *              都要在（文案取自 `--reference`，默认就是同一份 fixture）。场景按
 *              「类型 + 序号」配对，缺场景 / 缺行 → divergent。产物的文本来源是
 *              **静态 DOM 文本 ∪ 内嵌清单 payload**（这份 HTML 是播放器壳：正文装在
 *              `<script id="openmaic-classroom">` 的 JSON 里，静态 DOM 只有 noscript
 *              提示 —— 详见 docs/architecture/render-parity.md）。
 *
 *   3. pptx    `pptx(doc)` 的 zip：页数 = 可导出场景数（slide + quiz + pbl +
 *              带 html 的 interactive），每页 `<a:t>` 文本必须覆盖该场景在文档里的
 *              可见文本，`<m:oMath>` 数 = 该页 LaTeX 元素数。
 *
 * 退出码：0 = identical|equivalent，1 = divergent|broken，2 = 用法错误。
 *
 * # 为什么需要 --reference
 *
 * 维度 1 是「两套实现比」，天然自洽；维度 2/3 是「产物比文档」。如果只有一个输入，
 * 删掉一个场景后产物也跟着少一页，自比永远 identical —— 那样就测不出回归。所以
 * 产物一律拿 `--doc` 生成、拿 `--reference` 判分；缺省两者是同一份 fixture。
 *
 * # 双渲染怎么做到「同一个 React 实例」
 *
 * 上游 dist 内部 `import 'react'` 会解析到 `ref/OpenMAIC/node_modules/.pnpm/react@19.2.3`
 * （React 19），而我们 vendor 解析到仓库根的 React 18.3.1。两个实例会出现
 * `Cannot read properties of null (reading 'useContext')`。本脚本在 import 任何
 * react-dom 之前用 `module.register()` 挂一个 data: URL 的 ESM loader，把
 * react / react/jsx-runtime / react/jsx-dev-runtime / react-dom / react-dom/server
 * 全部 alias 到仓库根那一份 —— **不改上游 node_modules**，也不落任何临时文件。
 * 具体路径与判定写在报告的 `environment` 里。
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire, register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  htmlToTextLines,
  normalizeText,
  readPptxStructure,
  worst,
} from './classroom-golden-parity.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const PATHS = {
  upstreamRenderer: path.join(ROOT, 'ref/OpenMAIC/packages/@openmaic/renderer/dist/index.js'),
  vendorRenderer: path.join(ROOT, 'packages/dsh-zhiyun-classroom-renderer/vendor/renderer/index.js'),
  exporter: path.join(ROOT, 'packages/dsh-zhiyun-core-classroom-export/src/index.js'),
  fixture: path.join(ROOT, 'fixtures/classroom-render-parity/classroom.json'),
};

const MANIFEST_RE = /<script[^>]*\bid=["']openmaic-classroom["'][^>]*>([\s\S]*?)<\/script>/i;
const SLIDE_TYPES = new Set(['slide']);

// ── 小工具 ──────────────────────────────────────────────────────────────────

const rel = (target) => path.relative(ROOT, target).split(path.sep).join('/');

function truncate(value, max = 160) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const typeOf = (scene) => scene?.type ?? scene?.content?.type ?? 'unknown';

function orderScenes(scenes) {
  return (scenes ?? [])
    .map((scene, index) => ({ scene, index }))
    .sort((left, right) => (left.scene?.order ?? 0) - (right.scene?.order ?? 0) || left.index - right.index)
    .map((entry) => entry.scene);
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedCopy(list) {
  return [...list].sort();
}

function sameMultiset(left, right) {
  return sameList(sortedCopy(left), sortedCopy(right));
}

/** 行级首个差异（含前后文），供报告用。 */
function firstLineDifference(left, right) {
  const limit = Math.max(left.length, right.length);
  for (let index = 0; index < limit; index++) {
    if (left[index] === right[index]) continue;
    const context = (lines) => truncate(lines.slice(Math.max(0, index - 1), index + 2).join(' / '));
    return {
      line: index + 1,
      a: left[index] ?? null,
      b: right[index] ?? null,
      contextA: context(left),
      contextB: context(right),
    };
  }
  return null;
}

/** 行序列分级：identical / equivalent（仅顺序或空白不同）/ divergent。 */
function gradeLines(left, right) {
  if (sameList(left, right)) return 'identical';
  if (sameMultiset(left, right)) return 'equivalent';
  const loose = (lines) => lines.map((line) => normalizeText(line, { loose: true })).join('');
  if (loose(left) === loose(right)) return 'equivalent';
  const looseSorted = (lines) => lines.map((line) => normalizeText(line, { loose: true })).sort();
  if (sameList(looseSorted(left), looseSorted(right))) return 'equivalent';
  return 'divergent';
}

/** 多重集差：left 缺哪些、right 多哪些（稳定、可读）。 */
function multisetDiff(left, right) {
  const pool = new Map();
  for (const line of right) pool.set(line, (pool.get(line) ?? 0) + 1);
  const missing = [];
  for (const line of left) {
    const count = pool.get(line) ?? 0;
    if (count > 0) pool.set(line, count - 1);
    else missing.push(line);
  }
  const extra = [];
  for (const [line, count] of pool) for (let index = 0; index < count; index++) extra.push(line);
  return { missing, extra };
}

/** 场景配对：类型 + 该类型内的出现序号（顺序变动落成 equivalent，而不是一堆假 divergent）。 */
function pairScenes(expected, actual) {
  const keyed = (scenes) => {
    const seen = new Map();
    return scenes.map((scene, index) => {
      const type = typeOf(scene);
      const ordinal = seen.get(type) ?? 0;
      seen.set(type, ordinal + 1);
      return { scene, index, type, key: `${type}#${ordinal}` };
    });
  };
  const left = keyed(expected);
  const right = new Map(keyed(actual).map((entry) => [entry.key, entry]));
  const pairs = [];
  const missing = [];
  const extra = [];
  for (const entry of left) {
    const match = right.get(entry.key);
    if (match) {
      pairs.push({ expected: entry, actual: match });
      right.delete(entry.key);
    } else missing.push(entry);
  }
  for (const entry of right.values()) extra.push(entry);
  return { pairs, missing, extra };
}

// ── 场景可见文本（判分口径，与 classroom-golden-parity 的 sceneTextLines 同源）──

function pushLines(target, value) {
  for (const line of htmlToTextLines(value)) target.push(line);
}

function linesFromElements(elements, out, { math, charts = true } = {}) {
  for (const element of elements ?? []) {
    if (!element || typeof element !== 'object') continue;
    switch (element.type) {
      case 'text':
        pushLines(out, element.content ?? element.text ?? '');
        break;
      case 'latex':
        // LaTeX 在 PPTX 里变成 OMML（OMML 的文本不是 <a:t>），所以只计数、不比对字面量。
        if (math) math.latex += 1;
        break;
      case 'chart': {
        // PPTX 把图表栅格化成图片（chartImages），标签跟着像素走，不再是文本节点。
        if (!charts) break;
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
        linesFromElements(element.elements ?? element.children, out, { math, charts });
        break;
      default:
        break;
    }
  }
  return out;
}

function quizLines(content) {
  const out = [];
  for (const question of content.questions ?? []) {
    pushLines(out, question.question ?? question.title ?? '');
    for (const option of question.options ?? []) pushLines(out, option.label ?? option.text ?? option.value ?? '');
  }
  return out;
}

function pblLines(content) {
  const project = content.projectV2 ?? content.project ?? content;
  const out = [];
  pushLines(out, project.title ?? '');
  pushLines(out, project.learningObjective ?? '');
  const scenario = project.scenario ?? {};
  pushLines(out, scenario.goal ?? '');
  for (const milestone of project.milestones ?? []) pushLines(out, milestone.title ?? '');
  return out;
}

/** 场景 → 该场景应出现在产物里的文本行（标题在前）。 */
function sceneLines(scene) {
  const out = [];
  pushLines(out, scene?.title ?? '');
  const content = scene?.content ?? {};
  switch (typeOf(scene)) {
    case 'slide':
      linesFromElements(content.canvas?.elements ?? content.elements, out);
      break;
    case 'quiz':
      out.push(...quizLines(content));
      break;
    case 'interactive':
      pushLines(out, content.html ?? '');
      break;
    case 'pbl':
      out.push(...pblLines(content));
      break;
    default:
      break;
  }
  return out.filter(Boolean);
}

/** 幻灯片画布 → 文本行 + LaTeX 数（PPTX 页判据：图表是图片，标签不在这里）。 */
function canvasLines(canvas) {
  const math = { latex: 0 };
  const out = linesFromElements(canvas?.elements ?? [], [], { math, charts: false });
  return { lines: out.filter(Boolean), latex: math.latex };
}

// ── 环境：把 React 收敛到同一实例 ───────────────────────────────────────────

let reactEnvironment = null;

/**
 * 判断上游 renderer 与仓库根是否用同一份 React；不同则挂 ESM loader alias。
 * 必须在任何 `import('react-dom/server')` **之前**调用。
 */
function alignReact(upstreamEntry) {
  if (reactEnvironment) return reactEnvironment;

  const ourRequire = createRequire(path.join(ROOT, 'package.json'));
  const ours = ourRequire.resolve('react');
  const rootModules = path.dirname(path.dirname(ours));

  let upstream = null;
  try {
    upstream = createRequire(upstreamEntry).resolve('react');
  } catch {
    upstream = null;
  }

  const candidates = {
    react: path.join(rootModules, 'react/index.js'),
    'react/jsx-runtime': path.join(rootModules, 'react/jsx-runtime.js'),
    'react/jsx-dev-runtime': path.join(rootModules, 'react/jsx-dev-runtime.js'),
    'react-dom': path.join(rootModules, 'react-dom/index.js'),
    'react-dom/server': path.join(rootModules, 'react-dom/server.node.js'),
    'react-dom/server.node': path.join(rootModules, 'react-dom/server.node.js'),
    'react-dom/client': path.join(rootModules, 'react-dom/client.js'),
  };
  const map = Object.fromEntries(
    Object.entries(candidates).filter(([, file]) => existsSync(file)),
  );

  const aliased = upstream !== null && path.resolve(upstream) !== path.resolve(ours);
  if (aliased) {
    const source = `const MAP = ${JSON.stringify(map)};
export async function resolve(specifier, context, next) {
  const target = MAP[specifier];
  if (target) return { url: 'file://' + target, shortCircuit: true, format: 'commonjs' };
  return next(specifier, context);
}
`;
    register(`data:text/javascript,${encodeURIComponent(source)}`);
  }

  reactEnvironment = {
    ours: rel(ours),
    upstream: upstream ? rel(upstream) : null,
    aliased,
    loader: aliased ? 'module.register(data:text/javascript) → 仓库根 react' : 'no-op（同一实例）',
    aliases: Object.fromEntries(Object.entries(map).map(([name, file]) => [name, rel(file)])),
    // 内部用的绝对路径（不进口报告）。
    files: {
      react: candidates.react,
      reactDom: candidates['react-dom/server'],
    },
  };
  return reactEnvironment;
}

/** 挂好 loader 之后再 import 全套渲染栈。 */
let renderStack = null;

async function loadRenderStack() {
  if (renderStack) return renderStack;
  const environment = alignReact(PATHS.upstreamRenderer);

  const React = (await import(pathToFileURL(environment.files.react).href)).default;
  const { renderToStaticMarkup } = await import(pathToFileURL(environment.files.reactDom).href);
  const upstream = await import(pathToFileURL(PATHS.upstreamRenderer).href);
  const vendor = await import(pathToFileURL(PATHS.vendorRenderer).href);

  if (!upstream.SlideCanvas || !vendor.SlideCanvas) {
    throw new Error('renderer 入口没有导出 SlideCanvas');
  }

  renderStack = { React, renderToStaticMarkup, upstream, vendor, environment };
  reactEnvironment = {
    ours: environment.ours,
    upstream: environment.upstream,
    aliased: environment.aliased,
    loader: environment.loader,
    aliases: environment.aliases,
    reactVersion: React.version,
    files: environment.files,
  };
  return renderStack;
}

/** 渲染一个元素；React 的 SSR 警告（useLayoutEffect 之类）只计数，不当失败。 */
function renderMarkup(renderToStaticMarkup, element) {
  const warnings = [];
  const originalError = console.error;
  console.error = (...args) => { warnings.push(String(args[0] ?? '')); };
  try {
    return { html: renderToStaticMarkup(element), warnings: warnings.length };
  } finally {
    console.error = originalError;
  }
}

// ── 维度 1：双渲染 ──────────────────────────────────────────────────────────

async function compareRender(doc) {
  const stack = await loadRenderStack();
  const { React, renderToStaticMarkup, upstream, vendor } = stack;

  const slides = orderScenes(doc.scenes)
    .map((scene, index) => ({ scene, index }))
    .filter((entry) => SLIDE_TYPES.has(typeOf(entry.scene)));

  if (slides.length === 0) {
    return { status: 'skipped', reason: '文档里没有 slide 场景（上游 renderer 只渲染幻灯片）' };
  }

  const scenes = [];
  const differences = [];
  let status = 'identical';
  let textNodes = 0;
  let markupBytes = { upstream: 0, vendor: 0 };
  let warnings = 0;

  for (const entry of slides) {
    const slide = entry.scene.content?.canvas;
    if (!slide || typeof slide !== 'object') {
      return {
        status: 'broken',
        error: `第 ${entry.index + 1} 个场景（${entry.scene.title ?? '未命名'}）没有 content.canvas`,
        scenes,
      };
    }

    let left;
    let right;
    try {
      left = renderMarkup(renderToStaticMarkup, React.createElement(upstream.SlideCanvas, { slide }));
    } catch (error) {
      return { status: 'broken', error: `上游 renderer 渲染失败 @场景${entry.index + 1}：${error.message}`, scenes };
    }
    try {
      right = renderMarkup(renderToStaticMarkup, React.createElement(vendor.SlideCanvas, { slide }));
    } catch (error) {
      return { status: 'broken', error: `vendor renderer 渲染失败 @场景${entry.index + 1}：${error.message}`, scenes };
    }

    warnings += left.warnings + right.warnings;
    markupBytes = {
      upstream: markupBytes.upstream + Buffer.byteLength(left.html),
      vendor: markupBytes.vendor + Buffer.byteLength(right.html),
    };

    const aLines = htmlToTextLines(left.html);
    const bLines = htmlToTextLines(right.html);
    const sceneStatus = gradeLines(aLines, bLines);
    const record = {
      index: entry.index,
      type: 'slide',
      title: entry.scene.title ?? null,
      status: sceneStatus,
      textNodes: aLines.length,
      markupIdentical: left.html === right.html,
      markupBytes: [Buffer.byteLength(left.html), Buffer.byteLength(right.html)],
    };
    if (sceneStatus !== 'identical') {
      record.firstDifference = firstLineDifference(aLines, bLines);
      record.multiset = multisetDiff(aLines, bLines);
      differences.push(record);
    }
    textNodes += aLines.length;
    scenes.push(record);
    status = worst([status, sceneStatus]);
  }

  return { status, scenes, differences, textNodes, markupBytes, warnings };
}

// ── 维度 2：HTML 导出 ───────────────────────────────────────────────────────

let exportService = null;

async function loadExportService() {
  if (exportService) return exportService;
  const plugin = await import(pathToFileURL(PATHS.exporter).href);
  const provided = new Map();
  const silent = { debug() {}, info() {}, warn() {}, error() {} };
  plugin.apply({
    logger: silent,
    provide(name, value) {
      provided.set(name, value);
      return () => provided.delete(name);
    },
    get(name) {
      return provided.get(name);
    },
    on() {},
  }, { logger: silent });
  const service = provided.get('zhiyunClassroomExport');
  if (!service || typeof service.html !== 'function') throw new Error('导出服务没有注册（html 缺失）');
  exportService = service;
  return service;
}

/** 递归收集 payload 里的全部字符串（清单 JSON 的可见文本面）。 */
function collectStrings(value, out = [], depth = 0) {
  if (depth > 12 || value == null) return out;
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, depth + 1);
    return out;
  }
  if (typeof value === 'object') {
    for (const child of Object.values(value)) collectStrings(child, out, depth + 1);
  }
  return out;
}

const looseOf = (value) => normalizeText(value, { loose: true });

/** 期望行是否出现在产物里（整行命中优先，其次退到去空白的子串）。 */
function containsLine(artifact, line) {
  if (artifact.lineSet.has(line)) return true;
  return artifact.loose.includes(looseOf(line));
}

async function compareHtml(doc, reference) {
  const service = await loadExportService();
  let html;
  try {
    html = await service.html(doc, { lang: doc.stage?.language });
  } catch (error) {
    return { status: 'broken', error: `html() 失败：${error.message}` };
  }
  if (typeof html !== 'string' || !/^<!doctype/i.test(html.slice(0, 16))) {
    return { status: 'broken', error: 'html() 没有返回完整文档（缺 <!doctype）' };
  }

  const match = html.match(MANIFEST_RE);
  if (!match) return { status: 'broken', error: '产物里没有 <script id="openmaic-classroom"> 清单' };
  let manifest;
  try {
    manifest = JSON.parse(match[1]);
  } catch (error) {
    return { status: 'broken', error: `清单 JSON 解析失败：${error.message}` };
  }
  if (!Array.isArray(manifest.scenes)) return { status: 'broken', error: '清单里没有 scenes 数组' };

  const staticLines = htmlToTextLines(html);
  const payloadLines = collectStrings(manifest);
  const artifact = {
    lineSet: new Set([...staticLines, ...payloadLines.flatMap((text) => htmlToTextLines(text))]),
    loose: looseOf([...staticLines, ...payloadLines].join('\n')),
  };

  const expectedScenes = orderScenes(reference.scenes);
  const actualScenes = manifest.scenes;
  const { pairs, missing, extra } = pairScenes(expectedScenes, actualScenes);
  const orderShifted = pairs.some(({ expected, actual }) => expected.index !== actual.index);

  const scenes = [];
  const differences = [];
  let status = 'identical';
  let covered = 0;
  let expectedTotal = 0;

  for (const { expected, actual } of pairs) {
    const expectedLines = sceneLines(expected.scene);
    const actualLines = sceneLines(actual.scene);
    expectedTotal += expectedLines.length;
    covered += expectedLines.filter((line) => containsLine(artifact, line)).length;

    let sceneStatus = gradeLines(expectedLines, actualLines);
    const { missing: absent, extra: surplus } = multisetDiff(expectedLines, actualLines);
    const unclaimed = expectedLines.filter((line) => !containsLine(artifact, line));
    if (unclaimed.length > 0) sceneStatus = 'divergent';

    const record = {
      index: expected.index,
      type: expected.type,
      title: expected.scene.title ?? null,
      status: sceneStatus,
      lines: expectedLines.length,
      matched: expectedLines.length - unclaimed.length,
    };
    if (sceneStatus !== 'identical') {
      record.firstDifference = firstLineDifference(expectedLines, actualLines);
      record.missingLines = absent.slice(0, 5);
      record.extraLines = surplus.slice(0, 5);
      record.unclaimed = unclaimed.slice(0, 5);
      differences.push(record);
    }
    scenes.push(record);
    status = worst([status, sceneStatus]);
  }

  for (const entry of missing) {
    const record = { index: entry.index, type: entry.type, title: entry.scene.title ?? null, status: 'divergent', missingIn: 'artifact' };
    scenes.push(record);
    differences.push({ kind: 'missing-scene', ...record });
    status = 'divergent';
    expectedTotal += sceneLines(entry.scene).length;
  }
  for (const entry of extra) {
    const record = { index: entry.index, type: entry.type, title: entry.scene.title ?? null, status: 'divergent', missingIn: 'reference' };
    scenes.push(record);
    differences.push({ kind: 'extra-scene', ...record });
    status = 'divergent';
  }

  // 场景齐全但位置变了：等价，不是回归。
  if (status === 'identical' && orderShifted) {
    status = 'equivalent';
    differences.push({ kind: 'scene-order' });
  }

  return {
    status,
    bytes: Buffer.byteLength(html),
    scenes,
    differences,
    staticTextNodes: staticLines.length,
    payloadStrings: payloadLines.length,
    expectedLines: expectedTotal,
    coveredLines: covered,
    manifest: { scenes: actualScenes.length, formatVersion: manifest.formatVersion ?? null },
  };
}

// ── 维度 3：PPTX 结构 ───────────────────────────────────────────────────────

/** 该场景会不会进 PPTX（与 pptx/placeholders.js 的 pptxDeckScenes 同一条规则）。 */
function exportable(scene) {
  const type = typeOf(scene);
  if (type === 'slide' || type === 'quiz' || type === 'pbl') return true;
  if (type === 'interactive') return Boolean(scene.content?.html);
  return false;
}

/** 场景 → PPTX 该页必须覆盖的文本（LaTeX 走 OMML，单独计数）。 */
function pptxExpectedLines(scene) {
  const type = typeOf(scene);
  if (type === 'slide') {
    const { lines, latex } = canvasLines(scene.content?.canvas);
    return { lines, latex };
  }
  if (type === 'quiz') {
    // 占位页只放标题 + 题干（选项留在 HTML/在线互动里，见 pptx-scene-placeholders）。
    const stems = (scene.content?.questions ?? [])
      .map((question) => normalizeText(question.question ?? question.title ?? ''))
      .filter(Boolean)
      .slice(0, 4);
    return { lines: [scene.title, ...stems].filter(Boolean), latex: 0 };
  }
  if (type === 'interactive') {
    return { lines: [scene.title].filter(Boolean), latex: 0 };
  }
  if (type === 'pbl') {
    // 占位页：场景标题 + 目标 + 里程碑标题（项目标题只在文档里，deck 用场景标题当页标题）。
    const project = scene.content?.projectV2 ?? scene.content?.project ?? scene.content ?? {};
    const goal = normalizeText(project.learningObjective || project.scenario?.goal || '');
    const milestones = (project.milestones ?? []).map((milestone) => normalizeText(milestone.title ?? ''));
    return { lines: [scene.title, goal, ...milestones].filter(Boolean), latex: 0 };
  }
  return { lines: [], latex: 0 };
}

async function comparePptx(doc, reference) {
  const service = await loadExportService();
  let buffer;
  try {
    buffer = await service.pptx(doc, { lang: doc.stage?.language });
  } catch (error) {
    return { status: 'broken', error: `pptx() 失败：${error.message}` };
  }
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 2).toString('binary') !== 'PK') {
    return { status: 'broken', error: 'pptx() 没有返回 zip 容器' };
  }

  let structure;
  try {
    structure = readPptxStructure(buffer);
  } catch (error) {
    return { status: 'broken', error: `pptx 结构解不开：${error.message}` };
  }

  const expectedScenes = orderScenes(reference.scenes).filter(exportable);
  const pages = structure.pages;

  if (pages.length !== expectedScenes.length) {
    return {
      status: 'divergent',
      bytes: buffer.length,
      pages: pages.length,
      expectedPages: expectedScenes.length,
      math: structure.math,
      textNodes: structure.pages.reduce((sum, page) => sum + page.text.length, 0),
      coveredLines: 0,
      expectedLines: 0,
      differences: [{ kind: 'page-count', pages: pages.length, expected: expectedScenes.length, scenes: reference.scenes.length }],
    };
  }

  const differences = [];
  const pageRecords = [];
  let status = 'identical';
  let textNodes = 0;
  let matched = 0;
  let expectedTotal = 0;

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const scene = expectedScenes[index];
    const { lines: expectedLines, latex } = pptxExpectedLines(scene);
    const pageLoose = looseOf(page.text.join('\n'));
    const pageSet = new Set(page.text);

    const absent = expectedLines.filter((line) => {
      if (pageSet.has(line) || pageLoose.includes(looseOf(line))) return false;
      // 截断（标题/里程碑超宽）落地时只是前缀：前 12 个非空白字符命中就算覆盖。
      const head = looseOf(line).slice(0, 12);
      return !(head.length >= 6 && pageLoose.includes(head));
    });

    let pageStatus = 'identical';
    if (absent.length > 0) {
      // 整页文本都在别的页上：场景顺序变了，是等价而不是回归（公式另做全局核对）。
      const elsewhere = absent.every((line) => pages.some((other) => other !== page
        && looseOf(other.text.join('\n')).includes(looseOf(line))));
      pageStatus = elsewhere ? 'equivalent' : 'divergent';
    } else if (page.math !== latex) pageStatus = 'divergent';

    textNodes += page.text.length;
    expectedTotal += expectedLines.length;
    matched += expectedLines.length - absent.length;

    const record = {
      page: index + 1,
      scene: index,
      type: typeOf(scene),
      title: scene.title ?? null,
      status: pageStatus,
      textNodes: page.text.length,
      expectedLines: expectedLines.length,
      math: [page.math, latex],
    };
    if (pageStatus !== 'identical') {
      record.missingLines = absent.slice(0, 5);
      record.pageText = truncate(page.text.join(' / '));
      differences.push(record);
    }
    pageRecords.push(record);
    status = worst([status, pageStatus]);
  }

  // 换序时逐页配对会错位，所以公式总数单独核对一次：整个 deck 的 OMML 数必须等于
  // 文档里 LaTeX 元素总数，少一个都算丢。
  const expectedMathTotal = expectedScenes.reduce((sum, scene) => sum + pptxExpectedLines(scene).latex, 0);
  if (structure.math !== expectedMathTotal) {
    status = 'divergent';
    differences.push({ kind: 'math-total', math: structure.math, expected: expectedMathTotal });
  }

  return {
    status,
    bytes: buffer.length,
    pages: pages.length,
    expectedPages: expectedScenes.length,
    math: structure.math,
    expectedMath: expectedMathTotal,
    textNodes,
    expectedLines: expectedTotal,
    coveredLines: matched,
    pageRecords,
    differences,
  };
}

// ── 汇总 ────────────────────────────────────────────────────────────────────

function normalizeDoc(doc, label) {
  if (!doc || typeof doc !== 'object') throw new Error(`${label} 不是对象`);
  if (!Array.isArray(doc.scenes)) throw new Error(`${label} 缺少 scenes 数组`);
  if (doc.scenes.length === 0) throw new Error(`${label} 的 scenes 是空的`);
  for (const [index, scene] of doc.scenes.entries()) {
    if (!scene || typeof scene !== 'object') throw new Error(`${label} 的第 ${index + 1} 个场景不是对象`);
    if (!scene.content || typeof scene.content !== 'object') {
      throw new Error(`${label} 的第 ${index + 1} 个场景缺 content`);
    }
  }
  return doc;
}

/**
 * 跑三件事。
 * @param {{docPath?: string, referencePath?: string}} [options]
 */
export async function runParity(options = {}) {
  const docPath = path.resolve(options.docPath ?? PATHS.fixture);
  const referencePath = path.resolve(options.referencePath ?? PATHS.fixture);

  const report = {
    status: 'identical',
    doc: rel(docPath),
    reference: rel(referencePath),
    checkedAt: new Date().toISOString(),
    environment: null,
    dimensions: {},
    numbers: {},
  };

  let doc;
  let reference;
  try {
    doc = normalizeDoc(JSON.parse(await readFile(docPath, 'utf8')), 'doc');
  } catch (error) {
    report.status = 'broken';
    report.dimensions.read = { status: 'broken', error: `doc: ${error.message}` };
    return report;
  }
  try {
    reference = normalizeDoc(JSON.parse(await readFile(referencePath, 'utf8')), 'reference');
  } catch (error) {
    report.status = 'broken';
    report.dimensions.read = { status: 'broken', error: `reference: ${error.message}` };
    return report;
  }

  try {
    await loadRenderStack();
    const { files, ...react } = reactEnvironment;
    void files;
    report.environment = { react };
  } catch (error) {
    report.status = 'broken';
    report.dimensions.environment = { status: 'broken', error: error.message };
  }

  const guard = async (name, run) => {
    try {
      report.dimensions[name] = await run();
    } catch (error) {
      report.dimensions[name] = { status: 'broken', error: `${name}: ${error?.stack ?? error}` };
    }
  };

  if (!report.dimensions.environment) {
    await guard('render', () => compareRender(doc));
    await guard('html', () => compareHtml(doc, reference));
    await guard('pptx', () => comparePptx(doc, reference));
  }

  const graded = Object.values(report.dimensions)
    .filter((dimension) => dimension?.status && dimension.status !== 'skipped')
    .map((dimension) => dimension.status);
  report.status = graded.length === 0 ? 'broken' : worst(graded);

  report.numbers = {
    scenes: orderScenes(doc.scenes).length,
    slideScenes: orderScenes(doc.scenes).filter((scene) => typeOf(scene) === 'slide').length,
    renderTextNodes: report.dimensions.render?.textNodes ?? 0,
    htmlBytes: report.dimensions.html?.bytes ?? 0,
    htmlScenes: report.dimensions.html?.manifest?.scenes ?? 0,
    htmlCoveredLines: report.dimensions.html?.coveredLines ?? 0,
    htmlExpectedLines: report.dimensions.html?.expectedLines ?? 0,
    pptxBytes: report.dimensions.pptx?.bytes ?? 0,
    pages: report.dimensions.pptx?.pages ?? 0,
    pptxTextNodes: report.dimensions.pptx?.textNodes ?? 0,
    omml: report.dimensions.pptx?.math ?? 0,
  };

  return report;
}

// ── 呈现 ────────────────────────────────────────────────────────────────────

function differenceTail(dimension, labels = { a: '上游', b: 'vendor' }) {
  const first = dimension.differences?.[0] ?? dimension.scenes?.find((scene) => scene.status !== 'identical');
  if (!first) return '';
  if (first.kind === 'page-count') return `页数 ${first.pages} 期望 ${first.expected}`;
  if (first.kind === 'missing-scene') return `@场景${first.index + 1}(${first.type}) 产物里缺失`;
  if (first.kind === 'extra-scene') return `@场景${first.index + 1}(${first.type}) 文档里没有`;
  if (first.kind === 'scene-order') return '场景顺序不同（内容齐全）';
  if (first.page) {
    const missing = first.missingLines?.[0];
    return `@第${first.page}页(${first.type}) 缺 ${truncate(missing, 48) || `公式 ${first.math?.join('/')}`}`;
  }
  const diff = first.firstDifference;
  if (!diff) return '';
  return `@场景${first.index + 1}(${first.type}) 第${diff.line}行 ${labels.a}=${truncate(diff.a, 48) || '<空>'} ${labels.b}=${truncate(diff.b, 48) || '<空>'}`;
}

export function formatReport(report) {
  const lines = [];
  lines.push(`doc:       ${report.doc}`);
  lines.push(`reference: ${report.reference}`);
  if (report.environment?.react) {
    const react = report.environment.react;
    lines.push(`react:     ${react.ours}${react.aliased ? `  (alias ← ${react.upstream})` : '  (单实例)'}`);
  }
  lines.push('');

  const render = report.dimensions.render;
  if (render) {
    if (render.status === 'skipped') lines.push(`render  ${render.status.padEnd(10)} ${render.reason}`);
    else if (render.status === 'broken') lines.push(`render  ${render.status.padEnd(10)} ${render.error}`);
    else {
      const identical = render.scenes.filter((scene) => scene.markupIdentical).length;
      const tail = render.status === 'identical'
        ? `${render.scenes.length} 张幻灯片 / ${render.textNodes} 个文本节点 / markup 逐字节相同 ${identical}/${render.scenes.length}`
        : differenceTail(render);
      lines.push(`render  ${render.status.padEnd(10)} ${tail}`);
    }
  }

  const html = report.dimensions.html;
  if (html) {
    if (html.status === 'broken') lines.push(`html    ${html.status.padEnd(10)} ${html.error}`);
    else {
      const tail = html.status === 'identical'
        ? `${html.bytes}B / ${html.manifest.scenes} 个场景 / 覆盖 ${html.coveredLines}/${html.expectedLines} 行（静态 DOM ${html.staticTextNodes} 行 + 清单 ${html.payloadStrings} 串）`
        : `${html.bytes}B / 覆盖 ${html.coveredLines}/${html.expectedLines} 行  ${differenceTail(html, { a: '文档', b: '产物' })}`;
      lines.push(`html    ${html.status.padEnd(10)} ${tail}`);
    }
  }

  const pptx = report.dimensions.pptx;
  if (pptx) {
    if (pptx.status === 'broken') lines.push(`pptx    ${pptx.status.padEnd(10)} ${pptx.error}`);
    else {
      const tail = pptx.status === 'identical'
        ? `${pptx.pages} 页 = ${pptx.expectedPages} 个可导出场景 / ${pptx.textNodes} 个文本节点 / 覆盖 ${pptx.coveredLines}/${pptx.expectedLines} 行 / ${pptx.math} 个 OMML`
        : `${pptx.pages} 页 期望 ${pptx.expectedPages} / ${pptx.textNodes} 节点 / OMML ${pptx.math}  ${
          pptx.status === 'equivalent' ? '页顺序不同（内容齐全）' : differenceTail(pptx, { a: '文档', b: '产物' })
        }`;
      lines.push(`pptx    ${pptx.status.padEnd(10)} ${tail}`);
    }
  }

  lines.push('');
  lines.push(`结论: ${report.status}`);
  return lines.join('\n');
}

// ── CLI ─────────────────────────────────────────────────────────────────────

const USAGE = '用法: node scripts/classroom-render-parity.mjs [--doc <path>] [--reference <path>] [--json]\n'
  + '  默认两者都是 fixtures/classroom-render-parity/classroom.json\n'
  + '  退出码 0 = identical/equivalent，1 = divergent/broken，2 = 用法错误\n';

function parseArgs(argv) {
  const options = { docPath: null, referencePath: null, json: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--doc' || arg === '--reference') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} 需要一个文件路径`);
      if (arg === '--doc') options.docPath = value;
      else options.referencePath = value;
      index++;
    } else throw new Error(`未知参数 ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2), io = process) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`classroom-render-parity: ${error.message}\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    io.stdout.write(USAGE);
    return 0;
  }

  let report;
  try {
    report = await runParity(options);
  } catch (error) {
    report = { status: 'broken', dimensions: { read: { status: 'broken', error: error?.stack ?? String(error) } } };
  }

  if (options.json) io.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else io.stdout.write(`${formatReport(report)}\n`);

  return report.status === 'identical' || report.status === 'equivalent' ? 0 : 1;
}

const invokedDirectly = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }, (error) => {
    process.stderr.write(`classroom-render-parity: ${error?.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
