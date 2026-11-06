/**
 * Obsidian 式笔记库的**宿主半边**。
 *
 * # 这个包是什么
 *
 * 一个**笔记库（vault）**：一堆平级的 Markdown 笔记，靠 `[[双向链接]]`
 * 连成网络。与本仓 `dsh-zhiyun-core-notes` 是两套**互补**的模型：
 *
 * | | `dsh-zhiyun-core-notes` | 本包 |
 * |---|---|---|
 * | 单位 | 一节课一份笔记 | 一篇笔记（平级） |
 * | 键 | `课程/节次` | 文件路径 |
 * | 链接 | `zy://section/…`（跳回播放位置） | `[[另一篇]]`（连到知识网） |
 *
 * 两者不互相 import：同一段正文可以**同时**带这两种链接。
 *
 * # 为什么这层这么薄
 *
 * 解析与索引是**纯函数**（`src/parse/links.js`、`src/index/vault-index.js`），
 * **零 IO**。宿主半边只做三件事：
 *
 *   1. 从注入的窄存储接口读出全部笔记（不自己写文件 —— 与本仓其他包同一条纪律）；
 *   2. 调纯函数建索引；
 *   3. 把结果经 `connection` 数据接口交给页面。
 *
 * 索引**不持久化**：每次请求重算。理由见 `vault-index.js` 的文件头 ——
 * 笔记量级是几千篇，重算比"维护增量索引"便宜得多，也根除了
 * "索引与正文不一致"这类最难查的错。
 */

import {
  parseNoteLinks, splitWikilink, normalizeTarget, basenameOf,
} from './parse/links.js';
import {
  buildIndex, createResolver, renameLinks, titleOf, targetCandidates,
} from './index/vault-index.js';

export const name = 'zhiyun-vault';

/**
 * 只硬依赖 `profileContext`（拿数据目录）。
 *
 * 笔记内容**不从磁盘读**：由调用方经 `config.readNotes()` 注入，
 * 或由 `provide` 出去的 `zhiyunVault.setNotes()` 推入。
 * 这样本包能跑在任何存储之上（宿主存储栈 / 测试内存 / 将来的同步后端），
 * 而不是把持久层写死在领域包里（本仓所有领域包都遵守这条：落盘归宿主）。
 */
export const inject = ['profileContext'];

/** 数据路由：页面向这里要索引。 */
export const ROUTE_PATH = '/api/zhiyun-vault';

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-vault] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };
  const warn = (message) => {
    const line = `[zhiyun-vault] ${message}`;
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(line);
    else console.warn(line);
  };

  const routePath = config.routePath ?? ROUTE_PATH;

  /** 当前笔记集（由调用方注入或推入）。 */
  let notes = [];
  /** 缓存的索引：只在 notes 变化时失效。 */
  let cached = null;
  const invalidate = () => { cached = null; };

  const currentIndex = () => {
    if (cached === null) cached = buildIndex(notes);
    return cached;
  };

  const status = { route: routePath, noteCount: 0, ready: false, error: null };

  // 初始笔记集：注入了读取函数就用，否则先空着（等调用方推入）。
  try {
    if (typeof config.readNotes === 'function') {
      notes = (await config.readNotes()) ?? [];
      status.noteCount = Array.isArray(notes) ? notes.length : 0;
      invalidate();
    }
    status.ready = true;
    log(`笔记库就绪（${status.noteCount} 篇笔记，数据路由 ${routePath}）`);
  } catch (error) {
    status.error = error instanceof Error ? error.message : String(error);
    warn(`初始笔记载入失败，索引暂时为空：${status.error}`);
  }

  /** 建索引并给出页面需要的全部读数。 */
  const describe = () => {
    const index = currentIndex();
    return {
      noteCount: index.notes.size,
      tagCount: index.tags.size,
      unresolvedCount: index.unresolved.length,
      orphanCount: index.orphans.length,
      edgeCount: index.graph.edges.length,
    };
  };

  /** 页面可调的只读查询。写操作（重命名改链）返回结果但不落盘。 */
  async function invoke(method, args = {}) {
    const index = currentIndex();
    switch (method) {
      case 'describe':
        return describe();

      case 'notes':
        // 列表：带标题与出入度，供侧栏与图谱用。
        return index.graph.nodes;

      case 'note': {
        const path = normalizeTarget(args.path);
        const found = [...index.notes.values()].find((n) => normalizeTarget(n.path) === path);
        if (!found) throw Object.assign(new Error(`没有这篇笔记：${args.path}`), { code: 'NOT_FOUND' });
        return {
          ...found,
          backlinks: index.backlinks.get(found.path) ?? [],
          // 正文本身由调用方保管（本包不存内容），这里只回索引里的派生信息。
        };
      }

      case 'backlinks':
        return index.backlinks.get(args.path) ?? [];

      case 'tags':
        return [...index.tags.entries()].map(([tag, paths]) => ({ tag, count: paths.length, paths }));

      case 'tag': {
        const paths = index.tags.get(String(args.tag ?? '').replace(/^#/, '')) ?? [];
        return paths;
      }

      case 'unresolved':
        return index.unresolved;

      case 'orphans':
        return index.orphans;

      case 'graph':
        return index.graph;

      case 'resolve':
        return createResolver(notes).resolve(args.target, args.from ?? '');

      case 'parse':
        // 供编辑器实时高亮：给一段正文，回链接与标签的位置。
        return parseNoteLinks(args.markdown ?? '');

      case 'candidates':
        return targetCandidates({ path: args.path });

      case 'rename': {
        // ⚠️ 只算不写：本包零 IO。调用方拿 `changed` 列表自己决定何时落盘。
        const changed = renameLinks(notes, args.from, args.to);
        return { affected: changed.length, changes: changed };
      }

      default:
        throw Object.assign(new Error(`未知方法：${String(method)}`), { code: 'INPUT' });
    }
  }

  // ── 数据路由 ────────────────────────────────────────────────────────
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const remove = scope.connection.fetch.register({
        path: routePath,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const send = (value, status = 200) =>
            Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
          try {
            if (request.method === 'GET') return send({ ok: true, value: describe() });
            const body = await request.json();
            if (body?.type !== 'client-request' || typeof body.rpcId !== 'string') {
              throw Object.assign(new Error('invalid envelope'), { code: 'INPUT' });
            }
            const payload = body.payload ?? {};
            const value = await invoke(payload.method, payload.args);
            return send({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } });
          } catch (error) {
            return send({
              type: 'server-response',
              rpcId: 'invalid-request',
              result: {
                ok: false,
                error: { code: error?.code ?? 'FAILED', message: error?.message ?? String(error), details: {} },
              },
            });
          }
        },
      });
      log(`数据路由：${routePath}`);
      return remove;
    }, 'zhiyun: vault data route');
  });

  const removeService = ctx.provide('zhiyunVault', {
    routePath,
    /** 推入/替换笔记集。调用方持有内容与持久化，本包只做索引。 */
    setNotes(next) {
      notes = Array.isArray(next) ? next : [];
      status.noteCount = notes.length;
      invalidate();
      return describe();
    },
    /** 直接拿索引（宿主侧代码可绕过 HTTP 层）。 */
    index: currentIndex,
    invoke,
    /** 纯函数原样透出：调用方想自己组合时不必再 import 一个路径。 */
    parseNoteLinks,
    splitWikilink,
    renameLinks,
    createResolver,
    titleOf,
    status: () => status,
  });

  return () => {
    if (typeof removeService === 'function') removeService();
    notes = [];
    cached = null;
  };
}
