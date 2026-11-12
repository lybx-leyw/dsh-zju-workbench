/**
 * 智云课堂（classroom 平台）**读**工具定义。
 *
 * # 与 `study_catalog` / `study_read` / `study_search` 的分工
 *
 * 那三个工具读的是**已整理的讲义**（`zhiyunStudy` 的知识库），属于「学习空间」；
 * 本文件的工具读的是**平台上的原始数据**（课程、节次、课件、字幕、直播状态），
 * 属于 `source/classroom`。两者不是同一层：讲义是加工过的，平台数据是取证用的。
 * 放在同一个包里，是因为它们是同一个域（课堂），只是数据来源不同。
 *
 * # 为什么搜字幕 / 搜课件值得做成工具
 *
 * 「这节课讲过什么」「点名了没有」这类问题，模型拿不到平台数据就只能猜。
 * 而字幕检索（`searchCaptions`）正是原文定位 —— 它是**读数**，不是生成，
 * 所以它属于工具面，不属于 agent 自己的推断。
 *
 * # 直播只读状态，不启动/停止
 *
 * `liveStart` / `liveStop` 会起停后台采集进程（改状态、占资源），
 * 而且直播链路还没真机验证（清单 B-3）。本包只暴露 `liveStatus` 与 `liveText`
 * 这两条**纯本地**的读 —— 一个不留神启动的采集进程没人会发现。
 */

import { createReadToolRegistrar, defined, inputError, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunClassroom: '@lybx-leyw/dsh-zju-source-classroom',
});

const ACTIONS = ['courseList', 'searchCourses', 'lessonList', 'resourceList', 'captionSearch', 'liveStatus', 'liveText'];

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createClassroomReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunClassroom', SERVICE_SOURCES.zhiyunClassroom);

  return [
    {
      name: 'campus_classroom_read',
      description:
        '查智云课堂平台上的只读数据：我选的课、按关键词/教师搜课、某门课的节次、某节课的课件与录像、'
        + '按关键词在字幕里定位原文、实时字幕采集的本地状态、某个时间点的课堂文字。'
        + '它读的是平台原始数据；已整理的讲义用 study_catalog / study_read / study_search。'
        + '开始或停止直播采集是写操作，本工具不做。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          courseId: { type: 'string', description: '课程编号（lessonList / resourceList / captionSearch / liveStatus / liveText）' },
          subId: { type: 'string', description: '节次编号（resourceList / liveStatus / liveText）' },
          keyword: { type: 'string', description: 'searchCourses：课程名关键词；captionSearch：要定位的说法（几个说法用顿号或竖线分隔）' },
          teacher: { type: 'string', description: 'searchCourses：教师名' },
          page: { type: 'integer', minimum: 1, description: 'searchCourses：页码，默认 1（每页 16 条）' },
          onlyPlayable: { type: 'boolean', description: 'lessonList：只看已能点播的节次，默认 true' },
          kinds: { type: 'string', description: 'resourceList：只看某几类（video,audio,ppt,slides,subtitles），逗号分隔；不给就是全部' },
          days: { type: 'integer', minimum: 1, maximum: 14, description: 'captionSearch：给 courseId 时展开最近几天，默认 7' },
          limit: { type: 'integer', minimum: 1, description: 'captionSearch：最多几条命中，默认 100' },
          at: { type: 'string', description: 'liveText：时间点（ISO 时间或毫秒时间戳）；不给就取最新的' },
          before: { type: 'integer', minimum: 0, description: 'liveText：往前取多少毫秒，默认 300000（5 分钟）' },
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
        const classroom = need();

        switch (action) {
          case 'courseList':
            return classroom.listCourses({});
          case 'searchCourses':
            return classroom.searchCourses(defined({
              keyword: optStr(args.keyword, '课程名关键词') ?? '',
              teacher: optStr(args.teacher, '教师名') ?? '',
              page: optInt(args.page, 'page', { min: 1 }) ?? 1,
            }));
          case 'lessonList':
            return classroom.listLessons(
              str(args.courseId, '课程编号'),
              defined({ onlyPlayable: args.onlyPlayable === undefined ? undefined : args.onlyPlayable === true }),
            );
          case 'resourceList':
            return classroom.searchResources(
              str(args.courseId, '课程编号'),
              str(args.subId, '节次编号'),
              defined({ kind: optStr(args.kinds, '资料类型') }),
            );
          case 'captionSearch':
            return classroom.searchCaptions(defined({
              keyword: str(args.keyword, '要定位的说法'),
              courseId: optStr(args.courseId, '课程编号'),
              days: optInt(args.days, 'days', { min: 1, max: 14 }),
              limit: optInt(args.limit, 'limit', { min: 1 }),
            }));
          case 'liveStatus':
            return classroom.liveStatus(defined({
              courseId: optStr(args.courseId, '课程编号'),
              subId: optStr(args.subId, '节次编号'),
            }));
          case 'liveText':
            return classroom.liveText(defined({
              courseId: optStr(args.courseId, '课程编号'),
              subId: optStr(args.subId, '节次编号'),
              at: optStr(args.at, '时间点'),
              before: optInt(args.before, 'before', { min: 0 }),
            }));
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_classroom_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createClassroomReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createClassroomReadTools);
}
