// dsh-paper-reader — Cordis 插件壳。
// 壳保持薄：agent 循环/模型层交给 dsh 框架，本插件只注册工具和 HTTP 路由。
// 核心逻辑（转录/检索）是 src/ 下不依赖 Cordis 的纯函数模块，方便日后迁移。
//
// # 智云能力已并入（原 `dsh-zju-host-paper`）
//
// 原先分两个包：
//
//   `dsh-zju-host-paper`  ← 兼容层，把上游当子插件挂上，再叠自己的路由
//   `@ggboy123/dsh-paper-reader`（npm 1.3.1）  ← 上游
//
// 现在合成一个 vendor 包。理由：两个包之间有 24 条 HTTP 路由的契约耦合，
// 「锁版本 + 兼容层」的代价是每次上游升级都要重新核对路由；既然本来就要自己
// 维护，不如合到一处 —— 上游代码就在本仓里，改哪里、为什么改都看得见。
//
// 并入的能力（`/zw-paper/*`，与上游的 `/paper-reader/*` 并存）：
//
//   - 论文库**多级**文件树（上游只认一层 topic，见 `paper-tree.ts`）
//   - 选中即译（毫秒级单句，与上游整篇 babeldoc 翻译是两种粒度）
//   - `/resume` 面板的会话标签与归档（上游那条只允许归档空白会话）
//   - 状态接口

import type { Context } from '@deepseek-ai/cordis'
import { registerTools, type PluginConfig } from './tools.ts'
import { registerRoutes } from './host.ts'
import { createPaperHandler, PAPER_ROUTE_PREFIX } from './paper-routes.ts'
import { createSelectionTranslator, type NarrowLlm } from './paper-selection.ts'
import { createSessionAdmin } from './paper-session.ts'

export const name = 'dsh-paper-reader'

// 等宿主的工具注册服务（ctx.tools）就绪后再运行。
// `profileContext` 用来算默认数据目录（智云侧原本就靠它）。
export const inject = ['tools', 'profileContext']

/** 配置：上游那一套，加上智云侧的两项可选覆盖。 */
export interface ZhyunPluginConfig extends PluginConfig {
  /** 窄 llm 接口；缺省时取 `ctx.zwParser.llm`（解析器包提供）。 */
  llm?: NarrowLlm | null
  /** 选中翻译缓存条数上限。 */
  cacheLimit?: number
  /** 单次送模型的字符上限。 */
  maxChars?: number
}

export function apply(ctx: Context, config: ZhyunPluginConfig = {}) {
  registerTools(ctx, config)
  console.log(`[dsh-paper-reader] registered tools: list_papers, transcribe_pdf, search_paper, study_progress, study_update`)

  // 论文库目录：与上游同一个（`dataDir` 是唯一真相，两侧不能各算各的）。
  const dataDir = config.dataDir ?? `${(ctx as unknown as { profileContext: { dir: string } }).profileContext.dir}/data/zw-paper`

  // ── 选中翻译：惰性构建 ────────────────────────────────────────────────
  // 模型没配好时插件照样激活（阅读器、文献库、转录都不需要模型），
  // 只有真的悬停翻译时才报 CONFIG —— 与 core-lecture 的取舍一致。
  const pickLlm = (): NarrowLlm | null =>
    config.llm ?? (ctx.get('zwParser') as { llm?: NarrowLlm } | undefined)?.llm ?? null

  let translator: ReturnType<typeof createSelectionTranslator> | null = null
  const getTranslator = (): ReturnType<typeof createSelectionTranslator> | null => {
    if (translator !== null) return translator
    const llm = pickLlm()
    if (!llm) return null
    try {
      translator = createSelectionTranslator({
        llm,
        ...(config.cacheLimit === undefined ? {} : { cacheLimit: config.cacheLimit }),
        ...(config.maxChars === undefined ? {} : { maxChars: config.maxChars }),
      })
    } catch (err) {
      console.warn(`[dsh-paper-reader] 选中翻译不可用：${err instanceof Error ? err.message : String(err)}`)
      return null
    }
    return translator
  }

  // 状态：`/zw-paper/api/status` 的负载。
  const status = {
    prefix: PAPER_ROUTE_PREFIX,
    dataDir,
    translate: { available: false, stats: null as Record<string, number> | null },
    sessions: { available: false },
  }

  // 会话管理：惰性取宿主服务。取不到就让面板如实 503，不影响阅读与翻译。
  const sessionAdmin = createSessionAdmin({
    getSessionController: () => (ctx.get('sessionController') ?? null) as never,
    getWorkspaceRegistry: () => (ctx.get('workspaceRegistry') ?? null) as never,
    warn: (message: string) => console.warn(`[dsh-paper-reader] ${message}`),
  })

  // webServer 是可选服务（web profile 有，headless 没有）：出现时再挂路由。
  // connection/sessionController/workspaceController/workspaceRegistry 同属 web profile。
  ctx.inject(
    ['webServer', 'connection', 'sessionController', 'workspaceController', 'workspaceRegistry'],
    (rctx) => {
      /**
       * 两套路由必须共用**同一个数据目录**。
       *
       * `config.dataDir` 在 profile 里通常没配，`registerRoutes` 内部会退回上游默认
       * `~/.dsh-paper-reader/data`；而智云兼容面用的是上面算好的 `dataDir`
       * （`<profile>/data/zw-paper`）。
       *
       * 不统一的后果（真机踩到）：页面树走 `/zw-paper/api/tree` 列出
       * `PsyC/jov-8-15-3`，点开却走 `/paper-reader/api/paper` —— 那个库里没有这篇，
       * 返回 `文献不存在`，阅读器一片空白。
       *
       * 所以这里把算好的 `dataDir` 显式传下去，让两边指向同一个库。
       */
      registerRoutes(rctx, { ...config, dataDir })

      // 智云兼容面：与上游路由并存，前缀不同。
      const handler = createPaperHandler({
        connection: (rctx as unknown as { connection?: Parameters<typeof createPaperHandler>[0]['connection'] }).connection,
        getTranslator,
        sessionAdmin,
        dataDir,
        describe: () => {
          const live = getTranslator()
          status.translate = { available: live !== null, stats: live === null ? null : { ...live.stats } }
          status.sessions = {
            available: typeof (ctx.get('sessionController') as { inspect?: unknown } | undefined)?.inspect === 'function'
              && typeof (ctx.get('workspaceRegistry') as { archiveSession?: unknown } | undefined)?.archiveSession === 'function',
          }
          return status
        },
      })

      rctx.effect(() => {
        const dispose = (rctx as unknown as {
          webServer: { register(entry: { kind: 'prefix'; path: string; handler: unknown }): () => void }
        }).webServer.register({ kind: 'prefix', path: PAPER_ROUTE_PREFIX, handler })
        return dispose
      }, 'paper-reader: zw routes')
    },
  )

  // 对外服务：别的包（或页面轮询）可以读状态、调翻译。
  ctx.effect(() => {
    const remove = (ctx as unknown as { provide(name: string, value: unknown): void | (() => void) })
      .provide('zwPaper', {
        prefix: PAPER_ROUTE_PREFIX,
        dataDir,
        status: () => status,
        translate: (text: string, options?: { signal?: AbortSignal }) => {
          const live = getTranslator()
          if (live === null) throw new Error('选中翻译需要文本模型：请先在设置里配置一个模型')
          return live.translate(text, options ?? {})
        },
      })
    return () => {
      if (typeof remove === 'function') remove()
      translator = null
    }
  }, 'paper-reader: zwPaper service')
}
