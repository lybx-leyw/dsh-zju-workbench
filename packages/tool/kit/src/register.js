/**
 * 读工具的注册器。
 *
 * # 与写工具注册器的差别
 *
 * 写工具（`tool/write-kit`）是 **prepare → 审批 → execute → cancel** 四段；
 * 读工具只有一段：**调 source 的读方法，把结果交回去**。所以这里不做审批、
 * 不做撤销，也不能做 —— 审批只给会改变外部状态的动作，给读操作加审批会让
 * 用户为一个「查课表」点一次确认，进而习惯性地一路点同意。
 *
 * # 为什么每次执行都重新查服务
 *
 * 与写工具同一条理由：profile 里包的装配顺序不保证。若在 `apply()` 时把
 * source 服务快照下来，数据源比工具包晚激活就会永久表现为「明明装了却报未装配」。
 *
 * # 为什么不在这里做参数校验
 *
 * 判据属于**数据源的知识**（哪个字段必填、什么范围），工具包只把它翻译成
 * JSON Schema 给模型看。真正的校验在 source 里（`selectionSections` 会说
 * 「需要 pool（课程号，不是课程代码）」），在工具层再写一遍就有了两个真相，
 * 而模型看到的是先被触发的那一个。
 */

/**
 * 造一个读工具注册器。
 *
 * @param options.ctx - 插件上下文（`tools` 已由 `inject` 保证）。
 * @param options.build - `(services) => Array<readToolDefinition>`。工具定义的工厂。
 * @param options.serviceSources - `{ 服务名: 包名 }`，用于惰性取服务与报错文案。
 * @returns `{ register, services }`。
 */
export function createReadToolRegistrar({ ctx, build, serviceSources }) {
  /**
   * 惰性收集 source 服务。
   *
   * 每次**调用**都重新取一遍，而不是在 apply 时快照。
   */
  const services = () => {
    const found = {};
    for (const key of Object.keys(serviceSources)) {
      const service = ctx.get(key);
      if (service) found[key] = service;
    }
    return found;
  };

  /**
   * 把一个读工具定义包成宿主能注册的形状。
   *
   * @param definition - `{ name, description, parameters, run }`。
   * @returns 可 `ctx.tools.register` 的对象。
   */
  const toHostTool = (definition) => {
    const name = definition.name;
    return {
      name,
      description: definition.description,
      parameters: definition.parameters,
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec = {}) {
        // 每次执行重新构造定义 —— 里面的服务查找会读**当前**的服务表。
        const current = build(services()).find((item) => item.name === name) ?? definition;
        const result = await current.run(args ?? {}, { signal: exec.signal, agent: exec.agent });
        return { ok: true, action: name, result };
      },
    };
  };

  /**
   * 注册一组读工具。每个工具一条 effect：fiber 卸载时逐条注销，不留半套。
   *
   * @param readTools - `(services) => Array<definition>`，或直接给数组。
   */
  const register = (readTools) => {
    // 注册时只需要名字、描述与参数（不依赖服务），所以用空表构造一次即可。
    const definitions = typeof readTools === 'function' ? readTools({}) : readTools;
    for (const definition of definitions) {
      ctx.effect(() => ctx.tools.register(toHostTool(definition)));
    }
  };

  return { register, services, toHostTool };
}
