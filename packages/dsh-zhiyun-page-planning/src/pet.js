/**
 * pet 的对话协议：一句话进来，**回一句话 + 一个可选动作**。
 *
 * # 为什么不是"纯聊天"
 *
 * 用户要的是"能跟 AI 对话来规划"。纯聊天模型只会回文本，落不了库 ——
 * 用户说完"下周三交作业"，pet 回"好的记下了"，但**什么也没记**，那是骗人。
 *
 * 所以每次回包都必须明确：**这一步是继续聊，还是可以动手了**。
 *
 * # 三个动作
 *
 * | action | 含义 | 谁执行 |
 * | --- | --- | --- |
 * | `ask` | 还缺关键信息，继续问 | 无（只回文本） |
 * | `create` | 信息够了，这是一条待办 | 用户在气泡里点「好」后落库 |
 * | `chat` | 用户在闲聊/问问题，不涉及新建 | 无 |
 *
 * **关键约束**：`create` **永远不直接写库**。它只是"我理解成这样，对吗"。
 * 用户点确认才走 `local-create` —— 与「AI 拆分」同一条信任底线，
 * 否则"AI 记错了日期"这件事没有任何拦截点。
 *
 * # 为什么不复用「AI 拆分」的提示词
 *
 * 那个是**单轮**（一句话 → 一条草案），这个是**多轮**（要记住刚才说了什么、
 * 要能追问）。混在一起会让单轮那条的"必须立刻给出完整草案"约束变成负担：
 * 用户只说"下周要交个东西"，单轮模式会硬凑一条，而 pet 应该问"什么东西？哪天？"
 */

/** 用户一句话的长度上限。对话比单条输入宽松些，但仍要挡住贴整篇文章。 */
export const MAX_MESSAGE = 1000;

/** 对话历史最多带几轮。太多会让 token 成本失控，也让模型抓不住重点。 */
export const MAX_HISTORY = 8;

/**
 * 模型回包里允许的字段。
 *
 * `say` 是必须的（总要回一句人话），`action` 决定下一步，`draft` 只在
 * `action === 'create'` 时有意义。
 */
export const REPLY_FIELDS = Object.freeze(['say', 'action', 'draft']);

/** 三个合法动作。 */
export const ACTIONS = Object.freeze(['ask', 'create', 'chat']);

/**
 * 生成 pet 的系统提示词。
 *
 * # 为什么要喂"此刻的待办清单"
 *
 * 用户会说"我今天有什么事""那条周三的还在吗"。不给它真实数据，它只能编。
 * 但**只给摘要**（标题 + 日期），不把整份 `detail` 塞进去 ——
 * 那会让提示词膨胀到几千 token，而对回答没有帮助。
 *
 * @param options.today - 今天的 `YYYY-MM-DD`。
 * @param options.weekday - 今天周几。
 * @param options.calendar - 逐日对照表（同 `time.js` 的 `dateTable`）。
 * @param options.pending - 当前未完成的事 `[{ title, due }]`。
 * @returns 系统提示词。
 */
export function createPetPrompt({ today, weekday, calendar, pending = [] }) {
  const lines = [
    '你是一个学生的待办助手，名字叫「小助」。你在帮他把想做的事记下来、理清楚。',
    '',
    `今天是 ${today}（${weekday}），时区 Asia/Shanghai。`,
    '',
    '未来两周的日期对照表（用它换算"明天""下周三"这类说法）：',
    ...calendar.map((row) => `  ${row.label} → ${row.date}（${row.weekday}）`),
    '',
    '## 你现在能看到的事（还没做完的）',
    ...(pending.length === 0
      ? ['  （目前没有未完成的事）']
      : pending.slice(0, 20).map((item) => `  - ${item.title}${item.due ? `（${item.due.slice(0, 10)}）` : '（没定日期）'}`)),
    '',
    '## 你要做什么',
    '',
    '用户会跟你说话。你回一句人话，并判断下一步该做什么。三种动作：',
    '',
    '- `ask`：还缺关键信息（比如没说哪天），继续问。**一次只问一件事**，别连环问。',
    '- `create`：信息够了，可以记成一条待办。这时必须给出 draft。',
    '- `chat`：用户在闲聊、问你现在有什么、或者在讨论怎么做，不涉及新建。',
    '',
    '## 什么时候可以 create',
    '',
    '用户明确说了一件具体要做的事，且**你知道它是什么**。日期可以没有（due 填 null），',
    '但事情本身必须清楚。用户说"下周有个作业"—— 这是 `ask`，因为不知道是什么作业。',
    '',
    '用户说"下周三交第三章作业" —— 这是 `create`。',
    '',
    '## draft 的形状',
    '',
    '{"title":"...","detail":"","due":null,"repeat":null}',
    '',
    '- title：不超过 40 字，动词开头更好。',
    '- detail：补充说明，没有就填空字符串。',
    '- due：格式 YYYY-MM-DDTHH:mm:ss+08:00。',
    '- repeat：{"every":1,"unit":"week","anchor":"due"}，只有明确说了"每周/每天/每月"才填。',
    '  unit 只能是 day / week / month；anchor 是 "due"（按截止日）或 "done"（按完成日）。',
    '',
    '## 时间规则（最重要）',
    '',
    '1. 用户说了确定的时间（"下周三""11 月 5 日""明天下午三点"）→ **必须换算成具体日期**。',
    '2. 只给日期没给时间 → 填当天 23:59:59。',
    '3. 用户完全没提时间 → due 填 null，**不要追问日期**（很多人就是不想定时间）。',
    '4. **绝对禁止**根据"学期进度""一般这时候交"推测日期。算不出来就留 null。',
    '',
    '## 说话方式',
    '',
    '- 像朋友，简短。一两句话，不要长篇大论。',
    '- 不要用"好的，我明白了"这种客套开场，直接说有用的。',
    '- 如果是 create，说一句确认的话，比如"记下了：周三前交第三章作业"。',
    '- 用户问"我今天有什么事"，就从上面那份清单里照着答，**不要编**。',
    '',
    '## 输出格式（严格照做，因为界面会边收边显示）',
    '',
    '**先**直接说你要说的话（一两句，就是用户会看到的气泡内容），',
    '**然后**另起一行，输出一个三反引号标记，里面是这段 JSON：',
    '',
    '```json',
    '{"action":"create","draft":{"title":"...","detail":"","due":null,"repeat":null}}',
    '```',
    '',
    '规则：',
    '- 你**先说人话**，再说 JSON。说的那段会逐字显示给用户，所以别在它里面夹 JSON。',
    '- 说的那段不要以"好的""明白了"开场，直接说有用的。',
    '- `action` 是 ask 或 chat 时，`draft` 填 null。',
    '- 必须恰好有一个三反引号代码块，且 `action` 必须在里面。',
    '- 不要在 JSON 之外输出别的三反引号块。',
  ];
  return lines.join('\n');
}

/**
 * 校验模型回包。
 *
 * # 降级策略
 *
 * 这里**宁可降级成 chat 也不报错**：
 * 对话中途抛错会让整段聊天卡死，而用户只是想要个回复。
 *
 * 但有一条**不降级**：`action === 'create'` 但 draft 不合法时，
 * 退成 `ask` —— 因为"要创建但创建不了"必须说出来，不能假装成功。
 *
 * @param raw - 模型给的对象。
 * @returns `{ say, action, draft, notes }`。
 */
export function normalizeReply(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw Object.assign(new Error('模型输出不是对象'), { code: 'BAD_SHAPE' });
  }

  const notes = [];
  const say = typeof raw.say === 'string' ? raw.say.trim().slice(0, 400) : '';
  if (!say) throw Object.assign(new Error('模型没有回话'), { code: 'BAD_SHAPE' });

  let action = ACTIONS.includes(raw.action) ? raw.action : null;
  if (!action) {
    // 动作不认识：按"只是聊了两句"处理，比报错温和
    notes.push('模型给的动作不认识，按普通对话处理');
    action = 'chat';
  }

  let draft = null;
  if (action === 'create') {
    const candidate = raw.draft;
    const title = typeof candidate?.title === 'string' ? candidate.title.trim().slice(0, 80) : '';
    if (!title) {
      // 说要创建却给不出标题 —— 必须退成 ask 并说明，不能假装成功
      notes.push('模型想记一条，但没说清是什么事');
      return { say: '这条我还没听明白是什么事，你再说一下？', action: 'ask', draft: null, notes };
    }

    let detail = typeof candidate.detail === 'string' ? candidate.detail.trim().slice(0, 500) : '';

    let due = null;
    if (candidate.due !== null && candidate.due !== undefined && candidate.due !== '') {
      if (typeof candidate.due === 'string' && !Number.isNaN(Date.parse(candidate.due))) {
        due = new Date(Date.parse(candidate.due)).toISOString();
      } else {
        notes.push('时间没看懂，已留空');
      }
    }

    let repeat = null;
    if (candidate.repeat !== null && candidate.repeat !== undefined) {
      const unit = candidate.repeat?.unit;
      const every = candidate.repeat?.every === undefined ? 1 : Number(candidate.repeat.every);
      const anchor = candidate.repeat?.anchor === undefined ? 'due' : candidate.repeat.anchor;
      const ok = ['day', 'week', 'month'].includes(unit)
        && Number.isInteger(every) && every >= 1 && every <= 12
        && ['due', 'done'].includes(anchor);
      if (ok) {
        repeat = { every, unit, anchor };
        // 按截止日重复但没有 due → 永远算不出下一次，必须退化
        if (anchor === 'due' && !due) {
          repeat = null;
          notes.push('要重复但没有开始时间，已改成不重复');
        }
      } else {
        notes.push('重复规则没看懂，已忽略');
      }
    }

    draft = { title, detail, due, repeat };
  } else if (raw.draft) {
    // ask / chat 带了 draft：忽略。不是错误，只是多余的字段
    notes.push('这次不需要创建，模型给的草案已忽略');
  }

  return { say, action, draft, notes };
}

/**
 * 从模型文本里取回复（**非流式**路径）。
 *
 * # 为什么不再直接扔给 `parsePlanJson`
 *
 * 提示词改成了「先说人话，再给一段围栏 JSON」——这是为了让流式能逐字显示
 * 人话。但非流式路径如果还按"整段就是一个 JSON"去解析，就会拿到一段
 * 带前言和围栏的文本，`JSON.parse` 失败 → `BAD_SHAPE: 模型没有回话`。
 *
 * 所以两条路共用**同一个** `createStreamParser`：它既认得"人话 + 围栏"的
 * 新格式，也认得"整段就是 JSON"的旧格式（没有围栏时整段当 JSON 试一次）。
 * 一个解析器、两种输入，规则不会分叉。
 *
 * @param raw - 模型原始文本。
 * @returns `{ say, action, draft, notes }`。
 */
export function readPetResponse(raw) {
  const parser = createStreamParser();
  parser.push(String(raw ?? ''));
  const { say, payload } = parser.finish();

  /**
   * 没有围栏时，退一步把整段当**纯 JSON** 再试一次。
   *
   * 这一支是为旧格式（`{"say":"…","action":"…"}`）留的：模型有时不理会
   * "先说话再给围栏"的约定，直接吐一个 JSON。此时 `say` 在 JSON 里面，
   * 不能拿整段当人话 —— 那会把 `{"say":"好的"` 原样显示给用户。
   */
  let body = payload;
  let plainSay = say;
  if (body) {
    // 围栏里的 JSON 自己带 `say` 时（旧格式 / 模型把话写进 JSON），以它为准；
    // 围栏前没有正文（`say` 为空）时更是只能用它，否则会把整段原文当人话显示。
    if (typeof body.say === 'string' && body.say.trim()) plainSay = body.say.trim();
  } else {
    try {
      const text = String(raw ?? '').trim();
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(text.slice(start, end + 1));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed;
          // 纯 JSON 形态下，人话在 `parsed.say` 里；围栏前的 `say` 是空的
          if (typeof parsed.say === 'string' && parsed.say.trim()) plainSay = parsed.say.trim();
        }
      }
    } catch { /* 真的不是 JSON，就按纯聊天处理 */ }
  }

  const finalSay = plainSay || String(raw ?? '').trim();
  return normalizeReply({
    // `normalizeReply` 要求 say 非空（空回话是 BAD_SHAPE），这里给最后兜底
    say: finalSay || '（模型没有回话）',
    action: body?.action,
    draft: body?.draft ?? null,
  });
}

/**
 * 流式解析：把"边收边显示"这件事做成一个可 push 的状态机。
 *
 * # 为什么不能简单地把收到的字全显示出来
 *
 * 模型的输出是「先说人话，再给一段 JSON」。如果照单全收，用户会看到
 * `{"action":"create",...}` 这种原始片段 —— 比"…"更糟。
 *
 * 所以要判断**当前这段是不是 say**。判据是那个三反引号围栏：围栏之前的
 * 全部是 say，围栏之后的是 JSON。但流式下围栏可能是**分几块到达**的
 * （先 ` `` `，再 `` `json ``），所以不能一看到反引号就切。
 *
 * 这里用「**保留可能有歧义的尾部**」的办法：只有当已收内容里出现**完整的**
 * 围栏标记时才算进入 JSON 段；否则把最后几个字符扣住不发，等下一块来再判。
 * 扣住的长度就是围栏标记本身的长度（3 个反引号），保证不会漏判。
 *
 * @param limit - 单条消息的最大保留长度（防止模型失控刷屏）。
 * @returns 一个 `{ push(chunk) -> string, finish(raw) -> {say, payload} }` 的解析器。
 */
export function createStreamParser({ fence = '```' } = {}) {
  let raw = '';          // 累积的全文
  let emitted = 0;       // 已经交给界面的 say 长度
  let inJson = false;    // 是否已进入围栏之后的 JSON 段

  return {
    /**
     * 推进一块。返回**本次应当追加显示的文本**（可能为空串）。
     *
     * @param chunk - 模型吐出的增量。
     * @returns 要显示的增量。
     */
    push(chunk) {
      raw += chunk;
      if (inJson) return '';

      const at = raw.indexOf(fence);
      if (at >= 0) {
        // 围栏出现：它之前的内容全是 say
        inJson = true;
        const say = raw.slice(0, at);
        const add = say.slice(emitted);
        emitted = say.length;
        return add;
      }

      // 还没见到完整围栏。但**尾部可能有半个围栏**（"``"）——
      // 那段先不发，否则会把围栏的一部分当成人话显示出去。
      const safe = Math.max(0, raw.length - (fence.length - 1));
      if (safe <= emitted) return '';
      const add = raw.slice(emitted, safe);
      emitted = safe;
      return add;
    },

    /**
     * 收尾：算出最终要显示的 say，以及围栏里的 JSON。
     *
     * @returns `{ say, payload }`；`payload` 为 null 表示模型没给 JSON。
     */
    finish() {
      const at = raw.indexOf(fence);
      // 没有围栏时，整段都是 say（模型没照格式来，但话还是能看）
      const say = (at >= 0 ? raw.slice(0, at) : raw).trim();
      let payload = null;
      if (at >= 0) {
        // 取第一个代码块的内容：可能带 "json" 语言标记
        const body = raw.slice(at + fence.length);
        const close = body.indexOf(fence);
        const inner = (close >= 0 ? body.slice(0, close) : body).trim();
        const stripped = inner.replace(/^json\s*/i, '').trim();
        if (stripped) {
          try { payload = JSON.parse(stripped); } catch { payload = null; }
        }
      }
      return { say, payload };
    },

    /** 已收到多少字符（调试/测试用）。 */
    get length() { return raw.length; },
  };
}

/**
 * 把对话历史裁到上限。
 *
 * 保留**最近的**，因为追问语境都在最近几轮。同时保证第一条始终是
 * `user` 角色 —— 有些模型对"首条是 assistant"会困惑。
 *
 * @param history - `[{ role, text }]`。
 * @returns 裁剪后的数组。
 */
export function trimHistory(history, limit = MAX_HISTORY) {
  if (!Array.isArray(history)) return [];
  const clean = history
    .filter((item) => item && typeof item.text === 'string' && item.text.trim())
    .map((item) => ({
      role: item.role === 'user' ? 'user' : 'assistant',
      text: String(item.text).slice(0, MAX_MESSAGE),
    }));
  if (clean.length <= limit) return clean;
  const tail = clean.slice(-limit);
  // 首条必须是 user：如果是 assistant（说明上一句是我们说的），丢掉它
  while (tail.length > 0 && tail[0].role !== 'user') tail.shift();
  return tail;
}
