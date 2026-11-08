import React, { useEffect, useMemo, useRef, useState } from 'react';
import { chapterKey, layoutCourseGraph, fitCourseGraph, zoomCourseGraph } from './course-graph-layout.js';

const EMPTY = [];

/** A compact atlas of existing lesson trees. Expansion never changes source anchors. */
export function CourseGraph({ course, controller, onClose }) {
  const [data, setData] = useState(null), [error, setError] = useState('');
  const [revision, setRevision] = useState(0), [opening, setOpening] = useState(false);
  const [expanded, setExpanded] = useState(new Set()), [collapsed, setCollapsed] = useState(new Set());
  const [focusOnly, setFocusOnly] = useState(false), [selected, setSelected] = useState('');
  const [viewport, setViewport] = useState({ width: 1000, height: 600 });
  const [camera, setCamera] = useState({ x: 0, y: 0, scale: 1 }), [dragging, setDragging] = useState(false);
  const canvas = useRef(null), drag = useRef(null);
  const items = data?.items ?? EMPTY;
  const layout = useMemo(() => layoutCourseGraph(items, expanded, collapsed, viewport), [items, expanded, collapsed, viewport]);
  const points = items.reduce((sum, item) => sum + item.chapters.reduce((n, chapter) => n + (chapter.topics?.length ?? 0), 0), 0);
  const chapters = items.reduce((sum, item) => sum + item.chapters.length, 0);
  useEffect(() => {
    let current = true;
    setData(null); setError(''); setExpanded(new Set()); setCollapsed(new Set()); setSelected('');
    controller.request('course-graph', { courseId: course.id }).then(result => {
      if (current) setData(result);
    }).catch(reason => { if (current) setError(reason.message || '读取课程图谱失败'); });
    return () => { current = false; };
  }, [controller, course.id, revision]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width && height) setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element); measure();
    return () => observer.disconnect();
  }, [data]);
  useEffect(() => { setCamera(fitCourseGraph(layout, viewport)); }, [layout, viewport]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    const wheel = event => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      setCamera(value => zoomCourseGraph(value, Math.exp(-event.deltaY * 0.005), { x: event.clientX - rect.left, y: event.clientY - rect.top }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [data]);
  const fit = () => setCamera(fitCourseGraph(layout, viewport));
  const zoom = factor => setCamera(value => zoomCourseGraph(value, factor, { x: viewport.width / 2, y: viewport.height / 2 }));
  const locate = index => {
    setSelected(String(index));
    const node = layout.nodes[index];
    if (!node) return;
    const scale = Math.min(1.2, (viewport.width - 48) / node.width, (viewport.height - 48) / node.height);
    setCamera({ scale, x: (viewport.width - node.width * scale) / 2 - node.x * scale, y: (viewport.height - node.height * scale) / 2 - node.y * scale });
  };
  const toggleChapter = (li, ci) => {
    const key = chapterKey(li, ci);
    setSelected(String(li));
    setExpanded(value => {
      const next = focusOnly ? new Set() : new Set(value);
      if (value.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };
  const toggleLesson = index => {
    setCollapsed(value => { const next = new Set(value); if (next.has(index)) next.delete(index); else next.add(index); return next; });
  };
  const open = async (lesson, entry) => {
    setOpening(true); setError('');
    try { if (await controller.openCourseGraphEntry(course, lesson, entry)) onClose(); }
    catch (reason) { setError(reason.message || '打开知识点失败'); }
    finally { setOpening(false); }
  };
  const pointerDown = event => {
    if (event.button !== 0 || event.target.closest('button, a, select, input')) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, camera };
    event.currentTarget.setPointerCapture(event.pointerId); setDragging(true);
  };
  const endDrag = () => { drag.current = null; setDragging(false); };
  return <section className="zs-course-graph" aria-label="课程知识图谱总览">
    <header className="zs-course-graph-header">
      <div><span className="zs-eyebrow">课程知识脉络</span><h2>{course.title || '课程知识图谱'}</h2><p>先看全貌，再展开一枝。章节旁的数字是知识点数量。</p></div>
      <div className="zs-course-graph-actions"><button type="button" className="zs-text" disabled={opening} onClick={() => setRevision(value => value + 1)}>刷新</button><button type="button" className="zs-button" onClick={onClose}>返回课堂</button></div>
    </header>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status"><span className="zs-spinner" />正在汇集本课程的知识树…</p>}
    {data && (!items.length ? <p className="zs-muted">这门课还没有可展示的知识树。解析课堂后，章节与知识点会出现在这里。</p> : <>
      <div className="zs-cg-toolbar">
        <div className="zs-cg-counts"><strong>{items.length}<small>节课堂</small></strong><span>{chapters} 章</span><span>{points} 个知识点</span></div>
        <div className="zs-cg-options"><label className="zs-cg-focus"><input type="checkbox" checked={focusOnly} onChange={event => { setFocusOnly(event.target.checked); if (event.target.checked) setExpanded(value => new Set([...value].slice(-1))); }} />只展开一枝</label>
          <button type="button" className="zs-text" onClick={() => { setExpanded(new Set()); setCollapsed(new Set(items.map((_, index) => index))); }}>收起全部</button>
          <button type="button" className="zs-text" onClick={() => { setExpanded(new Set()); setCollapsed(new Set()); }}>章节全貌</button>
        </div>
      </div>
      <div className={`zs-cg-canvas${dragging ? ' is-dragging' : ''}`} ref={canvas} tabIndex={0} role="region" aria-label="知识树画布，可拖动；方向键平移，加减号缩放，0 适应窗口" onPointerDown={pointerDown} onPointerMove={event => {
        const start = drag.current;
        if (start && start.id === event.pointerId) setCamera({ ...start.camera, x: start.camera.x + event.clientX - start.x, y: start.camera.y + event.clientY - start.y });
      }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        const directions = { ArrowLeft: [48, 0], ArrowRight: [-48, 0], ArrowUp: [0, 48], ArrowDown: [0, -48] };
        if (directions[event.key]) { event.preventDefault(); const [x, y] = directions[event.key]; setCamera(value => ({ ...value, x: value.x + x, y: value.y + y })); }
        else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
        else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
        else if (event.key === '0') { event.preventDefault(); fit(); }
      }}>
        <div className="zs-cg-world" style={{ width: layout.width, height: layout.height, transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
          <svg className="zs-cg-edges" width={layout.width} height={layout.height} aria-hidden="true">
            <path d={`M${layout.width / 2} 90 V116`} />
            {Array.from({ length: layout.columns }, (_, column) => {
              const nodes = layout.nodes.filter(node => node.column === column);
              if (!nodes.length) return null;
              const x = nodes[0].x - 14;
              return <g key={column}><path d={`M${layout.width / 2} 116 H${x} V${nodes.at(-1).y + 30}`} />{nodes.map(node => <path key={node.index} d={`M${x} ${node.y + 30} H${node.x}`} />)}</g>;
            })}
          </svg>
          <div className="zs-cg-root" style={{ left: layout.width / 2 - 140 }}><span>COURSE MAP</span><strong title={course.title}>{course.title || '本课程'}</strong></div>
          {layout.nodes.map(node => {
            const item = items[node.index], isCollapsed = collapsed.has(node.index);
            return <section className={`zs-cg-lesson${selected === String(node.index) ? ' is-selected' : ''}`} key={item.lesson.subId} style={{ left: node.x, top: node.y, width: node.width, height: node.height }} aria-label={item.lesson.title || `课堂 ${node.index + 1}`}>
              <header className="zs-cg-lesson-head"><span className="zs-cg-order">{String(node.index + 1).padStart(2, '0')}</span><button type="button" className="zs-cg-lesson-toggle" aria-expanded={!isCollapsed} title={item.lesson.title} onClick={() => toggleLesson(node.index)}><strong>{item.lesson.title || `课堂 ${node.index + 1}`}</strong><small>{item.chapters.length} 章 · {isCollapsed ? '展开' : '收起'}</small></button><button type="button" className="zs-cg-jump" aria-label={`进入${item.lesson.title || '课堂'}`} disabled={opening} onClick={() => open(item.lesson, null)}>↗</button></header>
              {!isCollapsed && <div className="zs-cg-chapters">{item.chapters.map((chapter, ci) => {
                const isExpanded = expanded.has(chapterKey(node.index, ci));
                return <div className="zs-cg-branch" key={ci}>
                  <div className="zs-cg-chapter"><button type="button" className="zs-cg-expand" aria-expanded={isExpanded} title={chapter.title} onClick={() => toggleChapter(node.index, ci)}><span className={`zs-cg-chevron${isExpanded ? ' is-open' : ''}`} aria-hidden="true">›</span><span>{chapter.title}</span><small>{chapter.topics?.length ?? 0}</small></button><button type="button" className="zs-cg-jump" aria-label={`阅读${chapter.title}`} disabled={opening} onClick={() => open(item.lesson, { kind: 'read', chapterTitle: chapter.title })}>↗</button></div>
                  {isExpanded && <div className="zs-cg-topics">{(chapter.topics ?? []).map((topic, ti) => <button type="button" key={ti} className="zs-cg-topic" title={`${topic.title} · 跳转到原课堂`} disabled={opening} onClick={() => open(item.lesson, { kind: 'point', chapter: ci, topic: ti })}><span>{topic.title}</span><span aria-hidden="true">↗</span></button>)}</div>}
                </div>;
              })}</div>}
            </section>;
          })}
        </div>
      </div>
      <footer className="zs-cg-footer"><label>定位课次<select aria-label="定位课次" value={selected} onChange={event => locate(Number(event.target.value))}><option value="" disabled>选择课堂…</option>{items.map((item, index) => <option key={item.lesson.subId} value={index}>{String(index + 1).padStart(2, '0')} · {item.lesson.title || '课堂'}</option>)}</select></label><span className="zs-cg-hint">拖动画布 · Ctrl / ⌘ + 滚轮缩放</span><div className="zs-cg-zoom"><button type="button" aria-label="缩小图谱" onClick={() => zoom(1 / 1.2)}>−</button><output aria-label="缩放比例">{Math.round(camera.scale * 100)}%</output><button type="button" aria-label="放大图谱" onClick={() => zoom(1.2)}>+</button><button type="button" onClick={fit}>适应窗口</button></div></footer>
    </>)}
  </section>;
}
