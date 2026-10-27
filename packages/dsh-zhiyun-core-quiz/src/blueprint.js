import {pointIdentity} from './concepts.js';
import {factSlots} from './facts.js';
const focuses={understand:['适用条件','边界与反例','概念联系','易混辨析'],apply:['数值与参数','操作流程','应用情景','约束变化'],explore:['分析解释','比较评价','实验设计','综合推理']};
/** Reserve targets before any question starts; sibling workers never race to claim one fact. */
export function planQuestionTargets({plan,saved,history,random}) {
  const reserved=[...history],offsets=new Map();
  for(const [index,task]of plan.tasks.entries()){
    const step=saved.tasks[index];if(step.assignment)continue;
    const pointKey=pointIdentity(task.point),entry=Object.values(saved.concepts).find(e=>e.pointKey===pointKey);
    if(!entry||!saved.prepared?.[entry.materialKey])continue;
    const candidates=entry.concepts.filter(c=>c.blanks.length),offset=offsets.get(pointKey)??0;offsets.set(pointKey,offset+1);
    const targets=task.strategy==='recall'?factSlots(entry,reserved,step.repair?.type??task.type,task.count,{complete:plan.recallMode!=='variant',random}).map(({fact,concept,blank},i)=>({id:`t${i+1}`,conceptId:concept.id,blankId:blank.id,factId:fact.id,claim:fact.claim,answer:blank.text})):[];
    // Exhausted coverage is not permission to abandon a duplicate ticket. Its
    // audited target remains available for a substantive variant or type change.
    if(task.strategy==='recall'&&step.repair&&!targets.length)targets.push(...(step.repair.targets??[]));
    const concept=candidates[offset%candidates.length];
    // History is carried once in history.all, not duplicated inside questionTask.
    const {history:repairHistory,...repair}=step.repair??{};
    step.assignment={id:`question-${index+1}`,ordinal:index+1,total:plan.count,targets,
      repair:step.repair?repair:null,
      conceptId:targets[0]?.conceptId??concept?.id,focus:targets[0]?.claim??concept?.label??concept?.statement??task.point.title,
      angle:focuses[task.strategy]?.[offset%focuses[task.strategy].length]??'概念记忆'};
    for(const target of targets)reserved.push({...target,pointKey,pointId:task.point.id,type:task.type,strategy:'recall',status:'proposed'});
  }
}
export function assignedCloze(entry,target) {
  const concept=entry.concepts.find(c=>c.id===target.conceptId),blank=concept?.blanks.find(b=>b.id===target.blankId);
  if(!blank)return null;
  return {conceptId:concept.id,blankId:blank.id,factId:target.factId,angle:`记忆：${blank.text}`,familyId:target.factId,
    stem:concept.statement.slice(0,blank.start)+`{{c1::${blank.text}}}`+concept.statement.slice(blank.start+blank.text.length),
    answer:blank.text,acceptedAnswers:[blank.text,...blank.aliases],basis:concept.basis,explanation:concept.statement,choices:[]};
}
