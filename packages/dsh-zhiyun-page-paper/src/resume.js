/**
 * `/resume` 面板的纯逻辑：会话代号、行标签、选择移动、命令识别。
 *
 * 抽成模块（而不是写在组件里）是为了能直接跑单测 —— 面板的交互里最容易错的
 * 恰恰是「选中项怎么绕圈」「Delete 之后选中项落在哪」这类边界。
 *
 * # 为什么用「哈希代号」而不是完整 sessionId
 *
 * 会话 id 长这样：`dpr-5pyq5YiG57G7L05hdHVyZTI1LVBGTg-1` —— 前段是 topic/name
 * 的 base64url，本身就把论文名又编码了一遍，尾段才是编号。整串塞进一行会把
 * 「首句」挤没。代号取 sessionId 的 32 位散列前四位，用于**人眼区分**与口头指代；
 * 它不参与任何查找（切换/删除永远用完整 id），所以不需要防碰撞保证。
 */

/** `/resume` 的命令形状：`/resume` 单独一行即可，后面跟空格与内容也算（本版忽略参数）。 */
const RESUME_COMMAND = /^\/resume(?:\s|$)/i;

/** 命令行里可用的命令名（用于输入提示）。 */
export const RESUME_COMMAND_TEXT = '/resume';

/**
 * 判断输入框里的一行是不是 `/resume` 命令。
 * @param draft - 输入框当前内容。
 */
export function isResumeCommand(draft) {
  return RESUME_COMMAND.test(String(draft ?? '').trim());
}

/**
 * sessionId → 4 位代号（FNV-1a 32 位的 base36）。
 * @param sessionId - 完整会话 id。
 * @returns 形如 `a3f9` 的小写代号；拿不到 id 时返回 `'----'`。
 */
export function sessionCode(sessionId) {
  const text = String(sessionId ?? '');
  if (!text) return '----';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(4, '0').slice(0, 4);
}

/**
 * 一行的可见文本：`#代号 · 论文名 · 首句`。
 *
 * 首句缺失时依次回落到会话标题、"（还没有提问）"。**顺序不能反**：标题是模型
 * 起的（可能和用户真正的问法不同），首句是用户自己写的，认人时后者更准。
 *
 * @param entry - `{ n, sessionId, title, firstQuestion, blank }`
 * @param paperName - 当前文献名（面板只列本文献的会话，所以是常量）。
 */
export function rowText(entry, paperName) {
  const parts = [`#${sessionCode(entry?.sessionId)}`, String(paperName ?? '').trim() || '未命名文献'];
  const head = entry?.firstQuestion || entry?.title || (entry?.blank ? '（还没有提问）' : '（没有可读的内容）');
  parts.push(head);
  return parts.join(' · ');
}

/**
 * 移动选中项，到边界绕回另一端（↑ 在第一项时跳到最后一项）。
 * @param index - 当前下标（可为 -1，表示未选中）。
 * @param delta - `-1` 上、`+1` 下。
 * @param length - 列表长度。
 */
export function moveIndex(index, delta, length) {
  if (!Number.isInteger(length) || length <= 0) return -1;
  if (!Number.isInteger(index) || index < 0 || index >= length) return delta < 0 ? length - 1 : 0;
  return (index + delta + length) % length;
}

/**
 * 删掉一项之后选中项落在哪。
 *
 * 不变量：**删完永远选中「原来那一项的下一项」**（末尾则退回最后一项），这样连续
 * 按 Delete 删多条时，选中项不会跳到列表头再让人重新找。
 * @returns 新下标；列表空了返回 -1。
 */
export function indexAfterRemove(index, length) {
  const remaining = length - 1;
  if (remaining <= 0) return -1;
  if (!Number.isInteger(index) || index < 0) return 0;
  return Math.min(index, remaining - 1);
}

/**
 * 把关卡数据拼成面板条目：上游给的 `{n, sessionId, blank, ...}` + 本包路由给的
 * `{title, firstQuestion}`。按 `n` 升序（旧会话在上，最新的在最下面）——
 * 与数字键位直觉一致。
 *
 * @param sessions - 上游 `/api/sessions` 的 `sessions` 数组。
 * @param labels - 本包 `/api/sessions/labels` 的 `cards` 数组。
 * @param currentN - 当前正连着的会话编号（用于标记）。
 */
export function buildRows(sessions, labels, currentN) {
  const byId = new Map();
  for (const card of labels ?? []) {
    if (card && typeof card.sessionId === 'string') byId.set(card.sessionId, card);
  }
  return (sessions ?? [])
    .filter((session) => session && typeof session.sessionId === 'string')
    .map((session) => {
      const card = byId.get(session.sessionId) ?? {};
      return {
        n: session.n,
        sessionId: session.sessionId,
        blank: Boolean(session.blank),
        running: Boolean(session.running),
        title: typeof card.title === 'string' ? card.title : null,
        firstQuestion: typeof card.firstQuestion === 'string' ? card.firstQuestion : null,
        current: session.n === currentN,
      };
    })
    .sort((a, b) => (a.n ?? 0) - (b.n ?? 0));
}

/**
 * 面板打开时默认选中哪一项：当前会话；找不到就选最后一项（最新）。
 */
export function initialIndex(rows) {
  if (!rows || rows.length === 0) return -1;
  const at = rows.findIndex((row) => row.current);
  return at >= 0 ? at : rows.length - 1;
}
