import React, { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, fromShanghaiLocal, groupWeek, isAfterDue, overlappingIds, overlaps, shanghaiDate, toShanghaiLocal, weekStart } from '@lybx-leyw/dsh-zju-core-planning/browser';

const emptyForm = (taskKey = '') => ({ taskKey, title: '', start: '', end: '' });
const errorText = (error) => error?.message || String(error || '操作失败，请重试');
export function ScheduleView({ tasks = [], slots = [], onSave, onRemove, selectedTaskKey, onSelectTask, weekAnchor, onWeekChange }) {
  const [internalAnchor, setInternalAnchor] = useState(() => weekStart());
  const anchor = weekAnchor ?? internalAnchor;
  const setAnchor = onWeekChange ?? setInternalAnchor;
  const [form, setForm] = useState(() => emptyForm(selectedTaskKey));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const formRef = useRef(null);
  const busy = useRef(false);
  const revision = useRef(0);
  const taskMap = useMemo(() => new Map(tasks.map((task) => [task.taskKey, task])), [tasks]);
  const days = useMemo(() => groupWeek(slots, `${anchor}T12:00:00+08:00`), [slots, anchor]);
  const conflicts = useMemo(() => overlappingIds(slots), [slots]);
  useEffect(() => {
    revision.current += 1;
    setForm(emptyForm(selectedTaskKey || ''));
    setError(''); setNotice('');
    if (selectedTaskKey) formRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selectedTaskKey]);
  function update(patch) { revision.current += 1; setForm((old) => ({ ...old, ...patch })); setError(''); setNotice(''); }
  function edit(slot) {
    revision.current += 1;
    setForm({ id: slot.id, taskKey: slot.taskKey, title: slot.title || '', start: toShanghaiLocal(slot.start), end: toShanghaiLocal(slot.end) });
    setError(''); setNotice('');
    formRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }
  const task = taskMap.get(form.taskKey);
  const preview = { start: fromShanghaiLocal(form.start), end: fromShanghaiLocal(form.end) };
  const previewConflict = preview.start && preview.end && slots.some((slot) => slot.id !== form.id && overlaps(preview, slot));
  async function save(event) {
    event.preventDefault();
    if (busy.current) return;
    if (!form.taskKey || (!task && !form.id)) { setError('请选择一个 DDL'); return; }
    if (!preview.start || !preview.end || Date.parse(preview.start) >= Date.parse(preview.end)) { setError('请输入有效的起止时间，结束须晚于开始'); return; }
    if (typeof onSave !== 'function') { setError('保存暂不可用'); return; }
    busy.current = true; setPending(true); setError(''); setNotice('');
    const savedRevision = revision.current;
    try {
      await onSave({ ...(form.id ? { id: form.id } : {}), taskKey: form.taskKey, title: task?.title || form.title || '历史安排', ...preview });
      if (revision.current === savedRevision) setForm(emptyForm());
      setAnchor(weekStart(preview.start));
      setNotice('安排已保存');
    } catch (err) { setError(errorText(err)); }
    finally { busy.current = false; setPending(false); }
  }
  async function remove(id) {
    if (busy.current) return;
    if (typeof onRemove !== 'function') { setError('删除暂不可用'); return; }
    busy.current = true; setPending(true); setError(''); setNotice('');
    try {
      await onRemove(id);
      if (form.id === id) { revision.current += 1; setForm(emptyForm()); }
      setNotice('安排已删除');
    } catch (err) { setError(errorText(err)); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="zpg-schedule" aria-label="执行日程">
    <header className="zpg-schedule-head"><div><h2>日程表</h2><p>准备什么时候做，而不是最晚何时交。上海时间（UTC+8） · 同一 DDL 可分多段，不改变截止时间。</p></div></header>
    <nav className="zpg-schedule-nav" aria-label="日程周导航">
      <button type="button" onClick={() => setAnchor(addDays(anchor, -7))}>上一周</button>
      <button type="button" onClick={() => setAnchor(weekStart())}>本周</button>
      <button type="button" onClick={() => setAnchor(addDays(anchor, 7))}>下一周</button>
      <strong aria-live="polite">{anchor} — {addDays(anchor, 6)}</strong>
    </nav>
    <div className="zpg-schedule-week">{days.map((day, index) => <section key={day.date} className={`zpg-schedule-day${day.date === shanghaiDate() ? ' is-today' : ''}`} aria-label={`${day.date} 周${'一二三四五六日'[index]}`}>
      <h3>周{'一二三四五六日'[index]} <time dateTime={day.date}>{day.date.slice(5)}</time>{day.date === shanghaiDate() && <small>今天</small>}</h3>
      {!day.entries.length && <p className="zpg-schedule-empty">暂无安排</p>}
      {day.entries.map((slot) => { const linked = taskMap.get(slot.taskKey); return <article key={slot.id} className={`zpg-schedule-block${linked?.done ? ' is-done' : ''}`}>
        <div className="zpg-schedule-time">{slot.continuesBefore ? '承前日 · ' : ''}{toShanghaiLocal(slot.segmentStart).slice(11)} — {toShanghaiLocal(slot.segmentEnd).slice(0, 10) !== toShanghaiLocal(slot.segmentStart).slice(0, 10) && toShanghaiLocal(slot.segmentEnd).slice(11) === '00:00' ? '24:00' : toShanghaiLocal(slot.segmentEnd).slice(11)}{slot.continuesAfter ? ' · 续次日' : ''}</div>
        <strong>{linked?.title || slot.title || '历史安排'}</strong>
        {linked?.done && <span className="zpg-schedule-tag">关联 DDL 已完成</span>}
        {!linked && <span className="zpg-schedule-tag">历史安排 · 关联任务已删除或离线</span>}
        {conflicts.has(slot.id) && <span className="zpg-schedule-warning">与其他安排重叠</span>}
        {isAfterDue(slot, linked) && <span className="zpg-schedule-warning">晚于截止时间</span>}
        <div className="zpg-schedule-actions"><button type="button" disabled={pending} onClick={() => edit(slot)}>编辑</button><button type="button" disabled={pending} onClick={() => remove(slot.id)}>删除</button></div>
      </article>; })}
    </section>)}</div>
    <form ref={formRef} className="zpg-schedule-form" onSubmit={save} aria-busy={pending}>
      <h3>{form.id ? '编辑安排' : '添加执行时间'}</h3>
      <fieldset disabled={pending}><label>关联 DDL<select value={form.taskKey} onChange={(event) => { update({ taskKey: event.target.value }); onSelectTask?.(event.target.value); }} required>
        <option value="">请选择 DDL</option>
        {form.taskKey && !taskMap.has(form.taskKey) && <option value={form.taskKey}>{form.title || '历史任务'}（已删除或离线）</option>}
        {tasks.map((item) => <option key={item.taskKey} value={item.taskKey}>{item.done ? '✓ ' : ''}{item.title}{item.due ? ` · 截止 ${toShanghaiLocal(item.due).replace('T', ' ') || item.due}` : ' · 无截止时间'}</option>)}
      </select></label>
      <label>开始（上海时间）<input type="datetime-local" value={form.start} onChange={(event) => update({ start: event.target.value })} required /></label>
      <label>结束（上海时间）<input type="datetime-local" value={form.end} onChange={(event) => update({ end: event.target.value })} required /></label>
      </fieldset>
      {(previewConflict || isAfterDue(preview, task)) && <p className="zpg-schedule-warning">{previewConflict ? '与其他安排重叠。' : ''}{isAfterDue(preview, task) ? '执行结束晚于截止时间。' : ''}仍可保存，不改变 DDL。</p>}
      <div className="zpg-schedule-actions"><button type="submit" disabled={pending}>{pending ? '处理中…' : form.id ? '保存修改' : '保存安排'}</button><button type="button" disabled={pending} onClick={() => { revision.current += 1; setForm(emptyForm()); setError(''); setNotice(''); }}>清空 / 取消</button></div>
      {pending && <p role="status">正在保存或删除，请稍候…</p>}{error && <p role="alert" className="zpg-schedule-warning">{error}</p>}{notice && <p role="status">{notice}</p>}
    </form>
  </section>;
}
export default ScheduleView;
