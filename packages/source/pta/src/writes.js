/**
 * 拼题A 的答题写操作：**算参数 + 执行**两段。
 *
 * # 契约（与其它包同一套）
 *
 * | 方法 | 做什么 | 会不会改变状态 |
 * | --- | --- | --- |
 * | `xxxPrepare(args)` | 查题集、查题目、判能不能写、算说明 | 不会 |
 * | `xxxExecute(signal)` | 发提交请求 | **会** |
 *
 * # 这个包比其它包难，难在两处（都在本文件里解决，不推给调用方）
 *
 * ## 1. 按题型分批
 *
 * 拼题A 的提交接口是**按题型**收的：一次请求只能提交同一类型的若干小题。
 * 上游把答案按 `type` 分组，非聚类题型（编程/填空）一题一批，聚类题型
 * （选择/判断/多选）整组一批。
 *
 * 分批错了的症状很隐蔽：平台会接受请求但只存进去一部分答案。
 *
 * ## 2. 整题型保存会**替换**上次记录
 *
 * 聚类题型提交时，如果只带本轮改的那几题，**其它题的答案会被清掉**。
 * 所以提交前要把上次的 `submissionDetails` 合并进来 —— 上游这么做的，
 * 本文件照做：不合并就等于静默删掉用户的答案。
 *
 * # 两处**尚未实现**（不是裁决，已记进 `coverage-gaps.md`）
 *
 * - 「开始作业」（`POST /api/problem-sets/{id}/exams`）：需要一个答题实例。
 *   我先前把它写成「不做」，理由是「替用户开作业会让计时跑」。**那个理由只对
 *   「自动开」成立，对「用户明确要求开」不成立** —— 用户点了批准就是明确要求。
 * - 「提前结束作业」（`PUT /api/exams/{id}/end`）：同上。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

/**
 * 聚类题型：这些题型的答案可以一批提交，且**整组替换**。
 *
 * 表来自上游 `types.ts` 的 `CLUSTERED`。改动这张表等于改变提交语义，
 * 不是「顺手补一类」的事。
 */
const CLUSTERED = new Set(['MULTIPLE_CHOICE', 'MULTIPLE_SELECTION', 'TRUE_OR_FALSE', 'FILL_IN_THE_BLANK']);

/**
 * 支持「存草稿」的题型。
 *
 * 上游的判据：聚类题型走整组提交，编程/代码填空/SQL 走单题草稿，
 * 别的题型（主观题等）只能正式提交。
 */
const DRAFTABLE = new Set([...CLUSTERED, 'PROGRAMMING', 'CODE_COMPLETION', 'SQL_PROGRAMMING']);

/** 一次写操作的会话。执行后清空，避免重放。 */
class WriteSession {
  constructor() {
    this.prepared = null;
  }

  set(summarized, run) {
    this.prepared = { summarized, run };
    return summarized;
  }

  async run(signal) {
    if (!this.prepared) {
      throw new ClassroomError('NEED_PREPARE', '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。');
    }
    return this.prepared.run(signal);
  }

  clear() {
    this.prepared = null;
  }
}

/** 参数错误。 */
const invalid = (message) => new ClassroomError('INVALID_ARGUMENT', message);

/**
 * 把答案分成提交批次。
 *
 * # 两种形态
 *
 * - **聚类题型**：同一题型的多条合成一批（`details` 多条）；
 * - **非聚类题型**：一题一批（`problemId` 指向单题）。
 *
 * 草稿只对非聚类题型可用（上游口径）。
 *
 * @param prepared - `[{ problemId, type, detail }]`。
 * @param mode - `'save'` 或 `'submit'`。
 * @returns 批次数组。
 */
export function groupBatches(prepared, mode) {
  const batches = [];
  for (const item of prepared) {
    const clustered = CLUSTERED.has(item.type);
    // 聚类题型找同类批次合并；非聚类题型每批只有一题。
    const previous = clustered ? batches.find((batch) => batch.type === item.type) : undefined;
    if (previous) {
      previous.details.push(item.detail);
      continue;
    }
    batches.push({
      type: item.type,
      details: [item.detail],
      ...(clustered ? {} : { problemId: item.problemId }),
      // 草稿只对非聚类题型；聚类题型一律走正式提交。
      draft: mode === 'save' && !clustered,
    });
  }
  return batches;
}

/**
 * 一个小题的截止时间（毫秒）。
 *
 * # 这里踩过坑（已修）
 *
 * `client.problem()` 返回的 `deadline` 是 **`{ iso, text }` 对象**（由
 * `pta.js` 的 `normalizeDeadline` 产出），不是字符串。先前写成
 * `Date.parse(row.deadline ?? '')` → 对象被转成 `"[object Object]"` → **恒 `NaN`**
 * → 「截止时间校验」那行**从未生效**，过期作业照样能过。
 *
 * 三种输入都处理：
 * - `{ iso, text }` —— `problem()` 的正常形状；
 * - 字符串 —— 上游某些端点直接给 ISO 串；
 * - `null` / 空 —— 没有截止时间（长期开放的练习集），返回 0 表示「不限制」。
 *
 * @param value - `deadline` 字段。
 * @returns 毫秒时间戳；没有或不可解析时为 0。
 */
function deadlineAt(value) {
  const raw = value && typeof value === 'object' ? value.iso : value;
  if (raw == null || raw === '') return 0;
  const at = Date.parse(String(raw));
  return Number.isFinite(at) ? at : 0;
}

/**
 * 「现在」的毫秒时间戳。
 *
 * 服务端时间优先 —— 用本机时钟判截止会在时区或时间漂移时判错。
 *
 * @param serverTime - `examOf()` 给的 `serverTime`（可能是 `null`）。
 * @returns 毫秒时间戳。
 */
function nowAt(serverTime) {
  const at = serverTime ? Date.parse(String(serverTime)) : NaN;
  return Number.isFinite(at) ? at : Date.now();
}

/**
 * 把学在浙大的写法反过来：`pta` 的写方法。
 *
 * @param client - 已配置 Cookie 的 `PtaApi`。
 * @returns 写操作集合。
 */
export function createPtaWrites(client) {
  /**
   * 造一对 Prepare / Execute。
   *
   * @param name - 动作名（报错时用）。
   * @param build - `(args) => Promise<{ summarized, run }>`。
   * @returns `{ prepare, execute }`。
   */
  const pair = (name, build) => {
    const session = new WriteSession();
    return {
      prepare: async (args = {}) => {
        if (session.prepared) {
          throw new ClassroomError('WRITE_BUSY', `${name} 上一次还没执行完，先别重复准备。`, { action: name });
        }
        const { summarized, run } = await build(args);
        session.set(summarized, run);
        return summarized;
      },
      execute: async (signal) => {
        try {
          return await session.run(signal);
        } catch (error) {
          if (error instanceof ClassroomError && !error.details?.action) {
            error.details = { ...(error.details ?? {}), action: name };
          }
          throw error;
        } finally {
          session.clear();
        }
      },
    };
  };

  /**
   * 查题集的答题实例。没有实例时如实报「先去网页上开始」。
   *
   * # 这里曾经是死链（已修）
   *
   * 先前从 `client.problemSet()` 的返回值取 `detail?.exam`，而那个方法**从不返回
   * `exam`** —— 于是这里**无条件**抛「题集还没开始作答」，与用户是否开始过无关，
   * 两个写动作 100% 不可用。
   *
   * 修法：`pta.js` 的 `problemSet()` 现在带上 `exam` / `serverTime` /
   * `examStatus`（由新增的 `getExam()` 取），本函数只读这些字段。
   *
   * @param setId - 题集 id。
   * @param signal - 中止信号。
   * @returns `{ detail, exam, serverTime }`。
   */
  const examOf = async (setId, signal) => {
    const detail = await client.problemSet(setId, { signal });
    const exam = detail?.exam ?? null;
    if (!exam?.id) {
      throw invalid(
        `题集 ${setId} 还没有开始作答。拼题A 的答题实例要在网页上点「开始」，`
        + '本仓不替你开（那会让计时开始跑）。',
      );
    }
    if (exam.ended) throw invalid(`题集 ${setId} 已经结束作答了，不能再写答案`);
    // 服务端时间优先；没有时回落到本机时钟，但要如实说明口径。
    const serverTime = detail?.serverTime ?? null;
    return { detail, exam, serverTime, timeSource: serverTime ? 'server' : 'local' };
  };

  return {
    saveAnswer: pair('pta.saveAnswer', async (args) => {
      const setId = String(args.homework ?? args.setId ?? '').trim();
      const problemId = String(args.problem ?? args.problemId ?? '').trim();
      if (!setId) throw invalid('需要 homework（题集 id）');
      if (!problemId) throw invalid('需要 problem（小题 id，来自 problems）');

      const answer = normalizeAnswer(args.answer ?? args.content);
      const { exam, serverTime } = await examOf(setId);

      // 查这一题的真实类型与截止时间 —— 猜类型会让答案存进错误的通道。
      const problem = await client.problem(setId, problemId).catch(() => null);
      const row = problem?.problemSetProblem ?? problem;
      if (!row?.id) throw invalid(`题集 ${setId} 里没有小题 ${problemId}`);
      const type = String(row.type ?? '').trim();
      if (!type) throw new ClassroomError('SHAPE', '小题响应里没有 type，无法判断该走哪条提交通道。', { problemId });

      const deadline = deadlineAt(row.deadline);
      if (deadline > 0 && deadline <= nowAt(serverTime)) {
        throw invalid(`小题 ${row.label ?? problemId} 已超过截止时间`);
      }
      if (!DRAFTABLE.has(type)) {
        throw invalid(`题型 ${type} 不支持存草稿，请用 submit 直接提交`);
      }

      return {
        summarized: `保存答案：题集 ${setId} 小题 ${row.label ?? problemId}（${type}）`,
        run: (signal) => client.send(`/api/problem-sets/problems/${problemId}/exam-draft`, {
          method: 'POST',
          body: { answer: { detail: buildDetail(type, answer), saveAt: new Date().toISOString() } },
          signal,
        }),
      };
    }),

    submitAnswer: pair('pta.submitAnswer', async (args) => {
      const setId = String(args.homework ?? args.setId ?? '').trim();
      const wanted = Array.isArray(args.problems) ? args.problems : [args.problem ?? args.problemId].filter(Boolean);
      if (!setId) throw invalid('需要 homework（题集 id）');
      if (!wanted.length) throw invalid('需要 problem（小题 id）或 problems（多题）');

      const { exam, serverTime } = await examOf(setId);

      // 逐题查类型、判截止、组 detail。任何一题不合法都在**首个写请求之前**报出
      // —— 上游的原话是「先验证整份输入和远端小题归属」，本文件照做。
      //
      // ⚠️ 答案来源有三种，按优先级：
      //   1. `answers[problemId]` —— 多题各自的答案（map）；
      //   2. `answer` —— 所有题共用同一份（单题时最常见）；
      //   3. 都没有 → 这一题确实缺答案，报错。
      //
      // 先前这里写成 `args.answers?.[id] ?? args.answer` 之后**直接** normalize，
      // 于是「只有 problems 没给 answer」会先报「需要 answer」——
      // 那个错把「缺答案」与「截止已过」混成一条，用户看不出真正原因。
      const prepared = [];
      for (const id of wanted) {
        const problemId = String(id);
        const problem = await client.problem(setId, problemId).catch(() => null);
        const row = problem?.problemSetProblem ?? problem;
        if (!row?.id) throw invalid(`题集 ${setId} 里没有小题 ${problemId}`);
        const type = String(row.type ?? '').trim();
        if (!type) throw new ClassroomError('SHAPE', '小题响应里没有 type。', { problemId });

        // 先判截止 —— 它比「缺答案」更能解释「为什么不能交」。
        const deadline = deadlineAt(row.deadline);
        if (deadline > 0 && deadline <= nowAt(serverTime)) {
          throw invalid(`小题 ${row.label ?? problemId} 已超过截止时间`);
        }

        const given = args.answers?.[problemId] ?? args.answer;
        if (given === undefined) {
          throw invalid(`小题 ${row.label ?? problemId} 没有给答案（用 answers["${problemId}"] 或 answer）`);
        }
        const answer = normalizeAnswer(given);
        prepared.push({ problemId, type, detail: buildDetail(type, answer, problemId), label: row.label ?? problemId });
      }

      const batches = groupBatches(prepared, 'submit');
      return {
        summarized: `提交答案：题集 ${setId} 的 ${prepared.length} 道题`
          + `（${prepared.map((item) => item.label).join('、')}；分 ${batches.length} 批）`,
        run: async (signal) => {
          const receipts = [];
          for (const batch of batches) {
            signal?.throwIfAborted();
            if (batch.draft) {
              // 草稿走单题接口。
              receipts.push(await client.send(`/api/problem-sets/problems/${batch.problemId}/exam-draft`, {
                method: 'POST',
                body: { answer: { detail: batch.details[0], saveAt: new Date().toISOString() } },
                signal,
              }));
              continue;
            }

            // 聚类题型整组提交会**替换**上次记录，所以要把上次未改的答案合并进来。
            // 不合并等于静默删掉用户之前写的答案。
            let details = batch.details;
            if (CLUSTERED.has(batch.type)) {
              const last = await lastSubmission(client, exam.id, batch.type).catch(() => null);
              const merged = new Map();
              for (const detail of last?.submissionDetails ?? []) merged.set(detail.problemSetProblemId, detail);
              for (const detail of batch.details) merged.set(detail.problemSetProblemId, detail);
              details = [...merged.values()].sort((a, b) => String(a.problemSetProblemId).localeCompare(String(b.problemSetProblemId)));
            }

            receipts.push(await client.send(`/api/exams/${exam.id}/exam-submissions`, {
              method: 'POST',
              body: { problemType: batch.type, details },
              signal,
            }));
          }
          return { ok: true, setId, batches: batches.length, receipts };
        },
      };
    }),
  };
}

/**
 * 把调用方给的答案转成平台认的形状。
 *
 * 支持三种输入：
 * - **字符串**：当作纯文本答案（主观题、填空题）；
 * - **数组**：当作多选/多空答案；
 * - **对象**：原样透传（高级用法，调用方自己拼 detail）。
 *
 * @param value - 调用方给的答案。
 * @returns 归一后的答案。
 */
function normalizeAnswer(value) {
  if (value === undefined || value === null) {
    throw invalid('需要 answer（答案内容）');
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) throw invalid('答案不能是空串');
    return { text };
  }
  if (Array.isArray(value)) {
    const list = value.map((item) => String(item).trim()).filter(Boolean);
    if (!list.length) throw invalid('答案数组不能全空');
    return { choices: list };
  }
  if (typeof value === 'object') return value;
  throw invalid('答案格式不支持（要字符串、数组或对象）');
}

/**
 * 按题型拼 `detail`。
 *
 * 字段名照上游 `buildDetail`。**这里不做语义猜测** —— 题型不认识时把答案
 * 放一个通用字段，让平台自己判；这比按错的形状编一个更安全（平台会拒，
 * 而编错的形状可能被当成合法答案存进去）。
 *
 * @param type - 题型。
 * @param answer - `normalizeAnswer` 的结果。
 * @param problemId - 小题 id（聚类题型要用）。
 * @returns `detail` 对象。
 */
function buildDetail(type, answer, problemId) {
  const base = problemId ? { problemSetProblemId: problemId } : {};
  if (CLUSTERED.has(type)) {
    const choices = answer.choices ?? (answer.text ? [answer.text] : []);
    return { ...base, multipleChoiceSubmissionDetail: { answers: choices } };
  }
  if (type === 'PROGRAMMING' || type === 'CODE_COMPLETION' || type === 'SQL_PROGRAMMING') {
    return { ...base, programmingSubmissionDetail: { code: answer.text ?? '', language: answer.language ?? '' } };
  }
  if (type === 'SUBJECTIVE') {
    return { ...base, subjectiveSubmissionDetail: { content: answer.text ?? '' } };
  }
  // 不认识的题型：把答案原样放进去，让平台判。
  return { ...base, ...answer };
}

/**
 * 查某题型最近一次提交。
 *
 * 合并上次答案要用它。查不到时返回 `null` —— 那意味着「这是第一次提交」，
 * 不是错误。
 *
 * @param client - `PtaApi`。
 * @param examId - 答题实例 id。
 * @param type - 题型。
 * @returns 最近的提交记录或 `null`。
 */
async function lastSubmission(client, examId, type) {
  const data = await client.get(`/api/exams/${examId}/exam-submissions`, {
    query: { problemType: type, limit: '1' },
  });
  const list = data?.submissions ?? data?.content ?? [];
  return Array.isArray(list) && list.length ? list[0] : null;
}
