import React, { useEffect, useRef } from 'react';
import { useStudy } from 'dsh-zhiyun-shell-ui';
import { GenerationProgress } from './generation-progress.jsx';

const pending = job => ['queued', 'running'].includes(job.state);
const labels = { ready: '已完成', partial: '部分完成', failed: '失败', cancelled: '已取消' };

/** Page-local controls; the shared controller and host own the background queue. */
export function GenerationQueue({ controller }) {
  const state = useStudy(controller), trigger = useRef(null), closeButton = useRef(null), panel = useRef(null);
  const jobs = state.jobs ?? [], active = jobs.find(job => job.state === 'running');
  const waiting = jobs.filter(job => job.state === 'queued');
  const history = jobs.filter(job => !pending(job)).slice(-10).reverse();
  const close = () => { controller.setQueueOpen(false); trigger.current?.focus(); };
  function position() {
    const element = panel.current;
    if (!element?.matches(':popover-open')) return;
    const anchor = trigger.current.getBoundingClientRect(), bounds = element.getBoundingClientRect();
    element.style.left = Math.max(16, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 16)) + 'px';
    element.style.top = Math.max(16, Math.min(anchor.bottom + 8, innerHeight - bounds.height - 16)) + 'px';
  }
  useEffect(() => {
    const element = panel.current;
    const toggle = event => controller.setQueueOpen(event.newState === 'open');
    const scroll = event => { if (element.matches(':popover-open') && !element.contains(event.target)) close(); };
    element.addEventListener('toggle', toggle);
    window.addEventListener('resize', position);
    document.addEventListener('scroll', scroll, true);
    return () => {
      element.removeEventListener('toggle', toggle);
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', scroll, true);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [controller]);
  useEffect(() => {
    if (state.queueOpen) { panel.current.showPopover(); position(); closeButton.current?.focus(); }
    else if (panel.current.matches(':popover-open')) panel.current.hidePopover();
  }, [state.queueOpen]);
  useEffect(position, [jobs]);
  return <div className="zs-task-root">
    <button ref={trigger} type="button" className="zs-task-trigger" aria-label="下载与生成任务" aria-expanded={state.queueOpen} aria-controls="zs-task-panel" title={active || waiting.length ? `下载与生成 · ${active ? 1 : 0} 进行中 · ${waiting.length} 等待` : '下载与生成任务'} onClick={() => controller.setQueueOpen(!state.queueOpen)}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg>
      {(active || waiting.length > 0) && <i className="zs-task-dot" aria-hidden="true" />}
    </button>
    <aside ref={panel} popover="auto" id="zs-task-panel" className="zs-task-panel" role="dialog" aria-label="下载与生成队列" aria-modal="false">
      <header><div><strong>下载与生成</strong><p>按加入顺序，每次处理一节课</p></div><button ref={closeButton} type="button" aria-label="收起任务面板" onClick={close}>×</button></header>
      <div className="zs-task-body">
        <section><h3>正在处理 <span>{active ? '1' : '0'}</span></h3>
          {active ? <article className="zs-task-current"><TaskTitle job={active} controller={controller}/><GenerationProgress job={active} disabled={state.busy} onCancel={() => controller.cancel(active)}/></article> : <p className="zs-task-empty">当前没有正在处理的任务。</p>}
        </section>
        <section><h3>接下来 <span>{waiting.length}</span></h3>
          {waiting.length ? <ol className="zs-task-waiting">{waiting.map(job => <li key={job.id}><TaskTitle job={job} controller={controller}/><button type="button" disabled={state.busy} onClick={() => controller.cancel(job)}>移出队列</button></li>)}</ol> : <p className="zs-task-empty">在课堂中点击生成讲义，即可加入队列。</p>}
        </section>
        {history.length > 0 && <section><h3>最近任务</h3>{history.map(job => <article className="zs-task-history" key={job.id}><div className="zs-task-row"><TaskTitle job={job} controller={controller}/><span data-state={job.state}>{labels[job.state]}</span></div><GenerationProgress job={job}/></article>)}</section>}
      </div>
      <footer>课内并发由所选供应商的 worker 总数决定。关闭面板后任务继续。</footer>
    </aside>
  </div>;
}

function TaskTitle({ job, controller }) {
  return <button type="button" className="zs-task-title" onClick={() => controller.openTask(job)} title="打开课堂"><strong>{job.courseTitle ?? job.courseId}</strong><span>{job.lessonTitle ?? job.subId}</span></button>;
}
