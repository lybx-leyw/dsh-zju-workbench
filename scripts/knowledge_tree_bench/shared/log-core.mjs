/**
 * 基准的**日志契约与折叠逻辑**（纯函数，无 node 依赖）。
 *
 * 这个文件被**两个运行时**共用：
 *   · Node —— `log.mjs`（runner 写入日志时用它）
 *   · 浏览器 —— `ui/demo/player.mjs`（演示页读日志后用它还原状态）
 *
 * 所以它**不许** import 任何 node 内置模块。写盘/读盘在 `log.mjs` 里。
 *
 * 共用是刻意的：如果前端自己再实现一遍 `fold()`，两边对同一份日志算出的
 * 状态就可能不一致 —— 表现是"服务端说 30 个知识点、页面画出 29 个"，
 * 而两边看起来都没错。一份逻辑、两个运行时，是这类问题的唯一可靠解法。
 */


/** 日志格式版本。改了 `data` 的形状就要升它，老日志据此提示"读不懂"。 */
export const LOG_VERSION = 1;

/**
 * 基准自己的阶段划分（**与演示页的导轨无关**）。
 *
 * 早先我拿演示的 7 段去套真实链路，`mark` 被算成第 3 段、`sieve` 算成第 1 段，
 * 两边语义对不上，导轨就乱跳。这里按**产品真实的处理顺序**定，日志与渲染都以它为准。
 */
export const PHASES = Object.freeze([
  /* `media` 是"这一页原图已存盘"的副作用事件，属于识别阶段。 */
  { no: '01', key: 'vision', name: '识别与标记', acts: ['vision', 'mix', 'media'] },
  { no: '02', key: 'mark', name: '编号汇总', acts: ['mark', 'bind'] },
  { no: '03', key: 'sieve', name: '筛支线', acts: ['sieve'] },
  { no: '04', key: 'stash', name: '挂账', acts: ['stash'] },
  { no: '05', key: 'merge', name: '审查与正式组织', acts: ['merge', 'organize'] },
  { no: '06', key: 'regroup', name: '重构', acts: ['regroup'] },
  { no: '07', key: 'lecture', name: '习坎', acts: ['chapter', 'lecture'] },
  { no: '08', key: 'polish', name: '终稿', acts: ['polish'] },
]);

/** act → 所在阶段。查不到就是 `null`（未知动作，日志里如实留着，不猜）。 */
const PHASE_OF_ACT = new Map();
for (const phase of PHASES) for (const act of phase.acts) PHASE_OF_ACT.set(act, phase);

export const phaseOf = (act) => PHASE_OF_ACT.get(act) ?? null;

/* ── 折叠：日志 → 某一刻的状态 ──────────────────────────────────── */

/**
 * 把事件折成**某一刻的完整状态**。
 *
 * @param {Array} records   `readLog()` 出来的记录。
 * @param {number} [upto]   折叠到第几个 `seq`（含）。省略 = 全部。
 * @returns 状态对象（见下）。**纯函数式地重建**，不依赖任何全局变量。
 *
 * 状态形状（动画与追查都读它）：
 * ```
 * {
 *   section, config,
 *   pages:   Map(page -> { page, vision:{...}, mix:{...} })
 *   blocks:  Map(index -> { index, page, role, facets, summary, chars, unanchored })
 *   board:   [ { page, index, why, summary } ]
 *   leaves:  [ { page, blocks, pendingTok } ]
 *   merges:  [ { split, parts, deep } ]
 *   points:  [ { id, tok, merged, pages, chars, title } ]
 *   chapters:[ { title, topics: [ { title, chars, blocks, covered } ] } ]
 *   polish:  { unchanged, changes, chars } | null
 *   counters:{ vision, mix, mark, sieve, stash, merge, regroup, lecture, polish }
 *   queue:   [ { t, depth } ]        // 队列深度时间线（从 vision/mix 到达顺序推）
 *   lastT,
 *   phase:   '01' | … | '08' | null  // 最后一个事件所在阶段
 * }
 * ```
 */
export function fold(records, upto = Infinity) {
  const state = {
    section: null,
    config: null,
    scope: null,
    pages: new Map(),
    blocks: new Map(),
    board: [],
    leaves: [],
    merges: [],
    organizations: [],
    points: [],
    chapters: [],
    polish: null,
    counters: { vision: 0, mix: 0, mark: 0, bind: 0, organize: 0, sieve: 0, stash: 0, merge: 0, regroup: 0, chapter: 0, lecture: 0, polish: 0 },
    queue: [],
    lastT: 0,
    phase: null,
    /* 实时事件数 / 事后补发事件数。 */
    live: 0, deferred: 0,
    errors: [],
  };

  for (const record of records) {
    if (Number.isFinite(upto) && record.seq > upto) break;
    if (record.kind === 'meta') { applyMeta(state, record); continue; }
    if (record.kind !== 'event') continue;
    applyEvent(state, record);
  }
  return state;
}

function applyMeta(state, record) {
  if (record.what === 'start') {
    state.section = record.section ?? null;
    state.config = record.config ?? null;
    /* 真实数据范围：界面必须显示"到底跑了哪些页、哪段时间"，
     * 不能只说"整节"。 */
    state.scope = record.scope ?? null;
  }
  if (record.what === 'error') state.errors.push({ code: record.code, message: record.message });
}

function applyEvent(state, record) {
  const { act, subject, data = {}, t } = record;
  if (Number.isFinite(t)) state.lastT = t;

  const phase = phaseOf(act);
  if (phase) state.phase = phase.no;
  /* 记录事件是**实时**还是**事后补发** —— 界面必须能区分，
   * 否则会把"补发顺序"当成"执行顺序"（审查第 10 条）。 */
  if (data.deferred) state.deferred += 1; else state.live += 1;
  if (act in state.counters) state.counters[act] += 1;

  switch (act) {
    case 'vision': {
      const page = getPage(state, subject);
      page.vision = {
        chars: data.chars ?? 0, hasText: Boolean(data.hasText), failure: data.failure ?? null,
        /* 转录正文：验收"识别读对没有"的证据。 */
        text: data.text ?? '', textTotal: data.textTotal ?? data.chars ?? 0,
      };
      /* ★ 队列深度：**产品上报的真实长度优先**。
       *
       * 审查第 11 条：早先只用"vision 完成数 − mix 完成数"推算 —— 那不是
       * 队列长度（包含正在 mix 的、也可能漏掉还没入队的），不能验收容量与背压。
       *
       * 现在：产品给了 `queueDepth` 就用它（标 `measured: true`）；
       * 没给才退回推算，并**明确标成 `measured: false`**，
       * 让界面能区分"实测"与"估算"，而不是混为一谈。
       */
      const measured = Number.isFinite(data.queueDepth);
      state.queue.push({
        t: Number.isFinite(t) ? t : 0,
        depth: measured ? data.queueDepth : Math.max(0, state.counters.vision - state.counters.mix),
        measured,
      });
      break;
    }
    case 'mix': {
      const page = getPage(state, subject);
      page.mix = {
        blocks: data.blocks ?? 0, lines: data.lines ?? 0, chars: data.chars ?? 0,
        skipped: data.skipped ?? null, failure: data.failure ?? null,
        /* 原字幕 vs 清洗稿：验收"清洗做对没有"的证据。 */
        rawText: data.rawText ?? '', mixedText: data.mixedText ?? '',
        tags: data.tags ?? [],
      };
      for (const entry of data.tags ?? []) {
        if (!entry.tag) continue;
        const id = `p${subject}b${entry.localIndex}`;
        state.blocks.set(id, { ...entry.tag, index: id, page: subject, chars: 0, provisional: true });
      }
      /* 不用再统计队列深度：项被取走时产品就把它移出队列了，
       * 深度变化体现在 vision 侧上报的 `queueDepth` 上。 */
      break;
    }
    case 'media': {
      /* 这一页的原图存盘了 —— 界面可以按需加载来对照。 */
      const page = getPage(state, subject);
      page.media = { name: data.name ?? null, bytes: data.bytes ?? 0 };
      break;
    }
    case 'bind':
    case 'mark': {
      if (data.mixLocalIndex != null) state.blocks.delete(`p${data.page}b${data.mixLocalIndex}`);
      state.blocks.set(subject, {
        index: subject, page: data.page ?? null,
        role: data.role ?? null, facets: data.facets ?? [], summary: data.summary ?? '',
        chars: data.chars ?? 0, unanchored: Boolean(data.fromUnanchored),
      });
      break;
    }
    case 'sieve':
      state.board.push({ page: data.page ?? null, index: subject, why: data.why ?? '', summary: data.summary ?? '' });
      break;
    case 'stash':
      state.leaves.push({
        page: data.page ?? null, blocks: data.blocks ?? 0, pendingTok: data.pendingTok ?? 0,
        /* 这个数是不是挂账时的快照？false 表示它是清零后的残留，不可信。 */
        fromSnapshot: data.fromSnapshot !== false,
      });
      break;
    case 'organize':
      state.organizations.push({ leaf: subject, ...data });
      break;
    case 'merge':
      /* ⚠️ `overLine` / `tookTok` 必须一起存。
       *
       * 没有它们，界面就只能靠 `split` 反推状态，于是把"切不开"（超线但失败）
       * 显示成"未超线"（正常）—— 审查第 4 条。 */
      state.merges.push({
        split: Boolean(data.split), parts: data.parts ?? 0, deep: data.deep ?? 0,
        tookTok: data.tookTok ?? null,
        overLine: typeof data.overLine === 'boolean' ? data.overLine : null,
        /* 合并前后正文：界面要能对照"改了什么"。 */
        before: data.before ?? '', after: data.after ?? '',
        attachMade: data.attachMade ?? 0, depth: data.depth ?? 0,
      });
      break;
    case 'regroup':
      state.points.push({
        id: subject, tok: data.tok ?? 0, merged: data.merged ?? 1,
        pages: data.pages ?? [], chars: data.chars ?? 0, title: data.title ?? '',
        /* ★ 来源追踪（审查第 17 条）：这个知识点由哪些块组成。
         * 没有它，架构验收里的"主线覆盖 / 块不重复 / 依附有宿主"三条
         * 全都无法判定 —— 只能数数量，不能验正确性。 */
        blockIds: data.blockIds ?? [],
        spans: data.spans ?? [],
        attachIds: data.attachIds ?? [],
        mergedFrom: data.mergedFrom ?? data.merged ?? 1,
      });
      break;
    case 'chapter':
      state.chapters.push({ title: data.title ?? '', chars: data.chars ?? 0, topics: [] });
      break;
    case 'lecture': {
      if (!state.chapters.length) state.chapters.push({ title: data.chapter ?? '', chars: 0, topics: [] });
      state.chapters.at(-1).topics.push({
        title: data.title ?? '', chars: data.chars ?? 0,
        blocks: data.blocks ?? 0, covered: Boolean(data.covered),
        /* ★ 正文与来源：探针要能读到字，能追到块。 */
        text: data.text ?? '',
        blockIndexes: data.blockIndexes ?? [],
        bodySource: data.bodySource ?? null,
      });
      break;
    }
    case 'polish':
      state.polish = {
        unchanged: Boolean(data.unchanged), changes: data.changes ?? 0,
        chars: data.chars ?? 0, failed: Boolean(data.failed), message: data.message ?? null,
        /* ★ 润色后的全文 + 改动清单：验收"有没有改坏"的证据。 */
        text: data.text ?? '',
        changeList: data.changeList ?? [],
      };
      break;
    default:
      break;
  }
}

function getPage(state, page) {
  if (!state.pages.has(page)) state.pages.set(page, { page, vision: null, mix: null });
  return state.pages.get(page);
}


/* ── 追查：某一阶段的完整产物 ──────────────────────────────────── */

/**
 * 取某一阶段的**完整产物**。
 *
 * 这是"追查"的入口：点第 N 段，看到的就是这一段的成品，而不是增量。
 * 与 `fold()` 共用同一份事件，所以两者永远不会说法不一。
 */
export function artifactOf(state, phaseKey) {
  switch (phaseKey) {
    case 'vision':
      return {
        pages: [...state.pages.values()].map((p) => ({
          page: p.page,
          chars: p.vision?.chars ?? 0,
          hasText: Boolean(p.vision?.hasText),
          /* ⚠️ 两个 failure 要**分开**报，不能合成一个。
           *
           * 早先这里只取 `p.vision?.failure` —— 于是"识别成功、混合失败"的页
           * 在产物里 `failure` 是 null，界面据此显示「已混」。
           * 那正是审查报告第 3 条：mix 失败的页被画成成功。
           *
           * 现在分别给出，让界面能区分"识别失败"、"混合失败"、"都成功"。 */
          text: p.vision?.text ?? '',
          textTotal: p.vision?.textTotal ?? p.vision?.chars ?? 0,
          rawText: p.mix?.rawText ?? '',
          mixedText: p.mix?.mixedText ?? '',
          visionFailure: p.vision?.failure ?? null,
          mixFailure: p.mix?.failure ?? null,
          mixSkipped: p.mix?.skipped ?? null,
          /* `failure` 保留为"这一页有没有出问题"的合并视图（任一失败即非空），
           * 兼容旧调用方；新界面应当用上面两个细分字段。 */
          failure: p.vision?.failure ?? p.mix?.failure ?? p.mix?.skipped ?? null,
          blocks: p.mix?.blocks ?? 0,
          lines: p.mix?.lines ?? 0,
          skipped: p.mix?.skipped ?? null,
          /* ★ 原图信息（审查第 15 条）：界面据此给"看原图"入口。
           * 没有存就不要给按钮 —— 不假装有。 */
          media: p.media ?? null,
        })),
        queue: state.queue,
      };
    case 'mark':
      return {
        blocks: [...state.blocks.values()],
        counts: {
          total: state.blocks.size,
          main: [...state.blocks.values()].filter((b) => b.role === '主线').length,
          side: [...state.blocks.values()].filter((b) => b.role === '支线').length,
          unlabeled: [...state.blocks.values()].filter((b) => !b.role).length,
          unanchored: [...state.blocks.values()].filter((b) => b.unanchored).length,
        },
      };
    case 'sieve':
      return { board: state.board };
    case 'stash':
      return { leaves: state.leaves };
    case 'merge':
      return { merges: state.merges, organizations: state.organizations };
    case 'regroup':
      return { points: state.points };
    case 'lecture':
      return { chapters: state.chapters };
    case 'polish':
      return { polish: state.polish };
    default:
      return null;
  }
}

/** 全部阶段的产物（给"导出/对照"用）。 */
export function artifacts(state) {
  const out = {};
  for (const phase of PHASES) out[phase.key] = artifactOf(state, phase.key);
  return out;
}

/* ── 概览 ───────────────────────────────────────────────────────── */

/** 一份日志的概览（给运行列表用，不必读全量事件）。 */
export function summarize(records) {
  const start = records.find((r) => r.kind === 'meta' && r.what === 'start');
  const end = records.find((r) => r.kind === 'meta' && r.what === 'end');
  const events = records.filter((r) => r.kind === 'event');
  const perPhase = {};
  for (const phase of PHASES) perPhase[phase.key] = 0;
  for (const e of events) {
    const phase = phaseOf(e.act);
    if (phase) perPhase[phase.key] += 1;
  }
  return {
    section: start?.section ?? null,
    title: start?.title ?? null,
    startedAt: start?.at ?? null,
    /* ★ 历史列表要能**对比参数**（审查第 31 条）：
     * 没有 config，用户只能看到"跑过"，看不出"用多少斩杀线、什么模型跑的"。 */
    config: start?.config ?? null,
    scope: start?.scope ?? null,
    ms: end?.ms ?? (events.at(-1)?.t ?? null),
    events: events.length,
    perPhase,
    status: end?.status ?? null,
  };
}
