/**
 * 工具列表 → JSON Schema 数组（可直接塞进 OpenAI 的 `tools` 参数）。
 *
 * # 为什么 schema 需要「补值」而不是原样吐出去
 *
 * 上游 `QuestionPipeline._build_llm_tool_schemas()`（pipeline.py:1625）在
 * `registry.build_openai_schemas()` 之后还会**就地改三处**，再交给模型：
 *
 * 1. `rag.query` 补 `minLength: 1` —— 空查询对检索毫无意义，
 *    把它写成 schema 约束比在工具里报错更早生效（模型连发都不会发）；
 * 2. `rag.kb_name` 收窄成当前知识库的 `enum`、`read_source.source_id`
 *    收窄成本次真实可用的 id `enum` —— 让幻觉出来的名字在**解码层**就被排除，
 *    而不是等工具返回"unknown source_id"再纠正一轮；
 * 3. 所有 `parameters` 补 `additionalProperties: false` —— 严格 provider
 *    （Gemini / Anthropic）会拒绝带未知字段的调用，宽松 provider 会静默丢掉。
 *
 * 本函数默认**不做**第 2 步（没有 `kbChoices` / `sourceIds` 的时候无从谈起），
 * 但只要调用方给了，行为与上游一致。第 1、3 步默认开启，因为它们是常量。
 *
 * # 为什么不复用 core-tool 的 `toOpenAISchema`
 *
 * 本包的 `parameters` 已经是**完整 JSON Schema**（从上游逐字抽出来的），
 * 走参数行编码再解码是纯损失：`region` 的 minItems/maxItems 与
 * `presentation.enum` 里那个 `null` 都是参数行表达不了的细节。所以这里直接
 * 包装成 `{type:"function", function:{...}}`，一个字段都不重写 ——
 * 「模型看到的就是上游那一份」是这条链的质量前提。
 *
 * 输出形状与 `core-tool` 的 `toOpenAISchema()` **完全一致**，所以两者可以互换：
 * 集成层把这里的结果直接传给 `runAgenticLoop(toolSchemas=...)` 即可。
 */

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = clone(item);
    return out;
  }
  return value;
}

/** 取工具的 schema 源：既接受工具对象，也接受 `{name, description, parameters}` 静态定义。 */
function definitionOf(tool) {
  if (!tool || typeof tool !== 'object') return null;
  const name = String(tool.name ?? '').trim();
  if (!name) return null;
  const parameters = tool.parameters;
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return null;
  return { name, description: String(tool.description ?? ''), parameters };
}

/**
 * 把一份 schema 补齐成模型该看到的样子（上游 `_build_llm_tool_schemas` 的三处补丁）。
 *
 * @param {object} schema `{type:'function', function:{name, description, parameters}}`
 * @param {object} [options]
 * @param {string[]} [options.kbChoices]   `rag.kb_name` 的 enum 取值
 * @param {string[]} [options.sourceIds]   `read_source.source_id` 的 enum 取值
 */
export function decorateSchema(schema, { kbChoices, sourceIds } = {}) {
  const fn = schema?.function;
  if (!fn || typeof fn !== 'object') return schema;
  const parameters = fn.parameters;
  if (!parameters || typeof parameters !== 'object') return schema;
  const properties = parameters.properties;
  if (!properties || typeof properties !== 'object') {
    parameters.additionalProperties = false;
    return schema;
  }
  if (fn.name === 'rag') {
    const query = properties.query;
    // `setdefault` 语义：调用方若已在 schema 里写了 minLength，不去覆盖它。
    if (query && typeof query === 'object' && query.minLength === undefined) query.minLength = 1;
    const kbName = properties.kb_name;
    if (kbName && typeof kbName === 'object' && Array.isArray(kbChoices) && kbChoices.length > 0) {
      kbName.enum = [...kbChoices];
    }
  }
  if (fn.name === 'read_source') {
    const sourceId = properties.source_id;
    if (sourceId && typeof sourceId === 'object' && Array.isArray(sourceIds) && sourceIds.length > 0) {
      sourceId.enum = [...sourceIds];
    }
  }
  parameters.additionalProperties = false;
  return schema;
}

/**
 * 工具列表 → JSON Schema 数组。
 *
 * @param {Array<object>} tools `createLectureTools()` 的产出，或同形的静态定义
 * @param {object} [options] 见 {@link decorateSchema}
 * @returns {Array<object>}
 */
export function lectureToolSchemas(tools, options = {}) {
  const list = Array.isArray(tools) ? tools : tools ? [tools] : [];
  const out = [];
  for (const tool of list) {
    const definition = definitionOf(tool);
    // 认不出的条目**跳过**而不是抛错：与上游 `get_enabled` 一致，
    // 一个坏名字不该让整轮构 schema 失败（那会让整次出题挂掉）。
    if (!definition) continue;
    out.push(decorateSchema({
      type: 'function',
      function: {
        name: definition.name,
        description: definition.description,
        parameters: clone(definition.parameters),
      },
    }, options));
  }
  return out;
}
