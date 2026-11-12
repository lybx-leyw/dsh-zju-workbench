/**
 * `@lybx-leyw/dsh-zju-tool-zdbk` —— 教务网（zdbk）写操作工具包。
 *
 * 一个包只装一个域：**教务网的选课 / 退课 / 调志愿顺序**。
 *
 * # 为什么按域拆，而不是一个 `campus-write` 装全部
 *
 * 原先 7 个工具装在同一个包里，横跨 7 个数据源。那样有两个具体代价：
 *
 *   - 想只给「选课」相关的能力，得把发帖、交作业、场馆预约一起给出去；
 *   - 包名与目录说不清它管什么 —— `campus-write` 不是任何一个域的名字。
 *
 * 现在与 `source/*` 一一对应：`source/zdbk` ↔ `tool/zdbk`。
 * 审批与注册器在 `tool/write-kit`，**不重复实现**。
 */
import { createWriteToolRegistrar, contractOf, inputError, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-write-kit';
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';
import { createZdbkReadTools } from './reads.js';

export const name = 'zhiyun-tool-zdbk';

/**
 * 本包消费的 source 服务。
 *
 * `tools` 与 `approval` 由宿主提供；`zhiyunZdbk` 缺失时**整包不激活**
 * （用 String 形式的 inject 就是惰性语义）。
 */
export const inject = ['tools', 'approval', 'zhiyunZdbk'];

const SERVICE_SOURCES = Object.freeze({
  zhiyunZdbk: '@lybx-leyw/dsh-zju-source-zdbk',
});

/**
 * 选课工具的定义。**纯数据 + 纯函数**，不碰 Cordis、不碰审批。
 *
 * @param services - 已解析的 source 服务（缺的那部分动作如实报错）。
 * @returns 工具定义数组（未注册、未审批）。
 */
export function createZdbkWriteTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);
  const contract = contractOf;

  return [
    {
      name: 'campus_course_select',
      description: '在教务网选课、退课或调整志愿顺序。选课受名额与选课窗口限制，退课之后该教学班可能被别人占掉。执行前会请求你批准，批准只对这一次有效。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['select', 'drop', 'reorder'], description: 'select 选课、drop 退课、reorder 调整志愿顺序' },
          course: { type: 'string', description: '课程名或课程号' },
          section: { type: 'string', description: '教学班编号（select 需要，可由选课查询结果得到）' },
          order: { type: 'integer', minimum: 1, description: 'reorder 时的目标志愿序号' },
        },
        required: ['action', 'course'],
        additionalProperties: false,
      },
      async prepare(args) {
        // 先校验参数与 action，再取服务：用户把参数写错了，不该先收到
        // 「包没装」这种与他的输入毫无关系的提示。
        const action = str(args.action, 'action');
        const course = str(args.course, '课程名或课程号');
        if (!['select', 'drop', 'reorder'].includes(action)) {
          throw inputError(`不认识的 action：${action}`);
        }
        const zdbk = need('zhiyunZdbk');

        if (action === 'select') {
          const section = str(args.section, '教学班编号（select 需要）');
          const { prepare, execute, cancel } = contract(zdbk, 'selectCourse');
          return { summary: await prepare({ course, section }), execute, cancel };
        }
        if (action === 'drop') {
          const section = optStr(args.section, '教学班编号');
          const { prepare, execute, cancel } = contract(zdbk, 'dropCourse');
          return { summary: await prepare({ course, ...(section ? { section } : {}) }), execute, cancel };
        }
        if (action === 'reorder') {
          const order = args.order;
          if (!Number.isInteger(order) || order < 1) throw inputError('reorder 需要大于 0 的整数 order');
          const section = optStr(args.section, '教学班编号');
          const { prepare, execute, cancel } = contract(zdbk, 'reorderCourse');
          return { summary: await prepare({ course, order, ...(section ? { section } : {}) }), execute, cancel };
        }
        throw inputError(`不认识的 action：${action}`);
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createWriteToolRegistrar({
    ctx,
    build: createZdbkWriteTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createZdbkWriteTools);

  // 读工具与写工具同一个域、同一个 source，但**两条注册链**：
  // 读那条没有审批，写那条必须有。混成一条会让「读也问一次」变得唾手可得。
  createReadToolRegistrar({
    ctx,
    build: createZdbkReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createZdbkReadTools);
}

export { createZdbkReadTools } from './reads.js';
