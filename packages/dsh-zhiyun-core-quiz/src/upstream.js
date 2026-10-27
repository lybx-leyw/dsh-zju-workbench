/**
 * 上游候选生成引擎的**契约层**（本包 ⇄ `zhiyunDeepTutor` 之间唯一的耦合面）。
 *
 * # 这个文件为什么存在
 *
 * 本包已有的出题实现是「我们自己问模型」：`generate.js` 逐块 rewrite → generate →
 * 规则门禁 → 质检链，模型调用走窄 llm 接口。现在多了一条路 —— 让上游 DeepTutor
 * 的主出题流水线出题，我们只取候选题目。
 *
 * 两条路**不是替代关系**：上游出题有自己的探索/规划阶段、自己的逐题串行与前序依赖，
 * 换掉出题引擎不应该同时换掉我们的质量判断。所以这里只定义「引擎契约」——
 * 一个和 `createQuizGenerator` 同形的对象，由**集成层**决定这次用哪个。
 *
 * # 为什么本文件不 import 宿主服务包的实现
 *
 * 本包零依赖（`tests/quiz.test.mjs` 有断言钉住），且算法层必须能脱离宿主单测。
 * 所以 `tutor` 是**注入**的：集成层把 `ctx.zhiyunDeepTutor` 传进来，测试传一个假对象。
 *
 * # 输出形状必须落回本包词汇
 *
 * 上游题型和本包题型不是一套（详见 `dsh-zhiyun-host-deeptutor/src/adapters/quiz.js`
 * 的说明）：上游主流水线只有 `choice` / `concept` / `fill_in_blank` / `short_answer` /
 * `written` / `coding`，而本包 `strategies.js` 的词表是 `cloze` / `mcq` / `trueFalse` /
 * `shortAnswer`。**上游的 `concept` 是判断题**（正确答案被规范成 true/false），
 * 映射过来必须是 `trueFalse`，不能是"概念填空"。
 *
 * 本文件只做**协议与词汇的收口**，不重复实现映射表 —— 映射由宿主侧适配器负责，
 * 它离上游更近、能跟着上游枚举一起升级。这里只校验「回来的东西是不是我们能吃的」。
 */

import { QuizError } from './quality.js';

/** 本包能吃的题型（= `strategies.js` 的 `QUESTION_TYPES` 键）。 */
const ACCEPTED_TYPES = new Set(['cloze', 'mcq', 'trueFalse', 'shortAnswer']);

/**
 * 校验一个上游候选题目能不能进本包的质检与落盘流程。
 *
 * 为什么「不认识就报错」而不是「猜一个最像的」：题型决定质检判据（判断题只有
 * true/false 两种答案、选择题要有唯一正确选项、填空题要有可判等价的标准答案）。
 * 用错判据比不判更糟 —— 它会给出一份看起来通过了质检的结果。
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function checkCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return { ok: false, reason: '候选题目不是对象' };
  const type = candidate.type;
  if (typeof type !== 'string' || type === '') return { ok: false, reason: '候选题目缺 type' };
  if (!ACCEPTED_TYPES.has(type)) {
    return {
      ok: false,
      reason: `题型 ${type} 不在本包词表内（上游原值是 ${candidate.rawType ?? '未记录'}）`
        + '；请先在宿主侧适配器把它映射到 cloze/mcq/trueFalse/shortAnswer 之一',
    };
  }
  if (typeof candidate.stem !== 'string' || candidate.stem.trim() === '') {
    return { ok: false, reason: '候选题目缺题干' };
  }
  if (type === 'trueFalse') {
    // 判断题的答案必须是布尔语义。上游在流水线里已经规范化过，但适配器有可能
    // 在这一步丢了 —— 如果它变成"正确/错误"以外的东西，质检就判不了。
    const answer = candidate.answer;
    const normalized = typeof answer === 'boolean'
      ? answer
      : typeof answer === 'string'
        ? { true: true, 正确: true, false: false, 错误: false }[answer.trim().toLowerCase()] ?? null
        : null;
    if (normalized === null) {
      return { ok: false, reason: `判断题的答案是 ${JSON.stringify(answer)}，不是 true/false 语义` };
    }
  }
  return { ok: true };
}

/**
 * 创建一个「上游引擎」适配器。
 *
 * 返回形状刻意与 `createQuizGenerator` 对齐（`generate` / `dispose` / `concurrency` /
 * `active` / `closed`），这样集成层可以**在两条引擎之间直接换**，调用方不用改。
 * 缺的方法不假装有 —— 上游流水线的进度语义和我们自己的不同，硬凑一个同形进度
 * 只会造出「看起来在动其实不知道在干什么」的假进度。
 *
 * @param {object} options
 * @param {object} options.tutor  宿主服务 `ctx.zhiyunDeepTutor`（注入，便于测试替换）
 * @param {object} [options.resourceHandle] 已 attach 的标准学习资源句柄
 * @param {string} [options.capability] 上游能力名，默认 `deep_question`
 * @param {object} [options.options] 透传给上游的运行选项
 * @param {Function} [options.now]
 * @param {object} [options.logger]
 */
export function createUpstreamQuizEngine({
  tutor,
  resourceHandle = null,
  capability = 'deep_question',
  options = {},
  now = () => new Date(),
  logger = {},
} = {}) {
  if (!tutor || typeof tutor.runs?.start !== 'function') {
    throw new QuizError('CONFIG',
      '上游出题引擎需要注入 zhiyunDeepTutor 服务（ctx.zhiyunDeepTutor）；'
      + '该服务由 dsh-zhiyun-host-deeptutor 注册，未安装时它不存在是正常的 —— '
      + '这不该阻止本包自己的出题路径工作');
  }

  let disposed = false;
  /** @type {Set<string>} 在飞的 runId，dispose 时要逐个取消 */
  const inFlight = new Set();

  /**
   * 出题。
   *
   * 与 `generate.js` 的差别要说清楚：那边是「先筛后出 + 速率判定 + 逐块重写」，
   * 这边是「把资源交给上游，等它按自己的流水线出完」。所以这里的
   * `input.onProgress` 拿到的是**上游真实事件**推导出的进度，不是按题目数估算的。
   *
   * 任何一步失败都抛 `QuizError`，不返回半成品 —— 半成品进了质检链会被当成
   * 「模型这次只出了 3 道」而不是「这次失败了」。
   */
  async function generate({ signal, onProgress } = {}) {
    if (disposed) throw new QuizError('DISPOSED', '上游出题引擎已关闭');
    // 取消信号可能在进入本函数之前就已经 abort 了（用户点了取消，而我们在等
    // 能力查询）。这种情况必须立刻停手 —— 否则会在"已经没人要结果"之后
    // 仍然起一次 run，那是真金白银。
    signal?.throwIfAborted();

    // 先查能力状态，别让用户等到上游进程起来才被告知「没配模型」。
    if (typeof tutor.capabilities === 'function') {
      let entry = null;
      try {
        const catalog = await tutor.capabilities();
        entry = (Array.isArray(catalog) ? catalog : catalog?.capabilities ?? [])
          .find((item) => item?.name === capability) ?? null;
      } catch (error) {
        throw new QuizError('UPSTREAM', `查询上游能力状态失败：${error?.message ?? error}`);
      }
      if (!entry) {
        throw new QuizError('CONFIG', `上游没有名为 ${capability} 的能力`);
      }
      // 五态里任一层不满足都要说清楚是哪一层 —— 否则用户只会看到"不可用"。
      const blocked = ['upstream', 'depsAvailable', 'configured', 'exposed']
        .find((layer) => entry[layer] === false);
      if (blocked) {
        const hint = entry.reason ?? entry.installHint ?? '';
        throw new QuizError('CONFIG',
          `上游能力 ${capability} 在「${blocked}」这一层不可用${hint ? `：${hint}` : ''}`);
      }
    }

    const handle = resourceHandle ?? null;
    signal?.throwIfAborted();
    let started;
    try {
      started = await tutor.runs.start({
        capability,
        resourceHandles: handle ? [handle] : [],
        input: options.input ?? {},
        options,
        scope: options.scope,
      });
    } catch (error) {
      throw new QuizError('UPSTREAM', `上游出题启动失败：${error?.message ?? error}`);
    }

    const runId = started?.runId;
    if (typeof runId !== 'string' || runId === '') {
      throw new QuizError('UPSTREAM', '上游没有返回 runId，无法追踪这次运行');
    }
    inFlight.add(runId);

    const abort = () => {
      // 取消是**尽力而为**：取消失败不该盖住"用户取消"这个事实。
      tutor.runs.cancel(runId).catch((error) => {
        logger.warn?.('取消上游 run 失败', error?.message ?? String(error));
      });
    };
    signal?.addEventListener('abort', abort, { once: true });

    try {
      // 消费事件流：只把**上游真的发出来的**事件转成进度。
      for await (const event of tutor.runs.events({ runId })) {
        signal?.throwIfAborted();
        if (event?.kind === 'progress' || event?.kind === 'stage' || event?.kind === 'stage-start' || event?.kind === 'stage-end') {
          onProgress?.({
            phase: event.stage ?? event.kind,
            // 上游给了 counts 才用它；没给就只报阶段名，**不编造 done/total**。
            done: event.counts?.done ?? null,
            total: event.counts?.total ?? null,
            source: 'upstream',
          });
        }
      }

      const result = await tutor.runs.result(runId);
      if (!result) throw new QuizError('UPSTREAM', '上游 run 结束但没有结果');
      if(result.status&&result.status!=='succeeded')throw new QuizError('UPSTREAM',result.error?.message??`上游运行以 ${result.status} 结束`);

      const candidates = Array.isArray(result.questions) ? result.questions : [];
      const accepted = [];
      const rejected = [];
      for (const candidate of candidates) {
        const verdict = checkCandidate(candidate);
        if (verdict.ok) accepted.push(candidate);
        else rejected.push({ candidate, reason: verdict.reason });
      }

      return {
        questions: accepted,
        rejected,
        // 上游的用量、指纹、资源版本原样带回：归因要靠它，不能在这里压平。
        usage: result.usage ?? null,
        fingerprint: result.fingerprint ?? started?.fingerprint ?? null,
        resourceRevision: result.resourceRevision ?? handle?.revision ?? null,
        runId,
        generatedAt: now(),
        diagnostics: result.diagnostics ?? [],
      };
    } finally {
      signal?.removeEventListener('abort', abort);
      inFlight.delete(runId);
    }
  }

  return {
    generate,
    concurrency: 1, // 上游主流水线是串行的（后续题目依赖前序题目），如实声明
    get active() {
      return inFlight.size;
    },
    get closed() {
      return disposed;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      const pending = [...inFlight];
      inFlight.clear();
      await Promise.allSettled(pending.map((runId) => tutor.runs.cancel(runId)));
    },
  };
}
