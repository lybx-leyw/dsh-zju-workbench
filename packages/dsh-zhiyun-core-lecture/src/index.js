/**
 * **Cordis 插件包装（薄）**：只做两件事 —— 从注入项取 llm、把加工器挂上 ctx。
 *
 * # 为什么是「薄」
 *
 * 本包的算法层（tree / register / polish）必须能**脱离宿主单测**：知识树是纯函数、
 * 验收是纯函数、习坎只依赖一个窄 llm 接口。宿主相关的取舍（用哪个模型、
 * 缓存放哪、并发配多少）一律留给集成层 —— 那些是会随宿主变化的东西，
 * 混进算法层就会让「同一份算法」在换宿主时被迫改。
 *
 * # ⚠️ 本文件**不碰** ctx.storage
 *
 * 课题约束：本包不落盘、不读环境变量。加工缓存（哪些知识点已经写成了稿）
 * 由集成层用宿主 `ctx.storage` 负责 —— 那是宿主已有的能力，
 * 在这里自己写一遍文件就是本仓明令禁止的「重复造轮子」。
 *
 * # llm 从哪来
 *
 * 宿主的 `ctx.llm` 服务形状是 `prepareCall / stream`（流式、带模型解析），
 * 而本包要的是窄接口 `call({stage, route, constant, variable, signal})`。
 * 那层适配**已经存在**：`dsh-zhiyun-core-parser` 的 `HarnessLlm` 就是它，
 * 且它挂在 `ctx.zhiyunParser.llm` 上（study 包已经在这样用）。
 * 所以这里直接取用，而不是再写第三个适配器 —— 本仓对「同一件事有两份实现」
 * 是明令禁止的（两条路会在半年内无声漂开）。
 *
 * 若集成层要用别的适配器，`config.llm` 可以直接注入一个同形状的对象。
 */

import { createLectureAssembler, kLecturePolishSystemPrompt } from './polish.js';
import { PATCH_INSTRUCTION } from './polish-patch.js';
import { buildLectureTree } from './tree.js';
import { judgeWritten } from './register.js';
import { exportReorganization, mergeReorganization } from './agent-text.js';
import { LectureError } from './errors.js';
import { generateLecture } from './generate.js';
export { GENERATION_VERSION } from './generate.js';

export const name = 'zhiyun-lecture';

/**
 * 依赖声明：`zhiyunParser` 提供宿主适配好的窄 llm。
 *
 * ⚠️ 声明它（而不是 `llm`）是有意的：直接用 `ctx.llm` 就得在本包内重写一遍
 *    `prepareCall / resolveModelInfo / stream` 的适配，那是解析器包已有的活。
 *    声明依赖也让「谁提供模型」这件事对宿主可见 —— 靠 `ctx.llm` 猜出来
 *    反而是隐式魔法。
 */
export const inject = ['zhiyunParser'];

export function createLectureService(config = {}) {
  const llm = config.llm;
  if (!llm || typeof llm.call !== 'function') {
    throw new LectureError('CONFIG', '讲义加工需要注入窄 llm 接口（{ call({stage,route,constant,variable,signal}) }）；'
      + '宿主侧由 zhiyunParser 提供，也可用 config.llm 直接给出');
  }

  // 路由**延迟解析**：插件激活不该因为「模型还没配好」而失败 ——
  // 没配模型时用户仍应能用知识树与书面语验收（那两条一次模型调用都不发）。
  let resolving;
  const resolveRoute = async (signal) => {
    if (typeof llm.resolve !== 'function') return undefined;
    resolving ??= llm.resolve(signal, { vision: false })
      .then((routes) => routes?.text ?? routes?.vision)
      .finally(() => { resolving = null; });
    return resolving;
  };

  const assembler = createLectureAssembler({
    cache: config.cache,
    llm: {
      resolve: resolveRoute,
      call: async (request) => {
        const resolved = await resolveRoute(request.signal);
        const baseRoute = request.route ?? resolved;
        const route = request.stage === 'lecture-polish' ? { ...baseRoute, maxTokens: 32768 } : baseRoute;
        return llm.call({ ...request, route });
      },
    },
    concurrency: config.concurrency,
    maxTopics: config.maxTopics,
    maxChars: config.maxChars,
  });

  // 暴露给集成层：光有 assemble 不够 —— 树与验收是它拼装输入前的两步。
  //
  // ⚠️ 把这两个纯函数**一起挂上来**是有意的：它们是 assemble 的输入契约
  //    （树决定分章分知识点、验收决定正文算不算成稿）。集成层如果自己
  //    `import` 子路径去拼，就等于把「输入到底该长什么样」在两处各写一遍 ——
  //    那正是本仓说过的「同一件事有两份实现，半年内无声漂开」。
  //
  // `polish` 也一样：它要的 `text` / `merge` 必须与装配层**同一份 codec**
  // （`exportReorganization` / `mergeReorganization`），否则"导出的格式"与
  // "合回的格式"会在两处各自演化。所以这里把 codec 一起交出去，让集成层
  // 只负责"什么时候润色"，不负责"润色的文本长什么样"。
  const service = {
    assemble: assembler.assemble,
    /**
     * 全文润色（习坎最后一步）。
     *
     * @param {{lecture:object, record:object, sectionId:string, signal?:AbortSignal}} input
     *   `record` 是解析终稿（只需要 `blocks` 与 `outline`）—— 合回时要按它
     *   校验"原稿块全覆盖、来源不越界"。导出的文本与合回的函数在**这里**
     *   一次配好，集成层不需要知道格式。
     */
    polish: async ({ lecture, record, sectionId, signal, onProgress }) => {
      if (assembler.closed) throw new LectureError('DISPOSED', '讲义加工器已关闭');
      signal?.throwIfAborted();
      const id = String(sectionId ?? lecture?.title ?? '');
      const text = exportReorganization(lecture, id, record ?? { blocks: [], outline: [] });
      const merge = t => mergeReorganization(lecture, t, record ?? { blocks: [], outline: [] }, id);
      // Validate the harness's own source contract before spending review tokens.
      merge(text);
      const cache = config.cache;
      const resolved = await resolveRoute(signal);
      const key = cache?.key('lecture-polish-scoped-v2', [resolved, kLecturePolishSystemPrompt, PATCH_INSTRUCTION, text]);
      if (key) {
        const saved = await cache.get(key);
        if (saved) {
          try {
            const result = JSON.parse(saved.raw);
            const checked = merge(result.text);
            signal?.throwIfAborted();
            const total = lecture.chapters.reduce((n, c) => n + c.topics.length, 0);
            onProgress?.({ phase: 'polish', done: total, total, cached: true });
            return { ...result, lecture: checked.lecture, coverage: checked.coverage, calls: [], cached: true };
          } catch (error) { if (signal?.aborted) throw error; }
        }
      }
      const result = await assembler.polish({
        lecture, text, signal, onProgress, cache, cacheRoute: resolved, allowPartial:true,
        merge,
      });
      const checked = merge(result.text);
      if (key && result.complete !== false) await cache.put(key, JSON.stringify(result));
      return { ...result, lecture: checked.lecture, coverage: checked.coverage, cached: false };
    },
    buildTree: buildLectureTree,
    judgeWritten,
    dispose: assembler.dispose,
    get concurrency() { return assembler.concurrency; },
    get active() { return assembler.active; },
    get closed() { return assembler.closed; },
  };

  service.generate = input => generateLecture({ ...input, service });

  service.createRun = options => createLectureService({ ...config, ...options });
  return service;
}

export async function apply(ctx, config = {}) {
  const service = createLectureService({ ...config, llm: config.llm ?? ctx.zhiyunParser?.llm,
    cache: config.cache ?? ctx.zhiyunParser?.cache });
  const removeService = ctx.provide('zhiyunLecture', service);
  return () => { service.dispose(); removeService?.(); };
}
