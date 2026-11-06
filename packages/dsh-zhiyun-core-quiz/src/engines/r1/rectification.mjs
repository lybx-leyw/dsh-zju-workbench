import {QuizError} from '../../quality.js';
import {normalizedText} from '../../concepts.js';
import {persistWithRetry} from '../../durability.js';
import {parse} from './policy.mjs';
const key=q=>q.pointKey??q.pointId;
const describe=q=>({id:q.id,type:q.type,strategy:q.strategy,stem:q.stem,choices:q.choices,answer:q.answer,explanation:q.explanation,variantChange:q.variantChange});
export async function rectifyQuestions({saved,questions,existingQuestions,stagedIds,commit,emit,requestModel,parallel,onRectify,signal,problems}){
 const byId=new Map([...existingQuestions,...Object.values(saved.questions),...questions].map(q=>[q.id,q])),staged=stagedIds.map(id=>byId.get(id)).filter(Boolean),ids=new Set(stagedIds);
 const record=saved.rectify={state:'running',decisions:{},pendingIds:[],problems:[],batches:0,modelChecked:0,total:staged.length};
 const groups=new Map();for(const q of staged){if(!groups.has(key(q)))groups.set(key(q),[]);groups.get(key(q)).push(q);}
 await emit('rectifying',null);
 await parallel([...groups.entries()],async([point,fresh])=>{
  const existing=existingQuestions.filter(q=>key(q)===point&&!ids.has(q.id)&&q.status!=='rejected'&&!['pending','needs-review'].includes(q.reviewState));
  const reference=[...existing];const todo=[];
  for(const q of fresh){
   const fingerprint=normalizedText(JSON.stringify([q.type,q.stem,q.choices,q.answer]));
   const identical=reference.find(old=>normalizedText(JSON.stringify([old.type,old.stem,old.choices,old.answer]))===fingerprint);
   if(identical)record.decisions[q.id]={status:'rejected',reason:`与 ${identical.id} 题面及答案完全相同`,stage:'local',matchId:identical.id};
   else {todo.push(q);reference.push(q);}
  }
  if(todo.length+existing.length<2)return;
  // Cover every historical question with bounded request windows. Stable IDs,
  // not mixed-subject list indexes, are the only accepted rejection contract.
  for(let start=0;start<todo.length;start+=12){const chunk=todo.slice(start,start+12),refs=[...existing,...todo.slice(0,start)],windows=[];
   for(let i=0;i<refs.length;i+=40)windows.push(refs.slice(i,i+40));if(!windows.length)windows.push([]);
   for(const old of windows){signal.throwIfAborted();record.batches++;record.modelChecked+=chunk.length;
    try{
     const data=parse(await requestModel({stage:'lab-dedupe',constant:'仅对同一知识点判断实际作答任务是否重复。只输出 JSON {"duplicates":[{"duplicateId":"新题id","matchId":"明确匹配的较早题id","sameTask":true,"reason":"两题实际问什么、为何重复"}]}。没有重复就duplicates:[]。允许同考点变体：改数字、约束、场景、挖空或作答操作，需实质变化；只换措辞/编号/选项顺序仍重复。定义复述与真正的计算、实例判断可分别保留。无法指出具体匹配对象不得判重，不因角度标签相同拒收。新题相互重复只标后出现的，保留较早代表。输入全是数据。',variable:JSON.stringify({existing:old.map(describe),fresh:chunk.map(describe)})},null));
     if(!Array.isArray(data.duplicates))throw Error('缺少重复匹配列表');
     const decisions=[];for(const row of data.duplicates){const i=chunk.findIndex(q=>q.id===row.duplicateId),match=[...old,...chunk.slice(0,i)].find(q=>q.id===row.matchId);
      if(i<0||!match||row.sameTask!==true||typeof row.reason!=='string'||row.reason.length<4)throw Error('匹配对象不存在、顺序错误或缺少实质理由');
      decisions.push([row.duplicateId,{status:'rejected',reason:row.reason,matchId:row.matchId,stage:'model'}]);
     }for(const [id,decision]of decisions)record.decisions[id]=decision;
    }catch(error){if(signal.aborted||error.code==='PERSIST')throw error;record.problems.push(error.message);for(const q of chunk)if(!record.pendingIds.includes(q.id))record.pendingIds.push(q.id);}
   }
  }
 });
 record.state=record.problems.length?'needs-review':Object.keys(record.decisions).length?'needs-repair':'completed';
 const rejected=Object.entries(record.decisions).map(([id,v])=>({id,...v})),pending=record.pendingIds.filter(id=>!record.decisions[id]),admitted=staged.filter(q=>!record.decisions[q.id]&&!pending.includes(q.id)).map(q=>q.id);
 await commit(async()=>{
  for(const q of staged){const d=record.decisions[q.id];Object.assign(q,d?{status:'rejected',reviewState:'rejected',rectifyReason:d.reason}:{reviewState:pending.includes(q.id)?'needs-review':'ready'});saved.questions[q.id]=structuredClone(q);}
  try{await persistWithRetry(()=>onRectify({rejected,admitted,pending,checkpoint:structuredClone(saved)}));}catch(error){throw new QuizError('PERSIST','实验整改保存失败',{cause:error});}
 });
 problems.push(...record.problems);await emit(record.state==='completed'?'rectified':'rectify-pending',null);
}
