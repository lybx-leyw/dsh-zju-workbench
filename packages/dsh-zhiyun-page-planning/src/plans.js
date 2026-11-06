/**
 * AI 自动规划：把中转站里**混杂的待办条目**拆成可执行的卡片。
 *
 * # 要解决什么
 *
 * 用户推上来的通常是"一段话里塞了七八件事"，各件**各有各的截止时间**，
 * 没有统一日期。这种条目直接列出来只能读、不能做。本模块用一次模型调用把它们
 * 拆成结构化卡片：每张卡片有标题、动作、截止时间、来源。
 *
 * # 为什么必须记住映射
 *
 * 拆分是**花钱且不确定**的操作。同一条内容连着点两次按钮，不该产生两套卡片，
 * 也不该因为模型这次措辞不同就重拆一遍。所以：
 *
 *   `entryPrefix(源条目)` → `{ cards: [...], plannedAt, model }`
 *
 * 键用**内容前缀**而不是 `seq`：中转站是 append-only 且可能被重建（seq 会变），
 * 而内容前缀跨重建稳定 —— 与本地留存的去重口径完全一致，两处不会打架。
 *
 * 于是「已拆过的条目」在页面上显式标出，并且**默认不再重拆**；用户想重拆得有
 * 明确动作（`?plan-force`），这是钱的问题，不能靠猜。
 *
 * # 边界
 *
 * - 只处理**中转站条目**，不碰学在浙大/拼题A 的待办：那些已经有结构化的截止时间
 *   与来源链接，再让模型拆一遍是拿准确数据换猜测。
 * - 模型输出**必须校验**：没通过校验就整条丢弃并如实报错，绝不把半个结果写进
 *   映射文件 —— 半份卡片比没有卡片更难发现。
 * - 不发明截止时间：模型只允许在"内容里明确提到"时才给 due，其余留空。
 */

import { entryPrefix } from './entries.js';

/** 单次送进模型的条目数上限。条目多时按"还没拆过的"优先取。 */
export const PLAN_BATCH_LIMIT = 8;

/** 单条正文送进模型的最大字符数。超过会被截断并如实告知模型。 */
export const PLAN_TEXT_LIMIT = 4000;

/** 一张拆分卡片的字段白名单。多一个字段都不收。 */
export const CARD_FIELDS = Object.freeze(['title', 'action', 'due', 'sourceTitle', 'tags']);

/** 卡片的标题/动作长度上限。 */
const MAX_TITLE = 80;
const MAX_ACTION = 400;

/**
 * 提示词。
 *
 * 写清楚四件事，因为模型在这四件事上默认都会乱来：
 *   1. **不要发明截止时间** —— 原文没写就留 null，不许"合理推测"；
 *   2. **一条原文可以出多张卡** —— 这正是本功能的意义；
 *   3. **输出必须是 JSON** —— 任何散文都让解析失败；
 *   4. **不要合并不同事项** —— 合并会让用户丢掉其中一件。
 */
export const PLAN_PROMPT = [
  '你在帮一个大学生把他自己写的待办笔记整理成可执行的卡片。',
  '',
  '输入是一批笔记条目（JSON 数组），每条有 kind/title/text/at。',
  '这些条目通常是「一段话里塞了好几件不同的待办」，而且**各件各有各的截止时间**，',
  '没有统一的截止日期。你的任务是按**事项**拆分，不要按段落拆。',
  '',
  '对每一条原文，输出若干张卡片。每张卡片：',
  '- title：这件事是什么，不超过 40 字，动词开头更好（"交第三章作业"而不是"第三章作业"）。',
  '- action：用户要做的具体动作，1–2 句。原文信息不足时写"确认具体要求"，不要编造。',
  '- due：**只有原文明确写了时间**才填，格式 YYYY-MM-DDTHH:mm:ss+08:00；',
  '  原文没写就填 null。绝对不许根据上下文"推测"一个时间。',
  '  像"下周三""本月底"这类相对表达，按原文所在条目的 at 时间换算成绝对日期。',
  '- sourceTitle：这张卡片来自哪一条原文，抄它的 title 原文，用于人工核对。',
  '- tags：0–3 个短标签，如 ["作业"] ["论文"] ["考试"]。',
  '',
  '规则：',
  '1. 一件事一张卡。不同的课程、不同的作业、不同的截止时间都必须分开。',
  '2. 不要合并：把两件事合成一张卡，用户会漏掉其中一件。',
  '3. 原文里只有日期没有具体时间时，due 填当天 23:59:59（当作当天结束前）。',
  '4. 原文里完全没有时间信息时，due 填 null —— 这是正常情况，不要硬凑。',
  '5. 只输出 JSON，不要解释、不要 Markdown 代码块、不要前后缀。',
  '',
  '输出格式：',
  '{"cards":[{"title":"...","action":"...","due":null,"sourceTitle":"...","tags":[]}]}',
].join('\n');

/**
 * 一条原文送进模型时用的**标题**。
 *
 * ⚠️ 它同时是回包归属的键：模型照抄 `sourceTitle` 回来，宿主拿它去 `byTitle` 查。
 * 早先只有 `toPlanInput` 在这里截到 80 字符，而 `byTitle` 用**完整标题**做键 ——
 * 标题超过 80 字的条目，模型抄回截断后的标题，查不到，卡片全被算成"对不上原文"
 * 并静默丢弃。所以这个截断**必须只有一个落点**，两边都调它。
 *
 * @param entry - 本地留存的条目。
 * @returns 送模型用、也是回包比对用的标题。
 */
export function planTitle(entry) {
  return String(entry?.title ?? '').slice(0, MAX_TITLE);
}

/**
 * 把中转站条目整理成送模型的形状。
 *
 * 只送模型需要的字段；`text` 超长截断并**在标题里标注**，让模型知道内容不全
 * （不告诉它就会对截断处之后的内容瞎猜）。
 *
 * @param entries - 本地留存的条目数组。
 * @returns 精简后的数组。
 */
export function toPlanInput(entries) {
  return entries.map((entry) => {
    const text = typeof entry.text === 'string' ? entry.text : '';
    const clipped = text.length > PLAN_TEXT_LIMIT;
    return {
      kind: String(entry.kind ?? 'note'),
      // 与回包比对用同一个函数取标题，见 `planTitle` 上的注释
      title: planTitle(entry),
      text: clipped ? `${text.slice(0, PLAN_TEXT_LIMIT)}\n…（原文过长，已截断）` : text,
      at: Number.isFinite(entry.at) ? new Date(entry.at * 1000).toISOString() : null,
    };
  });
}

/**
 * 从模型回包里抠出 JSON。
 *
 * 模型经常包一层 ```json 围栏或加一句"这是结果："。这里**只做剥离，不做猜测**：
 * 剥完还解不出就报错，不去正则里凑一个"看起来像 JSON"的片段 —— 那样会把
 * 截断的回包解析成半份数据。
 *
 * @param raw - 模型的原始文本。
 * @returns 解析后的对象。
 * @throws 解析失败时抛带 `code: 'BAD_JSON'` 的错误。
 */
export function parsePlanJson(raw) {
  let text = String(raw ?? '').trim();
  if (!text) throw planError('EMPTY_RESPONSE', '模型返回了空内容');

  // 剥离 Markdown 代码围栏（```json / ```）
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  if (fenced) text = fenced[1].trim();

  // 剥完还不行时，退化到"取第一个 { 到最后一个 }"—— 只处理前后多一句寒暄的情况
  if (!text.startsWith('{')) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw planError('BAD_JSON', `模型输出不是合法 JSON：${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw planError('BAD_JSON', '模型输出不是对象');
  }
  return parsed;
}

/**
 * 校验并规整一张卡片。
 *
 * 严格到"多一个字段都不收"：模型偶尔会加 `priority` / `estimate` 这类字段，
 * 静默保留会让映射文件的形状随模型心情变化。
 *
 * @param raw - 模型给的卡片。
 * @returns 规整后的卡片，或 null（不可用）。
 */
export function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).some((key) => !CARD_FIELDS.includes(key))) return null;

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title || title.length > MAX_TITLE) return null;

  const action = typeof raw.action === 'string' ? raw.action.trim() : '';
  if (!action || action.length > MAX_ACTION) return null;

  // due：null 是**正常且常见**的值（原文没写时间）。给了就必须是可解析的时间。
  let due = null;
  if (raw.due !== null && raw.due !== undefined && raw.due !== '') {
    if (typeof raw.due !== 'string') return null;
    const at = Date.parse(raw.due);
    if (Number.isNaN(at)) return null;
    due = new Date(at).toISOString();
  }

  const sourceTitle = typeof raw.sourceTitle === 'string' ? raw.sourceTitle.trim().slice(0, MAX_TITLE) : '';

  let tags = [];
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) return null;
    tags = raw.tags
      .filter((tag) => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  return { title, action, due, sourceTitle, tags };
}

/**
 * 校验整份模型输出。
 *
 * @param raw - 模型文本。
 * @returns `{ cards }`。
 * @throws `BAD_JSON` / `BAD_SHAPE` / `NO_CARDS`。
 */
export function readPlanResponse(raw) {
  const parsed = parsePlanJson(raw);
  if (!Array.isArray(parsed.cards)) throw planError('BAD_SHAPE', '模型输出里没有 cards 数组');

  const cards = [];
  for (const item of parsed.cards) {
    const card = normalizeCard(item);
    if (card) cards.push(card);
    // 单张坏卡丢弃而不是整份失败：模型常有一两项格式不对，
    // 整份丢弃等于白花钱。但**要在返回值里报出丢了几张**。
  }
  const dropped = parsed.cards.length - cards.length;
  if (cards.length === 0) throw planError('NO_CARDS', '模型没有产出可用的卡片');
  return { cards, dropped };
}

/**
 * 规划结果与「源条目 → 卡片」映射的持久化。
 *
 * 存两类东西：
 *   - `plans`：`源条目前缀 → { cards, plannedAt, model }`，**永不因重跑而丢**；
 *   - `runs`：最近几次规划的元信息（时间、条数、丢了几张），供页面显示。
 *
 * 与本地留存同目录、同「先写临时文件再 rename」的落盘方式。
 */
export class PlanStore {
  /**
   * @param file - `plans.json` 路径。
   * @param readJson - 注入的读函数（便于测试）。
   * @param writeJson - 注入的写函数。
   */
  constructor(file, readJson, writeJson) {
    this.file = file;
    this.readJson = readJson;
    this.writeJson = writeJson;
    this.state = { plans: {}, runs: [] };
    this.load();
  }

  load() {
    const parsed = this.readJson(this.file);
    if (!parsed || typeof parsed !== 'object') return this.state;
    const plans = parsed.plans && typeof parsed.plans === 'object' ? parsed.plans : {};
    const runs = Array.isArray(parsed.runs) ? parsed.runs : [];
    this.state = { plans, runs };
    return this.state;
  }

  save() {
    this.writeJson(this.file, this.state);
  }

  /** 某条原文是否已经拆过。 */
  has(prefix) {
    return Boolean(this.state.plans[prefix]);
  }

  /** 取某条原文的卡片。 */
  get(prefix) {
    return this.state.plans[prefix] ?? null;
  }

  /**
   * 记录一次拆分结果。
   *
   * **覆盖同一前缀的旧结果**：内容没变而卡片措辞更新时，用户要看到最新那份，
   * 而不是攒一堆历史版本。
   *
   * ⚠️ 重拆会**重置完成状态**（新卡片是新的数组）。这是有意的：重拆后卡片本身
   * 可能已经不同，"第 2 张做完了"不再对应同一件事，继承旧勾选会标错。
   *
   * @param prefix - 源条目前缀。
   * @param cards - 卡片数组。
   * @param meta - `{ model }`。
   */
  record(prefix, cards, meta = {}) {
    this.state.plans[prefix] = {
      // **拷贝**而不是存引用：`setCardDone` 会就地替换 `cards[i]`，若这里留着调用方
      // 的数组，改一张卡就会连带改掉调用方手上的那份（测试里表现为"另一条用例的
      // 数据被上一条改坏了"，生产上则是同一批卡片被两处同时持有时行为不可预期）。
      cards: cards.map((card) => ({ ...card })),
      plannedAt: Math.floor(Date.now() / 1000),
      model: meta.model ?? null,
    };
    this.state.runs.unshift({
      at: Math.floor(Date.now() / 1000),
      cards: cards.length,
      model: meta.model ?? null,
    });
    // 只留最近 20 次：这是给人看的活动记录，不是审计日志
    this.state.runs = this.state.runs.slice(0, 20);
    this.save();
  }

  /**
   * 勾选 / 取消**某一张卡片**的完成。
   *
   * 卡片没有自己的 id（它们是模型产出的数组元素），所以用 `prefix + 下标` 定位。
   * 这个组合在同一份映射里稳定 —— 只要不重拆，下标就对应同一张卡。
   *
   * 完成状态存在 `plans.json` 里（`cards[i].done`），**不写回中转站**：
   * 那边是只读的，而且"我做完了"是本地的事实，不该变成别人的数据。
   *
   * @param prefix - 源条目前缀。
   * @param index - 卡片下标。
   * @param done - 是否完成。
   * @param now - 当前毫秒时间戳。
   * @returns 改后的卡片，或 null（前缀/下标不存在）。
   */
  setCardDone(prefix, index, done, now = Date.now()) {
    const entry = this.state.plans[prefix];
    if (!entry || !Array.isArray(entry.cards)) return null;
    const at = Number(index);
    if (!Number.isInteger(at) || at < 0 || at >= entry.cards.length) return null;
    const seconds = Math.floor(now / 1000);
    entry.cards[at] = {
      ...entry.cards[at],
      done: Boolean(done),
      // 与本地规划同一口径：取消完成要清掉 doneAt，否则"做完了吗"有两个答案
      doneAt: done ? seconds : null,
    };
    this.save();
    return entry.cards[at];
  }

  /** 全部映射，页面用来标"已拆过"。 */
  all() {
    return this.state.plans;
  }

  /**
   * 把映射的**键**从旧口径换成新口径（一次性迁移）。
   *
   * 去重键从「拼起来截 40 字」改成「内容指纹」之后，同一个文件里的键会对不上：
   * 不迁移的话，老条目全部算出新键、匹配不到旧记录 —— 结果是**每条都被重新拆一遍**
   * （真花钱），而且旧的卡片全变成"无人认领"。
   *
   * @param mapping - `旧键 → 新键`。映射里没有的键原样保留（比如已经迁移过的）。
   * @returns 实际改了几个键；0 表示没什么可做的。
   */
  rekey(mapping) {
    if (!mapping || typeof mapping !== 'object') return 0;
    const next = {};
    let changed = 0;
    for (const [key, value] of Object.entries(this.state.plans)) {
      const target = Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : key;
      // 两个旧键映射到同一个新键（旧口径下本来就被截断撞在一起的两条）时，
      // 保留**先到的**那份卡片，另一份如实丢掉 —— 反正它们在旧口径下本来就是
      // 同一条记录的重复，合并回一份是这次修复想要的结果。
      if (!Object.prototype.hasOwnProperty.call(next, target)) next[target] = value;
      if (target !== key) changed += 1;
    }
    if (changed === 0) return 0;
    this.state.plans = next;
    this.save();
    return changed;
  }

  /** 最近几次拆分。 */
  recentRuns() {
    return this.state.runs;
  }

  /** 清掉一条的映射（用户想重拆时用）。 */
  forget(prefix) {
    delete this.state.plans[prefix];
    this.save();
  }
}

/** 造一个带 code 的错误。 */
export function planError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * 挑出这次要拆的条目。
 *
 * 优先**没拆过的**；都拆过且没强制重拆时返回空数组 —— 调用方据此告诉用户
 * "没有新内容需要规划"，而不是又花一次钱。
 *
 * @param entries - 本地条目。
 * @param store - PlanStore。
 * @param options - `{ force }` 强制重拆全部。
 * @returns 要送模型的条目。
 */
export function pickPending(entries, store, { force = false } = {}) {
  const pending = force
    ? entries
    : entries.filter((entry) => !store.has(entryPrefix(entry)));
  // 新的优先：用户刚推上来的东西最可能想马上规划
  const sorted = [...pending].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return sorted.slice(0, PLAN_BATCH_LIMIT);
}
