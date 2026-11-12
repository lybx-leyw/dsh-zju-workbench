/**
 * `study_courses` —— 学习资料的**入口索引**。
 *
 * # 它解决什么问题
 *
 * 原先的 `study_catalog` 只能浏览**已经加工过**的讲义。于是 AI 遇到「老师下周讲到哪」
 * 这类问题时，手里没有课程/节次的编号，只能猜、或者反复试探 —— 表现为「跑很久」。
 *
 * 更糟的是：**没整理过的课在目录里根本不存在**。用户以为「AI 看不到我的课」，
 * 实际是数据源里就没有那条记录（`core/knowledge` 的 record 要加工时才 `put()`）。
 *
 * 这个工具把「有哪些课」与「哪些整理过」分开回答：
 *
 * | 它给什么 | 从哪来 |
 * | --- | --- |
 * | 你选了哪些课、每门的学期与教师 | `source/classroom` 的 `listCourses()`（**实时**） |
 * | 每门课有几节、哪几节有内容 | `listLessons()`（**实时**） |
 * | 每节的整理状态（有 wiki / 只有原始素材 / 什么都没有） | `core/knowledge` 的 record |
 *
 * **未整理的课也会列出来**，`state` 标 `raw` 或 `none`。这样 AI 不会把
 * 「没整理」误当成「没这门课」。
 *
 * # 为什么它不直接返回正文
 *
 * 目录只给索引。正文在 `study_read`（wiki）与 `raw_*`（原始素材）里 ——
 * 一个工具做一件事，模型才分得清自己在读什么。
 */

import { createReadToolRegistrar, inputError, optInt, optStr, serviceLookup } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zwStudy: '@lybx-leyw/dsh-zju-core-study',
  zwClassroom: '@lybx-leyw/dsh-zju-source-classroom',
});

/** 这一节的整理状态。 */
export const LESSON_STATES = Object.freeze([
  /** 有 wiki 讲义（`lecture` 非空）—— 能直接回答「这个知识点讲了什么」。 */
  'wiki',
  /** 只有原始素材（PPT / 转写稿），没生成讲义 —— 能回查原话，但没有整理过的结构。 */
  'raw',
  /** 资料库里什么都没有 —— 要先去 `raw_transcript` 拉转写稿，或去智云课堂看。 */
  'none',
]);

/**
 * 把 knowledge 的记录整理成「课程 → 节次 → 状态」的索引。
 *
 * @param records - `knowledge.listByAccount()` 的结果。
 * @returns `Map<courseId, Map<subId, {state, title, blocks}>>`。
 */
export function indexRecords(records) {
  const byCourse = new Map();
  for (const record of records ?? []) {
    const courseId = String(record?.courseId ?? '');
    const subId = String(record?.subId ?? '');
    if (!courseId || !subId) continue;
    if (!byCourse.has(courseId)) byCourse.set(courseId, new Map());
    const lecture = record.lecture;
    const hasWiki = Boolean(lecture && typeof lecture === 'object');
    const blocks = Array.isArray(record.blocks) ? record.blocks.length : 0;
    byCourse.get(courseId).set(subId, {
      state: hasWiki ? 'wiki' : (blocks > 0 ? 'raw' : 'none'),
      blocks,
      title: typeof lecture?.title === 'string' ? lecture.title : null,
    });
  }
  return byCourse;
}

/**
 * 从一串课程里按名字挑出候选。
 *
 * # 为什么可能返回多个
 *
 * 同名课跨学期很常见（「大学物理」秋季一次、春夏一次）。这时**不能默认挑一个** ——
 * 用户问的是这学期的物理，挑上学期的就是问牛答马。所以返回全部候选，
 * 由调用方（或模型去问用户）决定。
 *
 * 排序让**没结束的 / 名称完全相等**的排前面，这样常见的单命中场景直接拿到对的。
 *
 * @param courses - `listCourses()` 的 items。
 * @param wanted - 用户说的课名（可以是片段）。
 * @returns 命中的课程数组（可能空、可能多个）。
 */
export function matchCourses(courses, wanted) {
  const key = String(wanted ?? '').trim().toLowerCase();
  if (!key) return [];
  const all = Array.isArray(courses) ? courses : [];
  const exact = all.filter((c) => String(c.title ?? '').trim().toLowerCase() === key);
  const partial = all.filter((c) => String(c.title ?? '').toLowerCase().includes(key));
  const hits = exact.length ? exact : partial;
  // 完全同名优先 > 名字短的优先（「物理」比「大学物理（荣誉）」更贴近用户说法）
  return [...hits].sort((a, b) => String(a.title).length - String(b.title).length);
}

/**
 * 造 `study_courses` 工具的定义。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createStudyCoursesTools(services) {
  const need = (key) => serviceLookup(services, key, SERVICE_SOURCES[key]);

  return [
    {
      name: 'study_courses',
      description:
        '学习资料的**入口索引**：你现在选了哪些课、每门课的学期与教师、每门课有几节、'
        + '以及每一节的整理状态。**整理过的课与没整理的课都会列出来** —— '
        + '`state: wiki` 表示有整理好的讲义（用 study_read 读），'
        + '`state: raw` 表示只有原始素材（PPT / 转写稿，用 raw_transcript 读），'
        + '`state: none` 表示资料库里还没有这一节（原始素材也还没拉）。'
        + '**不知道课程编号或节次编号时，先调它**，不要凭猜写编号。'
        + '用户只说了课名（如「我的物理课」）时，用 course 参数查；'
        + '若同名课出现在多个学期，工具会把候选全列出来，'
        + '这时**要问用户是哪一门**（直接问课名或学期名），不要默认挑一个。',
      parameters: {
        type: 'object',
        properties: {
          course: { type: 'string', description: '按课名筛选（可用片段）。不给就列出全部课程' },
          term: { type: 'string', description: '按学期名筛选，如「2025-2026 春夏」。不给就是全部学期' },
          includeLessons: { type: 'boolean', description: '是否列出每节的节次编号与整理状态，默认 true' },
          currentOnly: { type: 'boolean', description: '只看当前学期（按课名里的学年学期判断），默认 false' },
          limit: { type: 'integer', minimum: 1, maximum: 200, description: '最多几门课，默认 50' },
        },
        required: [],
        additionalProperties: false,
      },
      async run(args = {}, context = {}) {
        const signal = context.signal;
        signal?.throwIfAborted();
        if (args && typeof args !== 'object' || Array.isArray(args)) throw inputError('参数无效');
        const allowed = ['course', 'term', 'includeLessons', 'currentOnly', 'limit'];
        if (Object.keys(args).some((key) => !allowed.includes(key))) throw inputError('工具参数无效；不接受账号或文件路径');

        const courseQuery = optStr(args.course, '课名', { max: 200 });
        const termQuery = optStr(args.term, '学期', { max: 100 });
        const includeLessons = args.includeLessons !== false;
        const limit = optInt(args.limit, 'limit', { min: 1, max: 200 }) ?? 50;

        const study = need('zwStudy');
        const classroom = need('zwClassroom');
        await study.ready;

        // 课程列表来自**平台**（实时），不是来自资料库 —— 所以未整理的课也在。
        const listed = await classroom.listCourses({ signal });
        signal?.throwIfAborted();
        let courses = Array.isArray(listed?.items) ? listed.items : [];

        if (termQuery) {
          const key = termQuery.toLowerCase();
          courses = courses.filter((item) => String(item.termName ?? '').toLowerCase().includes(key));
        }
        if (courseQuery) courses = matchCourses(courses, courseQuery);
        if (args.currentOnly === true) {
          const current = currentTermOf(courses.map((item) => item.termName));
          if (current) courses = courses.filter((item) => item.termName === current);
        }

        const total = courses.length;
        courses = courses.slice(0, limit);

        const user = await study.user();
        const accountId = String(user.id);
        const records = await study.knowledge.listByAccount({ accountId });
        signal?.throwIfAborted();
        const index = indexRecords(records);

        const items = [];
        for (const course of courses) {
          signal?.throwIfAborted();
          const courseId = String(course.id);
          const known = index.get(courseId);
          const row = {
            courseId,
            title: course.title,
            term: course.termName ?? null,
            teacher: course.teacher ?? null,
            progress: course.progress ?? null,
            learnedCount: course.learnedCount ?? null,
            totalCount: course.totalCount ?? null,
          };
          if (includeLessons) {
            const lessons = await classroom.listLessons(courseId, { signal }).catch(() => null);
            signal?.throwIfAborted();
            const knownIds = new Set((lessons?.items ?? []).map((item) => String(item.subId)));
            // 资料库里有、但平台没列出来的节次也要给 —— 否则「整理过但已下架」的课会消失。
            for (const subId of known?.keys() ?? []) knownIds.add(subId);
            row.lessons = [...knownIds].sort().map((subId) => {
              const meta = known?.get(subId);
              return {
                subId,
                state: meta?.state ?? 'none',
                ...(meta?.title ? { wikiTitle: meta.title } : {}),
              };
            });
            row.counts = countStates(row.lessons);
          } else {
            const states = [...(known?.values() ?? [])].map((meta) => meta.state);
            row.counts = countStates(states.map((state) => ({ state })));
          }
          items.push(row);
        }

        return {
          guidance:
            '这是入口索引，不是内容。回答「讲了什么」要用 study_read（wiki）或 raw_transcript（原始素材）。'
            + 'state 的含义：wiki = 已整理成讲义；raw = 只有原始素材；none = 资料库里还没有。'
            + '同名课出现在多个学期时，先问用户是哪一门，不要默认挑一个。',
          items,
          total,
          truncated: total > courses.length,
        };
      },
    },
  ];
}

/**
 * 统计一节节的整理状态。
 *
 * @param lessons - `[{ state }]`。
 * @returns `{ wiki, raw, none, total }`。
 */
function countStates(lessons) {
  const counts = { wiki: 0, raw: 0, none: 0, total: lessons.length };
  for (const lesson of lessons) if (counts[lesson.state] !== undefined) counts[lesson.state] += 1;
  return counts;
}

/**
 * 从一组学期名里挑出「最可能是当前学期」的那个。
 *
 * # 为什么不能真的算
 *
 * 平台给的 `termName` 是「2025-2026 春夏」这种自然语言，没有起止日期。
 * 硬按今天的月份推会错（暑学期、小学期、跨年的秋冬学期都不一样）。
 *
 * 所以这里只做一件事：**取排序最后的那个**。学期名的学年在前、学季在后，
 * 字典序恰好等于时间序（秋冬 < 春夏）。这样 `currentOnly` 至少不会挑到
 * 两个学年之前的那门课。
 *
 * @param termNames - 学期名数组（可含 null）。
 * @returns 最可能的当前学期名，没有时返回 null。
 */
function currentTermOf(termNames) {
  const names = [...new Set(termNames.filter((name) => typeof name === 'string' && name.trim()))];
  if (!names.length) return null;
  return names.sort().at(-1);
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createStudyCoursesTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createStudyCoursesTools);
}
