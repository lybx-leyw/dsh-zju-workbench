/**
 * 工具 schema 层 —— 上游 `core/tool_protocol.py` 的 JS 对位。
 *
 * # 为什么单独一层
 *
 * 模型看到的就是这里吐出的 JSON。上游对 `items`（array 必须带）、
 * `nullable`（`type: [T, "null"]`）、`enum`、`minimum/maximum/minItems/maxItems`
 * 都做了强制补全 —— 这些细节直接决定严格 provider（Gemini / Anthropic）会不会
 * 返回 400。JS 版由调用方写显式 schema，但**字段名与产出形状必须与上游逐字一致**，
 * 否则提示词里对参数形状的描述（"query (string)"）就和模型看到的对不上了。
 *
 * # 两种参数写法（对应上游的 parameters / raw_parameters）
 *
 * 1. **参数行数组**（等价 `list[ToolParameter]`）：写起来省事，且自动获得
 *    `items` 兜底、`nullable` 展开等上游补全行为。
 * 2. **完整 JSON Schema 对象**（等价 `raw_parameters`，上游优先）：原样透传，
 *    只补 `type`/`properties` 兜底。适配 MCP 那种上游 schema 任意形状的场景，
 *    重新编码成参数行会丢信息。
 *
 * 判定规则与上游一致：`parameters` 是对象且非数组 → 当 raw schema 用。
 */

export const PARAMETER_TYPES = Object.freeze([
  'string',
  'integer',
  'boolean',
  'number',
  'array',
  'object',
]);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function pick(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = clone(item);
    return out;
  }
  return value;
}

/**
 * 一行参数 → JSON Schema property。
 *
 * 逐条对应上游 `ToolParameter.to_schema()`：
 * - `description` **总是**输出（哪怕是空串），因为上游是 `{"description": self.description}`。
 * - `nullable` 展开成 `[type, "null"]`，让"必填但允许缺席"有合法的空值表示。
 * - array 缺 `items` 时兜底 `{"type":"string"}`；漏了它 Gemini 直接 400。
 */
export function parameterSchema(param = {}) {
  const type = String(pick(param.type, 'string'));
  const schema = {
    type: param.nullable ? [type, 'null'] : type,
    description: String(pick(param.description, '') ?? ''),
  };
  if (Array.isArray(param.enum) && param.enum.length > 0) schema.enum = [...param.enum];

  const minimum = pick(param.minimum);
  if (minimum !== undefined) schema.minimum = minimum;
  const maximum = pick(param.maximum);
  if (maximum !== undefined) schema.maximum = maximum;
  // 兼容 snake_case 的清单来源（JSON 配置文件里常写成 min_items）
  const minItems = pick(param.minItems, param.min_items);
  if (minItems !== undefined) schema.minItems = minItems;
  const maxItems = pick(param.maxItems, param.max_items);
  if (maxItems !== undefined) schema.maxItems = maxItems;

  if (type === 'array') {
    schema.items = param.items !== undefined && param.items !== null ? clone(param.items) : { type: 'string' };
  }
  return schema;
}

/**
 * 把一个工具对象规范化成内部定义。
 *
 * 幂等：已经规范化过的定义再传进来结果不变（`parameters` 仍是数组 / `rawParameters` 仍是对象）。
 *
 * `required` 默认 **true**（上游 `ToolParameter.required: bool = True`）。这看着
 * 反直觉，但它是上游的默认值：写成"默认必填、要可选就显式 required:false"
 * 才不会让提示词里承诺必填的参数在 schema 里变成可选。
 */
export function normalizeDefinition(tool) {
  if (tool === null || typeof tool !== 'object') {
    throw new TypeError('tool must be a non-null object');
  }
  const name = String(tool.name ?? '').trim();
  if (!name) throw new Error('Tool name must not be empty');

  const description = String(tool.description ?? '').trim() === '' ? String(tool.description ?? '') : String(tool.description);

  let parameters = [];
  let rawParameters = null;
  if (Array.isArray(tool.parameters)) {
    parameters = tool.parameters;
  } else if (isPlainObject(tool.parameters)) {
    // 与上游一致：完整 JSON Schema 优先，不做参数行重编码
    rawParameters = tool.parameters;
  } else if (isPlainObject(tool.rawParameters)) {
    rawParameters = tool.rawParameters;
  } else if (Array.isArray(tool.rawParameters)) {
    parameters = tool.rawParameters;
  }

  const handler = typeof tool.handler === 'function' ? tool.handler : null;

  const sensitive = new Set();
  for (const param of parameters) {
    if (param && param.sensitive === true && param.name) sensitive.add(String(param.name));
  }

  return {
    name,
    description,
    parameters,
    rawParameters,
    handler,
    deferred: tool.deferred === true,
    providerKind: String(pick(tool.providerKind, tool.provider_kind, '') ?? ''),
    providerId: String(
      pick(tool.providerId, tool.provider_id, tool.serverName, tool.server_name, '') ?? '',
    ),
    sensitive,
    // 原始工具对象：handler 的 this 绑定与外部扩展字段都从这里取
    tool,
  };
}

/**
 * 参数对象（`type:object` 那一层）。arg guard 只关心 `properties` / `required`。
 */
export function parametersObjectSchema(definition) {
  if (definition.rawParameters !== null) {
    const schema = clone(definition.rawParameters);
    if (schema.type === undefined) schema.type = 'object';
    if (schema.properties === undefined || schema.properties === null) schema.properties = {};
    return schema;
  }
  const properties = {};
  const required = [];
  for (const param of definition.parameters) {
    if (!param || !param.name) continue;
    properties[param.name] = parameterSchema(param);
    // 上游：required 只看 required 标记，**不看** default。
    // default 的豁免发生在 arg guard（见 arg-guard.js 的 requiredArgs）。
    if (param.required !== false) required.push(param.name);
  }
  return { type: 'object', properties, required };
}

/**
 * 生成 OpenAI function-calling 工具描述。
 *
 * @param {object} definitionOrTool 规范化定义或原始工具
 * @param {{additionalProperties?: boolean|undefined}} [options]
 *   `additionalProperties` 为 `false` 时在 parameters 上写死
 *   `additionalProperties:false` —— 上游问题流水线在 `_build_llm_tool_schemas`
 *   里对每个 schema 都这么补一刀，模型因此不会塞编造字段。
 */
export function toOpenAISchema(definitionOrTool, options = {}) {
  const definition =
    definitionOrTool && Array.isArray(definitionOrTool.parameters) && 'providerKind' in definitionOrTool
      ? definitionOrTool
      : normalizeDefinition(definitionOrTool);

  const parameters = parametersObjectSchema(definition);
  if (options.additionalProperties !== undefined && options.additionalProperties !== null) {
    parameters.additionalProperties = options.additionalProperties;
  }

  return {
    type: 'function',
    function: {
      name: definition.name,
      description: definition.description,
      parameters,
    },
  };
}

/**
 * `(kind, providerId)`：外部 provider 的身份。
 *
 * 放在最底层是因为两个完全不同的消费者需要同一个答案：deferred 清单按它分组，
 * 调度器把它写进每次 tool call 的 trace metadata（前端要说清是哪个 MCP server /
 * CLI app 在跑，而不是把 `mcp_<server>_<tool>` 拆回来猜 —— server 名里带下划线就猜错）。
 * 内建工具返回 `('','')`。
 */
export function providerIdentity(tool) {
  if (!tool) return ['', ''];
  const kind = String(pick(tool.providerKind, tool.provider_kind, '') ?? '');
  const providerId = String(
    pick(tool.providerId, tool.provider_id, tool.serverName, tool.server_name, '') ?? '',
  );
  return [kind, providerId];
}

/**
 * 这个工具把哪些参数从 trace 里藏起来（例如 quiz 的 `expected_answer`）。
 *
 * 接受规范化定义、注册表条目、或原始工具对象三种形状：调用点拿到的到底是哪一种
 * 取决于它在哪一层（调度层拿到的是注册表条目），多一层解包比让每个调用点各自
 * `getattr` 更不容易漏。
 */
export function sensitiveArgNames(toolOrDefinition) {
  if (!toolOrDefinition) return new Set();
  const definition = toolOrDefinition.definition ?? toolOrDefinition;
  return definition.sensitive instanceof Set ? definition.sensitive : new Set();
}
