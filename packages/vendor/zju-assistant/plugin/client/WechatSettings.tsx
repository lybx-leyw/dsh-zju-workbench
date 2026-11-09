/**
 * 「微信公众号」的配置页：微信读书登录状态、跟踪了哪些号。扫码登录和验证在插件自己开的浏览器窗口里做（本机的默认浏览器），这台电脑上没有能用的浏览器时说一声。
 * 页面只照引擎侧存下的画（host/wechat.mjs 的 snapshot）；要等一阵的事（扫码登录、去验证）在后台做，
 * 这里隔一会儿问一次做完没有，离开这一页再回来接着显示。
 * 字要少（用户 2026-10-12 说原来每一行下面都挂着一句灰字，太多）：一行平时只有名字和右边的状态或控件，要用户处理的时候才多一句。
 * 这里没有文章列表：新文章在「校园事务」的通知里看，每个号下面只写最新的一篇，看得出它在不在更新。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, IconPlusOutlineRegular, Modal, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { linkProps, useStatus } from './campus.ts'
import { Alert } from './controls.tsx'
import { clock, dateText, midnight } from './when.ts'

/** 一个来源上一次读的情况；ok 为假时 status 是技能给的原因，message 是它的原话。 */
interface SourceState { ok: boolean, status?: string, message?: string }
interface Article { id: string, title: string, url: string, publishedAt: string | null }
interface Account { biz: string, name: string, source: 'web' | null, count: number, latest: Article | null, error: { status: string, message: string } | null }
interface Snapshot {
  enabled: boolean
  /** 后台有事在做；activity 是哪一件：login 等扫码，checking 在读文章。 */
  busy: boolean
  activity: string
  /** 用户上一次点的事没做成的原因。 */
  problem: string
  settings: { autoVerify: boolean }
  /** 上一次检查是什么时候；还没检查过是 null。 */
  checkedAt: string | null
  weread: { loggedIn: boolean, state: SourceState | null }
  accounts: Account[]
}
/** 微信读书书架上的候选公众号。 */
interface Candidate { biz: string, name: string, latestAt?: string | null }
type Found = { ok: true, source: 'web', accounts: Candidate[] } | { ok: false, source: 'web', status: string, message: string }

/** 上一次读到的状态。再打开这一页时先照它画，不会先空着再跳出来。 */
let last: Snapshot | null = null

/** 后台有事在做时多久问一次，平时多久问一次。 */
const BUSY_MS = 1500, IDLE_MS = 30_000

/** 微信读书只是个载体：公众号得先在手机的微信读书 App 里加进书架，网页这边才读得到。 */
const WEREAD_NEEDS = '公众号要先在手机的微信读书 App 里加进书架'
const limited = (status: string | undefined) => status?.endsWith('rate_limited') === true
/** 技能的原话拿来当一行说明用：去掉句尾的句号。 */
const said = (message: string | undefined) => message?.replace(/[。.]$/, '') || '这次没读成'
const day = (at: string | null | undefined) => at && Number.isFinite(Date.parse(at)) ? dateText(Date.parse(at), Date.now()) : ''
/** 上次检查的时间：今天的只写几点，别的带上日期。 */
function checkedText(at: string): string {
  const time = Date.parse(at), now = Date.now()
  return midnight(time) === midnight(now) ? clock(new Date(time)) : `${dateText(time, now)} ${clock(new Date(time))}`
}

/** 「微信读书」那一行：下面要不要多一句、右边放什么。 */
function wereadLine({ weread, activity }: Snapshot): { note?: string, warn?: boolean, action: 'login' | 'relogin' | 'verify' | 'retry' | 'logout' | 'waiting' } {
  if (activity === 'login') return { action: 'waiting' }
  if (!weread.loggedIn) return { note: WEREAD_NEEDS, action: 'login' }
  const state = weread.state
  if (!state || state.ok) return { action: 'logout' }
  if (state.status === 'login_required') return { note: '登录过期了', warn: true, action: 'relogin' }
  if (state.status === 'verification_required') return { note: '要先验证一次，才能接着读', warn: true, action: 'verify' }
  if (limited(state.status)) return { note: '访问太频繁，过一阵会自己再试', warn: true, action: 'logout' }
  return { note: said(state.message), warn: true, action: 'retry' }
}

/** 一个号这次没读到时，它那一行怎么说。 */
function accountProblem(account: Account, { weread }: Snapshot): string {
  const status = account.error?.status
  if (status === 'account_not_found') return weread.loggedIn ? '微信读书的书架里没有它' : '请先登录微信读书'
  if (status === 'no_source') return '请先登录微信读书'
  if (status === 'verification_required') return '微信读书要先验证一次'
  if (status === 'login_required') return '微信读书的登录过期了'
  if (limited(status)) return '微信读书访问太频繁，过一阵会自己再试'
  return said(account.error?.message)
}

/**
 * 添加公众号的弹窗：一打开就列出能跟踪的号，微信读书书架上的；输入名称是在里面筛。
 * 点「跟踪」以后弹窗不关，可以接着加。微信读书那边搜不了新的号，要加得先去手机 App，最下面有一句说明。
 */
function AddDialog({ data, onClose, onChange }: { data: Snapshot, onClose: () => void, onChange: (next: Snapshot) => void }) {
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Partial<Record<'web', Found>>>({})
  /** 还在读哪个来源的名单。 */
  const [loading, setLoading] = useState<readonly ('web')[]>([])
  /** 正在加的那个号。 */
  const [adding, setAdding] = useState('')
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const useWeb = data.weread.loggedIn
  useEffect(() => {
    const sources = useWeb ? ['web' as const] : []
    setLoading(sources)
    for (const source of sources) {
      campusApi<Found>('wechat-find', { source })
        .then((result) => { if (alive.current) setFound(old => ({ ...old, [source]: result })) }, (reason: unknown) => { if (alive.current) setError(errorText(reason)) })
        .finally(() => { if (alive.current) setLoading(old => old.filter(item => item !== source)) })
    }
  }, [useWeb])

  const tracked = new Set(data.accounts.map(account => account.biz))
  const needle = query.trim().toLowerCase()
  // 同一个公众号只列一条。
  const seen = new Set<string>()
  const candidates = (['web'] as const).flatMap((source) => {
    const result = found[source]
    return result?.ok ? result.accounts.filter(candidate => !seen.has(candidate.biz) && !!seen.add(candidate.biz)).map(candidate => ({ ...candidate, source })) : []
  }).filter(candidate => candidate.name.toLowerCase().includes(needle))
  const problems = (['web'] as const).flatMap((source) => {
    const result = found[source]
    if (!result || result.ok) return []
    return [`微信读书：${result.status === 'login_required' ? '登录过期了，回到上一页重新登录' : said(result.message)}。`]
  })
  const track = (candidate: Candidate & { source: 'web' }) => {
    if (adding) return
    setAdding(candidate.biz); setError('')
    campusApi<Snapshot>('wechat-track', { name: candidate.name, source: candidate.source })
      .then((next) => { if (alive.current) onChange(next) }, (reason: unknown) => { if (alive.current) setError(errorText(reason)) })
      .finally(() => { if (alive.current) setAdding('') })
  }

  return (
    <Modal open title="添加公众号" closeLabel="关闭" onClose={onClose} footer={<Button variant="outline" onClick={onClose}>完成</Button>}>
      <div className="campus-section">
        <div className="campus-wechat-find">
          <input className="campus-input" data-modal-autofocus aria-label="公众号名称" placeholder="公众号名称" autoComplete="off" value={query} onChange={(event) => { setQuery(event.target.value) }} />
        </div>
        {error && <Alert>{error}</Alert>}
        {problems.map(problem => <Alert key={problem} tone="warn">{problem}</Alert>)}
        <div className="campus-wechat-picker">
          {candidates.length > 0 && (
            <ul className="campus-rows">
              {candidates.map(candidate => (
                <li key={candidate.biz} className="campus-row">
                  <div className="campus-wechat-main">
                    <span className="campus-row-title">{candidate.name}</span>
                    <span className="campus-wechat-meta">{'微信读书'}</span>
                  </div>
                  {tracked.has(candidate.biz)
                    ? <span className="campus-wechat-meta">已跟踪</span>
                    : <Button size="sm" variant="outline" aria-label={`跟踪${candidate.name}`} disabled={!!adding} onClick={() => { track(candidate) }}>{adding === candidate.biz ? '正在加…' : '跟踪'}</Button>}
                </li>
              ))}
            </ul>
          )}
          {loading.length > 0 && <p className="campus-note" role="status">正在看{'微信读书的书架'}里有哪些公众号…</p>}
          {loading.length === 0 && candidates.length === 0 && problems.length === 0 && <p className="campus-note">{needle ? `没有名字带「${query.trim()}」的公众号。` : '还没有能跟踪的公众号。'}</p>}
        </div>
        <p className="campus-note">{`找不到的号：${WEREAD_NEEDS}。`}</p>
      </div>
    </Modal>
  )
}

export function WechatSettings() {
  const [data, setData] = useState<Snapshot | null>(last)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const browser = useStatus().browser
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const apply = useCallback((next: Snapshot) => { last = next; if (alive.current) { setData(next); setError('') } }, [])
  const ask = useCallback((action: string, input?: unknown) => campusApi<Snapshot>(action, input).then(apply, (reason: unknown) => { if (alive.current) setError(errorText(reason)) }), [apply])
  useEffect(() => {
    void ask('wechat-visit')
    // 扫完码、或者在别处改了名单以后回到窗口，这里跟着变。
    const visit = () => { void ask('wechat-visit') }
    window.addEventListener('focus', visit)
    return () => { window.removeEventListener('focus', visit) }
  }, [ask])
  const busy = data?.busy ?? false
  useEffect(() => {
    const timer = window.setInterval(() => { void ask('wechat-read') }, busy ? BUSY_MS : IDLE_MS)
    return () => { window.clearInterval(timer) }
  }, [busy, ask])

  if (!data) return error ? <Alert>{error}</Alert> : null
  const weread = wereadLine(data)
  const reading = busy && data.activity === 'checking'
  const untrack = (account: Account) => {
    campusApi<Snapshot>('wechat-untrack', { biz: account.biz }).then(
      (next) => { apply(next); if (alive.current) setNotice(`不再跟踪「${account.name}」`) },
      (reason: unknown) => { if (alive.current) setError(errorText(reason)) },
    )
  }
  const wereadEnd = {
    login: <Button size="sm" variant="outline" onClick={() => { void ask('wechat-login') }}>扫码登录</Button>,
    relogin: <Button size="sm" variant="outline" onClick={() => { void ask('wechat-login') }}>重新登录</Button>,
    verify: <Button size="sm" variant="outline" disabled={reading} onClick={() => { void ask('wechat-retry') }}>{reading ? '正在读…' : '去验证'}</Button>,
    retry: <Button size="sm" variant="outline" disabled={reading} onClick={() => { void ask('wechat-retry') }}>{reading ? '正在读…' : '再试一次'}</Button>,
    logout: <><span className="campus-wechat-meta">已登录</span><button type="button" className="campus-textlink" onClick={() => { void ask('wechat-logout') }}>退出</button></>,
    waiting: <span className="campus-wechat-meta" role="status">在弹出的窗口里扫码…</span>,
  }[weread.action]

  return (
    <>
      {/* 没有能用的浏览器时下面那句已经说了，扫码没成的原因不再重复一遍。 */}
      {(error || (data.problem && (browser || !data.problem.includes('没找到能用的浏览器')))) && <Alert>{error || data.problem}</Alert>}
      {!browser && (
        <Alert tone="warn">
          扫码登录和过验证码要用 Chrome、Edge 这类浏览器，这台电脑上没找到，装一个以后再来扫码。
        </Alert>
      )}
      <section className="campus-section" aria-labelledby="wechat-sources">
        <h2 id="wechat-sources" className="campus-section-title">从哪里找文章</h2>
        <ul className="campus-rows">
          <li className="campus-row" data-wechat-source="weread">
            <div className="campus-wechat-main">
              <span className="campus-row-title">微信读书</span>
              {weread.note && <span className="campus-wechat-meta" data-tone={weread.warn ? 'warn' : undefined}>{weread.note}</span>}
            </div>
            <span className="campus-wechat-end">{wereadEnd}</span>
          </li>
        </ul>
      </section>

      <section className="campus-section" aria-labelledby="wechat-tracked">
        <div className="campus-section-head">
          <div className="campus-titleline">
            <h2 id="wechat-tracked" className="campus-section-title">跟踪的公众号</h2>
            <span className="campus-count">{data.accounts.length}</span>
          </div>
          <Button size="sm" variant="outline" icon={<IconPlusOutlineRegular size={14} />} onClick={() => { setAdding(true) }}>添加</Button>
        </div>
        {data.accounts.length === 0
          ? <p className="campus-note">还没有跟踪公众号。</p>
          : (
            <>
              {/* 号多了在这个框里滚动，页面不跟着变长。 */}
              <ul className="campus-rows campus-wechat-tracked">
                {data.accounts.map(account => (
                  <li key={account.biz} className="campus-row" data-wechat-account={account.biz}>
                    <div className="campus-wechat-main">
                      <span className="campus-row-title">{account.name}</span>
                      {account.latest && (
                        <a className="campus-wechat-latest" {...linkProps(account.latest.url)}>
                          <span>{account.latest.title || '没有标题的文章'}</span>
                          {day(account.latest.publishedAt) && <time dateTime={account.latest.publishedAt ?? undefined}>{day(account.latest.publishedAt)}</time>}
                        </a>
                      )}
                      {!account.latest && !account.error && <span className="campus-wechat-meta">{busy ? '正在读它的文章…' : '还没有读到它的文章'}</span>}
                      {account.error && <span className="campus-wechat-meta" data-tone="warn">{accountProblem(account, data)}</span>}
                    </div>
                    <button type="button" className="campus-textlink" data-danger aria-label={`不再跟踪${account.name}`} onClick={() => { untrack(account) }}>不再跟踪</button>
                  </li>
                ))}
              </ul>
              {data.checkedAt && <p className="campus-note">上次检查 {checkedText(data.checkedAt)}</p>}
            </>
          )}
      </section>

      {adding && <AddDialog data={data} onClose={() => { setAdding(false) }} onChange={apply} />}
      {notice && <Toast text={notice} onDone={() => { setNotice('') }} />}
    </>
  )
}
