/**
 * 把重构版出题链（core-question）适配成与 DeepTutor `tutor.runs.*` 同形的后端。
 *
 * # 为什么是适配层而不是改调用方
 *
 * `createNativeQuizRun` 只经 6 个点访问 tutor：
 *   resources.attach / resources.release / runs.start / runs.events / runs.result / runs.cancel
 * 把这 6 个点做成同形实现，调用方一行不用改：题型校验、断点续跑、题库落盘、
 * 知识点归属全部沿用既有逻辑。反过来若去改 createNativeQuizRun，r1 和 r3 共用的
 * 那套 runtime 契约就要重新论证一遍，改动半径完全不成比例。
 *
 * # 为什么保留 runs.cancel
 *
 * 新链是进程内调用，没有子进程要杀。但调用方在 abort 时一定会调 cancel，
 * 缺了它会让「用户点暂停」变成一句 TypeError。所以给个幂等的空实现，
 * 真正的取消靠 AbortSignal 传递。
 *
 * # 为什么 events 要模拟 stage
 *
 * 进度条依赖 `exploring / planning / quizzing` 三个 stage。
 * 新链自己的 onEvent 已经给出这三个阶段名，直接透传即可，
 * 不要改写成别的词汇 —— 界面文案是按这三个键查表的。
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/**
 * 跨包加载解析。
 *
 * ⚠️ 绝对不能用 `process.cwd()` 拼路径。desktop 进程的 cwd 是
 * `.runtime/home/workspace`，不是仓库根 —— 拼出来的路径必然不存在，
 * 报错是 `Cannot find module .../workspace/packages/dsh-zhiyun-core-question/...`。
 * 2026-10-31 的真实事故就是这个：命令行走得通，桌面端必挂。
 *
 * 改为「先按裸包名 import，失败再按本文件的相对位置兜底」：
 *   - 裸包名：workspace 已经 link 过，生产和测试都走这条
 *   - 相对兜底：没装包时（比如只 clone 了仓库）仍能跑
 * 两条路都与 cwd 无关。
 */
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PACKAGES_ROOT = path.resolve(HERE, '../..');

const load = async (specifier, fallbackRel) => {
  try {
    return await import(specifier);
  } catch (error) {
    if (!fallbackRel) throw error;
    return import(pathToFileURL(path.join(PACKAGES_ROOT, fallbackRel)).href);
  }
};

const STAGES = new Set(['exploring', 'planning', 'quizzing']);

/**
 * 把 OpenAI 形状的消息转成宿主（Anthropic Messages 方言）要求的形状。
 *
 * # 这是 TRANSPORT 的真正原因（2026-10-31 第五次真机失败）
 *
 * core-question 按 OpenAI 约定造消息：`{role:'user', content:'一段文字'}`。
 * 但宿主的 deepseek adapter 走的是 **Anthropic Messages API**，它在
 * `serialize()` 里对 content 做 `blocks.flatMap(...)`、在请求前还有
 * `body.messages.some(m => m.content.some(...))`：
 *
 *   content 是字符串时 `.some` 不存在 → TypeError
 *   → 被 generate() 的 catch 吞成 `DeepSeek Messages transport failed`(TRANSPORT)
 *
 * 仓库里已有的正确写法在 r3 kernel（tools.mjs:66）：
 *   `const blocks = text => [{type:'text', text}]`
 *
 * 所以这里做一次形状转换。不转的话错误信息会伪装成网络故障，
 * 与真实原因（消息格式）隔着十万八千里。
 */
/**
 * 把 OpenAI 形状的工具定义转成宿主（Anthropic Messages 方言）要求的形状。
 *
 * # 锁住的事故（2026-10-31 第六次真机失败）
 *
 * 宿主序列化工具时读的是**扁平字段**（dsh-llm-deepseek/index.js:1712）：
 *   tools: options.tools.map(tool => ({
 *     name: tool.name,               // ← 顶层读 name
 *     description: tool.description,
 *     input_schema: tool.parameters, // ← 参数键叫 input_schema
 *   }))
 *
 * 而 core-question 传的是 OpenAI 形状：
 *   { type:'function', function:{ name, description, parameters } }
 * 外层没有 name，于是 tool.name 为 undefined，服务端报
 *   "tools[0]: missing field `name`"
 *
 * 没有这层转换，每一次带工具的调用都会 400。
 */
function toHostTools(tools) {
  return tools.map(tool => {
    // 已经是宿主形状（有 name 无 function 包装）就原样返回
    if (tool && typeof tool.name === 'string' && tool.function === undefined) {
      return {
        name: tool.name,
        description: tool.description ?? '',
        parameters: tool.parameters ?? tool.input_schema ?? { type: 'object', properties: {} },
      };
    }
    // OpenAI 包装形状
    const fn = tool?.function ?? tool ?? {};
    return {
      name: fn.name,
      description: fn.description ?? '',
      // 宿主最终会用 params 去填 input_schema，所以这里保持 parameters 键
      parameters: fn.parameters ?? { type: 'object', properties: {} },
    };
  });
}

function toHostMessages(messages) {
  const blocksOf = content => {
    if (Array.isArray(content)) return content;          // 已经是块数组
    if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
    if (content === null || content === undefined) return [];
    // 其它类型统一转文本，避免再次出现「.some is not a function」
    return [{ type: 'text', text: String(content) }];
  };

  return messages.map(m => {
    const base = {
      id: m.id ?? `${m.role}-${Math.random().toString(36).slice(2)}`,
      role: m.role,
      source: { kind: m.role === 'tool' ? 'tool' : 'zhiyun-quiz', ...m.source },
    };
    // 工具结果消息的关联 id 在**消息顶层**，不在 source 里。
    //
    // 宿主序列化时读的是 message.toolCallId（dsh-llm-deepseek/index.js:1668）：
    //   { type:'tool_result', tool_use_id: message.toolCallId, content: input(message.content) }
    // 我最初写在 source.callId 上，宿主读不到 → tool_use_id 变成 undefined，
    // 服务端会因为「tool_result 没有对应的 tool_use」而 400。
    if (m.role === 'tool') {
      const callId = m.toolCallId ?? m.tool_call_id ?? m.source?.callId;
      return {
        ...base,
        toolCallId: callId,
        content: blocksOf(m.content),
      };
    }
    // assistant 轮如果带 tool_calls，宿主期望它们作为 tool-call 块混在 content 里
    if (m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      const callBlocks = m.tool_calls.map(c => ({
        type: 'tool-call',
        id: c.id ?? c.function?.id,
        name: c.name ?? c.function?.name,
        arguments: typeof c.arguments === 'string'
          ? c.arguments
          : JSON.stringify(c.arguments ?? c.function?.arguments ?? {}),
      }));
      return { ...base, content: [...blocksOf(m.content), ...callBlocks] };
    }
    return { ...base, content: blocksOf(m.content) };
  });
}

/**
 * 把宿主的 worker pool 包成 core-question 期望的 llm 形状。
 *
 * # 为什么必须走 pool.execute，而不是自己调 prepareCall
 *
 * 宿主把「调模型」这件事的四件关键处理全封在 `pooledToolCall` 里
 * （见 quiz-engine-runtime.js:115-130）：
 *   1. `pool.execute(work)` —— 并发调度与路由选择。绕开它会丢掉 8 路并发的意义。
 *   2. 消息要补 `source` 元数据，宿主的会话/审计靠它归因。
 *   3. **provider 的失败以 `{type:'finish',reason:{kind:'error'}}` 形式到达，
 *      不是抛异常**。必须在这里翻成异常，否则会被读成「模型什么都没返回」的空结果 ——
 *      这正是 `DeepSeek Messages transport failed` 显示成 0 道题的深层原因。
 *   4. `withTransportRetry` 的退避重试。
 *
 * 2026-10-31 的教训：我先前自己拼了 prepareCall + stream，以上四条全丢，
 * 结果 16 秒 8 并发全失败、用户只看到「0 道可用」。
 *
 * @param {object} pool          WorkerPoolLlm 实例
 * @param {Function} pooledCall  现成的 pooledToolCall(pool)，由调用方注入避免循环依赖
 */
function createPoolBackedLlm(pool, pooledCall) {
  /**
   * 把 provider 的 finish 失败块翻成异常。
   *
   * 宿主适配器**不抛异常**，它把失败规整成 `{type:'finish',reason:{kind:'error'}}`。
   * 不翻的话，上层只看到「模型这次什么都没返回」的空结果，不会触发任何重试，
   * 最终整批归零、界面上只有一句难懂的传输失败。
   * 与 quiz-engine-runtime.js 的 `finishFailure` 同语义。
   */
  const finishError = reason => {
    if (!reason || reason.kind === 'stop' || reason.kind === 'tool-calls') return null;
    const failure = reason.failure ?? {};
    return Object.assign(
      Error(failure.message ?? `模型未正常结束：${reason.kind ?? 'unknown'}`),
      { code: failure.code ?? (reason.kind === 'aborted' ? 'CANCELLED' : 'TRANSPORT') },
    );
  };
  return {
    /**
     * 标签驱动的流式调用 —— 直接用 question-stream 的实现。
     *
     * 挂上它之后流水线走「llm.runLabeledStep」这一档，不再降到 core-question 的
     * 内置兜底。两者语义相同（同一个 finalMeta 两态），但只有这一档被单测真实覆盖。
     */
    async runLabeledStep(args) {
      const mod = await load('dsh-zhiyun-core-question-stream', 'dsh-zhiyun-core-question-stream/src/index.js');
      return mod.runLabeledStep(args);
    },
    async resolveModelInfo(provider, model) {
      try {
        return await pool.base?.llm?.resolveModelInfo(provider, model) ?? { inputModalities: ['text'] };
      } catch {
        return { inputModalities: ['text'] };
      }
    },

    /**
     * core-question 会传 `{messages, tools, toolChoice, ...}`。
     * 我们把它转成宿主 toolRequest 的形状，交给 pooledCall ——
     * 后者负责 execute/路由/重试/finish 转异常。
     */
    async prepareCall(callConfig = {}) {
      return {
        async *stream(options = {}) {
          const messages = options.messages ?? callConfig.messages ?? [];
          const tools = options.tools ?? callConfig.tools;
          const outerSignal = options.signal ?? callConfig.signal;
          if (!Array.isArray(messages) || !messages.length) {
            throw Object.assign(Error('core-question 没有传 messages'), { code: 'INPUT' });
          }

          // ⚠️ 不能 `yield* pooledCall(...)`：
          // `pooledToolCall` 是给 r3 kernel 用的，返回的是 createToolTransport 的
          // **整体响应对象**（Promise<结果>），不是流。硬套会得到
          // `yield* (intermediate value) is not async iterable`。
          //
          // 这里改用 pool.execute 拿并发调度与路由，在 work 回调里自己流式消费，
          // 并把 finish 失败块翻成异常（不翻的话上层会把「模型没返回内容」当空结果，
          // 最终表现为 0 道题而 problems 里只有一句难懂的传输失败）。
          const collected = await pool.execute(async route => {
            // 宿主的 llm 服务有两层，签名不同，别搞混：
            //
            //   顶层 LlmRuntime.prepareCall(config, signal)          ← config 是对象
            //     └─ 内部: registration(config.provider)
            //              adapter.prepareCall(provider, model, signal) ← 位置参数
            //
            // `pool.base.llm` 是**顶层** LlmRuntime，所以必须传对象。
            // 传位置参数会让 config.provider 变成 undefined → registration() 抛
            // `no adapter registered for provider "undefined"`（NO_ADAPTER）。
            // 2026-10-31 连续两次踩这里：先传 (route, signal) 对象但形状不对，
            // 又改成位置参数 —— 两次都是因为没读宿主实现。
            const prepared = await pool.base.llm.prepareCall({
              provider: route.provider,
              model: route.model,
            }, outerSignal);
            const chunks = [];
            for await (const chunk of prepared.stream({
              // prepared.config 是解析后的完整配置（含 provider/model/temperature 等）
              ...(prepared.config ?? {}),
              ...(tools?.length ? { tools: toHostTools(tools), toolChoice: options.toolChoice ?? callConfig.toolChoice ?? 'auto' } : {}),
              // 宿主靠 source 做会话归因；缺了它审计链路会断。
              messages: toHostMessages(messages),
              signal: outerSignal,
            })) {
              if (chunk.type === 'finish') {
                const error = finishError(chunk.reason);
                if (error) throw error;
              }
              chunks.push(chunk);
            }
            return chunks;
          }, { signal: outerSignal });

          for (const chunk of collected) yield chunk;
        },
      };
    },
  };
}

/** 产品题型 → 新链题型。两套词表不同，转换只在这一处发生。 */
const TYPE_TO_CHAIN = {
  mcq: 'choice',
  trueFalse: 'concept',
  cloze: 'fill_in_blank',
  shortAnswer: 'short_answer',
};

/**
 * 新链词表 → 产品词表。
 *
 * 必须存在，因为两条链的题型词表不同：
 *   产品（question-bank / validateNativeQuestion）：mcq / trueFalse / cloze / shortAnswer
 *   新链（core-question / 上游 vendor）：choice / concept / fill_in_blank / short_answer
 *
 * 2026-10-31 的事故：请求 cloze（填空），但①入参映射查错表 → 按 choice 出；
 * ②出参又把上游词表 fill_in_blank 直接当产品词表返回 → validateNativeQuestion
 * 期望 cloze、收到 fill_in_blank → 全部拒收，界面显示「与请求题型不同」。
 */
const CHAIN_TO_TYPE = Object.fromEntries(Object.entries(TYPE_TO_CHAIN).map(([k, v]) => [v, k]));

/** 产品难度 → 新链难度。 */
const DIFFICULTY_TO_CHAIN = {
  basic: 'easy',
  advanced: 'medium',
  challenge: 'hard',
};

/**
 * 建一个与 `tutor` 同形的后端。
 *
 * @param {object} options
 * @param {object} [options.pool]        worker pool：提供 provider/model 路由
 * @param {object} [options.llmService]  宿主 llm 服务（凭证与传输都在它里面）
 * @param {string} [options.model]       覆盖 pool 里的模型（测试用）
 * @param {Function} [options.wireLabels] 标签实现注入
 */
export function createCoreQuestionBackend({ pool = null, llmService = null, model = null, wireLabels = null, pooledCall = null } = {}) {
  const runs = new Map();
  // 宿主注入的资源登记处；attach 出来的 handle 只有它认得。
  let hostResources = null;
  /**
   * handleId → bundle 的旁路记录。
   *
   * 为什么需要：上游签名是 `runs.start({resourceHandles:[handleId]})`，只给 handle；
   * 而宿主的 resources 没有「按 handle 反查 bundle」的公开方法（只在内部 Map 里存）。
   * 所以本层在 attach 时自己记一份旁路 —— 既能沿用宿主的 schema 校验与快照落盘，
   * 又能拿到出题实际需要的讲义正文。
   */
  const bundleByHandle = new Map();
  const handleBundle = handleId => bundleByHandle.get(handleId) ?? null;
  let sequence = 0;

  return {
    kind: 'core-question',

    /**
     * 资源登记**沿用宿主的**，本层不另建表。
     *
     * 为什么：`bundle` 是宿主用 `resources.fromLecture()` 构造的（带 schema、
     * revision、快照落盘），只有宿主的登记处认识它。本层若自己再建一张表，
     * attach 出来的 handle 与 bundle 的关系就断了 —— 表现为「资源缺失或已释放」。
     *
     * 本层只在 runs 层做适配；resources 直接透传宿主实例（由调用方注入）。
     */
    get resources() {
      return hostResources;
    },

    /**
     * 由调用方在 `hostResources.attach(bundle)` 之后调用一句，把 bundle 记进旁路。
     *
     * 为什么不让本层包装 attach：包装会破坏「资源合法性检查必须在拿到 revision
     * 之前完成」这个顺序（见 host-deeptutor/resources.js 的注释）。旁路记录
     * 是只读的附加信息，不参与校验，所以放在 attach 之后记最安全。
     */
    rememberBundle(handleId, bundle) {
      if (typeof handleId === 'string' && handleId) bundleByHandle.set(handleId, bundle);
    },
    forgetBundle(handleId) {
      bundleByHandle.delete(handleId);
    },
    __setHostResources(registry) {
      hostResources = registry;
    },

    runs: {
      /**
       * 启动一次出题。返回 {runId}，与上游一致。
       *
       * 注意这里**不做 await 等待生成完成**：上游 start 也是立即返回 runId，
       * 真正的进度靠 events() 消费。保持这个异步形状，调用方的 `for await`
       * 循环才不用改。
       */
      async start({ capability, resourceHandles, options = {}, input } = {}) {
        if (capability !== 'deep_question') {
          throw Object.assign(Error(`不支持的 capability：${capability}`), { code: 'E_CAPABILITY_UNAVAILABLE' });
        }
        // resourceHandles 里可能是字符串 id，也可能是 handle 对象（{handleId, revision}）。
        // 上游两种形状都出现过 —— 只按字符串处理会拿整个对象去查表，必然查不到，
        // 报成「资源缺失或已释放」。兼容两种比要求调用方统一更稳妥：
        // 那是上游契约，我们只是消费者，不该假定它被规整过。
        const rawHandle = resourceHandles?.[0];
        const handleId = typeof rawHandle === 'string' ? rawHandle : rawHandle?.handleId;
        const resource = handleBundle(handleId);
        if (!resource) {
          throw Object.assign(Error('出题资源缺失或已释放'), { code: 'E_RESOURCE_INVALID' });
        }

        sequence += 1;
        const runId = `core-run-${sequence}`;
        const config = options.config ?? {};
        // contract.config.question_types 已经是**上游词表**（choice/fill_in_blank/...），
        // 不能再拿它去查 TYPE_TO_CHAIN —— 那张表的键是产品词表，查不到会静默回落成 choice。
        const declaredChainType = config.question_types?.[0];
        const chainType = Object.values(TYPE_TO_CHAIN).includes(declaredChainType)
          ? declaredChainType
          : TYPE_TO_CHAIN[declaredChainType] ?? 'choice';
        // 产品词表：validateNativeQuestion 用它比对 question.type
        const productType = CHAIN_TO_TYPE[chainType] ?? 'mcq';
        const chainDifficulty = DIFFICULTY_TO_CHAIN[config.difficulty] ?? 'easy';
        const count = Number(config.num_questions ?? input?.count ?? 1);

        // 事件缓冲：events() 被消费时按序吐出。用队列 + 完成标记，
        // 让「先跑完再被消费」和「边跑边消费」两种时序都能工作。
        const pending = [];
        const waiters = [];
        let finished = false;
        let result = null;
        let failure = null;

        const push = event => {
          pending.push(event);
          const w = waiters.shift();
          if (w) w();
        };

        const controller = new AbortController();
        // 事件队列与完成标记必须挂在 run 状态上：events() 是另一个方法，
        // 闭包里的局部变量它访问不到（那正是曾经报 pending is not defined 的原因）。
        // 用普通对象而不是 getter：完成标记要能被异步任务写入，
        // getter 只读会让 result() 永远看到初始值。
        const runState = { controller, cancel: () => controller.abort(), pending, waiters, finished: false, result: null };
        runs.set(runId, runState);

        // 不 await：让 start 立刻返回，与上游时序一致。
        (async () => {
          try {
            const { runDeepQuestion } = await load('dsh-zhiyun-core-question', 'dsh-zhiyun-core-question/src/index.js');
            const { createToolRegistry } = await load('dsh-zhiyun-core-tool', 'dsh-zhiyun-core-tool/src/index.js');
            const { createLectureTools } = await load('dsh-zhiyun-core-lecture-tools', 'dsh-zhiyun-core-lecture-tools/src/index.js');

            if (wireLabels) wireLabels();

            // 模型从哪来，按优先级三档：
            //
            // 1. `llmService`（宿主显式注入）—— 生产环境走这条，凭证与路由都在它里面。
            // 2. `pool.base.llm` —— 测试注入的假模型就在这里。
            //    这不是测试专用后门：产品里 pool 也是用真实 llm 服务构造的，
            //    所以这条路径在生产和测试里语义一致，只是实例不同。
            // 3. 自己按 pool 路由 + 环境变量建一个 —— 仅当上面都没有时的兜底。
            //
            // 为什么 2 必须存在：完整挂载链路（Workbench → QuestionBank → createNativeQuizRun
            // → 本适配层）如果只能接受真实模型，那这条链路就永远无法在测试里验证，
            // 「切换成功」只能靠人肉跑一次得出。深度集成要求它可测。
            // 模型路由：provider 必须用宿主注册表里的名字（例如 deepseek-official），
            // 不能硬编码成 deepseek —— 那会让宿主找不到适配器。
            const route = pool?.snapshot?.[0] ?? null;
            const effectiveModel = model ?? route?.model ?? 'deepseek-chat';
            const effectiveProvider = route?.provider ?? 'deepseek';
            const injected = llmService ?? pool?.base?.llm ?? null;
            // 模型调用有三条路，优先级从高到低：
            //
            // 1. `pooledCall` + `pool`（生产环境走这条）
            //    经过 `pooledToolCall`，拿到并发调度、source 归因、
            //    finish 失败转异常、传输重试 —— 少了任何一条都会掉进
            //    「16 秒 8 并发全失败 / 0 道可用」这类现象里。
            // 2. `llmService` 直接注入（测试用假模型）
            // 3. 自建 client（命令行/无宿主的兜底）

            let llm;
            // 只要拿到 pool 就走宿主调度：并发配额、路由、失败块转异常
            // 全在 pool.execute 里。不再依赖 pooledCall ——
            // 那是 r3 kernel 的传输层（返回整体响应而非流），与出题链语义不同。
            if (pool && typeof pool.execute === 'function') {
              llm = createPoolBackedLlm(pool, pooledCall);
            } else if (llmService) {
              llm = llmService;
            } else {
              // 不再自建 HTTP 客户端。
              //
              // 宿主的 dsh-llm 才是唯一的传输层：它管鉴权、SSE、usage、重试、
              // idle watchdog，以及 provider 方言差异（OpenAI 兼容 / Anthropic Messages）。
              // 自己再实现一套的后果是「两套栈各修一半」——今天一整天的
              // TRANSPORT / NO_ADAPTER 就来自在这里绕开了宿主。
              //
              // 没有宿主就不能出题：宁可明确报错，也不要偷偷走另一条路。
              throw Object.assign(
                Error('出题需要宿主模型服务（dsh-llm），当前没有拿到；请检查是否已选择出题模型'),
                { code: 'NOT_WIRED' },
              );
            }
            // ⚠️ 传的是 bundle 本身，不是 bundle.lecture。
            //
            // bundle 是 resources.fromLecture() 的产物，它的顶层就有 chapters
            // （规范化后的讲义）。**没有 lecture 字段** —— 取 bundle.lecture 得到 undefined，
            // buildLectureIndex 于是建出 0 个块，rag / kb_files / read_source 全部读到空。
            //
            // 模型拿不到讲义时的行为不是报错，而是编造：真机上它输出
            // 「本轮讲义知识库为空（0 篇文档）…下面这道题是按模板定型的占位原型」，
            // 然后给出一道和课程无关的占位题。这比报错危险得多。
            const registry = createToolRegistry();
            // kbName 是 rag 的 kb_name 缺省值。不给它时 tool_kwargs 里补不上，
            // rag 会直接报 "RAG requires an explicit kb_name" —— 模型于是拿不到检索结果，
            // 只剩下「凭印象编」这一条路。上游 vendor 的默认名就是 'lecture'。
            for (const tool of createLectureTools({ lecture: resource, knowledge: { kbName: 'lecture' } })) {
              registry.register(tool);
            }

            const produced = await runDeepQuestion({
              // 同上：bundle 本身就是讲义（顶层 chapters），不是 bundle.lecture。
              lecture: resource,
              count,
              type: chainType,
              difficulty: chainDifficulty,
              llm,
              tools: registry,
              signal: controller.signal,
              onEvent: ({ stage }) => {
                // 只透传上游认识的三个 stage，其余丢弃 —— 界面按这三键查表。
                if (STAGES.has(stage)) push({ stage });
              },
              config: { language: 'zh', questionTypes: [chainType] },
            });

            result = {
              status: 'succeeded',
              upstreamCommit: 'core-question-v1',
              // 形状对齐上游 result.questions：type 用产品词表，options 给字典。
              questions: (produced.questions ?? []).map(q => ({
                // 必须回产品词表：validateNativeQuestion 会比对 question.type === 请求的 type
                type: productType,
                stem: q.stem,
                answer: q.answer,
                explanation: q.explanation ?? '',
                options: Object.fromEntries((q.choices ?? []).map(c => [c.label, c.text])),
                topic: q.topic ?? '',
                difficulty: q.difficulty ?? 'easy',
              })),
            };
          } catch (error) {
            failure = { kind: error?.code ?? 'E_UPSTREAM_ERROR', message: error?.message ?? String(error) };
            result = { status: 'failed', error: failure, questions: [] };
          } finally {
            finished = true;
            runState.finished = true;
            runState.result = result;
            const w = waiters.shift();
            if (w) w();
          }
        })();

        return { runId };
      },

      /** 按序吐事件；跑完后自然结束。 */
      async *events({ runId } = {}) {
        const state = runs.get(runId);
        if (!state) {
          throw Object.assign(Error('未知的 runId'), { code: 'E_RUN_NOT_FOUND' });
        }
        for (;;) {
          if (state.pending.length) {
            yield state.pending.shift();
            continue;
          }
          if (state.finished) return;
          await new Promise(resolve => state.waiters.push(resolve));
        }
      },

      /** 取终态结果。上游调用方会先消费 events 再取 result。 */
      async result(runId) {
        const state = runs.get(runId);
        if (!state) {
          throw Object.assign(Error('未知的 runId'), { code: 'E_RUN_NOT_FOUND' });
        }
        // 等它跑完；调用方通常已经消费完 events，这里只是兜底。
        while (!state.finished) await new Promise(resolve => setTimeout(resolve, 20));
        return state.result ?? { status: 'failed', error: { kind: 'E_UPSTREAM_ERROR', message: '没有结果' }, questions: [] };
      },

      /** 幂等取消：真正的中断靠 AbortSignal 传进流水线。 */
      async cancel(runId) {
        const state = runs.get(runId);
        if (state) state.cancel();
        return { cancelled: Boolean(state) };
      },

      async reply(runId) {
        // 新链不需要补充输入（没有 PAUSE 交互），返回空确认即可。
        return { ok: true, runId };
      },
    },

    async dispose() {
      for (const state of runs.values()) state.cancel();
      runs.clear();
      resources.clear();
    },

    /** 仅供测试：当前活跃 run 数。 */
    get activeRuns() {
      return runs.size;
    },
  };
}
