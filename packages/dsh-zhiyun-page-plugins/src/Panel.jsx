// 「插件」页的呈现：一张按依赖拓扑排列的清单 + 只对叶包开放的取消开关。
//
// 页面不认识任何服务：图与写动作都由 store 通过插槽 inject 递进来（`{ store }`），
// 组件只读快照、只调回调。样式用本包自己的 `zpl-` 前缀，不去改外壳的 `.zy-*`。
import React, { useEffect, useState } from 'react';
import { Icon, Notice, SectionTitle, useStore } from 'dsh-zhiyun-ui-primitives';

/** 一行左侧的状态点：已启用 / 已取消 / 等待依赖。 */
function StateDot({ row }) {
  const state = !row.enabled ? 'off' : row.waiting.length > 0 || row.phase === 'pending' ? 'wait' : 'on';
  const label = state === 'on' ? '已启用' : state === 'off' ? '已取消' : '等待依赖';
  return <span className={`zpl-dot zpl-dot-${state}`} title={label} aria-label={label}/>;
}

/** 一行的标签：叶 / 有下游 / 只读。 */
function Badge({ tone, children }) {
  return <span className={`zpl-badge zpl-badge-${tone}`}>{children}</span>;
}

function Row({ row, busy, onToggle }) {
  const working = busy.includes(row.name);
  const { cancellable } = row;
  // 已经关掉的包要给回「打开」的路：这里不能用 cancellable（它要求正在运行）。
  const openable = !row.enabled && row.entryId !== undefined && row.readOnlyReason === undefined;
  return <li className={`zpl-row${row.enabled ? '' : ' is-off'}${row.leaf ? ' is-leaf' : ''}`}>
    <StateDot row={row}/>
    <div className="zpl-row-main">
      <div className="zpl-row-head">
        <strong>{row.short}</strong>
        {row.leaf ? <Badge tone="leaf">叶</Badge> : <Badge tone="inner">被 {row.dependents.length} 个包依赖</Badge>}
        {!row.enabled && <Badge tone="off">已取消</Badge>}
        {row.readOnlyReason !== undefined && <Badge tone="lock">不可更改</Badge>}
        {row.waiting.length > 0 && <Badge tone="wait">等待 {row.waiting.join('、')}</Badge>}
      </div>
      <p className="zpl-row-meta">
        <code>{row.name}</code>
        {row.deps.length > 0 && <span>依赖：{row.deps.map(dep => dep.replace(/^dsh-zhiyun-/, '')).join('、')}</span>}
        {row.deps.length === 0 && <span>不依赖本工作台的任何其他包</span>}
      </p>
      {row.blocking !== undefined && <p className="zpl-row-block">
        取消它会让 {row.blocking.map(name => name.replace(/^dsh-zhiyun-/, '')).join('、')} 找不到依赖。
      </p>}
    </div>
    <label className={`zpl-switch${cancellable || openable ? '' : ' is-disabled'}`}>
      <input
        type="checkbox"
        checked={row.enabled}
        disabled={working || row.entryId === undefined || (!row.enabled ? !openable : !cancellable)}
        onChange={() => onToggle(row.entryId, !row.enabled)}
      />
      <span>{working ? '处理中' : row.enabled ? '启用' : '已取消'}</span>
    </label>
  </li>;
}

export function Panel({ store }) {
  const state = useStore(store);
  const [open, setOpen] = useState(false);
  // 页面第一次真的挂上时才去读图：没人打开这一页就不花那次跨宿主往返。
  useEffect(() => { store.ensure(); }, [store]);
  const view = state.view;

  if (state.status === 'loading' || state.status === 'idle') {
    return <section className="zp"><SectionTitle>插件依赖</SectionTitle><p className="zpl-muted">正在读取这个工作台的依赖关系…</p></section>;
  }
  if (view === null) {
    return <section className="zp"><SectionTitle>插件依赖</SectionTitle>
      <Notice>{state.error || '读不到这个工作台的依赖关系。'}</Notice>
      <button className="zpl-button" onClick={() => { void store.refresh(); }}>重试</button>
    </section>;
  }

  const leaves = view.rows.filter(row => row.leaf);
  const inner = view.rows.filter(row => !row.leaf);
  const cancellable = leaves.filter(row => row.cancellable);

  return <section className="zp">
    <header className="zpl-head">
      <div>
        <small>拓扑序 · 依赖在前</small>
        <h1>插件依赖</h1>
        <p>这张图读的是运行时自己的依赖关系，不是哪份手写的清单：每个包下面写着它依赖谁，没有任何包依赖它的是<strong>叶</strong>。</p>
      </div>
      <button className="zpl-button" disabled={state.pendingAction !== null} onClick={() => { void store.refresh(); }}>重新读取</button>
    </header>

    <Notice>{state.error}</Notice>

    <div className="zpl-summary">
      <span><strong>{view.rows.length}</strong> 个包</span>
      <span><strong>{view.enabled.length}</strong> 启用</span>
      <span><strong>{view.disabled.length}</strong> 已取消</span>
      <span><strong>{leaves.length}</strong> 个叶，其中 <strong>{cancellable.length}</strong> 可取消</span>
    </div>

    {view.cycles.length > 0 && <Notice>
      依赖里存在环：{view.cycles.map(group => group.map(name => name.replace(/^dsh-zhiyun-/, '')).join(' ↔ ')).join('；')}。环内无法定先后，已按运行时顺序排。
    </Notice>}

    <SectionTitle aside="没有任何包依赖它们 —— 取消不会让别的包缺依赖">叶包</SectionTitle>
    {leaves.length === 0
      ? <p className="zpl-muted">没有叶包。</p>
      : <ul className="zpl-list">{leaves.map(row => <Row key={row.name} row={row} busy={state.busy} onToggle={(entryId, on) => { void store.setPluginEnabled(entryId, on); }}/>)}</ul>}

    <SectionTitle aside="被别的包依赖 —— 取消会让它们进入「等待依赖」">支撑包</SectionTitle>
    <ul className="zpl-list">{inner.map(row => <Row key={row.name} row={row} busy={state.busy} onToggle={(entryId, on) => { void store.setPluginEnabled(entryId, on); }}/>)}</ul>

    <details className="zpl-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>这个工作台的层序与依赖序并不总是一致（{view.layerViolations.length} 处）</summary>
      <p className="zpl-muted">
        profile 的 <code>dsh.profile.bundles</code> 是<strong>层顺序</strong>：后一层覆盖前一层，而把包重新打开会被追加到列表末尾，于是层序会随时间漂移。下面的依赖若排在它的消费者之后，两者就是两套顺序。
      </p>
      {view.layerViolations.length === 0
        ? <p className="zpl-muted">当前层序与依赖序一致。</p>
        : <ul className="zpl-list zpl-list-plain">{view.layerViolations.map(item => <li key={`${item.dependent}->${item.dependency}`}>
          <code>{item.dependent.replace(/^dsh-zhiyun-/, '')}</code> 依赖 <code>{item.dependency.replace(/^dsh-zhiyun-/, '')}</code>，但后者排在它前面。
        </li>)}</ul>}
      <p className="zpl-muted">完整的拓扑序：{view.order.map(name => name.replace(/^dsh-zhiyun-/, '')).join(' → ')}</p>
    </details>
  </section>;
}

/** 页面标题旁的小图标位（外壳页头用不到时也保留导出，便于测试单独渲染）。 */
export const PluginsIcon = () => <Icon name="graph" size={18}/>;
