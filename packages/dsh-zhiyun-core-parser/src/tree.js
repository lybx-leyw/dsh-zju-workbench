/**
 * **知识树：从标记块长出树，再从树重构出知识点**。
 *
 * 这个文件是 `docs/show/zhiyun-pipeline.html` 第 03–06 段的实现。演示里那四段
 * 不是"示意"，是算法本身，所以这里严格按它的顺序落：
 *
 * ```
 * 03 筛支线      支线 / 教学安排 / 作业 → 不进树（去大黑板）
 * 04 挂账        主线块按页挂到叶上：只 pending += tok，**永不真合并**
 * 05 正交审查     同名标题并到一起 → 叶不再重叠 → 并发合并可以零锁
 *    并发合并     每个叶自己长：≤ 斩杀线就整片并进正文，> 就长成叶树（可递归）
 * 06 拆叶        叶树里每一层的小标题全部作废，只留最深层的叶
 *    重聚        内容段按斩杀线并回「一片叶 = 一个知识点」
 *    分级聚合     逐层归并到根
 * ```
 *
 * # 三个刻意的约束
 *
 * 1. **块只进 pending，批次阶段不合并。** 合并要读全文、要调模型，那是
 *    switch 阶段的事。批次阶段做判定 = 在信息不全时做决定。
 * 2. **叶永远没有标题。** 名字只存在于 title 节点上。叶是内容，标题是投影。
 * 3. **斩杀线按 token 算，不按块数。** 块数表示"几段"，长度却参差不齐 ——
 *    真正吃上下文的是 token。
 */

import { tokensOf } from './tokenize.js';
import { topicOfBlock } from './semantic-plan.js';

/** facet 的两种角色（与提示词里的 11 类闭词表对应）。 */
export const FACET = Object.freeze({
  /** 宿主型：本身就是一个知识点，内容可以直接进正文 */
  HOST: Object.freeze(['概念', '公式', '定理', '法则', '思想']),
  /** 依附型：必须挂在某个知识点下，**不进宿主正文** */
  ATTACH: Object.freeze(['例题', '案例', '实验', '故事']),
  /** 元信息：不是学科内容 → 大黑板，不进树 */
  META: Object.freeze(['教学安排', '作业']),
});

/**
 * 一批块属于哪一种角色。
 *
 * 判据优先保留学科内容：**host、attach、纯meta**。一个块同时标了
 * `概念` 和 `教学安排` 时保留学科正文（真实数据里这种
 * 混合标签很常见，不能据此整块删除知识；正式组织负责移除其中的纯课堂事务）。
 */
export function facetRole(block) {
  const facets = new Set(block?.tag?.facets ?? []);
  if (FACET.HOST.some((f) => facets.has(f))) return 'host';
  if (FACET.ATTACH.some((f) => facets.has(f))) return 'attach';
  if (FACET.META.some((f) => facets.has(f))) return 'meta';
  return 'none';
}

/** 默认斩杀线（token）。一屏中文正文 + 公式表格开销的量级。 */
export const kDefaultSplitLine = 1200;

/** 叶树递归的深度上限（防御：切到这么深还超线就认了）。 */
export const kMaxLeafDepth = 4;

/**
 * 03 筛支线：把块分成「进树的」与「进大黑板的」。
 *
 * 支线的判据是 `role === '支线'`；元信息（教学安排 / 作业）即使被标成主线
 * 也要剔出去 —— 它们不是学科内容，进树只会污染知识点与标题。
 *
 * @returns {{main:Array, board:Array, stats:object}}
 */
export function sieveBlocks(blocks) {
  const main = [], board = [];
  let side = 0, meta = 0, unlabeled = 0;
  for (const block of blocks) {
    const role = block?.tag?.role ?? null;
    const kind = facetRole(block);
    if (role === '支线') { side++; board.push({ ...block, why: '支线' }); continue; }
    if (kind === 'meta') { meta++; board.push({ ...block, why: '元信息' }); continue; }
    if (role !== '主线') { unlabeled++; board.push({...block, why:'待标记'}); continue; }
    if (block.cleanStatus === 'incomplete') { board.push({...block, why:'待清洗'}); continue; }
    main.push(block);
  }
  return { main, board, stats: { total: blocks.length, main: main.length, side, meta, unlabeled } };
}

/**
 * 04 挂账：把主线块挂到「页 → 叶」上，**只累加，不合并**。
 *
 * 依附型块（例题/案例/实验/故事）走 `attach` 通道，**不进宿主正文的 pending**。
 * 这是"例题不会被压没"的根本原因：它压根不在正文那一堆里。
 */
/**
 * 一个块的**正文**。
 *
 * # 为什么不能只读 `block.text`
 *
 * 解析器产出的块形状是 `{ index, page, sentences[], tag: {…} }` —— 正文在
 * `sentences` 里，**没有 `text` 字段**。早先 `stashBlocks` 直接 `tokensOf(block.text)`
 * 拿到的是 `undefined`，于是每一个块的 token 都算成 0：
 *
 *   · 挂账时 `pendingTok` 全是 0 → 没有任何叶超过斩杀线 → 拆叶从不发生；
 *   · 重聚时按 0 累加 → 30 个块被聚成 1 个知识点（本该是十几个）。
 *
 * 症状极具欺骗性：跑得通、不报错、句子一句不丢，但**树是扁的**。
 * 所以这里统一成"有 text 用 text，否则把 sentences 拼起来"。
 */
function textOfBlock(block) {
  if (typeof block?.text === 'string' && block.text.length) return block.text;
  const sentences = block?.sentences ?? [];
  if (!sentences.length) return '';
  return sentences.map((s) => String(s?.text ?? '')).join('');
}

export function stashBlocks(mainBlocks) {
  const byPage = new Map();
  for (const block of mainBlocks) {
    const page = block.page ?? null;
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(block);
  }
  const leaves = [];
  for (const page of [...byPage.keys()].sort((a, b) => (a ?? 0) - (b ?? 0))) {
    const leaf = {
      page,
      blocks: byPage.get(page),
      pendingTok: 0,
      pendingB: 0,
      attach: [],
      from: byPage.get(page)[0]?.index ?? null,
      to: byPage.get(page).at(-1)?.index ?? null,
    };
    for (const block of leaf.blocks) {
      const tok = tokensOf(textOfBlock(block));
      if (facetRole(block) === 'attach') leaf.attach.push({ block, tok, facet: block.tag?.facets?.[0] ?? '案例' });
      else { leaf.pendingTok += tok; leaf.pendingB++; }
    }
    leaves.push(leaf);
  }
  return leaves;
}

/**
 * 05 正交审查：直接连叶的同名标题并到一起。
 *
 * ⚠️ 只看**直接连着叶**的那一层：越往上越是"章"这种粗粒度名字，
 *    它们同名很正常（两章都叫「小结」），不该合并。
 */
export function orthogonalize(titles) {
  const buckets = new Map();
  for (const node of titles) {
    const key = String(node.title ?? '').replace(/\s+/g, '');
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(node);
  }
  const merges = [];
  for (const [key, same] of buckets) {
    if (same.length < 2) continue;
    const [keep, ...drop] = same;
    merges.push({
      key,
      keepId: keep.id,
      dropIds: drop.map((n) => n.id),
      absorbedTokens: drop.reduce((a, n) => a + (n.pendingTok ?? 0), 0),
      absorbedBlocks: drop.reduce((a, n) => a + (n.pendingB ?? 0), 0),
    });
  }
  return merges;
}

/**
 * 05 并发合并（一片叶）：≤ 斩杀线就整片并进正文；> 就长成叶树（可递归）。
 *
 * # 为什么"切分"是不均匀的
 *
 * 真实的知识点篇幅是**长尾**的：一个叶里常常"第一个知识点就占掉一半"。
 * 均分会让每支都稳稳低于斩杀线，于是叶树永远只有一层 —— 那不是真实形状。
 * 按 Zipf 权重分配块数，最大的那一支经常仍超线，于是它自己再长一层，
 * 层数自然出来（2–4 层）。
 *
 * # 为什么子叶之间不需要锁
 *
 * 正交审查之后，每个叶的块集合互不相交，合并只读自己的块、只写自己的叶。
 * 所以「并发」在这里是安全的，而不是靠加锁保护出来的。
 */
export function mergeLeaf(leaf, { splitLine = kDefaultSplitLine, depth = 1 } = {}) {
  const result = { split: false, parts: 0, deepSplits: 0, depth: 0, tookTok: leaf.pendingTok, took: leaf.pendingB };

  /* ★ **合并前后正文对照**（审查第 15 条）。
   *
   * 只有计数（"切了 3 支、吸收了 500 token"）无法验收 merge 做对没有。
   * 验收要能看见"合并前这片叶是什么样、合并后成了什么样"。
   *
   * 只在**顶层**（depth === 1）记，递归子叶不重复记 —— 否则日志会爆。
   * 截断到 800 字：全量在 stage artifact 里。
   */
  const headOf = (leafNode, max = 800) => (leafNode.blocks ?? [])
    .map((b) => textOfBlock(b))
    .join('\n')
    .slice(0, max);

  if (depth === 1) result.before = headOf(leaf);

  // 依附块 → 子叶（依托关系 = 叶挂叶），不参与正文 pending
  if (leaf.attach?.length) {
    leaf.children = (leaf.children ?? []).concat(leaf.attach.map((a, i) => ({
      id: `${leaf.id ?? `p${leaf.page}`}__a${i}`,
      kind: 'leaf',
      blocks: [a.block],
      attachFacet: a.facet,
      fromAttach: true,
      tok: a.tok,
      /* ★ 记下宿主：regroup 时要靠它把例题接回宿主所在的知识点，
       * 而不是让它自己成一个知识点（设计里例题是子叶）。
       *
       * **同时记 `hostPage`** —— id 在切分后会变（宿主被切片、摊平），
       * 页码不会。按页归位比按 id 稳。 */
      hostId: leaf.id ?? null,
      hostPage: a.block?.page ?? leaf.page ?? null,
      children: [],
    })));
    leaf.attach = [];
  }

  if (leaf.pendingTok > splitLine && depth <= kMaxLeafDepth) {
    const got = splitLeaf(leaf, splitLine, depth);
    // ⚠️ 切不开（只有一块内容 / 块数不够分）就**不算 split**，如实返回。
    //    谎报 split=true 会让上层以为"已经按斩杀线切过了"，于是把一片超线
    //    的叶当成合格的叶放过去 —— 那正是"叶树永远只有一层、超线数等于叶树数"
    //    那个 bug 的样子。
    if (got.parts) {
      result.split = true;
      result.parts = got.parts;
      result.deepSplits = got.deepSplits;
      result.depth = leafTreeDepth(leaf);
    }
  }

  /* 合并后的正文：如果切了，子叶各自成段；没切就是原样。 */
  if (depth === 1) {
    result.after = (leaf.children ?? []).length
      ? (leaf.children ?? []).map((c) => headOf(c, 400)).filter(Boolean).join('\n—\n').slice(0, 1200)
      : headOf(leaf);
    result.attachMade = (leaf.children ?? []).filter((c) => c.fromAttach).length;
  }

  return result;
}

/** 按 Zipf 权重把块数分给若干支（长尾：第一支常常占掉近一半）。 */
export function zipfRanges(total, parts) {
  const n = Math.max(1, Math.min(parts, total));
  const w = Array.from({ length: n }, (_, i) => 1 / Math.pow(i + 1, 1.15));
  const sum = w.reduce((a, b) => a + b, 0);
  const alloc = w.map((x) => Math.max(1, Math.round((total * x) / sum)));
  let diff = total - alloc.reduce((a, b) => a + b, 0);
  let i = 0;
  while (diff !== 0 && i < n * 40) {
    const k = i % n;
    if (diff > 0) { alloc[k]++; diff--; }
    else if (alloc[k] > 1) { alloc[k]--; diff++; }
    i++;
  }
  const out = [];
  let start = 0;
  for (const a of alloc) { out.push([start, start + a - 1]); start += a; }
  return out;
}

/**
 * 把一片叶切成一棵（可能多层的）叶树。
 *
 * # 切分单位：先按**块**切，块不够时按**字**切
 *
 * 真实材料里"一页一块"很常见（字幕按页窗口聚起来就是一块），而那一块可能
 * 就有两三万 token。这时按块切分根本切不动 —— 只有 1 块，`zipfRanges(1, n)`
 * 只能给 1 段。**放弃切分**是错的：那等于承认"这一页就是不可分的一坨"，
 * 而它在讲义里根本放不进一次调用。
 *
 * 所以分两级：
 *   ① 块数 ≥ 2 → 按块切（边界就是产品自己的块边界，最忠实）；
 *   ② 只有 1 块且超线 → **按字切**（在文本内找最近的句末/换行切开），
 *      切出来的段仍然带着原块的身份（`_splitFrom`），不是新内容。
 *
 * # 两个容易写错的地方（都踩过）
 *
 * **子叶的 token 必须与父叶的总量守恒。** 早先子叶自己 `tokensOf(slice)` 重算，
 * 与父叶记录的 `pendingTok` 不同口径，递归判断因此失真 —— 表现就是
 * "子叶明明超线却不递归"、"叶树永远只有一层"。
 *
 * **`parts` 要如实反映"真的切开了"。** 切不动却返回 split=true，上层会以为
 * 这片叶已经按斩杀线处理过，于是把超线的叶当合格放过去。
 *
 * # 「这里不增删字符」不等于「全链路逐字守恒」
 *
 * 这一层的无损是**机械保证**：切分只是把同一段文本分段放，不调模型、
 * 不做清洗，所以进出字符数必然相等。
 *
 * 但**整条链路不是无损的**：`mix` 会清洗口语转写（错字、嗯啊、重复），
 * `merge` 会语义重排（去掉口语成分、重组句子），讲义再补理解。
 * 这些步骤**本来就要改字**。
 *
 * 所以判据必须分层：
 *   · **切分**这一层 —— 可以断言字符相等；
 *   · **整条链路** —— 只能断言「块身份不丢不重」，不能断言字符相等。
 * 把后者写进验收标准，等于要求产品不许做它的本职工作。
 *
 * @returns {{parts:number, deepSplits:number}} `parts === 0` 表示没能切开。
 */
/**
 * 一片叶的**正文块**：`leaf.blocks` 里排除掉依附块（例题/案例）。
 *
 * # 为什么需要它
 *
 * 挂账时按页整页收集，所以 `leaf.blocks` 里混着"正文块 + 依附块"两种。
 * 图里 `stashInto` 把依附块**另外**记进 `leaf.attach`、且**不计入正文 pending** ——
 * 也就是说依附内容走的是"叶挂叶"，不是"正文的一部分"。
 *
 * 因此切分（`splitLeaf`）必须只看正文块。否则依附块会被切进某个正文支，
 * 随后又作为依附子叶追加一次 —— 同一道例题在树里出现两次。
 *
 * 判定依据是**同一个** `facetRole()`：挂账时用它分流，切分时也必须用它排除，
 * 两处用同一判据才不会出现"挂账算依附、切分算正文"的错位。
 */
function bodyBlocksOf(leaf) {
  const blocks = leaf.blocks ?? [];
  const attachBlocks = new Set((leaf.attach ?? []).map((a) => a.block).filter(Boolean));
  /* ⚠️ 要排除**两种**，不是一个：
   *   · `attach` —— 例题/案例，挂成子叶；
   *   · `meta`   —— 教学安排/作业/通知，**根本不是正文**（已经在筛支线阶段进大黑板）。
   * 早先只排除 `attach`，元信息块就混进正文被切分、被写进知识点。
   * `facetRole()` 是唯一判据，这里与筛支线用的是同一套。 */
  const isBody = (b) => {
    const role = facetRole(b);
    return role !== 'attach' && role !== 'meta';
  };
  if (!attachBlocks.size) return blocks.filter(isBody);
  return blocks.filter((b) => !attachBlocks.has(b) && isBody(b));
}

function splitLeaf(leaf, splitLine, depth) {
  /* ★ 只用**正文块**切分。
   *
   * 图里的 `stashInto` 把依附块（例题/案例）单独记在 `leaf.attach`，
   * 它们**不进正文 pending**。但 `leaf.blocks` 里仍然留着那些例题块
   *（挂账时按页整页收集的）。如果切分直接用 `leaf.blocks`，例题就会被
   * 切进正文支、随后又作为依附子叶追加一次 —— **同一例题出现两次**。
   *
   * 所以这里把依附块排掉：正文块 = blocks − attach 的那些块。
   */
  const blocks = bodyBlocksOf(leaf);
  const perTarget = Math.max(300, Math.round(splitLine * 0.66));
  // 一个叶下面只拟 2–4 个小标题：真实课件里"一个知识点下面挂它自己的几个
  // 子知识点"，不会一口气挂六个。切得少 ⇒ 子叶常常还超线 ⇒ 继续长树。
  const wanted = Math.min(4, Math.max(2, Math.ceil(leaf.pendingTok / perTarget)));

  const kids = blocks.length >= 2
    ? splitByBlocks(leaf, blocks, wanted)
    : splitByChars(leaf, blocks, wanted, splitLine);

  if (kids.length < 2) return { parts: 0, deepSplits: 0 };

  // 总量守恒：分摊的取整误差补到最后一支。
  const sum = kids.reduce((a, k) => a + k.tok, 0);
  kids[kids.length - 1].tok += leaf.pendingTok - sum;

  const attachKids = (leaf.children ?? []).filter((c) => c.fromAttach);
  leaf.subTitles = kids.map((_, i) => `§${i + 1}`);
  leaf.children = kids.concat(attachKids);
  /* ★ 内容已经下放给子叶，宿主**不能再持有同一批块**。
   *
   * 图里的叶只有"块数"（`leaf.blocks += totalB` 是个数字），内容不重复持有；
   * 我的实现里 `blocks` 是数组，父叶若留着原来那批，父子就同时握着同一段正文。
   * 后果不是"多画几笔"，而是**同一块被重复计入**：把叶树摊平核对时，
   * 同一段内容会被数好几层（实测 14400 字被数成 3 倍）。
   * 注意这是"**重复计数**"的问题，不是"必须逐字守恒"——后者只在切分这一层成立，
   * 整条链路里 mix 会清洗、merge 会重排，字符数本来就会变。
   *
   * 依附子叶的块本来就不在正文里，所以清空只影响正文 —— 例题不受影响。
   */
  leaf.blocks = [];

  let deepSplits = 0;
  for (const child of leaf.children) {
    if (child.fromAttach) continue;              // 依附叶不按宿主规则切
    /* ⚠️ 子叶的体量存在 `tok`（图里的 `_tok`），不是 `pendingTok`。
     * `splitLeaf()` 内部读的是 `leaf.pendingTok`，所以递归前必须把它
     * 摆正到 `pendingTok`，否则递归看到 0 就永远不往下长。 */
    const size = child.tok ?? child.pendingTok ?? 0;
    if (size > splitLine && depth < kMaxLeafDepth) {
      child.pendingTok = size;
      const got = splitLeaf(child, splitLine, depth + 1);
      if (got.parts) deepSplits++;
      child.pendingTok = 0;
    }
  }
  leaf.pendingTok = 0;
  leaf.pendingB = 0;
  leaf.isTree = true;
  leaf.treeDepth = leaf.treeDepth ?? depth;
  return { parts: kids.length, deepSplits };
}

/** ① 按块切：边界就是产品自己的块边界（最忠实的一级）。 */
function splitByBlocks(leaf, blocks, wanted) {
  const ranges = zipfRanges(blocks.length, Math.min(wanted, blocks.length));
  if (ranges.length < 2) return [];
  /* ⚠️ 必须走 `textOfBlock()`：真实块的正文在 `sentences[]`，没有 `text`。
   * 早先直接读 `blk.text`，权重全算成 0 → `totalChars` 落到 `|| 1` →
   * 每支的 tok 都变成 `leaf.pendingTok × 0 / 1` 被 `Math.max(1,…)` 抬成 1，
   * 于是子叶看起来全都很小，递归判断完全失真。 */
  const charsOf = (blk) => textOfBlock(blk).length;
  const totalChars = blocks.reduce((sum, blk) => sum + charsOf(blk), 0) || 1;
  return ranges.map(([a, b], i) => {
    const slice = blocks.slice(a, b + 1);
    const chars = slice.reduce((sum, blk) => sum + charsOf(blk), 0);
    return {
      id: `${leaf.id ?? `p${leaf.page}`}__s${i}`,
      kind: 'leaf',
      blocks: slice,
      tok: Math.max(1, Math.round((leaf.pendingTok * chars) / totalChars)),
      fromSplit: true,
      children: [],
    };
  });
}

/**
 * ② 按字切：只有一块且超线时，在**文本内**切。
 *
 * 切开点优先找句末（。！？；\n），找不到就按比例硬切 —— 硬切只是把一段字
 * 分成两段字，**不增删任何字符**，所以内容不丢。
 */
function splitByChars(leaf, blocks, wanted, splitLine) {
  const block = blocks[0];
  /* ⚠️ 同上：真实块没有 `text`，正文在 `sentences[]` 里。
   * 早先这里读到空串就直接 `return []` —— 那正是"斩杀线彻底失效"的原因：
   * 一整片 18k token 的叶切不动，却没人报错。 */
  const text = textOfBlock(block);
  if (!text) return [];
  const parts = Math.min(wanted, Math.max(2, Math.ceil(leaf.pendingTok / Math.max(300, Math.round(splitLine * 0.66)))));
  const segments = [];
  let rest = text;
  for (let i = parts; i > 1; i--) {
    const target = Math.round(rest.length / i);
    // 在目标位置附近找一个句末（向后最多 30 字）
    const window = rest.slice(target, Math.min(rest.length, target + 30));
    const cut = window.search(/[。！？；\n]/);
    const at = cut >= 0 ? target + cut + 1 : target;
    segments.push(rest.slice(0, at));
    rest = rest.slice(at);
    if (!rest) break;
  }
  if (rest) segments.push(rest);
  if (segments.length < 2) return [];

  const totalChars = segments.reduce((a, s) => a + s.length, 0) || 1;
  return segments.map((segment, i) => ({
    id: `${leaf.id ?? `p${leaf.page}`}__c${i}`,
    kind: 'leaf',
    // 段仍是"原块的一段"：保留 page/index，好让下游知道它从哪来
    /* 切出来的段仍然带着原块身份；正文写回 `sentences`（真实块的主字段），
     * 同时保留 `text` 便于下游按任一种读法都能取到。 */
    blocks: [{
      ...block,
      text: segment,
      sentences: [{ text: segment, startMs: block.sentences?.[0]?.startMs ?? null }],
      _splitFrom: block.index,
      _segment: i + 1,
      /* ★ 片段序号：让"同一块切出的不同段"在来源统计里可区分。
       * 没有它，一个块切两半后会被算成"同一块重复收录"（假报警）。 */
      _part: i,
    }],
    tok: Math.max(1, Math.round((leaf.pendingTok * segment.length) / totalChars)),
    fromSplit: true,
    children: [],
  }));
}

/** 一棵叶树的最大嵌套层数（1 = 只有一层子叶）。 */
export function leafTreeDepth(node) {
  const kids = (node.children ?? []).filter((c) => c.kind === 'leaf');
  if (!kids.length) return 0;
  return 1 + Math.max(...kids.map(leafTreeDepth));
}

/** 叶树里所有**最深层**的叶（拆叶用）。 */
export function leafLevelNodes(node, out = []) {
  for (const child of node.children ?? []) {
    if (child.kind !== 'leaf') continue;
    const kids = (child.children ?? []).filter((c) => c.kind === 'leaf');
    if (kids.length) leafLevelNodes(child, out);
    else out.push(child);
  }
  return out;
}

/**
 * 06 拆叶：把叶树整个摊平 —— 每一层的小标题全部作废，只留最深层的叶。
 *
 * 依附叶（例题/案例）**一并摊平**：它同样是内容，不能因为宿主变树就丢。
 */
export function flattenLeaves(leaves) {
  const flat = [];
  let treeCount = 0, maxDepth = 0, droppedSubTitles = 0, attachLeaves = 0, hostKept = 0;
  for (const leaf of leaves) {
    const kids = (leaf.children ?? []).filter((c) => c.kind === 'leaf' && !c.fromAttach);
    if (!kids.length) { flat.push(stripLeaf(leaf)); continue; }
    treeCount++;
    maxDepth = Math.max(maxDepth, leafTreeDepth(leaf));
    droppedSubTitles += (leaf.subTitles ?? []).length;

    /* ★ 宿主自己的正文**必须留下**。
     *
     * 图里的模型是「叶只有正文、名字在父节点」。宿主叶长成叶树时，
     * 它的正文被 `splitLeafTree` 分给了子叶（`leaf.blocks += totalB` 记录总量）。
     * 但如果宿主**没有超限**、也没有拆分，只是挂了一道例题，那么它的
     * `children` 里只有一个依附子叶 —— 早先这里看到 `kids.length`（含依附）
     * 非空就只取 `leafLevelNodes()`，也就是只取那道例题，
     * **宿主自己的正文整段消失**。
     *
     * 判据必须是「有没有**切分**出来的子叶」(`fromSplit`)，而不是
     * 「有没有子叶」。依附子叶不构成"宿主已被拆开"。
     */
    const splitKids = kids.filter((c) => c.fromSplit);
    if (!splitKids.length) {
      /* 没切分：宿主正文整片保留，依附子叶跟着一起摊平。 */
      if (leaf.blocks?.length) { flat.push(stripLeaf(leaf)); hostKept++; }
      for (const child of kids) {
        if (!child.fromAttach) continue;
        attachLeaves++;
        flat.push(stripLeaf(child));
      }
      continue;
    }

    /* 真的切分了：正文已经在子叶里，宿主自身不再重复出一片。 */
    for (const deep of leafLevelNodes(leaf)) {
      if (deep.fromAttach) attachLeaves++;
      flat.push(stripLeaf(deep));
    }
  }
  return { flat, stats: { treeCount, maxDepth, droppedSubTitles, attachLeaves, hostKept } };
}

function stripLeaf(leaf) {
  return { kind: 'leaf', blocks: leaf.blocks, tok: leaf.tok ?? leaf.pendingTok ?? 0,
    fromAttach: !!leaf.fromAttach, attachFacet: leaf.attachFacet ?? null,
    /* 溯源：依附叶要记住它的宿主，重聚时才能接回去。 */
    hostId: leaf.hostId ?? null,
    hostPage: leaf.hostPage ?? leaf.blocks?.[0]?.page ?? null,
    subTitles: null, children: [] };
}

/**
 * 06 重聚：内容段按斩杀线并回「一片叶 = 一个知识点」。
 *
 * 摊平出来的是**内容段**（切分粒度），不是知识点。一节课的知识点数远少于
 * 内容段数，所以必须再聚一次 —— 否则重建出来的树会「叶比知识点多三倍」。
 *
 * # 单段自己就超线时怎么办
 *
 * 只"并"是不够的：真实材料里存在**一段就 8000 多字**的情况（字幕按页窗口
 * 聚起来就是一坨）。这种段单独成叶仍然超斩杀线 —— 于是每个知识点都放不进
 * 一次调用，只是把问题从"块太大"变成"叶太大"。
 *
 * 所以这里对**自超线的单段**再切一次（与 `splitLeaf` 同一套按字切分），
 * 保证出来每一片叶都落在斩杀线以内。
 */
export function regroupLeaves(flat, { splitLine = kDefaultSplitLine } = {}) {
  const groups = [];
  let cur = [], curTok = 0;

  /* ★ **依附叶（例题/案例）不能自己成组。**
   *
   * 设计图里例题是"挂在宿主叶下面的子叶"，它跟着宿主走，不是独立知识点。
   * 早先这里不分类型，一律按 token 装桶 —— 于是每个例题都单独成了一个
   * 知识点（真实数据里 n18..n24 全是孤零零的例题，`blockIds` 只有它自己）。
   * 那正好违反"依附内容保留、宿主正文仍在"，也是架构验收里
   * 「依附有宿主」报错的真实原因。
   *
   * 正确做法：先把依附叶按**宿主**分组，再把宿主正常装桶，
   * 最后把依附叶塞进宿主所在的那个知识点。
   */
  /* 依附叶按宿主归拢：**先按 id，id 匹配不上就按页**。
   *
   * 为什么需要两级：宿主叶在 `mergeLeaf` 里可能被切成多个子叶，
   * 摊平后 id 变了 —— 按 id 就找不到宿主，例题会掉出来自己成组。 */
  const attachLeaves = [];
  const hosts = [];
  for (const leaf of flat) {
    if (leaf.fromAttach) attachLeaves.push(leaf);
    else hosts.push(leaf);
  }

  const attachByHost = new Map();
  const leftovers = [];
  for (const a of attachLeaves) {
    const byId = a.hostId != null && hosts.some((h) => h.id === a.hostId);
    if (byId) {
      if (!attachByHost.has(a.hostId)) attachByHost.set(a.hostId, []);
      attachByHost.get(a.hostId).push(a);
    } else {
      leftovers.push(a);
    }
  }

  for (const leaf of hosts) {
    const tok = leaf.tok ?? 0;
    // 自超线的段必须独占一组（与别人并会更糟），随后在下面被切开。
    if (tok > splitLine) {
      if (cur.length) { groups.push(cur); cur = []; curTok = 0; }
      groups.push([leaf]);
      continue;
    }
    if (cur.length && curTok + tok > splitLine) { groups.push(cur); cur = []; curTok = 0; }
    cur.push(leaf); curTok += tok;
  }
  if (cur.length) groups.push(cur);

  /* 把依附叶接回宿主所在组（放到组末尾，保持"宿主正文在前、例题在后"）。 */
  const placed = new Set();
  for (const group of groups) {
    for (const host of group) {
      const atts = attachByHost.get(host.id) ?? [];
      for (const a of atts) { group.push(a); placed.add(a); }
    }
  }
  /* ⚠️ **兜底**：宿主没进任何组时，依附叶不能丢。
   *
   * 但**不能一股脑塞进最后一组** —— 那会把七八道例题堆进同一个知识点，
   * 造出一个 9000+ token 的巨块，反而违反斩杀线（实测就是这么来的）。
   *
   * 更合理的位置：按**页码**找最近的组 —— 依附叶和它的宿主通常在同一页。
   * 找不到同页就单独成一组（宁可多一个知识点，也不能制造超线巨块）。
   */
  const pageOfGroup = (group) => {
    const pages = group.map((l) => l.blocks?.[0]?.page).filter((x) => x != null);
    return pages.length ? pages[0] : null;
  };
  for (const a of leftovers) {
    if (placed.has(a)) continue;
    /* 按**宿主页**找组；没有宿主页就按自己的页。 */
    const page = a.hostPage ?? a.blocks?.[0]?.page ?? null;
    const samePage = page == null ? -1 : groups.findIndex((g) => pageOfGroup(g) === page);
    if (samePage >= 0) {
      groups[samePage].push(a);
    } else {
      /* 确实找不到同页宿主 → 自己一组。宁可多一个知识点，
       * 也不能把例题塞进不相干的知识点、撑破斩杀线。 */
      groups.push([a]);
    }
    placed.add(a);
  }

  const points = [];
  for (const group of groups) {
    const tokens = group.reduce((a, l) => a + (l.tok ?? 0), 0);
    // 超线组 → 拆成多片（各片仍 ≤ 斩杀线）
    if (tokens > splitLine && group.length === 1) {
      for (const piece of sliceOversized(group[0], splitLine)) points.push(piece);
      continue;
    }
    points.push(makePoint(group, points.length, tokens));
  }
  // 重新编号：上面两条路径都可能产出叶，编号统一在最后做。
  return points.map((p, i) => ({ ...p, id: `n${i}` }));
}

/** 一片知识点叶（正常路径）。 */
function makePoint(group, _index, tokens) {
  return {
    id: 'n0',
    kind: 'leaf',
    tok: tokens,
    blocks: group.flatMap((l) => l.blocks ?? []),
    merged: group.length,
    fromAttach: group.every((l) => l.fromAttach),
    attachFacet: group.length === 1 ? group[0].attachFacet ?? null : null,
  };
}

/**
 * 把一片**自超线**的叶按字切开。
 *
 * 与 `splitLeaf` 的 `splitByChars` 同一套做法：优先在句末切，硬切也不丢字符。
 * 切出来的片保持 `merged: 1`（它仍来自同一段内容），只是**分了几次放**。
 */
function sliceOversized(leaf, splitLine) {
  const blocks = leaf.blocks ?? [];
  // 多块的：按块累积到斩杀线
  if (blocks.length > 1) {
    const out = [];
    let cur = [], curTok = 0;
    for (const block of blocks) {
      const tok = tokensOf(textOfBlock(block));
      if (cur.length && curTok + tok > splitLine) {
        out.push({ id: 'n0', kind: 'leaf', tok: curTok, blocks: cur, merged: cur.length,
          fromAttach: !!leaf.fromAttach, attachFacet: leaf.attachFacet ?? null });
        cur = []; curTok = 0;
      }
      cur.push(block); curTok += tok;
    }
    if (cur.length) out.push({ id: 'n0', kind: 'leaf', tok: curTok, blocks: cur, merged: cur.length,
      fromAttach: !!leaf.fromAttach, attachFacet: leaf.attachFacet ?? null });
    return out;
  }

  // 单块的：按字切（复用 splitByChars 的切分逻辑，挂在一个假 leaf 上跑）
  const fake = { id: leaf.id ?? 'p0', page: leaf.blocks?.[0]?.page, blocks, pendingTok: leaf.tok ?? 0 };
  const kids = splitByChars(fake, blocks, Math.max(2, Math.ceil((leaf.tok ?? 0) / splitLine)), splitLine);
  if (kids.length < 2) {
    return [{ id: 'n0', kind: 'leaf', tok: leaf.tok ?? 0, blocks, merged: 1,
      fromAttach: !!leaf.fromAttach, attachFacet: leaf.attachFacet ?? null }];
  }
  return kids.map((kid, i) => ({
    id: 'n0', kind: 'leaf', tok: kid.tok, blocks: kid.blocks, merged: 1,
    fromAttach: !!leaf.fromAttach, attachFacet: leaf.attachFacet ?? null,
    /* ★ 片段要有**唯一身份**。
     *
     * 一个块被切成两片时，两片都继承原块的 `index` —— 于是下游按 `index`
     * 统计来源时，同一块看起来"被两个知识点重复收录"。
     * 内容并没有重复（两片是不同的字），**重复的是标识**。
     *
     * `_part` 让每一片可区分；`_splitFrom` 保留"从哪块切来"的溯源。
     */
    _part: i,
    _splitFrom: kid.blocks?.[0]?._splitFrom ?? kid.blocks?.[0]?.index ?? null,
    blocks: (kid.blocks ?? []).map((b) => ({ ...b, _part: i })),
  }));
}

/**
 * 06 分级聚合：逐层归并到根。
 *
 * ⚠️ 收敛条件是"再往上分也分不出新意思"，由上层（模型）判 —— 这里只提供
 *    **机械的**分组能力与上限，不假装知道该分几层。
 */
export function aggregate(nodes, { target = 4, round = 1 } = {}) {
  if (!nodes.length) return [];
  const per = Math.max(1, Math.ceil(nodes.length / Math.max(1, target)));
  const groups = [];
  for (let i = 0; i < nodes.length; i += per) groups.push(nodes.slice(i, i + per));
  return groups.map((kids, gi) => ({
    id: `r${round}g${gi}`,
    kind: 'title',
    children: kids,
    blocks: kids.flatMap((k) => k.blocks ?? []),
  }));
}

/**
 * 把上面几步串起来：块 → 树。
 *
 * 这是 `buildTree` 之外的**第二条**入口：它从"已打标的块"出发，
 * 走完筛 → 挂 → 审 → 合 → 拆 → 聚，交出一棵可用的树。
 * 与 `dsh-zhiyun-core-lecture` 的 `buildLectureTree`（从**页面文字**出发、
 * 认页眉认标题）是互补的两条路，不重复。
 */
/**
 * 07 重构 · **分级聚合**：把平铺的知识点收成一棵**带标题层级**的树。
 *
 * # 图规定的是什么
 *
 * 图里这一步是「分级聚合 R1 → R2 → … → 收敛到根」，并且明确写着：
 * **"实际聚几轮、每轮聚成几组由分级 LLM 按内容自行决定，层数不是常量"**。
 *
 * 所以这里的分工是：
 *   · **结构**由本函数负责（怎么分组、层数怎么来、树的形状），
 *   · **语义**由调用方注入的 `group` 决定（哪些点该并成一章）。
 *
 * 默认实现是**机械分组**：按顺序每 `perNode` 个并成一个父节点，层数由
 * 数量自然推出。它绝不假装懂语义 —— 名字直接写"第 N 组"，不编造标题。
 * 需要真实语义时，调用方传 `group`（同步纯函数，便于测试）或
 * `groupAsync`（可发模型调用）即可，树的其他部分不用改。
 *
 * # 为什么要改成树
 *
 * 早先 `buildTreeFromBlocks()` 直接把 `knowledgePoints` 当 `tree` 交出去 ——
 * 那是一排**没有父子关系的平铺叶**。图里的树是「title 节点只有名字、
 * leaf 节点只有正文」，讲义要按层级走。平铺数组满足不了任何一种用法。
 *
 * @param {Array} points 知识点叶（`{ id, tok, blocks, ... }`）。
 * @param {object} [options]
 * @param {number} [options.perNode] 每个父节点收几个子（默认 4）。
 * @param {number} [options.maxDepth] 最多聚合几层（默认 4）。
 * @param {(children:Array)=>Array<{title:string, children:Array}>} [options.group]
 *   自定义分组：给定一组子节点，返回若干 `{ title, children }`。
 *   返回空数组表示"这一层不再聚合"（直接作为根的子节点）。
 * @returns {{root:object, chapters:Array, rounds:number, depth:number}}
 */
export function aggregateTree(points, { perNode = 4, maxDepth = 4, group = null } = {}) {
  if (!points.length) return { root: makeTitle('本节'), chapters: [], rounds: 0, depth: 0 };

  /* 叶子包装成 title（图里内容只在 leaf 上，名字在父节点）。
   * 每个知识点叶自带标题时用它，没有就用序号 —— 不编造。 */
  let level = points.map((point, i) => makeTitle(
    String(point.title ?? '').trim() || point.id || `知识点 ${i + 1}`,
    [{ kind: 'leaf', id: point.id ?? `n${i}`, tok: point.tok ?? 0, blocks: point.blocks ?? [],
      merged: point.merged ?? 1, fromAttach: Boolean(point.fromAttach),
      attachFacet: point.attachFacet ?? null }],
  ));

  let rounds = 0;
  let depth = 1;

  while (level.length > 1 && rounds < maxDepth) {
    const grouped = group ? group(level) : null;
    if (grouped && grouped.length) {
      level = grouped.map((g) => makeTitle(g.title, g.children));
    } else if (!group && level.length > perNode) {
      /* 机械分组：每 perNode 个并成一个父节点。名字如实写"第 N 组"。 */
      const next = [];
      for (let i = 0; i < level.length; i += perNode) {
        const chunk = level.slice(i, i + perNode);
        next.push(makeTitle(`第 ${next.length + 1} 组`, chunk));
      }
      level = next;
    } else {
      break;
    }
    rounds += 1;
    depth += 1;
  }

  /* 收成根：还有多个顶层节点时，加一个根把它们收起来。 */
  const root = level.length === 1 ? level[0] : makeTitle('本节', level);
  const chapters = root.children ?? level;
  return { root, chapters, rounds, depth: leafTreeDepthOf(root) };
}

/** 造一个 title 节点（只有名字，不承载正文）。 */
export function makeTitle(title, children = []) {
  return { kind: 'title', title: String(title ?? ''), children };
}

/** 树的最大层数（title 与 leaf 都算）。 */
function leafTreeDepthOf(node) {
  const kids = node.children ?? [];
  if (!kids.length) return 1;
  return 1 + Math.max(...kids.map(leafTreeDepthOf));
}

/** 树里所有叶（保持顺序）。 */
export function leavesOf(node, out = []) {
  for (const child of node.children ?? []) {
    if (child.kind === 'leaf') out.push(child);
    else leavesOf(child, out);
  }
  return out;
}

/** 树里所有 title 节点（保持顺序，含根）。 */
export function titlesOf(node, out = []) {
  if (node.kind === 'title') out.push(node);
  for (const child of node.children ?? []) if (child.kind === 'title') titlesOf(child, out);
  return out;
}

export function buildTreeFromBlocks(blocks, {
  splitLine = kDefaultSplitLine,
  organize = null,
  semanticPlan = null,
  /* 分级聚合的注入点：`group(children) -> [{title, children}]`。
   * 不传就机械分组（图允许层数由内容决定，机械分组是最保守的下界）。 */
  group = null,
  perNode = 4,
  maxDepth = 4,
} = {}) {
  /* ── ① 筛支线 ───────────────────────────────────────────────── */
  const sieved = sieveBlocks(blocks);

  /* ── ② 挂账 ─────────────────────────────────────────────────── */
  // Route before organization so each request sees a complete semantic context.
  const stashed = semanticPlan ? semanticPlan.flatMap(chapter => chapter.topics.map(topic => {
    const owned = sieved.main.filter(b => topic.from <= b.index && b.index <= topic.to);
    const parts = stashBlocks(owned);
    return { page: owned[0]?.page ?? null, blocks: owned,
      pendingTok: parts.reduce((n, p) => n + p.pendingTok, 0), pendingB: parts.reduce((n,p) => n + p.pendingB, 0),
      attach: parts.flatMap(p => p.attach), semanticTitle: topic.title };
  })) : stashBlocks(sieved.main);
  if (semanticPlan && sieved.main.some(b => !topicOfBlock(semanticPlan, b.index))) {
    throw new Error('语义知识树未覆盖全部主线块');
  }
  const leaves = stashed.map((leaf, i) => ({ ...leaf, id: semanticPlan ? `semantic-${i}` : `p${leaf.page ?? i}` }));

  /* ── ③ 正交审查 ───────────────────────────────────────────────
   *
   * 图里的审查对象是"**直接连叶**的同名标题"。我们这一层还只有叶、
   * 没有标题，所以审查按"**同一页的叶**"做：同页的叶本来就是同一次
   * 讲授的一部分，先按页并成一片，避免同一页被切成多个知识点。
   *
   * 这与图完全一致：图审查的是语义重复，我们这里页是产品自带的天然边界。
   * `orthogonalize()` 保留给"已经有标题节点"的场合（见 `aggregateTree` 之后）。
   */
  const ortho = semanticPlan ? { leaves, merges: [] } : orthogonalizePoints(leaves);
  const reviewed = ortho.leaves;

  /* ★ **挂账快照**：在 merge 之前留一份。
   *
   * 为什么必须在这里留：`mergeLeaf` 会把 `pendingTok` 清零（内容已并入叶树）。
   * 之后任何"读 leafTrees 的 pendingTok"都只能读到 0 —— 那不是挂账时的量。
   *
   * 基准回放要展示"挂账那一刻每片叶背了多少 token"，就得靠这份快照。
   * 只留数字，不留块引用：块会随后被切分，引用会失效。
   */
  const stashSnapshot = reviewed.map((leaf) => ({
    page: leaf.page ?? null,
    blocks: (leaf.blocks ?? []).length,
    pendingTok: leaf.pendingTok ?? 0,
    pendingB: leaf.pendingB ?? 0,
    attachCount: (leaf.attach ?? []).length,
  }));

  /* ── ④ 并发真 merge（叶之间互不重叠，无需加锁）───────────────── */
  const finish = (merged) => {

  /* ── ⑤ 拆叶（摊平）───────────────────────────────────────────── */
  const { flat, stats } = flattenLeaves(reviewed);

  /* ── ⑥ 重聚成知识点叶 ───────────────────────────────────────── */
  const semanticChapters = [];
  const knowledgePoints = semanticPlan ? semanticPlan.flatMap((chapter, ci) => {
    const topicNodes = [];
    const points = chapter.topics.flatMap((topic, ti) => {
      const pieces = flat.map(leaf => ({ ...leaf, blocks: (leaf.blocks ?? []).filter(b => topic.from <= b.index && b.index <= topic.to) }))
        .filter(leaf => leaf.blocks.length).map(leaf => ({ ...leaf, tok: leaf.blocks.reduce((n,b) => n + tokensOf(textOfBlock(b)), 0) }));
      /* 叶子上**不再重复知识点名**：名字属于父级 title 节点，叶子只承载正文。
       * 早先这里给每个知识点叶也写了 `title: topic.title`，于是树里每个知识点
       * 下面都挂着一个同名子节点 —— 看上去就像"只有一级标题"。 */
      const items = regroupLeaves(pieces, { splitLine }).map((point, i) => ({...point, id:`s${ci}t${ti}p${i}`}));
      topicNodes.push({ ...makeTitle(topic.title, items), semanticTopic: true });
      return items;
    });
    semanticChapters.push(makeTitle(chapter.title, topicNodes));
    return points;
  }) : regroupLeaves(flat, { splitLine });

  /* ── ⑦ 分级聚合 → **带标题层级的树** ──────────────────────────
   *
   * 这一步是图里"重构"的终点。早先它被整个跳过，`tree` 直接等于
   * `knowledgePoints`（一排平铺叶，没有父子关系）—— 讲义因此没法按层级走。
   */
  const aggregation = semanticPlan
    ? { root: makeTitle('本节', semanticChapters), chapters: semanticChapters, rounds: 1, depth: 4 }
    : aggregateTree(knowledgePoints, { group, perNode, maxDepth });

  /* 知识点叶上补回标题：聚合时用的是 `point.title`，没有就保持空。
   * 这里不改内容，只在叶上留一个**可追溯**的名字来源。 */
  for (const leaf of leavesOf(aggregation.root)) {
    if (!leaf.title) leaf.title = '';
  }

  return {
    board: sieved.board,
    leaves: reviewed,
    /** 挂账时的叶状态（merge 之前）。回放要的是它，不是清零后的 leaves。 */
    stashSnapshot,
    flat,
    knowledgePoints,
    /* ★ 真正的树：`title` 节点只有名字，`leaf` 节点只有正文。 */
    tree: aggregation.root,
    chapters: aggregation.chapters,
    merge: merged,
    orthogonal: ortho.merges,
    stats: {
      ...sieved.stats, ...stats,
      knowledgePoints: knowledgePoints.length,
      semanticTopics: semanticPlan ? semanticPlan.reduce((n,c) => n + c.topics.length, 0) : null,
      leafTrees: merged.filter((m) => m.result.split).length,
      orthoMerges: ortho.merges.length,
      aggregateRounds: aggregation.rounds,
      treeDepth: aggregation.depth,
    },
  };
  };
  if (organize) {
    return Promise.all(reviewed.map(async leaf => {
      const before = (leaf.blocks ?? []).map(textOfBlock).join('\n');
      await organize(leaf);
      const organized = (leaf.blocks ?? []).every(b => b.register === 'written');
      leaf.pendingTok = bodyBlocksOf(leaf).reduce((sum, b) => sum + tokensOf(textOfBlock(b)), 0);
      for (const item of leaf.attach ?? []) item.tok = tokensOf(textOfBlock(item.block));
      const result = mergeLeaf(leaf, { splitLine });
      result.before = before;
      result.organized = organized;
      return { leaf, result };
    })).then(finish);
  }
  return finish(reviewed.map(leaf => ({ leaf, result: mergeLeaf(leaf, { splitLine }) })));
}

/**
 * 正交审查（叶这一层）：把**同一页**的叶并成一片。
 *
 * 返回 `{ leaves, merges }`：`merges` 记录并了谁、吸收了多少 token，
 * 与图里 `planOrtho()` 的形状保持一致（`keepId` / `dropIds` / `absorbedTokens`）。
 *
 * 为什么按页：这一层还没有标题，没有"同名"可审；页是产品自带的边界
 *（一页 = 一次板书），同页的叶本质上是**同一处讲解被切碎的段**。
 * 跨页合并需要语义判断，那属于 `group` 注入点，不在这里做。
 */
export function orthogonalizePoints(leaves) {
  const byPage = new Map();
  const merges = [];
  for (const leaf of leaves) {
    const key = leaf.page == null ? `\u0000${leaf.id}` : String(leaf.page);
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(leaf);
  }

  const out = [];
  for (const [key, group] of byPage) {
    if (group.length === 1) { out.push(group[0]); continue; }
    const [keep, ...drop] = group;
    /* 并进去：正文块接在 keep 后面，pending 累加。 */
    keep.blocks = group.flatMap((leaf) => leaf.blocks ?? []);
    keep.pendingTok = group.reduce((a, leaf) => a + (leaf.pendingTok ?? 0), 0);
    keep.pendingB = group.reduce((a, leaf) => a + (leaf.pendingB ?? 0), 0);
    keep.attach = group.flatMap((leaf) => leaf.attach ?? []);
    merges.push({
      key: `page:${key}`,
      keepId: keep.id,
      dropIds: drop.map((leaf) => leaf.id),
      absorbedTokens: drop.reduce((a, leaf) => a + (leaf.pendingTok ?? 0), 0),
      absorbedBlocks: drop.reduce((a, leaf) => a + (leaf.pendingB ?? 0), 0),
    });
    out.push(keep);
  }
  return { leaves: out, merges };
}
