/**
 * 学在浙大（xuezai）**读**工具定义。
 *
 * # 为什么这些读工具是「让现有写工具能用」
 *
 * `campus_homework`（写）要 `homework` 参数，而它来自 `assignments()`；
 * `campus_checkin` 要课程，而课程 id 来自课程列表。缺了读侧，模型只能让用户
 * 猜编号 —— 交作业与点名功能事实上不可用。
 *
 * # 课程名怎么变成课程 id
 *
 * 用户的说法是「数据结构」，平台要的是数字 id。这一步是**工具层的知识**
 * （把话术翻成参数），所以在 `resolveCourse()` 里做，不塞进 source。
 *
 * 同名课**拒绝并列出候选**，不挑第一个：挑错的后果是把作业交给另一门课，
 * 而两边都不报错。这与 `source/zdbk` 的 `uniqueMatch`、本仓写工具的口径一致。
 */

import { createReadToolRegistrar, defined, inputError, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

/** 本包消费的 source 服务（与写工具同一份）。`inject` 由包入口 `index.js` 声明。 */
const SERVICE_SOURCES = Object.freeze({
  zhiyunXuezai: '@lybx-leyw/dsh-zju-source-xuezai',
});

const ACTIONS = [
  'todos', 'courseList', 'courseView', 'materialList',
  'homeworkList', 'homeworkView', 'rollcallHistory',
];

/** 把用户给的课程名/编号解析成课程。**不猜**：同名就拒绝并给候选。 */
async function resolveCourse(service, wanted) {
  const query = str(wanted, '课程名或课程 id');
  if (/^\d+$/.test(query)) return { id: query, name: query };

  const listed = await service.xzzdRead({ action: 'courses' });
  const courses = Array.isArray(listed?.courses) ? listed.courses : [];
  const exact = courses.filter((row) => row.name === query);
  const partial = exact.length ? exact : courses.filter((row) => row.name.includes(query));
  if (partial.length === 1) return partial[0];
  if (partial.length === 0) {
    throw inputError(
      `没有找到课程「${query}」。这门课可能不在本学期：先看 courseList（不给 course 时只列当前学期），`
      + '或直接用课程 id。',
    );
  }
  throw inputError(
    `「${query}」对上了 ${partial.length} 门课：${partial.map((row) => `${row.name}（${row.id}）`).join('、')}。`
    + '请给出更完整的课程名或课程 id —— 猜一个等于把作业交给另一门课。',
  );
}

/**
 * 读工具的定义。**纯数据 + 纯函数**，不碰 Cordis。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createXuezaiReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunXuezai', SERVICE_SOURCES.zhiyunXuezai);

  return [
    {
      name: 'campus_xuezai_read',
      description:
        '查学在浙大的只读数据：待办、本人课程与课程详情、课程文件、作业列表与作业详情、课堂点名历史。'
        + '交作业前必须先用 homeworkList 取作业、用 courseList 取课程 id；'
        + 'campus_homework 与 campus_checkin 要的正是这些编号。全部不需要审批。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          course: { type: 'string', description: '课程名（支持常见简称）或课程 id；courseView / materialList / homeworkList / homeworkView / rollcallHistory 需要' },
          homework: { type: 'string', description: '作业名或作业 id（homeworkView 需要；可用 homeworkList 查到）' },
          mode: { type: 'string', enum: ['fast', 'slow', 'diff'], description: 'todos：fast 走聚合端点（默认）、slow 逐课抓、diff 两路对账' },
          semester: { type: 'string', description: 'courseList：学期 id；不给时只列正在上的学期' },
          page: { type: 'integer', minimum: 1, description: '分页页码，默认 1（材料、作业、活动）' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 30' },
          withSubmissions: { type: 'boolean', description: 'homeworkList：是否附带提交状态' },
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
        const service = need();
        const page = optInt(args.page, 'page', { min: 1 }) ?? 1;
        const pageSize = optInt(args.pageSize, 'pageSize', { min: 1, max: 100 }) ?? 30;

        switch (action) {
          case 'todos': {
            const mode = optStr(args.mode, 'mode') ?? 'fast';
            const result = await service.todos();
            const half = result?.xzzd ?? { ok: false, rows: [], error: null };
            return {
              ...half,
              mode,
              note: '这是学在浙大的一半；拼题A 的待办在 source/pta。mode=diff 的对账诊断要靠 ZHIYUN_TODOS 环境变量，本工具只转述结果。',
            };
          }
          case 'courseList':
            return service.xzzdRead(defined({
              action: 'courses',
              semester: optStr(args.semester, '学期 id'),
            }));
          case 'courseView': {
            const course = await resolveCourse(service, args.course);
            const bundle = await service.xzzdRead({ action: 'courseBundle', courseId: course.id });
            return { course, ...courseView(bundle) };
          }
          case 'materialList': {
            const course = await resolveCourse(service, args.course);
            const result = await service.xzzdRead({ action: 'materials', courseId: course.id, page, pageSize });
            return { course, ...result };
          }
          case 'homeworkList': {
            const course = await resolveCourse(service, args.course);
            const result = await service.xzzdRead({
              action: 'assignments',
              courseId: course.id,
              page,
              pageSize,
              withSubmissions: Boolean(args.withSubmissions),
            });
            return {
              course,
              ...result,
              note: 'assignments 里每条的 id 就是 campus_homework 要的 homework；deadline 为 null 表示老师没设截止。',
            };
          }
          case 'homeworkView': {
            const course = await resolveCourse(service, args.course);
            const listed = await service.xzzdRead({ action: 'assignments', courseId: course.id, page: 1, pageSize: 100 });
            const rows = Array.isArray(listed?.assignments) ? listed.assignments : [];
            const target = pickHomework(rows, args.homework);
            const detail = await service.xzzdRead({ action: 'activity', activityId: target.id });
            const submissions = await service.xzzdRead({
              action: 'submission',
              activityId: target.id,
              courseId: course.id,
              groupSetId: target.groupSetId ?? undefined,
              isGroup: target.isGroup ?? undefined,
            });
            return { course, homework: { id: target.id, title: target.title }, detail, submissions };
          }
          case 'rollcallHistory': {
            const course = await resolveCourse(service, args.course);
            return {
              course,
              ...await service.xzzdRead({ action: 'rollcallHistory', courseId: course.id }),
            };
          }
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_xuezai_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

/** 作业名 → 作业行。**不猜**：同名就拒绝并给候选。 */
function pickHomework(rows, wanted) {
  const query = str(wanted, '作业名或作业 id（homeworkView 需要）');
  if (/^\d+$/.test(query)) {
    const hit = rows.find((row) => String(row.id) === query);
    if (hit) return hit;
    throw inputError(`这门课里没有 id 为 ${query} 的作业。先用 homeworkList 看有哪些。`);
  }
  const exact = rows.filter((row) => row.title === query);
  const partial = exact.length ? exact : rows.filter((row) => String(row.title ?? '').includes(query));
  if (partial.length === 1) return partial[0];
  if (partial.length === 0) {
    throw inputError(`这门课里没有叫「${query}」的作业。先用 homeworkList 看有哪些（截止时间也在那里）。`);
  }
  throw inputError(
    `「${query}」对上了 ${partial.length} 个作业：${partial.map((row) => `${row.title}（${row.id}）`).join('、')}。`
    + '请写更完整的作业名或作业 id。',
  );
}

/**
 * 把 `courseBundle()` 的原始数据收成「章节 + 每章的活动」。
 *
 * 拼装在工具层而不是 source：`courseBundle` 是平台的事实，而「给模型看
 * 简介 + 章节 + 活动」是呈现决定。章节与活动的关联靠 `module_id` /
 * `syllabus_id`（与上游 `courseTree` 同一套字段，但本仓自己实现）。
 */
function courseView(bundle) {
  const activities = Array.isArray(bundle?.activities) ? bundle.activities : [];
  const rows = (list) => list.map((row) => ({
    id: row.id == null ? null : String(row.id),
    title: row.title ?? '',
    type: row.type ?? null,
    deadline: row.end_time ?? null,
    startTime: row.start_time ?? null,
    submitted: typeof row.submitted === 'boolean' ? row.submitted : null,
  }));
  return {
    count: activities.length,
    activities: rows(activities),
    exams: rows(Array.isArray(bundle?.exams) ? bundle.exams : []),
    classrooms: rows(Array.isArray(bundle?.classrooms) ? bundle.classrooms : []),
    note: 'activities 里每条的 id 就是 campus_homework / campus_checkin 要的活动 id。'
      + '课程简介与章节树不在本数据源里：source 只回答平台事实，视图拼装留给调用方。',
  };
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createXuezaiReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createXuezaiReadTools);
}
