/**
 * 「反馈」页的纯逻辑：讨论串的形状与校验、本地笔名、以及收件服务的读写。
 *
 * # 这一页是什么
 *
 * 一个嵌在工作台里的**迷你社区**，形态照 GitHub issue 来：
 *
 * ```
 * 发一条需求 → 谁都能在下面评论 → 状态推进 → 每次动静都让这条浮上来
 * ```
 *
 * 与 GitHub 唯一的差别是**没有账号**。所以「谁在说话」靠一个**本地随机笔名**
 * （`访客-7f3a`，见 `localName`）：它存在本机、可重置、不指向任何真人。
 *
 * # 数据在哪
 *
 * **只有一处真值**：收件服务（`FEEDBACK_ENDPOINT`，公开、不鉴权）。仓库里不再有
 * 一份只读的公开板 —— 那会立刻变成两份会互相打架的来源（服务端的条目改了，仓库那份
 * 不知道）。代价要认：实例重启可能丢数据，页面会显示成空社区（见 `docs/modelscope-as-cloud-server.md`）。
 *
 * # 两条铁律
 *
 * 1. **不产生身份信息**：只发白名单字段，收件端对白名单外的字段**直接拒收**。
 *    唯一的例外是那个本地笔名，而它由本机生成、不是从用户身上读来的。
 * 2. 客户端校验只负责让用户当场看到问题，**真正的守门人始终是收件端**。
 */

/** 条目状态。`open` 推进中 / `done` 已实现 / `declined` 本期不采纳。 */
export const ISSUE_STATES = Object.freeze(['open', 'done', 'declined']);

/** 提交的两个种类：新需求 / 追踪已有条目。 */
export const ISSUE_KINDS = Object.freeze(['new', 'track']);

/**
 * 一条讨论串允许出现的字段 —— 白名单，不在表里的键一律不许进数据。
 *
 * 这份清单同时是**收件端契约的镜像**：服务端 `fold()` 产出的形状就是它。
 * 两边任何一边改了形状，`tests/feedback.test.mjs` 会红。
 */
export const ISSUE_FIELDS = Object.freeze([
  'id', 'kind', 'title', 'detail', 'name', 'at', 'status', 'comments', 'last', 'needs_reply',
]);

/** 一条评论允许出现的字段。 */
export const COMMENT_FIELDS = Object.freeze(['cid', 'name', 'body', 'at', 'robot']);

/**
 * 明确**禁止**出现在讨论串里的字段。
 *
 * 这是给测试用的守卫：这一页的产物会进公开日志，而条目最容易被塞进的恰恰就是
 * 「谁提的」—— 真名、学号、联系方式。出现这些字段不是"多存了一点"，是泄露。
 */
export const FORBIDDEN_FIELDS = Object.freeze([
  'author', 'submitter', 'user', 'username', 'studentId', 'realName',
  'contact', 'email', 'wechat', 'phone', 'ip', 'ua', 'userAgent',
]);

/** 与服务端一致的输入上限（见 `deploy/feedback-service/server.py`）。 */
export const LIMITS = Object.freeze({ title: 200, detail: 4000, comment: 4000, name: 24 });

/**
 * 笔名形状：1~24 个「字母 / 数字 / 下划线 / 连字符」。
 *
 * 必须显式用 `\p{L}\p{N}` 而不是 `\w`：JavaScript 的 `\w` **只认 ASCII**，
 * 中文笔名（默认生成的就是 `访客-xxxx`）会被自己判成非法。服务端那侧 Python 的
 * `\w` 默认是 Unicode 的，两边要一致 —— `tests/feedback.test.mjs` 钉住了这一点。
 */
const NAME_RE = /^[\p{L}\p{N}_-]{1,24}$/u;

/** 条目编号形状。 */
const ISSUE_ID_RE = /^F-\d{3,}$/;

/**
 * 校验一条讨论串。
 * @param issue - 待校验的对象。
 * @param index - 在数组中的下标，用于把错误定位到具体条目。
 * @returns 错误描述数组；空数组表示通过。
 */
export function validateIssue(issue, index) {
  const at = `#${index}`;
  const errors = [];
  if (issue === null || typeof issue !== 'object' || Array.isArray(issue)) return [`${at} 不是对象`];
  for (const key of Object.keys(issue)) {
    if (FORBIDDEN_FIELDS.includes(key)) errors.push(`${at} 含禁止字段 ${key}（不得夹带身份信息）`);
    else if (!ISSUE_FIELDS.includes(key)) errors.push(`${at} 含未知字段 ${key}`);
  }
  if (typeof issue.id !== 'string' || !ISSUE_ID_RE.test(issue.id)) errors.push(`${at} 的 id 必须是 F-001 形式的编号`);
  if (issue.kind !== undefined && !ISSUE_KINDS.includes(issue.kind)) errors.push(`${at} 的 kind 必须是 ${ISSUE_KINDS.join(' / ')}`);
  if (typeof issue.title !== 'string' || issue.title.trim() === '') errors.push(`${at} 缺 title`);
  if (issue.detail !== undefined && typeof issue.detail !== 'string') errors.push(`${at} 的 detail 必须是字符串`);
  if (issue.name !== undefined && !isValidName(issue.name)) errors.push(`${at} 的 name 必须是本地笔名`);
  if (!ISSUE_STATES.includes(issue.status)) errors.push(`${at} 的 status 必须是 ${ISSUE_STATES.join(' / ')}`);
  if (issue.needs_reply !== undefined && typeof issue.needs_reply !== 'boolean') errors.push(`${at} 的 needs_reply 必须是布尔值`);
  if (!Array.isArray(issue.comments)) errors.push(`${at} 的 comments 必须是数组`);
  else issue.comments.forEach((comment, i) => {
    if (comment === null || typeof comment !== 'object' || Array.isArray(comment)) { errors.push(`${at} 的第 ${i} 条评论不是对象`); return; }
    for (const key of Object.keys(comment)) {
      if (FORBIDDEN_FIELDS.includes(key)) errors.push(`${at} 的第 ${i} 条评论含禁止字段 ${key}`);
      else if (!COMMENT_FIELDS.includes(key)) errors.push(`${at} 的第 ${i} 条评论含未知字段 ${key}`);
    }
    if (typeof comment.body !== 'string' || comment.body.trim() === '') errors.push(`${at} 的第 ${i} 条评论缺 body`);
    if (!isValidName(comment.name)) errors.push(`${at} 的第 ${i} 条评论的 name 不合法`);
  });
  return errors;
}

/**
 * 校验整份讨论串列表。
 *
 * 除了逐条形状，还检查编号唯一 —— 服务端的编号是自增的，重号意味着日志被并发写坏，
 * 那是必须看见的事故而不是"显示上有点怪"。
 * @param issues - 解析后的数组。
 * @returns 错误描述数组；空数组表示通过。
 */
export function validateBoard(issues) {
  if (!Array.isArray(issues)) return ['讨论串必须是数组'];
  const errors = [];
  issues.forEach((issue, index) => errors.push(...validateIssue(issue, index)));
  const seen = new Set();
  for (const issue of issues) {
    if (typeof issue?.id === 'string' && seen.has(issue.id)) errors.push(`条目编号重复：${issue.id}`);
    if (typeof issue?.id === 'string') seen.add(issue.id);
  }
  return errors;
}

/**
 * 笔名是否合法（与服务端 `NAME_RE` 同一套）。
 * @param name - 待校验的笔名。
 * @returns 是否可用。
 */
export function isValidName(name) {
  return typeof name === 'string' && NAME_RE.test(name);
}

/**
 * 一个本地随机笔名。
 *
 * **为什么需要它**：没有笔名，讨论串里就分不清「谁说的」—— 用户认不出自己提过哪条，
 * 机器人也没法指名回复。**为什么不能用真的**：这一页的产物会进公开日志，收真名就是
 * 收个人信息。折中是「随机 + 存在本机 + 可重置」：它能表达"还是同一个人"，
 * 但那串十六进制不指向任何真人。
 *
 * @param random - 返回 [0,1) 的函数，便于测试注入。
 * @returns 形如 `访客-7f3a` 的笔名。
 */
export function randomName(random = Math.random) {
  const suffix = Math.floor(random() * 0x10000).toString(16).padStart(4, '0');
  return `访客-${suffix}`;
}

/** 笔名在 localStorage 里的键。 */
export const NAME_KEY = 'zhiyun.feedback.name';

/**
 * 取本机笔名；没有就生成一个并记下来。
 *
 * `storage` 缺失（无痕模式、宿主没给 localStorage）时退化成每次现算一个 ——
 * 讨论串会因此认不出同一个人，但**页面不会崩**，这比崩掉重要。
 * @param options - `{ storage, random }`，便于测试注入。
 * @returns 笔名。
 */
export function localName(options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const random = options.random ?? Math.random;
  try {
    const saved = storage?.getItem(NAME_KEY);
    if (isValidName(saved)) return saved;
    const fresh = randomName(random);
    storage?.setItem(NAME_KEY, fresh);
    return fresh;
  } catch {
    // 存储被禁用时 `getItem` 也可能抛。这时给一个临时笔名而不是让整页挂掉。
    return randomName(random);
  }
}

/** 换一个笔名（用户嫌上一个不好看，或者想匿名重来）。 */
export function resetName(options = {}) {
  const storage = options.storage ?? globalThis.localStorage;
  const fresh = randomName(options.random ?? Math.random);
  try { storage?.setItem(NAME_KEY, fresh); } catch { /* 存不下就只是这次不生效 */ }
  return fresh;
}

/**
 * 把讨论串排成展示顺序：**按最后活动时间倒序**。
 *
 * 这是 issue 列表的默认序，也是这一页「像社区」的关键：旧条目只要有人评论就会浮上来，
 * 不必靠置顶。服务端已经这样返回，这里再排一次是为了让客户端在数据来自缓存的旧格式时
 * 也有确定行为，并且不依赖服务端的排序实现。
 * @param issues - 讨论串数组。
 * @returns 新数组，不改动入参。
 */
export function orderIssues(issues) {
  return [...issues].sort((a, b) => (Number(b.last) || 0) - (Number(a.last) || 0));
}

/**
 * 汇总讨论串，供页面顶部一行摘要用。
 * @param issues - 讨论串数组。
 * @returns `{ total, open, done, declined, comments }`。
 */
export function summarize(issues) {
  return {
    total: issues.length,
    open: issues.filter(issue => issue.status === 'open').length,
    done: issues.filter(issue => issue.status === 'done').length,
    declined: issues.filter(issue => issue.status === 'declined').length,
    comments: issues.reduce((sum, issue) => sum + (issue.comments?.length ?? 0), 0),
  };
}

/**
 * 一条讨论串是否需要维护者出面回应。
 *
 * **判定在服务端**（`deploy/feedback-service/server.py` 的 `needs_reply()`），这里只读它
 * 算好的 `needs_reply` 字段。刻意不在客户端重算：机器人（Python）与页面（JS）都要用
 * 这个判定，两边各写一份必然漂移 —— 这个仓库已经在别处踩过同类问题（JS 的 `\w` 只认
 * ASCII、Python 的是 Unicode，于是两端对"合法笔名"的理解不一致）。
 *
 * 拿不到该字段时（老数据、服务端没升）**保守地当作需要回应**：多提醒一次无害，
 * 漏掉一条没人理的需求才是真问题。
 * @param issue - 一条讨论串。
 * @returns 是否需要回应。
 */
export function needsReply(issue) {
  if (typeof issue?.needs_reply === 'boolean') return issue.needs_reply;
  const comments = issue?.comments;
  return !Array.isArray(comments) || comments.length === 0 || !comments[comments.length - 1].robot;
}

/**
 * 挑出待回应的讨论串，按「最久没人管」优先 —— 先来先答，新的需求排在后面。
 *
 * 排序与 `needs_reply` 一样，服务端已经做过一次（`GET /feedback?pending=1`）；
 * 这里保留是为了让页面在拿到全量列表时也能自己挑，顺序口径与 `server.pending()` 一致。
 * @param issues - 讨论串数组。
 * @returns 新数组，不改动入参。
 */
export function pendingIssues(issues) {
  return [...issues]
    .filter(needsReply)
    .sort((a, b) => (Number(a.last) || 0) - (Number(b.last) || 0));
}

/**
 * 客户端侧的新需求校验 —— 与服务端同一套规则。
 *
 * 为什么不只靠服务端：服务端拒了之后用户只拿到一句「字段不合法」，不知道该改哪里。
 * 这里先拦一遍，把具体问题指出来。**但这不替代服务端校验**：客户端可以被绕过。
 * @param form - `{ kind, title, detail }`。
 * @returns 错误消息；空字符串表示可以提交。
 */
export function checkIssue(form) {
  const title = typeof form?.title === 'string' ? form.title.trim() : '';
  const detail = typeof form?.detail === 'string' ? form.detail.trim() : '';
  if (!ISSUE_KINDS.includes(form?.kind)) return '请选择要提新需求还是追踪已有条目';
  if (title === '') return '标题不能为空';
  if (detail === '') return '请把想法写具体一点';
  if (title.length > LIMITS.title) return `标题最多 ${LIMITS.title} 字`;
  if (detail.length > LIMITS.detail) return `正文最多 ${LIMITS.detail} 字`;
  return '';
}

/**
 * 客户端侧的评论校验。
 * @param body - 评论正文。
 * @returns 错误消息；空字符串表示可以提交。
 */
export function checkComment(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (text === '') return '评论不能为空';
  if (text.length > LIMITS.comment) return `评论最多 ${LIMITS.comment} 字`;
  return '';
}

/**
 * 收件服务里**页面用到的**端点路径（抽出来，测试才能逐字符钉住）。
 *
 * 机器人那两条（`/feedback/robot`、`/feedback/status`）**刻意不在这里**：机器人在
 * `robot/feedback.py`，直接 import 服务端模块复用协议。页面没有令牌、也不该有，
 * 把它写进客户端 bundle 只会让人以为这页能冒充维护者。
 */
export const paths = Object.freeze({
  issues: '/feedback',
  comment: '/feedback/comment',
});

/**
 * 反馈收件服务的地址。
 *
 * 部署在魔搭 Studio（`leywlybx/zju-workbench-alpha`）上。**发需求、评论、读列表
 * 这三件事都不鉴权** —— 它们就是要被所有用户调的，所以这个地址可以光明正大写进代码：
 * 地址本身不是凭证，写出去不构成任何泄露（这一点与 key 有本质区别）。
 *
 * 只有「以机器人身份发言」与「推进状态」两条路径要令牌，它们只归 `robot/feedback.py`。
 * 它现在承载整个社区，所以**连不上就是这一页的主要故障模式**：页面会显示成空社区
 * 并明确说明，而不是装作"还没有人提过"。
 */
export const FEEDBACK_ENDPOINT = 'https://leywlybx-zju-workbench-alpha.ms.show';

/**
 * 统一的请求收尾：把"服务端说了什么"翻译成 `{ ok, ... }`，**从不抛异常**。
 *
 * 网络不通是可预期的情况（离线、实例重启中）：如实说，不伪装成成功。
 * @param doFetch - fetch 实现。
 * @param url - 完整地址。
 * @param options - fetch 的第二参数。
 * @returns `{ ok: true, answer }` 或 `{ ok: false, error }`。
 */
async function request(doFetch, url, options) {
  try {
    const response = await doFetch(url, options);
    const answer = await response.json().catch(() => null);
    if (!response.ok || answer?.ok !== true) {
      return { ok: false, error: answer?.error ?? `请求失败（${response.status}）` };
    }
    return { ok: true, answer };
  } catch {
    return { ok: false, error: '连不上反馈服务，请稍后再试' };
  }
}

/**
 * 发一条新需求。
 *
 * 只发白名单字段：**绝不带任何身份信息**（不含 IP、UA、本机路径、真实姓名）。
 * 署名用本地随机笔名，收件端会拒收白名单外的字段，两边一致。
 * @param payload - `{ kind, title, detail, name }`。
 * @param options - `{ endpoint, fetch }`，便于测试注入。
 * @returns `{ ok, issue }` 或 `{ ok: false, error }`。
 */
export async function submitIssue(payload, options = {}) {
  const endpoint = options.endpoint ?? FEEDBACK_ENDPOINT;
  const doFetch = options.fetch ?? globalThis.fetch;
  const body = { kind: payload.kind, title: payload.title.trim(), detail: payload.detail.trim(), name: payload.name };
  const result = await request(doFetch, `${endpoint}${paths.issues}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return result.ok ? { ok: true, issue: result.answer.issue } : result;
}

/**
 * 在某条下面发一条评论。
 * @param payload - `{ issue, body, name }`。
 * @param options - `{ endpoint, fetch }`。
 * @returns `{ ok, comment }` 或 `{ ok: false, error }`。
 */
export async function submitComment(payload, options = {}) {
  const endpoint = options.endpoint ?? FEEDBACK_ENDPOINT;
  const doFetch = options.fetch ?? globalThis.fetch;
  const body = { issue: payload.issue, body: payload.body.trim(), name: payload.name };
  const result = await request(doFetch, `${endpoint}${paths.comment}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return result.ok ? { ok: true, comment: result.answer.comment } : result;
}

/**
 * 读回整个社区的讨论串。
 *
 * 这是**所有人的**讨论串，不是「我的」：服务端不存账号，所以筛不出"我提的"。
 * 要个人追踪是做不到的 —— 这是「不收身份信息」的直接代价，也是选定的取舍。
 * @param options - `{ endpoint, fetch }`。
 * @returns `{ ok, issues }` 或 `{ ok: false, error, issues: [] }`。
 */
export async function loadIssues(options = {}) {
  const endpoint = options.endpoint ?? FEEDBACK_ENDPOINT;
  const doFetch = options.fetch ?? globalThis.fetch;
  const result = await request(doFetch, `${endpoint}${paths.issues}`, { method: 'GET' });
  if (!result.ok) return { ...result, issues: [] };
  return { ok: true, issues: Array.isArray(result.answer.issues) ? result.answer.issues : [] };
}

/**
 * 讨论串里每条相对「现在」的粗略时间。
 *
 * 服务端给的是 epoch 秒；页面只需要"多久以前"这个量级，所以不做时区与本地化。
 * @param at - epoch 秒。
 * @param nowSeconds - 当前时间（epoch 秒），便于测试注入。
 * @returns 形如 `3 分钟前`；无法判断时给空字符串。
 */
export function ago(at, nowSeconds = Math.floor(Date.now() / 1000)) {
  const seconds = Number(at);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const diff = Math.max(0, nowSeconds - seconds);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  return `${Math.floor(diff / (86400 * 30))} 个月前`;
}
