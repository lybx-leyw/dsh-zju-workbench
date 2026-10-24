/** Measurements are reproducible from artifacts; model labels are never gold labels. */
import { normalizedText, nearDuplicate } from '../../packages/dsh-zhiyun-core-quiz/src/concepts.js';

const ratio=(n,d)=>d?n/d:null;
const unique=values=>new Set(values).size;
export function measure({points,questions,conceptCache,calls=[],prior=[],gold=null,review=null}) {
  const entries=Object.values(conceptCache),concepts=entries.flatMap(e=>e.concepts),ids=new Set(concepts.map(c=>c.id));
  const all=[...prior,...questions],newAngles=new Set();let exact=0,near=0,orthogonal=0,novel=0;
  for(const [i,q] of questions.entries()){
    const previous=all.slice(0,prior.length+i),same=previous.filter(old=>old.pointKey===q.pointKey||old.pointId===q.pointId);
    if(previous.some(old=>normalizedText(old.stem)===normalizedText(q.stem)))exact++;
    if(same.some(old=>nearDuplicate(old.stem,q.stem)))near++;
    if(['understand','explore'].includes(q.strategy)){
      orthogonal++;
      if(!same.some(old=>nearDuplicate(old.angle,q.angle))){novel++;newAngles.add(`${q.pointKey??q.pointId}:${normalizedText(q.angle)}`);}
    }
  }
  const counts=points.map(point=>questions.filter(q=>q.pointId===point.id).length),mean=questions.length/points.length;
  const priorPoints=new Set(prior.map(q=>q.pointId)),priorConcepts=new Set(prior.map(q=>q.conceptId));
  const reference=referenceMetrics({gold,review,concepts,questions});
  return {
    produced:questions.length,pointCoverage:{covered:counts.filter(Boolean).length,total:points.length,rate:ratio(counts.filter(Boolean).length,points.length)},
    growth:{newPoints:unique(questions.map(q=>q.pointId).filter(id=>!priorPoints.has(id))),newConcepts:unique(questions.map(q=>q.conceptId).filter(id=>ids.has(id)&&!priorConcepts.has(id))),
      cumulativePointCoverage:ratio(unique(all.map(q=>q.pointId)),points.length),cumulativeInternalConceptCoverage:ratio(unique(all.map(q=>q.conceptId).filter(id=>ids.has(id))),ids.size)},
    internalConceptCoverage:{covered:unique(questions.map(q=>q.conceptId).filter(id=>ids.has(id))),total:ids.size,rate:ratio(unique(questions.map(q=>q.conceptId).filter(id=>ids.has(id))),ids.size),basis:'仅以本系统已提取底稿为分母，不代表真实知识覆盖'},
    distribution:{counts,min:Math.min(...counts),max:Math.max(...counts),cv:mean?Math.sqrt(counts.reduce((sum,n)=>sum+(n-mean)**2,0)/counts.length)/mean:null},
    diversity:{exactRepeats:exact,nearRepeats:near,exactRepeatRate:ratio(exact,questions.length),nearRepeatRate:ratio(near,questions.length),
      distinctAngles:unique(questions.map(q=>`${q.pointKey??q.pointId}:${normalizedText(q.angle)}`)),orthogonalQuestions:orthogonal,newOrthogonalAngles:newAngles.size,orthogonalNoveltyRate:ratio(novel,orthogonal),
      variants:questions.filter(q=>q.parentId).length,families:unique(questions.map(q=>q.familyId).filter(Boolean)),basis:'题干/角度文本规则，语义新颖性须人工复核；变式相似不自动判失败'},
    provenance:{valid:questions.filter(q=>points.some(p=>p.id===q.pointId&&p.text.includes(q.basis))).length,total:questions.length},
    calls:{count:calls.length,failed:calls.filter(c=>c.error).length,unresolved:calls.filter(c=>c.status==='running').length,ms:calls.reduce((n,c)=>n+c.ms,0),usageReported:calls.filter(c=>c.inputTokens!=null&&c.outputTokens!=null).length,
      inputTokens:calls.some(c=>c.inputTokens!=null)?calls.reduce((n,c)=>n+(c.inputTokens??0),0):null,
      outputTokens:calls.some(c=>c.outputTokens!=null)?calls.reduce((n,c)=>n+(c.outputTokens??0),0):null,
      byStage:Object.fromEntries([...new Set(calls.map(c=>c.stage))].map(stage=>[stage,calls.filter(c=>c.stage===stage).length]))},
    reference,
  };
}

function referenceMetrics({gold,review,concepts,questions}) {
  if(!gold?.concepts?.length)return {available:false,reason:'未提供独立金标，真实概念覆盖率与答案质量均无法判定'};
  const expected=gold.concepts.filter(c=>c.required!==false),goldIds=new Set(gold.concepts.map(c=>c.id));
  if(!expected.length||goldIds.size!==gold.concepts.length||gold.concepts.some(c=>typeof c.id!=='string'||!c.id||!Number.isFinite(c.weight??1)||(c.weight??1)<=0))throw new Error('金标概念须有唯一 id 与正权重，且至少包含一个必考概念');
  const conceptIds=new Set(concepts.map(c=>c.id)),questionIds=new Set(questions.map(q=>q.id));
  const cReviews=(review?.concepts??[]).filter(r=>r.reviewed===true&&conceptIds.has(r.conceptId));
  const qReviews=(review?.questions??[]).filter(r=>r.reviewed===true&&questionIds.has(r.questionId));
  for(const row of [...cReviews,...qReviews])if((row.goldIds??[]).some(id=>!goldIds.has(id)))throw new Error('人工复核引用了不存在的金标概念');
  if(unique(cReviews.map(c=>c.conceptId))!==cReviews.length||unique(qReviews.map(q=>q.questionId))!==qReviews.length)throw new Error('同一概念或题目不能有重复复核记录');
  const extracted=new Set(cReviews.flatMap(r=>r.goldIds??[])),examined=new Set(qReviews.flatMap(r=>r.goldIds??[]));
  const weight=expected.reduce((n,c)=>n+(c.weight??1),0);
  const quality=key=>{const rows=qReviews.filter(r=>typeof r[key]==='boolean');return {checked:rows.length,passed:rows.filter(r=>r[key]).length,rate:ratio(rows.filter(r=>r[key]).length,rows.length)};};
  return {available:true,total:expected.length,conceptsReviewed:cReviews.length,questionsReviewed:qReviews.length,extracted:expected.filter(c=>extracted.has(c.id)).length,
    extractionRecall:cReviews.length?ratio(expected.filter(c=>extracted.has(c.id)).length,expected.length):null,
    tested:qReviews.length?expected.filter(c=>examined.has(c.id)).length:null,
    questionCoverage:qReviews.length?ratio(expected.filter(c=>examined.has(c.id)).length,expected.length):null,
    weightedCoverage:qReviews.length?expected.reduce((n,c)=>n+(examined.has(c.id)?c.weight??1:0),0)/weight:null,
    absentFromReviewed:expected.filter(c=>!examined.has(c.id)).map(c=>({id:c.id,label:c.label??c.id})),
    complete:cReviews.length===concepts.length&&qReviews.length===questions.length,
    quality:{correct:quality('correct'),answerable:quality('answerable'),uniqueAnswer:quality('uniqueAnswer'),meaningfulBlank:quality('meaningfulBlank'),leaked:quality('leaked'),novel:quality('novel')},
    basis:'人工复核映射；未全量复核时覆盖为已确认下界，未命中不等于确定遗漏'};
}

export function reviewTemplate(report) {
  const concepts=new Map(),questions=new Map();
  for(const cell of report.cells){for(const entry of Object.values(cell.conceptCache))for(const c of entry.concepts)concepts.set(c.id,c);for(const q of cell.questions)questions.set(q.id,q);}
  return {version:1,datasetHash:report.datasetHash,gold:report.gold??{concepts:[]},
    concepts:[...concepts.values()].map(c=>({conceptId:c.id,statement:c.statement,reviewed:false,goldIds:[]})),
    questions:[...questions.values()].map(q=>({questionId:q.id,stem:q.stem,answer:q.answer,reviewed:false,goldIds:[],correct:null,answerable:null,uniqueAnswer:null,meaningfulBlank:null,leaked:null,novel:null}))};
}
export function applyReview(report,review) {
  if(review.datasetHash!==report.datasetHash)throw new Error('复核模板与本次资料摘要不一致');
  const conceptIds=new Set(report.cells.flatMap(c=>Object.values(c.conceptCache).flatMap(e=>e.concepts.map(c=>c.id)))),questionIds=new Set(report.cells.flatMap(c=>c.questions.map(q=>q.id)));
  if((review.concepts??[]).some(c=>!conceptIds.has(c.conceptId))||(review.questions??[]).some(q=>!questionIds.has(q.questionId)))throw new Error('复核模板包含本次评测不存在的概念或题目');
  const gold=review.gold??report.gold;
  const checked={...report,gold,reviewedAt:new Date().toISOString(),cells:report.cells.map(cell=>({...cell,
    metrics:measure({points:report.points,questions:cell.questions,conceptCache:cell.conceptCache,calls:cell.calls,gold,review}),
    batches:cell.batches.map(batch=>({...batch,metrics:measure({points:report.points,questions:cell.questions.filter(q=>q.batch===batch.batch),prior:cell.questions.filter(q=>q.batch<batch.batch),conceptCache:batch.conceptCache,calls:cell.calls.filter(c=>c.batch===batch.batch),gold,review})}))}))};
  checked.trials=trialSummary(checked.cells);return checked;
}

export function trialSummary(cells) {
  const groups=new Map();
  for(const cell of cells){const key=`${cell.strategy}/${cell.type}/${cell.count}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(cell);}
  const stats=values=>{const valid=values.filter(v=>v!=null&&Number.isFinite(v));if(!valid.length)return {n:0,mean:null,std:null};const mean=valid.reduce((n,v)=>n+v,0)/valid.length;return {n:valid.length,mean,std:Math.sqrt(valid.reduce((n,v)=>n+(v-mean)**2,0)/valid.length)};};
  return [...groups].map(([key,rows])=>({key,trials:rows.length,produced:stats(rows.map(c=>c.metrics.produced)),pointCoverage:stats(rows.map(c=>c.metrics.pointCoverage.rate)),internalConceptCoverage:stats(rows.map(c=>c.metrics.internalConceptCoverage.rate)),goldCoverage:stats(rows.map(c=>c.metrics.reference.questionCoverage)),calls:stats(rows.map(c=>c.calls.length))}));
}

export function markdownReport(report) {
  const percent=n=>n==null?'无法判定':`${(n*100).toFixed(1)}%`;
  const lines=['# Quiz benchmark',`资料：${report.title}`,`模型：${report.model}；资料摘要：${report.datasetHash}`,'','| 策略/题型 | 每批题数 | 批次 | 已保存 | 知识点覆盖 | 底稿内概念覆盖 | 完全重复 | 疑似近义重复 | 金标覆盖 | 模型调用 |','|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
  for(const cell of report.cells){const m=cell.metrics;lines.push(`| ${cell.strategy}/${cell.type} | ${cell.count} | ${cell.batches.length} | ${m.produced}/${cell.count*cell.batches.length} | ${percent(m.pointCoverage.rate)} | ${percent(m.internalConceptCoverage.rate)} | ${m.diversity.exactRepeats} | ${m.diversity.nearRepeats} | ${percent(m.reference.questionCoverage)} | ${m.calls.count} |`);}
  lines.push('','底稿内覆盖不等于真实知识覆盖；相似度仅是文本规则。金标覆盖需要独立金标与人工复核映射，部分复核只构成已确认下界。未报告的 token 数保持未知。','');
  return lines.join('\n');
}
