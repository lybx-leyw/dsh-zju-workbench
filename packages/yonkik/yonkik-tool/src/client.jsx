// YONKIK 侦察凭据的设置分区（客户端半边）。
// 外观完全走 ui-shared 的 settings-kit 原语 + SETTINGS_CSS（照宿主官方 Models 设置页，
// 用原生 --dsw-alias token，亮/暗主题自动跟随，与其它设置项同源）。
// 凭据只在宿主那边读写（加密、不回显）；本组件只把用户填的表 POST 过去。
// 密码框永远从空开始（不预填打码值，避免追加污染），留空提交 = 沿用已存值。
import React, { useCallback, useEffect, useState } from 'react'
import {
  PageTitle, Intro, Card, Field, TextInput, TextArea, Actions, StatusLine, Rows,
  SETTINGS_CSS, mountStyle, registerPageContent,
} from '@lybx-leyw/dsh-zju-ui-shared'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { MASK, ROUTE_PATH, WRITE_HEADER, errorText } from './shared.js'
import wikiCss from './wiki.css'

export const name = 'zw-yonkik-client'
export const inject = ['slots']

async function api(action = '', body) {
  const method = body ? 'POST' : 'GET'
  const response = await fetch(`${ROUTE_PATH}${action ? `?action=${action}` : ''}`, {
    method,
    headers: body ? { 'content-type': 'application/json', [WRITE_HEADER]: '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(errorText(payload.error, response.status))
  return payload
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zwYonkikSettingsStyle', css: SETTINGS_CSS, label: 'zw: yonkik settings styles' })
  mountStyle(ctx, { attribute: 'zwYonkikWikiStyle', css: wikiCss, label: 'zw: yonkik wiki styles' })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zw-yonkik',
    order: 80,
    label: () => 'YONKIK 侦察凭据',
  }, () => <SettingsSection />))
  registerPageContent(ctx, {
    id: 'yonkik-wiki',
    label: 'YONKIK 知识库',
    order: 90,
    render: () => <WikiPage />,
  })
}

const emptyRow = () => ({ key: '', 描述: '', n1: '键一', n2: '键二', v1: '', v2: '', has1: false, has2: false })

function SettingsSection() {
  const [rows, setRows] = useState([])
  const [sites, setSites] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api()
      setRows((d.credentials ?? []).map(c => {
        const ks = c.keys ?? []
        return {
          key: c.key, 描述: c.描述 ?? '',
          n1: ks[0]?.name ?? '键一', n2: ks[1]?.name ?? '键二',
          v1: '', v2: '',
          has1: !!ks[0]?.hasValue, has2: !!ks[1]?.hasValue,
          fromWorkbench: !!c.fromWorkbench,
        }
      }))
      setSites((d.sites ?? []).join('\n'))
    } catch (e) { setMsg({ err: e.message }) }
  }, [])

  useEffect(() => { load() }, [load])

  const setRow = (i, patch) => setRows(rs => rs.map((r, j) => j === i ? { ...r, ...patch } : r))
  const addRow = () => setRows(rs => [...rs, emptyRow()])
  const removeRow = (i) => setRows(rs => rs.filter((_, j) => j !== i))

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const credentials = {}
      for (const r of rows) {
        if (r.fromWorkbench) continue
        const key = r.key.trim()
        if (!key) continue
        const entry = { 描述: r.描述 }
        // 留空 = 沿用已存值（翻译成打码值）；有新值则覆盖
        entry[r.n1] = r.v1 === '' && r.has1 ? MASK : r.v1
        if (r.n2) entry[r.n2] = r.v2 === '' && r.has2 ? MASK : r.v2
        credentials[key] = entry
      }
      const siteList = sites.split('\n').map(s => s.trim()).filter(Boolean)
      await api('save', { credentials, sites: siteList })
      setMsg({ ok: '已保存（凭据加密存储，不回显）' })
      await load()
    } catch (e) { setMsg({ err: e.message }) }
    finally { setBusy(false) }
  }

  const clear = async () => {
    setBusy(true); setMsg(null)
    try { await api('clear', {}); setMsg({ ok: '已清除' }); await load() }
    catch (e) { setMsg({ err: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <div className="zju-setting-section">
      <PageTitle>YONKIK 侦察凭据</PageTitle>
      <Intro>只读侦察用的凭据与站点。凭据经宿主加密服务存储、不回显；密码留空表示沿用已存值。每套凭据一张卡片，键名自定（如账号/密码，或单个 API key），在描述里说明每个键是什么。</Intro>
      <StatusLine label="已配置凭据" value={rows.length ? `${rows.length} 套` : '无'} />
      <Rows>
        {rows.map((r, i) => r.fromWorkbench ? (
          <Card key={i} title={r.key} detail={r.描述} defaultOpen={false}>
            <Intro>由工作台管理，YONKIK 自动复用（凭据键：{r.key}）。请在工作台设置中修改，此处只读。</Intro>
          </Card>
        ) : (
          <Card key={i} title={`凭据 ${i + 1}`} detail={r.描述 || '未命名'} defaultOpen>
            <Field label="键名"><TextInput value={r.key} placeholder="如 cc98" onChange={v => setRow(i, { key: v })} /></Field>
            <Field label="描述"><TextInput value={r.描述} placeholder="账号+密码 / API key…" onChange={v => setRow(i, { 描述: v })} /></Field>
            <Field label={r.n1}><TextInput value={r.v1} placeholder={r.has1 ? '已存（留空沿用）' : ''} onChange={v => setRow(i, { v1: v })} /></Field>
            <Field label={r.n2}><TextInput value={r.v2} placeholder={r.has2 ? '已存（留空沿用）' : ''} onChange={v => setRow(i, { v2: v })} /></Field>
            <Actions><button type="button" onClick={() => removeRow(i)}>删除这套</button></Actions>
          </Card>
        ))}
      </Rows>
      <Actions><button type="button" onClick={addRow}>+ 加一套凭据</button></Actions>
      <Field label="站点清单（每行一个 URL）">
        <TextArea value={sites} placeholder={'https://www.cc98.org\nhttps://…'} rows={4} onChange={setSites} />
      </Field>
      <Actions>
        <button type="button" data-primary="" disabled={busy} onClick={save}>保存</button>
        <button type="button" disabled={busy} onClick={clear}>清除</button>
      </Actions>
      {msg && <Intro>{msg.err ?? msg.ok}</Intro>}
    </div>
  )
}

async function wikiApi(site) {
  const url = `${ROUTE_PATH}/wiki${site ? `?site=${encodeURIComponent(site)}` : ''}`
  const r = await fetch(url)
  const p = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(errorText(p.error, r.status))
  return p
}

const WIKI_TABS = [['sites', '站点'], ['playbook', 'Playbook'], ['sso', 'SSO 家族'], ['scripts', '脚本'], ['memory', 'MEMORY']]

const MARKDOWN_LABELS = { code: { copyLabel: '复制', copiedLabel: '已复制' }, footnotes: '注释' }

// Markdown 渲染包一层错误边界：宿主 MarkdownText 需要 labels，且万一抛错也不整页白屏，
// 而是显示错误 + 原文兜底（知识浏览页应当永远能看到内容）。
class MarkdownSafe extends React.Component {
  constructor(p) { super(p); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err: String(err?.message ?? err) } }
  render() {
    if (this.state.err) {
      return (
        <div className="zw-ykw-md">
          <Intro>Markdown 渲染出错：{this.state.err}（以下为原文）</Intro>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--zw-fs-sm)' }}>{this.props.text}</pre>
        </div>
      )
    }
    return <MarkdownText text={this.props.text} labels={MARKDOWN_LABELS} />
  }
}

function WikiPage() {
  const [tab, setTab] = useState('sites')
  const [data, setData] = useState(null)
  const [site, setSite] = useState(null)
  const [err, setErr] = useState(null)
  const load = useCallback(async () => { try { setData(await wikiApi()) } catch (e) { setErr(e.message) } }, [])
  useEffect(() => { load() }, [load])
  const openSite = async (key) => { try { setSite(await wikiApi(key)); setTab('site') } catch (e) { setErr(e.message) } }
  const sites = Object.entries(data?.index?.sites ?? {})
  const doneCount = sites.filter(([, v]) => v.status === 'done').length
  return (
    <div className="zw-yonkik-wiki">
      <h2>YONKIK 知识库</h2>
      <div className="zw-ykw-root">记忆根 {data?.root ?? '…'} ｜ 站点 {sites.length}（已探 {doneCount}）｜ 脚本 {data?.scripts?.length ?? 0}</div>
      {err && <Intro>{err}</Intro>}
      <div className="zw-ykw-tabs">
        {WIKI_TABS.map(([id, label]) => (
          <button key={id} type="button" data-active={tab === id ? '' : undefined} onClick={() => { setTab(id); if (id !== 'site') setSite(null) }}>{label}</button>
        ))}
      </div>
      {tab === 'sites' && (
        <div className="zw-ykw-list">
          {sites.map(([key, v]) => (
            <div key={key} className="zw-ykw-site" onClick={() => openSite(key)}>
              <span className="zw-ykw-badge" data-status={v.status}>{v.status}</span>
              <span className="zw-ykw-site-name">{key}</span>
              <span className="zw-ykw-site-label">{v.signals?.label ?? v.summary ?? ''}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'site' && site && <SiteDetail site={site} onBack={() => { setSite(null); setTab('sites') }} />}
      {tab === 'playbook' && <div className="zw-ykw-md"><MarkdownSafe text={data?.playbook ?? ''} /></div>}
      {tab === 'sso' && <SsoView sso={data?.sso} />}
      {tab === 'scripts' && (
        <table className="zw-ykw-table">
          <thead><tr><th>脚本</th><th>位置</th></tr></thead>
          <tbody>{(data?.scripts ?? []).map(s => <tr key={s}><td>{s}</td><td>~/.yonkik/scripts/</td></tr>)}</tbody>
        </table>
      )}
      {tab === 'memory' && <div className="zw-ykw-md"><MarkdownSafe text={data?.memory ?? ''} /></div>}
    </div>
  )
}

function SiteDetail({ site, onBack }) {
  const ep = site.endpoints ?? {}
  const verified = ep.verified ?? []
  const unverified = ep.unverified ?? []
  return (
    <div className="zw-ykw-section">
      <button type="button" className="zw-ykw-back" onClick={onBack}>← 返回站点列表</button>
      <h2>{site.key}</h2>
      {site.site && <div className="zw-ykw-root">origin {site.site.origin} ｜ API {site.site.apiUrl ?? '—'} ｜ 限流 {site.site.rateLimit?.minIntervalMs ?? '?'}ms ｜ 鉴权 {site.site.auth?.type ?? '—'}</div>}
      {site.wiki && <div className="zw-ykw-md"><MarkdownSafe text={site.wiki} /></div>}
      {verified.length > 0 && <>
        <div className="zw-ykw-h3">已验证接口（{verified.length}）</div>
        <table className="zw-ykw-table">
          <thead><tr><th>id</th><th>method</th><th>path</th><th>用途</th></tr></thead>
          <tbody>{verified.map(e => <tr key={e.id}><td>{e.id}</td><td>{e.method}</td><td>{e.path}</td><td>{e.purpose ?? ''}</td></tr>)}</tbody>
        </table>
      </>}
      {unverified.length > 0 && <>
        <div className="zw-ykw-h3">候选 / 疑似写（{unverified.length}，不调用）</div>
        <table className="zw-ykw-table">
          <thead><tr><th>id</th><th>method</th><th>path</th><th>原因</th></tr></thead>
          <tbody>{unverified.map(e => <tr key={e.id}><td>{e.id}</td><td>{e.method}</td><td>{e.path}</td><td>{e.reason ?? e.suspected ?? ''}</td></tr>)}</tbody>
        </table>
      </>}
      {site.reconScripts?.length > 0 && <>
        <div className="zw-ykw-h3">分析脚本（{site.reconScripts.length}）</div>
        <div className="zw-ykw-root">{site.reconScripts.join('、')}</div>
      </>}
      {site.hasCrawler && <div className="zw-ykw-root">crawler.mjs ✓（只读爬虫）</div>}
    </div>
  )
}

function SsoView({ sso }) {
  const families = Object.entries(sso?.families ?? {})
  if (!families.length) return <Intro>暂无 SSO 家族记录。</Intro>
  return (
    <div className="zw-ykw-section">
      {families.map(([id, f]) => (
        <Card key={id} title={id} detail={f.idp} defaultOpen>
          <div className="zw-ykw-root">凭据键 {f.credentialKey} ｜ 成员 {(f.members ?? []).join('、')}</div>
          {f.evidence && <Intro>{f.evidence}</Intro>}
        </Card>
      ))}
    </div>
  )
}