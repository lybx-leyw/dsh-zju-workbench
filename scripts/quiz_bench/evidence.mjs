import {activeFacts,curateFacts,resolveFactId} from '../../packages/dsh-zhiyun-core-quiz/src/ledger.js';
import {measure,trialSummary} from './metrics.mjs';
import {pointIdentity} from '../../packages/dsh-zhiyun-core-quiz/src/concepts.js';
export function evidenceOf(report) {
  return report.cells.flatMap((cell,cellIndex)=>Object.values(cell.conceptCache).map(entry=>{
    const point=report.points.find(p=>pointIdentity(p)===entry.pointKey);
    const source=point?.text??'',locate=quote=>{const start=source.indexOf(quote);return {quote,start,end:start<0?-1:start+quote.length};};
    const questions=[...(cell.seedQuestions??[]),...cell.questions].filter(q=>q.materialKey===entry.materialKey).map(q=>({...q,canonicalFactId:resolveFactId(entry,q.factId),evidence:locate(q.basis)}));
    return {cellIndex,materialKey:entry.materialKey,title:point?.title??'未定位资料',source,policy:entry.factAudit?.policy??'legacy',sourceStatus:entry.factAudit?.sourceReview?.status??'unchecked',
      facts:activeFacts(entry).map(f=>({...f,evidence:locate(f.evidence),questions:questions.filter(q=>q.canonicalFactId===f.id).map(q=>q.id)})),questions,
      positions:entry.concepts.flatMap(c=>c.blanks.map(b=>({conceptId:c.id,blankId:b.id,text:b.text,statement:c.statement,evidence:locate(c.statement)}))),
      rejected:(entry.factAudit?.rejected??[]).map(r=>({...r,evidence:locate(entry.concepts.find(c=>c.id===r.conceptId)?.statement??'')})),
      pendingBranches:(entry.factAudit?.sourceReview?.unverifiedBranches??[]).map(b=>({...b,evidence:locate(b.quote)})),warnings:entry.factAudit?.warnings??[],
      conflicts:[...(entry.factAudit?.conflicts??[]),...(entry.factLedger?.quarantines??[]).map(q=>({quotes:[q.quote],reason:q.reason}))],operations:entry.factLedger?.operations??[]};
  }));
}
/** A separate correction artifact changes the working ledger, never the original trial output. */
export function applyCorrections(report,corrections) {
  if(corrections.datasetHash!==report.datasetHash)throw new Error('修订与资料摘要不一致');
  const updated=structuredClone(report);
  for(const {cellIndex,...operation} of corrections.operations??[]){
    const cell=updated.cells[cellIndex],entry=cell?.conceptCache[operation.materialKey];
    if(!entry)throw new Error('修订引用的评测组或资料不存在');
    const panel=evidenceOf({...updated,cells:[cell]}).find(p=>p.materialKey===operation.materialKey);
    cell.conceptCache[operation.materialKey]=curateFacts(entry,operation,panel?.source);
  }
  for(const cell of updated.cells)cell.metrics=measure({points:updated.points,questions:cell.questions,prior:cell.seedQuestions??[],conceptCache:cell.conceptCache,calls:cell.calls,gold:updated.gold,review:updated.review});
  updated.trials=trialSummary(updated.cells);updated.corrections=corrections;return updated;
}
export function seedOf(report,cellIndex) {
  const cell=report.cells[cellIndex];if(!cell)throw new Error('评测组不存在');
  return {version:1,datasetHash:report.datasetHash,kernelHash:report.kernelHash,conceptCache:cell.conceptCache,questions:[...(cell.seedQuestions??[]),...cell.questions]};
}
