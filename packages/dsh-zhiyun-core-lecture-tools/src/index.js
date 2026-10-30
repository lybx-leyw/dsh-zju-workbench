/**
 * `dsh-zhiyun-core-lecture-tools` —— 出题专用工具集。
 *
 * # 这个包搬的是什么
 *
 * 上游 DeepTutor 出题时挂载的工具来自 `tools/builtin/__init__.py`（2260 行，
 * 混着代码执行 / 网页抓取 / 语音 / 图像生成等大量与出题无关的东西）。
 * 到底挂哪几个，由 `agents/question/pipeline.py` 决定：
 *
 * ```python
 * def _mount_flags(self, context):          # 1596
 *     return ToolMountFlags(
 *         has_kb=bool(self.kb_name and not pageindex_context),
 *         has_sources=bool(self._source_index(context)),
 *         has_question_bank=user_has_question_bank(),
 *         ...)
 *
 * def _resolved_tools(self, context):       # 1606
 *     names = compose_enabled_tools(registry=..., requested_tools=self.enabled_tools,
 *                                   optional_whitelist=default_optional_tools(),
 *                                   mount_flags=self._mount_flags(context))
 *     return drop_unconfigured_generation_tools([*names, *pageindex_tool_names])
 * ```
 *
 * `compose_enabled_tools` 的结果对纯讲义出题是：
 *
 * | 来源 | 工具 |
 * |---|---|
 * | 用户开关（`USER_TOGGLEABLE_TOOL_NAMES` ∩ `optional_whitelist`） | 默认为空 |
 * | 条件挂载 `has_kb` | `rag`, `kb_files`, `knowledge_frontier` |
 * | 条件挂载 `has_sources` | `read_source` |
 * | 条件挂载 `has_question_bank` | `question_bank` |
 * | 常开追加 | `write_memory`, `learning_status`, `learning_update`, `web_fetch`, `github`, `ask_user`, `cron` |
 * | workspace 基线 | `workspace_list`, `workspace_read`, `workspace_search`, `workspace_present` |
 *
 * 其中与「讲义/出题」真正相关的只有四个：**`rag` / `kb_files` / `read_source` /
 * `question_bank`**（`knowledge_frontier` 需要 arXiv 联网、`web_fetch` / `github` /
 * `cron` / `ask_user` / `write_memory` 属于产品侧交互与记忆、`workspace_*` 是文件工作区、
 * `learning_*` 是学习日志）。本包就这四个。
 *
 * # 三个不能让步的取舍
 *
 * 1. **description / parameters 逐字来自上游**，存在 `src/data/upstream.json`，
 *    由 `tools/gen-lecture-tool-data.py` 从 vendor 生成。
 *    手改那个 JSON 而没重跑脚本 = 悄悄改变模型行为。
 * 2. **工具读内存里的讲义**，不调外部服务。数据就在手上，再造一个检索服务
 *    只会制造第二个真相源。
 * 3. **handler 返回 `{ok, result} | {ok:false, error}`**（任务书契约），
 *    而 `result` 内部是上游 `ToolResult` 的形状（`content` 是**裸文本**，
 *    结构化信息放 `metadata`）。core-tool 的 `normalizeHandlerResult()` 认得这个形状。
 *
 * # 与 core-tool 的关系
 *
 * 本包**不 import core-tool**：它只需要「工具是普通对象」这一个约定。
 * 集成层按需把这里的结果 `register()` 进注册表即可。这样本包的单测不需要
 * 拉起整个工具协议栈，而两边的 schema 形状已经对齐（见 `schema.js`）。
 */

import { allToolDefinitions, LECTURE_TOOL_NAMES, UPSTREAM_DATA, UPSTREAM_SOURCE } from './definitions.js';
import { buildLectureIndex, sortSourceIds } from './lecture-index.js';
import { createRagHandler } from './rag.js';
import { createKbFilesHandler } from './kb-files.js';
import { createReadSourceHandler } from './read-source.js';
import { createQuestionBankHandler } from './question-bank.js';
import { lectureToolSchemas, decorateSchema } from './schema.js';
import {
  buildToolListText,
  composePromptText,
  createPromptComposer,
  fallbackEmptyToolList,
  loadPromptHints,
  normalizeHintLanguage,
  promptHintsFor,
} from './prompt-hints.js';

export const name = 'zhiyun-lecture-tools';

/**
 * 同层的 `core-tool` / `core-llm` 都**不是** Cordis 插件（没有 `apply` / `inject`）：
 * 它们是纯函数库，由集成层显式 import 调用。本包沿用同一条约定 ——
 * 工具集是"每个 turn 用不同讲义构造一次"的东西，做成插件级单例反而会串课
 * （上一轮讲义留在闭包里）。所以这里只导出工厂，没有 `apply`。
 *
 * `createLectureTools` 也不依赖宿主任何服务：纯函数 + 调用方注入的纯数据
 * （`lecture` / `knowledge` / `history`）。

/**
 * 建出题工具集。
 *
 * @param {object} [options]
 * @param {object} [options.lecture]   `{chapters:[{title, topics:[{title, blocks:[{kind,text}]}]}]}`
 *        —— 与 `dsh-zhiyun-core-learning-resource` 的 lecture bundle 同形。
 * @param {object} [options.knowledge] 可选的预建索引 / 知识库附加信息。
 *        - `knowledge.index`：已由 `buildLectureIndex()` 建好的索引（复用，避免重复建）；
 *        - `knowledge.kbName`：`rag` 的 `kb_name` 缺省值（上游 `_augment_tool_kwargs` 的
 *          `kwargs.setdefault("kb_name", self.kb_name)`）；同时作为 schema 里 `kb_name.enum`。
 * @param {object|Array} [options.history] 历史题（数组，或与上游 store 同形的异步对象）。
 * @param {string} [options.language]  `'zh'` / `'en'`；影响工具的输出语言，不影响 schema。
 * @returns {Array<{name: string, description: string, parameters: object, handler: Function}>}
 */
export function createLectureTools({ lecture, knowledge, history, language = 'en' } = {}) {
  const index = knowledge?.index ?? buildLectureIndex(lecture);
  const kbName = typeof knowledge?.kbName === 'string' ? knowledge.kbName.trim() : '';
  const lang = normalizeHintLanguage(language);
  // `index` / `lecture` 传下去是为了让 handler 能看见本轮的讲义上下文；
  // `language` 是唯一被 handler 真正读取的 ctx 字段（其余留作集成层扩展点）。
  const ctxDefaults = { language: lang, index, lecture, kbName };

  const rag = createRagHandler({ index });
  const handlers = {
    // 上游 `_augment_tool_kwargs()`（pipeline.py:1670）对 `rag` 做
    // `kwargs.setdefault("kb_name", self.kb_name)`：本轮挂载的知识库只有一个时，
    // 模型漏填 kb_name 也能落到正确的那一个。`setdefault` 语义 —— 模型给了就不覆盖。
    rag: async (args, ctx) => {
      const merged = kbName && !String(args.kb_name ?? '').trim()
        ? { ...args, kb_name: kbName }
        : args;
      return rag(merged, ctx);
    },
    kb_files: createKbFilesHandler({ index }),
    read_source: createReadSourceHandler({ sources: index.sources }),
    question_bank: createQuestionBankHandler({ history }),
  };

  return allToolDefinitions().map((definition) => {
    const handler = handlers[definition.name];
    return {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
      /**
       * `async (args, ctx) => ({ok:true, result}) | ({ok:false, error})`
       *
       * `ctx` 里认得 `language`（也认 `ctx.context.language`），其余字段忽略。
       * 缺省值在这里补一次，让四个 handler 不必各自重写同一段取值逻辑。
       */
      handler: async (args = {}, ctx = {}) => handler(args, { ...ctxDefaults, ...(ctx ?? {}) }),
    };
  });
}

/**
 * 只取某几个工具（按名字，顺序跟 `names` 走）。
 *
 * 出题链不需要一次挂满四个：没有题库历史时 `question_bank` 会被
 * `has_question_bank` 挡掉；`read_source` 只在有来源时挂。集成层据此裁剪。
 */
export function pickLectureTools(tools, names) {
  const wanted = Array.isArray(names) ? names.map(String) : [];
  const byName = new Map((tools ?? []).map((tool) => [tool.name, tool]));
  return wanted.map((toolName) => byName.get(toolName)).filter(Boolean);
}

/**
 * 本包的工具名，顺序与上游 `compose_enabled_tools` 的追加顺序一致。
 * 集成层做 `_resolved_tools()` 的 JS 对位时按这个顺序拼，才能与上游提示词里的
 * 工具清单顺序一致（模型的选择受顺序影响）。
 */
export const LECTURE_TOOL_ORDER = LECTURE_TOOL_NAMES;

export {
  lectureToolSchemas,
  decorateSchema,
  buildLectureIndex,
  sortSourceIds,
  createRagHandler,
  createKbFilesHandler,
  createReadSourceHandler,
  createQuestionBankHandler,
  buildToolListText,
  composePromptText,
  createPromptComposer,
  fallbackEmptyToolList,
  loadPromptHints,
  normalizeHintLanguage,
  promptHintsFor,
  allToolDefinitions,
  UPSTREAM_DATA,
  UPSTREAM_SOURCE,
};

export { toolDefinition, upstreamFunctionSchema, parameterNames, requiredParameterNames, assertMatchesUpstream } from './definitions.js';
export { lectureBlockText, tokenize, searchLecture } from './lecture-index.js';
export { normalizeRagSelectors, renderHits } from './rag.js';
export { renderManifestReport, filterNames, globMatch, normalizeLimit, normalizeLanguage } from './kb-files.js';
export { runQuestionBank, createBankStore, renderEntry, renderCategories, truncate, normalizeEntry, QUESTION_BANK_ACTIONS, QUESTION_BANK_FILTERS, QUESTION_BANK_LIMITS } from './question-bank.js';
export { pyRepr, reprString } from './py-repr.js';
