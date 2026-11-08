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
 * 按月推进时**要落在哪一天**。
 *
 * # 为什么不能直接用「上一条的日号」
 *
 * 普通条目上「日号」是用户自己选的（每月 31 日交材料）。但夹住之后
 * 2 月只有 28 日，**再往下推就一路是 28 日** —— 实测
 * `1/31 → 2/28 → 3/28 → 4/28 …`，永远回不到 31 日。
 * 这不是"夹住"的本意：用户要的是「每月最后一天」这一档，不是「跌到 28 就锁死」。
 *
 * 所以第一次夹住时把**原始日号**记在条目上；以后每次都从那个日号重新夹。
 * 没夹住（目标月有这一天）就不记，行为与从前完全一致。
 *
 * @param item - 现有条目。
 * @returns 1–31 的原始日号；没有记录时返回 null。
 */
export function originalDayOf(item) {
  const stored = Number(item?.repeatDay);
  if (Number.isInteger(stored) && stored >= 1 && stored <= 31) return stored;
  return null;
}

/** 按天/月推进时用的起点日号：有历史原日号就沿用它。 */
function anchorDayNumber(baseIso, item) {
  const at = Date.parse(baseIso);
  if (Number.isNaN(at)) return null;
  return originalDayOf(item) ?? new Date(at).getUTCDate();
}

/**
 * 把一个「年 / 月（0 起）」往后推 N 个月。
 *
 * 与 `advanceBy` 里那段不同：这里只算**目标是哪个月**，不带走日号 ——
 * 日号由调用方按「原日号 vs 月末」自己夹。
 */
function addMonths(year, month, delta) {
  const zero = year * 12 + month + delta;
  return { y: Math.floor(zero / 12), m: ((zero % 12) + 12) % 12 };
}

/** 「原始日号」的字段名，写进条目，跟着一直往下传。 */
export const REPEAT_DAY_FIELD = 'repeatDay';

/**
 * 算下一条该带的原始日号。
 *
 * - 非按月：返回 `undefined`（不带这个字段）；
 * - 按月且目标月**放不下**原日号：返回原日号，让它一路夹下去；
 * - 按月且目标月放得下：返回 `undefined` —— 日号已经回到原位，不需要再记。
 *
 * @param item - 现有条目（本条的 `due` 是**起点**）。
 * @param due - 推进后的 `due`。
 * @param unit - 周期单位。
 * @returns 要写进 `repeatDay` 的值，或 undefined 表示不写。
 */
function carriedDay(item, due, unit) {
  if (unit !== 'month') return undefined;
  const at = Date.parse(due);
  if (Number.isNaN(at)) return undefined;
  const original = anchorDayNumber(item.due, item);
  if (original === null) return undefined;
  return new Date(at).getUTCDate() === original ? undefined : original;
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
  const { anchor, unit } = item.repeat;
  const base = anchor === 'done' ? new Date(now).toISOString() : item.due;
  if (!base) return null;
  const at = Date.parse(base);
  if (Number.isNaN(at)) return null;

  // 按月推进**直接算目标月**，而不是"先夹住再推"：
  // 先夹住会把 2 月的 28 当成起点，于是 3 月得到 28 —— 日号从此塌下去。
  // 目标月由 `addMonths` 算出，日号取「原日号」与「目标月长」的较小者。
  const original = anchorDayNumber(base, item);
  if (unit !== 'month' || original === null) return advanceBy(base, item.repeat);

  const head = new Date(at);
  const step = Number(item.repeat.every) || 1;
  const target = addMonths(head.getUTCFullYear(), head.getUTCMonth(), step);
  const lastOfTarget = new Date(Date.UTC(target.y, target.m + 1, 0)).getUTCDate();
  const day = Math.min(original, lastOfTarget);
  return new Date(Date.UTC(
    target.y, target.m, day,
    head.getUTCHours(), head.getUTCMinutes(), head.getUTCSeconds(), head.getUTCMilliseconds(),
  )).toISOString();
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
      const origin = current.repeatFrom ?? current.id;
      const day = carriedDay(current, at, current.repeat?.unit);
      next = {
        ...current,
        id: newId(now),
        due: at,
        done: false,
        doneAt: null,
        createdAt: seconds,
        updatedAt: seconds,
        splitInto: [],
        // 同一条重复的每一代都指回**第一代**，撤销勾选时据此收回多出来的副本
        repeatFrom: origin,
      };
      if (day === undefined) delete next.repeatDay;
      else next.repeatDay = day;
    }
  }
  return { item, next };
}

/**
 * 撤销完成时，**因为这次完成而多出来的副本**。
 *
 * ⚠️ 排查记录（留给下一轮，别再重走）：上一版把"收不到"归因于 `node -e` 的对象比较行为，
 * 那是错的。真因是**判定顺序**：取消勾选会清掉 `doneAt`，于是"勾错原始那条"与
 * "勾错副本"留下的条目**完全同形**，只能靠 `due` 区分；而当时的判据先比 `due`
 * 再比 `id`，在"被撤的就是原始那条"这条真实路径上等于拿自己和比自己，恒不成立。
 * 教训：跨对象的行为断言一律落到 `tests/` 里跑，别用 `-e` 或 `/tmp` 脚本下结论。
 *
 * # 为什么需要它
 *
 * 勾完成会顺带生成下一条（见 `setDone`）。用户点错了再取消勾选时，下一条
 * 没人收 —— 于是列表里出现**两条同一截止日、id 不同、都未完成**的副本；
 * 再勾一次又多一条。这不是算法算错，是"生成"没有对应的"收回"。
 *
 * # 收哪一条
 *
 * 只收**当前这条自己生成的那一代**：同一条链、`due` 更晚、还没被勾过。
 * 不做更聪明的推测：用户可能已经给下一条改过标题，那就当他认领了，不动。
 *
 * # 判定顺序里有两个坑（都是实跑踩出来的）
 *
 * 1. **先判 `id` 再判 `due`**。取消勾选后列表里通常会同时存在「原来那条（已完成）」
 *    和「刚生成的那条（刚被取消勾选）」。前者的 `due` **比后者早**，所以"更晚"
 *    天然把它挡掉；但真实的撤销路径里，被撤的那条往往本来就是当前这条 ——
 *    若先按 `due` 判，会用"自己"去比"自己"，`at > mine` 恒为假，一条都收不到。
 * 2. **`due` 相等的一律不收**。同一条截止日上的两条副本是**症状**，不是可收的对象：
 *    收掉它等于随机删掉用户的一条待办。真正该收的是"往后挪的那一代"。
 *
 * @param items - 全量条目。
 * @param current - 刚被取消勾选的这条。
 * @returns 要删掉的条目 id 数组（可能为空）。
 */
export function recallGenerated(items, current) {
  if (!current?.repeat) return [];
  const origin = current.repeatFrom ?? current.id;
  const mine = Date.parse(current.due);
  if (Number.isNaN(mine)) return [];
  const out = [];
  for (const row of items ?? []) {
    if (!row) continue;
    if (row.id === current.id) continue;                   // 不可能是"自己生成的自己"
    if ((row.repeatFrom ?? row.id) !== origin) continue;   // 别的重复链
    if (!row.repeat) continue;
    if (row.done || row.doneAt) continue;                  // 已经被做过的不收回
    if (Array.isArray(row.splitInto) && row.splitInto.length > 0) continue;
    const at = Date.parse(row.due);
    if (Number.isNaN(at) || at <= mine) continue;          // 只收往后挪的那一代
    out.push(row);
  }
  if (out.length <= 1) return out.map((row) => row.id);
  out.sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)
    || String(a.id).localeCompare(String(b.id)));
  return [out[0].id];
}
