/**
 * 解析域：`zhiyunParser` 的全部对外动作 + 建树/重构的纯函数。
 *
 * # 两段桥，分开说
 *
 * **① 服务动作**（`parse` / `parseClassroom` / `dispose`）：必须经 `apply()`
 * 拿真服务 —— 它们依赖注入进来的 llm、attachments、路由解析。基准通过
 * `parse()` 跑一条**不调真模型**的完整链路（llm 是可编程桩）。
 *
 * **② 建树与重构的纯函数**（筛支线 → 挂账 → 审查 → 合并 → 拆叶 → 重聚 →
 * 聚合）：它们**不需要** ctx，是纯函数。基准要单独度量"斩杀线取多少、
 * 长尾切分对不对、知识点数合不合理"，就必须能直接调它们 —— 而不是为了
 * 调一个纯函数先造一整个解析。
 *
 * 两段都从**产品那一份**取，不在基准里重写。
 */

import { mount, serviceOf, apiOf, hostLlm, urlOf } from './_base.mjs';

/** 纯函数模块（建树与重构）。 */
export async function treeModule() {
  return import(urlOf('dsh-zhiyun-core-parser', 'src/tree.js'));
}

/** 流水线模块（队列与 worker 池）。 */
export async function pipelineModule() {
  return import(urlOf('dsh-zhiyun-core-parser', 'src/pipeline.js'));
}

/** token 估算模块。 */
export async function tokenizeModule() {
  return import(urlOf('dsh-zhiyun-core-parser', 'src/tokenize.js'));
}

/** 阶段名与顺序。 */
export async function stagesModule() {
  return import(urlOf('dsh-zhiyun-core-parser', 'src/stages.js'));
}

/**
 * 建树/重构的**全部**功能函数（一次性取齐，基准用哪个拿哪个）。
 *
 * @returns `{ sieveBlocks, stashBlocks, orthogonalize, mergeLeaf, ... }`
 */
export async function treeFunctions() {
  const m = await treeModule();
  return {
    FACET: m.FACET,
    facetRole: m.facetRole,
    kDefaultSplitLine: m.kDefaultSplitLine,
    kMaxLeafDepth: m.kMaxLeafDepth,
    sieveBlocks: m.sieveBlocks,
    stashBlocks: m.stashBlocks,
    orthogonalize: m.orthogonalize,
    mergeLeaf: m.mergeLeaf,
    zipfRanges: m.zipfRanges,
    leafTreeDepth: m.leafTreeDepth,
    leafLevelNodes: m.leafLevelNodes,
    flattenLeaves: m.flattenLeaves,
    regroupLeaves: m.regroupLeaves,
    aggregate: m.aggregate,
    buildTreeFromBlocks: m.buildTreeFromBlocks,
  };
}

/** 流水线的功能函数（队列 + 调度）。 */
export async function pipelineFunctions() {
  const m = await pipelineModule();
  return { SharedQueue: m.SharedQueue, runPipeline: m.runPipeline };
}

/** token 估算的功能函数。 */
export async function tokenizeFunctions() {
  const m = await tokenizeModule();
  return { tokensOf: m.tokensOf, tokensOfAll: m.tokensOfAll, formatTokens: m.formatTokens };
}

/**
 * 装配真解析器服务。
 *
 * @param options.dataDir - 落盘目录。
 * @param options.respond - **模型回包函数** `(request) => string`。
 *   给的是"模型说什么"，不是"一个 llm 对象"—— 因为中间还有产品自己的
 *   `HarnessLlm` 适配层（路由解析 / 档位 / 超时），基准要测的正是那条路。
 *   不给就抛 `NOT_CONFIGURED`（不允许"看起来能跑"的默认回包）。
 * @param options.config - 解析器配置（`concurrency` / `visionBatchSize` /
 *   `splitLine` / `queueCapacity` 等），原样透传给包的 `apply`。
 * @returns `{ mounted, service, functions, getters }`
 */
export async function mountParser({ dataDir, respond, config = {} } = {}) {
  const host = hostLlm(respond);
  // 解析器 `inject` 了 `zhiyunClassroom`，但基准不跑真课堂：给一个
  // **明确报错**的替身，好过让它变成 undefined 然后在深处炸。
  const classroom = {
    async getLessonContent() {
      throw Object.assign(new Error('基准台没有接课堂数据源：请直接用 parse({slides,subtitles})'), { code: 'NO_CLASSROOM' });
    },
    transport: { request() { throw Object.assign(new Error('基准台没有接课堂出口'), { code: 'NO_CLASSROOM' }); } },
  };
  const mounted = await mount('dsh-zhiyun-core-parser', {
    dataDir,
    // 这一层的 ctx.llm 必须是**宿主形状**（prepareCall / resolveModelInfo），
    // 因为包内部要用产品自己的 HarnessLlm 去适配它。
    services: { llm: host, zhiyunClassroom: classroom },
    config,
  });
  const service = serviceOf(mounted, 'zhiyunParser');
  const api = apiOf(service);
  // 功能名摊到顶层（与 `pureApi()` 的形状一致），调用方不必记两层。
  return { mounted, service, host, ...api.functions, getters: api.getters };
}

/**
 * 只要纯函数、不要服务：给"只测算法"的基准用例用（不起解析器、不装配）。
 */
export async function pureApi() {
  const [tree, pipeline, tokenize, stages] = await Promise.all([
    treeFunctions(), pipelineFunctions(), tokenizeFunctions(), stagesModule(),
  ]);
  return { ...tree, ...pipeline, ...tokenize, STAGE: stages.STAGE, STAGE_NAME: stages.STAGE_NAME, STAGE_ORDER: stages.STAGE_ORDER, stageNo: stages.stageNo };
}
