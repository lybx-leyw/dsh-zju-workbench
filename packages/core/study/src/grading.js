/**
 * 作答判分：客观题由系统判定，主观题由模型给一句评价。
 *
 * # 分工
 *
 * | 题型          | 判分方式                                        | grading 值 |
 * |---------------|-------------------------------------------------|------------|
 * | 选择题 mcq    | 精确匹配选项字母                                 | exact      |
 * | 判断题 trueFalse | 精确匹配「正确 / 错误」                        | exact      |
 * | 填空题 cloze  | 先精确匹配；不中再让模型判同义/近似              | llm        |
 * | 简答题 shortAnswer | 模型判掌握程度 + 一句评价                    | llm        |
 *
 * # 为什么填空题也要过模型
 *
 * 填空题的标准答案是讲义原文里的词，但学生写同义词、少个「的」、单位写法不同
 * 都会判错。纯字符串比较把「会的人」判成「不会」，这比漏判更伤。
 * 所以：**精确匹配先给确定性结论，不中才请模型裁决** —— 前者是快路径，
 * 后者只是补充，不会让每次答题都等一次模型调用。
 *
 * # 判分必须与「展示」解耦
 *
 * 评价文案（`comment`）和解析（`explanation`）是两回事：
 *   - 解析来自题库，**始终展示**，不因答对答错而隐藏
 *   - 评价是这次作答的即时反馈，模型失败时降级成一句中性文案，绝不让作答记录写不进去
 *
 * # 失败策略
 *
 * 模型不可用 / 超时 / 返回格式不对 → **不抛错**，退化成
 * `{verdict: 'partial', grading: 'self', comment: 中性文案}`。
 * 理由：答题侧不能因为模型抖动就写不进记录 —— 那会让用户白做一遍。
 */

const SUBJECTIVE = new Set(['shortAnswer']);
const FUZZY = new Set(['cloze']);

/** 归一化：去空白、统一大小写与常见全半角标点，供精确匹配使用。 */
export function normalizeAnswer(text) {
  return String(text ?? '')
    .replace(/\s+/g, '')
    .replace(/[，,]/g, ',')
    .replace(/[。.]/g, '.')
    .replace(/[；;|]/g, ';')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .trim()
    .toLowerCase();
}

/**
 * 填空题的标准答案：优先用挖空标记里的文本，其次才是 question.answer。
 *
 * 挖空标记 `{{c1::答案}}` 是题面里真正被挖掉的内容，它比 answer 字段更接近
 * 「学生要填的字」。多空时按出现顺序用分号连接，与作答约定一致。
 */
export function blankAnswersOf(question) {
  const blanks = [...String(question?.stem ?? '').matchAll(/\{\{c(\d+)::([^}:]+)(?:::[^}]+)?\}\}/g)]
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(m => m[2].trim());
  return blanks.length ? blanks : null;
}

/** 该题型是否需要模型参与判分。 */
export function needsModel(question) {
  return SUBJECTIVE.has(question?.type) || FUZZY.has(question?.type);
}

/** 该题型是否允许纯精确匹配给出确定性结论。 */
export function isObjective(question) {
  return question?.type === 'mcq' || question?.type === 'trueFalse';
}

/**
 * 精确匹配：命中即确定正确。
 *
 * @returns {{matched: boolean, answer: string}}
 */
export function matchExact(question, response) {
  const blanks = blankAnswersOf(question);
  const actual = question?.type === 'mcq'
    ? question.answer
    : blanks
      ? blanks.join(';')
      : question?.answer;
  const candidate = String(response ?? '').replace(/[；|]/g, ';');
  const accepted = [actual, ...(question?.acceptedAnswers ?? [])].filter(v => typeof v === 'string');
  const matched = accepted.some(answer => normalizeAnswer(candidate) === normalizeAnswer(answer));
  return { matched, answer: String(actual ?? '') };
}

/**
 * 给模型看的题面与作答。
 *
 * 挖空标记在提示词里保留成 ____，不要把 `{{c1::}}` 原样丢给模型 ——
 * 那会让它把标记当内容复述。答案另外用一行给出，避免模型从题面反推。
 */
function promptOf(question, response, expected) {
  const stem = String(question?.stem ?? '').replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, '____');
  const lines = [
    `题型：${question?.type === 'shortAnswer' ? '简答题' : '填空题'}`,
    `题目：${stem}`,
    `标准答案：${expected}`,
    `学生作答：${String(response ?? '').trim() || '（空）'}`,
  ];
  if (question?.explanation) lines.push(`题目解析：${question.explanation}`);
  return lines.join('\n');
}

const SYSTEM_PROMPT = [
  '你是批改作业的老师。判断学生作答是否达到了标准答案的要求。',
  '只输出一行 JSON，不要任何解释、不要代码块围栏：',
  '{"verdict":"correct|partial|incorrect","comment":"一句话评价"}',
  '',
  '判定标准：',
  '- correct：意思正确。同义词、少序号、单位写法不同、多写解释都算正确。',
  '- partial：方向对但缺关键部分，或只答对一部分。',
  '- incorrect：意思错了，或答非所问。',
  '',
  'comment 要求：',
  '- 不超过 30 个汉字，直接对这次作答说一句话。',
  '- 不要复述题目，不要写「学生回答」这类前缀。',
  '- correct 要指出对在哪；partial/incorrect 要指出缺什么。',
].join('\n');

/** 从中取出第一个 JSON 对象 —— 模型偶尔会加前后缀。 */
function parseVerdict(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  // 去掉可能的代码围栏
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(unfenced.slice(start, end + 1));
    const verdict = ['correct', 'partial', 'incorrect'].includes(obj?.verdict) ? obj.verdict : null;
    if (!verdict) return null;
    const comment = String(obj?.comment ?? '').trim().slice(0, 120);
    return { verdict, comment };
  } catch {
    return null;
  }
}

/** 从流式 chunk 里拼出文本（宿主 chunk 形状：text-delta / finish / usage）。 */
async function collectText(stream) {
  let text = '';
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
    // finish 失败块由调用方（适配层）转成异常，这里不用重复判
  }
  return text;
}

/**
 * 请模型判定一次主观/模糊作答。
 *
 * @returns {Promise<{verdict:string, comment:string}|null>} 无法判定时返回 null，由调用方降级
 */
export async function judgeWithModel({ llm, question, response, expected, signal }) {
  if (!llm || typeof llm.prepareCall !== 'function') return null;
  try {
    const prepared = await llm.prepareCall({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: promptOf(question, response, expected) },
      ],
      temperature: 0,
      maxTokens: 160,
    }, signal);
    const text = await collectText(prepared.stream({
      ...(prepared.config ?? {}),
      messages: [
        { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'text', text: promptOf(question, response, expected) }] },
      ],
      signal,
    }));
    return parseVerdict(text);
  } catch {
    // 模型抖动不该让作答失败 —— 交给调用方写一条中性评价
    return null;
  }
}

/**
 * 评价文案的兜底（模型不可用时）。
 *
 * 刻意写成中性：不知道对错的场合，不该假装知道。
 */
export function fallbackComment(question, matched) {
  if (matched) return '答案与标准答案一致。';
  if (question?.type === 'shortAnswer') return '已记录你的解答，可对照下方解析自查。';
  return '与标准答案不一致，可对照下方解析再看一次。';
}

/**
 * 组织一次判分结果。
 *
 * 这是判分的唯一出口：调用方只管传「模型给什么」，判定与文案在这里统一成型。
 *
 * @param {object} params
 * @param {object} params.question
 * @param {string} params.response
 * @param {{verdict:string, comment:string}|null} params.judged  模型结论（可为 null）
 * @param {boolean} params.matched  精确匹配是否命中
 */
export function buildAttempt({ question, response, judged, matched }) {
  const objective = isObjective(question);
  let verdict;
  let grading;
  let comment;

  if (objective) {
    // 客观题只认精确匹配；模型结论即使存在也不采纳，避免「同一个答案两次判分不同」
    verdict = matched ? 'correct' : 'incorrect';
    grading = 'exact';
    comment = matched ? '答案正确。' : '答案不正确。';
  } else if (matched) {
    // 填空题精确命中：不必等模型，直接给确定结论
    verdict = 'correct';
    grading = 'exact';
    comment = '答案与标准答案一致。';
  } else if (judged) {
    verdict = judged.verdict;
    grading = 'llm';
    comment = judged.comment || fallbackComment(question, false);
  } else {
    // 模型不可用：如实说明，不假装判对错
    verdict = 'partial';
    grading = 'self';
    comment = fallbackComment(question, false);
  }

  return { verdict, grading, comment };
}

/**
 * 把宿主的 worker pool 包成判分用的 llm。
 *
 * # 为什么要这一层
 *
 * 判分调用和出题调用面对的是同一个宿主契约：`prepareCall(config)` 收对象、
 * 消息 content 必须是块数组、provider 必须是注册表里的名字。
 * 这些已经在 `core-question-backend.js` 的 `toHostMessages` 里解决过一次，
 * 但那是出题包的内部实现，判分侧不该 import 它（跨包依赖会绕）。
 *
 * 所以这里只做判分真正需要的最小转换：一次不带工具的纯文本调用。
 * 没有工具 → 不涉及 tool 消息形状 → 转换面小得多。
 *
 * @param {object} pool  WorkerPoolLlm 实例
 * @param {{provider:string, model:string}} route
 */
export function createJudgeLlm(pool, route) {
  if (!pool || typeof pool.base?.llm?.prepareCall !== 'function' || !route?.provider) return null;
  return {
    async prepareCall(config, signal) {
      // 宿主顶层 prepareCall 收对象；provider/model 必须用注册表里的名字。
      const prepared = await pool.base.llm.prepareCall(
        { provider: route.provider, model: route.model },
        signal,
      );
      return {
        config: prepared.config,
        stream: options => prepared.stream({
          ...(prepared.config ?? {}),
          ...options,
          // 宿主走 Anthropic Messages 方言：content 必须是块数组。
          // 判分只有 system / user 两种角色，且都是纯文本，转换就这一行。
          messages: (options.messages ?? []).map(message => ({
            role: message.role,
            content: typeof message.content === 'string'
              ? [{ type: 'text', text: message.content }]
              : message.content,
          })),
          signal: options.signal ?? signal,
        }),
      };
    },
  };
}
