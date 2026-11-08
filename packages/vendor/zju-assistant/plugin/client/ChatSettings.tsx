import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { campusApi, errorText } from './api.ts'
import { pickFolder } from './campus.ts'
import { Alert, Field, Select } from './controls.tsx'
import { dateText, clock } from './when.ts'

type Platform = 'wechat' | 'dingtalk'
interface Person {
  id: string
  name: string
  isOwner?: boolean
  /** 最近 30 天在这个聊天里发了几条（只有「最近发言」里的人有）。 */
  count?: number
}
interface Chat {
  id: string
  name: string
  kind: string
  profile?: string
}
interface Track extends Chat {
  key: string
  audience: 'all' | 'managers' | 'selected'
  mode: 'original' | 'summary'
  senders: Person[]
  error: string | null
  checkedAt: string | null
  /** 最近一次 AI 整理跳过了几条闲聊（没有生成通知的）。 */
  skipped?: number
}
interface Snapshot {
  platform: Platform
  enabled: boolean
  busy: boolean
  /** 正在同步（立即同步或定时同步）；busy 连查找聊天、改设置也算上。 */
  syncing: boolean
  running: boolean | null
  checkedAt: string | null
  error: string | null
  intervalMinutes: number
  tracks: Track[]
}
interface Page {
  chats?: Chat[]
  members?: Person[]
  /** 最近 30 天发过言的人，发得多的在前；名字取自他们的消息。 */
  recent?: Person[]
  messages?: Message[]
  nextCursor?: string | null
  hasMore: boolean
  roleCoverage?: string
}
export interface Message {
  id: string
  sentAt?: string
  sender?: { name?: string }
  text?: string
  title?: string
  summary?: string
  description?: string
  type?: string
  reference?: Message
  items?: Message[]
}
export function ChatMessage({ message }: { message: Message }) {
  const at = message.sentAt ? new Date(message.sentAt) : null
  return (
    <div className="campus-chat-message">
      {(message.sender?.name || at) && (
        <div className="campus-wechat-meta">
          {message.sender?.name}
          {at && Number.isFinite(at.getTime()) ? ` · ${dateText(at.getTime(), Date.now())} ${clock(at)}` : ''}
        </div>
      )}
      <div className="campus-chat-text">
        {message.text ||
          message.title ||
          message.summary ||
          message.description ||
          `[${({ image: '图片', voice: '语音', video: '视频', file: '文件', sticker: '表情' } as Record<string, string>)[message.type || ''] || message.type || '消息'}]`}
      </div>
      {message.reference && (
        <blockquote>
          <ChatMessage message={message.reference} />
        </blockquote>
      )}
      {message.items?.map((item, i) => (
        <blockquote key={item.id || i}>
          <ChatMessage message={item} />
        </blockquote>
      ))}
    </div>
  )
}
const call = <T,>(platform: Platform, operation: string, input: Record<string, unknown> = {}) =>
  campusApi<T>('chat-watch-' + operation, { platform, ...input })

function ChatPicker({
  platform,
  watching,
  onClose,
  onAdded
}: {
  platform: Platform
  /** 已经在监控的聊天：列表里标「已监控」，不再给监控按钮。 */
  watching: readonly Chat[]
  onClose: () => void
  onAdded: (data: Snapshot) => void
}) {
  const [query, setQuery] = useState(''),
    [profile, setProfile] = useState(''),
    [profiles, setProfiles] = useState<{ id: string; uid: string }[]>([])
  // 查找和添加分开记：点一个聊天的「监控」只让那一个按钮等着，查找和别的聊天照常能点。
  const [data, setData] = useState<Page | null>(null),
    [searching, setSearching] = useState(false),
    [adding, setAdding] = useState<string[]>([]),
    [error, setError] = useState(''),
    [added, setAdded] = useState<string[]>([])
  const generation = useRef(0),
    [ready, setReady] = useState(platform === 'wechat')
  useEffect(() => {
    let active = true
    if (platform === 'dingtalk')
      call<{ profiles: { id: string; uid: string }[] }>(platform, 'profiles').then(
        (r) => {
          if (active) {
            setProfiles(r.profiles)
            if (r.profiles.length === 1) setProfile(r.profiles[0].id)
            setReady(true)
          }
        },
        (e) => {
          if (active) setError(errorText(e))
        }
      )
    return () => {
      active = false
      generation.current++
    }
  }, [platform])
  useEffect(() => {
    generation.current++
    setData(null)
    setAdded([])
  }, [query, profile])
  const search = async (more = false) => {
    const current = ++generation.current
    setSearching(true)
    setError('')
    try {
      const next = await call<Page>(platform, 'find', {
        query,
        profile,
        ...(more ? { cursor: data?.nextCursor } : {})
      })
      if (current === generation.current)
        setData((old) => ({
          ...next,
          chats: more ? [...(old?.chats || []), ...(next.chats || [])] : next.chats
        }))
    } catch (e) {
      if (current === generation.current) setError(errorText(e))
    } finally {
      setSearching(false)
    }
  }
  const add = async (chat: Chat) => {
    setAdding((old) => [...old, chat.id])
    setError('')
    try {
      onAdded(await call<Snapshot>(platform, 'add', { id: chat.id, profile }))
      setAdded((old) => [...old, chat.id])
    } catch (e) {
      setError(errorText(e))
    } finally {
      setAdding((old) => old.filter((id) => id !== chat.id))
    }
  }
  return (
    <Modal
      open
      title="选择要监控的聊天"
      closeLabel="关闭"
      className="campus-chat-picker-dialog"
      contentClassName="campus-chat-picker-content"
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          完成
        </Button>
      }
    >
      <div className="campus-section">
        {profiles.length > 1 && (
          <Field label="本地账号">
            <Select
              label="本地账号"
              value={profile}
              options={profiles.map((p) => ({ value: p.id, label: p.uid }))}
              onChange={setProfile}
            />
          </Field>
        )}
        <form
          className="campus-chat-search"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <input
            className="campus-input"
            aria-label="聊天名称"
            placeholder="群名或联系人名称，留空列出最近聊天"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button
            variant="outline"
            type="submit"
            disabled={searching || !ready || (profiles.length > 1 && !profile)}
          >
            {searching ? '读取中…' : '查找'}
          </Button>
        </form>
        {error && <Alert>{error}</Alert>}
        <div className="campus-wechat-picker campus-chat-pick-list">
          <ul className="campus-rows">
            {data?.chats?.map((chat) => {
              // 钉钉可能有几个本地账号，同一个会话 id 要连账号一起比；微信只有一个账号，监控时才定下来，只比 id。
              const watched = watching.some((t) => t.id === chat.id && (!profile || !t.profile || t.profile === profile))
              return (
                <li className="campus-row" key={chat.id}>
                  <div className="campus-wechat-main">
                    <span className="campus-row-title">{chat.name}</span>
                    <span className="campus-wechat-meta">{chat.kind === 'group' ? '群聊' : '个人聊天'}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={watched || adding.includes(chat.id) || added.includes(chat.id)}
                    onClick={() => {
                      void add(chat)
                    }}
                  >
                    {added.includes(chat.id) ? '已添加' : watched ? '已监控' : adding.includes(chat.id) ? '添加中…' : '监控'}
                  </Button>
                </li>
              )
            })}
          </ul>
          {data?.chats?.length === 0 && <p className="campus-note">没有匹配的聊天。</p>}
          {data?.hasMore && (
            <Button
              variant="outline"
              disabled={searching}
              onClick={() => {
                void search(true)
              }}
            >
              更多聊天
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}

function PeoplePicker({
  platform,
  track,
  onClose,
  onSave
}: {
  platform: Platform
  track: Track
  onClose: () => void
  onSave: (people: Person[]) => Promise<void>
}) {
  const [query, setQuery] = useState(''),
    [people, setPeople] = useState<Person[]>(track.senders),
    [data, setData] = useState<Page | null>(null),
    [searching, setSearching] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('')
  const generation = useRef(0)
  const search = async (more = false) => {
    const current = ++generation.current
    setSearching(true)
    setError('')
    try {
      const next = await call<Page>(platform, 'members', {
        id: track.id,
        profile: track.profile,
        query,
        ...(more ? { cursor: data?.nextCursor } : {})
      })
      if (current === generation.current)
        setData((old) => ({
          ...next,
          members: more ? [...(old?.members || []), ...(next.members || [])] : next.members
        }))
    } catch (e) {
      if (current === generation.current) setError(errorText(e))
    } finally {
      setSearching(false)
    }
  }
  useEffect(() => {
    void search()
    return () => {
      generation.current++
    }
  }, [])
  // 勾选只改这个窗口里的名单，读成员时照样能勾；只有保存时才锁住。
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave(people)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setSaving(false)
    }
  }
  return (
    <Modal
      open
      title={`选择发送者 · ${track.name}`}
      closeLabel="关闭"
      onClose={onClose}
      footer={
        <Button
          variant="outline"
          disabled={saving}
          onClick={() => {
            void save()
          }}
        >
          保存选择（{people.length}）
        </Button>
      }
    >
      <div className="campus-section">
        <form
          className="campus-chat-search"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <input
            className="campus-input"
            aria-label="成员名称"
            placeholder="搜索群成员"
            value={query}
            onChange={(e) => {
              generation.current++
              setData(null)
              setQuery(e.target.value)
            }}
          />
          <Button type="submit" variant="outline" disabled={searching || saving}>
            {searching ? '读取中…' : '查找'}
          </Button>
        </form>
        {error && <Alert>{error}</Alert>}
        {people.length > 0 && (
          <div className="campus-chat-selected">
            {people.map((p) => (
              <button
                type="button"
                className="campus-textlink"
                key={p.id}
                disabled={saving}
                aria-label={`取消选择 ${p.name}`}
                onClick={() => setPeople((old) => old.filter((v) => v.id !== p.id))}
              >
                {p.name} ×
              </button>
            ))}
          </div>
        )}
        <div className="campus-wechat-picker">
          {!!data?.recent?.length && <p className="campus-note">最近发言</p>}
          <ul className="campus-rows">
            {data?.recent?.map((p) => (
              <li className="campus-row" key={'recent:' + p.id}>
                <label className="campus-chat-person">
                  <input
                    type="checkbox"
                    checked={people.some((v) => v.id === p.id)}
                    disabled={saving}
                    onChange={(e) =>
                      setPeople((old) =>
                        e.target.checked ? [...old, { id: p.id, name: p.name }] : old.filter((v) => v.id !== p.id)
                      )
                    }
                  />
                  <span>
                    {p.name}
                    {p.isOwner ? ' · 群主' : ''}
                    {p.count ? ` · 近 30 天 ${p.count} 条` : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {!!data?.recent?.length && !!data?.members?.length && <p className="campus-note">其他成员</p>}
          <ul className="campus-rows">
            {data?.members?.filter((p) => !data?.recent?.some((r) => r.id === p.id)).map((p) => (
              <li className="campus-row" key={p.id}>
                <label className="campus-chat-person">
                  <input
                    type="checkbox"
                    checked={people.some((v) => v.id === p.id)}
                    disabled={saving}
                    onChange={(e) =>
                      setPeople((old) => (e.target.checked ? [...old, p] : old.filter((v) => v.id !== p.id)))
                    }
                  />
                  <span>
                    {p.name}
                    {p.isOwner ? ' · 群主' : ''}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {data?.hasMore && (
            <Button
              variant="outline"
              disabled={searching || saving}
              onClick={() => {
                void search(true)
              }}
            >
              更多成员
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
function History({ platform, track, onClose }: { platform: Platform; track: Track; onClose: () => void }) {
  const [data, setData] = useState<Page | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    alive = useRef(true)
  const read = async (more = false) => {
    setBusy(true)
    try {
      const next = await call<Page>(platform, 'read', {
        id: track.id,
        profile: track.profile,
        ...(more ? { cursor: data?.nextCursor } : {})
      })
      if (alive.current)
        setData((old) => ({
          ...next,
          messages: more ? [...(old?.messages || []), ...(next.messages || [])] : next.messages
        }))
    } catch (e) {
      if (alive.current) setError(errorText(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  useEffect(() => {
    alive.current = true
    void read()
    return () => {
      alive.current = false
    }
  }, [])
  return (
    <Modal
      open
      title={track.name}
      closeLabel="关闭"
      onClose={onClose}
      footer={
        <Button variant="outline" onClick={onClose}>
          关闭
        </Button>
      }
    >
      <div className="campus-section">
        {error && <Alert>{error}</Alert>}
        <div className="campus-chat-history">
          {data?.messages?.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
          {busy && <p className="campus-note">正在读取…</p>}
          {data?.messages?.length === 0 && <p className="campus-note">本机暂时没有这个聊天的消息。</p>}
        </div>
        {data?.hasMore && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              void read(true)
            }}
          >
            更早的消息
          </Button>
        )}
      </div>
    </Modal>
  )
}

/** 聊天数据从哪读（host 的 ChatWatch.location）：dataDir 是用户选的文件夹，空串是自动找；folder 是实际读的那一处。 */
interface Place {
  dataDir: string
  folder: string
  error: string | null
}
/**
 * 聊天数据位置：很多人把微信、钉钉的数据挪出了 C 盘，自动找不到时在这里选文件夹，或者把路径粘贴进来。
 * onProblem 收到这里正显示的那句提示（没有时是空串），下面「监控的聊天」里同一句就不再重复。
 */
function DataFolder({ platform, onProblem }: { platform: Platform; onProblem: (message: string) => void }) {
  const [place, setPlace] = useState<Place | null>(null),
    [draft, setDraft] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const alive = useRef(true)
  const problem = error || place?.error || ''
  useEffect(() => {
    onProblem(problem)
  }, [problem, onProblem])
  useEffect(() => {
    alive.current = true
    call<Place>(platform, 'location').then(
      (next) => {
        if (alive.current) setPlace(next)
      },
      (e) => {
        if (alive.current) setError(errorText(e))
      }
    )
    return () => {
      alive.current = false
    }
  }, [platform])
  const choose = async (dataDir: string) => {
    setBusy(true)
    setError('')
    try {
      const next = await call<Place>(platform, 'relocate', { dataDir })
      if (alive.current) {
        setPlace(next)
        setDraft('')
      }
    } catch (e) {
      if (alive.current) setError(errorText(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const browse = async () => {
    setError('')
    let picked: string | null
    try {
      picked = await pickFolder()
    } catch {
      setError('没能打开选择文件夹的窗口，可以把文件夹路径粘贴到下面。')
      return
    }
    if (picked) await choose(picked)
  }
  return (
    <section className="campus-section">
      <div className="campus-section-head">
        <h2 className="campus-section-title">聊天数据位置</h2>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void browse()}>
          {busy ? '查找中…' : '选择文件夹'}
        </Button>
      </div>
      {place ? (
        <p className="campus-note campus-chat-folder">
          {place.folder || '没有找到聊天数据'}
          {place.dataDir ? ' · 选定的位置 · ' : ' · 自动查找'}
          {place.dataDir && (
            <button type="button" className="campus-textlink" disabled={busy} onClick={() => void choose('')}>
              改回自动查找
            </button>
          )}
        </p>
      ) : (
        !error && <p className="campus-note">正在查找…</p>
      )}
      {(error || place?.error) && <Alert tone="warn">{error || place?.error}</Alert>}
      <form
        className="campus-chat-search"
        onSubmit={(e) => {
          e.preventDefault()
          if (draft.trim()) void choose(draft.trim())
        }}
      >
        <input
          className="campus-input"
          aria-label="聊天数据文件夹路径"
          placeholder="或者粘贴文件夹路径"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <Button variant="outline" type="submit" disabled={busy || !draft.trim()}>
          使用
        </Button>
      </form>
    </section>
  )
}

export function ChatSettings({ platform }: { platform: Platform }) {
  const [data, setData] = useState<Snapshot | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState<string[]>([]),
    [adding, setAdding] = useState(false),
    [people, setPeople] = useState<Track | null>(null),
    [history, setHistory] = useState<Track | null>(null),
    [folderProblem, setFolderProblem] = useState('')
  const alive = useRef(true)
  const reload = useCallback(async () => {
    try {
      const next = await call<Snapshot>(platform, 'snapshot')
      if (alive.current) setData(next)
    } catch (e) {
      if (alive.current) setError(errorText(e))
    }
  }, [platform])
  useEffect(() => {
    alive.current = true
    void reload()
    const timer = window.setInterval(() => {
      void reload()
    }, 3000)
    return () => {
      alive.current = false
      window.clearInterval(timer)
    }
  }, [reload])
  // pending 记着在等结果的是哪一处：'refresh'、'interval'，或者某个聊天的 key。只锁住那一处，别的照常能点。
  const change = async (where: string, op: string, input: Record<string, unknown> = {}) => {
    setPending((old) => [...old, where])
    setError('')
    try {
      const next = await call<Snapshot>(platform, op, input)
      if (alive.current) setData(next)
    } catch (e) {
      if (alive.current) setError(errorText(e))
      throw e
    } finally {
      if (alive.current) setPending((old) => old.filter((item) => item !== where))
    }
  }
  const run = (where: string, op: string, input: Record<string, unknown> = {}) => {
    void change(where, op, input).catch(() => {})
  }
  if (!data) return error ? <Alert>{error}</Alert> : <p className="campus-note">正在读取设置…</p>
  // 「同步中…」只看同步本身，后台在查找聊天、改设置不算。
  const syncing = pending.includes('refresh') || data.syncing
  // 没读到的原因按原话归拢：几个聊天是同一个原因（多半是数据位置不对）时在列表上面说一次，
  // 「聊天数据位置」里已经说了的不再说；只有一个聊天的原因跟在它那一行下面，一行小字（2026-11-04）。
  const reasons = new Map<string, number>()
  for (const track of data.tracks) if (track.error) reasons.set(track.error, (reasons.get(track.error) ?? 0) + 1)
  const shared = [...reasons].filter(([reason, count]) => count > 1 && reason !== folderProblem)
  const ownReason = (track: Track) => (track.error && reasons.get(track.error) === 1 && track.error !== folderProblem ? track.error : '')
  return (
    <>
      {(error || data.error) && <Alert>{error || data.error}</Alert>}
      <section className="campus-section">
        <div className="campus-section-head">
          <h2 className="campus-section-title">自动同步</h2>
          <Button variant="outline" size="sm" disabled={syncing} onClick={() => run('refresh', 'refresh')}>
            {syncing ? '同步中…' : '立即同步'}
          </Button>
        </div>
        <p className="campus-note">
          {data.running === false
            ? `${platform === 'wechat' ? '微信' : '钉钉'}未运行，打开后继续同步。`
            : data.running
              ? '客户端正在运行。'
              : '等待检查客户端。'}
          {data.checkedAt ? ` 上次检查 ${clock(new Date(data.checkedAt))}` : ''}
        </p>
        <Field label="同步间隔">
          <Select
            label="同步间隔"
            value={String(data.intervalMinutes)}
            disabled={pending.includes('interval')}
            options={[1, 3, 5, 10, 15, 30, 60].map((n) => ({ value: String(n), label: `每 ${n} 分钟` }))}
            onChange={(value) => run('interval', 'set', { intervalMinutes: Number(value) })}
          />
        </Field>
      </section>
      <DataFolder platform={platform} onProblem={setFolderProblem} />
      <section className="campus-section">
        <div className="campus-section-head">
          <h2 className="campus-section-title">监控的聊天</h2>
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            添加聊天
          </Button>
        </div>
        {!data.tracks.length && (
          <p className="campus-note">还没有监控的聊天。</p>
        )}
        {shared.map(([reason, count]) => (
          <Alert tone="warn" key={reason}>
            {count === data.tracks.length ? '监控的聊天这次都没读到' : `有 ${count} 个聊天这次没读到`}：{reason}
          </Alert>
        ))}
        {/* 一个聊天一行：名字（点开看收到的消息）、接收谁的消息、放进通知的方式、停止监控；两个下拉框的说明只在表头写一次。 */}
        {!!data.tracks.length && (
          <div className="campus-chat-tracks">
            <div className="campus-chat-tracks-head" aria-hidden="true">
              <span>聊天</span>
              <span>接收谁的消息</span>
              <span>放进通知的方式</span>
              <span />
            </div>
            {data.tracks.map((track) => {
              const locked = pending.includes(track.key),
                reason = ownReason(track)
              return (
                <div className="campus-chat-track" key={track.key}>
                  <button
                    type="button"
                    className="campus-textlink campus-chat-name"
                    title={track.name}
                    onClick={() => setHistory(track)}
                  >
                    {track.name}
                  </button>
                  <Select
                    label={`${track.name}：接收谁的消息`}
                    value={track.audience}
                    disabled={locked}
                    options={[
                      { value: 'all', label: '所有人' },
                      ...(track.kind === 'group'
                        ? [
                            { value: 'managers', label: '群主和指定管理员' },
                            { value: 'selected', label: '指定成员' }
                          ]
                        : [])
                    ]}
                    onChange={(value) => run(track.key, 'set', { key: track.key, audience: value })}
                  />
                  <Select
                    label={`${track.name}：放进通知的方式`}
                    value={track.mode}
                    disabled={locked}
                    options={[
                      { value: 'original', label: '原样收集' },
                      { value: 'summary', label: 'AI 总结整理' }
                    ]}
                    onChange={(value) => run(track.key, 'set', { key: track.key, mode: value })}
                  />
                  <button
                    type="button"
                    className="campus-textlink campus-chat-stop"
                    disabled={locked}
                    onClick={() => run(track.key, 'remove', { key: track.key })}
                  >
                    停止监控
                  </button>
                  {reason && <p className="campus-note campus-chat-problem">这次没读到：{reason}</p>}
                  {/* 改动排在同步后面做，同步要读消息、AI 整理时会等上一阵。 */}
                  {locked && syncing && <p className="campus-note">正在同步，同步完就改好。</p>}
                  {track.audience !== 'all' && (
                    <div className="campus-chat-selected">
                      <span className="campus-note">
                        {track.senders.map((p) => p.name).join('、') ||
                          (track.audience === 'managers' ? '当前仅接收群主' : '尚未选择成员')}
                      </span>
                      <Button variant="outline" size="sm" disabled={locked} onClick={() => setPeople(track)}>
                        选择成员
                      </Button>
                    </div>
                  )}
                  {track.mode === 'summary' && !!track.skipped && <p className="campus-note">这次整理跳过 {track.skipped} 条闲聊。</p>}
                </div>
              )
            })}
          </div>
        )}
      </section>
      {adding && <ChatPicker platform={platform} watching={data.tracks} onClose={() => setAdding(false)} onAdded={setData} />}
      {people && (
        <PeoplePicker
          platform={platform}
          track={people}
          onClose={() => setPeople(null)}
          onSave={(senders) => change(people.key, 'set', { key: people.key, senders })}
        />
      )}
      {history && <History platform={platform} track={history} onClose={() => setHistory(null)} />}
    </>
  )
}
