/**
 * 会话管理的宿主半边：给「论文阅读」的 `/resume` 面板提供上游没给的两件事。
 *
 * # 为什么不是直接复用上游的 `/paper-reader/api/sessions`
 *
 * 上游那条路由**照旧继续用**（它知道哪些会话属于哪篇文献、哪些已被归档），但它只返回
 * `{ n, sessionId, running, blank, updatedAt }` —— 见 `dist/host.js` 的 `scanPaperSessions`。
 * 一个只有编号的列表没法让人认出「哪条是我当时在问什么」，所以面板还需要：
 *
 *   1. **首句**：会话日志里第一条「真人说的」发言。宿主 `sessionController.inspect(id)`
 *      能在不激活 Agent 的前提下把事件前缀读出来（`inspectApiSession` 的 `projectionMode: 'none'`）。
 *   2. **归档任意会话**：上游那条归档路由只允许删**空白**会话（有内容就 409
 *      `只允许归档无内容的空白会话`），而用户要的是「删掉旧会话」。
 *
 * # 为什么首句要洗一遍
 *
 * 上游 `/api/ask` 把「文献上下文 + 选区引用 + 用户的问题」拼成一段 prompt 一起发
 * （`[论文伴读] 文献：…` / `用户在阅读器里选中了一段文字…` / `用户的问题：…`）。
 * 直接拿第一条消息当标签，列表里每行前面都会挂一段一模一样的长前缀。所以标签里
 * 只留 `用户的问题：` 之后的那一句。
 *
 * # 「删除」为什么是归档
 *
 * 宿主 `SessionController` 没有 delete/remove（只有 list/inspect/fork/rename/…），
 * 真删要绕过会话持久化层去动文件 —— 那不是兼容层该干的事。官方语义里的「删除」
 * 就是 `workspaceRegistry.archiveSession()`：从所有列表里消失、日志保留、可撤销。
 * 面板上照实说成「删除（归档，可在宿主会话列表里恢复）」，不假装是物理删除。
 */

import { PaperError } from './errors.js';

/** 一次最多读多少个会话的首句。面板是给人看的，超过这个数人也不会真的去翻。 */
export const MAX_CARD_IDS = 50;

/** 单条首句保留的长度：只用来认人，不当作正文。 */
const MAX_QUESTION_CHARS = 400;

/** 上游拼 prompt 时的分界标记（见 `dist/host.js` 的 `/api/ask`）。 */
const QUESTION_MARKER = '用户的问题：';

/** 会话读取的单次超时：某个冷会话读不出来，不该把整个面板拖住。 */
const READ_TIMEOUT_MS = 15_000;

/**
 * 论文阅读自己的会话 id：上游用 `dpr-<base64url(topic/name)>-<n>` 生成
 * （`sessionPrefixFor`）。只认这个前缀，避免面板上的「删除」被用来归档
 * 工作台里别的会话。
 */
export function isPaperSessionId(sessionId) {
  return typeof sessionId === 'string'
    && sessionId.startsWith('dpr-')
    && sessionId.length > 4
    && sessionId.length <= 512
    && !sessionId.includes('/');
}

/**
 * 洗掉上游拼在问题前面的文献上下文与选区引用，只留用户真正问的那句。
 * @param raw - 一条 `user/message` 的正文。
 * @returns 单行文本；没有任何内容时返回 `null`。
 */
export function cleanQuestion(raw) {
  let text = String(raw ?? '');
  const marker = text.indexOf(QUESTION_MARKER);
  if (marker >= 0) text = text.slice(marker + QUESTION_MARKER.length);
  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_QUESTION_CHARS ? `${text.slice(0, MAX_QUESTION_CHARS)}…` : text;
}

/**
 * 从会话事件里取「真人说的第一句」。
 *
 * 注入的工作台上下文（AGENTS / 运行时策略 / 技能目录）也是 `user/message`，
 * 靠 `data.source.kind !== 'user'` 区分 —— 与宿主判「真发言」的写法一致
 * （`.ref/packages/api/session-controller/src/list.ts` 的 `applySessionListMetadata`）。
 * 没有 `source` 字段的老消息按真人发言处理：宁可多显示一条，不可把提问吞掉。
 *
 * @param events - `SessionInspection.events`（或任何事件数组）。
 * @returns 洗过的单行文本；找不到返回 `null`。
 */
export function firstUserQuestion(events) {
  for (const event of events ?? []) {
    if (event?.type !== 'user/message') continue;
    const source = event.data?.source;
    if (source && typeof source === 'object' && source.kind !== 'user') continue;
    const parts = [];
    for (const block of event.data?.content ?? []) {
      if (block?.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    }
    const text = cleanQuestion(parts.join('\n'));
    if (text) return text;
  }
  return null;
}

/**
 * @param options.getSessionController - 惰性取宿主的 `sessionController`（取不到返回 null）。
 * @param options.getWorkspaceRegistry - 惰性取宿主的 `workspaceRegistry`（取不到返回 null）。
 * @param options.warn - 记一条警告（读取失败只降级，不抛）。
 */
export function createSessionAdmin({ getSessionController, getWorkspaceRegistry, warn } = {}) {
  const note = typeof warn === 'function' ? warn : () => {};

  async function titles() {
    const controller = getSessionController?.();
    if (typeof controller?.list !== 'function') return null;
    const value = await controller.list({}, AbortSignal.timeout(READ_TIMEOUT_MS));
    const map = new Map();
    for (const item of value?.items ?? []) {
      const title = item?.projections?.values?.title;
      if (typeof title === 'string' && title) map.set(item.sessionId, title);
    }
    return map;
  }

  return {
    /**
     * 读取若干会话的标签材料。**逐条尽力而为**：某一条读不出来只让它的首句为空，
     * 不让整个面板空掉。
     * @param sessionIds - 面板当前列出的会话 id。
     * @returns `{ sessionId, title, firstQuestion }[]`
     */
    async cards(sessionIds) {
      const controller = getSessionController?.();
      if (typeof controller?.list !== 'function' || typeof controller?.inspect !== 'function') {
        throw new PaperError('NO_SESSION_ADMIN', '会话标签需要宿主的 sessionController 服务（当前不可用）');
      }

      const ids = (Array.isArray(sessionIds) ? sessionIds : [])
        .filter(isPaperSessionId)
        .slice(0, MAX_CARD_IDS);

      let known = null;
      try {
        known = await titles();
      } catch (err) {
        note(`读取会话标题失败，只显示首句：${err instanceof Error ? err.message : String(err)}`);
      }

      const cards = [];
      for (const sessionId of ids) {
        let firstQuestion = null;
        try {
          const seen = await controller.inspect(sessionId, AbortSignal.timeout(READ_TIMEOUT_MS));
          firstQuestion = firstUserQuestion(seen?.events);
        } catch (err) {
          note(`跳过读不出首句的会话 ${sessionId}：${err instanceof Error ? err.message : String(err)}`);
        }
        cards.push({ sessionId, title: known?.get(sessionId) ?? null, firstQuestion });
      }
      return cards;
    },

    /** 归档一个会话（面板上的「删除」）。 */
    async archive(sessionId) {
      if (!isPaperSessionId(sessionId)) {
        throw new PaperError('INPUT', '只允许归档论文阅读自己的会话');
      }
      const registry = getWorkspaceRegistry?.();
      if (typeof registry?.archiveSession !== 'function') {
        throw new PaperError('NO_SESSION_ADMIN', '删除会话需要宿主的 workspaceRegistry 服务（当前不可用）');
      }
      // stopActivity：正在生成回答的会话也要删得掉，但会话日志保留（可撤销）。
      await registry.archiveSession(sessionId, { stopActivity: true });
      return { ok: true, sessionId };
    },
  };
}
