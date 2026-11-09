/**
 * 页面到后端的**唯一**出口。
 *
 * 两个前缀并存，各有各的来路，这里写清楚免得后来人误改：
 *
 *   - `/paper-reader/*` —— **上游**的 24 条路由（文献库、PDF、转录、整篇翻译、
 *     会话、SSE）。兼容层原样复用，不反代，所以页面直接按上游的地址打。
 *   - `/zhiyun-paper/*` —— **本包自有**的两条路由（选中翻译、挂载状态）。
 *
 * 上游的客户端插件（它的 `lib/client.js`）我们刻意不引入：它会抢
 * `sidebar.workspaces`、注册自己的 `shell.overlay` 与设置分组，与智云 Pro 的外壳
 * 是两套布局主张。所以本文件里的每一个调用**都是照上游 host 的真实契约写的**，
 * 锁版的意义就在这里：契约一旦变，这些函数就是唯一需要核对的地方。
 */

export const UPSTREAM_PREFIX = '/paper-reader';

/** 与宿主侧 `routes.js` 的常量必须一致。 */
export const PAPER_PREFIX = '/zhiyun-paper';

/** 判页眉标题用；上游 reader HTML 的标题是「论文伴读」。 */
export const PRODUCT_LABEL = '论文阅读';

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    // 上游的错误体有两种形状：`{error}`（参数/权限）与 `{reason}`（翻译未启动）。
    // 这里统一成同一个 Error，并把上游的机器可读 `code` 原样带上。
    const message = body?.error ?? body?.reason ?? `HTTP ${response.status}`;
    const error = new Error(message);
    error.code = body?.code ?? null;
    error.status = response.status;
    throw error;
  }
  return body;
}

const postJson = (url, payload) => requestJson(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

/* ── 上游：文献库 ─────────────────────────────────────────────────────── */

/** `{ dataDir, topics: string[], papers: {topic,name,pdfPath}[] }` */
export const loadLibrary = () => requestJson(`${UPSTREAM_PREFIX}/api/library`);

/** `{ hasTranscript, pageCount, pdfPath, chars, hasPageIndex, pdfBytes, topic, name }` */
export const loadPaper = (topic, name) =>
  requestJson(`${UPSTREAM_PREFIX}/api/paper?topic=${encodeURIComponent(topic)}&name=${encodeURIComponent(name)}`);

/** 上传走 raw body + `x-dpr-*` 头（header 只允许 Latin-1，中文必须 encodeURIComponent）。 */
export async function uploadPaper({ topic, name, bytes }) {
  const response = await fetch(`${UPSTREAM_PREFIX}/api/library/upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/pdf',
      'x-dpr-topic': encodeURIComponent(topic),
      'x-dpr-name': encodeURIComponent(name),
    },
    body: bytes,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error ?? `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

export const createTopic = (name) => postJson(`${UPSTREAM_PREFIX}/api/library/topic`, { name });

/** PDF 的直链（供 iframe 使用）。`variant` 为 `'zh'` / `'dual'` 时给出译文版本。 */
export function pdfUrl(topic, name, variant) {
  const query = `topic=${encodeURIComponent(topic)}&name=${encodeURIComponent(name)}`
    + (variant ? `&variant=${encodeURIComponent(variant)}` : '');
  return `${UPSTREAM_PREFIX}/api/pdf?${query}`;
}

/** 阅读器页面的地址。**必须带 `topic`/`name`**：不然它会回落到上次打开的那篇。 */
export function readerUrl(topic, name, { page, q } = {}) {
  const query = new URLSearchParams({ topic, name });
  if (page) query.set('page', String(page));
  if (q) query.set('q', q);
  return `${UPSTREAM_PREFIX}/?${query.toString()}`;
}

/* ── 上游：翻译与转录 ─────────────────────────────────────────────────── */

/** `{ zh, dual, busy }`（上游只有这三个字段，没有 progress）。 */
export const loadTranslateState = (topic, name) =>
  requestJson(`${UPSTREAM_PREFIX}/api/zh?topic=${encodeURIComponent(topic)}&name=${encodeURIComponent(name)}`);

export const generateTranslation = (topic, name, force = false) =>
  postJson(`${UPSTREAM_PREFIX}/api/zh/generate`, { topic, name, ...(force ? { force: true } : {}) });

export const transcribePaper = (topic, name) =>
  postJson(`${UPSTREAM_PREFIX}/api/transcribe`, { topic, name });

/* ── 上游：设置（端点配置：GET 掩码回显 / POST 预检后落盘 / DELETE 回落）──── */

export const loadTranslateConfig = () => requestJson(`${UPSTREAM_PREFIX}/api/translate/config`);
export const saveTranslateConfig = (form) => postJson(`${UPSTREAM_PREFIX}/api/translate/config`, form);
export const clearTranslateConfig = () => requestJson(`${UPSTREAM_PREFIX}/api/translate/config`, { method: 'DELETE' });

export const loadRerankConfig = () => requestJson(`${UPSTREAM_PREFIX}/api/typesafe/config`);
export const saveRerankConfig = (form) => postJson(`${UPSTREAM_PREFIX}/api/typesafe/config`, form);
export const clearRerankConfig = () => requestJson(`${UPSTREAM_PREFIX}/api/typesafe/config`, { method: 'DELETE' });

/* ── 上游：会话与问答 ─────────────────────────────────────────────────── */

/** `{ sessions: {...}[], latest: number }` */
export const listSessions = (topic, name) =>
  requestJson(`${UPSTREAM_PREFIX}/api/sessions?topic=${encodeURIComponent(topic)}&name=${encodeURIComponent(name)}`);

export const newSession = (topic, name) => postJson(`${UPSTREAM_PREFIX}/api/sessions/new`, { topic, name });

export const archiveSession = (topic, name, sessionId) =>
  postJson(`${UPSTREAM_PREFIX}/api/sessions/archive`, { topic, name, sessionId });

/**
 * 提问。`n` 省略时上游会复用/新建当前会话；`fresh: true` 强制开一个新会话。
 * 返回 `{ ok: true, sessionId, n }`。
 */
export const ask = ({ topic, name, question, selectedText, page, n, fresh }) =>
  postJson(`${UPSTREAM_PREFIX}/api/ask`, {
    topic,
    name,
    question,
    ...(selectedText ? { selectedText, page } : {}),
    ...(n ? { n } : {}),
    ...(fresh ? { fresh: true } : {}),
  });

/** SSE 地址。`n` 省略时上游取该文献最新的那个会话。 */
export function followUrl(topic, name, n) {
  const query = new URLSearchParams({ topic, name });
  if (n) query.set('n', String(n));
  return `${UPSTREAM_PREFIX}/api/session/follow?${query.toString()}`;
}

/* ── 本包自有 ─────────────────────────────────────────────────────────── */

/** `{ prefix, upstream: {installed, expected, mounted, error}, translate: {available, stats} }` */
export const loadStatus = () => requestJson(`${PAPER_PREFIX}/api/status`);

/** 选中即译。`{ translation, model, cached, truncated }`。 */
export const translateSelection = (text, signal) =>
  requestJson(`${PAPER_PREFIX}/api/translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
    signal,
  });

/**
 * `/resume` 面板的标签材料：按会话 id 取 `{ sessionId, title, firstQuestion }[]`。
 *
 * 上游 `/paper-reader/api/sessions` 只给编号，认不出「哪条是我当时在问什么」，
 * 所以标签要在本包自己的路由上补（首句取法见宿主半边 `session-admin.js`）。
 */
export const loadSessionLabels = (sessionIds, signal) =>
  requestJson(`${PAPER_PREFIX}/api/sessions/labels`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionIds }),
    signal,
  });

/**
 * 归档一个会话（面板上按 Delete 的「删除」）。走本包路由而不是上游那条：
 * 上游只允许归档**空白**会话，有内容的一律 409。
 */
export const archiveSessionById = (sessionId) =>
  postJson(`${PAPER_PREFIX}/api/sessions/archive`, { sessionId });
