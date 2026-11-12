/**
 * 实验课平台（lab）**读**工具定义。
 *
 * # 为什么选实验要读侧
 *
 * `campus_lab_select`（写）要 `lab`（实验项目）与 `week`（周次），
 * 两者都只能从 `labs()` / `weekStatus()` 拿到。缺这块，选实验同样只能让
 * 用户猜编号。
 *
 * # 本包不做「选课 / 退课」
 *
 * `source/lab` 的写面只有 `campus_lab_select` 一个动作（上游 `lab select`）。
 * 本文件只补读，不扩大写面。
 */

import { createReadToolRegistrar, defined, inputError, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zwLab: '@lybx-leyw/dsh-zju-source-lab',
});

const ACTIONS = ['terms', 'currentTerm', 'courseList', 'labList', 'weekStatus', 'mySelections', 'openStatus', 'notices', 'timetable', 'myInfo'];

/** 把用户给的课程名/编号解析成本人课程。**不猜**：同名就拒绝并给候选。 */
async function resolveCourse(service, wanted) {
  const query = str(wanted, '课程名或课程 id');
  if (/^\d+$/.test(query)) return { id: query, name: query };

  const rows = await service.myCourses({});
  const list = Array.isArray(rows?.courses) ? rows.courses : (Array.isArray(rows) ? rows : []);
  const nameOf = (row) => String(row?.courseName ?? row?.name ?? '');
  const exact = list.filter((row) => nameOf(row) === query);
  const partial = exact.length ? exact : list.filter((row) => nameOf(row).includes(query));
  if (partial.length === 1) return { id: String(partial[0].id ?? partial[0].courseId), name: nameOf(partial[0]) };
  if (partial.length === 0) {
    throw inputError(`没有找到课程「${query}」。先看 courseList（不给 course 时按当前学期列）。`);
  }
  throw inputError(
    `「${query}」对上了 ${partial.length} 门课：${partial.map((row) => `${nameOf(row)}（${row.id ?? row.courseId}）`).join('、')}。`
    + '请给更完整的课程名或课程 id。',
  );
}

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createLabReadTools(services) {
  const need = () => serviceLookup(services, 'zwLab', SERVICE_SOURCES.zwLab);

  return [
    {
      name: 'campus_lab_read',
      description:
        '查实验课平台的只读数据：学期列表与当前学期、我的实验课、一门课的实验项目与周次状态、'
        + '我的选课结果、选课开放状态、平台通知、实验课表、本人信息。'
        + 'campus_lab_select 要的 lab 与 week 来自这里。选实验是写操作，需要审批。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          course: { type: 'string', description: '课程名或课程 id（labList / weekStatus / openStatus / mySelections 可用）' },
          term: { type: 'string', description: '学期（courseList / weekStatus / mySelections / openStatus / timetable 可用），不给时按当前学期' },
          courseId: { type: 'string', description: 'labList 也可直接给课程 id' },
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
        const lab = need();
        const term = optStr(args.term, '学期');

        switch (action) {
          case 'terms':
            return lab.terms();
          case 'currentTerm':
            return lab.currentTerm();
          case 'courseList':
            return lab.myCourses(defined({ term }));
          case 'labList': {
            // 显式给 courseId 时不做名字解析（调用方已经知道自己在问哪门课）。
            const id = args.courseId !== undefined
              ? str(args.courseId, '课程 id')
              : (await resolveCourse(lab, args.course)).id;
            return lab.labs({ courseId: id });
          }
          case 'weekStatus':
            return lab.weekStatus(defined({ term }));
          case 'mySelections':
            return lab.mySelections(defined({ term }));
          case 'openStatus':
            return lab.openStatus(defined({ term }));
          case 'notices':
            return lab.notices();
          case 'timetable':
            return lab.myTimetable(defined({ term }));
          case 'myInfo':
            return lab.myInfo();
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_lab_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createLabReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createLabReadTools);
}
