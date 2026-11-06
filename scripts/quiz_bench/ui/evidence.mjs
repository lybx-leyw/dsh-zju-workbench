const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountEvidence(root,{api,getId,onReport,onError}) {
  let panels=[],panelIndex=0,selection=null;
  const post=async operation=>{const response=await api('/api/curate',{method:'POST',body:JSON.stringify({id:getId(),operation:{cellIndex:panels[panelIndex].cellIndex,materialKey:panels[panelIndex].materialKey,...operation}})});onReport(await response.json());};
  const draw=()=>{
    const p=panels[panelIndex];if(!p){root.innerHTML='<p>尚无可复核底稿。</p>';return;}
    const locate=(e,label='定位原文')=>e?.start>=0?`<button class="quiet locate" data-start="${e.start}" data-end="${e.end}">${label}</button>`:'<small>未定位原文</small>';
    const opened=[...root.querySelectorAll('details[open]')].map(d=>d.dataset.fact).filter(Boolean);
    root.innerHTML=`<h3>原文与考点复核</h3><button class="quiet undo-curation">撤销最近一次账本修订</button> <button class="quiet export-seed">导出此组可复用底稿</button><label>评测组 / 知识点<select class="evidence-select">${panels.map((p,i)=>`<option value="${i}" ${i===panelIndex?'selected':''}>组 ${p.cellIndex+1} · ${esc(p.title)}</option>`).join('')}</select></label><p class="hint">${p.policy==='full'?'完整来源推演':'按疑点追加来源推演'} · 来源状态：${esc(({unchecked:'未执行额外推演',consistent:'检查未发现冲突',conflicted:'有冲突待核对',uncertain:'仍有不确定项'})[p.sourceStatus]??p.sourceStatus)}。人工修订单独保存，原始评测保持可追溯。</p>
      <div class="evidence-grid"><div class="evidence-source"><h4>讲义原文</h4><div class="source-text" tabindex="0"></div></div><div class="evidence-cards">
      ${p.facts.map(f=>`<details class="evidence-card" data-fact="${esc(f.id)}" ${opened.includes(f.id)?'open':''}><summary>${esc(f.claim)} <small>· ${f.questions.length} 道题</small></summary><p>${esc(f.evidence.quote)}</p>${locate(f.evidence)}<label>并入同义考点<select class="merge-target" data-fact="${esc(f.id)}"><option value="">选择确认相同的考点</option>${p.facts.filter(other=>other.id!==f.id).map(other=>`<option value="${esc(other.id)}">${esc(other.claim)}</option>`).join('')}</select></label><button class="quiet disable-fact" data-fact="${esc(f.id)}">停用此考点</button>
      ${f.positions.map(pos=>{const slot=p.positions.find(s=>s.conceptId===pos.conceptId&&s.blankId===pos.blankId);return `<p class="hint">挖空：${esc(slot?.text)} <button class="quiet block-position" data-concept="${esc(pos.conceptId)}" data-blank="${esc(pos.blankId)}">停用此空</button></p>`;}).join('')}
      ${f.questions.map(id=>{const q=p.questions.find(q=>q.id===id);return `<div class="question"><small>第 ${q.batch??'?'} 批 · ${esc(q.type)}</small><p>${esc(q.stem)}</p>${(q.choices??[]).map(c=>`<p>${esc(c.label)}. ${esc(c.text)}</p>`).join('')}<p>答案：${esc(q.answer)}</p><p>${esc(q.explanation)}</p>${locate(q.evidence,'定位题目依据')}</div>`;}).join('')}</details>`).join('')}
      <details><summary>拒收位置 · ${p.rejected.length}</summary>${p.rejected.map(r=>`<div class="question"><p>${esc(r.evidence.quote)}</p><p>${esc(r.reason)} · ${esc(r.detail)}</p>${locate(r.evidence)}</div>`).join('')}</details>
      <details><summary>全部关联题目 · ${p.questions.length}（含已停用考点）</summary>${p.questions.map(q=>`<div class="question"><p>${esc(q.stem)}</p><p>答案：${esc(q.answer)}</p><p>${esc(q.explanation)}</p>${locate(q.evidence)}</div>`).join('')}</details>
      <details><summary>来源冲突与人工隔离 · ${p.conflicts.length}</summary>${p.conflicts.map(c=>`<blockquote>${c.quotes.map(esc).join('<br>')}<p>${esc(c.reason)}</p></blockquote>`).join('')}</details>
      <details><summary>未验证分支 · ${p.pendingBranches.length}</summary>${p.pendingBranches.map(b=>`<div class="question"><p>${esc(b.quote)}</p><small>此分支尚未通过完整引文与推演校验</small>${locate(b.evidence)}</div>`).join('')}${p.warnings.map(w=>`<p class="hint">${esc(w)}</p>`).join('')}</details>
      <details><summary>手工隔离存疑原文</summary><label>连续原文（至少八字）<input class="quarantine-quote"></label><label>待核对原因<input class="quarantine-reason"></label><button class="quiet quarantine-source">隔离此段原文</button></details>
      <details><summary>修订记录 · ${p.operations.length}</summary><pre>${esc(JSON.stringify(p.operations,null,2))}</pre></details></div></div>`;
    const source=root.querySelector('.source-text');
    if(selection){source.innerHTML=esc(p.source.slice(0,selection.start))+'<mark>'+esc(p.source.slice(selection.start,selection.end))+'</mark>'+esc(p.source.slice(selection.end));source.querySelector('mark')?.scrollIntoView({block:'nearest'});}else source.textContent=p.source;
    root.querySelector('.evidence-select').onchange=e=>{panelIndex=Number(e.target.value);selection=null;draw();};
    root.querySelector('.undo-curation').onclick=async()=>{try{onReport(await(await api('/api/curate',{method:'POST',body:JSON.stringify({id:getId(),undo:true})})).json());}catch(error){onError(error);}};
    root.querySelector('.quarantine-source').onclick=()=>post({type:'quarantine-source',quote:root.querySelector('.quarantine-quote').value,reason:root.querySelector('.quarantine-reason').value}).catch(onError);
    root.querySelector('.export-seed').onclick=async()=>{try{const data=await(await api('/api/seed?id='+encodeURIComponent(getId())+'&cell='+p.cellIndex)).json(),link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));link.href=url;link.download='quiz-seed.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){onError(error);}};
    root.querySelectorAll('.locate').forEach(button=>button.onclick=()=>{selection={start:Number(button.dataset.start),end:Number(button.dataset.end)};draw();});
    root.querySelectorAll('.merge-target').forEach(select=>select.onchange=()=>{if(select.value)post({type:'merge',factId:select.dataset.fact,into:select.value}).catch(onError);});
    root.querySelectorAll('.disable-fact').forEach(button=>button.onclick=()=>post({type:'disable-fact',factId:button.dataset.fact}).catch(onError));
    root.querySelectorAll('.block-position').forEach(button=>button.onclick=()=>post({type:'block-position',conceptId:button.dataset.concept,blankId:button.dataset.blank}).catch(onError));
  };
  let revision=0;
  return async()=>{const current=++revision;try{const data=await(await api('/api/evidence?id='+encodeURIComponent(getId()))).json();if(current!==revision)return;panels=data;panelIndex=Math.min(panelIndex,Math.max(0,panels.length-1));draw();}catch(error){onError(error);}};
}
