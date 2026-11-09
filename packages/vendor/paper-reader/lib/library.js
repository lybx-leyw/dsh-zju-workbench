/**
 * 上游路由的调用封装（最小集）。
 *
 * # 为什么只有两个函数
 *
 * 完整版在 `packages/client/page-paper/src/library.js`（8.5 KB，含主题、状态、
 * 上传等一堆页面级工具）。而 SDK 侧只需要「问一句」和「拿到 SSE 地址」这两件事 ——
 * 把那份整包搬过来会把页面职责混进插件里。
 *
 * 所以这里只留 `ask` 与 `followUrl`，其余仍归页面包。
 */

/** 上游路由前缀。 */
export const UPSTREAM_PREFIX = '/paper-reader';

/** SSE 地址。`n` 省略时上游取该文献最新的那个会话。 */
export function followUrl(topic, name, n) {
  const query = new URLSearchParams({ topic, name });
  if (n) query.set('n', String(n));
  return `${UPSTREAM_PREFIX}/api/session/follow?${query.toString()}`;
}

/**
 * 向论文提问（把问题注入伴读会话）。
 *
 * @param options.topic / options.name - 当前文献。
 * @param options.question - 问题正文。
 * @param options.selectedText / options.page - 选区引用（可选）。
 * @param options.n - 会话序号；缺省进最新会话。
 * @param options.fresh - true = 强制新建一个会话。
 * @returns `{ ok, sessionId, n }`
 */
export async function ask({ topic, name, question, selectedText, page, n, fresh }) {
  const res = await fetch(`${UPSTREAM_PREFIX}/api/ask`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      topic,
      name,
      question,
      ...(selectedText === undefined || selectedText === '' ? {} : { selectedText, page }),
      ...(n ? { n } : {}),
      ...(fresh ? { fresh: true } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`提问失败（${res.status}）${detail.slice(0, 120)}`);
  }
  return res.json();
}
