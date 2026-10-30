/**
 * 工具定义的真源：`name` / `description` / `parameters` **逐字**来自上游。
 *
 * # 为什么是数据文件而不是手写常量
 *
 * 任务书的硬性要求是「description 与 parameters 逐字搬，改一个字都可能改变调用行为」。
 * 上游这几个工具的描述加起来 1500+ 字符，还带 em dash、中文标点、`[brackets]` 之类的
 * 细节；手抄一次必然出偏差，而且没有人能复核「抄得对不对」。
 *
 * 所以 `src/data/upstream.json` 是**从 vendor 里用脚本生成**的
 * （`tools/gen-lecture-tool-data.py`），本文件只负责把它按契约
 * 组装成 `{name, description, parameters, handler}`。任何人重新跑一次脚本
 * 就能确认这层与上游是否仍然一致 —— 这是唯一能长期守住「逐字」的办法。
 *
 * # `parameters` 为什么是完整 JSON Schema 而不是参数行
 *
 * 上游 `ToolDefinition.raw_parameters` 优先于 `parameters`（见
 * `core/tool_protocol.py`），`rag` 正是覆写了 `raw_parameters` 的那个（它把
 * `presentation` 的 type 改成 `["string","null"]` 并往 enum 里追加了 `null`）。
 * 若这里改写成参数行再让调用方重新编码，`region` 的 minItems/maxItems、
 * `page` 的 minimum、enum 里的 `null` 都可能在某次重构里被抹掉 ——
 * 而模型看到的就是抹掉之后的形状。存整份 schema 是唯一无损的选择。
 */
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const DATA = JSON.parse(readFileSync(new URL('./data/upstream.json', import.meta.url), 'utf8'));

function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

/** 上游抽出来的原始数据（只读）。 */
export const UPSTREAM_DATA = deepFreeze(DATA);

/** 与上游抽取脚本对齐的版本标记；宿主可据此判断是否需要重新生成数据。 */
export const UPSTREAM_SOURCE = String(DATA._source ?? '');

/**
 * 本包导出的工具名，顺序 = 上游 `_CONDITIONAL_MOUNT_FLAGS` 里这些工具的出现顺序。
 *
 * 顺序不是随手排的：`compose_enabled_tools` 按那张表逐条 append，而提示词里的
 * 工具清单与 schema 数组都跟着这个顺序走 —— 重排会改变模型看到的清单顺序，
 * 而模型的选择会受顺序影响（`core-tool` 的 `resolve()` 注释记了同一条）。
 */
export const LECTURE_TOOL_NAMES = Object.freeze(['rag', 'kb_files', 'read_source', 'question_bank']);

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** 取一个工具的完整 OpenAI function schema（深拷贝，调用方可随意改）。 */
export function upstreamFunctionSchema(name) {
  const schema = DATA.schemas[name];
  if (!schema) throw new Error(`Unknown lecture tool: ${name}`);
  return clone(schema);
}

/**
 * 静态工具定义（无 handler）。
 *
 * 每次调用都返回新的 `parameters` 对象：调用方（集成层 / 注册表）会就地给 schema
 * 打补丁（`additionalProperties:false`、`kb_name` 的 enum…），共享同一份对象会让
 * 第二个 turn 拿到被上一个 turn 收窄过的 schema。
 */
export function toolDefinition(name) {
  const schema = upstreamFunctionSchema(name);
  return {
    name: schema.function.name,
    description: schema.function.description,
    parameters: schema.function.parameters,
  };
}

/** 静态定义表：`name → {name, description, parameters}`（每次取都是新对象）。 */
export function allToolDefinitions() {
  return LECTURE_TOOL_NAMES.map((name) => toolDefinition(name));
}

/** 参数名清单（给测试与集成层核对「模型看到的参数名没被改过」用）。 */
export function parameterNames(name) {
  return Object.keys(upstreamFunctionSchema(name).function.parameters.properties ?? {});
}

/** 必填参数名（上游 `required` 数组原样）。 */
export function requiredParameterNames(name) {
  return [...(upstreamFunctionSchema(name).function.parameters.required ?? [])];
}

/**
 * 自检：数据文件里的 name/description/parameters 与给定的一份「上游导出」是否一致。
 *
 * 给测试用：把 vendor 当前导出的 schema 传进来，逐字段比对，防止有人手改了
 * JSON 数据文件却没重跑生成脚本。
 */
export function assertMatchesUpstream(reference) {
  const problems = [];
  for (const name of LECTURE_TOOL_NAMES) {
    const expected = reference?.[name];
    if (!expected) {
      problems.push(`${name}: 参照里没有这个工具`);
      continue;
    }
    const actual = upstreamFunctionSchema(name);
    if (!isDeepStrictEqual(actual, expected)) problems.push(`${name}: schema 与上游不一致`);
  }
  return problems;
}
