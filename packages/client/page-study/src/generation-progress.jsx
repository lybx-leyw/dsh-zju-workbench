import React, { useEffect, useState } from 'react';

const stages = [
  ['source', '读取资料', '项'], ['slides', '读取课件', '页'], ['subtitles', '读取字幕', '句'],
  ['faithful', '识别课件', '页'], ['mix', '清洗与标记', '单元'],
  ['outline', '语义分组', '次'], ['merge', '分级聚合', '次'], ['rebuild', '重构知识树', '点'],
  ['lecture', '按知识点成稿', '点'], ['polish', '逐点终审', '点'],
];
const duration = ms => `${Math.floor(ms / 60000)}分${(ms < 10000 ? (ms / 1000 % 60).toFixed(1) : Math.floor(ms / 1000) % 60)}秒`;

export function GenerationProgress({ job, onCancel, disabled }) {
  const [now, setNow] = useState(Date.now());
  const running = job?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, job?.id]);
  if (!job) return null;
  const elapsed = running ? Math.max(0, now - job.startedAt) : job.elapsedMs ?? 0;
  const observed = new Map((job.progress?.stages ?? [job.progress]).filter(Boolean).map(p => [p.phase, p]));
  return <div className="zs-generation" role="status" aria-live="polite">
    <details open={running}>
      <summary className="zs-generation-heading"><strong>{running ? '正在生成讲义' : ({ ready: '讲义已生成', partial: '生成部分完成', failed: '生成失败', cancelled: '已取消生成' })[job.state]}</strong>
        <span>总耗时 {duration(elapsed)}</span>{job.concurrency && <span>{job.concurrency} workers</span>}<span className="zs-generation-disclosure">阶段详情 <span aria-hidden="true">⌄</span></span>
      </summary>
    <div className="zs-generation-stages">{stages.map(([phase, label, unit]) => {
      const p = observed.get(phase);
      if (!p) return null;
      const elapsedMs = running && !p.finishedAt ? Math.max(0, now - (p.startedAt ?? job.startedAt ?? now)) : p.elapsedMs ?? 0;
      const seconds = Math.max(0.001, elapsedMs / 1000);
      return <div className="zs-generation-stage" key={phase}>
        <span>{label}</span><span>{p.done > 0 || p.total > 0 ? `${p.done ?? 0}${p.total > 0 ? ` / ${p.total}` : ''} ${unit}` : p.finishedAt ? '已结束' : '处理中'}{p.failed ? ` · ${p.failed} 失败` : ''}</span>
        <span>{duration(elapsedMs)}{p.done > 0 && elapsedMs >= 50 ? ` · ${(p.done * 60 / seconds).toFixed(1)} ${unit}/分` : running && !p.finishedAt && !p.done ? ' · 等待首个结果' : ''}</span>
        {p.total > 0 && <progress value={p.done ?? 0} max={p.total} aria-label={label} />}
      </div>;
    })}</div>
    {job.error && <small>{job.error.message}</small>}
    </details>
    {running && <button className="zs-text zs-generation-cancel" disabled={disabled} onClick={onCancel}>取消</button>}
  </div>;
}
