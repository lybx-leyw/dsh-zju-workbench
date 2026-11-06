/**
 * **渲染层**：把 `fold()` 出来的状态画成 SVG。
 *
 * # 与之前那套的根本区别
 *
 * 之前是"在演示引擎里塞真实事件"，而演示引擎的内部状态（`tree` / `pageState` /
 * `drafted`）是为它自己的假数据设计的。两边形状对不上，于是出现"树 30 个点、
 * 讲义 29 个、读数 1 个"——**同一份真相有两个持有者**。
 *
 * 现在：状态只有一个来源（`fold`），渲染是**只读**的。画错了就是画错了，
 * 不会反过来污染状态。这是能调试得动的前提。
 *
 * # 布局原则
 *
 *   · 一切按**真实数量**排布：30 块就画 30 个，13 个知识点就画 13 个；
 *   · 不压缩成"示意图形"：块是块、叶是叶、章是章，各自有对应形状；
 *   · 文字优先：这是讲义链路，看得懂字比好看重要。
 */

const NS = 'http://www.w3.org/2000/svg';

/** 造一个 SVG 元素。 */
function el(tag, attrs = {}, text = null) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  if (text !== null) node.textContent = String(text);
  return node;
}

/** 按 facet 上色（与讲义侧同一套语义）。 */
const FACET_COLOR = {
  概念: 'var(--mix)', 公式: 'var(--mix)', 定理: 'var(--mix)', 法则: 'var(--mix)', 思想: 'var(--mix)',
  例题: 'var(--warn)', 案例: 'var(--warn)', 实验: 'var(--warn)', 故事: 'var(--warn)',
  教学安排: 'var(--accent)', 作业: 'var(--accent)', 元信息: 'var(--accent)',
};

/** 截断长文本（SVG 没有真正的溢出省略）。 */
function clip(text, max) {
  const s = String(text ?? '');
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/**
 * 画**整条链路**的一张总览图。
 *
 * 横向 = 阶段（01..08），每一段里按真实数量画小格：
 *   · 01 识别：每页一格（灰=未读、蓝=已读、绿=已混）
 *   · 02 标记：每块一格，颜色按 role/facet
 *   · 03 筛支线 / 04 挂账 / 05 审查：数量条
 *   · 06 重构：每片知识点叶一格
 *   · 07 习坎：章 → 节的缩进列表
 *   · 08 终稿：一行结果
 *
 * @param {SVGElement} svg
 * @param {object} state  `fold()` 的结果
 * @param {object} view   { width, height, phase, splitLine }
 *   `phase` 高亮当前段；`splitLine` 用于**按业务阈值**着色（缺省时不着色）。
 */
export function renderOverview(svg, state, view = {}) {
  const width = view.width ?? 900;
  const height = view.height ?? 420;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const padX = 14, padY = 12;
  const laneW = (width - padX * 2) / 8;
  const top = padY + 18;

  /* ── 阶段标题 ── */
  for (const [i, phase] of PHASES_ORDER.entries()) {
    const x = padX + laneW * i;
    const active = view.phase === phase.key;
    svg.append(el('text', {
      x: x + 3, y: padY + 8, 'font-size': 9, 'font-family': 'var(--mono)',
      'letter-spacing': '0.08em', fill: active ? 'var(--accent)' : 'var(--faint)',
    }, `${phase.no} ${phase.name}`));
    if (active) {
      svg.append(el('rect', {
        x: x, y: padY - 2, width: laneW - 4, height: 12,
        fill: 'none', stroke: 'var(--accent)', 'stroke-width': 0.7, rx: 2,
      }));
    }
    /* 车道分隔 */
    if (i > 0) {
      svg.append(el('line', {
        x1: x, y1: top - 4, x2: x, y2: height - padY,
        stroke: 'var(--rule-soft)', 'stroke-width': 0.6,
      }));
    }
  }

  /* ── 01 识别：每页一格 ── */
  {
    const x = padX, w = laneW - 6;
    const pages = [...state.pages.values()];
    drawCells(svg, pages.map((p) => ({
      fill: p.mix ? 'var(--mix)' : p.vision ? 'var(--vision)' : 'var(--rule-soft)',
      tip: `P${p.page} ${p.mix ? `已混 ${p.mix.blocks} 块` : p.vision ? '已读' : '未读'}`,
    })), { x, y: top, w, cellH: 9, gap: 1.5, cols: Math.max(1, Math.floor(w / 11)) });

    /* 队列深度折线。
     *
     * ★ **横轴按真实时间**，不按事件序号。
     *
     * 审查第 12 条：早先按序号等距画 —— 几十秒的等待和几毫秒的连续事件
     * 在图上长得一样，你根本无法从中判断"是否真的并行"。
     * 现在按 `t` 投影，时间轴才有意义。
     *
     * 另：折线区分**实测**（产品上报的真实队列长度）与**估算**（退回推算），
     * 实测用实线、估算用虚线，并有图例 —— 不能让人把估算当实测。
     */
    if (state.queue.length > 1) {
      const qh = 26, qy = height - padY - qh;
      const maxD = Math.max(1, ...state.queue.map((q) => q.depth));
      const tMax = Math.max(1, ...state.queue.map((q) => q.t));
      const tMin = Math.min(...state.queue.map((q) => q.t));
      const span = Math.max(1, tMax - tMin);
      const allMeasured = state.queue.every((q) => q.measured);

      const pts = state.queue.map((q) => {
        const px = x + (w * (q.t - tMin)) / span;
        const py = qy + qh - (q.depth / maxD) * qh;
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      }).join(' ');

      svg.append(el('polyline', {
        points: pts, fill: 'none', stroke: 'var(--warn)', 'stroke-width': 1,
        'stroke-dasharray': allMeasured ? null : '2 2',
      }));
      svg.append(el('text', { x, y: qy - 3, 'font-size': 7.5, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
        `队列峰值 ${maxD}${allMeasured ? '（实测）' : '（估算）'}`));
      svg.append(el('text', { x, y: qy + qh + 8, 'font-size': 7, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
        `0 … ${(tMax / 1000).toFixed(1)}s`));
    }
  }

  /* ── 02 标记：每块一格，按 role/facet 上色 ── */
  {
    const x = padX + laneW, w = laneW - 6;
    const blocks = [...state.blocks.values()];
    drawCells(svg, blocks.map((b) => ({
      fill: b.role === '支线' ? 'var(--accent)'
        : b.role ? (FACET_COLOR[(b.facets ?? [])[0]] ?? 'var(--mix)')
          : 'var(--rule-soft)',
      tip: `块${b.index} ${b.role ?? '未标'}`,
    })), { x, y: top, w, cellH: 9, gap: 1.5, cols: Math.max(1, Math.floor(w / 11)) });
    const counts = countRoles(blocks);
    svg.append(el('text', { x, y: top + rowCount(blocks.length, Math.max(1, Math.floor(w / 11))) * 10.5 + 10,
      'font-size': 7.5, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
    `${counts.main}主 ${counts.side}支 ${counts.unlabeled}未标`));
  }

  /* ── 03 筛支线：大黑板条目 ── */
  {
    const x = padX + laneW * 2, w = laneW - 6;
    drawBars(svg, state.board.map((b) => ({
      label: clip(b.summary || b.why || `块${b.index}`, 6), w: 1, fill: 'var(--accent)',
    })), { x, y: top, w, rowH: 11 });
    svg.append(el('text', { x, y: top + state.board.length * 11 + 10,
      'font-size': 7.5, 'font-family': 'var(--mono)', fill: 'var(--faint)' }, `${state.board.length} 条`));
  }

  /* ── 04 挂账：每片叶的 token 负担 ── */
  {
    const x = padX + laneW * 3, w = laneW - 6;
    const maxTok = Math.max(1, ...state.leaves.map((l) => l.pendingTok));
    drawBars(svg, state.leaves.map((l) => ({
      label: l.page != null ? `P${l.page}` : '无课件', w: l.pendingTok / maxTok, fill: 'var(--vision)',
    })), { x, y: top, w, rowH: 11 });
    svg.append(el('text', { x, y: top + state.leaves.length * 11 + 10,
      'font-size': 7.5, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
    `${state.leaves.length} 叶 / 峰值 ${fmt(maxTok)}`));
  }

  /* ── 05 审查合并 ── */
  {
    const x = padX + laneW * 4, w = laneW - 6;
    drawBars(svg, state.merges.map((m, i) => ({
      label: `叶${i}`, w: m.split ? 1 : 0.35, fill: m.split ? 'var(--warn)' : 'var(--rule)',
    })), { x, y: top, w, rowH: 11 });
    const split = state.merges.filter((m) => m.split).length;
    svg.append(el('text', { x, y: top + state.merges.length * 11 + 10,
      'font-size': 7.5, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
    `${split}/${state.merges.length} 切过`));
  }

  /* ── 06 重构：知识点叶 ── */
  {
    const x = padX + laneW * 5, w = laneW - 6;
    /* ★ 颜色**不能**按"当前最大值"算。
     *
     * 审查第 25 条：早先 `p.tok > maxTok * 0.9` 着色 —— 新加入一个大叶，
     * 旧叶会**无缘无故变色**（因为它们相对最大值的位置变了）。
     * 视觉变化没有对应业务变化，就会制造假异常。
     *
     * 现在按**斩杀线**着色（那是业务的真实阈值），见 `overLine()`：
     *   · 超线 → 黄（需要关注）
     *   · 没超 → 绿（正常）
     * 斩杀线未知时不表态（用中性色）。
     */
    /* 斩杀线由调用方传入（渲染层不持有全局状态）。 */
    const line = Number.isFinite(view.splitLine) ? view.splitLine : null;
    drawCells(svg, state.points.map((p) => {
      const over = line === null ? null : (p.tok ?? 0) > line;
      return {
        fill: over === null ? 'var(--rule)' : over ? 'var(--warn)' : 'var(--mix)',
        tip: `${p.id} ${p.tok} tok${over ? ' ⚠ 超线' : ''}`,
        /* 高度只表达"相对斩杀线有多重"，不随兄弟节点漂移。 */
        h: line === null ? 9 : Math.max(4, Math.min(16, ((p.tok ?? 0) / line) * 12)),
      };
    }), { x, y: top, w, cellH: 9, gap: 2, cols: Math.max(1, Math.floor(w / 13)), variable: true });
    svg.append(el('text', { x, y: height - padY, 'font-size': 8, 'font-family': 'var(--mono)', fill: 'var(--ink)' },
      `${state.points.length} 个知识点`));
  }

  /* ── 07 习坎：章 → 节 ── */
  {
    const x = padX + laneW * 6, w = laneW - 6;
    let y = top;
    for (const chapter of state.chapters) {
      svg.append(el('text', { x, y, 'font-size': 8, 'font-family': 'var(--sans)', fill: 'var(--ink)' },
        clip(chapter.title || '（无名章）', 12)));
      y += 10;
      for (const topic of chapter.topics.slice(0, 8)) {
        svg.append(el('text', { x: x + 6, y, 'font-size': 7, 'font-family': 'var(--sans)', fill: 'var(--ink-2)' },
          clip(topic.title || '（无名）', 11)));
        y += 8.5;
        if (y > height - padY) break;
      }
      if (chapter.topics.length > 8) {
        svg.append(el('text', { x: x + 6, y, 'font-size': 7, fill: 'var(--faint)' },
          `… 还有 ${chapter.topics.length - 8} 节`));
        y += 9;
      }
      if (y > height - padY) break;
    }
    if (!state.chapters.length) {
      svg.append(el('text', { x, y, 'font-size': 7.5, fill: 'var(--faint)' }, '（还没到这一步）'));
    }
  }

  /* ── 08 终稿 ── */
  {
    const x = padX + laneW * 7, w = laneW - 6;
    if (!state.polish) {
      svg.append(el('text', { x, y: top, 'font-size': 7.5, fill: 'var(--faint)' }, '（还没到这一步）'));
    } else {
      const ok = !state.polish.failed;
      svg.append(el('text', { x, y: top, 'font-size': 8, 'font-family': 'var(--mono)',
        fill: ok ? 'var(--mix)' : 'var(--accent)' },
      ok ? (state.polish.unchanged ? '一字未改' : `${state.polish.changes} 处改动`) : '失败'));
      svg.append(el('text', { x, y: top + 12, 'font-size': 7, fill: 'var(--faint)' },
        `${fmt(state.polish.chars)} 字`));
    }
  }
}

/* 阶段顺序（与 log-core 的 PHASES 一致；这里独立写一份是为了渲染层不依赖 core 的导出顺序） */
const PHASES_ORDER = [
  { no: '01', key: 'vision', name: '识别' },
  { no: '02', key: 'mark', name: '标记' },
  { no: '03', key: 'sieve', name: '筛支线' },
  { no: '04', key: 'stash', name: '挂账' },
  { no: '05', key: 'merge', name: '审查合并' },
  { no: '06', key: 'regroup', name: '重构' },
  { no: '07', key: 'lecture', name: '习坎' },
  { no: '08', key: 'polish', name: '终稿' },
];

/* ── 小工具 ─────────────────────────────────────────────────────── */

function fmt(n) {
  const v = Number(n) || 0;
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

function countRoles(blocks) {
  return {
    main: blocks.filter((b) => b.role === '主线').length,
    side: blocks.filter((b) => b.role === '支线').length,
    unlabeled: blocks.filter((b) => !b.role).length,
  };
}

function rowCount(n, cols) { return Math.ceil(n / Math.max(1, cols)); }

/** 画一片小格（每格代表一个真实对象）。 */
function drawCells(svg, cells, { x, y, w, cellH = 9, gap = 1.5, cols = 8, variable = false }) {
  const cw = (w - gap * (cols - 1)) / cols;
  cells.forEach((cell, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const h = variable ? (cell.h ?? cellH) : cellH;
    const rect = el('rect', {
      x: x + col * (cw + gap), y: y + row * (cellH + gap),
      width: Math.max(2, cw), height: h, fill: cell.fill, rx: 1.2,
    });
    if (cell.tip) rect.append(el('title', {}, cell.tip));
    svg.append(rect);
  });
}

/** 画一组横条（每行一条，长度按比例）。 */
function drawBars(svg, bars, { x, y, w, rowH = 11 }) {
  bars.forEach((bar, i) => {
    const by = y + i * rowH;
    const bw = Math.max(2, (w - 26) * Math.max(0.02, Math.min(1, bar.w)));
    svg.append(el('rect', { x, y: by, width: bw, height: rowH - 3, fill: bar.fill, rx: 1.2 }));
    svg.append(el('text', { x: x + bw + 3, y: by + rowH - 5, 'font-size': 6.5,
      'font-family': 'var(--mono)', fill: 'var(--faint)' }, bar.label));
  });
}

/* ── 树视图（点节点看产物）────────────────────────────────────── */

/**
 * 画一棵**真实**的知识树：章 → 节 → 内容。
 *
 * 这是"点节点探针"的界面：每个节点都能点，点了显示它自己的产物。
 *
 * @param {SVGElement} svg
 * @param {object} state
 * @param {object} view  { width, height, onPick(phaseKey, node) }
 */
export function renderTree(svg, state, view = {}) {
  const width = view.width ?? 900;
  const height = view.height ?? 420;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();

  if (!state.chapters.length) {
    svg.append(el('text', { x: 16, y: 28, 'font-size': 11, fill: 'var(--faint)' }, '（还没有讲义 —— 往后走几步）'));
    return;
  }

  /* ⚠️ 不再因为高度到顶就 `break`（审查第 24 条）。
   *
   * 早先超屏直接停画，后面的节点**完全看不到**，且没有任何入口能翻到。
   * 现在按**实际需要的总高度**设置 viewBox，画布区可滚动 ——
   * "计数 100 个" 与 "能检查这 100 个" 必须一致。
   */
  const lineH = 17;
  /* 先算总行数，再定 viewBox 高度。 */
  let needH = 22;
  for (const c of state.chapters) needH += lineH + 1 + (c.topics?.length ?? 0) * lineH + 4;
  const realH = Math.max(height, needH + 12);
  svg.setAttribute('viewBox', `0 0 ${width} ${realH}`);

  let y = 22;
  for (const [ci, chapter] of state.chapters.entries()) {
    /* 章节点 */
    const cg = el('g', { 'data-phase': 'lecture', style: 'cursor:pointer' });
    cg.append(el('rect', { x: 10, y: y - 11, width: width - 20, height: lineH, fill: 'var(--paper-2)', rx: 2 }));
    cg.append(el('text', { x: 16, y, 'font-size': 11, 'font-family': 'var(--sans)', fill: 'var(--ink)' },
      `${ci + 1}. ${clip(chapter.title || '（无名章）', 40)}`));
    cg.append(el('text', { x: width - 90, y, 'font-size': 8, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
      `${chapter.topics.length} 节`));
    cg.addEventListener('click', () => view.onPick?.('lecture', { kind: 'chapter', chapter }));
    svg.append(cg);
    y += lineH + 1;

    for (const [ti, topic] of chapter.topics.entries()) {
      const tg = el('g', { 'data-phase': 'lecture', style: 'cursor:pointer' });
      tg.append(el('text', { x: 26, y, 'font-size': 10, 'font-family': 'var(--sans)', fill: 'var(--ink-2)' },
        `${ci + 1}.${ti + 1} ${clip(topic.title || '（无名知识点）', 42)}`));
      tg.append(el('text', { x: width - 120, y, 'font-size': 8, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
        `${topic.chars} 字 / ${topic.blocks} 块`));
      tg.addEventListener('click', () => view.onPick?.('lecture', { kind: 'topic', chapter, topic }));
      svg.append(tg);
      y += lineH;
    }
    y += 4;
  }
}

/**
 * 画**知识点叶**（第 06 段的产物）：每片叶一个方块，点开看它的 token / 页码。
 */
export function renderPoints(svg, state, view = {}) {
  const width = view.width ?? 900;
  const height = view.height ?? 420;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.replaceChildren();

  if (!state.points.length) {
    svg.append(el('text', { x: 16, y: 28, 'font-size': 11, fill: 'var(--faint)' }, '（还没有知识点叶）'));
    return;
  }

  const cols = Math.max(1, Math.floor((width - 20) / 84));
  const cw = (width - 20) / cols - 6;
  state.points.forEach((point, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x = 10 + col * (cw + 6);
    const y = 12 + row * 26;
    const g = el('g', { style: 'cursor:pointer' });
    g.append(el('rect', { x, y, width: cw, height: 20, fill: 'var(--paper-2)', stroke: 'var(--rule)', rx: 2 }));
    g.append(el('text', { x: x + 4, y: y + 9, 'font-size': 7.5, 'font-family': 'var(--mono)', fill: 'var(--ink)' },
      clip(point.id || `叶${i + 1}`, 10)));
    g.append(el('text', { x: x + 4, y: y + 17, 'font-size': 7, 'font-family': 'var(--mono)', fill: 'var(--faint)' },
      `${fmt(point.tok)} tok`));
    g.addEventListener('click', () => view.onPick?.('regroup', { kind: 'point', point }));
    svg.append(g);
  });
}
