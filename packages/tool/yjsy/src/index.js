/**
 * 研究生教务网（yjsy）**读**工具定义。
 *
 * 只有一条 provides：`yjsy timetable`。纯只读，按学年学期取课表。
 *
 * 注意它**不是**本科教务的课表（那个在 `campus_zdbk_read` 的 `timetable`）：
 * 两个平台、两套登录、两份课表。研究生同时有本科教务账号时会看到两份不同的表，
 * 这是对的 —— 工具描述里写明了问的是哪一个。
 */

import { createReadToolRegistrar, defined, optStr, serviceLookup } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunYjsy: '@lybx-leyw/dsh-zju-source-yjsy',
});

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createYjsyReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunYjsy', SERVICE_SOURCES.zhiyunYjsy);

  return [
    {
      name: 'campus_yjsy_read',
      description:
        '查研究生教务网的课表（按学年与学期）。这是研究生系统的课表，不是本科教务的 —— '
        + '本科生课表用 campus_zdbk_read 的 timetable。不需要审批。',
      parameters: {
        type: 'object',
        properties: {
          year: { type: 'string', description: '学年，如 2025-2026；不给时按当前学年' },
          term: { type: 'string', description: '学期，如「秋」「春夏」；不给时按当前学期' },
        },
        required: [],
        additionalProperties: false,
      },
      async run(args) {
        const yjsy = need();
        return yjsy.timetable(defined({
          year: optStr(args.year, '学年'),
          term: optStr(args.term, '学期'),
        }));
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createYjsyReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createYjsyReadTools);
}
