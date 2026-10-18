/**
 * 规划页的**宿主半边**：四个数据源的聚合。
 *
 * # 这一页的数据模型
 *
 * 规划页不是"读一个来源"，是把**四份东西并到一张表**：
 *
 * ```text
 *   学在浙大待办   ← omni xzzd.todos      （与智云共用 CAS 账号，配置在别处）
 *   拼题A 待办     ← omni pta.problemSets （Cookie，需在本页单独配置）
 *   中转站条目     ← 用户自己的创空间      （域名 + 读密钥）
 *   本地留存       ← 本文件维护           （中转站之上的一层缓存）
 * ```
 *
 * **本地留存是这一页的真源**，中转站只是它的同步来源。理由写在 `LocalStore` 上：
 * 中转站跑在魔搭创空间上，稳定性弱、转移或重命名空间就会丢数据 —— 页面不能因此
 * 变空。所以每次成功从中转站读到东西，先按「前缀」比对，只把新的落进本地；
 * 页面读的是"本地已有 ∪ 本地没有的中转站新增"。
 *
 * # 两类待办为什么分别报错
 *
 * 学在浙大缺的是 **CAS 账号**（与智云共用，配一次即可）；拼题A 缺的是 **Cookie**
 * （短信验证，只能手动导入）。混成一句"待办读取失败"，用户不知道该去哪配。
 */

import path from 'node:path';
import { DEDUPE_PREFIX, entryPrefix } from './entries.js';
import {
  PlanStore, PLAN_PROMPT, pickPending, planError, readPlanResponse, toPlanInput,
} from './plans.js';

// 重新导出：既有调用方与测试按这个包名导入它们
export { DEDUPE_PREFIX, entryPrefix };
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';

export const name = 'zhiyun-planning';

/** 只硬依赖 `profileContext`（数据目录）。其它宿主服务走 `ctx.inject` / `ctx.get`。 */
export const inject = ['profileContext'];

/** 本包自有路由前缀。用 `/_dsh/` 与宿主其它设置路由保持一致。 */
export const ROUTE_PATH = '/_dsh/zhiyun-planning';

/** 写操作必须带的自定义头。 */
export const WRITE_HEADER = 'x-zhiyun-planning';

/** 回显密钥时的打码值。页面回传它表示"不改"。 */
const MASK = '********';

/** 单次拉取的超时。中转站冷启动要几秒。 */
const FETCH_TIMEOUT_MS = 15000;

/** 一次拉取最多取回的条目数。 */
const MAX_ENTRIES = 2000;


/* ══════════════════════════════════════════════════════════ 中转站传输层 */

/**
 * 中转站入口是用户自己填的任意域名，必须当成不可信输入。
 *
 * @param raw - 用户填的域名。
 * @returns 规整后的 `origin`，或 null 表示不合法。
 */
export function normalizeEndpoint(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.origin;
}

/**
 * 读密钥的最小校验。
 *
 * @param raw - 用户填的密钥。
 * @returns 去掉首尾空白后的密钥，或 null 表示不合法。
 */
export function normalizeKey(raw) {
  const value = String(raw ?? '').trim();
  if (value.length < 8) return null;
  if (/\s/.test(value)) return null;
  return value;
}

/**
 * 从中转站拉全部条目。
 *
 * @param config - `{ endpoint, readKey }`。
 * @param fetchImpl - 注入 `fetch`，测试用。
 * @returns `{ ok: true, entries }` 或 `{ ok: false, code, message }`。
 */
export async function pullEntries(config, fetchImpl = fetch) {
  if (!config.endpoint) return { ok: false, code: 'NOT_CONFIGURED', message: '还没有配置中转站域名' };
  if (!config.readKey) return { ok: false, code: 'NOT_CONFIGURED', message: '还没有配置读密钥' };

  const url = `${config.endpoint.replace(/\/+$/, '')}/entries`;
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        // 中转站占用 `X-Zy-Read-Key`；**不能**用 `Authorization`，那是魔搭平台占用的头
        'X-Zy-Read-Key': config.readKey,
        Accept: 'application/json',
        // .ms.show 的 WAF 会对非浏览器 UA 直接断连
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
          + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? '请求超时' : (error?.cause?.code ?? error?.message ?? '无法连接');
    return { ok: false, code: 'UNREACHABLE', message: `连不上中转站：${reason}` };
  }

  // 中转站对未授权一律回 404（不暴露"这里有入口"），所以 404 与 401 同义
  if (response.status === 401 || response.status === 403 || response.status === 404) {
    return {
      ok: false,
      code: 'KEY_REJECTED',
      message: `读密钥被拒绝（HTTP ${response.status}）。密钥不对，或这个域名上跑的不是中转站`,
    };
  }
  if (!response.ok) {
    return { ok: false, code: 'UPSTREAM', message: `中转站返回 HTTP ${response.status}` };
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    return {
      ok: false,
      code: 'BAD_PAYLOAD',
      message: '中转站返回的不是 JSON。确认这个域名指向的是中转站（它的 /health 应返回 {"ok":true}）',
    };
  }
  const entries = Array.isArray(payload?.entries) ? payload.entries : null;
  if (entries === null) {
    return { ok: false, code: 'BAD_PAYLOAD', message: '中转站返回的 JSON 里没有 entries 数组' };
  }

  return { ok: true, entries: entries.slice(0, MAX_ENTRIES), total: payload?.total ?? entries.length };
}

/* ══════════════════════════════════════════════════════════ 本地留存 */


/**
 * 把中转站的条目并进本地，返回"这次新增了哪些"。
 *
 * **只增不改**：中转站已有的条目一旦进过本地，后续比对就跳过 —— 这样页面在
 * 中转站宕掉/清空后仍能显示历史，不会被一次空响应抹掉。
 *
 * @param local - 本地已存的条目数组（会被就地修改并返回）。
 * @param incoming - 这次从中转站读到的条目。
 * @returns `{ added, skipped }`。
 */
export function mergeIncoming(local, incoming) {
  const seen = new Set(local.map((row) => row.prefix ?? entryPrefix(row)));
  const added = [];
  for (const entry of incoming) {
    const prefix = entryPrefix(entry);
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    // 存**完整条目**：页面要用正文，用户也可能离线查看。`prefix` 与 `cachedAt`
    // 只为了下次比对与显示"什么时候存下来的"，不属于中转站协议。
    const row = {
      seq: entry.seq,
      kind: entry.kind,
      title: entry.title,
      text: entry.text,
      tags: Array.isArray(entry.tags) ? entry.tags : [],
      at: entry.at,
      prefix,
      cachedAt: Math.floor(Date.now() / 1000),
    };
    local.push(row);
    added.push(row);
  }
  return { added, skipped: incoming.length - added.length };
}

/**
 * 本地留存的持久化。
 *
 * 为什么要有它：中转站跑在魔搭创空间上，**转移或重命名空间就会丢数据**，
 * 重启也可能丢。页面不能因为对方丢数据就变空 —— 那是"替我忘了"，不是能力。
 */
export class LocalStore {
  constructor(file) {
    this.file = file;
    this.entries = [];
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    } catch {
      // 文件不存在 / 坏了都退回空表：这份缓存只影响本页展示，不该让插件起不来
      this.entries = [];
    }
    return this.entries;
  }

  /** 落盘。先写临时文件再 rename，断电不会留下半个 JSON。 */
  save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ entries: this.entries }, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.file);
  }

  /** 合并一批中转站条目并立即落盘，返回本轮新增。 */
  absorb(incoming) {
    const result = mergeIncoming(this.entries, incoming);
    if (result.added.length > 0) this.save();
    return result;
  }

  /** 按时间正序返回（页面自行分组）。 */
  list() {
    return [...this.entries].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
  }
}

/* ══════════════════════════════════════════════════════════ 待办聚合 */

/**
 * 学在浙大待办 → 页面统一形状。
 *
 * 上游返回 `{ id, title, type, deadline: {iso, text}, course_name, url }`。
 * 这里只做字段改名与缺失兜底，**不改语义**。
 *
 * @param payload - `xzzd.todos()` 的返回值。
 * @returns 统一形状的待办数组。
 */
export function normalizeXzzdTodos(payload) {
  const rows = Array.isArray(payload?.todos) ? payload.todos : [];
  return rows.map((row) => ({
    source: 'xzzd',
    sourceLabel: '学在浙大',
    id: String(row.id ?? ''),
    title: String(row.title ?? '').trim() || '未命名待办',
    detail: row.course_name ? String(row.course_name) : '',
    due: row.deadline?.iso ?? null,
    dueText: row.deadline?.text ?? null,
    url: row.url ?? null,
    kind: 'todo',
  }));
}

/**
 * 拼题A 题集 → 页面统一形状。
 *
 * 拼题A 没有"待办"这个概念，最近要处理的是**未结束的题集**。用它们的截止时间
 * 当待办，并如实标明来源是题集而不是作业 —— 两者的动作不一样
 * （一个是"去做题"，一个是"去交作业"）。
 *
 * @param payload - `pta.problemSets({active_only:true})` 的返回值。
 * @returns 统一形状的待办数组。
 */
export function normalizePtaSets(payload) {
  const rows = Array.isArray(payload?.problem_sets) ? payload.problem_sets : [];
  return rows.map((row, index) => ({
    source: 'pta',
    sourceLabel: '拼题A',
    id: String(row.id ?? index),
    title: String(row.name ?? row.title ?? '').trim() || '未命名题集',
    detail: row.ended ? '已结束' : '未结束',
    due: row.ends_at?.iso ?? null,
    dueText: row.ends_at?.text ?? null,
    url: row.url ?? null,
    kind: 'problemSet',
  }));
}

/** 待办的紧迫度分组：先看什么，由"还剩多久"决定，不是"哪天真"。 */
export const URGENCY = {
  overdue: 'overdue',
  today: 'today',
  week: 'week',
  later: 'later',
  none: 'none',
};

/**
 * 判紧迫度。
 *
 * @param due - ISO 时间串或 null。
 * @param now - 当前毫秒时间戳（注入以便测试）。
 * @returns `overdue` / `today`（24h 内）/ `week`（7 天内）/ `later` / `none`。
 */
export function urgencyOf(due, now = Date.now()) {
  if (!due) return URGENCY.none;
  const at = Date.parse(due);
  if (Number.isNaN(at)) return URGENCY.none;
  if (at < now) return URGENCY.overdue;
  if (at - now <= 24 * 3600 * 1000) return URGENCY.today;
  if (at - now <= 7 * 24 * 3600 * 1000) return URGENCY.week;
  return URGENCY.later;
}

/* ══════════════════════════════════════════════════════════ 配置读写 */

/**
 * 读配置。文件损坏/缺失一律退回"未配置"，不抛错。
 *
 * @param file - 配置文件路径。
 * @returns `{ endpoint, readKey }`。
 */
export function loadConfig(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return {
      endpoint: typeof parsed?.endpoint === 'string' ? parsed.endpoint : '',
      readKey: typeof parsed?.readKey === 'string' ? parsed.readKey : '',
    };
  } catch {
    return { endpoint: '', readKey: '' };
  }
}

/**
 * 落盘配置。
 *
 * @param file - 配置文件路径。
 * @param config - `{ endpoint, readKey }`。
 */
export function saveConfig(file, config) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
  return config;
}

/**
 * 交给页面的配置视图：密钥打码。
 *
 * @param config - 真实配置。
 * @returns `{ endpoint, readKey, configured }`。
 */
export function mask(config) {
  return {
    endpoint: config.endpoint,
    readKey: config.readKey ? MASK : '',
    configured: Boolean(config.endpoint && config.readKey),
  };
}

/* ══════════════════════════════════════════════════════════ 路由 */

/** 只接受回环 Host，防 DNS rebinding。 */
function hostOf(header) {
  const value = String(header ?? '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    return close === -1 ? value : value.slice(1, close);
  }
  const colon = value.lastIndexOf(':');
  if (colon !== -1 && value.indexOf(':') === colon && /^\d+$/.test(value.slice(colon + 1))) {
    return value.slice(0, colon);
  }
  return value;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req, limit = 32 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * 路由处理函数。
 *
 * 动作：
 *   GET  ?          读一切（配置 + 本地 + 中转站增量 + 两类待办 + PTA 状态）
 *   POST ?save      存域名与读密钥，然后立刻同步一次
 *   POST ?refresh   重新同步中转站 + 待办
 *   POST ?pta       存拼题A Cookie
 *
 * @param options - `{ getConfig, saveConfig, store, fetchRemote, loadTodos, savePtaCookie, ptaStatus }`。
 */
export function createHandler({
  getConfig, saveConfig: save, store, fetchRemote, loadTodos, savePtaCookie, ptaStatus, plan,
}) {
  /** 同步中转站：拉取 → 合并进本地 → 回新增条数。失败不抛，只带回错误。 */
  const sync = async () => {
    const config = getConfig();
    if (!config.endpoint || !config.readKey) {
      return { synced: false, added: 0, error: null };
    }
    const pulled = await fetchRemote(config);
    if (!pulled.ok) return { synced: false, added: 0, error: { code: pulled.code, message: pulled.message } };
    const { added } = store.absorb(pulled.entries);
    return { synced: true, added: added.length, total: pulled.total ?? pulled.entries.length, error: null };
  };

  /** 组装页面需要的一切。待办失败不拖垮整页 —— 它们各自带 error。 */
  const snapshot = async () => ({
    config: mask(getConfig()),
    entries: store.list(),
    remote: await sync(),
    todos: await loadTodos(),
    pta: ptaStatus ? await ptaStatus() : { configured: false },
    // 规划结果与映射：页面据此标"已拆过"并展示卡片
    plans: plan ? plan.list() : {},
    // 哪些源条目已拆过 —— 页面用 entryPrefix 对齐，两端口径必须一致
    planned: plan ? plan.plannedKeys() : [],
  });

  return async function handler(req, res) {
    const host = hostOf(req.headers.host);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      sendJson(res, 403, { error: '只接受回环访问' });
      return;
    }

    const action = String(req.url ?? '').split('?')[1] ?? '';

    if (req.method === 'GET') {
      sendJson(res, 200, await snapshot());
      return;
    }

    if (req.method !== 'POST') {
      sendJson(res, 405, { error: '只支持 GET / POST' });
      return;
    }

    if (String(req.headers[WRITE_HEADER] ?? '') !== '1') {
      sendJson(res, 403, { error: `缺少 ${WRITE_HEADER} 头` });
      return;
    }

    const body = await readJsonBody(req);

    // ── 拼题A Cookie：与域名同一条路由，但各存各的 ──────────────────
    if (action === 'pta') {
      const raw = typeof body?.cookie === 'string' ? body.cookie.trim() : '';
      if (!raw) {
        sendJson(res, 400, { error: '请粘贴 pintia.cn 的 Cookie 或 cURL' });
        return;
      }
      try {
        const result = await savePtaCookie(raw);
        sendJson(res, 200, { ok: true, cookie: result, pta: await ptaStatus() });
      } catch (error) {
        sendJson(res, 400, { error: String(error?.message ?? error) });
      }
      return;
    }

    if (action === 'refresh') {
      sendJson(res, 200, await snapshot());
      return;
    }

    // ── AI 自动规划：把混杂的中转站条目拆成卡片 ────────────────────────
    // 花钱的操作，所以：默认只拆"没拆过的"，重拆必须显式传 force。
    if (action === 'plan' || action === 'plan-force') {
      if (!plan) {
        sendJson(res, 400, { error: 'AI 规划未启用（缺少模型服务）' });
        return;
      }
      try {
        const result = await plan.run({ force: action === 'plan-force' });
        sendJson(res, 200, { ok: true, ...result, ...(await snapshot()) });
      } catch (error) {
        sendJson(res, error?.code === 'NO_PENDING' ? 200 : 400, {
          ok: false,
          error: { code: error?.code ?? 'PLAN_FAILED', message: String(error?.message ?? error) },
          ...(error?.code === 'NO_PENDING' ? await snapshot() : {}),
        });
      }
      return;
    }

    // 忘掉某一条的拆分结果（配合 force 用；也可单独调用）
    if (action === 'plan-forget') {
      if (!plan) {
        sendJson(res, 400, { error: 'AI 规划未启用' });
        return;
      }
      const prefix = typeof body?.prefix === 'string' ? body.prefix : '';
      if (!prefix) {
        sendJson(res, 400, { error: '缺少 prefix' });
        return;
      }
      plan.forget(prefix);
      sendJson(res, 200, { ok: true, ...(await snapshot()) });
      return;
    }

    if (action !== 'save') {
      sendJson(res, 400, { error: `未知动作 ${action || '(空)'}` });
      return;
    }

    if (!body) {
      sendJson(res, 400, { error: '请求体不是合法 JSON' });
      return;
    }

    const current = getConfig();
    const endpoint = normalizeEndpoint(body.endpoint);
    if (endpoint === null) {
      sendJson(res, 400, { error: '域名要写成 https://xxx.ms.show 这种形式（只支持 http/https）' });
      return;
    }

    let readKey;
    if (body.readKey === undefined || body.readKey === MASK) {
      readKey = current.readKey;
    } else {
      readKey = normalizeKey(body.readKey);
      if (readKey === null) {
        sendJson(res, 400, { error: '读密钥至少 8 个字符，且不能包含空白' });
        return;
      }
    }

    save({ endpoint, readKey });
    sendJson(res, 200, await snapshot());
  };
}

/* ══════════════════════════════════════════════════════════ 装配 */

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-planning] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };

  const dataDir = config.dataDir ?? path.join(ctx.profileContext.dir, 'data', 'zhiyun-planning');
  const configFile = config.dataFile ?? path.join(dataDir, 'config.json');
  const cacheFile = config.cacheFile ?? path.join(dataDir, 'entries.json');

  let current = loadConfig(configFile);
  const store = new LocalStore(cacheFile);

  /* ── AI 自动规划 ─────────────────────────────────────────────────── */

  const plansFile = config.plansFile ?? path.join(dataDir, 'plans.json');
  const plans = new PlanStore(
    plansFile,
    (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } },
    (file, value) => {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      renameSync(tmp, file);
    },
  );

  /**
   * 取窄 llm 接口。
   *
   * 本仓铁律：AI 调用一律走 `ctx.zhiyunParser.llm`（`{ call, resolve }`），
   * 不直接碰宿主的 `ctx.llm`（它只有 prepareCall/stream，适配已由解析器包做过一遍）。
   * **惰性取**：解析器晚于本包就绪是常态，apply 时缓存 null 会永久失效。
   */
  const llmOf = () => {
    const parser = ctx.get('zhiyunParser');
    const llm = config.llm ?? parser?.llm ?? null;
    return llm && typeof llm.call === 'function' ? llm : null;
  };

  /**
   * 跑一次自动规划。
   *
   * 只处理**中转站条目**：学在浙大/拼题A 的待办已经有结构化截止时间与来源链接，
   * 再让模型拆一遍是拿准确数据换猜测。
   */
  const runPlan = async ({ force = false, signal } = {}) => {
    const llm = llmOf();
    if (!llm) throw planError('NO_LLM', '还没有可用的模型：请先在设置里配置 AI 服务');

    const entries = store.list();
    const pending = pickPending(entries, plans, { force });
    if (pending.length === 0) {
      throw planError('NO_PENDING', entries.length === 0
        ? '还没有中转站内容可规划：先往中转站推几条，再回来点这个按钮'
        : '所有条目都已经规划过了。要重新拆，请用「重新规划」');
    }

    // route 必须先解析：call() 需要 { provider, model }
    let route;
    try {
      route = typeof llm.resolve === 'function' ? await llm.resolve(signal) : null;
      route = route?.text ?? route?.vision ?? route;
    } catch (error) {
      throw planError('NO_LLM', `解析模型失败：${error?.message ?? error}`);
    }

    const variable = JSON.stringify(toPlanInput(pending), null, 2);
    let response;
    try {
      response = await llm.call({
        stage: 'plan',
        route,
        constant: PLAN_PROMPT,
        variable,
        signal,
      });
    } catch (error) {
      throw planError(error?.code ?? 'LLM_FAILED', `模型调用失败：${error?.message ?? error}`);
    }

    const text = typeof response?.text === 'string' ? response.text : '';
    const { cards, dropped } = readPlanResponse(text);

    // 结果按**源条目前缀**归属。一张卡属于哪条原文，用 sourceTitle 对回去；
    // 对不上时按"全部归到本批第一条"处理会掩盖问题，所以对不上的卡**单独记在
    // 本批"未归属"里**，页面能看见，而不是悄悄混进某一条。
    const byTitle = new Map();
    for (const entry of pending) {
      byTitle.set(String(entry.title ?? '').trim(), entryPrefix(entry));
    }
    const grouped = new Map(); // prefix -> cards[]
    const orphans = [];
    for (const card of cards) {
      const prefix = byTitle.get(String(card.sourceTitle ?? '').trim());
      if (!prefix) { orphans.push(card); continue; }
      if (!grouped.has(prefix)) grouped.set(prefix, []);
      grouped.get(prefix).push(card);
    }

    // 本批里一张卡都没分到（模型没填 sourceTitle）时，退化为"本批合在一起",
    // 挂在**最新那条**上并如实说明 —— 丢掉整批比归错地方更糟。
    if (grouped.size === 0 && cards.length > 0) {
      const newest = pending[0];
      grouped.set(entryPrefix(newest), cards);
      orphans.length = 0;
    }

    const model = route?.model ?? null;
    let total = 0;
    for (const [prefix, list] of grouped) {
      plans.record(prefix, list, { model });
      total += list.length;
    }

    log(`自动规划：${pending.length} 条原文 → ${total} 张卡片（丢弃 ${dropped} 张不合规）`);
    return {
      planned: grouped.size,
      created: total,
      dropped,
      orphans: orphans.length,
      model,
    };
  };

  const planService = {
    run: runPlan,
    list: () => plans.all(),
    plannedKeys: () => Object.keys(plans.all()),
    forget: (prefix) => plans.forget(prefix),
    recentRuns: () => plans.recentRuns(),
    file: plansFile,
  };

  /**
   * 两类待办。
   *
   * 学在浙大与拼题A 都从 `zhiyunOmni` 取 —— 但**它们失败的原因不同**，所以要分别
   * 带回错误：学在浙大缺的是 CAS 账号（和智云共用，配一次即可），拼题A 缺的是 Cookie
   * （需要在本页单独粘贴）。混成一句"待办读取失败"，用户不知道该去哪配。
   */
  const loadTodos = async () => {
    const omni = ctx.get('zhiyunOmni');
    const result = {
      xzzd: { ok: false, rows: [], error: null },
      pta: { ok: false, rows: [], error: null },
    };
    if (!omni) {
      const why = { code: 'OMNI_UNAVAILABLE', message: '校园数据包（dsh-zhiyun-omni）未启用' };
      result.xzzd.error = why;
      result.pta.error = why;
      return result;
    }

    // 学在浙大：先用桥接把「已登录的课堂会话」变成 omni 的会话，再读。
    // 这一步是**每次读之前都试**（桥接内部会跳过已存在的），因为用户可能刚刚
    // 在「个人」页登录过 —— 那时 omni 还没有会话，而页面已经能用了。

    try {
      result.xzzd = { ok: true, rows: normalizeXzzdTodos(await omni.invoke('xzzd.todos', {})), error: null };
    } catch (error) {
      result.xzzd = {
        ok: false,
        rows: [],
        error: describeXzzdError(error),
      };
    }

    return await finishPta(result);
  };

  /**
   * 学在浙大读不到时，把原因翻译成**用户能照做的一句**。
   *
   * 凭据已经集中在宿主（`dsh-zhiyun-classroom` 登录时写入，`dsh-zhiyun-omni` 读取），
   * 所以这里**不再出现"去终端配账号"** —— 那是在两个包各自存凭据时才有的事。
   * 现在只可能是：没登录过、会话过期、或账号在但会话要重建。
   */
  const describeXzzdError = (error) => {
    const code = error?.code ?? 'XZZD_FAILED';
    if (code === 'CONFIGURATION_REQUIRED' || code === 'LOGIN_REQUIRED') {
      return {
        code: 'NEED_LOGIN',
        message: '还没登录过浙大账号：在「个人」页点「连接课堂」登录一次，学在浙大待办就会出现在这里。',
      };
    }
    if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTH_CHALLENGE_REQUIRED') {
      return {
        code: 'NEED_LOGIN',
        message: '浙大登录态已过期：在「个人」页重新登录一次课堂即可。',
      };
    }
    return { code, message: String(error?.message ?? error) };
  };

  /** 拼题A 单独读：它的失败原因与学在浙大不同（缺 Cookie，不是缺账号）。 */
  const finishPta = async (result) => {
    const omni = ctx.get('zhiyunOmni');
    try {
      const sets = await omni.invoke('pta.problemSets', { active_only: true, max_sets: 20 });
      result.pta = { ok: true, rows: normalizePtaSets(sets), error: null };
    } catch (error) {
      result.pta = {
        ok: false,
        rows: [],
        error: { code: error?.code ?? 'PTA_FAILED', message: String(error?.message ?? error) },
      };
    }
    return result;
  };


  /** 拼题A 是否已配 Cookie（只回键名，不回值）。 */
  const ptaStatus = async () => {
    const omni = ctx.get('zhiyunOmni');
    if (!omni) return { configured: false, error: '校园数据包未启用' };
    if (typeof omni.pta !== 'function') return { configured: false, error: '数据包版本过旧（缺 pta 能力）' };
    try {
      const status = await omni.pta('status');
      return { configured: Boolean(status?.configured), source: status?.source ?? null, names: status?.cookie_names ?? [] };
    } catch (error) {
      return { configured: false, error: String(error?.message ?? error) };
    }
  };

  /** 存拼题A Cookie。走 `omni.pta('importCookie')`，由数据包做格式识别与落盘。 */
  const savePtaCookie = async (raw) => {
    const omni = ctx.get('zhiyunOmni');
    if (!omni) throw new Error('校园数据包（dsh-zhiyun-omni）未启用，无法保存拼题A Cookie');
    if (typeof omni.pta !== 'function') throw new Error('数据包版本过旧（缺 pta 能力）');
    const result = await omni.pta('importCookie', { input: raw });
    log(`拼题A Cookie 已保存（来源：${result?.source ?? '未知'}，${result?.cookie_names?.length ?? 0} 个键）`);
    return result;
  };

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = createHandler({
        getConfig: () => current,
        saveConfig: (next) => { current = saveConfig(configFile, next); return current; },
        store,
        fetchRemote: (cfg) => pullEntries(cfg, config.fetch ?? fetch),
        loadTodos,
        savePtaCookie,
        ptaStatus,
        plan: planService,
      });
      const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler });
      log(`设置路由：${ROUTE_PATH}（本地留存 ${cacheFile}）`);
      return dispose;
    }, 'zhiyun: planning settings route');
  });

  const removeService = ctx.provide('zhiyunPlanning', {
    routePath: ROUTE_PATH,
    configFile,
    cacheFile,
    config: () => current,
    entries: () => store.list(),
    plans: planService,
    pull: () => pullEntries(current, config.fetch ?? fetch),
    todos: loadTodos,
  });

  return async () => {
    if (typeof removeService === 'function') removeService();
  };
}
