/**
 * 智云 Pro「论文阅读」的宿主半边。
 *
 * # 这个包做什么，不做什么
 *
 * 它是一个**兼容层**，不是阅读器的实现。核心判断只有一句：
 * 上游 `@ggboy123/dsh-paper-reader` 的宿主半边（24 条 `/paper-reader/*` HTTP 路由
 * + 5 个 agent 工具：list_papers / transcribe_pdf / search_paper / study_progress /
 * study_update）是可用资产，我们**原样锁版跑在下面**；本仓只负责
 * 「怎么呈现给智云 Pro 的用户」（UI 壳重写、设置集中管理），以及上游没有的一件事 ——
 * **选中即译**。
 *
 * 所以这个文件的主体是「挂载与拆卸」：
 *
 *   1. 以子插件形式挂上上游（`ctx.plugin`），把我们定好的 `dataDir` 传给它；
 *   2. 运行时核对上游版本，与 `upstream.js` 的预期不符时**大声报警但不拦启动**；
 *   3. 注册本包自己的 `/zhiyun-paper` 前缀路由（选中翻译 + 状态 + 会话标签/归档）。
 *
 * # 上游版本核对为什么不能直接拦住启动
 *
 * 「锁版」的价值在于**发现问题时能立刻指出问题**，而不是在于把工作台变成
 * 一个起不来的东西。版本不符有两种可能：上游做了破坏性变更（那我们确实该警惕），
 * 或者只是一次无关的 patch 发布（那我们没必要让用户连侧栏都看不见）。
 * 我们无法在启动的那一刻分辨这两者 —— 所以选择：**照常启动，把不一致写进
 * 状态接口与日志**，让阅读器页面把这件事显示给用户。用户至少还能打开已有 PDF。
 *
 * 同理，上游包 import 失败（比如依赖没装全）也**不抛出**：整个 profile 里任何一条
 * bundle 条目抛错，起不来的是整个工作台（见 CONTRIBUTING 3.1）。降级成
 * 「论文阅读页提示不可用」，其余五个页面照常用。
 */

import { join } from 'node:path';
import { createRequire } from 'node:module';

import { createSelectionTranslator } from './selection.js';
import { createPaperHandler, PAPER_ROUTE_PREFIX } from './routes.js';
import { createSessionAdmin } from './session-admin.js';
import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from './upstream.js';

export const name = 'zhiyun-paper';

/**
 * 只硬依赖 `profileContext`（数据目录）。`webServer` / `connection` / `llm` 全部
 * 走 `ctx.inject` / `ctx.get` 惰性取 —— 解析器包的注释里已经写明这条规矩：
 * 可选宿主服务不写进 inject，否则对方没就绪时本插件会一直 pending。
 */
export const inject = ['profileContext'];

/** 读已安装上游包的版本号（用它自己的 package.json，因为上游 exports 里有这一项）。 */
function installedUpstreamVersion() {
  try {
    const require = createRequire(import.meta.url);
    const file = require.resolve(`${UPSTREAM_PACKAGE}/package.json`);
    return { version: createRequire(file)(file).version, file };
  } catch (err) {
    return { version: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function apply(ctx, config = {}) {
  const dataDir = config.dataDir ?? join(ctx.profileContext.dir, 'data/zhiyun-paper');

  const status = {
    prefix: PAPER_ROUTE_PREFIX,
    upstream: {
      package: UPSTREAM_PACKAGE,
      expected: UPSTREAM_VERSION,
      installed: installedUpstreamVersion().version,
      mounted: false,
      error: null,
    },
    translate: { available: false, stats: null },
    sessions: { available: false },
  };

  if (status.upstream.installed !== UPSTREAM_VERSION) {
    const seen = status.upstream.installed ?? '(未安装)';
    // 不抛错：见文件头「为什么不能拦住启动」。但这一行必须刺眼，否则锁版就白锁了。
    console.warn(`[zhiyun-paper] 上游版本与锁版不一致：期望 ${UPSTREAM_VERSION}，实际 ${seen}。`
      + '阅读器仍会挂载，但协议可能已经变化，请核对 /zhiyun-paper/api/status。');
  }

  // ── 选中翻译：惰性构建 ────────────────────────────────────────────────
  // 模型没配好时插件照样激活（阅读器、文献库、转录都不需要模型），
  // 只有真的悬停翻译时才报 CONFIG —— 与 dsh-zhiyun-core-lecture 的取舍一致。
  const pickLlm = () => config.llm ?? ctx.get('zhiyunParser')?.llm ?? null;
  let translator = null;
  const getTranslator = () => {
    if (translator) return translator;
    const llm = pickLlm();
    if (!llm) return null;
    try {
      translator = createSelectionTranslator({ llm, cacheLimit: config.cacheLimit, maxChars: config.maxChars });
    } catch (err) {
      console.warn(`[zhiyun-paper] 选中翻译不可用：${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
    return translator;
  };

  // ── 挂载上游宿主半边 ──────────────────────────────────────────────────
  let upstreamFiber = null;
  try {
    const upstream = await import(UPSTREAM_PACKAGE);
    upstreamFiber = ctx.plugin(upstream, { ...config.upstream, dataDir });
    await upstreamFiber;
    status.upstream.mounted = true;
  } catch (err) {
    status.upstream.error = err instanceof Error ? err.message : String(err);
    console.warn(`[zhiyun-paper] 上游阅读器挂载失败，论文页将提示不可用：${status.upstream.error}`);
  }

  // ── 会话管理：惰性取宿主服务 ──────────────────────────────────────────
  // `sessionController` / `workspaceRegistry` 都不写进 inject（同上：可选服务否则会把
  // 插件拖成 pending），取不到就让面板上的会话功能如实 503，不影响阅读与翻译。
  const sessionAdmin = createSessionAdmin({
    getSessionController: () => {
      const controller = ctx.get('sessionController');
      return controller ?? null;
    },
    getWorkspaceRegistry: () => {
      const registry = ctx.get('workspaceRegistry');
      return registry ?? null;
    },
    warn: (message) => console.warn(`[zhiyun-paper] ${message}`),
  });

  // ── 本包自有路由 ──────────────────────────────────────────────────────
  ctx.inject(['webServer', 'connection'], (scope) => {
    const handler = createPaperHandler({
      connection: scope.connection,
      getTranslator,
      sessionAdmin,
      // `/api/tree` 与 `/api/ref` 要读论文库目录；传下去而不是让 routes.js 自己猜。
      dataDir,
      describe: () => {
        const live = getTranslator();
        status.translate = { available: Boolean(live), stats: live ? live.stats : null };
        status.sessions = {
          available: typeof ctx.get('sessionController')?.inspect === 'function'
            && typeof ctx.get('workspaceRegistry')?.archiveSession === 'function',
        };
        return status;
      },
    });
    scope.effect(() => {
      const dispose = scope.webServer.register({ kind: 'prefix', path: PAPER_ROUTE_PREFIX, handler });
      return dispose;
    }, 'zhiyun: paper routes');
  });

  const removeService = ctx.provide('zhiyunPaper', {
    prefix: PAPER_ROUTE_PREFIX,
    dataDir,
    status: () => status,
    translate: (text, options) => {
      const live = getTranslator();
      if (!live) throw new Error('选中翻译需要文本模型：请在「个人 → 设置 → AI 服务」里配置一个模型');
      return live.translate(text, options);
    },
  });

  return () => {
    // 先摘服务、再卸上游：顺序反过来时，上游的拆卸过程里若还有人打
    // `zhiyunPaper`（页面轮询），会打到一个已在拆卸中的对象上。
    if (typeof removeService === 'function') removeService();
    if (upstreamFiber && typeof upstreamFiber.dispose === 'function') upstreamFiber.dispose();
    translator = null;
  };
}
