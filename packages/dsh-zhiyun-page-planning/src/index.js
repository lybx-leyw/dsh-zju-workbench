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
import {
  DEDUPE_PREFIX, LEGACY_DEDUPE_PREFIX, entryPrefix, legacyEntryPrefix, contentDigest,
} from './entries.js';
import {
  createLocal, createSplit, localError, patchLocal, setDone as setDoneLocal,
} from './local.js';
import { TickStore, tickKey } from './ticks.js';
import { URGENCY, urgencyOf } from './time.js';
import {
  PlanStore, PLAN_PROMPT, pickPending, planError, planTitle, readPlanResponse, toPlanInput,
} from './plans.js';

// 重新导出：既有调用方与测试按这个包名导入它们
export {
  DEDUPE_PREFIX, LEGACY_DEDUPE_PREFIX, entryPrefix, legacyEntryPrefix, contentDigest,
};
export { TickStore, tickKey } from './ticks.js';
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

/**
 * 中转站内容的缓存有效期。
 *
 * 为什么是 10 分钟：中转站里的条目是"别人往里加的待办"，变化远不如自己
 * 勾选/新增频繁。而每次刷新规划页都重新拉一遍，等于把一次网络往返加到首屏。
 *
 * ⚠️ 只缓存**远端**那一份。本地新增/勾选/删除都在 `store` 里，永远即时生效
 * —— 用户自己改的东西绝不能因为缓存而看不见。
 */
export const REMOTE_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 一个只保一条的带键缓存（键变即失效）。
 *
 * 为什么不用 `sharedRead`：那个在 `dsh-zhiyun-source-campus` 里，且语义是
 * "合并并发 + 复用结果"，与这里"按 endpoint+readKey 判新鲜度"不同。
 * 这里只需要最简单的：同键且在 TTL 内 → 命中。
 *
 * @param options.ttlMs - 有效期，默认 10 分钟。
 */
function createRemoteCache({ ttlMs = REMOTE_CACHE_TTL_MS } = {}) {
  let entry = null;
  return {
    /** @returns 命中则返回缓存值，否则 null。 */
    get({ key, now = Date.now() }) {
      if (!entry || entry.key !== key || now >= entry.until) return null;
      return entry.value;
    },
    set({ key, now = Date.now() }, value) {
      entry = { key, value, until: now + ttlMs };
    },
    /** 清空（测试与"手动刷新"用）。 */
    clear() { entry = null; },
    /** 当前缓存的时间点与键，供诊断展示。 */
    peek() { return entry ? { key: entry.key, until: entry.until, ttlMs } : null; },
  };
}


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
    /** 迁移时算出的 `旧键 → 新键`，供 `PlanStore.rekey` 用（见 `migrateKeys`）。 */
    this.keyMapping = {};
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
    this.migrateKeys();
    return this.entries;
  }

  /**
   * 把**旧口径**的键就地换成新口径，并收集 `旧键 → 新键`。
   *
   * 去重键从「拼起来截 40 字」换成「内容指纹」后，老 `entries.json` 里的 `prefix`
   * 仍是旧值。不迁移的后果是两条：
   *   1. 下次同步时同一批内容算出新键，与文件里的旧键对不上 → **整份内容再存一遍**；
   *   2. `plans.json` 的映射键也是旧值 → **所有条目被重新拆一遍**（真花钱）。
   *
   * 判断依据不靠版本号，靠**当前内容算出来的键是否等于存下来的键** ——
   * 这样对"已经迁移过"的文件是幂等的（算出相同就不动），也不用在文件里加字段。
   *
   * @returns 实际改了几条。
   */
  migrateKeys() {
    let changed = 0;
    for (const row of this.entries) {
      if (!row || typeof row !== 'object') continue;
      const next = entryPrefix(row);
      const stored = typeof row.prefix === 'string' ? row.prefix : '';
      if (stored === next) continue;
      // 记住旧键指向哪 —— 哪怕旧键是空的也记（空键意味着"没存过"，不必迁移映射）
      if (stored) this.keyMapping[stored] = next;
      row.prefix = next;
      changed += 1;
    }
    if (changed > 0) this.save();
    return changed;
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

/* ══════════════════════════════════════════════════════════ 我的规划（本地） */

/**
 * 用户**在本机手写**的规划。.
 *
 * 与 `LocalStore` 的分工要说清楚：
 *   - `LocalStore`（`entries.json`）是中转站内容的**缓存**，只增不改，别人的数据；
 *   - 这里（`local.json`）是**用户自己的**规划，可增删改，是这一页真正的一等来源。
 *
 * 为什么不用 `entries.json` 那座仓库：那份是"只增不减"的，而规划必须能删、能改、
 * 能勾完成 —— 塞进去等于把两种完全不同的生命周期混在一个文件里。
 */
export class LocalPlanStore {
  /**
   * @param file - `local.json` 路径。
   * @param now - 注入当前时间（测试用）。
   */
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
    this.items = [];
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      // 逐条校验：手改坏了某一条不该让整份规划消失
      this.items = (Array.isArray(parsed?.items) ? parsed.items : []).filter(isStoredItem);
    } catch {
      // 不存在 / 坏了都退回空表：这份是用户手写的，读不了也不能让插件起不来
      this.items = [];
    }
    return this.items;
  }

  /** 落盘。先写临时文件再 rename，断电不会留下半个 JSON。 */
  save() {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ items: this.items }, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.file);
  }

  /** 全部条目（按创建时间正序；页面自己决定怎么排）。 */
  list() {
    return [...this.items].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  find(id) {
    return this.items.find((item) => item.id === id) ?? null;
  }

  /** 新建。 */
  create(input) {
    const item = createLocal(input, this.now());
    this.items.push(item);
    this.save();
    return item;
  }

  /** 修改。找不到返回 null（由调用方转成 404）。 */
  update(id, patch) {
    const current = this.find(id);
    if (!current) return null;
    const next = patchLocal(current, patch, this.now());
    this.items = this.items.map((item) => (item.id === id ? next : item));
    this.save();
    return next;
  }

  /** 勾选 / 取消完成。 */
  setDone(id, done) {
    const current = this.find(id);
    if (!current) return null;
    const next = setDoneLocal(current, done, this.now());
    this.items = this.items.map((item) => (item.id === id ? next : item));
    this.save();
    return next;
  }

  /** 删除。真删，不是打标记 —— 用户按的是「删掉」。 */
  remove(id) {
    const before = this.items.length;
    this.items = this.items.filter((item) => item.id !== id);
    if (this.items.length === before) return false;
    // 顺手清掉别处指向它的拆分关系，否则源条目会显示"已拆 3 条"而那 3 条都不在了。
    // 拆出来的卡也一起删：它们的存在理由就是那条原文，原文没了它们就是孤立的碎片。
    const removed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of this.items) {
        if (item.splitFrom && removed.has(item.splitFrom) && !removed.has(item.id)) {
          removed.add(item.id);
          changed = true;
        }
      }
    }
    this.items = this.items.filter((item) => !removed.has(item.id));
    for (const item of this.items) {
      if (Array.isArray(item.splitInto) && item.splitInto.some((child) => removed.has(child))) {
        item.splitInto = item.splitInto.filter((child) => !removed.has(child));
      }
    }
    this.save();
    return true;
  }

  /**
   * 把一条规划**拆成**若干条子规划。
   *
   * 拆是幂等的：已经拆过（`splitInto` 非空）的源条目默认不再拆，除非 `force`。
   * 这条规则与中转站条目那边同源 —— 拆一次要花一次模型调用，不能靠猜重复扣钱。
   *
   * @param id - 源规划 id。
   * @param cards - 已经校验过的卡片 `{ title, action, due, tags }`。
   * @param options - `{ force }` 已拆过也重拆（会先清掉旧的那批）。
   * @returns `{ source, created, removed }`；源不存在返回 null。
   */
  split(id, cards, { force = false } = {}) {
    const source = this.find(id);
    if (!source) return null;

    const previous = Array.isArray(source.splitInto) ? source.splitInto : [];
    // 不 force 且已拆过 → 什么都不做，由调用方说明"这条已经拆过了"
    if (previous.length > 0 && !force) return { source, created: [], removed: 0, skipped: true };

    // 重拆时先删掉上一批，否则同一件事会在列表里出现两遍
    if (previous.length > 0) {
      const old = new Set(previous);
      this.items = this.items.filter((item) => !old.has(item.id));
    }

    const created = [];
    for (const card of cards) {
      // `action` 是模型给的"具体动作"，落到本地规划的 `detail` 上 ——
      // 少一个字段、多一处显示逻辑，不值得为它单开一列。
      const item = createSplit({ title: card.title, detail: card.action ?? '', due: card.due ?? null }, id, this.now());
      created.push(item);
      this.items.push(item);
    }

    const fresh = this.find(id);
    fresh.splitInto = created.map((item) => item.id);
    fresh.updatedAt = Math.floor(this.now() / 1000);
    this.save();
    return { source: fresh, created, removed: previous.length, skipped: false };
  }
}

/**
 * 一条从磁盘读回的记录是否**至少形状可用**。
 *
 * 不重新跑 `normalizeLocalInput`：那是给"写入"用的，会拒掉缺字段的旧记录 ——
 * 而旧记录恰恰要尽量留住。这里只挡"完全不是一条规划"的东西。
 */
function isStoredItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (typeof item.id !== 'string' || !item.id) return false;
  if (typeof item.title !== 'string' || !item.title.trim()) return false;
  return true;
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
/* 紧迫度：实现与页面共用 `time.js`（页面才是分组标题的消费者，两边各写一份会漂）。 */

// 重新导出：既有调用方与测试按这个包名导入它们
export { URGENCY, urgencyOf };

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

/**
 * 从请求体里挑出**可写字段**，并把白名单外的键**当错误报出来**。
 *
 * ⚠️ 不能只是"挑出认识的键、忽略其余"：那样 `local-update` 带上 `done: true`
 * 会**静默变成一次改名** —— 用户以为勾了完成，页面却什么都没发生。
 * 静默丢弃一个明确表达过的意图，比直接报错更难查。
 *
 * 也不能让 `body` 原样进 store：里面的 `id` / `done` / `createdAt` 都该由服务端
 * 说了算，客户端传了就改，等于把"完成"和"改了名"混成同一个动作。
 *
 * @param body - 请求体。
 * @returns `{ title?, detail?, due? }`，只含**确实出现**的键（`patchLocal` 据此判断改哪些）。
 * @throws `INVALID_INPUT` —— 出现白名单外的键。
 */
function pickLocalInput(body) {
  const out = {};
  for (const key of ['title', 'detail', 'due']) {
    if (body[key] !== undefined) out[key] = body[key];
  }
  const extra = Object.keys(body).filter((key) => key !== 'id' && !(key in out));
  if (extra.length > 0) {
    throw localError('INVALID_INPUT', `不认识的字段：${extra.join('、')}（完成状态请用 local-done）`);
  }
  return out;
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
 *   GET  ?              读一切（配置 + 本地 + 中转站增量 + 两类待办 + 我的规划）
 *   POST ?save          存域名与读密钥，然后立刻同步一次
 *   POST ?refresh       重新同步中转站 + 待办
 *   POST ?pta           存拼题A Cookie
 *   POST ?plan          让 AI 拆"还没拆过的"（默认只拆新增）
 *   POST ?plan-force    强制重拆全部
 *   POST ?plan-forget   忘掉某条原文的拆分结果
 *   POST ?local-create  新建一条「我的规划」
 *   POST ?local-update  改一条（只改传了的字段）
 *   POST ?local-done    勾选 / 取消完成
 *   POST ?local-remove  删除一条
 *
 * @param options - `{ getConfig, saveConfig, store, local, fetchRemote, loadTodos,
 *   savePtaCookie, ptaStatus, plan }`。
 */
export function createHandler({
  getConfig, saveConfig: save, store, local, splitLocal, tickStore,
  fetchRemote, loadTodos, savePtaCookie, ptaStatus, plan,
  /** 中转站缓存有效期（测试可调小；默认 10 分钟）。 */
  remoteCacheTtlMs = REMOTE_CACHE_TTL_MS,
  /**
   * 本地快照文件。`null` = 不落盘（测试用；也用于"完全无盘环境"）。
   *
   * ⚠️ 必须可注入：这处漏过一次 —— 起初它固定走 `dataDir`，于是测试之间
   * 共享同一份 `snapshot.json`，前一个用例写下的失败态被后一个读到，
   * 表现为一堆莫名其妙的 `Cannot read properties of undefined`。
   * 「每个 handler 实例有自己的快照文件」是唯一正确的隔离方式。
   */
  snapshotFile = null,
  /** 日志出口。默认静默：`log` 是 `apply` 作用域的闭包，这里拿不到，也不该依赖它。 */
  log = () => {},
}) {
  /**
   * 中转站远端内容的缓存（10 分钟）。
   *
   * 挂在 handler 实例上而不是模块级：多个 handler（测试、多 profile）之间
   * 不该共享缓存，否则一个 handler 的配置会看到另一个的数据。
   */
  const remoteCache = createRemoteCache({ ttlMs: remoteCacheTtlMs });

  /** 同步中转站：拉取 → 合并进本地 → 回新增条数。失败不抛，只带回错误。 */
  const sync = async () => {
    const config = getConfig();
    if (!config.endpoint || !config.readKey) {
      return { synced: false, added: 0, error: null };
    }
    /**
     * 中转站内容 10 分钟内复用上次结果。
     *
     * 依据：中转站是"别人往里加的待办"，变化远不如自己勾选频繁；而每次刷新
     * 规划页都拉一遍，等于把网络延迟加到首屏上。
     *
     * 缓存键**必须含 endpoint + readKey**：换中转站或换读取口令之后拿到的
     * 是另一份数据，复用旧缓存会把 A 站的内容显示成 B 站的。
     *
     * ⚠️ 只缓存远端那一份。`store.absorb()` 每次照常跑 —— 本地新增/勾选的
     * 条目本来就在 `store` 里，不受这里影响。
     */
    const cacheKey = `${config.endpoint}\u0000${config.readKey}`;
    const cached = remoteCache.get({ key: cacheKey, now: Date.now() });
    if (cached) {
      const { added } = store.absorb(cached.entries);
      return { synced: true, added: added.length, total: cached.total, error: null, cached: true };
    }
    const pulled = await fetchRemote(config);
    if (!pulled.ok) return { synced: false, added: 0, error: { code: pulled.code, message: pulled.message } };
    remoteCache.set({ key: cacheKey, now: Date.now() }, { entries: pulled.entries, total: pulled.total ?? pulled.entries.length });
    const { added } = store.absorb(pulled.entries);
    return { synced: true, added: added.length, total: pulled.total ?? pulled.entries.length, error: null };
  };

  /**
   * 组装页面需要的一切。待办失败不拖垮整页 —— 它们各自带 error。
   *
   * ⚠️ 四条链路**必须并发**。它们彼此不依赖（中转站、学在浙大、拼题A、本地映射
   * 各走各的网络/磁盘），串起来等于把各自的首屏延迟相加。早先是逐个 `await`，
   * 实测 4.7 秒里有 1 秒纯粹是"等前面那条走完才发下一条"。
   *
   * ⚠️ **必须用 `allSettled`，不能 `all`。** 这是踩过的坑：`all` 只要有一条 reject，
   *    整个 `snapshot()` 就抛出去；宿主 Web 层捕到未处理的 handler 异常后回的是
   *    **空 body 的 400**，页面上的表现是「设置接口返回 400 / 宿主侧没起来」——
   *    而实际上宿主好好的，只是"学在浙大没登录"这种**正常状态**走到了 throw 分支。
   *    一个来源读不到，不该让整页拿不到任何数据。
   *
   * ⚠️ 这里的键名不能叫 `planned`：`?plan` 的返回值里 `planned` 是**数字**
   * （这次拆了几条原文），而它后面要展开进同一个对象（`{ ...result, ...snapshot }`）。
   * 早先两处都叫 `planned`，数组覆盖数字后页面据此判断 `planned > 0`，
   * 于是"拆出 24 张卡片"的成功结果被显示成"没有新的条目需要规划"。
   * 名字分开（`plannedKeys` 数组 / `planned` 数字）才是长久之计 ——
   * 靠展开顺序解决，改一行就会退回去。
   */
  const snapshotFresh = async () => {
    /**
     * 各段耗时（毫秒）。
     *
     * 为什么要有它：用户反馈「切回 todo 栏还是慢」，而缓存层单独测都是命中的
     * （campus 226ms → 0ms、中转站 3 次只拉 1 次）。所以慢在别处，但**没有
     * 任何观测点**能看出是哪一段 —— 只能靠猜，而猜错过两次。
     *
     * 这个字段随响应一起返回（`timing`），页面不需要显示，但 `curl` 一次就能
     * 读出真相：是三段之一慢，还是 `snapshot` 之外的路径慢。
     */
    const timing = {};
    const timed = async (label, run) => {
      const begin = Date.now();
      try { return await run(); } finally { timing[label] = Date.now() - begin; }
    };
    const beginAll = Date.now();
    const settled = await Promise.allSettled([
      timed('remote', sync),
      timed('todos', loadTodos),
      timed('pta', () => (ptaStatus ? ptaStatus() : Promise.resolve({ configured: false }))),
    ]);

    /** 某条链路炸了时，把它变成该区块自己的 error，而不是让整页失败。 */
    const valueOr = (result, onError) => {
      if (result.status === 'fulfilled') return result.value;
      const message = String(result.reason?.message ?? result.reason ?? '未知错误');
      log(`快照里有一条链路失败：${message}`);
      return onError(message);
    };

    const remote = valueOr(settled[0], (message) => ({
      synced: false, added: 0, error: { code: 'UNREACHABLE', message },
    }));
    const todos = valueOr(settled[1], (message) => ({
      xzzd: { ok: false, rows: [], error: { code: 'XZZD_FAILED', message } },
      pta: { ok: false, rows: [], error: { code: 'PTA_FAILED', message } },
    }));
    const pta = valueOr(settled[2], (message) => ({ configured: false, error: message }));

    return {
      config: mask(getConfig()),
      entries: store.list(),
      remote,
      todos,
      pta,
      /**
       * 快照各段耗时 + 总耗时。
       *
       * 页面不显示它；`curl 'http://127.0.0.1:<port>/_dsh/zhiyun-planning'` 一次
       * 就能读出「哪一段慢」。缓存是否命中也是一眼的事（命中时 `todos` 个位数）。
       */
      timing: { ...timing, total: Date.now() - beginAll, cached: { remote: remote?.cached === true } },
      // 规划结果与映射：页面据此标"已拆过"并展示卡片
      plans: plan ? plan.list() : {},
      // 哪些源条目已拆过 —— 页面用 entryPrefix 对齐，两端口径必须一致
      plannedKeys: plan ? plan.plannedKeys() : [],
      // 用户手写的规划：**本地一等来源**，不需要任何配置就能有内容
      local: local ? local.list() : [],
      // 平台待办上的本机勾选：`xzzd:123` → `{ doneAt }`。
      // 页面据此把"我已处理"的条目标掉 —— 这是**本机的标记**，不是平台的完成状态。
      ticks: tickStore ? tickStore.all() : {},
    };
  };

  /**
   * 读快照：**先给本地副本，再后台刷新**。
   *
   * # 这是本页体验的关键
   *
   * 页面上写着「中转站的内容已在本机留了一份」「你自己写的规划只存在本机」。
   * 既然数据本来就在本地，切回这一页时就不该再等网络。
   *
   * 旧实现每次 GET 都同步 `await` 三条链路。哪怕它们都有内存缓存，只要
   * **进程重启过**（dev 热重载、工作台重启）或 TTL 刚好过期，首屏就得白等 ——
   * 而且三秒级。
   *
   * 现在的行为：
   *
   *   有本地副本 → **立刻返回**（毫秒级），标 `stale: true`
   *               同时后台跑一次真实拉取，结果写回本地副本
   *   没有副本   → 只能同步等一次（首次启动），并写副本
   *
   * `?refresh` 走 `snapshotFresh()`，强制同步拉取 —— 那是"我就要最新的"。
   */
  let refreshing = null;

  /** 读本地快照；没有/坏了就 null。`snapshotFile` 为 null 时不落盘。 */
  const readSnapshot = () => {
    if (!snapshotFile) return null;
    try {
      const parsed = JSON.parse(readFileSync(snapshotFile, 'utf8'));
      return parsed && typeof parsed === 'object' && parsed.at ? parsed : null;
    } catch {
      return null;
    }
  };

  /** 写本地快照。失败只影响"下次首屏快不快"，不该冒泡。 */
  const writeSnapshot = (value) => {
    if (!snapshotFile) return;
    try {
      mkdirSync(path.dirname(snapshotFile), { recursive: true });
      const tmp = `${snapshotFile}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      renameSync(tmp, snapshotFile);
    } catch { /* 写不进去就下次再试 */ }
  };

  const snapshot = async () => {
    const cached = readSnapshot();
    if (cached) {
      // 后台刷新：不 await、失败静默（下次再来还会试），且同时只跑一个
      if (!refreshing) {
        refreshing = snapshotFresh()
          .then((fresh) => { writeSnapshot({ at: Date.now(), value: fresh }); return fresh; })
          .catch(() => null)
          .finally(() => { refreshing = null; });
      }
      /**
       * 本地副本 + 本机即时状态。
       *
       * ⚠️ `local` / `ticks` / `plans` **必须用当前值覆盖缓存里的**：
       * 它们是用户自己的操作，缓存副本可能落后。用旧值会让"刚加的一条"
       * 切页后消失 —— 那是最不能接受的一类 bug。
       */
      return {
        ...cached.value,
        local: local ? local.list() : [],
        ticks: tickStore ? tickStore.all() : {},
        plans: plan ? plan.list() : {},
        plannedKeys: plan ? plan.plannedKeys() : [],
        entries: store.list(),
        config: mask(getConfig()),
        timing: { ...(cached.value?.timing ?? {}), stale: true, snapshotAgeMs: Date.now() - cached.at },
      };
    }

    const fresh = await snapshotFresh();
    writeSnapshot({ at: Date.now(), value: fresh });
    return fresh;
  };

  const handler = async function handler(req, res) {
    const host = hostOf(req.headers.host);
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
      sendJson(res, 403, { error: '只接受回环访问' });
      return;
    }

    const action = String(req.url ?? '').split('?')[1] ?? '';

    if (req.method === 'GET') {
      // 兜一层 try：`snapshot()` 内部已经用 allSettled 收住各条链路，但万一有
      // 意料之外的抛出（比如磁盘写满时 `store.list()` 出错），也不能让宿主捕到
      // 未处理异常 —— 那样回的是**空 body 的 400**，页面只能显示"宿主侧没起来"，
      // 而这句提示会把排查引到完全错误的方向。
      try {
        sendJson(res, 200, await snapshot());
      } catch (error) {
        log(`读取快照失败：${error?.message ?? error}`);
        sendJson(res, 500, {
          error: { code: 'SNAPSHOT_FAILED', message: String(error?.message ?? error) },
        });
      }
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
      /**
       * `?refresh` = **我就要最新的**。
       *
       * 走 `snapshotFresh()` 同步拉一次（并且顺手更新本地副本），而不是
       * 走默认那条"先给本地副本"的路径 —— 否则点了刷新还看到旧数据。
       */
      const fresh = await snapshotFresh();
      writeSnapshot({ at: Date.now(), value: fresh });
      sendJson(res, 200, fresh);
      return;
    }

    /**
     * 勾掉 / 取消勾掉一条**平台待办**（学在浙大 / 拼题A）。
     *
     * ⚠️ 这是**本机的标记**，不是平台的完成状态。勾一下不会让学在浙大认为作业交过，
     * 也不会让拼题A 关闭题集 —— 它只表示「这件事我不需要再被提醒了」。
     * 页面上必须把这层意思写清楚（见 `TodoRow` 的提示），否则用户会以为勾了等于交了。
     *
     * 平台那边仍然权威：它说未提交就是未提交，本机勾选只是我自己的判断。
     */
    if (action === 'todo-done') {
      if (!tickStore) {
        sendJson(res, 400, { error: '本机勾选未启用' });
        return;
      }
      if (!body) {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
      const result = tickStore.setDone(body.source, body.id, body.done !== false);
      if (!result) {
        // 没有稳定身份就不该能勾：勾了也会在下次同步时凭空消失
        sendJson(res, 400, { error: '这条没有可用的身份（来源或 id 缺失），无法记录勾选' });
        return;
      }
      /**
       * ⚠️ **不回整份快照**。
       *
       * 勾选是**纯本端状态**：网关只传待办内容，不传状态，所以这一次写盘
       * 完成后就已经是最终结果。回整份快照意味着每次打勾都要重算并序列化
       * 几十 KB（本地副本也要读盘、算 mask、拼 todos），纯属浪费 ——
       * 而且前端拿了也用不上（它已经乐观更新过了）。
       *
       * 只回 `{ key, done }`，加上 `ticks` 里这一条的最新值，够调用方核对了。
       */
      sendJson(res, 200, {
        ok: true,
        key: result.key,
        done: result.done,
        // 只带这一个键，不是整张表：调用方拿它对账自己那一次改动即可
        ticks: result.done ? { [result.key]: tickStore.all()[result.key] ?? null } : {},
      });
      return;
    }

    // ── 「我的规划」：用户手写，可增删改 ───────────────────────────────
    // 这是这一页**唯一**的写入口。中转站仍然是只读的（写要用那边的写密钥，
    // 且那边只有 append、不能改），所以规划的编辑全都落在这几个动作上。
    if (action.startsWith('local-')) {
      if (!local) {
        sendJson(res, 400, { error: '本地规划存储未启用' });
        return;
      }
      if (!body) {
        sendJson(res, 400, { error: '请求体不是合法 JSON' });
        return;
      }
      try {
        if (action === 'local-create') {
          sendJson(res, 200, { ok: true, item: local.create(body), ...(await snapshot()) });
          return;
        }

        const id = typeof body.id === 'string' ? body.id : '';
        if (!id) {
          sendJson(res, 400, { error: '缺少 id' });
          return;
        }

        if (action === 'local-update') {
          // 只把输入字段交给 store：id/done 之类不能从这里改（那是 local-done 的职责）
          const item = local.update(id, pickLocalInput(body));
          if (!item) {
            sendJson(res, 404, { error: '这条规划不存在（可能已被删除）' });
            return;
          }
          sendJson(res, 200, { ok: true, item, ...(await snapshot()) });
          return;
        }

        if (action === 'local-done') {
          const item = local.setDone(id, body.done !== false);
          if (!item) {
            sendJson(res, 404, { error: '这条规划不存在（可能已被删除）' });
            return;
          }
          sendJson(res, 200, { ok: true, item, ...(await snapshot()) });
          return;
        }

        if (action === 'local-remove') {
          if (!local.remove(id)) {
            sendJson(res, 404, { error: '这条规划不存在（可能已被删除）' });
            return;
          }
          sendJson(res, 200, { ok: true, ...(await snapshot()) });
          return;
        }

        if (action === 'local-unsplit') {
          // 忘掉一次拆分：删掉它拆出的子项，并清空源条目的 splitInto。
          // 与 `plan-forget` 是同一件事的两条路 —— 那边按内容前缀，这边按 id。
          if (!local.find(id)) {
            sendJson(res, 404, { error: '这条规划不存在（可能已被删除）' });
            return;
          }
          local.split(id, [], { force: true });
          sendJson(res, 200, { ok: true, ...(await snapshot()) });
          return;
        }

        if (action === 'local-split' || action === 'local-split-force') {
          if (!splitLocal) {
            sendJson(res, 400, { error: 'AI 规划未启用（缺少模型服务）' });
            return;
          }
          try {
            const result = await splitLocal(id, { force: action === 'local-split-force' });
            sendJson(res, 200, { ok: true, ...result, ...(await snapshot()) });
          } catch (error) {
            const code = error?.code ?? 'PLAN_FAILED';
            sendJson(res, code === 'NO_PENDING' ? 200 : 400, {
              ok: false,
              error: { code, message: String(error?.message ?? error) },
              ...(code === 'NO_PENDING' ? await snapshot() : {}),
            });
          }
          return;
        }

        sendJson(res, 400, { error: `未知动作 ${action}` });
      } catch (error) {
        // 校验失败（INVALID_INPUT）是用户能改的，回 400 + 原话；
        // 其它是内部错误，也如实说出来而不是假装成功。
        sendJson(res, error?.code === 'INVALID_INPUT' ? 400 : 500, {
          error: { code: error?.code ?? 'LOCAL_FAILED', message: String(error?.message ?? error) },
        });
      }
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

    /**
     * 勾选 / 取消**中转站拆出的某一张卡片**。
     *
     * 卡片没有自己的 id，用 `prefix + index` 定位（前缀里含 `\0`，所以由客户端
     * 原样传回字符串，不做编码变换）。完成状态落在 `plans.json` 的
     * `cards[i].done` —— **不写回中转站**：那边只读，而且"我做完了"是本地的
     * 事实，不该变成别人存储里的一条。
     */
    if (action === 'plan-card-done') {
      if (!plan) {
        sendJson(res, 400, { error: 'AI 规划未启用' });
        return;
      }
      const prefix = typeof body?.prefix === 'string' ? body.prefix : '';
      const index = Number(body?.index);
      if (!prefix) {
        sendJson(res, 400, { error: '缺少 prefix' });
        return;
      }
      if (!Number.isInteger(index) || index < 0) {
        sendJson(res, 400, { error: 'index 必须是非负整数' });
        return;
      }
      const card = plan.setCardDone(prefix, index, body?.done !== false);
      if (!card) {
        sendJson(res, 404, { error: '这张卡片不存在（那条原文可能已被重新拆分）' });
        return;
      }
      sendJson(res, 200, { ok: true, card, ...(await snapshot()) });
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

  /**
   * 把中转站缓存挂到 handler 上。
   *
   * 用途：调用方（页面/脚本/测试）可以 `handler.remoteCache.clear()` 强制下次
   * 重新拉；也可以 `peek()` 看缓存是否命中、什么时候过期。
   * 不暴露它的话，"想立刻刷新一次"就只剩重启进程这一条路。
   */
  handler.remoteCache = remoteCache;
  return handler;
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

  // 用户手写的规划（本地一等来源，可增删改）。与 `store`（中转站内容的缓存）分开
  // 两个文件：那份只增不改，这份必须能删能改，混在一起生命周期就打架。
  const mineFile = config.localFile ?? path.join(dataDir, 'local.json');
  const mine = new LocalPlanStore(mineFile, () => Date.now());

  // 平台待办上的**本机勾选**。第三个文件，因为它是第三种生命周期：
  // 既不是别人的内容缓存，也不是用户写的条目，而是"我认为这件事不用再提醒了"。
  const ticksFile = config.ticksFile ?? path.join(dataDir, 'ticks.json');
  const ticks = new TickStore(ticksFile, () => Date.now());

  /**
   * 上次成功快照的**本地副本**。
   *
   * # 为什么必须有它（这是本页最要紧的一处）
   *
   * 页面上写着「中转站的内容已在本机留了一份」「你自己写的规划只存在本机」——
   * 既然数据本来就在本地，**切回这一页时就不该再等网络**。而之前的实现在
   * 每次 GET 里同步 `await` 三条链路（中转站 / 学在浙大 / PTA），哪怕它们
   * 全都有缓存，只要进程重启过、或缓存 TTL 刚好过期，首屏就得白等。
   *
   * 现在改成「**先给本地副本，再后台刷新**」：
   *
   *   1. 有本地副本 → 立刻返回它（毫秒级），标 `stale: true`；
   *   2. 同时（不阻塞）发起一次真实拉取，结果写回本地副本；
   *   3. 页面下次来取就能看到新的。
   *
   * 这与「10 分钟 TTL」是两层不同的东西：
   *
   *   TTL 缓存          进程内、到点就必须重新拉（阻塞）
   *   本地快照          跨进程、永远先给（不阻塞），新鲜度交给后台刷新
   *
   * `snapshotFile === null` 时完全不落盘（测试、或明确不要盘的环境）。
   * 读写实现见 `createHandler` 里的 `readSnapshot` / `writeSnapshot` —— 它们
   * 必须与 `snapshot()` 同作用域（曾因放到 `apply` 里而报 not defined）。
   */


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

  // 去重键换过口径（拼起来截 40 字 → 内容指纹）。老的一对文件里存的是旧键，
  // 不迁移的话：同一条内容算出新键对不上 → 本地重复一份 + 所有条目**重新拆一遍**
  //（AI 调用，真花钱）。迁移依据是 LocalStore 在 load 时算出的"旧键→新键"。
  const rekeyed = plans.rekey(store.keyMapping);
  if (rekeyed > 0) {
    log(`去重键迁移完成：${rekeyed} 条映射改指新键（旧口径会把长标题的正文挤出键外）`);
  }

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
    //
    // ⚠️ 键必须用 `planTitle()`（送模型的那个截断标题），不能用完整标题：
    // 标题超过 80 字的条目，模型照抄它看到的截断标题回来，用完整标题查必然落空，
    // 整批卡片会被判成 orphan。两处取标题必须同一个函数。
    const byTitle = new Map();
    for (const entry of pending) {
      byTitle.set(planTitle(entry).trim(), entryPrefix(entry));
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
    setCardDone: (prefix, index, done) => plans.setCardDone(prefix, index, done),
    recentRuns: () => plans.recentRuns(),
    file: plansFile,
  };

  /**
   * 把**用户自己写的一条规划**交给模型拆成子项。
   *
   * 这才是"AI 辅助规划"真正要服务的对象：中转站条目是别人/别的脚本推上来的，
   * 而用户在这里手打的那几行才是他此刻真正在想的事。原来的 AI 功能只拆中转站
   * 内容，等于把最有用的场景漏掉了。
   *
   * 与 `runPlan` 共用同一套提示词、同一套卡片校验、同一个"不发明截止时间"的约束 ——
   * 只拆一条时不必再发明第二份规则。
   */
  const splitLocalPlan = async (id, { force = false, signal } = {}) => {
    const llm = llmOf();
    if (!llm) throw planError('NO_LLM', '还没有可用的模型：请先在设置里配置 AI 服务');

    const source = mine.find(id);
    if (!source) throw planError('NOT_FOUND', '这条规划不存在（可能已被删除）');

    const already = Array.isArray(source.splitInto) ? source.splitInto : [];
    if (already.length > 0 && !force) {
      throw planError('NO_PENDING', '这条已经拆过了。要重新拆，请用「重新拆分」');
    }

    let route;
    try {
      route = typeof llm.resolve === 'function' ? await llm.resolve(signal) : null;
      route = route?.text ?? route?.vision ?? route;
    } catch (error) {
      throw planError('NO_LLM', `解析模型失败：${error?.message ?? error}`);
    }

    // 送模型的形状与中转站条目保持一致：`title` + `text`。
    // 本地规划的备注落在 `text` 上，这样提示词不必为"两种输入"分叉。
    const variable = JSON.stringify(toPlanInput([{
      kind: 'plan',
      title: source.title,
      text: source.detail || source.title,
      at: source.createdAt,
    }]), null, 2);

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

    const result = mine.split(id, cards, { force });
    if (!result) throw planError('NOT_FOUND', '这条规划不存在（可能已被删除）');

    const model = route?.model ?? null;
    log(`拆分「${source.title}」：${cards.length} 张（丢弃 ${dropped} 张不合规，重拆清掉 ${result.removed} 条）`);
    return {
      split: result.created.length,
      dropped,
      removed: result.removed,
      model,
    };
  };

  /**
   * 两类待办。
   *
   * # 数据来源：`zhiyunCampus`
   *
   * 学在浙大待办与拼题A 题集都由 `dsh-zhiyun-source-campus` 提供（本仓原生，
   * 复用智云课堂那套已在 Windows 跑通的 CAS 与 HTTP 传输）。
   *
   * 更早的 omni（移植自为 macOS 写的上游）已在 2026-10-20 按平台拆分后删除：
   * zdbk/cc98/xxt 各自独立成包，xzzd 与 pta 并入 campus。所以这里没有旧路径可退 ——
   * 取不到 campus 就是真的没装。
   *
   * ⚠️ 两个平台**并发**读，各自 try/catch：一个来源失败不该让另一个也拿不到。
   */
  const loadTodos = async () => {
    const campus = ctx.get('zhiyunCampus');
    if (campus) {
      try {
        const result = await campus.todos();
        // campus 已经按 `{ xzzd: { ok, rows, error }, pta: {...} }` 的形状返回，
        // 行也是页面要的形状 —— 这里不再重复归一化
        return {
          xzzd: { ...result.xzzd, error: translateXzzdError(result.xzzd?.error) },
          pta: { ...result.pta, error: translatePtaError(result.pta?.error) },
        };
      } catch (error) {
        // campus 内部已经把每条链路收成 error，走到这里说明是它自己没有正常装配
        const why = { code: 'CAMPUS_FAILED', message: String(error?.message ?? error) };
        return { xzzd: { ok: false, rows: [], error: why }, pta: { ok: false, rows: [], error: why } };
      }
    }

    // omni 已在 2026-10-20 按平台拆分后删除（zdbk/cc98/xxt 各自独立成包，
    // xzzd 与 pta 并入 campus）。这里不再有旧路径可退 —— 没有 campus 就是
    // 真的没装，如实说一句，不要编一个空结果。
    const why = { code: 'CAMPUS_UNAVAILABLE', message: '校园数据包未启用：需要 dsh-zhiyun-source-campus' };
    return { xzzd: { ok: false, rows: [], error: why }, pta: { ok: false, rows: [], error: why } };
  };

  /**
   * 把 campus 回的学在浙大错误翻译成**用户能照做的一句**。
   *
   * campus 自己已经给出 `NEED_LOGIN` 这类确定的 code；这里只补齐 omni 那套旧码
   * （`CONFIGURATION_REQUIRED` 等）的映射 —— 两条路径都走这个函数，页面文案只有一份。
   *
   * ⚠️ 这里的文案必须跟着**凭据的写入口**走。写入口现在是「设置 → 浙大一卡通」，
   *    不是「个人」页那个「连接课堂」按钮（那个表单已改成占位，按钮不存在了）。
   *    还写着"去个人页点连接课堂"会把用户指向一个点不到的东西 —— 比不提示更糟。
   *    同理，面向用户的称呼统一成「浙大一卡通」；CAS / 统一身份认证这类协议术语
   *    不该出现在这一层（那是实现细节，用户认的是"一卡通"这个名字）。
   */
  const translateXzzdError = (error) => {
    if (!error) return null;
    const code = error.code ?? 'XZZD_FAILED';
    // campus 已经给出**完整且更新过**的指引时（含「设置 → 浙大一卡通」），
    // 原样透传，不要用这里的旧文案盖掉它 —— 否则下游一处漏改就白改了上游。
    const current = typeof error.message === 'string' && error.message.includes('浙大一卡通');
    if ((code === 'NEED_LOGIN' || code === 'CONFIGURATION_REQUIRED' || code === 'LOGIN_REQUIRED') && current) {
      return { code: 'NEED_LOGIN', message: error.message };
    }
    if (code === 'NEED_LOGIN' || code === 'CONFIGURATION_REQUIRED' || code === 'LOGIN_REQUIRED') {
      return {
        code: 'NEED_LOGIN',
        message: '还没配置「浙大一卡通」：去「设置 → 浙大一卡通」填一次学号和密码，学在浙大与智云课堂会共用这一份。',
      };
    }
    if (code === 'AUTHENTICATION_REQUIRED' || code === 'AUTH_CHALLENGE_REQUIRED' || code === 'SESSION_EXPIRED') {
      return {
        code: 'NEED_LOGIN',
        message: '「浙大一卡通」的登录态已过期：去「设置 → 浙大一卡通」核对一次密码，课堂与学在浙大会各自重新登录。',
      };
    }
    return { code, message: String(error.message ?? code) };
  };

  /** 拼题A 的失败原因同样是"该去哪儿配"，但答案是"粘 Cookie"而不是"登录"。 */
  const translatePtaError = (error) => {
    if (!error) return null;
    const code = error.code ?? 'PTA_FAILED';
    if (code === 'COOKIE_IMPORT_REQUIRED' || code === 'COOKIE_EXPIRED') {
      return {
        code: 'COOKIE_IMPORT_REQUIRED',
        message: '拼题A 需要在「设置 → 拼题A」粘贴一次 Cookie（它登录要短信验证，无法自动登录）。',
      };
    }
    return { code, message: String(error.message ?? code) };
  };
  /**
   * 学在浙大读不到时，把原因翻译成**用户能照做的一句**。
   *
   * 凭据已经集中在宿主（`dsh-zhiyun-source-classroom` 登录时写入），所以这里**不再出现
   * "去终端配账号"** —— 那是在两个包各自存凭据时才有的事。
   */
  const describeXzzdError = (error) => translateXzzdError({
    code: error?.code ?? 'XZZD_FAILED',
    message: error?.message ?? String(error),
  });


  /** 拼题A 是否已配 Cookie（只回键名，不回值）。 */
  const ptaStatus = async () => {
    // 优先 campus：Cookie 现在存在它自己的会话文件里
    const campus = ctx.get('zhiyunCampus');
    if (campus) {
      try {
        return await campus.ptaStatus();
      } catch (error) {
        return { configured: false, error: String(error?.message ?? error) };
      }
    }
    if (!ctx.get('zhiyunCampus')) return { configured: false, error: '校园数据包未启用' };
    try {
      const status = await ctx.get('zhiyunCampus').ptaStatus();
      // campus 的 ptaStatus 只给 `{ configured, names }`（没有 `source`）——
      // 它不区分"来自环境变量还是会话文件"，那是 omni 的旧概念。
      return { configured: Boolean(status?.configured), names: status?.names ?? [] };
    } catch (error) {
      return { configured: false, error: String(error?.message ?? error) };
    }
  };

  /**
   * 存拼题A Cookie。
   *
   * 只有 campus 一条路（omni 已删除）。输入格式识别由 campus 负责 ——
   * 页面只传用户粘的原文。
   */
  const savePtaCookie = async (raw) => {
    const campus = ctx.get('zhiyunCampus');
    if (!campus) throw new Error('校园数据包未启用（需要 dsh-zhiyun-source-campus），无法保存拼题A Cookie');
    const result = await campus.savePtaCookie(raw);
    log(`拼题A Cookie 已保存（来源：${result?.source ?? '未知'}，${result?.names?.length ?? 0} 个键）`);
    return { source: result?.source, cookie_names: result?.names ?? [] };
  };

  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = createHandler({
        getConfig: () => current,
        saveConfig: (next) => { current = saveConfig(configFile, next); return current; },
        store,
        local: mine,
        splitLocal: splitLocalPlan,
        tickStore: ticks,
        log,
        fetchRemote: (cfg) => pullEntries(cfg, config.fetch ?? fetch),
        loadTodos,
        savePtaCookie,
        ptaStatus,
        plan: planService,
        // 本地快照：切回这一页时先给这份，后台再刷新（见 createHandler 里的说明）
        snapshotFile: config.snapshotFile ?? path.join(dataDir, 'snapshot.json'),
      });
      const dispose = scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler });
      log(`设置路由：${ROUTE_PATH}（中转站留存 ${cacheFile}；我的规划 ${mineFile}）`);
      return dispose;
    }, 'zhiyun: planning settings route');
  });

  const mineService = {
    list: () => mine.list(),
    find: (id) => mine.find(id),
    create: (input) => mine.create(input),
    update: (id, patch) => mine.update(id, patch),
    setDone: (id, done) => mine.setDone(id, done),
    remove: (id) => mine.remove(id),
    split: (id, cards, options) => mine.split(id, cards, options),
    ai: splitLocalPlan,
    file: mineFile,
  };

  const removeService = ctx.provide('zhiyunPlanning', {
    routePath: ROUTE_PATH,
    configFile,
    cacheFile,
    localFile: mineFile,
    config: () => current,
    entries: () => store.list(),
    local: () => mine.list(),
    mine: mineService,
    ticks: () => ticks.all(),
    tickStore: ticks,
    plans: planService,
    pull: () => pullEntries(current, config.fetch ?? fetch),
    todos: loadTodos,
  });

  return async () => {
    if (typeof removeService === 'function') removeService();
  };
}
