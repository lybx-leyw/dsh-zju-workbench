/**
 * 智云兼容面自有的 HTTP 路由（前缀 `/zhiyun-paper`）。
 *
 * # 为什么只有这几条
 *
 * 阅读、文献库、转录、整篇翻译、会话注入 —— 上游那 24 条 `/paper-reader/*` 路由
 * **原样复用**，页面直接打它们即可。这一层只补齐上游没有的事：
 *
 *   - `/api/status` —— 插件状态（翻译器可用性、会话服务可用性）；
 *   - `/api/tree` —— 论文库的**多级**文件树（上游 `/api/library` 是扁平表）；
 *   - `/api/ref` —— 深层路径 → 上游坐标 `{topic, name}`；
 *   - `/api/translate` —— 选中即译；
 *   - `/api/sessions/labels` —— `/resume` 面板的会话标签；
 *   - `/api/sessions/archive` —— 归档任意会话（上游那条只允许空白会话）。
 *
 * 之所以不把上游的路由反代一遍（页面统一打 `/zhiyun-paper/*`）：那需要复刻
 * 上游每个端点的请求/响应形状，等于把「兼容层」写成了「重新实现」，
 * 上游一升级就要跟着改一遍。
 *
 * # 前缀为什么不能是 `/paper-reader`
 *
 * 宿主的 `webserver.register` 对同 (kind, path) 重复注册会直接抛
 * `webserver: duplicate prefix route "/paper-reader"`。上游已经占了那条前缀，
 * 我们再用就是把自己炸掉；换个前缀，两条路由表各活各的。
 *
 * # 从 `dsh-zhiyun-host-paper` 迁入
 *
 * 迁入后与上游同住一个包：路由前缀仍分开，但装配、错误码、会话管理都是同一份，
 * 不再需要「兼容层挂子插件」那一层间接。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { PaperError, paperErrorStatus } from './paper-errors.ts'
import { readPaperTree, upstreamRefFor } from './paper-tree.ts'
import type { createSessionAdmin } from './paper-session.ts'
import type { TranslationResult } from './paper-selection.ts'

/** 本包自有路由前缀。页面侧的同名常量在 `@lybx-leyw/dsh-zju-page-paper/src/library.js`。 */
export const PAPER_ROUTE_PREFIX = '/zhiyun-paper'

/** 请求体上限：一段选中文本最多千余字符，64KB 只用来拦住畸形请求。 */
const MAX_BODY_BYTES = 64 * 1024

/** 选中翻译器的对外面（`createSelectionTranslator` 的返回子集）。 */
export interface SelectionTranslatorLike {
  translate(text: unknown, options?: { signal?: AbortSignal }): Promise<TranslationResult>
  readonly stats: Record<string, number>
}

/** `createSessionAdmin` 的返回子集。 */
export type SessionAdminLike = ReturnType<typeof createSessionAdmin>

/** 路由依赖。全部惰性传入：宿主服务缺席时降级 503，不拦插件激活。 */
export interface PaperHandlerOptions {
  /** 宿主 `connection`；`requestRejection(req)` 返回 401/403/undefined。缺省即不做来源校验。 */
  connection?: { requestRejection?: (req: IncomingMessage) => number | undefined } | null | undefined
  /** 惰性取翻译器；返回 null 表示当前拿不到窄 llm 接口。 */
  getTranslator: () => SelectionTranslatorLike | null
  /** 会话管理的宿主半边。 */
  sessionAdmin?: SessionAdminLike | null
  /** 产出 `/api/status` 的负载。 */
  describe: () => unknown
  /** 论文库根目录；`/api/tree` 与 `/api/ref` 用它读盘。 */
  dataDir?: string
}

interface DispatchDeps {
  getTranslator: () => SelectionTranslatorLike | null
  sessionAdmin: SessionAdminLike | null
  describe: () => unknown
  // `exactOptionalPropertyTypes` 下可选属性不会自动含 `undefined`，
  // 而调用方传的是可能缺省的 `dataDir`。显式写出来。
  dataDir: string | undefined
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

async function readJsonBody(req: IncomingMessage, limit = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > limit) throw new PaperError('INPUT', `请求体过大（上限 ${limit} 字节）`)
    chunks.push(buf)
  }
  if (size === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new PaperError('INPUT', '请求体不是合法 JSON')
  }
  return parsed !== null && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
}

/** 把任意异常收敛成 PaperError，保证对外永远是 `{ error, code }` 的形状。 */
function asPaperError(err: unknown): PaperError {
  if (err instanceof PaperError) return err
  return new PaperError('INTERNAL', err instanceof Error ? err.message : String(err), { cause: err })
}

/**
 * @param options - 见 {@link PaperHandlerOptions}。
 * @returns 一个 `(req, res) => void` 的 prefix handler。
 */
export function createPaperHandler({
  connection,
  getTranslator,
  sessionAdmin = null,
  describe,
  dataDir,
}: PaperHandlerOptions) {
  const deps: DispatchDeps = { getTranslator, sessionAdmin, describe, dataDir }

  return function handler(req: IncomingMessage, res: ServerResponse): void {
    const rejection = typeof connection?.requestRejection === 'function'
      ? connection.requestRejection(req)
      : undefined
    if (rejection !== undefined) {
      sendJson(res, rejection, { error: rejection === 401 ? 'unauthorized' : 'forbidden' })
      return
    }

    const url = new URL(req.url ?? '/', 'http://localhost')
    const sub = url.pathname.slice(PAPER_ROUTE_PREFIX.length)

    Promise.resolve()
      .then(() => dispatch(req, res, url, sub, deps))
      .catch((err: unknown) => {
        const error = asPaperError(err)
        if (!res.headersSent) sendJson(res, paperErrorStatus(error.code), { error: error.message, code: error.code })
        else res.end()
      })
  }
}

async function dispatch(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  sub: string,
  { getTranslator, sessionAdmin, describe, dataDir }: DispatchDeps,
): Promise<void> {
  if (sub === '/api/status') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
    return sendJson(res, 200, describe())
  }

  // 论文库的**多级文件树**（本包自有，不走上游）。
  //
  // 为什么需要：上游只认 `topic/name` 两段式，它的 `/api/library` 是扁平表，
  // 看不出 `理学/力学/讲义.pdf` 这个层级。这里直接读盘并按编码规则还原层级，
  // 让论文页能有和笔记库一样的多级树。
  if (sub === '/api/tree') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
    if (typeof dataDir !== 'string' || dataDir === '') {
      throw new PaperError('CONFIG', '论文库目录没有配置')
    }
    return sendJson(res, 200, { entries: await readPaperTree(dataDir) })
  }

  /**
   * 路径 → 上游坐标（`{topic, name}`）。
   *
   * 树上的深层路径不能直接交给上游，必须先编码成单段 topic。把这件事放在宿主侧，
   * 页面上就不用重复实现一遍编码规则 —— 两边各写一份迟早漂移，而漂移的结果是
   * 「点开一篇论文却打开了别的」。
   */
  if (sub === '/api/ref') {
    if (req.method !== 'GET') return sendMethodNotAllowed(res, 'GET')
    const rel = url.searchParams.get('path') ?? ''
    if (rel === '') throw new PaperError('INPUT', '缺少 path')
    return sendJson(res, 200, upstreamRefFor(rel))
  }

  if (sub === '/api/translate') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
    const body = await readJsonBody(req)
    const translator = getTranslator()
    if (!translator) {
      throw new PaperError('NO_LLM', '选中翻译需要文本模型：请在「个人 → 设置 → AI 服务」里配置一个模型，'
        + '并确认 profile 已启用解析器包')
    }
    const result = await translator.translate(body.text)
    return sendJson(res, 200, result)
  }

  // `/resume` 面板的列表：给会话补上「论文名 + 首句」这两样上游不给的标签材料。
  if (sub === '/api/sessions/labels') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
    const body = await readJsonBody(req)
    if (sessionAdmin === null) {
      throw new PaperError('NO_SESSION_ADMIN', '会话标签需要宿主的 sessionController 服务（当前不可用）')
    }
    const cards = await sessionAdmin.cards(body.sessionIds)
    return sendJson(res, 200, { cards })
  }

  // 面板上的「删除」：归档一个会话（含内容会话，上游那条只允许空白会话）。
  if (sub === '/api/sessions/archive') {
    if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST')
    const body = await readJsonBody(req)
    if (sessionAdmin === null) {
      throw new PaperError('NO_SESSION_ADMIN', '删除会话需要宿主的 workspaceRegistry 服务（当前不可用）')
    }
    const result = await sessionAdmin.archive(body.sessionId)
    return sendJson(res, 200, result)
  }

  return sendJson(res, 404, { error: `not found: ${url.pathname}`, code: 'NOT_FOUND' })
}

function sendMethodNotAllowed(res: ServerResponse, allow: string): void {
  res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow })
  res.end(JSON.stringify({ error: `只支持 ${allow}`, code: 'METHOD' }))
}
