/**
 * 写工具的注册器与 source 契约校验。
 *
 * 这一份是「按域拆包」之后抽出来的公共部分：7 个写工具包各自只写自己的
 * 工具定义（纯数据 + 纯函数），注册、审批、撤销、错误归因这些**一次写对就
 * 不该再写第二遍**的东西全在这里。
 *
 * # 为什么注册要「每次执行重新构造定义」
 *
 * profile 里包的装配顺序不保证。若在 `apply()` 时把 source 服务快照下来，
 * 数据源比工具包晚激活就会永久表现为「明明装了却报未装配」。
 * 所以每次执行都重新查一遍服务表。
 */

import { guardWrite, WriteRejected, WRITE_CODES } from './approval.js';

/**
 * 参数判据从 `tool/kit` 转出，**不在这里再写一份**。
 *
 * 读工具与写工具校验同一批参数（必填字符串、可选整数、枚举取值），
 * 两处各写一份时它们会漂：一个包把空串当「没给」、另一个当成错误，
 * 模型于是在两个同名参数上得到相反的反馈。判据只能有一份。
 */
export { inputError, str, optStr, serviceLookup } from '@lybx-leyw/dsh-zju-tool-kit';

/**
 * source 必须提供的三个方法。缺了就是契约不完整，要立即报错而不是等到执行时。
 *
 * @param service - source 服务。
 * @param name - 方法名前缀，如 `selectCourse`。
 * @returns `{ prepare, execute, cancel }`。
 */
export function contractOf(service, name) {
  const prepare = service?.[`${name}Prepare`];
  const execute = service?.[`${name}Execute`];
  const cancel = service?.[`${name}Cancel`];
  if (typeof prepare !== 'function' || typeof execute !== 'function') {
    throw Object.assign(
      new Error(`数据源没有提供 ${name}Prepare / ${name}Execute，这个动作暂时做不了。`),
      { code: 'CONTRACT_MISSING', methods: [`${name}Prepare`, `${name}Execute`] },
    );
  }
  if (typeof cancel !== 'function') {
    throw Object.assign(
      new Error(`数据源没有提供 ${name}Cancel —— 审批被拒后那个动作会永久不可用。`),
      { code: 'CONTRACT_MISSING', methods: [`${name}Cancel`] },
    );
  }
  return { prepare, execute, cancel };
}

/**
 * 造一个注册器：把纯数据的工具定义挂进宿主的工具表。
 *
 * @param options.ctx - 插件上下文（`tools` 与 `approval` 已由 `inject` 保证）。
 * @param options.build - `(services) => Array<toolDefinition>`。工具定义的工厂。
 * @param options.serviceSources - `{ 服务名: 包名 }`，用于惰性取服务与报错文案。
 * @returns `{ register(writeTools), services }`。
 */
export function createWriteToolRegistrar({ ctx, build, serviceSources }) {
  /**
   * 惰性收集 source 服务。
   *
   * 每次**调用**都重新取一遍，而不是在 apply 时快照：数据源可能比本包晚激活。
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
   * 把一个工具定义包成宿主能注册的形状。
   *
   * # 为什么审批在 `execute` 里而不是外面
   *
   * `execute(args, exec)` 是唯一能拿到 `exec.callId` 与 `exec.signal` 的地方，
   * 而 `callId` 能让审批对话框关联到已经流式呈现的那次调用（用户看得见
   * 「模型正在做什么」再决定批不批）。放在外面就没有这两个东西。
   *
   * @param definition - 一个工具定义 `{ name, description, parameters, prepare }`。
   * @returns 可直接 `ctx.tools.register` 的对象。
   */
  const toHostTool = (definition, approval = ctx.approval) => {
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

        // 1) 让 source 算好参数与说明。**这一步不发写请求** ——
        //    source 的 `prepareXxx` 只做查询与构造。
        const prepared = await current.prepare(args, { signal: exec.signal });
        const summary = prepared?.summary;
        const act = prepared?.execute;
        const cancel = prepared?.cancel;
        if (typeof act !== 'function') {
          throw Object.assign(
            new Error(`${name}：数据源没有给出可执行的写动作（缺少 execute）。`),
            { code: 'CONTRACT_MISSING' },
          );
        }

        /**
         * 撤销 source 那边的写会话。
         *
         * 走任何一条失败路径前都要调它 —— 否则 source 的 `session.prepared` 一直占着，
         * 下一次 `prepare` 撞上 `WRITE_BUSY`，**这个动作此后一直不能用**。
         *
         * 清理本身不许抛错：那会把「审批被拒」变成「清理失败」，用户看到的
         * 错误与真正原因无关。
         */
        const rollback = async () => {
          if (typeof cancel !== 'function') return;
          try { await cancel(); } catch { /* 撤销失败不该盖住真正的原因 */ }
        };

        // 2) 审批。`agent` 可能为空（后台/无主调用），而审批服务要求它 ——
        //    缺了就是没有可审计的主体，按「没有通道」处理（fail closed）。
        if (!exec.agent) {
          await rollback();
          throw new WriteRejected(
            WRITE_CODES.NO_CHANNEL,
            '这次调用没有关联的会话，写操作不会执行。请在对话里重试。',
            { toolName: name },
          );
        }

        const reason = typeof summary === 'string'
          ? summary
          : summary?.reason ?? `${name} 将改变你在平台上的状态`;
        let result;
        try {
          result = await guardWrite({
            approval,
            agent: exec.agent,
            act,
            signal: exec.signal,
            toolName: name,
            callId: exec.callId,
            reason,
            displayReason: typeof summary === 'object' && summary?.displayReason ? summary.displayReason : undefined,
          });
        } catch (error) {
          // 审批被拒 / 超时 / 中止 / 通道不可用 —— 这几种情况下 `execute` 从未执行，
          // session 还占着。撤销它，让用户**立刻**能重新发起（不封锁、不需要等待）。
          await rollback();
          throw error;
        }

        return { ok: true, action: name, result };
      },
    };
  };

  /**
   * 注册一组写工具。每个工具一条 effect：fiber 卸载时逐条注销，不留半套。
   *
   * @param writeTools - `(services) => Array<toolDefinition>`，或直接给数组。
   */
  const register = (writeTools) => {
    // 注册时只需要名字、描述与参数（不依赖服务），所以用空表构造一次即可。
    const definitions = typeof writeTools === 'function' ? writeTools({}) : writeTools;
    for (const definition of definitions) {
      ctx.effect(() => ctx.tools.register(toHostTool(definition)));
    }
  };

  return { register, services, toHostTool };
}
