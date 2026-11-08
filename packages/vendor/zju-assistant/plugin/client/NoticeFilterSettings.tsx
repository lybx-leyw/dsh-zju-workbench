/**
 * 「校园通知」详情页里的一块：通知太多时怎么收。两样，都存在引擎侧（host/notice-filter.mjs）：
 * 要不要让模型照个人档案把关系不大的收起来；屏蔽词（标题里有就直接收起）。改了马上存，「校园事务」的通知下一次打开就照新的来。
 */
import { useEffect, useRef, useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { Alert, Field, TagPicker } from './controls.tsx'

interface Settings { blocked: string[], byProfile: boolean }

export function NoticeFilterSettings() {
  const [data, setData] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const apply = (next: Settings) => { if (alive.current) { setData(next); setError('') } }
  const fail = (reason: unknown) => { if (alive.current) setError(errorText(reason)) }
  useEffect(() => { campusApi<Settings>('notice-filter-read').then(apply, fail) }, [])
  const save = (patch: Partial<Settings>) => {
    // 先照改过的显示，存不成再报错。
    setData(old => old && { ...old, ...patch })
    campusApi<Settings>('notice-filter-save', patch).then(apply, fail)
  }

  if (!data) return error ? <Alert>{error}</Alert> : null
  return (
    <section className="campus-section" aria-labelledby="notice-filter">
      <h2 id="notice-filter" className="campus-section-title">收起关系不大的通知</h2>
      {error && <Alert>{error}</Alert>}
      <div className="campus-linkrow">
        <span>让模型照个人档案判断</span>
        <Switch label="让模型照个人档案判断" checked={data.byProfile} onChange={(value) => { save({ byProfile: value }) }} />
      </div>
      <Field id="notice-blocked" label="屏蔽词">
        <TagPicker id="notice-blocked" label="屏蔽词" value={data.blocked} known={[]} placeholder="输入一个词后回车" onChange={(blocked) => { save({ blocked }) }} />
      </Field>
    </section>
  )
}
