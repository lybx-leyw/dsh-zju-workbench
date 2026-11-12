/**
 * 体艺（tyys）**读**工具定义。
 *
 * # 为什么预约要读侧
 *
 * `campus_venue`（写）要场馆与时段，而场馆目录 / 时段表 / 须知都只能从读侧拿到。
 * 缺这块，用户只能看到「预约失败」，而不是「还剩哪几个时段」。
 *
 * # 签到的两半要分开
 *
 * 上游把「签到」放在体育课里，而本仓的 `source/tyys` 只实现到**考勤历史**
 * （`attendance()`，纯读）。真正的签到现在没有对应方法 —— 它不是缺工具，
 * 是基础函数没写完。所以这里只暴露历史，不建一个点了会报错的工具。
 */

import { createReadToolRegistrar, defined, inputError, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunTyys: '@lybx-leyw/dsh-zju-source-tyys',
});

const ACTIONS = ['venueList', 'venueSlots', 'venueNotice', 'orderList', 'rollcallHistory'];

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createTyysReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunTyys', SERVICE_SOURCES.zhiyunTyys);

  return [
    {
      name: 'campus_tyys_read',
      description:
        '查体育馆与体艺课的只读数据：场馆目录与余量、某场馆某天的时段表、预约须知与放号时刻、'
        + '我的预约订单、体育课考勤历史。campus_venue 要的场馆与时段来自这里。'
        + '预约与取消是写操作，在 campus_venue 里，需要审批。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          sport: { type: 'string', description: 'venueList：项目，如「羽毛球」' },
          campus: { type: 'string', description: 'venueList：校区' },
          venue: { type: 'string', description: 'venueList / orderList：场馆名' },
          date: { type: 'string', description: 'venueList / venueSlots / orderList：日期（YYYY-MM-DD）' },
          time: { type: 'string', description: 'venueList：时段写法，如 19:00-20:00' },
          venueSiteId: { type: 'string', description: 'venueSlots：场馆 ID（从场馆目录取）' },
          course: { type: 'string', description: 'rollcallHistory：课程名（可不给）' },
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
        const tyys = need();

        switch (action) {
          case 'venueList':
            return tyys.venues(defined({
              sport: optStr(args.sport, '项目'),
              campus: optStr(args.campus, '校区'),
              venue: optStr(args.venue, '场馆名'),
              date: optStr(args.date, '日期'),
              time: optStr(args.time, '时段'),
            }));
          case 'venueSlots':
            return tyys.slots(defined({
              venueSiteId: str(args.venueSiteId, '场馆 ID'),
              date: optStr(args.date, '日期'),
            }));
          case 'venueNotice':
            return tyys.notice();
          case 'orderList':
            return tyys.orders(defined({
              date: optStr(args.date, '日期'),
              venue: optStr(args.venue, '场馆名'),
            }));
          case 'rollcallHistory':
            return tyys.attendance(defined({ course: optStr(args.course, '课程名') }));
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_tyys_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createTyysReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createTyysReadTools);
}
