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
 * # 三条边界：哪些进读工具，哪些不进
 *
 * 这个文件里每条 action 都在它自己的注释里说明**为什么是读**。三条边界是：
 *
 *   1. **只读平台的原始数据**（课程 / 节次 / 资源 / 字幕 / 直播状态）；
 *   2. **不启动采集、不停止采集** —— `liveStart` / `liveStop` 会起停后台循环、
 *      占住 transport，属于写；
 *   3. **不安装任何东西** —— `setupPlan` 只给「要放到哪、从哪取」的计划，
 *      `executed` 恒为 false；真正装依赖要宿主安装层，见 N-3。
 *
 * `check` 与 `setupPlan` 都在第 1 条与第 3 条之间：它们读的是**本机状态**
 * （FFmpeg 版本、模型文件在不在），不读平台，也不改任何东西 —— 所以它们是读。
 */

import { createReadToolRegistrar, defined, inputError, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zhiyunClassroom: '@lybx-leyw/dsh-zju-source-classroom',
});

const ACTIONS = [
  'courseList', 'searchCourses', 'lessonList', 'resourceList', 'captionSearch',
  'liveStatus', 'liveText', 'liveCandidates',
  'check', 'setupPlan',
];

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
        + '按关键词在字幕里定位原文、实时字幕采集的本地状态、某个时间点的课堂文字、'
        + '今天还值得开始采字幕的直播课次（liveCandidates，供 startLive 用）。'
        + '还能做本地组件诊断（check）与安装计划（setupPlan，只说装到哪、绝不动手）。'
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
          date: { type: 'string', description: 'liveCandidates：查哪一天（YYYY-MM-DD），默认今天（北京时间）' },
          course: { type: 'string', description: 'liveCandidates：只看这门课（课程名或 courseId）；重名时会给候选让你指定 courseId' },
          component: { type: 'string', enum: ['all', 'asr', 'media'], description: 'check / setupPlan：查哪一类本地组件，默认 all' },
          verify: { type: 'boolean', description: 'check：连 SHA-256 一起校验（要读约 240 MB，默认只比大小）' },
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
          /**
           * `liveCandidates` —— 「今天哪些课还能开始采字幕」。
           *
           * 这是 `live start` 的**入参来源**，但它本身是读：只是查课表、筛掉已散场
           * 与非直播的课次，不建会话、不发订阅。真正的 `liveStart` 会起后台循环、
           * 占住 transport，属于写，不在本工具里。
           *
           * 之所以要单独一个 action：`liveStart` 要 `courseId` / `subId` /
           * `startsAt` / `endsAt` 四个值，而模型手上通常只有「现在」。没有这个
           * action 时它只能拿 `lessonList`（回放口径、编号体系不同）硬凑，凑错的
           * 表现是「采集建起来了但一直 waiting」—— 那种失败看起来像「还没开播」。
           */
          case 'liveCandidates': {
            if (typeof classroom.live?.remaining !== 'function') {
              throw inputError('这个数据源版本还没有 liveCandidates（缺 LiveSource.remaining）');
            }
            return classroom.live.remaining(optStr(args.date, '日期'), defined({
              course: optStr(args.course, '课程'),
            }));
          }
          /**
           * `check` —— 本地组件诊断（对应上游 `zhiyun check`）。
           *
           * 读：跑一次 `ffmpeg -version`、stat 几个模型文件。**不装任何东西**。
           * 缺什么、怎么办都在结果的 `action` 字段里。
           */
          case 'check':
            return classroom.check(optStr(args.component, 'component') ?? 'all', defined({
              ...(args.verify === undefined ? {} : { verify: args.verify === true }),
            }));
          /**
           * `setupPlan` —— 安装计划（对应上游 `zhiyun setup` 的**计划面**）。
           *
           * 这是本轮唯一的「不硬做」项，理由见 `diagnostics.js` 的 `setupPlan`
           * 与交付报告：装 FFmpeg 要 `npm install`（本仓硬禁止），下模型要 241 MB
           * 且属安装层（N-3）。所以这里给的是**可复算的步骤**（目标路径、URL、
           * 字节数、SHA-256），`executed` 恒为 false，一步都不执行。
           *
           * 把它做成读工具是合理的：它不产生任何副作用，输出完全可以由
           * `check` 的结果推出 —— 只是把「缺什么」翻译成「放到哪」。
           *
           * ⚠️ 直接取 source 上的方法（`source.setupPlan`）而不是自己算：
           * 目标路径必须由数据源决定（`dataDirectory` / `asrHome` 只有它知道），
           * 工具层自己拼路径就等于把「装到哪」这个知识复制了一份。
           */
          case 'setupPlan': {
            const plan = classroom.setupPlan;
            if (typeof plan !== 'function') {
              throw inputError('这个数据源版本还没有 setupPlan；用 check 看缺什么，或升级 source-classroom');
            }
            return plan.call(classroom, optStr(args.component, 'component') ?? 'all');
          }
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
