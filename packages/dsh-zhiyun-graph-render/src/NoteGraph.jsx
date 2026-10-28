import React, { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { toElements, layoutFor, ringPositions, graphStyles, GRAPH_LAYOUT_LIMIT } from './model.js';

// fcose 是**扩展**不是核心布局，必须显式注册；重复注册会抛错，所以只注册一次。
if (typeof cytoscape === 'function' && !cytoscape.__zyFcoseRegistered) {
  try {
    cytoscape.use(fcose);
    cytoscape.__zyFcoseRegistered = true;
  } catch {
    // 「已经注册过」也会走到这里 —— 不算错误，静默跳过。
  }
}

/**
 * 「笔记」页右栏的链接图谱。
 *
 * 只负责挂载与清理；数据映射、布局选择、样式全在 `model.js`（可脱离浏览器测）。
 *
 * @param {object} props
 * @param {{nodes: object[], edges: object[]}|null} props.graph - `vault.graph` 的返回。
 * @param {string} props.current - 当前打开的笔记路径。
 * @param {(path: string) => void} [props.onOpen] - 点节点时打开那篇笔记。
 */
export function NoteGraph({ graph, current, onOpen }) {
  const boxRef = useRef(null);
  const cyRef = useRef(null);
  const [failed, setFailed] = useState('');
  const [empty, setEmpty] = useState(true);

  const elements = useMemo(() => toElements(graph, { current }), [graph, current]);
  const nodeCount = elements.nodes.length;

  // 元素或当前笔记变化才重绘；`onOpen` 用 ref 传，避免父组件每次渲染都重建整张图。
  const openRef = useRef(onOpen);
  useEffect(() => { openRef.current = onOpen; }, [onOpen]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;

    setEmpty(nodeCount === 0);
    if (nodeCount === 0) {
      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
      return undefined;
    }

    let cy;
    try {
      cy = cytoscape({
        container: box,
        elements: nodeCount > GRAPH_LAYOUT_LIMIT ? ringPositions(elements.nodes) : elements.nodes,
        edges: elements.edges,
        style: graphStyles(),
        // 关掉默认手势里的「框选」，右栏很窄，框选只会误触。
        boxSelectionEnabled: false,
        // 打印 / 导出走 SVG 渲染器，canvas 在 PDF 里会是空白（候选 README 第 4 条风险）。
        // 这里仍用默认 canvas —— 实时交互需要它；导出另说，不在本组件职责内。
        maxZoom: 3,
        minZoom: 0.2,
      });
      cy.layout(layoutFor(nodeCount)).run();
      cy.on('tap', 'node', (evt) => {
        const id = evt.target?.data?.('id');
        if (id && openRef.current) openRef.current(id);
      });
      cyRef.current = cy;
      setFailed('');
    } catch (error) {
      // 渲染失败不能让整页崩 —— 图谱是增强，不是主体。
      setFailed(error instanceof Error ? error.message : String(error));
      return undefined;
    }

    // 右栏可折叠，展开/收起会改尺寸；cy 必须跟着 resize，否则图会留白。
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { try { cy.resize(); cy.fit(undefined, 24); } catch { /* 已销毁 */ } })
      : null;
    observer?.observe(box);

    return () => {
      observer?.disconnect();
      try { cy.destroy(); } catch { /* 已销毁 */ }
      cyRef.current = null;
    };
  }, [elements, nodeCount]);

  // 节点太多时 fcose 会卡住主线程；此时已退到 preset，但要在界面上说清楚。
  const heavy = nodeCount > GRAPH_LAYOUT_LIMIT;

  return <section className="zs-nt-graph" aria-label="笔记图谱">
    <div className="zs-nt-graph-head">
      <strong>图谱</strong>
      <span className="zs-muted">{nodeCount} 篇 · {elements.edges.length} 条关系</span>
    </div>
    {failed
      ? <p className="zs-muted">图谱没能画出来：{failed}</p>
      : empty
        ? <p className="zs-muted">库里还没有笔记。</p>
        : <div ref={boxRef} className="zs-nt-graph-canvas" role="img" aria-label={`共 ${nodeCount} 篇笔记的链接图`} />}
    {heavy && <p className="zs-muted">笔记较多，已改用简单排布（不做力导向）。</p>}
  </section>;
}
