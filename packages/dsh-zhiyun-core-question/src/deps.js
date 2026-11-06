/**
 * 跨包依赖解析。
 *
 * # 为什么要这么绕
 *
 * 本包在运行时需要 core-tool 的循环/调度（`runAgenticLoop`、`dispatchToolCalls`）
 * 和预算函数。仓库的 workspace 依赖按裸包名 import，但本机 `node_modules` 里目前
 * 没有这几个新包的软链（`npm install` 没把它们链进来）。若直接写裸包名 import，
 * 单测连模块都加载不了；若直接写相对路径，集成层装包后又与仓库约定不符。
 *
 * 所以：**先试裸包名，失败再试同仓相对路径**。两条路都走的是同一份源码，
 * 不存在"测试跑的和产品跑的不是一个文件"这种问题。
 */

async function tryImport(candidates) {
  const failures = [];
  for (const specifier of candidates) {
    try {
      return await import(specifier);
    } catch (error) {
      failures.push(`${specifier}: ${error?.code ?? error?.message ?? error}`);
    }
  }
  const error = new Error(`无法加载依赖：\n  ${failures.join('\n  ')}`);
  error.code = 'DEPENDENCY_UNAVAILABLE';
  throw error;
}

const coreTool = await tryImport([
  'dsh-zhiyun-core-tool',
  '../../dsh-zhiyun-core-tool/src/index.js',
]);

/**
 * 流式标签层是可选的：core-tool 必须有（循环/调度是骨架），
 * 而标签读写可以在本包兜底实现与独立包之间互换。缺了它不能让整个包加载失败
 * —— 那会让「只想跑一遍流水线单测」变成必须先把所有包都装齐。
 *
 * 包名是 question-stream 而不是 core-llm：后者听起来像一套 LLM 客户端，
 * 会诱导人去重复实现宿主 dsh-llm 已有的传输层（序列化 / SSE / usage / 重试）。
 */
const questionStream = await tryImport([
  'dsh-zhiyun-core-question-stream',
  '../../dsh-zhiyun-core-question-stream/src/index.js',
]).catch(() => null);

export const coreLlmRunLabeledStep = questionStream?.runLabeledStep ?? null;

export const runAgenticLoop = coreTool.runAgenticLoop;
export const dispatchToolCalls = coreTool.dispatchToolCalls;
export const createStreamBus = coreTool.createStreamBus;
export const StreamBus = coreTool.StreamBus;
export const assistantMessage = coreTool.assistantMessage;
export const assistantMessageWithToolCalls = coreTool.assistantMessageWithToolCalls;
export const buildTraceMetadata = coreTool.buildTraceMetadata;
export const mergeTraceMetadata = coreTool.mergeTraceMetadata;
export const newCallId = coreTool.newCallId;
export const MAX_PARALLEL_TOOL_CALLS = coreTool.MAX_PARALLEL_TOOL_CALLS;
export const findInlineLabels = coreTool.findInlineLabels;

/**
 * 整卷模型调用预算：`10 + 2 + 9N`。
 *
 * 直接转发 core-tool 的实现，**不在这里重写公式**：公式有两处，迟早会漂移，
 * 而漂移的表现是"第 12 题开始全部走强制收尾"这种很难归因的劣化。
 */
export const pipelineModelCallBudget = coreTool.pipelineModelCallBudget;
