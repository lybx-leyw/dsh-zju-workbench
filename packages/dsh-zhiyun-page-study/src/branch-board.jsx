import React, { useEffect, useState } from 'react';
import { time } from './format.js';

/** Side material is already classified by the parser; never infer it from lecture exclusion. */
export function BranchBoard({ result, onOpenVideo, focus }) {
  const [query, setQuery] = useState('');
  const branches = (result?.blocks ?? []).filter(block => block.tag?.role === '支线');
  const needle = query.trim().toLocaleLowerCase();
  const cards = branches.filter(block => !needle || [block.tag?.summary, block.bridge, block.text,
    ...(block.tag?.facets ?? []), ...(block.sentences ?? []).map(line => line.text)].join(' ').toLocaleLowerCase().includes(needle));
  useEffect(() => {
    if (focus?.block == null) return;
    setQuery('');
    const timer = setTimeout(() => {
      const card = document.getElementById(`zs-branch-${focus.block}`);
      if (card) { card.open = true; card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 0);
    return () => clearTimeout(timer);
  }, [focus]);
  if (!result) return <div className="zs-unparsed"><h3>课堂里的补充，也值得留下</h3><p>生成讲义后，支线片段会整理在这里。</p></div>;
  return <section className="zs-branch-board" aria-label="支线黑板">
    <div className="zs-branch-heading"><div><strong>支线黑板 <span>{branches.length}</span></strong><p>保留课堂支线，按原文阅读，随时回到视频。</p></div>
      {branches.length > 0 && <input type="search" aria-label="查找支线" placeholder="查找支线内容或标签" value={query} onChange={event => setQuery(event.target.value)}/>}</div>
    {!branches.length ? <p className="zs-muted">{result.status === 'ready' ? '这节课没有标记为支线的片段。' : '当前结果中暂无支线片段，生成完成后再来看看。'}</p>
      : !cards.length ? <p className="zs-muted">没有匹配的支线片段。</p>
      : <div className="zs-branch-grid">{cards.map(block => {
        const at = block.startMs ?? block.sentences?.find(line => line.startMs != null)?.startMs;
        const text = block.text || (block.sentences ?? []).map(line => line.text ?? '').join('\n\n');
        return <details className="zs-branch-card" id={`zs-branch-${block.index}`} key={block.index} data-focused={focus?.block === block.index || undefined}>
          <summary>
          <h3 title={block.tag?.summary || `支线片段 ${block.index}`}>{block.tag?.summary || `支线片段 ${block.index}`}</h3>
          <span className="zs-branch-meta"><span>{at != null ? time(at) : '时间未记录'}</span>{(block.tag?.facets ?? []).length > 0 && <span className="zs-branch-tags" title={block.tag.facets.join("、")}>{block.tag.facets.map(label => <span key={label}>{label}</span>)}</span>}</span><span className="zs-branch-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div className="zs-branch-body">
          {at != null && <button type="button" className="zs-text" onClick={() => onOpenVideo(at)}>回到视频</button>}
          {block.bridge && <p className="zs-branch-context">{block.bridge}</p>}
          <div className="zs-branch-text">{text || '这一片段暂无可用正文。'}</div>
          {block.cleanStatus === 'incomplete' && <small>这一片段尚未整理完整</small>}
          </div>
        </details>;
      })}</div>}
  </section>;
}
