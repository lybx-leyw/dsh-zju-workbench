import React from 'react';
import { RAIL_POSITIONS } from './state.js';

const REGIONS = ['top', 'overflow', 'bottom'];
const DRAG_TYPE = 'application/x-dsh-pages-manager';
const styles = `
[data-pages-manager]{box-sizing:border-box;width:100%;max-width:960px;min-width:0;margin:0 auto;padding:clamp(16px,4vw,40px);color:var(--dsw-alias-label-primary,#101318);font:inherit;overflow-wrap:anywhere}
[data-pages-manager] *{box-sizing:border-box;min-width:0}
[data-pages-manager] h2{margin:0;font-size:24px;letter-spacing:-.04em;font-weight:600}
[data-pages-manager] header p{margin:8px 0 28px;color:var(--dsw-alias-label-secondary,#6b7178);font-size:13px;line-height:1.6}
[data-pages-manager] section{margin:0 0 26px}
[data-pages-manager] h3{display:flex;align-items:center;gap:10px;margin:0 0 10px;font-size:11px;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#6b7178)}
[data-pages-manager] h3 span{font:11px ui-monospace,monospace;opacity:.6}
[data-pages-manager] ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px;min-height:48px;border-radius:8px}
[data-pages-manager] li{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--dsw-alias-settings-card-stroke,#00000014);border-radius:8px;background:var(--dsw-alias-settings-card-fill,#00000005)}
[data-pages-manager] li[draggable=true]{cursor:grab}
[data-pages-manager] li[data-dragging=true]{opacity:.4}
[data-pages-manager] li[data-insert=before]{box-shadow:inset 0 3px var(--dsw-alias-brand-primary,#2f6fed)}
[data-pages-manager] li[data-insert=after]{box-shadow:inset 0 -3px var(--dsw-alias-brand-primary,#2f6fed)}
[data-pages-manager] ul[data-drop=true]{outline:2px dashed var(--dsw-alias-brand-primary,#2f6fed);outline-offset:3px}
[data-pages-manager] .pm-identity{display:flex;align-items:center;gap:10px;flex:1 1 180px}
[data-pages-manager] .pm-grip{color:var(--dsw-alias-label-caption,#8a9099);user-select:none}
[data-pages-manager] .pm-icon{display:grid;place-items:center;width:22px;height:22px;flex:none}
[data-pages-manager] .pm-icon svg{width:20px;height:20px}
[data-pages-manager] .pm-name{font-size:13px;font-weight:500}
[data-pages-manager] .pm-id{display:block;margin-top:2px;font:10px ui-monospace,monospace;color:var(--dsw-alias-label-caption,#8a9099)}
[data-pages-manager] .pm-actions{display:flex;flex:0 1 auto;flex-wrap:wrap;align-items:center;gap:6px;max-width:100%}
[data-pages-manager] button,[data-pages-manager] select{min-height:32px;max-width:100%;border:1px solid var(--dsw-alias-settings-card-stroke,#0000001f);border-radius:5px;background:var(--dsw-alias-bg-base,#f4f5f7);color:var(--dsw-alias-label-secondary,#4b5058);font:inherit;font-size:12px;padding:4px 8px;cursor:pointer}
/* A native <select> draws its arrow inside the content box, so Latin-size
   padding put the arrow on top of CJK labels (汉字 is about twice as wide as
   the Latin glyphs the default padding assumed). Reserve the arrow's own space
   explicitly and draw the arrow ourselves instead of relying on the UA's. */
[data-pages-manager] select{
  appearance:none;-webkit-appearance:none;-moz-appearance:none;
  padding:4px 26px 4px 9px;
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 13px) 52%,calc(100% - 8px) 52%;
  background-size:5px 5px,5px 5px;background-repeat:no-repeat;
}
[data-pages-manager] button{min-width:32px;white-space:normal;overflow-wrap:anywhere}
[data-pages-manager] button:hover:not(:disabled){background:var(--dsw-alias-button-elevated-fill,#0000000f)}
[data-pages-manager] :is(button,select):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#2f6fed);outline-offset:2px}
[data-pages-manager] button:disabled{opacity:.35;cursor:not-allowed}
[data-pages-manager] button[role=switch][aria-checked=false]{color:var(--dsw-alias-label-caption,#8a9099)}
[data-pages-manager] .pm-empty{display:flex;align-items:center;border-style:dashed;color:var(--dsw-alias-label-caption,#8a9099);font-size:12px;min-height:48px}
@media(max-width:560px){[data-pages-manager] .pm-identity{flex-basis:100%}[data-pages-manager] .pm-actions{flex:1 1 100%}[data-pages-manager] li{padding:10px}}
`;

/**
 * Snapshot-only view: registry ownership and persistence stay with the caller.
 *
 * `defaultRailWidth` is the value "reset width" returns to. It comes from the
 * snapshot (i.e. from the product's config), never from a literal here: a
 * hard-coded 64 meant a product that changed its default was still reset to the
 * shell's value.
 */
export function PageManager({ entries, railWidth = 64, defaultRailWidth = 64, railPosition = 'left', resolveLabel, actions, t }) {
  const sizeLabel = t(railPosition === 'top' || railPosition === 'bottom' ? 'navigationHeight' : 'navigationWidth');
  const [dragging, setDragging] = React.useState(null);
  const [dropAt, setDropAt] = React.useState(null);
  const regionOf = entry => REGIONS.includes(entry.region) ? entry.region : 'overflow';
  const ordered = [...entries].sort((a, b) =>
    (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0));
  const groups = Object.fromEntries(REGIONS.map(region => [region, ordered.filter(entry => regionOf(entry) === region)]));
  const endDrag = () => { setDragging(null); setDropAt(null); };
  const normalize = list => list.forEach((entry, index) => actions.setPageOrder(entry.id, index));

  // Always rewrite the affected lists to consecutive integers. Fractional insertion
  // orders eventually collide, and snapshots may already contain equal orders.
  const relocate = (id, region, targetId = null, side = 'after', promote = false) => {
    const entry = entries.find(item => item.id === id);
    if (!entry || id === targetId) return;
    const source = regionOf(entry);
    const destination = groups[region].filter(item => item.id !== id);
    const targetIndex = destination.findIndex(item => item.id === targetId);
    const index = promote ? 0 : targetIndex < 0 ? destination.length : targetIndex + (side === 'after' ? 1 : 0);
    destination.splice(index, 0, entry);
    if (promote) actions.promotePage(id);
    else if (source !== region) actions.setPageRegion(id, region);
    if (source !== region) normalize(groups[source].filter(item => item.id !== id));
    normalize(destination);
  };
  const move = (entry, region, delta) => {
    const list = [...groups[region]];
    const index = list.findIndex(item => item.id === entry.id);
    if (index < 0 || index + delta < 0 || index + delta >= list.length) return;
    [list[index], list[index + delta]] = [list[index + delta], list[index]];
    normalize(list);
  };
  const carriedId = event => {
    const transferred = event.dataTransfer?.getData(DRAG_TYPE) || event.dataTransfer?.getData('text/plain');
    return entries.some(entry => entry.id === transferred) ? transferred : dragging;
  };
  const canDrop = () => dragging !== null;
  const regionTitle = region => t(region === 'top' ? 'managerTop' : region === 'bottom' ? 'managerBottom' : 'managerHidden');

  return <div data-pages-manager="">
    <style data-pages-manager-style="">{styles}</style>
    <header><h2>{t('managerTitle')}</h2><p>{t('managerHint')}</p></header>
    {actions.setRailPosition && <section aria-label={t('navigationPosition')}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>{t('navigationPosition')}</span>
        <select aria-label={t('navigationPosition')} value={railPosition}
          onChange={event => actions.setRailPosition(event.target.value)}>
          {RAIL_POSITIONS.map(position => <option key={position} value={position}>
            {t(`position${position[0].toUpperCase()}${position.slice(1)}`)}
          </option>)}
        </select>
      </label>
    </section>}
    {actions.setRailWidth && <section aria-label={sizeLabel}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span>{sizeLabel}</span>
        <input aria-label={sizeLabel} type="range" min="40" max="96" step="1" value={railWidth}
          onChange={event => actions.setRailWidth(Number(event.target.value))}/>
        <output>{railWidth} px</output>
        <button type="button" onClick={() => actions.setRailWidth(defaultRailWidth)}>{t('resetWidth')}</button>
      </label>
    </section>}
    {REGIONS.map(region => <section key={region} aria-label={regionTitle(region)}>
      <h3>{regionTitle(region)} <span aria-hidden="true">{groups[region].length}</span></h3>
      <ul aria-label={regionTitle(region)} data-group={region}
        data-drop={dropAt?.region === region && dropAt.id === null}
        onDragOver={event => {
          if (!canDrop(region) || event.target !== event.currentTarget && groups[region].length) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropAt({ region, id: null, side: 'after' });
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setDropAt(null);
        }}
        onDrop={event => {
          event.preventDefault();
          const id = carriedId(event);
          if (id !== null) relocate(id, region);
          endDrag();
        }}>
        {groups[region].length === 0 && <li className="pm-empty">{t('managerEmpty')}</li>}
        {groups[region].map((entry, index) => {
          const label = resolveLabel(entry);
          const visible = region !== 'overflow';
          const visibilityKey = visible ? 'managerHide' : 'managerShow';
          const Icon = entry.icon;
          return <li key={entry.id} aria-label={label} draggable data-dragging={dragging === entry.id}
            data-insert={dropAt?.region === region && dropAt.id === entry.id ? dropAt.side : undefined}
            onDragStart={event => {
              if (event.target.closest?.('button,select')) { event.preventDefault(); return; }
              event.dataTransfer.setData(DRAG_TYPE, entry.id);
              event.dataTransfer.setData('text/plain', entry.id);
              event.dataTransfer.effectAllowed = 'move';
              setDragging(entry.id);
            }}
            onDragEnd={endDrag}
            onDragOver={event => {
              event.stopPropagation();
              if (!canDrop(region) || dragging === entry.id) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const bounds = event.currentTarget.getBoundingClientRect();
              setDropAt({ region, id: entry.id, side: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' });
            }}
            onDrop={event => {
              event.preventDefault(); event.stopPropagation();
              const bounds = event.currentTarget.getBoundingClientRect();
              relocate(carriedId(event), region, entry.id, event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after');
              endDrag();
            }}>
            <div className="pm-identity">
              <span className="pm-grip" aria-hidden="true">⠿</span>
              <span className="pm-icon" aria-hidden="true">{Icon ? <Icon/> : entry.glyph}</span>
              <div><span className="pm-name">{label}</span><span className="pm-id">{entry.id}</span></div>
            </div>
            <div className="pm-actions">
              <select aria-label={`${t('managerGroup')} ${label}`} value={region}
                onChange={event => relocate(entry.id, event.target.value)}>
                {REGIONS.map(value => <option key={value} value={value}>{regionTitle(value)}</option>)}
              </select>
              <button type="button" role="switch" aria-checked={visible}
                aria-label={`${t(visibilityKey)} ${label}`}
                onClick={() => relocate(entry.id, visible ? 'overflow' : 'top')}>{t(visibilityKey)}</button>
              {region === 'overflow' && actions.setPagePinned && <button type="button"
                aria-pressed={Boolean(entry.pinned)} aria-label={`${t(entry.pinned ? 'unpin' : 'pin')} ${label}`}
                onClick={() => actions.setPagePinned(entry.id, !entry.pinned)}>{t(entry.pinned ? 'unpin' : 'pin')}</button>}
              <button type="button" aria-label={`${t('managerUp')} ${label}`} disabled={index === 0} onClick={() => move(entry, region, -1)}>↑</button>
              <button type="button" aria-label={`${t('managerDown')} ${label}`} disabled={index === groups[region].length - 1} onClick={() => move(entry, region, 1)}>↓</button>
              <button type="button" aria-label={`${t('managerPin')} ${label}`} disabled={region === 'top' && index === 0}
                onClick={() => relocate(entry.id, 'top', null, 'before', true)}>⇈</button>
              <button type="button" aria-label={`${t('managerOpen')} ${label}`} onClick={() => actions.selectPage(entry.id)}>{t('managerOpen')}</button>
            </div>
          </li>;
        })}
      </ul>
    </section>)}
  </div>;
}

export default PageManager;
