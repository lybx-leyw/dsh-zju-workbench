import {QUESTION_TYPES,QUESTION_STRATEGIES} from 'dsh-zhiyun-core-quiz/strategies';
const validList=(xs,allowed)=>Array.isArray(xs)&&xs.length>0&&new Set(xs).size===xs.length&&xs.every(x=>Object.hasOwn(allowed,x));
export function buildBlueprint({pointIds,count,compositeCount=0,types=['mcq'],strategies=['understand'],blueprint,purpose='practice'}){
 if(!['practice','assessment'].includes(purpose)||!validList(types,QUESTION_TYPES)||!validList(strategies,QUESTION_STRATEGIES))throw Error('用途、题型或认知策略无效');
 let cells=blueprint;
 if(cells===undefined){
  const grouped=new Map();
  for(let i=0;i<count;i++){
   const kind=i<count-compositeCount?'local':'composite',offset=kind==='local'?i:i-(count-compositeCount);
   const ids=kind==='local'?[pointIds[offset%pointIds.length]]:[pointIds[offset%pointIds.length],pointIds[(offset+1)%pointIds.length]];
   const type=types[i%types.length],strategy=strategies[i%strategies.length],key=JSON.stringify([kind,ids.slice().sort(),type,strategy]);
   if(!grouped.has(key))grouped.set(key,{id:'cell-'+(grouped.size+1),kind,pointIds:ids,type,strategy,count:0,attributeIds:[]});
   grouped.get(key).count++;
  }
  cells=[...grouped.values()];
 }
 if(!Array.isArray(cells)||!cells.length||cells.length>100||new Set(cells.map(c=>c.id)).size!==cells.length)throw Error('蓝图单元必须非空且编号唯一');
 for(const c of cells){
  if(typeof c.id!=='string'||!c.id||!['local','composite'].includes(c.kind)||!Array.isArray(c.pointIds)||new Set(c.pointIds).size!==c.pointIds.length||c.pointIds.some(id=>!pointIds.includes(id))||(c.kind==='local'?c.pointIds.length!==1:c.pointIds.length<2)||!types.includes(c.type)||!strategies.includes(c.strategy)||!Number.isInteger(c.count)||c.count<1||!Array.isArray(c.attributeIds??[])||new Set(c.attributeIds??[]).size!==(c.attributeIds??[]).length||(c.attributeIds??[]).some(id=>typeof id!=='string'||!id))throw Error('蓝图单元的范围、题型、策略、属性或题数无效');
 }
 if(new Set(cells.map(c=>JSON.stringify([c.kind,c.pointIds.slice().sort(),c.type,c.strategy,(c.attributeIds??[]).slice().sort()]))).size!==cells.length)throw Error('相同范围与认知要求请合并为一个蓝图单元');
 if(cells.reduce((n,c)=>n+c.count,0)!==count||cells.filter(c=>c.kind==='composite').reduce((n,c)=>n+c.count,0)!==compositeCount)throw Error('蓝图总题数或综合题配额不匹配');
 return {version:'r4-blueprint-v1',purpose,count,compositeCount,cells:structuredClone(cells).map(c=>({...c,attributeIds:c.attributeIds??[]}))};
}

/** Counts instances and model families separately. No inferred student mastery. */
export function assessmentReport(blueprint,results){
 const questions=results.flatMap(r=>r.questions??[]),families=new Set(questions.map(q=>q.familyId));
 const M=new Map(),Q=[];
 for(const q of questions){M.set(q.familyId,{familyId:q.familyId,attributes:q.diagnostic.modelAttributes,status:'design-hypothesis'});Q.push({questionId:q.id,familyId:q.familyId,attributes:q.diagnostic.actualAttributes,status:q.diagnostic.status});}
 const cells=blueprint.cells.map(c=>{const qs=questions.filter(q=>q.blueprintCellId===c.id);return {id:c.id,pointIds:c.pointIds,kind:c.kind,type:c.type,strategy:c.strategy,requested:c.count,usable:qs.length,missing:Math.max(0,c.count-qs.length),families:new Set(qs.map(q=>q.familyId)).size};});
 const attributes=[...new Map(questions.flatMap(q=>q.attributeCatalog).map(a=>[a.id,a])).values()];
 return {purpose:blueprint.purpose,instances:questions.length,modelFamilies:families.size,familyIdentity:'structural-unvalidated',coverageStatus:'batch-only',attributes,cells,M:[...M.values()],Q,psychometricValidation:{calibrated:false,difficulty:null,discrimination:null,studentMastery:null},treeComplete:false};
}
