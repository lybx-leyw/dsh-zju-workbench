/**
 * 校内通知（notice）**读**工具定义。
 *
 * 纯只读数据源（`source/notice` 的 `readOnly: true`），四条 provides 全部是读：
 * `notice list` / `view` / `new` / `sources`。
 *
 * # `new` 会写**本地**已读记录
 *
 * 它不是平台写操作（不改变任何站点状态），但它会更新本机的「上次看到哪」。
 * 工具描述里写明了这一点 —— 否则模型会以为它是幂等查询，反复调用会把
 * 「新通知」这个状态消耗掉。
 *
 * # 一次读多个来源的代价
 *
 * `list` 会并发扫多个栏目（`source` 筛选可缩小）。这是**已知的设计**：
 * 上游也是这么做的，不扫就不知道有没有通知。所以工具参数里保留了
 * `source` / `keyword` / `limit` 这些缩小面。
 */

import { createReadToolRegistrar, defined, inputError, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunNotice: '@lybx-leyw/dsh-zju-source-notice',
});

const ACTIONS = ['list', 'view', 'new', 'sources'];

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createNoticeReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunNotice', SERVICE_SOURCES.zhiyunNotice);

  return [
    {
      name: 'campus_notice_read',
      description:
        '查浙大校内通知的只读数据：合并多个栏目的通知列表、按标题或链接读全文、上次查看之后新发布的、'
        + '以及可选的来源与学院名录。'
        + 'new 会更新本机「上次看到哪」的已读记录（不改任何站点数据）。'
        + '部分栏目要统一身份认证，没登录时会如实说要先配「浙大一卡通」。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          keyword: { type: 'string', description: 'list：关键词（new 不收关键词：它按「上次看到哪」算新）' },
          source: { type: 'string', description: 'list / new：只查这些来源（名称或 id，多个用竖线分隔）' },
          since: { type: 'string', description: 'list：只看这个时间之后发布的（YYYY-MM-DD）' },
          until: { type: 'string', description: 'list：只看这个时间之前发布的（YYYY-MM-DD）' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'list：最多几条，默认 10（上限 200）' },
          title: { type: 'string', description: 'view：通知标题（与 url 二选一）' },
          url: { type: 'string', description: 'view：通知链接（多个用竖线分隔；与 title 二选一）' },
          reset: { type: 'boolean', description: 'new：清空本地已读记录后重新算「新」' },
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
        const notice = need();

        switch (action) {
          case 'list':
            return notice.list(defined({
              keyword: optStr(args.keyword, '关键词'),
              source: optStr(args.source, '来源'),
              since: optStr(args.since, 'since'),
              until: optStr(args.until, 'until'),
              limit: optInt(args.limit, 'limit', { min: 1, max: 200 }),
            }));
          case 'view':
            return notice.view(defined({
              title: optStr(args.title, '通知标题'),
              url: optStr(args.url, '通知链接'),
            }));
          case 'new':
            // `noticeNew` 只认 `source` / `reset`（它按已读记录算「新」）。
            // 这里**不**把 keyword 塞进去：塞了会被静默忽略，而模型会以为
            // 「按关键词过滤的新通知」生效了。
            return notice.noticeNew(defined({
              source: optStr(args.source, '来源'),
              reset: args.reset === true ? true : undefined,
            }));
          case 'sources':
            return notice.sources({});
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_notice_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export const name = 'zhiyun-tool-notice';

/**
 * 惰性注入：`tools` 由宿主提供，`zhiyunNotice` 由对应的 source 包提供。
 *
 * # 为什么必须声明
 *
 * 不声明时宿主不会等服务就绪，`ctx.tools` 可能是 undefined —— 那时
 * `apply` 里访问 `ctx.tools.register` 直接抛
 * `Cannot read properties of undefined`。
 *
 * 同一个 workspace 里的 `tool/classroom` / `tool/cc98` / `tool/xxt`
 * 都声明了，这四个包当初漏了。因为这个包一直没被 preset 挂载，
 * 「不声明也能跑」从未被验证过。
 */
export const inject = ['tools', 'zhiyunNotice'];

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createNoticeReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createNoticeReadTools);
}
