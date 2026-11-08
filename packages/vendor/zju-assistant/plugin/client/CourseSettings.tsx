/**
 * 「课程与学习」配置页账号表单下面的一块：学习通的作业接不接校园事务。默认不接：有的课学习通只是放课件的地方，
 * 上面挂着的任务老师并不管。开关存在引擎侧（host/affairs.mjs），改了马上存，校园事务和日程表下一次打开就照新的来。
 */
import { useEffect, useRef, useState } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { errorText, campusApi } from './api.ts'
import { Alert } from './controls.tsx'

interface Settings { chaoxingHomework: boolean }

export function CourseSettings() {
  const [data, setData] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const apply = (next: Settings) => { if (alive.current) { setData(next); setError('') } }
  const fail = (reason: unknown) => { if (alive.current) setError(errorText(reason)) }
  useEffect(() => { campusApi<Settings>('affairs-settings-read').then(apply, fail) }, [])
  const save = (chaoxingHomework: boolean) => {
    // 先照改过的显示，存不成再报错。
    setData({ chaoxingHomework })
    campusApi<Settings>('affairs-settings-save', { chaoxingHomework }).then(apply, (reason: unknown) => { setData({ chaoxingHomework: !chaoxingHomework }); fail(reason) })
  }

  if (!data) return error ? <Alert>{error}</Alert> : null
  return (
    <section className="campus-section" aria-labelledby="course-chaoxing-homework">
      <h2 id="course-chaoxing-homework" className="campus-section-title">学习通作业</h2>
      {error && <Alert>{error}</Alert>}
      <div className="campus-linkrow">
        <span>接入校园事务</span>
        <Switch label="把学习通的作业接入校园事务" checked={data.chaoxingHomework} onChange={save} />
      </div>
      <p className="campus-note">列出学习任务里有截止时间的作业和测试，也会排进日程表。只读取，不提交，不记学习进度。</p>
    </section>
  )
}
