/**
 * 参数守卫 —— 上游 `runtime/agentic/tool_arg_guard.py` 的 JS 对位。
 *
 * # 它防的是什么
 *
 * 大工具面 + 长历史下，模型会间歇性地发出 `arguments` 为空（或只有一半）的原生
 * function call，而 schema 明明标了必填 —— 在多个 OpenAI 兼容 provider 上都复现过。
 *
 * 没有守卫之前这种调用被原样派发，于是**工具**去拒绝它：`exec` 抛
 * `ValueError: exec requires a non-empty command`，`write_note` 回
 * `Unknown mode ''`。这两句都不读作"你漏了参数"，模型于是重复同一个畸形调用
 * 直到轮数烧完 —— 有报告是一次回合里 7 个 `write_note` 有 5 个空着来、重试了 5~7 次。
 *
 * 守卫把它变成**一次自纠**：调用根本不派发，`role=tool` 正文点名缺了哪些必填参数、
 * 该长什么样。下一轮模型就能发出合法的调用。
 *
 * # 它对"类型不对"的处理（这一点最容易搞错）
 *
 * **不校验类型，也不纠正类型。** 它只判两件事：
 * 1. 必填参数是不是**没来**（absent）；
 * 2. 必填参数是不是**来了但是空串**（blank）。
 *
 * 唯一的 schema 求值发生在"值显式为 null"时 —— 只有属性 schema 本身允许 null
 * （`type: [T,"null"]` 之类）才算"提供了"，否则算缺席。
 *
 * 类型错误（`{"count": "五"}`）**照样派发**，由工具自己处理；工具抛错时由调度层
 * 捕获并作为 `role=tool` 错误文本回灌（见 dispatch.js）。这条分工是刻意的：
 * 守卫保持纯函数、可单测，且不会用一份"猜出来的"类型规则去否决工具本来能容忍的输入。
 */

import { normalizeDefinition, parametersObjectSchema, isPlainObject } from './schema.js';

/**
 * 一个必填参数，压缩到"纠错文案"需要的那点信息。
 */
export class RequiredArg {
  constructor(name, type = '', enumValues = []) {
    this.name = name;
    this.type = type;
    this.enum = enumValues;
  }

  describe() {
    const parts = [this.type || 'value'];
    if (this.enum.length > 0) parts.push(`one of: ${this.enum.join(' | ')}`);
    return `${this.name} (${parts.join(', ')})`;
  }
}

/**
 * 这个 kwarg 算不算"真的给了"。
 *
 * 显式 null 由调用方单独处理（见 `allowsNull`）。其他 null 与空白串都当缺席，
 * 因为 provider 序列化"模型没填这个字段"时就是这么给的。
 * **空集合不动**：`[]` / `{}` 对数组/对象参数可以是刻意给的值，拒绝它们会挡掉
 * 本来能跑通的调用。
 */
export function isSupplied(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

function schemaAllowsNull(schema) {
  if (!isPlainObject(schema)) return false;
  const type = schema.type;
  if (type === 'null') return true;
  if (Array.isArray(type) && type.includes('null')) return true;
  if (Array.isArray(schema.enum) && schema.enum.includes(null)) return true;
  for (const key of ['oneOf', 'anyOf']) {
    if (Array.isArray(schema[key]) && schema[key].some((branch) => schemaAllowsNull(branch))) return true;
  }
  return false;
}

/**
 * 显式给的 null 能不能满足这个属性的 schema。
 *
 * 只求值 null，不求值工具其余校验契约 —— 求全长就等于在守卫里重写一遍完整校验器。
 * 局部 `$ref` 也只看同一份 properties：解析不到的一律按"不允许 null"处理，
 * 与上游"无效 / 解析不出即拒绝"一致。
 */
export function allowsNull(definition, name) {
  const parameters = parametersObjectSchema(definition);
  const properties = parameters.properties;
  if (!isPlainObject(properties) || !(name in properties)) return false;
  return schemaAllowsNull(properties[name]);
}

/**
 * 工具的必填参数（**排除**带默认值的）。
 *
 * 带默认值的参数不点名也能满足，把它算必填会拒绝工具本可以服务的调用。
 * 两种 schema 写法都要管：raw JSON Schema（MCP 适配器用）与参数行（内建工具用）。
 *
 * 注意与 `parametersObjectSchema` 的 `required` 数组的差别：那里是"schema 上
 * 声明必填"，这里是"没有默认值因此真的必须由模型给"。两处都必须有，
 * 因为 `required` 数组是给模型看的，这里的清单是给守卫用的。
 */
export function requiredArgs(definitionOrTool) {
  const definition = toDefinition(definitionOrTool);
  if (definition.rawParameters !== null) {
    const names = definition.rawParameters.required;
    if (!Array.isArray(names)) return [];
    const properties = isPlainObject(definition.rawParameters.properties)
      ? definition.rawParameters.properties
      : {};
    const args = [];
    for (const name of names) {
      if (typeof name !== 'string' || name === '') continue;
      const prop = isPlainObject(properties[name]) ? properties[name] : {};
      if ('default' in prop) continue;
      const enumValues = Array.isArray(prop.enum) ? prop.enum.map((v) => String(v)) : [];
      args.push(new RequiredArg(name, String(prop.type ?? ''), enumValues));
    }
    return args;
  }
  return definition.parameters
    .filter((param) => param && param.required !== false && (param.default === undefined || param.default === null))
    .map(
      (param) =>
        new RequiredArg(
          String(param.name),
          String(param.type ?? ''),
          Array.isArray(param.enum) ? param.enum.map((v) => String(v)) : [],
        ),
    );
}

/**
 * 把未满足的必填参数拆成「缺席」与「来了但空串」。
 *
 * 为什么要拆：thinking 模型有时**故意**传 `""`（先搭骨架后填内容）。把它说成
 * "missing"与模型自己对这次调用的认知矛盾，会诱发逐字重复。拒绝派发这件事不变，
 * 变的只是纠错措辞。
 */
export function unsatisfiedRequiredArgs(definitionOrTool, args) {
  const definition = toDefinition(definitionOrTool);
  const supplied = isPlainObject(args) ? args : {};
  const absent = [];
  const blank = [];
  for (const arg of requiredArgs(definition)) {
    if (!(arg.name in supplied)) {
      absent.push(arg);
      continue;
    }
    const value = supplied[arg.name];
    if (value === null) {
      if (!allowsNull(definition, arg.name)) absent.push(arg);
    } else if (typeof value === 'string' && value.trim() === '') {
      blank.push(arg);
    } else if (!isSupplied(value)) {
      absent.push(arg);
    }
  }
  return { absent, blank };
}

/**
 * 没供上的必填参数（缺席 + 空串合并）。
 *
 * `args` 必须是**已经过服务端补全**的 kwargs —— 由流水线代为注入的参数要算"已给"，
 * 否则会误判成模型漏填。
 */
export function missingRequiredArgs(definitionOrTool, args) {
  const { absent, blank } = unsatisfiedRequiredArgs(definitionOrTool, args);
  return [...absent, ...blank];
}

/**
 * 一个"从未派发"的调用对应的 `role=tool` 纠错正文。
 *
 * 要点：点名缺的参数与它接受的形状，并**明确说重复同一调用还会失败** ——
 * 模型在这个失败模式下的动作是逐字重试，不是重读 schema。
 */
export function missingArgsMessage(toolName, missing, { empty = [] } = {}) {
  const absent = [...(missing ?? [])];
  const blank = [...(empty ?? [])];

  const clauses = [];
  if (absent.length > 0) {
    const named = absent.map((arg) => `\`${arg.name}\``).join(', ');
    const shapes = absent.map((arg) => arg.describe()).join('; ');
    clauses.push(
      `\`${toolName}\` was called without its required argument(s): ${named}. Expected: ${shapes}.`,
    );
  }
  if (blank.length > 0) {
    const named = blank.map((arg) => `\`${arg.name}\``).join(', ');
    const shapes = blank.map((arg) => arg.describe()).join('; ');
    clauses.push(
      `\`${toolName}\` received empty value(s) for required argument(s): ${named}. ` +
        'Those keys were present but blank — supply non-empty content ' +
        `(do not re-emit the same empty string). Expected: ${shapes}.`,
    );
  }
  const body = clauses.length > 0 ? clauses.join(' ') : `\`${toolName}\` was called with incomplete arguments.`;
  return (
    `(tool call not dispatched — ${body} Re-emit the call with those ` +
    'arguments filled in; an identical call with empty arguments will be ' +
    'rejected again without running.)'
  );
}

function toDefinition(definitionOrTool) {
  if (
    definitionOrTool &&
    Array.isArray(definitionOrTool.parameters) &&
    'providerKind' in definitionOrTool &&
    'rawParameters' in definitionOrTool
  ) {
    return definitionOrTool;
  }
  return normalizeDefinition(definitionOrTool);
}
