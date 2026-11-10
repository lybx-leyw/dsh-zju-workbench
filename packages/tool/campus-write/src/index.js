/**
 * `@lybx-leyw/dsh-zju-tool-campus-write` —— 校园写操作工具包。
 *
 * # 这个包只做三件事
 *
 * 1. **取 source 服务**（`zhiyunZdbk` / `zhiyunCc98` / …）；
 * 2. **问用户批不批**（宿主的 `ctx.approval`）；
 * 3. **把 source 算好的参数发出去**。
 *
 * 平台协议、表单字段、签名、令牌、前置查询 —— 全在 source 那边。这里不碰。
 *
 * # 为什么审批必须在这一层
 *
 * 因为「要不要做」是**用户与 agent 之间**的事，不是数据源的知识。
 * 数据源若内建写闸，它就得知道什么叫 turn、什么叫审批通道 —— 那会把
 * 宿主概念漏进一个本该只描述平台的地方。
 *
 * 反过来，若让每个工具自己写一遍 `approval.request()`，忘掉一次就是一次
 * 无审批写入，而那种漏洞**不会表现为报错**。所以本包只提供 `guardWrite`
 * 一个入口，工具定义里不出现裸的执行调用。
 *
 * # 四条硬约束（照宿主 `@deepseek-ai/dsh-user-approval` 的契约）
 *
 * 1. 只能在已开启的 turn 内调用 —— 本包全部经工具调用进入，没有后台路径。
 * 2. `'never'` 策略在服务内部就判掉了，业务侧不要再写一遍，只用来选措辞。
 * 3. `'unavailable'` 是 **fail closed**：没有通道就**不做**。
 * 4. 审计 `asked` / `decided` 必然成对，由服务分配 id。
 *
 * # 本包不带挂载行
 *
 * `package.json` 没有 `dsh.bundle.patch`，仓库里没有 `cordis.patch.yml`。
 * 与 `tool/study` 同口径：工具包只负责「怎么注册」，不负责「什么时候装」——
 * 后者是 preset 的决定（D11 延后）。
 */
import { guardWrite, WriteRejected, WRITE_CODES } from './approval.js';
import { createCampusWriteTools } from './tools.js';

export const name = 'zhiyun-tool-campus-write';

/**
 * 这些服务**全部可选**：哪几个装了，对应的动作就能用。
 *
 * 用 `inject` 的惰性形式（字符串即可，缺了不激活整包）——
 * 若写成硬依赖，缺一个 `zhiyunLab` 就会让整个写工具包不加载，
 * 而用户其实可以选课。
 */
export const inject = ['tools', 'approval'];

/** 本包消费的 source 服务名与对应包（报错文案要用）。 */
const SERVICE_SOURCES = Object.freeze({
  zhiyunZdbk: '@lybx-leyw/dsh-zju-source-zdbk',
  zhiyunCc98: '@lybx-leyw/dsh-zju-source-cc98',
  zhiyunXuezai: '@lybx-leyw/dsh-zju-source-xuezai',
  zhiyunPta: '@lybx-leyw/dsh-zju-source-pta',
  zhiyunSztz: '@lybx-leyw/dsh-zju-source-sztz',
  zhiyunTyys: '@lybx-leyw/dsh-zju-source-tyys',
  zhiyunLab: '@lybx-leyw/dsh-zju-source-lab',
});

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文（`tools` 与 `approval` 已由 `inject` 保证）。
 */
export function apply(ctx) {
  /**
   * 惰性收集 source 服务。
   *
   * 每次**调用**都重新取一遍，而不是在 apply 时快照：数据源可能比本包晚激活
   * （profile 顺序不保证），快照会让「明明装了却报未装配」。
   *
   * @returns 服务名 → 服务对象（缺的不在表里）。
   */
  const services = () => {
    const found = {};
    for (const key of Object.keys(SERVICE_SOURCES)) {
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
   * @param name - 工具名。
   * @param build - `(services) => { name, description, parameters, prepare }`。
   *   每次执行时重跑，这样**服务晚到时也能用** —— 见 `services()` 的说明。
   * @returns 可直接 `ctx.tools.register` 的对象。
   */
  const toHostTool = (name, build) => ({
    name,
    description: build({}).description,
    parameters: build({}).parameters,
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec = {}) {
      // 每次执行重新构造定义 —— 里面的 `need()` 会读**当前**的服务表。
      const [definition] = build(services());

      // 1) 让 source 算好参数与说明。**这一步不发写请求** ——
      //    source 的 `prepareXxx` 只做查询与构造。
      const prepared = await definition.prepare(args, { signal: exec.signal });
      const summary = prepared?.summary;
      const act = prepared?.execute;
      if (typeof act !== 'function') {
        throw Object.assign(
          new Error(`${name}：数据源没有给出可执行的写动作（缺少 execute）。`),
          { code: 'CONTRACT_MISSING' },
        );
      }

      // 2) 审批。`agent` 可能为空（后台/无主调用），而审批服务要求它 ——
      //    缺了就是没有可审计的主体，按「没有通道」处理（fail closed）。
      if (!exec.agent) {
        throw new WriteRejected(
          WRITE_CODES.NO_CHANNEL,
          '这次调用没有关联的会话，写操作不会执行。请在对话里重试。',
          { toolName: name },
        );
      }

      const reason = typeof summary === 'string' ? summary : summary?.reason ?? `${name} 将改变你在平台上的状态`;
      const result = await guardWrite({
        approval: ctx.approval,
        agent: exec.agent,
        act,
        signal: exec.signal,
        toolName: name,
        callId: exec.callId,
        reason,
        displayReason: typeof summary === 'object' && summary?.displayReason ? summary.displayReason : undefined,
      });

      return { ok: true, action: name, result };
    },
  });

  // 注册时只需要名字、描述与参数（不依赖服务），所以用空表构造一次即可。
  for (const definition of createCampusWriteTools({ services: {} })) {
    const name = definition.name;
    ctx.effect(() => ctx.tools.register(toHostTool(name, (table) => createCampusWriteTools({ services: table })
      .find((item) => item.name === name) ?? definition)));
  }
}

export { createCampusWriteTools } from './tools.js';
export { guardWrite, requireApproval, WriteRejected, WRITE_CODES, describeWrite } from './approval.js';
