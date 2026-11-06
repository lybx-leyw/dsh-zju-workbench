/**
 * **架构约束验收**：把"是否符合设计"变成可判定的检查项。
 *
 * # 为什么单独成一个模块
 *
 * 审查报告第 18 条说得最准：现有读数全是**工作量**（多少页、多少块、
 * 多少知识点），不是**正确性**。你要验收的是"内容有没有丢、有没有重复、
 * 讲义是否只由树生成"—— 这些都要拿**不变量**去核，而不是数数量。
 *
 * 这里就是那些不变量。每一条都对应设计图里的一个要求，
 * 并且**允许"无法判定"**（数据不够时如实说 unknown，不假装通过）。
 *
 * # 检查项的三种结果
 *
 *   · `pass`    —— 满足；
 *   · `fail`    —— 违反，**附具体证据**（哪些块、哪个叶）；
 *   · `unknown` —— 数据不足，无法判定（比如没有挂账快照）。
 *
 * 只有 `pass` 才算过。`unknown` 不算通过 —— 那正是"看起来没问题"的伪装。
 */

import { PHASES } from './log-core.mjs';
const META_FACETS = new Set(['教学安排', '作业', '元信息', '通知']);
const isMeta = block => (block.facets ?? []).some(f => META_FACETS.has(f));

/**
 * 跑全部架构检查。
 *
 * @param {object} state   `fold()` 的结果。
 * @returns {{items:Array, passed:number, failed:number, unknown:number, verdict:string}}
 */
export function audit(state) {
  const items = [
    checkMainlineCoverage(state),
    checkNoDuplicateBlocks(state),
    checkAttachHasHost(state),
    checkOversizeLeaves(state),
    checkSameTitleRemoved(state),
    checkLectureUsesTree(state),
    checkContentRetained(state),
    checkPerPageSplit(state),
  ];
  const passed = items.filter((i) => i.status === 'pass').length;
  const failed = items.filter((i) => i.status === 'fail').length;
  const unknown = items.filter((i) => i.status === 'unknown').length;
  return {
    items, passed, failed, unknown,
    verdict: failed ? 'fail' : unknown ? 'unknown' : 'pass',
  };
}

/** ① 主线覆盖：每一块主线内容都必须在某个知识点里（不能凭空消失）。 */
function checkMainlineCoverage(state) {
  const main = [...state.blocks.values()].filter((b) => b.role === '主线' && !isMeta(b));
  if (!main.length) return unknown('主线覆盖', '还没有标记事件');

  /* 按**基础块号**判断覆盖：一片叶被切成两片时，两片记的是 `13#0`/`13#1`，
   * 它们仍属于块 13 —— 块 13 本身是"有归属"的。 */
  const used = new Set();
  for (const point of state.points) {
    for (const id of point.blockIds ?? []) used.add(baseBlockOf(id));
  }
  const missing = main.filter((b) => !used.has(b.index)).map((b) => b.index);
  return missing.length
    ? fail('主线覆盖', `有 ${missing.length} 个主线块没进任何知识点`, `块 ${missing.slice(0, 12).join(', ')}${
      missing.length > 12 ? ' …' : ''}`)
    : pass('主线覆盖', `${main.length} 个主线块全部有归属`);
}

/** ② 不重复：同一块不能出现在两个知识点里（重复收录）。 */
function checkNoDuplicateBlocks(state) {
  if (!state.points.length) return unknown('块不重复', '还没有知识点');
  /* 按**片段身份**判断重复：`13#0` 与 `13#1` 是同一块的两段**不同内容**，
   * 各归一个知识点是正常的（那是切分，不是重复收录）。
   * 只有**同一个片段身份**出现在两个知识点里才算真重复。 */
  const seen = new Map();
  for (const point of state.points) {
    for (const id of point.blockIds ?? []) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  return dup.length
    ? fail('块不重复', `有 ${dup.length} 个块被多个知识点重复收录`, `块 ${dup.slice(0, 12).join(', ')}`)
    : pass('块不重复', `${seen.size} 个块各归一处`);
}

/** ③ 依附有宿主：例题/案例必须挂在某个知识点上，不能单独成点。 */
function checkAttachHasHost(state) {
  const attach = [...state.blocks.values()].filter((b) => !isMeta(b) &&
    (b.facets ?? []).some((f) => f === '例题' || f === '案例'));
  if (!attach.length) return pass('依附有宿主', '本节没有例题/案例块');

  /* 依附块必须有宿主：它所在的知识点里除它之外**还要有别的块**。
   *
   * 注意判据按**基础块号**比：13#0 / 13#1 是同一块的两段。
   * 早先直接用 includes(b.index) 比字符串，永远不命中，于是全部误报。 */
  const orphans = attach.filter((b) => {
    const point = state.points.find((p) => (p.blockIds ?? []).some((id) => baseBlockOf(id) === b.index));
    if (!point) return true;
    const others = (point.blockIds ?? []).filter((id) => baseBlockOf(id) !== b.index);
    return others.length === 0;
  }).map((b) => b.index);

  /* ★ **标注矛盾**要单独报，不能混进"孤儿"里。
   *
   * 无锚点块（`page === null`）被标成例题，是**数据自相矛盾**：
   * 例题按定义依附于课件内容，没有课件就没有"例题"可言。
   * 那类块无论怎么归组都不可能有合法宿主 —— 这不是归组逻辑的错，
   * 是标注的问题。要让人看见，而不是硬凑一个宿主糊过去。
   */
  const contradictory = attach
    .filter((b) => b.page == null && b.role !== '支线')
    .map((b) => b.index);

  if (contradictory.length) {
    return fail('依附有宿主',
      `${contradictory.length} 个例题/案例没有课件对照（page 为空）—— 标注矛盾，不是归组问题`,
      `块 ${contradictory.slice(0, 12).join(', ')}。例题必须依附课件内容；无锚点块不该判为例题`);
  }

  return orphans.length
    ? fail('依附有宿主', `${orphans.length} 个例题/案例没有宿主`, `块 ${orphans.slice(0, 10).join(', ')}`)
    : pass('依附有宿主', `${attach.length} 个依附块都有归属`);
}

/** ④ 超线叶：知识点不该远超斩杀线（说明切分失效）。 */
function checkOversizeLeaves(state) {
  const line = Number.isFinite(state.config?.splitLine) ? state.config.splitLine : null;
  if (line === null) return unknown('斩杀线有效', '日志里没有斩杀线配置');
  if (!state.points.length) return unknown('斩杀线有效', '还没有知识点');

  const over = state.points.filter((p) => (p.tok ?? 0) > line * 1.5);
  return over.length
    ? fail('斩杀线有效', `${over.length} 个知识点超过斩杀线 ${line} 的 1.5 倍`,
      over.slice(0, 8).map((p) => `${p.id}:${p.tok}tok`).join(' '))
    : pass('斩杀线有效', `${state.points.length} 个知识点都在 ${line} 线内`);
}

/** ⑤ 同名消除：审查后不该再有同名标题（如果这一步真的执行了）。 */
function checkSameTitleRemoved(state) {
  const withTitle = state.points
    .map((p) => ({ id: p.id, title: String(p.title ?? '').replace(/\s+/g, ''), blockIds: p.blockIds ?? [] }))
    .filter((p) => p.title);
  if (!withTitle.length) return unknown('同名消除', '知识点没有标题（无法判断）');

  /* ★ 要区分两种"同名"，它们的含义完全不同：
   *
   * ① **同源切片**：同一个块被切成两段，两段都继承了块级标题。
   *    那是正常的 —— 一段长正文分成两次放，名字当然一样。
   *    判据：两个知识点的**基础块号有交集**。
   *
   * ② **真同名**：不同块、不同内容，却叫同一个名字。
   *    那才是审查该消除而没消除的。
   *
   * 早先不分这两种，把①也报成"同名未消除"—— 是误报。
   */
  const byTitle = new Map();
  for (const p of withTitle) {
    if (!byTitle.has(p.title)) byTitle.set(p.title, []);
    byTitle.get(p.title).push(p);
  }

  const sameSource = [];
  const realDup = [];
  for (const [title, group] of byTitle) {
    if (group.length < 2) continue;
    const bases = group.map((p) => new Set((p.blockIds ?? []).map(baseBlockOf)));
    /* 所有成员都共享至少一个基础块 → 同源切片。 */
    const shared = bases.every((set) => [...set].some((b) => bases[0].has(b)));
    if (shared) sameSource.push(title);
    else realDup.push({ title, ids: group.map((p) => p.id) });
  }

  if (realDup.length) {
    return fail('同名消除', `${realDup.length} 个标题**跨不同内容**重复（审查未消除）`,
      realDup.slice(0, 5).map((d) => `${d.title}→${d.ids.join('/')}`).join(' '));
  }
  if (sameSource.length) {
    return pass('同名消除',
      `${sameSource.length} 组同源切片共享标题（同一块切多段，属正常）；无跨内容同名`);
  }
  return pass('同名消除', `${withTitle.length} 个标题互不重复`);
}

/** ⑥ 讲义沿用树：讲义的知识点必须能追到本节的树（不能另建一棵）。 */
function checkLectureUsesTree(state) {
  const topics = state.chapters.flatMap((c) => c.topics ?? []);
  if (!topics.length) return unknown('讲义沿用树', '还没有讲义事件');
  const sources = topics.filter((t) => (t.blockIndexes ?? []).length > 0);
  const without = topics.length - sources.length;
  return without > 0
    ? fail('讲义沿用树', `${without}/${topics.length} 节没有来源块（可能不是从树填充的）`)
    : pass('讲义沿用树', `${topics.length} 节都能追到来源块`);
}

/** ⑦ 内容留存：讲义正文不该比来源块少得离谱（大面积丢失）。 */
function checkContentRetained(state) {
  const topics = state.chapters.flatMap((c) => c.topics ?? []);
  if (!topics.length) return unknown('内容留存', '还没有讲义事件');
  const empty = topics.filter((t) => !t.covered).length;
  return empty > topics.length / 2
    ? fail('内容留存', `${empty}/${topics.length} 节没有正文`, '超过一半是空的')
    : pass('内容留存', `${topics.length - empty}/${topics.length} 节有正文`);
}

/** ⑧ 逐页切分：每页都该有 mix 结果，或者明确标了失败。 */
function checkPerPageSplit(state) {
  if (!state.pages.size) return unknown('逐页处理', '还没有识别事件');
  const noMix = [...state.pages.values()].filter((p) => !p.mix).length;
  return noMix
    ? fail('逐页处理', `${noMix} 页没有混合事件（识别了却没进流水线）`)
    : pass('逐页处理', `${state.pages.size} 页都有混合结果`);
}

/** `"13#2"` → `13`；没有 `#` 就原样返回数字。 */
function baseBlockOf(id) {
  const text = String(id);
  const hash = text.indexOf('#');
  const head = hash >= 0 ? text.slice(0, hash) : text;
  const num = Number(head);
  return Number.isFinite(num) ? num : head;
}

/* ── 结果构造 ─────────────────────────────────────────────────── */

const pass = (name, detail) => ({ name, status: 'pass', detail, evidence: '' });
const fail = (name, detail, evidence = '') => ({ name, status: 'fail', detail, evidence });
const unknown = (name, detail) => ({ name, status: 'unknown', detail, evidence: '' });

/* ── 阶段覆盖：设计图里的要求，哪些真的有事件 ─────────────────── */

/**
 * 设计图要求 vs 基准实际观测到的。
 *
 * 审查第 7 条：基准自己改了一套八段阶段表，却没提供"设计里哪一条实现了"
 * 的对应关系。于是阶段名称看着齐全，但你无法知道哪个要求根本没执行。
 *
 * 这里把设计里的**每一步**列出来，标注它在本次运行里有没有真实事件、
 * 以及基准是否只能"事后推断"。
 */
export function designCoverage(state) {
  const has = (act) => (state.counters[act] ?? 0) > 0;
  return [
    { key: 'vision-mix', name: '识别时 vision ‖ mix 并行', acts: ['vision', 'mix'],
      done: has('vision') && has('mix'), real: true },
    { key: 'orthogonal', name: '正交审查（同名标题合并）', acts: [],
      /* 审查是纯函数，不产生事件；只有 `orthoMerges > 0` 才证明真的合并过。 */
      done: null, real: true,
      note: '基准未发出审查事件；只能从知识点的同名情况反推' },
    { key: 'merge', name: '并发真 merge', acts: ['merge'], done: has('merge'), real: true },
    { key: 'aggregate', name: '分级聚合（收敛到根）', acts: [],
      done: null, real: true,
      note: '聚合在 buildTreeFromBlocks 内部完成，基准未发事件' },
    { key: 'lecture', name: '机械转讲义 + 补理解', acts: ['chapter', 'lecture'],
      done: has('lecture'), real: true },
    { key: 'polish', name: '转格式（无损规整）', acts: ['polish'], done: has('polish'), real: true },
    { key: 'downstream', name: '下游复用', acts: [],
      /* 基准只到讲义为止，下游（导出/复习）不跑。 */
      done: false, real: false, note: '基准不覆盖下游，如实标为未验证' },
  ];
}

export { PHASES };
