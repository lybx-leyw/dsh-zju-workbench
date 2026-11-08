import React from 'react';

/** 终稿里的章节目录。正文改挂知识点卡片之后，学习页不再渲染这一份。 */
export function ResourceOutline({ result, onLocate }) {
  const chapters = result?.semanticPlan ?? [];
  if (!chapters.length) return <p className="zs-layer-note">知识点划分尚未确认；内容切片数不代表知识点数。</p>;
  const count = chapters.reduce((n, chapter) => n + chapter.topics.length, 0);
  return <details className="zs-diagnostics" open>
    <summary>知识点划分 · {chapters.length} 章 · {count} 个知识点</summary>
    <p>每个知识点已指定来源内容；阅读讲义继续优化表达与语义。{result.status !== 'ready' ? '当前资源仍有未完成项。' : ''}</p>
    {chapters.map((chapter, ci) => <section key={ci}>
      <h4>{chapter.title}</h4>
      <div className="zs-outline-links">{chapter.topics.map((topic, ti) => <button className="zs-text" key={ti} onClick={() => onLocate(topic)}>
        {topic.title} <small>块 {topic.from}–{topic.to}</small>
      </button>)}</div>
    </section>)}
  </details>;
}
