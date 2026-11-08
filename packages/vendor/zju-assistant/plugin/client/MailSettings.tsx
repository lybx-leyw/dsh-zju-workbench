import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert, Field } from './controls.tsx'
import { errorText, campusApi } from './api.ts'
import { linkProps } from './campus.ts'

export interface MailStatus { enabled: boolean; connected: boolean; address: string; connectedAt: string; busy: boolean }

/** 插件页只管理连接；邮件查询、起草和发送都由对话里的助手处理。 */
export function MailSettings({ onStatus }: { onStatus: (status: MailStatus) => void }) {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [address, setAddress] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lock = useRef(false), active = useRef(true), addressEdited = useRef(false)
  const statusCallback = useRef(onStatus); statusCallback.current = onStatus
  const show = useCallback((value: MailStatus) => { setStatus(value); statusCallback.current(value) }, [])
  const reload = useCallback(async () => {
    const value = await campusApi<MailStatus>('mail-status')
    if (!active.current) return
    show(value)
    if (!addressEdited.current) setAddress(value.address)
  }, [show])
  useEffect(() => {
    active.current = true
    const refresh = () => { if (!lock.current) void reload().catch(err => { if (active.current) setError(errorText(err)) }) }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { active.current = false; window.removeEventListener('focus', refresh) }
  }, [reload])
  async function work(task: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError(''); setNotice('')
    try { await task() } catch (err) { if (active.current) setError(errorText(err)) }
    finally { lock.current = false; if (active.current) setBusy(false) }
  }
  async function connect() {
    const next = await campusApi<MailStatus>('mail-connect', { address, password })
    if (!active.current) return
    addressEdited.current = false; setAddress(next.address); setPassword(''); show(next)
    setNotice('邮箱已连接，可以在对话里让助手查信、写信或回复。')
  }
  return <div className="campus-mail-settings">
    {error && <Alert>{error}{!status && <Button size="sm" variant="outline" disabled={busy} onClick={() => { void work(reload) }}>重试</Button>}</Alert>}
    {notice && <p className="campus-text" role="status">{notice}</p>}
    <section className="campus-section" aria-label="邮箱账号">
      <div className="campus-titleline"><h2 className="campus-section-title">邮箱账号</h2><Tag tone={status?.connected ? undefined : 'warning'}>{status?.connected ? '已连接' : '待连接'}</Tag></div>
      <form className="campus-form" onSubmit={event => { event.preventDefault(); void work(connect) }}>
        <div className="campus-form-grid">
          <Field id="mail-address" label="浙大邮箱地址"><input id="mail-address" type="email" className="campus-input" autoComplete="username" placeholder="学号@zju.edu.cn" value={address} disabled={busy} onChange={e => { addressEdited.current = true; setAddress(e.target.value) }} required /></Field>
          <Field id="mail-password" label="客户端专用密码"><input id="mail-password" type="password" className="campus-input" autoComplete="new-password" placeholder={status?.connected ? '填写新密码以更新连接' : '填写网页版生成的专用密码'} value={password} disabled={busy} onChange={e => { setPassword(e.target.value) }} required minLength={16} maxLength={16} /></Field>
        </div>
        <div className="campus-form-foot">
          <Button type="submit" size="sm" disabled={busy || !status || password.length !== 16 || !address.trim()}>{busy ? '处理中…' : status?.connected ? '更新连接' : '连接邮箱'}</Button>
          {status?.connected && <>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void work(async () => { show(await campusApi<MailStatus>('mail-test')); setNotice('收信和发信连接正常。') }) }}>测试连接</Button>
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void work(async () => { const next = await campusApi<MailStatus>('mail-disconnect'); addressEdited.current = false; setAddress(''); setPassword(''); show(next); setNotice('已断开连接并移除保存的专用密码。') }) }}>断开连接</Button>
          </>}
        </div>
      </form>
      <details className="campus-mail-help">
        <summary>如何获取客户端专用密码</summary>
        <ol>
          <li>打开浙大邮箱网页版并登录，按提示完成二次验证。</li>
          <li>点击左下角「设置 → 安全设置 → 客户端专用密码」，选择「生成专用密码」。</li>
          <li>名称可填“校园智能体”，复制生成的 <strong>16 位专用密码</strong>，回到这里粘贴并连接。</li>
        </ol>
        <div className="campus-mail-help-links">
          <a {...linkProps('https://mail.zju.edu.cn')}><span>打开邮箱获取专用密码 ↗</span><small>https://mail.zju.edu.cn</small></a>
          <a {...linkProps('https://mail.zju.edu.cn/coremail/help/2fa_zh_CN.html')}><span>打开官方图文教程 ↗</span><small>https://mail.zju.edu.cn/coremail/help/2fa_zh_CN.html</small></a>
        </div>
      </details>
    </section>
  </div>
}
