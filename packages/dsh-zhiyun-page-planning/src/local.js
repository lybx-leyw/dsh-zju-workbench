/**
 * 「我的规划」——用户**在本机手写**的规划条目。
 *
 * # 为什么规划要能写
 *
 * 原来这一页只是中转站内容的查看器：读得到、读不到，两件事。但「规划」这个词的本意
 * 是**写下要做什么**。只读的话，页面上最该出现的东西（用户自己刚想到的三件事）反而
 * 无处安放，只能先在别处写、再推给中转站、再回来读 —— 中间每一步都可能断。
 *
 * # 为什么存在本机，而不是写回中转站
 *
 * 中转站是 **append-only**：只有 `POST /entries`，没有更新/删除接口，写满 5000 条
 * 再写还会被直接拒收（`deploy/relay-service/server.py`）。这意味着"把它改成周五"
 * 这种最基本的操作在那里**做不到** —— 只能追加一条新的，再在本地想办法对账。
 *
 * 而规划天然要改：日期会挪、事会取消、做完了要划掉。所以本地是一等来源：
 *   - 可增删改，不需要新凭证（中转站保持只读，不用再配一个写密钥）；
 *   - 与 `LocalStore`（中转站内容的本地留存）同目录、同「先写临时文件再 rename」；
 *   - 不因为中转站挂掉/被重建而丢。
 *
 * 想同步到中转站是**将来的事**，而且那时也该是"导出"而不是"唯一存储"。
 *
 * # 与中转站条目/待办的关系
 *
 * 「我的规划」是第五个来源，和前四个并列：学在浙大待办、拼题A 题集、中转站条目、
 * 本地留存。它和"本地留存"不是一回事 —— 后者是别人的内容的缓存，前者是**用户自己的**。
 */

/** 一条本地规划的形状。字段白名单，多一个都不收。 */
export const LOCAL_FIELDS = Object.freeze(['id', 'title', 'detail', 'due', 'done', 'createdAt', 'updatedAt', 'doneAt', 'repeat']);

/**
 * 服务端自己维护的字段（客户端传了也不收）。
 *
 * `splitFrom` / `splitInto` 记「AI 拆分」的来龙去脉：
 *   - 拆出来的每条带 `splitFrom: 源id`，页面据此说明它从哪来的；
 *   - 源条目带 `splitInto: [id...]`，页面据此显示"已拆 N 条"并阻止重复拆。
 *
 * 这两个字段落在**条目上**而不是另建一张表：拆分关系本来就属于规划本身，
 * 单独一份映射文件会在删条目时变成孤儿（`plans.json` 那边就吃过这个亏）。
 */
export const SERVER_FIELDS = Object.freeze(['splitFrom', 'splitInto']);

/** 标题长度上限。与卡片标题同档：它就是一个事项的名字。 */
const MAX_TITLE = 80;

/** 备注长度上限。手写规划通常一两句，不做成写长文的地方。 */
const MAX_DETAIL = 500;

/**
 * 支持的重复周期。**故意只有这四档**。
 *
 * # 为什么不做 cron / 自定义规则
 *
 * 学生场景里的重复任务几乎只有四种：每天（背单词）、每周（交作业）、每两周
 * （某些实验）、每月（交材料）。做成通用 cron 的后果是输入框变复杂、写错
 * 也不报错，而真正需要「每月第三个周五」的人一个都没有。
 *
 * 需要更细的口径时应当**单独讨论**，而不是在这里开一个自由输入框。
 */
export const REPEAT_UNITS = Object.freeze(['day', 'week', 'month']);

/** 周期的中文说法，给界面直接显示。 */
export const REPEAT_LABEL = Object.freeze({ day: '每天', week: '每周', month: '每月' });

/**
 * 下一次从哪天算起。
 *
 * # 这两个值差得很远，不能混
 *
 * - `due`：**按原截止日推进**。「每周日 23:59 交作业」，我这周拖到周一才做，
 *   下周的截止日**仍然是周日** —— 因为那是课程定的，不因我个人拖延而变。
 * - `done`：**按实际完成日推进**。「每 3 天复习一次」，我隔了 5 天才做，
 *   下一次从**我做完的那天**起算 —— 间隔才真的是 3 天。
 *
 * 两者的差别在「拖延」这件事上最明显：`due` 会让拖到最后的人永远压线，
 * `done` 会让拖延的人把周期越拖越长。学生两种都需要，所以让用户选。
 */
export const REPEAT_ANCHOR = Object.freeze(['due', 'done']);

/** 默认锚点：按截止日推进。对「每周交作业」这类最符合直觉。 */
const DEFAULT_ANCHOR = 'due';

/** 一条重复规则的长度上限，防止客户端塞进无意义的长串。 */
const MAX_REPEAT_INTERVAL = 12;

/** 新建时允许客户端传的字段（其余由服务端生成）。 */
export const LOCAL_INPUT_FIELDS = Object.freeze(['title', 'detail', 'due', 'repeat']);

/**
 * 校验重复规则。
 *
 * `null` 是**正常值**（不重复），不是"没填"。所以它和 `title` 不同：
 * 缺省就是 null，不报错。
 *
 * @param raw - `{ every, unit, anchor }` 或 null。
 * @returns 规整后的规则，或 null。
 */
export function normalizeRepeat(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw localError('INVALID_INPUT', '重复规则要是对象');
  }
  const unknown = Object.keys(raw).filter((key) => !['every', 'unit', 'anchor'].includes(key));
  if (unknown.length > 0) {
    throw localError('INVALID_INPUT', `重复规则里不认识的字段：${unknown.join('、')}`);
  }

  const every = raw.every === undefined ? 1 : Number(raw.every);
  if (!Number.isInteger(every) || every < 1 || every > MAX_REPEAT_INTERVAL) {
    throw localError('INVALID_INPUT', `重复间隔要 1–${MAX_REPEAT_INTERVAL} 之间的整数`);
  }
  if (!REPEAT_UNITS.includes(raw.unit)) {
    throw localError('INVALID_INPUT', `重复周期只能是 ${REPEAT_UNITS.join(' / ')}`);
  }
  const anchor = raw.anchor === undefined ? DEFAULT_ANCHOR : raw.anchor;
  if (!REPEAT_ANCHOR.includes(anchor)) {
    throw localError('INVALID_INPUT', `锚点只能是 ${REPEAT_ANCHOR.join(' / ')}`);
  }
  return { every, unit: raw.unit, anchor };
}

/**
 * 校验并规整一次**写入**（新建或修改）。
 *
 * 与模型输出一样按**不可信输入**处理：形状不对就报错，不做"猜他想填什么"。
 *
 * @param raw - 客户端传来的 `{ title, detail, due, repeat }`。
 * @returns 规整后的字段，或抛 `INVALID_INPUT`。
 */
export function normalizeLocalInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw localError('INVALID_INPUT', '请求体不是一个对象');
  }
  const unknown = Object.keys(raw).filter((key) => !LOCAL_INPUT_FIELDS.includes(key));
  if (unknown.length > 0) {
    // 白名单外的字段直接拒：静默保留会让文件形状随客户端版本变化
    throw localError('INVALID_INPUT', `不认识的字段：${unknown.join('、')}`);
  }

  const title = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!title) throw localError('INVALID_INPUT', '规划要有个名字');
  if (title.length > MAX_TITLE) throw localError('INVALID_INPUT', `标题最多 ${MAX_TITLE} 字`);

  let detail = '';
  if (raw.detail !== undefined && raw.detail !== null) {
    if (typeof raw.detail !== 'string') throw localError('INVALID_INPUT', '备注必须是文本');
    detail = raw.detail.trim();
    if (detail.length > MAX_DETAIL) throw localError('INVALID_INPUT', `备注最多 ${MAX_DETAIL} 字`);
  }

  // due：null/空 是正常值（"没说什么时候做"）。给了就必须可解析 —— 猜日期没有意义。
  let due = null;
  if (raw.due !== undefined && raw.due !== null && raw.due !== '') {
    if (typeof raw.due !== 'string') throw localError('INVALID_INPUT', '截止时间要是时间串');
    const at = Date.parse(raw.due);
    if (Number.isNaN(at)) throw localError('INVALID_INPUT', '截止时间看不懂');
    due = new Date(at).toISOString();
  }

  const repeat = normalizeRepeat(raw.repeat);

  return { title, detail, due, repeat };
}

/** 造一个带 code 的错误。 */
export function localError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * 生成一个 id。
 *
 * 不用自增序号：删除之后序号会重复，而 id 一旦重复，"勾完成"就会勾错一条。
 * 时间前缀让文件里天然按创建顺序排，调试时也看得出先后。
 *
 * @param now - 注入当前时间（测试用）。
 * @returns 形如 `p-1792320965-3f2a1b` 的 id。
 */
export function newId(now = Date.now()) {
  const stamp = Math.floor(now / 1000).toString(36);
  const noise = Math.floor(Math.random() * 0xffffff).toString(36).padStart(5, '0');
  return `p-${stamp}-${noise}`;
}

/**
 * 按规则推进一个时间点。
 *
 * # 三个容易写错的地方
 *
 * 1. **`Date` 的 `setMonth` 会自行溢出**：`1 月 31 日 + 1 个月` 得到 `3 月 3 日`
 *    （因为 2 月没有 31 号）。对「每月交材料」这不对 —— 用户期待的是 **2 月末**
 *    （2 月 28/29 日），而不是跳到 3 月。所以按月推进时要**夹住日号**。
 * 2. **必须用 UTC 运算再回来**：本地时区在 DST 切换日会少/多一小时，
 *    而我们是按「日历日」推进的，不该受它影响。
 * 3. **原时间是 `+08:00` 的**（平台口径），推进后要**保留同一个钟点**。
 *    用 UTC 运算 + 只改日/月/年，钟点自然不变。
 *
 * @param iso - 起点（ISO 串）。
 * @param repeat - `{ every, unit, anchor }`。
 * @returns 下一次的 ISO 串；起点无法解析时返回 null。
 */
export function advanceBy(iso, repeat) {
  const at = Date.parse(iso);
  if (Number.isNaN(at) || !repeat) return null;
  const { every, unit } = repeat;
  const start = new Date(at);

  if (unit === 'day') {
    // 天：时长固定 24h，用毫秒加最稳（DST 也不会错，因为我们只关心"日历上的下一天"）
    return new Date(at + every * 86400000).toISOString();
  }
  if (unit === 'week') {
    return new Date(at + every * 7 * 86400000).toISOString();
  }

  // month：按月推进，**日号夹到目标月的最后一天**
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const targetMonth = month + every;
  // 目标月的"同一天"可能不存在（1/31 → 2/31）。先算目标月末，再取较小者。
  const lastDayOfTarget = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  const next = new Date(Date.UTC(
    year, targetMonth, Math.min(day, lastDayOfTarget),
    start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds(),
  ));
  return next.toISOString();
}

/**
 * 勾完成之后该生成的下一次。
 *
 * # 锚点决定从哪算
 *
 * - `due`：从**原截止日**推进。拖到最后的人下一次仍然压线 —— 与课程安排一致。
 * - `done`：从**实际完成时刻**推进。间隔才真的是「每 N 天一次」。
 *
 * # 什么时候返回 null
 *
 * 不重复、或者锚点是 `due` 但这条压根没有截止时间 ——
 * 没有起点就没有下一次，**不能拿当前时间瞎推**（那会凭空造出一个日期）。
 *
 * @param item - 刚被勾完成的条目。
 * @param now - 完成时刻的毫秒时间戳。
 * @returns 下一次的 ISO 串，或 null。
 */
export function nextOccurrence(item, now = Date.now()) {
  if (!item?.repeat) return null;
  const { anchor } = item.repeat;
  const base = anchor === 'done' ? new Date(now).toISOString() : item.due;
  if (!base) return null;
  return advanceBy(base, item.repeat);
}

/**
 * 造一条新规划。
 *
 * @param raw - 客户端传来的输入。
 * @param now - 当前毫秒时间戳。
 * @returns 完整条目。
 */
export function createLocal(raw, now = Date.now()) {
  const { title, detail, due, repeat } = normalizeLocalInput(raw);
  const seconds = Math.floor(now / 1000);
  return {
    id: newId(now),
    title,
    detail,
    due,
    repeat,
    done: false,
    createdAt: seconds,
    updatedAt: seconds,
    doneAt: null,
    // 空数组而不是 undefined：页面对"有没有拆过"只判一个形状，少一种分支
    splitInto: [],
  };
}

/**
 * 造一条**由 AI 拆出来**的规划。
 *
 * 与 `createLocal` 的差别只在 `splitFrom`：它记住自己来自哪条原文。
 * 用同一个 id 生成器与同一套字段，是因为它在页面上的身份就是"一条规划"，
 * 不该因为来源不同而多一套形状。
 *
 * @param raw - `{ title, detail, due }`（已由 `normalizeCard` 校验过）。
 * @param sourceId - 源规划的 id。
 * @param now - 当前毫秒时间戳。
 * @returns 完整条目。
 */
export function createSplit(raw, sourceId, now = Date.now()) {
  const { title, detail, due, repeat } = normalizeLocalInput(raw);
  const seconds = Math.floor(now / 1000);
  return {
    id: newId(now),
    title,
    detail,
    due,
    repeat,
    done: false,
    createdAt: seconds,
    updatedAt: seconds,
    doneAt: null,
    splitFrom: sourceId,
    splitInto: [],
  };
}

/**
 * 改一条已有规划。
 *
 * 只改**传了的**字段：客户端不必每次都把整条发回来（那样一个字段忘了带就会被清空，
 * 是最容易写错的地方）。
 *
 * @param current - 现有条目。
 * @param patch - `{ title?, detail?, due? }`。
 * @param now - 当前毫秒时间戳。
 * @returns 改后的条目（新对象）。
 */
export function patchLocal(current, patch, now = Date.now()) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw localError('INVALID_INPUT', '请求体不是一个对象');
  }
  const unknown = Object.keys(patch).filter((key) => !LOCAL_INPUT_FIELDS.includes(key));
  if (unknown.length > 0) throw localError('INVALID_INPUT', `不认识的字段：${unknown.join('、')}`);

  // 只看"传了哪些"，然后用整份输入重新校验一次 —— 这样单个字段的规则只有一处
  const merged = {
    title: patch.title !== undefined ? patch.title : current.title,
    detail: patch.detail !== undefined ? patch.detail : current.detail,
    due: patch.due !== undefined ? patch.due : current.due,
    // repeat 传 null 是**显式取消重复**，与"没传"不同 —— 后者是保持原样。
    repeat: patch.repeat !== undefined ? patch.repeat : current.repeat,
  };
  const { title, detail, due, repeat } = normalizeLocalInput(merged);
  return { ...current, title, detail, due, repeat, updatedAt: Math.floor(now / 1000) };
}

/**
 * 勾选 / 取消完成。
 *
 * `doneAt` 单独记：页面要按"什么时候做完的"回看，而不只是"做完了没"。
 *
 * # 重复任务在**勾完成时**才推进
 *
 * 不是定时器、不是页面加载时扫描 —— 那两种都会在"用户根本没打开页面"的日子里
 * 悄悄生成一堆条目。勾完成是一个**明确的、用户发起的动作**，在这里推下一次
 * 最符合直觉：我做完这件事，下一件就出现了。
 *
 * 返回 `{ item, next }` 而不是只返回条目：调用方要拿 `next` 一起落盘，
 * 而**两次 save 会留下中间状态**（勾了但下一次没生成）。所以交给 store
 * 在一次写入里同时完成两件事。
 *
 * @param current - 现有条目。
 * @param done - 是否完成。
 * @param now - 当前毫秒时间戳。
 * @returns `{ item, next }`；`next` 为 null 表示不需要生成。
 */
export function setDone(current, done, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  const item = {
    ...current,
    done: Boolean(done),
    // 取消完成时把 doneAt 清掉 —— 留着会让"做完了吗"有两个互相矛盾的答案
    doneAt: done ? seconds : null,
    updatedAt: seconds,
  };

  // 只在「从未完成变成完成」时推进，取消勾选不该生成下一次。
  // 已经在完成状态又点一次完成（幂等重放）也不推进，否则会重复生成。
  const wasDone = Boolean(current.done);
  let next = null;
  if (done && !wasDone) {
    const at = nextOccurrence(current, now);
    if (at) {
      next = {
        ...current,
        id: newId(now),
        due: at,
        done: false,
        doneAt: null,
        createdAt: seconds,
        updatedAt: seconds,
        splitInto: [],
      };
    }
  }
  return { item, next };
}
