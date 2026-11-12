/**
 * `@lybx-leyw/dsh-zju-tool-sztz` —— 二三四课堂（sztz）写操作工具包。
 *
 * 一个包只装一个域：**二课活动报名 / 取消报名**。
 *
 * 报名受名额限制，取消之后名额可能被他人占掉，所以每个动作都要逐次批准。
 * 审批与注册器在 `tool/write-kit`，**不重复实现**。
 */
import { createReadToolRegistrar } from '@lybx-leyw/dsh-zju-tool-kit';
import { createWriteToolRegistrar, contractOf, inputError, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-write-kit';
import { createSztzReadTools } from './reads.js';

export const name = 'zhiyun-tool-sztz';

export const inject = ['tools', 'approval', 'zhiyunSztz'];

const SERVICE_SOURCES = Object.freeze({
  zhiyunSztz: '@lybx-leyw/dsh-zju-source-sztz',
});

/**
 * 二课活动写工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createSztzWriteTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
    {
      name: 'campus_activity',
      description: '二课活动报名或取消报名。名额有限，取消之后名额可能被他人占掉。执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['signup', 'cancel'], description: 'signup 报名、cancel 取消报名' },
          activity: { type: 'string', description: '活动名（由查询结果给出）' },
        },
        required: ['action', 'activity'],
        additionalProperties: false,
      },
      async prepare(args) {
        const action = str(args.action, 'action');
        const activity = str(args.activity, '活动名');
        // 先认 action，再取服务：写错了动作不该收到「包没装」。
        if (!['signup', 'cancel'].includes(action)) {
          throw inputError(`sztz 只支持 signup / cancel，收到 ${action}`);
        }
        const sztz = need('zhiyunSztz');

        if (action === 'signup') {
          const { prepare, execute, cancel } = contractOf(sztz, 'signupActivity');
          return { summary: await prepare({ activity }), execute, cancel };
        }
        const { prepare, execute, cancel } = contractOf(sztz, 'cancelActivity');
        return { summary: await prepare({ activity }), execute, cancel };
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createWriteToolRegistrar({
    ctx,
    build: createSztzWriteTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createSztzWriteTools);

  // 读工具与写工具同域同 source，但**两条注册链**：读那条没有审批。
  createReadToolRegistrar({
    ctx,
    build: createSztzReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createSztzReadTools);
}

export { createSztzReadTools } from './reads.js';
