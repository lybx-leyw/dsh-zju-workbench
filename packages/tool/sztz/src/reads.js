/**
 * 二课（sztz）**读**工具定义。
 *
 * # 为什么报名要读侧
 *
 * `campus_activity`（写）要活动编号，而编号只能从 `activities()` 拿到。
 * 缺这块，模型只能让用户猜编号 —— 报名事实上不可用。
 *
 * # `favorite` 在 `index.js`，不在本文件
 *
 * 上游 `sztz activity favorite`（收藏 / 取消收藏）是**写操作**：它改变平台上的
 * 状态，`hdsc` 还是开关式接口（重发一次就反向）。所以它按 D17 归写工具
 * （`campus_activity` 的 `favorite` / `unfavorite`），走审批链。本文件只做读。
 */

import { createReadToolRegistrar, defined, inputError, optBool, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zwSztz: '@lybx-leyw/dsh-zju-source-sztz',
});

const ACTIONS = ['activities', 'newActivities', 'mine', 'credits', 'projects', 'notices'];

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createSztzReadTools(services) {
  const need = () => serviceLookup(services, 'zwSztz', SERVICE_SOURCES.zwSztz);

  return [
    {
      name: 'campus_sztz_read',
      description:
        '查二课（素质拓展）的只读数据：活动列表、新活动、我报名的/收藏的/已认定的活动、记点与成绩单、'
        + '可认定记点的项目库、平台通知。campus_activity 要的活动编号来自这里。'
        + '报名、取消报名、收藏、取消收藏都是写操作，在 campus_activity 里，需要审批。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          keyword: { type: 'string', description: 'activities / projects：名称里的文字' },
          date: { type: 'string', description: 'activities：只看这一天的活动（YYYY-MM-DD）' },
          includeEnded: { type: 'boolean', description: 'activities：是否包含已结束的活动' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'activities：最多几条，默认 30' },
          category: { type: 'string', description: 'projects：分类或类别，如「第三课堂」「学科竞赛」' },
          reset: { type: 'boolean', description: 'newActivities：清空本地已读记录后重新算「新」' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async run(args) {
        const action = str(args.action, 'action');
        if (!ACTIONS.includes(action)) {
          throw inputError(`不认识的 action：${action}。可选 ${ACTIONS.join(' / ')}`);
        }
        // 先认 action 再取服务：action 写错时不该先收到「包没装」。
        const sztz = need();

        switch (action) {
          case 'activities':
            return sztz.activities(defined({
              keyword: optStr(args.keyword, '关键词'),
              date: optStr(args.date, '日期'),
              includeEnded: optBool(args.includeEnded, 'includeEnded'),
              limit: optInt(args.limit, 'limit', { min: 1, max: 100 }),
            }));
          case 'newActivities':
            // ⚠️ 这一条会**写本地已读记录**（不动平台数据）。source 的说明里写明了。
            return sztz.newActivities(defined({ reset: args.reset === true }));
          case 'mine':
            return sztz.myActivities();
          case 'credits':
            return sztz.myCredits();
          case 'projects':
            return sztz.projects(defined({
              keyword: optStr(args.keyword, '关键词'),
              category: optStr(args.category, '分类'),
            }));
          case 'notices':
            return sztz.bulletins();
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_sztz_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createSztzReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createSztzReadTools);
}
