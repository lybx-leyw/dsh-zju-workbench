import {mountEvidence} from './evidence.mjs';
const $=id=>document.getElementById(id),token=new URL(location.href).searchParams.get('t');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let config,report,currentId='',records=[],running=false;
async function api(url,init={}){const response=await fetch(url,{...init,headers:{'content-type':'application/json','x-bench-token':token,...init.headers}});if(!response.ok){const data=await response.json();throw Error(data.error??'请求失败');}return response;}
const fail=error=>{$('error').textContent=error.message;$('error').hidden=false;};
const evidenceRoot=document.createElement('section');evidenceRoot.id='evidence';$('cells').before(evidenceRoot);
const refreshEvidence=mountEvidence(evidenceRoot,{api,getId:()=>currentId,onReport:render,onError:fail});
const policyLabel=document.createElement('label');policyLabel.textContent='来源审查模式';const policySelect=document.createElement('select');policySelect.id='auditPolicy';policySelect.innerHTML='<option value="focused">按疑点追加推演</option><option value="full">完整推演（对照）</option>';policyLabel.append(policySelect);$('recallMode').parentElement.after(policyLabel);
const seedLabel=document.createElement('label');seedLabel.textContent='复用已修订底稿（可选，单独计为热启动）';const seedInput=document.createElement('input');seedInput.type='file';seedInput.accept='.json';seedInput.id='seed-file';seedLabel.append(seedInput);policyLabel.after(seedLabel);
const jsonFile=async input=>input.files.length?JSON.parse(await input.files[0].text()):null;
const selected=id=>[...$(id).querySelectorAll('input:checked')].map(input=>input.value);
const percent=value=>value==null?'无法判定':`${(value*100).toFixed(1)}%`;
const stateName=state=>({completed:'完成',partial:'跑完但有缺额',interrupted:'中断，可继续',failed:'失败',running:'运行中'})[state]??state;
const labelStrategy=id=>config.strategies[id]?.label??id,labelType=id=>config.types[id]??id;
function download(value,name){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function runs(){const data=await(await api('/api/runs')).json();$('runs').innerHTML='<option value="">选择一次评测</option>'+data.runs.map(run=>`<option value="${esc(run.id)}">${esc(run.startedAt.slice(0,19))} · ${esc(run.title)} · ${esc(stateName(run.status))}</option>`).join('');$('runs').value=currentId;}
function matrix(){const scenarios=selected('strategies').flatMap(id=>selected('types').filter(type=>config.strategies[id].types.includes(type)));const sizes=$('counts').value.split(/[,，]/).filter(Boolean).length;const total=scenarios.length*sizes*Number($('batches').value)*Number($('repeats').value);$('matrix').textContent=`${scenarios.length} 个兼容的策略/题型组合 · 共 ${total} 批。每个独立重复冷启动，连续批次共享缓存。`;$('credentials').hidden=$('source').value==='fixture';$('upload-wrap').hidden=$('source').value!=='upload';}
function render(value){
  report=value;$('empty').hidden=true;$('results').hidden=false;$('title').textContent=report.title;
  $('summary').textContent=`${report.model} · ${report.cacheMode==='warm'?'热启动，复用底稿与历史':'冷启动'} · ${stateName(report.status)} · ${report.cells.length} 组 · 资料摘要 ${report.datasetHash.slice(0,16)}${report.model==='fixture'?' · 合成桩结果不能说明真实模型质量':''}`;
  $('trial-stats').textContent=JSON.stringify(report.trials??[],null,2);
  $('summary-rows').innerHTML=report.cells.map(cell=>{const m=cell.metrics;return `<tr><td>${esc(labelStrategy(cell.strategy))}<br>${esc(labelType(cell.type))} · 重复 ${cell.trial}</td><td>${cell.count} × ${cell.batches.length}</td><td>${m.produced}</td><td>${percent(m.pointCoverage.rate)}</td><td>${percent(m.internalConceptCoverage.rate)}</td><td>${m.diversity.nearRepeats}</td><td>${percent(m.reference.questionCoverage)}</td><td>${m.calls.count}</td></tr>`;}).join('');
  $('cells').innerHTML=report.cells.map(cell=>`<details class="cell"><summary>${esc(labelStrategy(cell.strategy))} / ${esc(labelType(cell.type))} · 每批 ${cell.count} 题 · 独立重复 ${cell.trial}</summary>
    <h3>连续批次：新增覆盖与生成收益</h3><div class="table-wrap"><table><thead><tr><th>批次</th><th>产出 / 计划</th><th>知识点覆盖</th><th>底稿内覆盖</th><th>新增概念 / 累计覆盖</th><th>补全概念 / 位置</th><th>新拓展角度</th><th>重复 / 近义</th><th>调用 / 秒</th></tr></thead><tbody>${cell.batches.map(b=>`<tr><td>${b.batch}</td><td>${b.produced}/${b.requested}</td><td>${percent(b.metrics.pointCoverage.rate)}</td><td>${percent(b.metrics.internalConceptCoverage.rate)}</td><td>${b.metrics.growth.newConcepts} / ${percent(b.metrics.growth.cumulativeInternalConceptCoverage)}</td><td>${b.metrics.completion?.addedConcepts??0} / ${b.metrics.completion?.addedPositions??0}</td><td>${b.metrics.diversity.newOrthogonalAngles}</td><td>${b.metrics.diversity.exactRepeats} / ${b.metrics.diversity.nearRepeats}</td><td>${b.metrics.calls.count} / ${(b.ms/1000).toFixed(1)}</td></tr>`).join('')}</tbody></table></div>
    ${cell.metrics.factCoverage?`<p class="hint">已审查考点：${cell.metrics.factCoverage.covered} / ${cell.metrics.factCoverage.total} 已考 · 同考点重复 ${cell.metrics.diversity.repeatedFacts??0} · 隔离 ${cell.metrics.factCoverage.rejectedPositions} 个位置 · 来源冲突 ${cell.metrics.factCoverage.sourceConflicts} 组。此分母不是独立金标。</p>`:''}
    ${cell.batches.flatMap(b=>b.problems).map(problem=>`<p class="hint">${esc(problem)}</p>`).join('')}
    <details><summary>独立考点与来源冲突</summary>${Object.values(cell.conceptCache).filter(e=>e.factAudit).map(e=>`<div class="question">${e.factAudit.facts.map(f=>`<p>${esc(f.claim)} <small>${esc(f.id)}</small></p>`).join('')}${e.factAudit.conflicts.map(c=>`<blockquote>${c.quotes.map(q=>esc(q)).join('<br>')}<p>${esc(c.reason)}</p></blockquote>`).join('')}<pre>${esc(JSON.stringify({checks:e.factAudit.sourceReview?.checks,rejected:e.factAudit.rejected},null,2))}</pre></div>`).join('')}</details>
    <details><summary>概念底稿与可挖空位置</summary>${Object.values(cell.conceptCache).flatMap(entry=>entry.concepts).map(c=>`<div class="question"><p>${esc(c.statement)}</p><p class="hint">可挖空：${c.blanks.map(b=>esc(b.text)).join(' / ')}</p><small>${esc(c.id)}</small></div>`).join('')}</details>
    <details><summary>生成题目 · ${cell.questions.length}</summary>${cell.questions.map(q=>`<div class="question"><small>批次 ${q.batch} · ${esc(q.angle)}${q.parentId?' · 母题变式':''}</small><p>${esc(q.stem)}</p>${q.choices.map(c=>`<p>${esc(c.label)}. ${esc(c.text)}</p>`).join('')}<p>答案：${esc(q.answer)}</p><p>${esc(q.explanation)}</p><blockquote>${esc(q.basis)}</blockquote><small>${esc(q.id)}</small></div>`).join('')}</details>
    <details><summary>完整指标与人工复核情况</summary><pre>${esc(JSON.stringify(cell.metrics,null,2))}</pre></details></details>`).join('');
  $('resume').hidden=!['interrupted','failed'].includes(report.status);$('resume').disabled=running;
  refreshEvidence();
}
async function replay(){const log=await(await api('/api/log?id='+encodeURIComponent(currentId))).json();records=log.records;$('replay').hidden=false;$('integrity').textContent=`${records.length} 条记录 · 坏行 ${log.broken} · ${log.hasEnd?'有结束记录':'缺少结束记录，日志不完整'}`;$('cursor').max=Math.max(0,records.length-1);$('cursor').value=records.length-1;$('log').textContent=records.map(r=>JSON.stringify(r)).join('\n');showEvent();}
function showEvent(){$('event').textContent=JSON.stringify(records[Number($('cursor').value)]??{},null,2);}
async function load(id){if(!id)return;currentId=id;render(await(await api('/api/report?id='+encodeURIComponent(id))).json());$('credentials').hidden=report.model==='fixture';if(report.model!=='fixture'){$('model').value=report.model;$('baseUrl').value=report.provider??config.provider.baseUrl;}await replay();}
async function start(payload){
  if(running)return;running=true;$('error').hidden=true;$('start').disabled=true;$('stop').hidden=false;$('progress').hidden=false;$('live').textContent='';$('status').textContent='评测中…';
  try{
    const response=await api('/api/run',{method:'POST',body:JSON.stringify(payload)}),reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',done=false;
    for(;;){const result=await reader.read();if(result.done)break;buffer+=decoder.decode(result.value,{stream:true});let end;
      while((end=buffer.indexOf('\n\n'))>=0){const text=buffer.slice(0,end);buffer=buffer.slice(end+2);if(!text.startsWith('data: '))continue;const event=JSON.parse(text.slice(6));
        if(event.kind==='run')currentId=event.id;
        if(event.kind==='phase'){$('phase').textContent=`${event.cell} · 第 ${event.batch} 批 · ${event.phase} · ${event.done}/${event.total}`;$('bar').max=event.total;$('bar').value=event.done;}
        if(event.kind==='error')fail(Error(event.message));
        if(event.kind==='done'){done=true;render(event.report);$('status').textContent=`评测${stateName(event.status)}`;$('phase').textContent=`本次已结束 · ${stateName(event.status)}，完整过程可在日志中回看。`;}
        if(!['phase','done'].includes(event.kind)){
          const line=event.kind==='call-start'?`开始模型步骤：${event.stage}`:event.kind==='call-end'?`模型步骤结束：${event.stage} · ${(event.ms/1000).toFixed(1)} 秒`:event.kind==='question'?`已保存题目：${event.data.pointTitle}`:event.kind==='batch-start'?`开始第 ${event.batch} 批：${event.cell}`:event.kind==='batch-end'?`第 ${event.batch} 批结束：保存 ${event.metrics.produced} 道，调用 ${event.metrics.calls.count} 次`:event.kind==='error'?event.message:event.kind==='run'?'已建立评测与断点':'';
          if(line){$('live').textContent+=line+'\n';$('live').scrollTop=$('live').scrollHeight;}
        }
      }
    }
    if(!done)$('status').textContent='连接已结束，请查看日志与断点。';
    await runs();await replay();
  }catch(error){fail(error);$('status').textContent='评测未完成';}
  finally{running=false;$('start').disabled=false;$('stop').hidden=true;}
}
try{
  config=await(await api('/api/config')).json();
  $('baseUrl').value=config.provider.baseUrl;$('model').value=config.provider.model;
  for(const [id,registry,defaults] of [['strategies',config.strategies,config.defaults.strategies],['types',config.types,config.defaults.types]])$(id).innerHTML=Object.entries(registry).map(([key,value])=>`<label><input type="checkbox" value="${key}" ${defaults.includes(key)?'checked':''}>${esc(typeof value==='string'?value:value.label)}</label>`).join('');
  const {sources}=await(await api('/api/sources')).json();for(const source of sources){const option=document.createElement('option');option.value=source.id;option.textContent=`${source.title} · ${source.points} 个知识点`;$('source').append(option);}
  if(sources.length)$('source').value=sources.at(-1).id;
  $('form').addEventListener('change',matrix);matrix();await runs();
  $('form').addEventListener('submit',async event=>{event.preventDefault();try{
    const payload={counts:$('counts').value.split(/[,，]/).map(v=>Number(v.trim())),batches:Number($('batches').value),repeats:Number($('repeats').value),seed:Number($('seed').value),maxCalls:Number($('maxCalls').value),mode:$('mode').value,difficulty:$('difficulty').value,recallMode:$('recallMode').value,strategies:selected('strategies'),types:selected('types'),baseUrl:$('baseUrl').value,model:$('model').value,apiKey:$('apiKey').value,gold:await jsonFile($('gold'))};
    if($('source').value==='fixture')payload.fixture=true;
    else if($('source').value==='upload'){
      if(!$('dataset').files.length)throw Error('请选择资料文件');const docs=await Promise.all([...$('dataset').files].map(async file=>({name:file.name,data:JSON.parse(await file.text())})));
      payload.dataset=docs.length===1?docs[0].data:{...docs.find(d=>d.name==='parsed.json')?.data,lecture:docs.find(d=>d.name==='lecture-final.json')?.data};
    }else payload.sourceId=$('source').value;
    payload.auditPolicy=$('auditPolicy').value;payload.seedArtifact=await jsonFile($('seed-file'));await start(payload);
  }catch(error){fail(error);}});
  $('stop').onclick=()=>api('/api/cancel',{method:'POST',body:'{}'}).catch(fail);
  $('runs').onchange=()=>load($('runs').value).catch(fail);$('refresh').onclick=()=>runs().catch(fail);$('cursor').oninput=showEvent;
  $('download').onclick=()=>download(report,`quiz-${currentId}.json`);
  $('review-template').onclick=async()=>{try{download(await(await api('/api/review-template?id='+encodeURIComponent(currentId))).json(),`quiz-review-${currentId}.json`);}catch(error){fail(error);}};
  $('review').onchange=async()=>{try{render(await(await api('/api/review',{method:'POST',body:JSON.stringify({id:currentId,review:await jsonFile($('review'))})})).json());}catch(error){fail(error);}};
  $('resume').onclick=()=>start({resumeId:currentId,apiKey:$('apiKey').value,baseUrl:$('baseUrl').value,maxCalls:Number($('maxCalls').value)});
}catch(error){fail(error);}
