import { WorkerPoolLlm } from './worker-pool.js';
import { readFile } from 'node:fs/promises';
import { ParserError } from './errors.js';
import { ParserCache, Limiter, hash } from './cache.js';
import { anchor, pageGate, glossary, coverage, parseTags, sanitizeOutline } from './core.js';
import { mixRequest, transcriptMixRequest, legacyTranscriptMixRequest, outlineRequest } from './prompts.js';
import { transcribeSlides } from './vision.js';
import { normalizeVocabulary, seedVocabulary, ensureVocabularyStore, vocabularyLoadFailure } from './vocabulary.js';
import { normalizeAccel } from './accel.js';
import { runPipeline, PipelineScheduler } from './pipeline.js';
import { buildTreeFromBlocks, kDefaultSplitLine, sieveBlocks } from './tree.js';
import { parseSemanticPlan, findPlanIssues, describePlanIssues } from './semantic-plan.js';
// 注意：下面还有一条 `export { tokensOf, ... } from './tokenize.js'` —— 那是**转出**，
// 不会把 `tokensOf` 绑进本模块作用域。`splitUnanchored` 要用它算斩杀线，所以这里单独导入。
import { tokensOf } from './tokenize.js';
import { mixTaggingPrompt } from './mix.js';
import { organizeLeaf } from './organize.js';
import { blockCleanStatus, transcriptWindows, runMixUnit } from './mix-unit.js';
export { HarnessLlm, ParserError } from './llm.js';
export { ParserCache } from './cache.js';
export { SharedQueue, runPipeline, PipelineScheduler } from './pipeline.js';
export { STAGE, STAGE_NAME, STAGE_ORDER, stageNo } from './stages.js';
export {
  FACET, facetRole, kMaxLeafDepth,
  sieveBlocks, stashBlocks, orthogonalize, mergeLeaf, zipfRanges, leafTreeDepth,
  leafLevelNodes, flattenLeaves, regroupLeaves, aggregate, buildTreeFromBlocks,
} from './tree.js';
export { tokensOf, tokensOfAll, formatTokens } from './tokenize.js';
export { kDefaultSplitLine };

function validateInput(slides, subtitles) {
  if (!Array.isArray(slides) || !Array.isArray(subtitles)) throw new ParserError('INPUT', '解析需要课件与字幕列表');
  const pages = new Set();
  for (const slide of slides) {
    if (!Number.isInteger(slide.page) || slide.page < 1 || pages.has(slide.page)) throw new ParserError('INPUT', '课件页码重复或无效');
    pages.add(slide.page);
    if (slide.createdSec != null && (!Number.isFinite(slide.createdSec) || slide.createdSec < 0)) throw new ParserError('INPUT', '课件时间锚点无效');
  }
  for (const line of subtitles) if (typeof line.text !== 'string' || !Number.isFinite(line.startMs) || !Number.isFinite(line.endMs) || line.startMs < 0 || line.endMs < line.startMs) throw new ParserError('INPUT', '字幕时间区间或文本无效');
}
function blockOf(sentences, from, to, bridge, page) {
  return { index: 0, sentenceFrom: from, sentenceTo: to, page, sentences, bridge,
    startMs: sentences[0]?.startMs ?? null, endMs: sentences.length ? Math.max(...sentences.map(s => s.endMs)) : null,
    tag: { role: null, facets: [], summary: null } };
}

/**
 * Legacy mechanical slicing for display and conservation benchmarks.
 * Parsing uses transcriptWindows instead: input subtitle identities are never split.
 * This utility splits by pauses/token budget and preserves the original characters.
 */
export function splitUnanchored(sentences, { splitLine = kDefaultSplitLine, gapMs = 3000 } = {}) {
  if (!sentences.length) return [];
  const budget = Number.isFinite(splitLine) && splitLine >= 200 ? splitLine : kDefaultSplitLine;

  // ── ① 先按停顿断成语义段 ──────────────────────────────────
  const segments = [];
  let current = [];
  for (const line of sentences) {
    const prev = current.at(-1);
    // 停顿过久 = 换话题，断开（首条不判）
    if (prev && Number.isFinite(prev.endMs) && Number.isFinite(line.startMs) && line.startMs - prev.endMs >= gapMs) {
      segments.push(current); current = [];
    }
    current.push(line);
  }
  if (current.length) segments.push(current);

  // ── ② 段内按斩杀线切；超长单句在句末硬切 ──────────────────
  const out = [];
  for (const segment of segments) {
    let buf = [], bufTok = 0;
    const flush = () => { if (buf.length) { out.push(buf); buf = []; bufTok = 0; } };
    for (const line of segment) {
      const tok = tokensOf(line.text);
      // 单句自己就超线 → 先冲掉手上的，再把这一句按句末切开
      if (tok > budget) {
        flush();
        for (const piece of hardSplit(line, budget)) out.push([piece]);
        continue;
      }
      if (buf.length && bufTok + tok > budget) flush();
      buf.push(line); bufTok += tok;
    }
    flush();
  }
  return out.map(group => ({ sentences: group }));
}

/**
 * 把一句超长的字幕按**句末标点**切开（找不到标点才按字符数切）。
 *
 * 只切不改：拼回去必须与原文逐字相同。
 */
function hardSplit(line, budget) {
  const text = String(line.text ?? '');
  if (text.length <= budget) return [line];
  const pieces = [];
  let rest = text;
  while (rest.length > budget) {
    // 在预算附近往后找一个句末（最多再看 60 字），尽量不把一句话切两半
    const window = rest.slice(budget, Math.min(rest.length, budget + 60));
    const cut = window.search(/[。！？；;\n]/);
    const at = cut >= 0 ? budget + cut + 1 : budget;
    pieces.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) pieces.push(rest);
  // 每片带上原位的时间（按字数比例分摊，只用于排序与展示，不精确到句）
  const total = text.length || 1;
  let offset = 0;
  return pieces.map((piece) => {
    const from = offset, to = offset + piece.length;
    const ratioFrom = from / total, ratioTo = to / total;
    offset = to;
    const span = (Number.isFinite(line.startMs) && Number.isFinite(line.endMs)) ? line.endMs - line.startMs : 0;
    return {
      ...line, text: piece,
      startMs: Number.isFinite(line.startMs) ? Math.round(line.startMs + span * ratioFrom) : line.startMs,
      endMs: Number.isFinite(line.startMs) ? Math.round(line.startMs + span * ratioTo) : line.endMs,
    };
  });
}
export function stitch(blocks) {
  const merged = [];
  for (const b of blocks) {
    const previous = merged.at(-1);
    if (previous && previous.sentenceTo + 1 === b.sentenceFrom && previous.sentences.at(-1).page !== b.sentences[0].page
      && previous.sentences.at(-1).page != null && b.sentences[0].page != null && !previous.tag.role && !b.tag.role
      && !/转到|进入|离开/.test(b.bridge) && b.startMs - previous.endMs <= 15000) {
      previous.sentences.push(...b.sentences); previous.sentenceTo = b.sentenceTo; previous.endMs = Math.max(previous.endMs, b.endMs);
    } else merged.push({ ...b, sentences: [...b.sentences] });
  }
  return merged.map((b, index) => ({ ...b, index: index + 1 }));
}
/** 混合解析的重试轮数上限（与 Dart `maxMixParseRounds` 同值）。 */
export const maxMixParseRounds = 3;
/** 标注分卷的补发轮数与退避（与 Dart `tagChunkRetryRounds` / `tagChunkRetryDelay` 同口径）。 */
export const tagChunkRetryRounds = 2;
export const tagChunkRetryDelayMs = 2000;

/**
 * **某一阶段整体失败就中止整条链**。
 *
 * # 为什么"全败"必须抛而"部分败"不必
 *
 * 每一步都是**严格拓扑**的：没有转述稿就没法纠错，没有块就没法打标，
 * 没有概述就没法写整节主线。所以"这一步一个都没成"意味着**后面无从谈起** ——
 * 继续跑只会拿到一份下游无法解释的空结果。
 *
 * 而"一百页里两页坏"是真的部分完成：那两页会记进 `failures`，其余照常。
 *
 * # 为什么不做熔断 / 连续失败计数
 *
 * 重试之后仍然失败的，只可能是两种情况：
 *   ① **用户环境的问题**（Key 失效、模型下线、网关不通）——重跑就能接上，
 *      因为已经成功的部分都在缓存里；
 *   ② **我们自己的代码漏洞**（这个边界没考虑到）——那它会**一直**失败，
 *      该修代码，而不是在运行时靠"连续失败几次就放弃"把它盖过去。
 * 两种都不需要熔断器：①靠缓存 + 重跑，②靠修。加阈值只会让②更难被发现。
 *
 * @param stage - 阶段名（进错误码与诊断）。
 * @param failed - 这一阶段失败的条数。
 * @param total - 这一阶段的总条数。
 * @param code - 抛出的错误码。
 * @param hint - 给用户看的一句话（说清"该看哪儿"）。
 */
function abortWhenAllFailed(stage, failed, total, code, hint) {
  if (total > 0 && failed >= total) {
    throw new ParserError(code, `「${stage}」阶段整体失败（${failed}/${total}）：${hint}。`
      + '已成功的部分都在缓存里，环境恢复后重跑会从这里接上，不会重打。', { stage, failed, total });
  }
}

/** 可被取消的等待（退避用）。 */
function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) { resolve(); return; }
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
export class LectureParser {
  constructor({ llm, cache = new ParserCache(), concurrency = 3, visionBatchSize = 4, readImage, classroom,
                vocabularyStore = null, accel = null, splitLine = kDefaultSplitLine, queueCapacity = 32 } = {}) {
    if (!llm?.resolve || !llm?.call || !llm?.image) throw new ParserError('CONFIG', '请注入宿主 LLM 适配器');
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 512) throw new ParserError('CONFIG', '解析并发须为 1–512');
    if (!Number.isInteger(visionBatchSize) || visionBatchSize < 1 || visionBatchSize > 4) throw new ParserError('CONFIG', '课件拼图页数须为 1–4');
    if (!Number.isFinite(splitLine) || splitLine < 200) throw new ParserError('CONFIG', '斩杀线须为不小于 200 的 token 数');
    if (!Number.isInteger(queueCapacity) || queueCapacity < 1 || queueCapacity > 512) throw new ParserError('CONFIG', '队列上限须为 1–512');
    this.llm = llm; this.cache = cache; this.concurrency = concurrency; this.limiter = llm.managesConcurrency ? { run: (task, signal) => { signal?.throwIfAborted(); return task(); } } : new Limiter(concurrency);
    this.visionBatchSize = visionBatchSize;
    // ★ 斩杀线（token）：超过它的待整合内容不该直接堆进叶正文，而要长成叶树。
    this.splitLine = splitLine;
    // ★ 队列上限：vision 产得比 mix 快时，**产的那一侧等**（背压），而不是把内存吃满。
    this.queueCapacity = queueCapacity;
    this.readImage = readImage; this.classroom = classroom; this.controllers = new Set(); this.closed = false;
    // 归一在构造期做一次：写错的档位要在**开跑前**报出来（有名字的失败），
    // 而不是等某一次调用以一个看不懂的协议错误失败。
    const normalized = normalizeAccel(accel);
    this.accelIssues = normalized.issues;
    if ((Object.keys(normalized.stages).length || normalized.escalation) && !llm.acceptsAccel) {
      // 档位在注入的适配器里落点。适配器不认它（没有 `acceptsAccel` 标记）时
      // **如实报出来**：静默忽略会让用户以为降本生效了，而花的钱一分没少。
      this.accelIssues.push('注入的 llm 适配器不接收 accel（档位没有落点）：请注入 HarnessLlm 或让适配器声明 acceptsAccel');
    }
    this.vocabularyStore = ensureVocabularyStore(vocabularyStore);
    this.loadIssues = [];
  }
  /**
   * 取这一节要用的**种子**词表。
   *
   * 加载失败或文件损坏**不许**让解析失败：退回种子，并把原因同时记进
   * `warnings` 与解析器的 `loadIssues` —— 静默当成「这次没有新增词」会让用户
   * 永远查不出为什么词表停止生长（已产出的块仍带着各自的标签名，不受影响）。
   */
  async loadVocabulary(warnings) {
    const seed = seedVocabulary();
    const store = this.vocabularyStore;
    // 逐条去重只针对**本次解析的 warnings**；`loadIssues` 是累积的观察记录，
    // 同一次故障在第二次解析里仍然要如实报出来（否则第二次开始就静默了）。
    const record = reason => { if (warnings.includes(reason)) return; warnings.push(reason); this.loadIssues.push(reason); };
    if (!store) return seed;
    const before = Array.isArray(store.loadIssues) ? store.loadIssues.length : 0;
    try {
      const loaded = await store.load();
      const { vocabulary, issues: loadedIssues } = normalizeVocabulary(loaded);
      for (const reason of loadedIssues) record(reason);
      // 适配器自己观察到的问题也要浮上来（宿主 store 有自己的坏数据日志时）。
      if (Array.isArray(store.loadIssues) && store.loadIssues.length > before) {
        for (const reason of store.loadIssues.slice(before)) if (!this.loadIssues.includes(reason)) record(reason);
      }
      return vocabulary;
    } catch (error) {
      const reason = vocabularyLoadFailure(error);
      if (!this.loadIssues.includes(reason)) record(reason);
      return seed;
    }
  }
  /** 解析结束后写回词表；**只在真的有新增时写一次**（无新增不写，避免每次都动盘）。 */
  async saveVocabulary(vocabulary, added, warnings) {
    if (!this.vocabularyStore || !added.length) return;
    try { await this.vocabularyStore.save(vocabulary); }
    catch (error) {
      // 写盘失败**不是**解析失败：这一节的标签已经打在块上了。但要如实报出来，
      // 否则下次解析词表又回到旧的样子，而没人知道为什么。
      warnings.push(`词表写入失败（${error?.code ?? error?.name ?? 'ERROR'}：${error?.message ?? error}）：本节新增的标签这次没有被记住。`);
    }
  }
  async bytes(slide, signal) {
    if (slide.imageBytes) return { data: Buffer.from(slide.imageBytes), mediaType: slide.mediaType ?? 'image/jpeg' };
    if (this.readImage) return this.readImage(slide, signal);
    if (slide.imagePath) return { data: await readFile(slide.imagePath, { signal }), mediaType: slide.mediaType ?? (/\.png$/i.test(slide.imagePath) ? 'image/png' : 'image/jpeg') };
    if (slide.imageUrl && this.classroom) {
      const opened = await this.classroom.transport.request(slide.imageUrl, { signal, auth: false, stream: true });
      try {
        if (opened.response.status !== 200 || !opened.response.body) throw new ParserError('IMAGE', '课件图片读取失败');
        const chunks = []; let size = 0;
        for await (const chunk of opened.response.body) { size += chunk.length; if (size > 50 * 1024 * 1024) throw new ParserError('IMAGE', '课件图片超过大小限制'); chunks.push(chunk); }
        return { data: Buffer.concat(chunks), mediaType: opened.response.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg' };
      } finally { await opened.response.body.cancel().catch(() => {}); opened.release(); }
    }
    throw new ParserError('IMAGE', '这一页没有可读取的图片');
  }
  async request(stage, route, parts, image, signal, events, key, validate = () => true) {
    const cached = await this.cache.get(key);
    if (cached && validate(cached.raw)) { events.push({ stage, cached: true }); return { text: cached.raw, cached: true }; }
    const response = await this.limiter.run(() => this.llm.call({ stage, route, ...parts, image, signal }), signal);
    events.push({ stage, cached: false, usage: response.usage ?? null });
    return { ...response, cached: false };
  }
  /**
   * 解析一节课件。
   *
   * # 形状：一条**共享队列流水线**，不是两段串行
   *
   * ```
   *                 ┌──────────── 共享 FIFO（有上限，背压）────────────┐
   *   4 页拼图 → vision 产块 ─┐                                     ├─→ mix 逐块打标
   *   4 页拼图 → vision 产块 ─┼─→ [ 块, 块, 块, … ] ────────────────┘   （N 个 worker 共享）
   *   4 页拼图 → vision 产块 ─┘
   * ```
   *
   * 旧实现是「全部页 vision 完，再统一 mix」：vision 跑的时候 mix 的并发额度
   * 全空着，反过来也一样，总时长等于两段之和。现在只有一个队列和 N 个 worker，
   * **影响速度的有且只有一次性并发数**（`concurrency`）。
   *
   * # 产出
   *
   * `pages`（逐页 vision + mix 的原始产物）、`sentences`（句子层）、
   * `blocks`（块层，带 role/facet/summary）、`tree`（筛→挂→审→合→拆→聚 之后的树）、
   * `board`（大黑板：支线与元信息）、`knowledgePoints`（重聚后的知识点叶）。
   */
  async parse({ slides, subtitles, sourceId = null, context = sourceId ?? 'context', signal, onProgress = () => {} } = {}) {
    if (this.closed) throw new ParserError('DISPOSED', '解析器已关闭');
    validateInput(slides, subtitles);
    const controller = new AbortController(); this.controllers.add(controller);
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const events = [], failures = [], warnings = [], results = new Array(slides.length);
    const progress = { faithful: 0, mix: 0, merge: 0 };
    // 词表状态提到 try 外面：取消路径上也要能把它写回（见 catch）。
    const addedVocabulary = new Set();
    let vocabulary = null;
    try {
      combined.throwIfAborted();
      warnings.push(...this.accelIssues);
      // 种子**先加载**再开跑：它决定提示词里注入的清单，也决定所有分卷共享的
      // 那一份快照（词表在解析中途变化过，就是这个包最怕的静默不一致）。
      const seeded = await this.loadVocabulary(warnings);
      const anchored = anchor(slides, subtitles); warnings.push(...anchored.warnings);
      // Resolve the text route for transcript-only lessons as well.
      const routes = slides.length || subtitles.length ? await this.llm.resolve(combined, { vision: slides.length > 0 }) : null;
      const transcriptResults = [];
      const transcriptWork = transcriptWindows(anchored.unassigned);
      const mixTotal = slides.length + transcriptWork.length;
      if (slides.length) onProgress({ phase: 'faithful', done: 0, total: slides.length });
      if (mixTotal) onProgress({ phase: 'mix', done: 0, total: mixTotal });
      let nextTranscript = 0;
      const processTranscriptWorker = async () => {
        for (;;) {
          const index = nextTranscript++;
          if (index >= transcriptWork.length) return;
          const unit = transcriptWork[index];
          const parts = transcriptMixRequest({ ...unit, context });
          parts.constant += mixTaggingPrompt(seeded, {atomic:true});
          const legacyParts = legacyTranscriptMixRequest({...unit,context});
          legacyParts.constant += mixTaggingPrompt(seeded);
          const mixed = await runMixUnit({ ...unit, unitId: unit.id, parts, route: routes.text, llm: this.llm, cache: this.cache,
            limiter: this.limiter, vocabulary: seeded, signal: combined, events, maxRounds: 1, legacyParts });
          const result = { ...unit, ...mixed, page: null, transcription: null };
          transcriptResults[index] = result;
          if (mixed.failure) failures.push({ stage: 'mix', unitId: unit.id, page: null, code: mixed.failure });
          onProgress({phase: 'mix', done: ++progress.mix, total: mixTotal, detail: {unitId: unit.id, page: null,
            evidenceKind: unit.evidenceKind, blocks: mixed.drafts.length, lines: unit.lines.length,
            tags:mixed.drafts.map((d,i)=>({localIndex:i+1,sentenceFrom:d.sentenceFrom,sentenceTo:d.sentenceTo,tag:d.tag??null})),
            rawText: unit.lines.map(l => l.text).join('').slice(0,2000), mixedText: mixed.sentences.map(l => l.text).join('').slice(0,2000), failure: mixed.failure}});
        }
      };
      const processTranscripts = () => Promise.all(Array.from({length:Math.min(this.concurrency,transcriptWork.length)}, processTranscriptWorker));

      // ══════════════════════════════════════════════════════════
      // ① vision ‖ mix：共享队列流水线
      // ══════════════════════════════════════════════════════════
      //
      // 生产者跑 vision（每批 4 页拼一张图，逐页出结果），把**页**推进队列；
      // 消费者从队列里取**页**做 mix。
      //
      // ⚠️ 队列里放的是"页"而不是"批"。放批的话，消费者要等这一批 vision
      //    **全部**做完才能开工，那还是串行（只是换了个说法）。放页才是真流水线：
      //    vision 出第一页，mix 立刻开始吃，两边时间窗真正重叠。
      const batches = [];
      for (let start = 0; start < slides.length; start += this.visionBatchSize) {
        batches.push({ start, group: slides.slice(start, start + this.visionBatchSize) });
      }
      /* ★ **调度器**：管"谁在什么时候拿到工作"。
       *
       * 图 `queue-pipeline.html` 规定的是**一条跨课程共享的 FIFO**，
       * 背压要算在飞预留、生产要轮流喂课。这些判断全在 `PipelineScheduler` 里，
       * 这里只把它接到本次解析的课程上。
       *
       * 页面数就是这门课的"总量"；每认领一批就在调度器里当场记账，
       * 于是"已认领但还没 push"的页也被算进容量 —— 这是峰值不冲破上限的关键。
       */
      const scheduler = new PipelineScheduler({
        queue: null,                          // 真实的 queue 由 runPipeline 建好后再绑定
        capacity: this.queueCapacity,
        batchSize: this.visionBatchSize,
        workers: this.concurrency,
      });
      /* 课程标识用 `sourceId`（解析入口已有），不是外部传进来的什么 key。
       * 总量按**页数**算：批次向上取整可能多算，所以用 slides.length 而不是
       * batches.length × batchSize —— 后者会把最后一页的余量算成空页。 */
      scheduler.addCourse(sourceId ?? 'this', slides.length);

      const pipelineTask = runPipeline({
        workers: this.concurrency,
        capacity: this.queueCapacity,
        signal: combined,
        /* 队列建好后把调度器接上（runPipeline 内部创建队列）。 */
        onQueue: (queue) => { scheduler.queue = queue; },
        produce: async (queue) => {
          /* 单页入队的 push promise 暂存区（见下方 onPage 回调）。 */
          const pendingPushes = [];
          // ★ 生产端也必须**并发**：串行地"做完一批推一批"会让 vision 调用
          //   一次只有一个在飞，全局并发额度白空着（用户看到的还是"慢慢跑"）。
          //   所以这里用同样的 worker 数跑生产，vision 的并发上限由 limiter 兜住。
          let next = 0;
          const worker = async () => {
            for (;;) {
              const b = next++;
              if (b >= batches.length) return;
              combined.throwIfAborted();
              const { start, group } = batches[b];
              /* ★ 每页**一读完就上报**，不是整批读完才报。
               *
               * `transcribeSlides` 是整批返回的；如果只在它返回后循环发事件，
               * 那批内每一页的完成时刻就丢了 —— 画面上会变成
               * 「先一串 vision、再一串 mix」（假串行）。
               *
               * 传 `onPage` 之后，事件在每页真的读完的那一刻发出，于是它会与
               * mix 的消费事件自然交错 —— 这才是两道工序并行的真实时序。
               */
              const transcriptions = await transcribeSlides(
                this, group, routes.vision, context, combined, events, warnings,
                /* ⚠️ `onPage` 收到的是 `{ index, page, transcription, imageFailure }` ——
                 * `transcription` **本身就是转述对象**（`{ raw, pageText, pageVisual, listedTerms }`），
                 * 不是 `{ transcription: {...} }` 那种包装。
                 * 早先多套了一层（`t.transcription.pageText`），于是每页都算成 0 字、
                 * 显示"识别失败"—— 而那其实只是缓存命中。 */
                ({ index, transcription, imageFailure, failureDetail }) => {
                  const slide = group[index];
                  if (!slide) return;
                  const text = transcription?.pageText ?? '';
                  onProgress({
                    phase: 'faithful', done: ++progress.faithful, total: slides.length,
                    detail: {
                      page: slide.page,
                      chars: text.length,
                      hasText: Boolean(text.trim()),
                      failure: imageFailure ?? null,
                      batchStart: start,
                      batchSize: group.length,
                      /* ★ **真实队列长度**（此刻还在队列里等消费的项数）。
                       *
                       * 审查第 11 条：基准回放早先用"vision 完成数 − mix 完成数"
                       * 推算队列深度 —— 那不是队列长度：它把正在 mix 的算成在队列里，
                       * 又可能包含还没入队的识别结果。用它验收容量/背压是错的。
                       *
                       * 这里是产品 `SharedQueue.length` 的原值，read-only 观测。
                       */
                      queueDepth: queue.length,
                      /* ★ **转录正文**本身。
                       *
                       * 审查第 15 条：早先只给字数。字数回答不了"公式识别对没对、
                       * 图上的字有没有读错"——验收识别质量必须能看到正文。
                       *
                       * 截前 2000 字：全量副本另有 `capture` 通道，
                       * 事件里放太多会把日志撑爆。
                       */
                      text: String(text ?? '').slice(0, 2000),
                      textTotal: String(text ?? '').length,
                    },
                  });
                  /* ★ **单页完成即入队**，不等整批。
                   *
                   * 图里的流水线是"识别出一页，队列立刻多一项，mix 马上能吃"。
                   * 早先只在 `transcribeSlides()` 返回后统一 push，于是：
                   *   · 某批里有一页要走单图补发时，**同批已成功的页也得等它**；
                   *   · "页面显示识别完成"与"下游真的可以处理"脱节。
                   * 这两件事在动画/日志里表现为"vision 全绿了 mix 才动"，
                   * 但真实链路不是那样的。
                   *
                   * 这里把 push 挪进回调：哪页读完就立刻把它交出去。
                   */
                  /* ⚠️ 这里要交出去的是**结果对象**，不是裸的 `transcription`。
                   *
                   * `transcribeSlides()` 的返回值形状是
                   *   `{ transcription, imageFailure }`
                   * （失败页是 `{ transcription: null, imageFailure: 'IMAGE' }`）。
                   * 而 `onPage` 回调把这两项**拆开**给了我们。早先直接把
                   * `transcription` 塞进队列，consume 侧解构 `imageFailure` 时就炸
                   * ——失败页尤其明显（`transcription` 是 null）。
                   *
                   * 所以在这里把形状装回去，保持与整批返回时**完全一致**。
                   */
                  /* ⚠️ `failureDetail` 必须一起带 —— 上层报错时要拿它当"服务端原文"。
                   * 早先只装 `{ transcription, imageFailure }`，于是
                   * `VISION_ALL_FAILED` 那句"服务端原文：…"永远是空的，
                   * 用户看到的错误就退化成一句没有依据的猜测。 */
                  const result = {
                    transcription,
                    imageFailure: imageFailure ?? null,
                    failureDetail: failureDetail ?? null,
                  };
                  pendingPushes.push(
                    queue.push({ slide, index: start + index, transcription: result })
                      .finally(() => scheduler.settle(1)),
                  );
                },
              );
              /* 这一批可能还有成功页在补发路径外 —— 上面回调已经逐页交出去了，
               * 这里只需把本批的 push 全部落定，避免下一批在背压上误判。 */
              await Promise.all(pendingPushes.splice(0));
            }
          };
          await Promise.all(Array.from({ length: Math.min(this.concurrency, batches.length) }, worker));
        },
        consume: async (item) => {
          combined.throwIfAborted();
          const { slide, index: i, transcription } = item;
          const window = anchored.windows[i];
          const { imageFailure } = transcription;
          let mixed;
          if (imageFailure && window.lines.length) failures.push({page:slide.page,stage:'faithful',code:imageFailure});
          if (imageFailure && !window.lines.length) {
            // Neither slide evidence nor a transcript exists: no mix call can help.
            failures.push({page:slide.page,stage:'faithful',code:imageFailure});
            results[i] = {page:slide.page,createdSec:slide.createdSec??null,fromMs:window.fromMs,toMs:window.toMs,
              transcription:transcription.transcription,gate:pageGate(transcription.transcription),sentences:[],rejected:[],bridges:[],
              drafts:[],coverage:coverage([],0),raw:'',failure:imageFailure,failureDetail:transcription.failureDetail??null};
            onProgress({phase:'mix',done:++progress.mix,total:mixTotal,detail:{page:slide.page,skipped:'no-evidence-or-transcript',blocks:0,lines:0,rawText:'',mixedText:''}});
            return;
          }
          const terms = glossary([{ page: slide.page, ...(transcription.transcription ?? { pageText: '', listedTerms: '' }) }], 1, false).terms.map(t => t.text);
          const parts = imageFailure
            ? transcriptMixRequest({ ...window, context })
            : mixRequest({ page: slide.page, lines: window.lines, fromMs: window.fromMs, toMs: window.toMs, faithfulText: transcription.transcription?.raw ?? '', terms, context });
          parts.constant += mixTaggingPrompt(seeded,{atomic:Boolean(imageFailure)});
          mixed = await runMixUnit({ lines: window.lines, page: slide.page, unitId: 'page:' + slide.page, parts,
            route: routes.text, llm: this.llm, cache: this.cache, limiter: this.limiter,
            vocabulary: seeded, signal: combined, events, maxRounds: maxMixParseRounds, legacyCache: true });
          const mixedRaw = mixed.raw, mixFailure = mixed.failure;
          if (mixFailure === 'BLOCK_COVERAGE') warnings.push(`第 ${slide.page} 页块覆盖失败，已回退为整页一块`);
          if (mixFailure) failures.push({ page: slide.page, stage: 'mix', code: mixFailure });
          results[i] = { page: slide.page, createdSec: slide.createdSec ?? null, fromMs: window.fromMs, toMs: window.toMs,
            transcription: transcription.transcription, gate: pageGate(transcription.transcription), evidenceKind: imageFailure ? 'transcript-only' : 'slide-transcript', ...mixed, raw: mixedRaw, failure: mixFailure ?? imageFailure,
            failureDetail:transcription.failureDetail ?? null };
          onProgress({
            phase: 'mix', done: ++progress.mix, total: mixTotal,
            /* 这一页真实切出了几块 —— 动画据此给页带上的小格子上色。
             * 与 vision 侧一样，随**真实到达顺序**发出（这里在并发消费者里）。 */
            detail: {
              page: slide.page,
              /* ★ **原字幕 vs 清洗稿**对照。
               *
               * 审查第 15 条：mix 是"用图上的正确写法纠正听错的字"，
               * 只给块数完全无法验收它做对没做对。
               * 两边都截断到 2000 字（全量由 capture 通道另存）。
               */
              rawText: String((window.lines ?? []).map((l) => l.text ?? '').join('')).slice(0, 2000),
              mixedText: String((mixed.sentences ?? []).map((x) => x.text ?? '').join('')).slice(0, 2000),
              blocks: mixed.drafts?.length ?? 0,
              lines: window.lines.length,
              chars: mixed.sentences?.reduce((a, s) => a + String(s.text ?? '').length, 0) ?? 0,
              failure: mixFailure ?? null,
              tags: mixed.drafts.map((d, localIndex) => ({ localIndex: localIndex + 1,
                sentenceFrom: d.sentenceFrom, sentenceTo: d.sentenceTo, tag: d.tag ?? null })),
            },
          });
        },
      });
      const [pipeline] = await Promise.all([pipelineTask, processTranscripts()]);
      if (pipeline.queue.stats.waitedForSlot > 0) {
        warnings.push(`识别队列曾经触顶 ${pipeline.queue.stats.waitedForSlot} 次（峰值 ${pipeline.queue.stats.peak} 批）：把并发调高会让识别更快。`);
      }

      // ══════════════════════════════════════════════════════════
      // ② 句子层 / 块层：一句都不许丢
      // ══════════════════════════════════════════════════════════
      let sentences = [], blocks = [];
      for (const page of [...results, ...transcriptResults]) {
        const offset = sentences.length; sentences.push(...page.sentences);
        for (const draft of page.drafts) {
          const selected = page.sentences.slice(draft.sentenceFrom - 1, draft.sentenceTo);
          if (selected.length) {
            const block = blockOf(selected, offset + draft.sentenceFrom, offset + draft.sentenceTo, draft.bridge, page.page);
            if (draft.tag) block.tag = { role: draft.tag.role, facets: draft.tag.facets, summary: draft.tag.summary };
            block.evidenceKind = page.evidenceKind ?? 'slide-transcript';
            block.sourceUnitId = page.unitId ?? 'page:' + page.page;
            block.fromUnanchored = page.page == null;
            block.cleanStatus = blockCleanStatus(selected);
            block.correctionIssues = (page.rejected ?? []).filter(r => selected.includes(page.sentences[r.index]));
            block.mixLocalIndex = page.drafts.indexOf(draft) + 1;
            blocks.push(block);
          }
        }
      }
      // Unanchored provenance remains visible; it no longer means unprocessed.
      const unassignedSentences = transcriptResults.flatMap(unit => unit.sentences);
      const unanchoredUncleaned = unassignedSentences.filter(line => line.cleanStatus === 'incomplete').length;
      if (transcriptResults.length) warnings.push(`有 ${unassignedSentences.length} 句按无课件时间段处理；仅语音转录依据，不冒充图片校对。`);

      /* ── 拓扑检查点 ①：识别阶段 ──────────────────────────────────
       * 一页都没读成功 → 后面（mix / 块 / 标注 / 树）全无输入。
       * 这时候抛错比返回一份空产物诚实：用户看到的是"哪一步失败、怎么修"，
       * 而不是"跑完了但什么都没有"。
       *
       * ⚠️ 提示语**不再替用户猜原因**。早先这里固定写"检查视觉模型是否支持图片"，
       *    而实跑时真实原因是别的（模型其实支持图片）—— 那句猜测把排查方向带偏了。
       *    现在把**上游原文**（`details.cause`）一并带出来，让用户直接看到服务端说了什么。
       */
      const visionFailed = results.filter(p => p.failure && !p.transcription?.pageText);
      const firstVisionCause = results.map(p => p.failureDetail).find(Boolean) ?? null;
      if (![...results, ...transcriptResults].some(p => p.cleanComplete)) abortWhenAllFailed('识别', visionFailed.length, results.length, 'VISION_ALL_FAILED',
        firstVisionCause
          ? `所有页都没读出文字。服务端原文：${String(firstVisionCause).slice(0, 200)}`
          : '所有页都没读出文字（没有拿到服务端的错误信息，可能是网络或适配层问题）');

      blocks = stitch(blocks);

      // mix 已逐页完成标记；这里只汇总词表和全局编号，不再发独立 tags 请求。
      vocabulary = structuredClone(seeded);
      const tagFailures = [];
      for (const page of [...results, ...transcriptResults]) {
        for (const term of page.marking?.vocabulary ?? []) {
          if (vocabulary.some(t => t.name === term.name)) continue;
          vocabulary.push(term); addedVocabulary.add(term.name);
        }
        if (page.marking && !page.marking.ok) {
          tagFailures.push({ page: page.page, unitId: page.unitId, code: 'MIX_TAG_COVERAGE' });
        }
      }

      /* ── 拓扑检查点 ②：标注阶段 ──────────────────────────────────
       * 有块但**一条都没打上标** → 建树只收主线块，树必然为空，讲义也无从装配。
       * 这时继续跑 outline / 建树，产出一定是空壳。
       */
      if (blocks.length) {
        abortWhenAllFailed('标注', blocks.filter(b => !b.tag.role).length, blocks.length, 'TAG_ALL_FAILED',
          'mix回包没有任何有效块标记 —— 同次清洗必须附完整JSON答题卡，不能留给后续独立标注');
      }

      // ══════════════════════════════════════════════════════════
      // ④ 整节主线（spine / outline）
      // ══════════════════════════════════════════════════════════
      const eligibleSources = new Set(sieveBlocks(blocks).main.map(b=>b.index));
      for (const block of blocks) block.lectureEligible = eligibleSources.has(block.index);
      let spine = '', outline = [], semanticPlan = null, outlineFailure = null;
      const summaries = blocks.map(block => ({ index: block.index, summary: (block.tag.summary ?? '').trim() }));
      if (blocks.length && routes && summaries.some(item => item.summary)) {
        const parts = outlineRequest(blocks, context), key = this.cache.key('outline', [routes.text, parts]);
        const parseOutline = raw => {
          const parsed = parseTags(raw);
          if (!parsed) return null;
          // 越界 / 反向 / 重叠的区间逐条剔除并**如实报出**；剩下的照常给。
          const cleaned = sanitizeOutline(parsed.outline, blocks.length);
          return { spine: parsed.spine, outline: cleaned.outline, warnings: cleaned.warnings,
            semanticPlan: parseSemanticPlan(raw, sieveBlocks(blocks).main, Math.max(0, ...blocks.map(b => b.index))) };
        };
        onProgress({ phase: 'outline', done: 0, total: 1 });
        try {
          const cached = await this.cache.get(key);
          const send = async (variable, retry) => {
            const response = await this.limiter.run(() => this.llm.call({ stage: 'outline', route: routes.text,
              constant: parts.constant, variable, signal: combined }), combined);
            events.push({ stage: 'outline', cached: false, ...(retry ? { retry } : {}), usage: response.usage ?? null });
            return response.text;
          };
          let raw = cached?.raw ?? null;
          let parsed = raw ? parseOutline(raw) : null;
          if (parsed) events.push({ stage: 'outline', cached: true });
          else {
            raw = await send(parts.variable);
            try { parsed = parseOutline(raw); }
            catch (error) {
              if (error.code !== 'SEMANTIC_PLAN') throw error;
              // Repair the allocation, never rerun vision/mix or relax coverage.
              raw = await send(`${parts.variable}\n\n上一版知识点方案未通过来源校验：${error.message}。保留合理分组，修复遗漏或重叠；完整返回spine、outline、knowledge，主线块必须全部承接。\n上一版：\n${raw}`, 1);
              parsed = parseOutline(raw);
            }
          }
          if (!parsed) throw new ParserError('OUTLINE_SHAPE', '整节主线的回包不是能认出来的 JSON');
          /* 粒度体检：模型倾向"一段一个标题"，会把同一主题拆成平行小标题。
           * 只修一次——点名到章/点/块号，让它归并；修不动就如实报告，不循环重试。 */
          const planIssues = parsed.semanticPlan ? findPlanIssues(parsed.semanticPlan, sieveBlocks(blocks).main) : [];
          if (planIssues.length) {
            const repairedRaw = await send(`${parts.variable}\n\n上一版知识点分组粒度不合格。${describePlanIssues(planIssues)}\n完整返回spine、outline、knowledge，仍须覆盖全部主线块。\n上一版：\n${raw}`, 1);
            let repairedPlan = null;
            try { repairedPlan = parseOutline(repairedRaw); }
            catch (error) { warnings.push(`知识点粒度修复未通过：${error.message}；沿用上一版分组。`); }
            if (repairedPlan) {
              raw = repairedRaw;
              parsed = repairedPlan;
              const left = parsed.semanticPlan ? findPlanIssues(parsed.semanticPlan, sieveBlocks(blocks).main) : [];
              if (left.length) warnings.push(`知识点粒度仍偏碎：${left.map(i => i.message).join('；')}。已按模型返回建树。`);
            }
          }
          await this.cache.put(key, raw);
          spine = parsed.spine; outline = parsed.outline; semanticPlan = parsed.semanticPlan;
          onProgress({ phase: 'outline', done: 1, total: 1 });
          if (!semanticPlan) warnings.push('整节梳理未提供详细语义知识点，建树使用机械分组；语义正交性尚未验证。');
          warnings.push(...parsed.warnings);
        } catch (error) {
          if (combined.aborted) throw error;
          outlineFailure = error.code ?? 'LLM_FAILED';
          if (error.code === 'SEMANTIC_PLAN') warnings.push(`语义知识点分组未通过校验：${error.message}；已保留来源，当前树为机械分组。`);
        }
      } else if (blocks.length && routes) outlineFailure = 'MISSING_SUMMARIES';

      // ══════════════════════════════════════════════════════════
      // ⑤ 建树 + 重构（筛支线 → 挂账 → 审查 → 合并 → 拆叶 → 重聚）
      // ══════════════════════════════════════════════════════════
      const mergeFailures = [];
      onProgress({ phase: 'merge', done: 0 });
      const built = await buildTreeFromBlocks(blocks, { splitLine: this.splitLine,
        semanticPlan,
        organize: routes ? async leaf => {
          const failed = await organizeLeaf(leaf, { llm: this.llm, route: routes.text, cache: this.cache,
            limiter: this.limiter, pages: results, signal: combined, events,
            onProgress: detail => onProgress({ phase: 'merge', done: ++progress.merge, detail }),
          });
          mergeFailures.push(...failed);
        } : null,
      });
      onProgress({ phase: 'rebuild', done: built.stats.knowledgePoints, total: built.stats.knowledgePoints });

      /* ── 拓扑检查点 ③：建树 ──────────────────────────────────────
       * 有主线块却一个知识点都没聚出来 → 重构这一步自己坏了。
       * 这是**我们代码的漏洞**，不是用户环境问题（所以它必须响亮地抛，
       * 而不是被写成一份"空树"的产物悄悄落盘）。
       */
      if (built.stats.main > 0 && !built.knowledgePoints.length) {
        throw new ParserError('REBUILD_EMPTY',
          `建树阶段有 ${built.stats.main} 个主线块，却一个知识点都没聚出来 —— 这是解析器自身的边界问题，请报缺陷。`,
          { stage: 'rebuild', mainBlocks: built.stats.main });
      }

      // Every input subtitle is processed once, independently of slide availability.
      const coveredTotal = sentences.length;
      if (coveredTotal !== subtitles.length) {
        throw new ParserError('INVARIANT', '解析产物未覆盖全部输入字幕', {
          stage: 'invariant', sentences: sentences.length,
          unanchored: unassignedSentences.length, subtitles: subtitles.length,
        });
      }
      if (new Set(sentences.map(s => s.sourceIndex)).size !== subtitles.length
        || sentences.some(s => !Number.isInteger(s.sourceIndex) || s.sourceIndex < 0 || s.sourceIndex >= subtitles.length)) {
        throw new ParserError('INVARIANT', '字幕来源编号有重复或遗漏', {stage:'invariant'});
      }
      /* ⚠️ 这里**不再**要求 `coverage(blocks, sentences.length)` 覆盖满。
       *
       * 因为"某页 vision 失败"时我们**刻意**让那一页只有句子、没有块 ——
       * 那是诚实的状态（内容没丢，只是没读出来）。若仍然要求块覆盖满，
       * 就等于逼着代码为失败页造一个空块，那才是"错了就将错就错"。
       *
       * 真正要守住的不变量只有一条：**句子一条不丢**（上面那条）。
       * 块覆盖率是**质量指标**，写进 warnings 让用户看见，而不是当成断言。
       */
      const blockCoverage = coverage(blocks, sentences.length);
      if (!blockCoverage.ok) {
        const uncovered = blockCoverage.issues.length;
        warnings.push(`有 ${uncovered} 处句子没有落进任何块（通常是那几页的识别或分块失败了）；`
          + '这些句子仍保留在句子层，重跑失败页即可补齐。');
      }
      // Missing visual evidence and unfinished transcript processing are distinct states.
      const partial = failures.length || tagFailures.length || mergeFailures.length || outlineFailure || unanchoredUncleaned || blocks.some(b => !b.tag.role);
      // 新增标签在**解析结束后写一次**（不是每卷写一次）：同一节的各卷会各自提名新
      // 标签，逐卷写盘会让词表在解析中途变化 —— 而"同一节所有卷从同一份清单里选"
      // 正是 filter 有稳定键的全部依据。无新增就不写。
      await this.saveVocabulary(vocabulary, [...addedVocabulary], warnings);
      const output = {
        schema: 2, sourceId, status: partial ? 'partial' : 'ready',
        resource: { schema: 1, label: '讲义资源终稿',
          processingPolicy:'transcript-unit-v1',
          structureStatus: partial ? 'incomplete' : semanticPlan ? 'allocated' : 'unverified',
          topicCount: semanticPlan ? semanticPlan.reduce((n,c) => n + c.topics.length, 0) : null,
          partCount: built.knowledgePoints.length, semanticOptimized: false,
          unanchoredUncleanedSentenceCount: unanchoredUncleaned,
          transcriptOnlySentenceCount: unassignedSentences.length,
          pendingBlockCount:blocks.filter(b=>!b.tag.role||b.cleanStatus==='incomplete').length,
          uncleanedSentenceCount:sentences.filter(s=>s.cleanStatus==='incomplete').length,
          blockedCorrectionCount:[...results,...transcriptResults].reduce((n,u)=>n+(u.rejected?.length??0),0),
          unverifiedPageSentenceCount: results.filter(p => p.failure).reduce((n,p) => n + (p.sentences ?? []).filter(s => s.cleanStatus === 'incomplete').length, 0) },
        pages: results, transcriptUnits: transcriptResults, sentences, unassignedSentences, blocks, spine, outline, semanticPlan,
        // ★ 树与重构结果一并交出去：上层不需要自己再实现一遍"筛→挂→审→合→拆→聚"。
        /* ★ `tree` 是**带标题层级的树**（`buildTreeFromBlocks` 的第 ⑦ 步聚合产物），
         * 不是平铺的知识点数组。图里的树是「title 只有名字、leaf 只有正文」，
         * 讲义要按层级走 —— 给它一排平铺叶，它就只能自己重排，那就又分叉了。
         *
         * `knowledgePoints` 仍然单独给出：那是**重建过程**的中间产物，
         * 追查与调试要用（日志里逐条记的就是它）。两者并存、各有用途。 */
        tree: built.tree, chapters: built.chapters, treeStats: built.stats, board: built.board,
        orthogonal: built.orthogonal,
        knowledgePoints: built.knowledgePoints, leafTrees: built.leaves,
        stashSnapshot: built.stashSnapshot,
        mergeStats: built.merge.map((m) => m.result),
        glossary: glossary(results.map(p => ({ page: p.page, ...(p.transcription ?? { pageText: '', listedTerms: '' }) }))), vocabulary,
        failedPages: [...new Set(failures.map(f => f.page))], failures, tagFailures, mergeFailures, outlineFailure, warnings, calls: events,
        pipeline: { workers: this.concurrency, capacity: this.queueCapacity, ...pipeline.queue.stats },
        fetchedAt: new Date().toISOString(),
      };
      output.version = hash([sourceId, sentences, unassignedSentences, blocks.map(b => [b.sentenceFrom, b.sentenceTo, b.tag, b.bridge, b.text, b.register, b.slideEvidence,b.lectureEligible,b.evidenceKind,b.sourceUnitId]), spine, outline, semanticPlan]);
      onProgress({ phase: 'done', done: slides.length, total: slides.length }); return output;
    } catch (error) {
      controller.abort();
      const cancelled = signal?.aborted || this.closed || error.code === 'CANCELLED';
      // ★ 已经自己长出来的标签**不因为这一节失败就丢掉**：用户重跑往往正是为了
      //   把失败的那几卷补回来，若重跑时这一份（已经付过钱的）新标签没有落盘，
      //   模型下次得重新提名一次，词表也就白长了。
      //   ⚠️ **取消不算失败**：用户按了停，就不该在磁盘上留下他没收下的东西。
      if (!cancelled && vocabulary && addedVocabulary.size) {
        const saveWarnings = [];
        await this.saveVocabulary(vocabulary, [...addedVocabulary], saveWarnings);
        // 解析已经失败了，警告没有产物可以挂 —— 挂到 error 上，仍然**有名字**。
        if (saveWarnings.length) error.details = { ...(error.details ?? {}), vocabularyWarnings: saveWarnings };
      }
      if (cancelled) throw new ParserError('CANCELLED', '解析已取消');
      throw error;
    } finally { this.controllers.delete(controller); }
  }
  createRun({ workers } = {}) {
    const llm = new WorkerPoolLlm({ base: this.llm, entries: workers });
    return new LectureParser({ llm, concurrency: llm.concurrency, cache: this.cache,
      visionBatchSize: this.visionBatchSize, splitLine: this.splitLine, queueCapacity: this.queueCapacity,
      readImage: this.readImage, classroom: this.classroom, vocabularyStore: this.vocabularyStore });
  }
  async parseClassroom(courseId, subId, options = {}) {
    if (this.closed) throw new ParserError('DISPOSED', '解析器已关闭');
    if (!this.classroom) throw new ParserError('CONFIG', '未接入智云课堂数据源');
    const controller = new AbortController(); this.controllers.add(controller);
    const signal = AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]);
    try {
    const content = await this.classroom.getLessonContent(courseId, subId, { ...options, signal });
    signal.throwIfAborted();
    if ((content.slides.meta.complete !== true || content.subtitles.meta.complete !== true) && !options.allowPartialSource) throw new ParserError('PARTIAL_SOURCE', '课件或字幕尚未确认收全，请稍后重试');
    const parsed = await this.parse({ ...options, signal, sourceId: content.sourceId, slides: content.slides.items, subtitles: content.subtitles.items });
    parsed.sourceMeta = { slides: content.slides.meta, subtitles: content.subtitles.meta, processingSuspected: content.slidesProcessingSuspected };
    if (content.slidesProcessingSuspected || content.slides.meta.complete !== true || content.subtitles.meta.complete !== true) { parsed.status = 'partial'; parsed.warnings.push('数据源内容可能仍在处理中'); }
    return parsed;
    } catch (error) {
      if (signal.aborted) throw new ParserError('CANCELLED', '解析已取消');
      throw error;
    } finally { this.controllers.delete(controller); }
  }
  dispose() { this.closed = true; for (const c of this.controllers) c.abort(); this.controllers.clear(); }
}
