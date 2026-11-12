/**
 * 查老师（chalaoshi）**读**工具定义。
 *
 * 三条 provides 全部是读：`chalaoshi search` / `teacher` / `course`。
 *
 * # 「必须联网」的两条
 *
 * `teacher` 取的是教师详情页、`course` 取的是绩点表 —— 两者都不在本地索引里，
 * 所以每次都要打站点。而站点在国内公网不可达，所以它们**经常失败**，
 * 且失败原因是网络而不是「查不到」。工具描述里写明了，免得模型把网络失败
 * 说成「这位老师不存在」。
 *
 * # 教师名要消歧义
 *
 * 同名教师很常见（尤其单名）。`teacher` 走「先搜再定位」，同名时**拒绝并列候选**，
 * 不挑第一个 —— 挑错的后果是把 A 老师的评价当成 B 老师的。
 */

import { createReadToolRegistrar, defined, inputError, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zwChalaoshi: '@lybx-leyw/dsh-zju-source-chalaoshi',
});

const ACTIONS = ['search', 'teacher', 'course'];

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createChalaoshiReadTools(services) {
  const need = () => serviceLookup(services, 'zwChalaoshi', SERVICE_SOURCES.zwChalaoshi);

  return [
    {
      name: 'campus_chalaoshi_read',
      description:
        '在查老师上查浙大课程的教师评价与给分：按姓名/拼音/首字母/学院找教师、读一位教师的详情页、'
        + '查一门课所有任课老师的平均绩点。'
        + '教师详情与课程绩点**每次都要联网**，而这个站点在国内公网不可达 —— '
        + '连不上时如实说明是网络问题，不是「查不到」。索引检索本身可离线。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          keyword: { type: 'string', description: 'search：姓名、全拼或首字母，可再带学院名；只写学院名则列出该学院教师' },
          teacher: { type: 'string', description: 'teacher：教师姓名（与 id 二选一）' },
          teacherId: { type: 'string', description: 'teacher：教师 id（可从 search 结果拿到；给了就不按名字找）' },
          college: { type: 'string', description: 'search / teacher：学院名，用来消歧' },
          course: { type: 'string', description: 'course：课程名（写法要与查老师页面一致，如「微积分（甲）Ⅰ」）' },
          sort: { type: 'string', enum: ['relevance', 'rate', 'hot', 'name'], description: 'search：排序，默认 relevance' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: 'search：最多几条，默认 20' },
          fresh: { type: 'boolean', description: 'search：忽略本地索引缓存、重新拉一份' },
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
        const chalaoshi = need();

        switch (action) {
          case 'search':
            return chalaoshi.search(defined({
              keyword: str(args.keyword, '关键词（姓名、拼音、首字母或学院）'),
              college: optStr(args.college, '学院名'),
              sort: optStr(args.sort, '排序'),
              limit: optInt(args.limit, 'limit', { min: 1, max: 200 }),
              fresh: args.fresh === true ? true : undefined,
            }));
          case 'teacher': {
            const id = optStr(args.teacherId, '教师 id');
            if (id !== undefined) return chalaoshi.teacher({ id });
            const name = str(args.teacher, '教师姓名或教师 id');
            // 没有 id 就先搜：同名必须拒绝，不能取第一个。
            const hits = await chalaoshi.search(defined({
              keyword: name,
              college: optStr(args.college, '学院名'),
              limit: 20,
            }));
            const teachers = Array.isArray(hits?.teachers) ? hits.teachers : [];
            const exact = teachers.filter((row) => row.name === name);
            const picked = exact.length ? exact : teachers;
            if (picked.length === 1) return chalaoshi.teacher({ id: picked[0].id });
            if (picked.length === 0) {
              throw inputError(
                `查老师里没有「${name}」。可以试试拼音或首字母，或先 search 看相近的名字。`,
              );
            }
            throw inputError(
              `「${name}」对上了 ${picked.length} 位教师：`
              + `${picked.map((row) => `${row.name}（${row.college ?? '学院未知'}，id ${row.id}）`).join('、')}。`
              + '请加 college 学院，或直接给 teacherId。',
            );
          }
          case 'course':
            return chalaoshi.course({ course: str(args.course, '课程名') });
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_chalaoshi_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export const name = 'zw-tool-chalaoshi';

/**
 * 惰性注入：`tools` 由宿主提供，`zwChalaoshi` 由对应的 source 包提供。
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
export const inject = ['tools', 'zwChalaoshi'];

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createChalaoshiReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createChalaoshiReadTools);
}
