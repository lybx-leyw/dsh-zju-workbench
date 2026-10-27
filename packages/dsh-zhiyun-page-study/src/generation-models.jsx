import React, { useEffect, useId, useRef, useState } from 'react';

/** Model credentials stay in host settings. This form only edits identifiers/quotas. */
export function GenerationModels({ controller, disabled = false, requiresVision = false, generationDisabled = false, onGenerate, label = '生成讲义',purpose='lecture' }) {
  const quiz=purpose==='quiz';
  const [catalog, setCatalog] = useState([]), [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(true), [loaded, setLoaded] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [expanded, setExpanded] = useState(false);
  const live = useRef(true), panel = useRef(null), trigger = useRef(null);
  const panelId = useId();
  function positionPanel() {
    if (!panel.current?.matches(':popover-open')) return;
    const anchor = trigger.current.getBoundingClientRect();
    const height = Math.min(panel.current.scrollHeight, window.innerHeight - 32, 560);
    const width = panel.current.getBoundingClientRect().width;
    panel.current.style.left = `${Math.max(16, Math.min(anchor.right - width, window.innerWidth - width - 16))}px`;
    panel.current.style.top = `${Math.max(16, Math.min(anchor.bottom + 10, window.innerHeight - height - 16))}px`;
  }
  function openConfig() { panel.current.togglePopover(); positionPanel(); }
  useEffect(() => {
    const element = panel.current;
    const toggled = event => { setExpanded(event.newState === 'open'); positionPanel(); };
    element.addEventListener('toggle', toggled);
    const scrolled = event => { if (element.matches(':popover-open') && !element.contains(event.target)) element.hidePopover(); };
    window.addEventListener('resize', positionPanel);
    document.addEventListener('scroll', scrolled, true);
    return () => { element.removeEventListener('toggle', toggled); window.removeEventListener('resize', positionPanel); document.removeEventListener('scroll', scrolled, true); };
  }, []);
  const valid = rows.length > 0 && rows.length <= 16 && rows.every(row => Number.isInteger(row.workers) && row.workers >= 1 && row.workers <= 32
    && catalog.some(provider => provider.id === row.provider && provider.models.some(model => model.id === row.model)));
  const total = rows.reduce((sum, row) => sum + (Number(row.workers) || 0), 0);
  const visual = rows.reduce((sum, row) => sum + (catalog.find(provider => provider.id === row.provider)?.models
    .find(model => model.id === row.model)?.inputModalities?.includes('image') ? Number(row.workers) || 0 : 0), 0);
  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; };
  }, [controller,purpose]);
  useEffect(positionPanel, [catalog, rows, busy, error]);
  async function load() {
    setBusy(true); setError('');
    try {
      const data = await controller.request('models',{purpose});
      if (!live.current) return;
      setCatalog(data.catalog); setRows(data.workers ?? []); setDirty(false); setLoaded(true);
    } catch (failure) { if (live.current) { setError(failure.message); } }
    finally { if (live.current) setBusy(false); }
  }
  function change(provider, patch) {
    setRows(current => current.map(row => row.provider === provider ? { ...row, ...patch } : row));
    setDirty(true); setError('');
  }
  function toggle(provider, checked) {
    const model = provider.models.find(model => model.inputModalities?.includes('image')) ?? provider.models[0];
    setRows(current => checked ? [...current, { provider: provider.id, model: model.id, workers: 3 }] : current.filter(row => row.provider !== provider.id));
    setDirty(true); setError('');
  }
  async function save() {
    setBusy(true); setError('');
    try {
      const data = await controller.request('models-save', { workers: rows,purpose });
      if (live.current) { setRows(data.workers); setDirty(false); panel.current.hidePopover(); trigger.current.focus(); }
    } catch (failure) { if (live.current) setError(failure.message); }
    finally { if (live.current) setBusy(false); }
  }
  const pending = busy || !loaded || dirty || !valid || (requiresVision && !visual);
  return <div className="zs-generation-models" data-purpose={purpose}>
    <div className="zs-generation-split">
      <button type="button" className="zs-primary zs-generate-action" disabled={generationDisabled || pending} title={pending ? '请先在右侧展开并应用生成配置' : `${rows.length} 个供应商 · ${total} workers`} onClick={() => { panel.current.hidePopover(); onGenerate(rows.map(row=>({...row}))); }}>{label}</button>
      <button type="button" className="zs-primary zs-generate-options" ref={trigger} aria-label={quiz?'出题生成配置':'讲义生成配置'} aria-haspopup="dialog" aria-expanded={expanded} aria-controls={panelId} title="选择供应商、模型和 worker" onClick={openConfig}>
        {quiz&&<span>配置 · {total} workers</span>}
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 7 5 5 5-5"/></svg>
        {(dirty || error || (loaded && !valid)) && <i className="zs-config-pending" aria-hidden="true"/>}
      </button>
    </div>
    <div id={panelId} ref={panel} popover="auto" role="dialog" aria-label="生成配置" className="zs-generation-config-panel">
      <div className="zs-generation-config-heading"><div><strong>生成配置</strong><span>{!loaded ? error ? '读取失败，请重试' : '读取供应商…' : rows.length ? `${rows.length} 个供应商 · 总并发 ${total}` : '请选择供应商和模型'}{dirty ? ' · 待应用' : ''}</span></div>
        <button type="button" className="zs-config-close" aria-label="关闭生成配置" onClick={() => { panel.current.hidePopover(); trigger.current.focus(); }}>×</button>
      </div>
      <div className="zs-generation-models-content">
      <p>{quiz?'选择设置中已配置的供应商。共享考点准备后，每个 worker 负责一道题，同一知识点也可并发；全部挂账后统一查重整改，各阶段共用供应商配额。':'选择设置中已配置的供应商。每个 worker 同时处理一个请求，识别、清洗、成稿和终审共用配额。'}</p>
      <fieldset disabled={disabled || busy}>
        <legend className="zs-models-sr-only">生成供应商、模型和 worker 配额</legend>
        {catalog.map(provider => {
          const row = rows.find(row => row.provider === provider.id);
          return <div className="zs-provider-row" key={provider.id} data-selected={Boolean(row)}>
            <label className="zs-provider-check"><input type="checkbox" checked={Boolean(row)} disabled={!provider.models.length && !row} onChange={event => toggle(provider, event.target.checked)} /><span>{provider.name}</span></label>
            <label className="zs-provider-model"><span>模型</span><select aria-label={`${provider.name} 模型`} value={row?.model ?? ''} disabled={!row} onChange={event => change(provider.id, { model: event.target.value })}>
              {!row && <option value="">选择模型</option>}
              {row && !provider.models.some(model => model.id === row.model) && <option value={row.model}>此前模型已不可用，请重新选择</option>}
              {provider.models.map(model => <option key={model.id} value={model.id}>{model.name}{model.inputModalities?.includes('image') ? ' · 支持图片' : ''}</option>)}
            </select></label>
            <label className="zs-provider-workers"><span>Workers</span><input aria-label={`${provider.name} worker 数`} type="number" min="1" max="32" step="1" value={row?.workers ?? ''} disabled={!row} onChange={event => change(provider.id, { workers: event.target.value === '' ? '' : Number(event.target.value) })} /></label>
            {!provider.models.length && <small className="zs-provider-unavailable">模型列表暂不可用，请检查设置后刷新。</small>}
          </div>;
        })}
        {rows.filter(row => !catalog.some(provider => provider.id === row.provider)).map(row => <div className="zs-provider-unavailable" key={row.provider}>
          供应商 {row.provider} 已不可用 <button type="button" className="zs-text" onClick={() => { setRows(current => current.filter(entry => entry.provider !== row.provider)); setDirty(true); }}>移除</button>
        </div>)}
      </fieldset>
      {loaded && !catalog.length && <p>还没有可用供应商，请先在设置中添加。</p>}
      {!quiz&&rows.length > 0 && !visual && <p className="zs-models-hint">当前模型都不支持图片；包含课件的课堂需要至少选择一个支持图片的模型。</p>}
      {disabled && <p className="zs-models-hint">本次生成使用启动时的配置，结束后可调整。</p>}
      {error && <p role="alert" className="zs-models-error">{error}</p>}
    </div>
      <div className="zs-generation-models-footer"><div><strong>总并发 {total}</strong><span>{rows.length ? `${rows.map(row => Number(row.workers) || 0).join(' + ')} = ${total} workers` : '尚未选择'}{!quiz&&` · 课件识别可用 ${visual}`}</span></div>
        <button type="button" className="zs-button" disabled={disabled || busy} onClick={load}>刷新供应商</button>
        <button type="button" className="zs-primary" disabled={disabled || busy || !dirty || !valid} onClick={save}>{busy ? '读取 / 保存中…' : '应用配置'}</button>
      </div>
    </div>
  </div>;
}
