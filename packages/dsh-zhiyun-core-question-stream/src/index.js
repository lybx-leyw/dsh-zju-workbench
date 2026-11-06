/**
 * 标签驱动的流式读写。
 *
 * # 这个包为什么存在、为什么不叫 core-llm
 *
 * 出题流水线的每个阶段都要「发一次流式请求，边读边判断这一轮属于哪个协议标签
 * （ explore 的 FINISH/TOOL/THINK、plan 的 PLAN、quiz 的 FINISH ）」。
 * 宿主的 `dsh-llm` 提供的是**传输**：序列化、HTTP、SSE、usage、重试、鉴权 ——
 * 它不认识协议标签这个概念。
 *
 * 所以这里只补宿主没有的那一层：标签状态机。**它不发起任何 HTTP 请求**，
 * 所有传输都由调用方注入的 `client.prepareCall()` 完成（生产环境里那是
 * `pool.base.llm`，即宿主的 LlmRuntime）。
 *
 * # 命名
 *
 * 之前的名字 `dsh-zhiyun-core-llm` 极易误导：看起来像「一套 LLM 客户端」，
 * 于是有人会以为它可以替代宿主的 `dsh-llm`，甚至在里面重复实现
 * 序列化 / SSE 解析 / usage 计量（那 3300 行后来全部闲置）。
 * 现在名字直接说明职责：question-stream —— 出题链的流式标签层。
 */
export { runLabeledStep } from './labeled-step.js';
export {
  LABEL_UNKNOWN,
  LABEL_PROBE_MAX_CHARS,
  LABEL_SEPARATOR_CHARS,
  classifyLabel,
  stripLabelProbePrefix,
  recoverFinishedLabel,
  findInlineLabels,
} from './labels.js';
export { InlineThinkFilter, cleanThinkingTags } from './think.js';
export { fromChunkUsage, messageContentChars, recordStreamedUsage } from './usage-frame.js';
