/**
 * 讲义域：`zhiyunLecture` 的两级加工 + 知识树构建。
 *
 * 两级都在这里桥出来，因为它们是**一条链的两段**，分开测会漏掉衔接：
 *   一级 `assemble`：树 + 主线块 → 分章分知识点的讲义正文（口语→书面）
 *   二级 `polish`  ：全文润色 —— **只改写法、不改事实**的六项规整
 *
 * 另外 `buildTree` 是 `assemble` 的输入契约（树决定分章分知识点），
 * 所以也一起桥出来：基准要能"只测建树"而不发一次模型调用。
 */

import { mount, serviceOf, apiOf, stubLlm, urlOf } from './_base.mjs';

/** 纯函数模块（讲义提示词、校验、正文装配、润色清单）。 */
export async function polishModule() {
  return import(urlOf('dsh-zhiyun-core-lecture', 'src/polish.js'));
}

/** 知识树模块（从页面文字建树）。 */
export async function treeModule() {
  return import(urlOf('dsh-zhiyun-core-lecture', 'src/tree.js'));
}

/** 讲义文本 codec（导出/合回）。润色必须与装配用同一份，否则格式会漂。 */
export async function agentTextModule() {
  return import(urlOf('dsh-zhiyun-core-lecture', 'src/agent-text.js'));
}

/** 书面语验收模块。 */
export async function registerModule() {
  return import(urlOf('dsh-zhiyun-core-lecture', 'src/register.js'));
}

/**
 * 建树 + 验收 + 文本 codec 的**纯函数**（不需要 ctx）。
 */
export async function pureApi() {
  const [polish, tree, agentText, register] = await Promise.all([
    polishModule(), treeModule(), agentTextModule(), registerModule(),
  ]);
  return {
    // 建树
    buildLectureTree: tree.buildLectureTree,
    normalizeLectureTree: tree.normalizeLectureTree,
    // 验收
    judgeWritten: register.judgeWritten,
    // 文本 codec（润色的导出与合回，必须成对使用）
    exportReorganization: agentText.exportReorganization,
    mergeReorganization: agentText.mergeReorganization,
    exportLectureForAgent: agentText.exportLectureForAgent,
    mergeAgentLectureText: agentText.mergeAgentLectureText,
    // 润色的提示词与判据
    kLecturePolishSystemPrompt: polish.kLecturePolishSystemPrompt,
    kPolishItems: polish.kPolishItems,
    POLISH_ITEM_NAMES: polish.POLISH_ITEM_NAMES,
    buildPolishVariable: polish.buildPolishVariable,
    describePolishChanges: polish.describePolishChanges,
    // 一级加工的常量与校验
    kStageName: polish.kStageName,
    kMaxTopicsPerCall: polish.kMaxTopicsPerCall,
    kLecturePolishSchema: polish.kLecturePolishSchema,
    checkPolishFiller: polish.checkPolishFiller,
    checkPolishLength: polish.checkPolishLength,
    checkPolishShrink: polish.checkPolishShrink,
    isBrokenOutput: polish.isBrokenOutput,
    parseLecturePolishResponse: polish.parseLecturePolishResponse,
  };
}

/**
 * 装配真讲义服务。
 *
 * ⚠️ lecture 包要的是**窄 llm 接口**（`{ call({stage,route,constant,variable,signal}) }`），
 *    不是宿主的 `prepareCall` 形状 —— 它是从 `ctx.zhiyunParser?.llm` 借的，
 *    而那个 llm 已经被解析器适配过。所以这里给窄接口桩；这与
 *    `mountParser()` 要给宿主形状的 llm 是两件事，不能混。
 *
 * @param options.dataDir - 落盘目录。
 * @param options.respond - **模型回包函数** `(request) => string`。
 * @param options.config - 透传给 `apply` 的配置（`concurrency` / `maxTopics` / `maxChars`）。
 */
export async function mountLecture({ dataDir, respond, config = {} } = {}) {
  const narrow = stubLlm(respond);
  const mounted = await mount('dsh-zhiyun-core-lecture', {
    dataDir,
    config,
    // lecture 的 llm 来源：`config.llm ?? ctx.zhiyunParser?.llm`
    services: { zhiyunParser: { llm: narrow } },
  });
  const service = serviceOf(mounted, 'zhiyunLecture');
  const api = apiOf(service);
  return { mounted, service, llm: narrow, ...api.functions, getters: api.getters };
}
