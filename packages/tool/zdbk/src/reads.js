/**
 * 教务网（zdbk）**读**工具定义。
 *
 * # 为什么这些读工具是「让现有写工具能用」，不是「加功能」
 *
 * `campus_course_select`（写）要 `section`（教学班号），而班号只能从
 * `selectionSections()` 拿到。缺了读侧，模型只能问用户要一个用户根本不知道的
 * 编号 —— 选课功能事实上不可用。同一件事也发生在 `selectionCourses` 的 `pool`：
 * 它不是课程代码，是「这一次查询的课程池」，只有 source 知道怎么给。
 *
 * 所以这里的参数**只收用户手里有的东西**（课程名、关键词、年份、专业名），
 * 其余（`pool` / `category` / 教学班号）由前一个 action 的输出提供，
 * 并在描述里写明「先用哪个 action 取」。
 *
 * # 为什么读操作不过审批
 *
 * 审批只给会改变平台状态的动作。给「查成绩」配一个批准对话框，用户会养成
 * 一路点同意的习惯 —— 等真的选课、交作业时，那次点击就不再有意义。
 *
 * # 为什么一个工具带 action 枚举
 *
 * 上游把 162 条命令压进 1 个 `zju` 工具，是为了不挤占上下文；本仓相反，
 * 一个动作一个字段齐全的工具。两种都走到了极端。这里取中间：**一个域一个
 * 工具 + action 枚举**（本仓 `campus_course_select` / `campus_post` 已是这种形状），
 * 既让参数有名字，也不让工具表从 13 涨到 97。
 */

import { createReadToolRegistrar, defined, inputError, optBool, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

/**
 * 本包消费的 source 服务（与写工具同一份 —— 一个域一个数据源）。
 *
 * `inject` / `name` 由包入口 `index.js` 声明：一个包只有一个名字，
 * 读与写两条注册链共用它。
 */
const SERVICE_SOURCES = Object.freeze({
  zhiyunZdbk: '@lybx-leyw/dsh-zju-source-zdbk',
});

/** `campus_zdbk_read` 的 action 表。顺序即描述里列举的顺序。 */
const ACTIONS = [
  'timetable', 'exams', 'grades', 'gpa', 'planList', 'planView',
  'selectionContext', 'selectionCourses', 'selectionSearch',
  'selectionSections', 'selectionSelected', 'selectionCredits',
];

/**
 * 读工具的定义。**纯数据 + 纯函数**，不碰 Cordis、不碰审批。
 *
 * @param services - 已解析的 source 服务（缺的那个动作如实报错）。
 * @returns 工具定义数组。
 */
export function createZdbkReadTools(services) {
  const need = () => serviceLookup(services, 'zhiyunZdbk', SERVICE_SOURCES.zhiyunZdbk);

  return [
    {
      name: 'campus_zdbk_read',
      description:
        '查教务网（本科教务）的只读数据：课表、考试安排、成绩与 GPA、培养方案、选课查询。'
        + '选课前必须先用 selectionContext / selectionCourses / selectionSearch 找到课程，再用 selectionSections 取教学班号（section）—— '
        + 'campus_course_select 要的正是那个教学班号。查成绩、课表不需要任何审批。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          academic_year: { type: 'string', description: '学年，如 2025-2026（课表、考试、成绩）' },
          semester: { type: 'integer', enum: [1, 2, 3, 4], description: '学期：1 秋冬、2 春夏、3 暑、4 短学期（考试、成绩）' },
          term: { type: 'string', description: '课表用的学期写法，如「秋」「春夏」（可不给，默认按学年推）' },
          major_only: { type: 'boolean', description: 'grades：只看主修课' },
          upcoming_only: { type: 'boolean', description: 'exams：只看还没考的' },
          year: { type: 'string', description: 'planList / planView：入学年份，如 2025' },
          college: { type: 'string', description: 'planList：按学院名筛选' },
          major: { type: 'string', description: 'planList 按专业名筛选；planView 指定要哪个专业的培养方案' },
          category: { type: 'string', description: 'selectionCourses 的页签类别码（来自 selectionContext），默认 xk_1' },
          name: { type: 'string', description: 'selectionCourses：页签名，同一个类别码下有多个页签时用来消歧' },
          keyword: { type: 'string', description: 'selectionSearch：搜索关键词' },
          field: { type: 'string', description: 'selectionSearch：关键词匹配的字段，默认 kcmc（课程名称）' },
          only_available: { type: 'boolean', description: 'selectionSearch：只看还有余量的' },
          course: { type: 'string', description: 'selectionSections：课程代码（selectionCourses 的 code，不是课程名）' },
          pool: { type: 'string', description: 'selectionSections：课程号（selectionCourses 的 pool，不是课程代码）' },
          with_credits: { type: 'boolean', description: 'selectionSelected：是否附学分汇总，默认 true' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      async run(args) {
        const action = str(args.action, 'action');
        if (!ACTIONS.includes(action)) {
          throw inputError(`不认识的 action：${action}。可选 ${ACTIONS.join(' / ')}`);
        }
        // 先认 action 再取服务：用户把 action 写错了，不该先收到「包没装」。
        const zdbk = need();
        const year = optStr(args.year, '入学年份');
        const major = optStr(args.major, '专业名');

        switch (action) {
          case 'timetable':
            return zdbk.timetable(defined({
              academic_year: optStr(args.academic_year, '学年'),
              term: optStr(args.term, '学期'),
            }));
          case 'exams':
            return zdbk.exams(defined({
              academic_year: optStr(args.academic_year, '学年'),
              semester: optInt(args.semester, '学期', { min: 1, max: 4 }),
              upcoming_only: optBool(args.upcoming_only, 'upcoming_only'),
            }));
          case 'grades':
            return zdbk.grades(defined({
              academic_year: optStr(args.academic_year, '学年'),
              semester: optInt(args.semester, '学期', { min: 1, max: 4 }),
              major_only: optBool(args.major_only, 'major_only'),
            }));
          case 'gpa':
            return zdbk.gpaSummary();
          case 'planList':
            return zdbk.planList(defined({
              year,
              college: optStr(args.college, '学院名'),
              major,
            }));
          case 'planView':
            return zdbk.planView(defined({ year, major }));
          case 'selectionContext':
            return zdbk.selectionContext();
          case 'selectionCourses':
            return zdbk.selectionCourses(defined({
              category: optStr(args.category, '类别码'),
              name: optStr(args.name, '页签名'),
            }));
          case 'selectionSearch':
            return zdbk.selectionSearch(defined({
              keyword: optStr(args.keyword, '关键词'),
              field: optStr(args.field, '搜索字段'),
              only_available: optBool(args.only_available, 'only_available'),
            }));
          case 'selectionSections':
            return zdbk.selectionSections(defined({
              course: optStr(args.course, '课程代码'),
              pool: optStr(args.pool, '课程号'),
              category: optStr(args.category, '类别码'),
            }));
          case 'selectionSelected':
            return zdbk.selectionSelected(defined({
              with_credits: optBool(args.with_credits, 'with_credits'),
            }));
          case 'selectionCredits':
            return zdbk.selectionCredits();
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_zdbk_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export function apply(ctx) {
  const registrar = createReadToolRegistrar({
    ctx,
    build: createZdbkReadTools,
    serviceSources: SERVICE_SOURCES,
  });
  registrar.register(createZdbkReadTools);
}
