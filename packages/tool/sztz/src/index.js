/**
 * `@lybx-leyw/dsh-zju-tool-sztz` —— 二三四课堂（sztz）写操作工具包。
 *
 * 一个包只装一个域：**二课活动报名 / 取消报名 / 收藏 / 取消收藏**。
 *
 * 报名受名额限制，取消之后名额可能被他人占掉，所以每个动作都要逐次批准。
 * **收藏也要批准**：它同样改变平台上的状态，而且 `hdsc` 是开关接口 ——
 * 对已收藏的活动再发一次就是取消收藏，方向是反的。
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
 * 一个 action 名 → source 里的**动作前缀**（`${前缀}Prepare` / `Execute` / `Cancel`）。
 *
 * # 为什么用一张表而不是 if/else
 *
 * 每个分派分支都要 `contractOf(sztz, 前缀)` 再拼 `{ summary, execute, cancel }`，
 * 那是四行一模一样的代码。写成表之后「新增一个 action」只剩一行，而
 * **漏写 `cancel` 是不可能的** —— 前缀由 `contractOf` 统一取三个方法，
 * 缺任何一个都会在 prepare 阶段就报 `CONTRACT_MISSING`。
 *
 * 表里的值必须与 `source/sztz` 服务面上的方法前缀逐字一致。
 */
const ACTIONS = Object.freeze({
  signup: 'signupActivity',
  cancel: 'cancelActivity',
  favorite: 'favoriteActivity',
  unfavorite: 'unfavoriteActivity',
});

/** action → 参数看着像什么（报错文案用）。 */
const ACTION_WORDS = Object.freeze({
  signup: '报名',
  cancel: '取消报名',
  favorite: '收藏',
  unfavorite: '取消收藏',
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
      description: '二课（素质拓展）活动：报名、取消报名、收藏、取消收藏。'
        + '名额有限，取消之后名额可能被他人占掉；收藏是开关式接口，重复点会反向。'
        + '执行前会请求你批准。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['signup', 'cancel', 'favorite', 'unfavorite'],
            description: 'signup 报名、cancel 取消报名、favorite 收藏、unfavorite 取消收藏',
          },
          activity: { type: 'string', description: '活动名（由查询结果给出）' },
        },
        required: ['action', 'activity'],
        additionalProperties: false,
      },
      async prepare(args) {
        const action = str(args.action, 'action');
        const activity = str(args.activity, '活动名');
        // 先认 action，再取服务：写错了动作不该收到「包没装」。
        const prefix = ACTIONS[action];
        if (!prefix) {
          throw inputError(`sztz 只支持 ${Object.keys(ACTIONS).join(' / ')}，收到 ${action}`);
        }
        const sztz = need('zhiyunSztz');
        const { prepare, execute, cancel } = contractOf(sztz, prefix);
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
