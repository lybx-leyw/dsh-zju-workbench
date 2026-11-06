/** Durable identities and explicit human corrections; source audit remains the safety gate. */
const slot=p=>JSON.stringify([p.conceptId,p.blankId]);
export function resolveFactId(entry,id) {
  const aliases=entry.factLedger?.aliases??{},seen=new Set();
  while(aliases[id]&&!seen.has(id)){seen.add(id);id=aliases[id];}
  return id;
}
export function activeFacts(entry) {
  const ledger=entry.factLedger;
  if(!ledger)return entry.factAudit?.facts??[];
  const groups=new Map(),blocked=new Set(ledger.blockedPositions??[]),disabled=new Set((ledger.disabledFacts??[]).map(id=>resolveFactId(entry,id)));
  // Never revive positions rejected by the latest source audit.
  for(const audited of entry.factAudit?.facts??[]){
    for(const position of audited.positions){
      const key=slot(position),id=resolveFactId(entry,ledger.owners[key]??audited.id);
      const fact=ledger.facts.find(f=>f.id===id)??audited;
      const concept=entry.concepts.find(c=>c.id===position.conceptId);
      if(blocked.has(key)||disabled.has(id)||(ledger.quarantines??[]).some(q=>[concept?.statement,audited.evidence].some(text=>text&&(text.includes(q.quote)||q.quote.includes(text)))))continue;
      const group=groups.get(id)??{...fact,id,positions:[]};group.positions.push(position);groups.set(id,group);
    }
  }
  return [...groups.values()];
}
export function reconcileLedger(previous,updated) {
  const old=previous.factLedger??{version:1,materialKey:previous.materialKey,facts:previous.factAudit?.facts??[],owners:{},aliases:{},blockedPositions:[],disabledFacts:[],quarantines:[],operations:[]};
  if(old.materialKey!==updated.materialKey)throw new Error('考点账本与资料版本不匹配');
  const ledger=structuredClone(old),known=new Set(ledger.facts.map(f=>f.id));
  for(const fact of previous.factAudit?.facts??[])for(const p of fact.positions)ledger.owners[slot(p)]??=fact.id;
  for(const fact of updated.factAudit?.facts??[]){
    if(!known.has(fact.id)){ledger.facts.push(structuredClone(fact));known.add(fact.id);}
    // An unchanged position keeps its original identity when a model rephrases the claim.
    for(const p of fact.positions)ledger.owners[slot(p)]??=fact.id;
  }
  return {...updated,factLedger:ledger};
}
export function curateFacts(entry,operation,source) {
  const updated=reconcileLedger(entry,entry),ledger=updated.factLedger;
  if(operation.materialKey!==entry.materialKey)throw new Error('修订与资料版本不匹配');
  const known=id=>ledger.facts.some(f=>f.id===id),id=resolveFactId(updated,operation.factId);
  if(operation.type==='merge'){
    const target=resolveFactId(updated,operation.into);
    if(!known(id)||!known(target)||id===target)throw new Error('请选择两个不同的有效考点');
    ledger.aliases[id]=target;
  }else if(operation.type==='disable-fact'){
    if(!known(id))throw new Error('考点不存在');
    if(!ledger.disabledFacts.includes(id))ledger.disabledFacts.push(id);
  }else if(operation.type==='block-position'){
    const key=slot(operation);
    if(!entry.concepts.some(c=>c.id===operation.conceptId&&c.blanks.some(b=>b.id===operation.blankId)))throw new Error('挖空位置不存在');
    if(!ledger.blockedPositions.includes(key))ledger.blockedPositions.push(key);
  }else if(operation.type==='quarantine-source'){
    if(typeof operation.quote!=='string'||operation.quote.length<8||!source?.includes(operation.quote)||!operation.reason?.trim())throw new Error('来源隔离需要至少八字的连续原文与理由');
    if(!ledger.quarantines.some(q=>q.quote===operation.quote))ledger.quarantines.push({quote:operation.quote,reason:operation.reason});
  }else throw new Error('不支持的账本修订');
  ledger.operations.push({...operation,at:new Date().toISOString()});
  updated.updatedAt=new Date().toISOString();
  return updated;
}
