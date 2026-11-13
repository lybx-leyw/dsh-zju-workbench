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

import { createReadToolRegistrar, defined, inputError, optBool, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

/** 本包消费的 source 服务（与写工具同一份）。`inject` 由包入口 `index.js` 声明。 */
const SERVICE_SOURCES = Object.freeze({
  zwXuezai: '@lybx-leyw/dsh-zju-source-xuezai',
});

const ACTIONS = [
  'todos', 'courseList', 'courseView', 'materialList',
  'homeworkList', 'homeworkView', 'rollcallHistory',
  'materialDownload', 'homeworkDownload',
];

/**
 * 拆分用户给的一串名字。
 *
 * 用竖线与逗号两种分隔：用户在中文输入法下很容易打出全角竖线（`｜`），
 * 而 `kinds` 参数在 `tool/classroom` 里用的是逗号 —— 两种都收，
 * 免得「分隔符不对」变成一次猜谜。
 *
 * @param value - 原始字符串。
 * @param name - 参数名（报错时用）。
 * @returns 名字数组，或 undefined（没给）。
 */
function splitNames(value, name) {
  const text = optStr(value, name, { max: 2000 });
  if (text === undefined) return undefined;
  const names = text.split(/[|｜,，]/).map((item) => item.trim()).filter(Boolean);
  if (names.length === 0) throw inputError(`${name} 里没有名字`);
  return names;
}

/**
 * 拆分 `parts`（作业下载取哪几类文件）。
 *
 * @param value - 原始字符串。
 * @returns `['attachments'|'submission'|'corrections', ...]`，或 undefined。
 */
function splitParts(value) {
  const text = optStr(value, 'parts', { max: 200 });
  if (text === undefined) return undefined;
  const allowed = ['attachments', 'submission', 'corrections'];
  const parts = text.split(/[|｜,，]/).map((item) => item.trim()).filter(Boolean);
  if (parts.length === 0) throw inputError('parts 里没有内容');
  for (const part of parts) {
    if (!allowed.includes(part)) {
      throw inputError(`parts 里只认 ${allowed.join(' / ')}，收到「${part}」`);
    }
  }
  return parts;
}

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
 * # 下载为什么也在这一条注册链上（不过审批）
 *
 * 判据是**会不会改变平台上的状态**。下载只从平台读字节、往本机写文件，
 * 平台侧一个字节都没变；而审批链的定位（`tool/write-kit` 的说明）就是
 * 「会改变外部状态、做错了没法靠再读一次挽回」的那一类。给下载配批准框的
 * 代价是可预期的：用户会把「同意」当成翻页，等真的交作业时那次点击就没有
 * 意义了 —— 这条理由 `tool/classroom/src/reads.js` 与 `tool/cc98/src/reads.js`
 * 都写着，本包没有理由换一套。
 *
 * 同仓的先例也正是下载：`campus_cc98_read` 的 `topicDownload` 把一个楼层里的
 * 文件流式落盘，走的就是读链、不过审批。两个下载能力在同一仓里用两套审批
 * 口径，比任何单独一边的口径都更难解释。
 *
 * 「写本机文件」这一半不是不管，而是**关在已知范围内**（这些都在 source 侧）：
 *
 *   1. 目录根由装配层定（`config.downloadDir` → 默认 `<数据目录>/downloads`），
 *      调用方**传不进路径** —— 参数里只有课程 id、活动 id、文件名；
 *   2. 文件名过 `safeFileName()` 并再核一次真实路径仍在根之下，防路径穿越；
 *   3. 目标已存在时**永不覆盖**，同名只会另存 `(n)`；
 *   4. 不默认下整门课：`all` 必须显式给，否则只下点名的文件。
 *
 * 参数里**没有 `dir` / `path` / `output`**，这是刻意的：一个能传路径的下载
 * 工具等于把「写到哪」交给模型。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createXuezaiReadTools(services) {
  const need = () => serviceLookup(services, 'zwXuezai', SERVICE_SOURCES.zwXuezai);

  return [
    {
      name: 'campus_xuezai_read',
      description:
        '查学在浙大的只读数据：待办、本人课程与课程详情、课程文件、作业列表与作业详情、课堂点名历史；'
        + '以及把课件 / 作业附件 / 本人提交 / 老师批改存到本机（materialDownload、homeworkDownload）。'
        + '交作业前必须先用 homeworkList 取作业、用 courseList 取课程 id；'
        + 'campus_homework 与 campus_checkin 要的正是这些编号。全部不需要审批 —— '
        + '下载只往本机写文件，不改变平台上的任何状态。'
        + '下载不接受目录参数：文件落在插件数据目录的 downloads 下，按「课程 / 类别 / 作业」分层。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么，或要下载什么' },
          course: { type: 'string', description: '课程名（支持常见简称）或课程 id；除 todos / courseList 外都需要' },
          homework: { type: 'string', description: '作业名或作业 id（homeworkView / homeworkDownload 需要；可用 homeworkList 查到）' },
          // ⚠️ 没有 `mode`：待办走哪条路（fast / slow / diff）由 source 读
          // `ZW_TODOS` 环境变量决定，工具层传什么都没有效果。留一个
          // 「传了但被忽略」的参数，会让模型以为它切了模式。

          semester: { type: 'string', description: 'courseList：学期 id；不给时只列正在上的学期' },
          page: { type: 'integer', minimum: 1, description: '分页页码，默认 1（材料、作业、活动）' },
          pageSize: { type: 'integer', minimum: 1, maximum: 100, description: '每页条数，默认 30' },
          withSubmissions: { type: 'boolean', description: 'homeworkList：是否附带提交状态' },

          /* ── 下载 ── */
          names: {
            type: 'string',
            description: '下载：文件名（或课件所在活动的标题），多个用竖线分隔。'
              + '与 all 二选一；不给名字又不给 all 会报错，不会默认下整门课。',
          },
          uploadIds: {
            type: 'string',
            description: '下载：平台的文件 id，多个用竖线或逗号分隔（materialList / homeworkView 的 files[].id）。'
              + '名字对不上时用它最稳。',
          },
          all: {
            type: 'boolean',
            description: 'materialDownload：下这门课的全部课件。必须显式给；一门课的视频常有几个 GB。',
          },
          parts: {
            type: 'string',
            description: 'homeworkDownload：取哪几类，可用 attachments（老师给的附件）、'
              + 'submission（本人最近一次提交）、corrections（老师批改后传回的文件），逗号分隔；默认三类全取。',
          },
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
            const result = await service.todos();
            const half = result?.xzzd ?? { ok: false, rows: [], error: null };
            return {
              ...half,
              note: '这是学在浙大的一半；拼题A 的待办在 source/pta。'
                + '两条抓取路径（fast 聚合端点 / slow 逐课）由数据源的 ZW_TODOS 环境变量选择，'
                + '结果里的形状是一样的。',
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
          case 'materialDownload': {
            const course = await resolveCourse(service, args.course);
            const all = optBool(args.all, 'all');
            const names = splitNames(args.names, 'names');
            const uploadIds = splitNames(args.uploadIds, 'uploadIds');
            // 三个入口互斥：`all` 是「整门课」，另外两个是「点名的那些」。
            // 同时给会让结果取决于实现里的判序 —— 那是我们不想让用户去猜的东西。
            if (all === true && (names || uploadIds)) {
              throw inputError('all 与 names / uploadIds 只给一个：要整门课就 all，要挑就点名');
            }
            if (!all && !names && !uploadIds) {
              throw inputError('要么用 names / uploadIds 点名要哪几个文件，要么显式给 all=true 下整门课');
            }
            return {
              course,
              ...await service.xzzdDownload(defined({
                action: 'materials',
                courseId: course.id,
                course: course.name,
                names,
                uploadIds,
                all: all === true ? true : undefined,
              })),
              note: '文件落在插件数据目录的 downloads 下（按课程 / 课件分层）。'
                + '大小一致的已有文件直接复用；同名不同大小的另存 (n)，不覆盖。',
            };
          }
          case 'homeworkDownload': {
            const course = await resolveCourse(service, args.course);
            const listed = await service.xzzdRead({ action: 'assignments', courseId: course.id, page: 1, pageSize: 100 });
            const rows = Array.isArray(listed?.assignments) ? listed.assignments : [];
            const target = pickHomework(rows, args.homework);
            return {
              course,
              homework: { id: target.id, title: target.title },
              ...await service.xzzdDownload(defined({
                action: 'homework',
                activityId: target.id,
                courseId: course.id,
                course: course.name,
                names: splitNames(args.names, 'names'),
                uploadIds: splitNames(args.uploadIds, 'uploadIds'),
                parts: splitParts(args.parts),
              })),
              note: '三类落在同一个作业目录：老师给的附件、本人最近一次提交、老师批改（在「老师批改」子目录）。'
                + '提交与批改文件每次都重下（重交后同名内容会变），已有同名文件另存 (n)，不覆盖。',
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
