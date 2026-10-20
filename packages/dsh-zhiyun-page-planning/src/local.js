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
export const LOCAL_FIELDS = Object.freeze(['id', 'title', 'detail', 'due', 'done', 'createdAt', 'updatedAt', 'doneAt']);

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

/** 新建时允许客户端传的字段（其余由服务端生成）。 */
export const LOCAL_INPUT_FIELDS = Object.freeze(['title', 'detail', 'due']);

/**
 * 校验并规整一次**写入**（新建或修改）。
 *
 * 与模型输出一样按**不可信输入**处理：形状不对就报错，不做"猜他想填什么"。
 *
 * @param raw - 客户端传来的 `{ title, detail, due }`。
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

  return { title, detail, due };
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
 * 造一条新规划。
 *
 * @param raw - 客户端传来的输入。
 * @param now - 当前毫秒时间戳。
 * @returns 完整条目。
 */
export function createLocal(raw, now = Date.now()) {
  const { title, detail, due } = normalizeLocalInput(raw);
  const seconds = Math.floor(now / 1000);
  return {
    id: newId(now),
    title,
    detail,
    due,
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
  const { title, detail, due } = normalizeLocalInput(raw);
  const seconds = Math.floor(now / 1000);
  return {
    id: newId(now),
    title,
    detail,
    due,
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
  };
  const { title, detail, due } = normalizeLocalInput(merged);
  return { ...current, title, detail, due, updatedAt: Math.floor(now / 1000) };
}

/**
 * 勾选 / 取消完成。
 *
 * `doneAt` 单独记：页面要按"什么时候做完的"回看，而不只是"做完了没"。
 *
 * @param current - 现有条目。
 * @param done - 是否完成。
 * @param now - 当前毫秒时间戳。
 * @returns 改后的条目。
 */
export function setDone(current, done, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  return {
    ...current,
    done: Boolean(done),
    // 取消完成时把 doneAt 清掉 —— 留着会让"做完了吗"有两个互相矛盾的答案
    doneAt: done ? seconds : null,
    updatedAt: seconds,
  };
}
