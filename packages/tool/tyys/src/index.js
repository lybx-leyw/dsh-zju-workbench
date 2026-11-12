/**
 * `@lybx-leyw/dsh-zju-tool-tyys` —— 体育场馆（tyys）写操作工具包。
 *
 * 一个包只装一个域：**场馆预约 / 取消预约**。
 *
 * 预约占名额、有时段，取消之后可能被别人约走，所以每个动作都要逐次批准。
 * 审批与注册器在 `tool/write-kit`，**不重复实现**。
 */
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';
import { createWriteToolRegistrar, contractOf, inputError, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-write-kit';
import { createTyysReadTools } from './reads.js';

export const name = 'zhiyun-tool-tyys';

export const inject = ['tools', 'approval', 'zhiyunTyys'];

const SERVICE_SOURCES = Object.freeze({
  zhiyunTyys: '@lybx-leyw/dsh-zju-source-tyys',
});

/**
 * 场馆写工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createTyysWriteTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
    {
      name: 'campus_venue',
      description: '预约体育场馆或取消预约。场地名额独立，取消之后名额可能被他人占掉。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['book', 'cancel'], description: 'book 预约、cancel 取消预约' },
          venue: { type: 'string', description: '场地编号（book 需要，由场馆查询结果给出）' },
          slot: { type: 'string', description: '时段（book 需要）' },
          date: { type: 'string', description: '预约日期 YYYY-MM-DD（book 需要）' },
          order: { type: 'string', description: '预约单号（cancel 需要）' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async prepare(args) {
        const action = str(args.action, 'action');
        // 先认 action，再取服务：写错了动作不该收到「包没装」。
        if (!['book', 'cancel'].includes(action)) {
          throw inputError(`tyys 只支持 book / cancel，收到 ${action}`);
        }

        if (action === 'book') {
          const venue = str(args.venue, '场地编号（预约需要）');
          const slot = str(args.slot, '时段（预约需要）');
          const date = str(args.date, '日期（预约需要）');
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw inputError('date 要写成 YYYY-MM-DD');
          const tyys = need('zhiyunTyys');
          const { prepare, execute, cancel } = contractOf(tyys, 'bookVenue');
          return { summary: await prepare({ venue, slot, date }), execute, cancel };
        }
        const order = str(args.order, '预约单号（取消需要）');
        const tyys = need('zhiyunTyys');
        const { prepare, execute, cancel } = contractOf(tyys, 'cancelVenue');
        return { summary: await prepare({ order }), execute, cancel };
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createWriteToolRegistrar({
    ctx,
    build: createTyysWriteTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createTyysWriteTools);

  // 读工具与写工具同域同 source，但**两条注册链**：读那条没有审批。
  createReadToolRegistrar({
    ctx,
    build: createTyysReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createTyysReadTools);
}

export { createTyysReadTools } from './reads.js';
