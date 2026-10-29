import {inspectGraph} from 'dsh-zhiyun-core-quiz/engines/r3-v9/graph';
import {contentHash,poolLimit,serial} from 'dsh-zhiyun-core-quiz/engines/r3-v9/common';
import {createScheduler} from './scheduler.mjs';
import {createQuestionGenerator} from './generator.mjs';
import {buildBlueprint,assessmentReport} from './blueprint.mjs';
import {compileDemand} from './compiler.mjs';

export const VERSION='r4-demand-v3';

/** Allocate concrete work before any idea exploration or model call. */
export function planDemands({graph,pointIds,count,compositeCount=0,...options}){
 const {leaves}=inspectGraph(graph),byPoint=new Map();
 for(const n of leaves.values()){const id=n.point?.id??n.id;if(typeof id!=='string'||!id.trim()||byPoint.has(id))throw Error('知识点身份必须有效且在图谱中唯一，不能覆盖歧义材料');byPoint.set(id,n);}
 if(!Array.isArray(pointIds)||!pointIds.length||new Set(pointIds).size!==pointIds.length||pointIds.some(id=>!byPoint.has(id)))throw Error('请选择有效且不重复的知识点');
 if(!Number.isInteger(count)||count<1||count>100||!Number.isInteger(compositeCount)||compositeCount<0||compositeCount>count||compositeCount&&pointIds.length<2)throw Error('题数或综合题数无效，综合题至少需要两个知识点');
 const design=buildBlueprint({pointIds,count,compositeCount,...options});
 return design.cells.map(cell=>{
  const group={...cell,blueprintCellId:cell.id};
  const selected=new Set(group.pointIds.map(id=>byPoint.get(id).id));
  const prune=node=>{if(!node.children.length)return selected.has(node.id)?structuredClone(node):null;const children=node.children.map(prune).filter(Boolean);return children.length?{...structuredClone(node),children}:null;};
  let root=prune(graph.root);while(root.children.length===1)root=root.children[0];
  if(group.kind==='composite'&&root.kind==='collection')throw Error('不自动生成跨课程综合题，请选择同一知识树中的知识点');
  return {...group,ownerId:root.id,graph:{...graph,root}};
 });
}

/** Caller owns persistence. No filesystem, credentials, product settings or bank. */
export async function runR4({graph,pointIds,count,compositeCount=0,types=['mcq'],strategies=['understand'],blueprint,purpose='practice',maxPerFamily=purpose==='assessment'?1:2,maxExpansions=1,maxCalls=120,call,state={},requestId,concurrency=2,signal,onCheckpoint=async()=>{},onProgress=()=>{}}){
 const lifetime=new AbortController();signal=AbortSignal.any([lifetime.signal,...(signal?[signal]:[])]);
 const demands=planDemands({graph,pointIds,count,compositeCount,types,strategies,blueprint,purpose});
 const design=buildBlueprint({pointIds,count,compositeCount,types,strategies,blueprint,purpose});
 if(!Number.isInteger(maxPerFamily)||maxPerFamily<1||maxPerFamily>100||!Number.isInteger(maxExpansions)||maxExpansions<0||maxExpansions>3||!Number.isInteger(maxCalls)||maxCalls<1||maxCalls>10000)throw Error('题模实例上限、扩展预算或调用预算无效');
 if(typeof requestId!=='string'||!requestId||typeof call!=='function')throw Error('需要稳定的 requestId 与模型调用接口');
 if(state.version&&state.version!==VERSION)throw Error('r4 检查点版本不一致');
 const saved=structuredClone(state);saved.version=VERSION;saved.explorations??={};saved.requests??={};
 const signature=await contentHash([graph,design,maxPerFamily]);
 if(saved.requests[requestId]&&saved.requests[requestId]!==signature)throw Error('同一 requestId 不能更改资料或出题配置');
 saved.requests[requestId]=signature;
 let modelCalls=0;
 const commit=serial(),allocate=serial(),limited=poolLimit(concurrency),sharedCall=request=>limited(()=>{signal.throwIfAborted();if(modelCalls>=maxCalls)throw Object.assign(Error('本次模型调用预算耗尽，保留断点'),{code:'BUDGET'});modelCalls++;return call({...request,signal});});
 const change=work=>commit(async()=>{signal.throwIfAborted();const next=structuredClone(saved);work(next);try{await onCheckpoint(structuredClone(next));}catch(cause){const error=Object.assign(Error('r4 检查点保存失败'),{code:'PERSIST',cause});lifetime.abort(error);throw error;}Object.assign(saved,next);});
 await change(()=>{});
 const settled=await Promise.allSettled(demands.map(async demand=>{
  const selection={types:[demand.type],strategies:[demand.strategy],attributeIds:demand.attributeIds,pointIds:demand.pointIds,maxPerFamily};
  const key=await contentHash([demand.kind,demand.graph,selection,maxPerFamily]),nativeRequestId=await contentHash([requestId,key]);
  try{
   let library,scheduler,plan,expansions=0;
   for(;;){
    const ledger=saved.explorations[key]?.ledger,previous=ledger?.plans?.[nativeRequestId];
    if(previous){
     library=structuredClone(ledger.libraries?.[previous.libraryKey]);
     if(!library)throw Error('已预留批次缺少固定资产快照，不能用新题模替换旧任务');
     library.stats={...library.stats,modelCalls:0,reusedNodes:1};
    }else{
     library=await compileDemand({graph:demand.graph,selection,neededCount:demand.count,expand:expansions>0,call:sharedCall,cache:saved.explorations[key]?.compileCache,concurrency,signal,onProgress,onCheckpoint:compileCache=>change(s=>{s.explorations[key]={...s.explorations[key],kind:demand.kind,pointIds:demand.pointIds,ownerId:demand.ownerId,compileCache,status:'exploring',complete:false};})});
     library.root.ideas=library.root.ideas.filter(idea=>idea.strategy===demand.strategy&&idea.types.includes(demand.type)&&demand.attributeIds.every(id=>idea.itemModel.attributes.some(a=>a.id===id)));
     library.key=await contentHash([library.key,library.root.ideas.map(i=>i.id)]);
    }
    const externalFamilyCounts=()=>{const counts={};for(const [id,e]of Object.entries(saved.explorations))if(id!==key)for(const p of Object.values(e.ledger?.plans??{}))for(const t of p.tickets)counts[t.familyId]=(counts[t.familyId]??0)+1;return counts;};
    scheduler=createScheduler({library,ledger:saved.explorations[key]?.ledger??{},maxPerFamily,externalFamilyCounts,onCheckpoint:ledger=>change(s=>{s.explorations[key]={...s.explorations[key],ledger};})});
    try{plan=await allocate(()=>scheduler.reserve({count:demand.count,types:[demand.type],strategies:[demand.strategy],scope:demand.kind==='local'?'local':'cross',nodeIds:[library.root.nodeId],quotas:{[library.root.nodeId]:demand.count},requestId:nativeRequestId}));break;}
    catch(error){if(error.code!=='CAPACITY'||expansions>=maxExpansions)throw error;expansions++;onProgress({phase:'r4-expanding-models',cellId:demand.id,expansions});}
   }
   const result=await createQuestionGenerator({library,scheduler,call:sharedCall,concurrency,onProgress,blueprintCellId:demand.id})(plan.id,{signal});
   await change(s=>{s.explorations[key]={...s.explorations[key],status:result.state==='completed'?'explored':'needs-repair',complete:false};});
   return {kind:demand.kind,pointIds:demand.pointIds,blueprintCellId:demand.id,requested:demand.count,...result,compileStats:library.stats,expansions};
  }catch(error){if(signal.aborted||error.code==='PERSIST')throw error;const questions=(saved.explorations[key]?.ledger?.plans?.[nativeRequestId]?.tickets??[]).filter(t=>t.state==='ready').map(t=>t.question);await change(s=>{s.explorations[key]={...s.explorations[key],status:error.code==='CAPACITY'?'needs-expansion':'needs-repair',complete:false,error:error.message};});return {kind:demand.kind,pointIds:demand.pointIds,blueprintCellId:demand.id,requested:demand.count,produced:questions.length,questions,error:error.message};}
 }));
 const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 const results=settled.map(r=>r.value),produced=results.reduce((n,r)=>n+r.produced,0);
 return {version:VERSION,state:produced===count?'completed':'partial',requested:count,produced,treeComplete:false,blueprint:design,report:assessmentReport(design,results),usage:{modelCalls,maxCalls},results,checkpoint:structuredClone(saved)};
}
