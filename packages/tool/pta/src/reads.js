/**
 * 拼题A（pta）**读**工具定义。
 *
 * # 与 `campus_answer` 的配套关系
 *
 * `campus_answer`（写）要 `problemSet`（题集 id）与 `problem`（题目编号），
 * 两者都只能从读侧拿到。缺这块，模型只能让用户猜编号 —— 交答案事实上不可用。
 *
 * # 为什么 `homeworkStart` / `homeworkFinish` 不在这里
 *
 * 「开始答题」在拼题A 会**启动计时**，交卷之后不能改。它们不是读，而且
 * 「替用户开计时」是替他做决定 —— `packages/tool/pta/README.md` 记过这条。
 * 本包只暴露**不改变状态**的那几条：题集列表、题集状态、题目、提交记录、进度。
 *
 * `exam` 这条要特别说清：它读的是 `/exams` 的状态（含服务端时间），
 * **不会**开计时。所以它可以当读工具放行，但描述里必须写明这一点，
 * 免得模型以为「调了它就算开始答题了」。
 *
 * # 顺序
 *
 * 用户通常先说题集名（「第三次作业」），平台要的是数字 id。这里的
 * `resolveSet()` 把名字解析成 id，**同名拒绝并给候选** —— 猜错等于看错题集，
 * 而两边都不报错（与 `tool/xuezai` 的课程解析同一条口径）。
 */

import { createReadToolRegistrar, defined, inputError, optInt, optStr, serviceLookup, str } from '@lybx-leyw/dsh-zju-tool-kit';

const SERVICE_SOURCES = Object.freeze({
  zwPta: '@lybx-leyw/dsh-zju-source-pta',
});

const ACTIONS = ['setList', 'setView', 'problemList', 'problemView', 'submissionList', 'submissionView', 'reconcile'];

/** 题集名 → 题集行。**不猜**：同名就拒绝并给候选。 */
async function resolveSet(service, wanted) {
  const query = str(wanted, '题集名或题集 id');
  if (/^\d+$/.test(query)) return { id: query, name: query };

  const listed = await service.problemSets({ includeEnded: true });
  const rows = Array.isArray(listed?.problemSets) ? listed.problemSets : [];
  const exact = rows.filter((row) => String(row.name ?? row.title ?? '') === query);
  const partial = exact.length ? exact : rows.filter((row) => String(row.name ?? row.title ?? '').includes(query));
  if (partial.length === 1) return { id: String(partial[0].id), name: String(partial[0].name ?? partial[0].title ?? '') };
  if (partial.length === 0) {
    throw inputError(
      `没有找到题集「${query}」。先看 setList（含已结束的）；拼题A 的题集名与班级里的写法一致。`,
    );
  }
  throw inputError(
    `「${query}」对上了 ${partial.length} 个题集：`
    + `${partial.map((row) => `${row.name ?? row.title}（${row.id}）`).join('、')}。请给更完整的名字或题集 id。`,
  );
}

/**
 * 读工具的定义。**纯数据 + 纯函数**。
 *
 * @param services - 已解析的 source 服务。
 * @returns 工具定义数组。
 */
export function createPtaReadTools(services) {
  const need = () => serviceLookup(services, 'zwPta', SERVICE_SOURCES.zwPta);

  return [
    {
      name: 'campus_pta_read',
      description:
        '查拼题A 的只读数据：题集列表、题集作答状态、题目清单、题目内容、我的提交记录、作答进度。'
        + 'campus_answer 要的题集编号与题目编号都从这里取。它不开始答题、不启动计时、不交卷 —— '
        + '那些是写操作，要用户逐次批准。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ACTIONS, description: '要查什么' },
          problemSet: { type: 'string', description: '题集名或题集 id（setView / problemList / problemView / submissionList / submissionView / reconcile 需要）' },
          problem: { type: 'string', description: '题目编号（problemView 需要；先用 problemList 取）' },
          submission: { type: 'string', description: '提交编号（submissionView 需要）' },
          problemType: { type: 'string', description: 'problemList：只看某类题（如 PROGRAMMING / CODE_COMPLETION；不给就取第一类有题的）' },
          page: { type: 'integer', minimum: 1, description: 'problemList：页码，默认 1' },
          limit: { type: 'integer', minimum: 1, maximum: 100, description: 'problemList 每页条数（默认 50）；submissionList 条数（默认 30）' },
          offset: { type: 'integer', minimum: 0, description: 'problemView：题目正文的起始偏移，默认 0' },
          maxCharacters: { type: 'integer', minimum: 1, description: 'problemView：正文截断长度，默认 16000' },
          before: { type: 'string', description: 'submissionList：只看这个时间之前的提交' },
          includeEnded: { type: 'boolean', description: 'setList：是否包含已结束的题集' },
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
        const pta = need();

        if (action === 'setList') {
          return pta.problemSets(defined({ includeEnded: args.includeEnded === true }));
        }

        const set = await resolveSet(pta, args.problemSet);

        switch (action) {
          case 'problemList':
            // 题集里的题目清单（含我的作答状态）。`problem` 那个编号从这里取 ——
            // 缺这一步，`problemView` 就又要让用户猜编号了。
            return {
              set,
              ...await pta.read(defined({
                action: 'problems',
                problemSetId: set.id,
                problemType: optStr(args.problemType, '题型'),
                page: optInt(args.page, 'page', { min: 1 }),
                limit: optInt(args.limit, 'limit', { min: 1, max: 100 }),
              })),
            };
          case 'setView':
            return { set, ...await pta.read({ action: 'exam', problemSetId: set.id }) };
          case 'problemView':
            return {
              set,
              ...await pta.read(defined({
                action: 'problem',
                problemSetId: set.id,
                problemId: str(args.problem, '题目编号（problemView 需要）'),
                offset: optInt(args.offset, 'offset', { min: 0 }),
                maxCharacters: optInt(args.maxCharacters, 'maxCharacters', { min: 1 }),
              })),
            };
          case 'submissionList':
            return {
              set,
              ...await pta.read(defined({
                action: 'submissions',
                problemSetId: set.id,
                before: optStr(args.before, 'before'),
                limit: optInt(args.limit, 'limit', { min: 1, max: 100 }),
              })),
            };
          case 'submissionView':
            return {
              set,
              ...await pta.read({
                action: 'submission',
                problemSetId: set.id,
                submissionId: str(args.submission, '提交编号（submissionView 需要）'),
              }),
            };
          case 'reconcile':
            return { set, ...await pta.read({ action: 'progress', problemSetId: set.id }) };
          default:
            // 上面已前置校验过 action，走到这里说明分派漏了一个 —— 那是本文件的 bug。
            throw new Error(`campus_pta_read 的 action 分派漏了 ${action}`);
        }
      },
    },
  ];
}

export function apply(ctx) {
  createReadToolRegistrar({
    ctx,
    build: createPtaReadTools,
    serviceSources: SERVICE_SOURCES,
  }).register(createPtaReadTools);
}
