import {contentHash,serial} from './common.mjs';
import {atPath,walkTree} from './tree.mjs';
import {QUESTION_TYPES,QUESTION_STRATEGIES} from '../../../packages/dsh-zhiyun-core-quiz/src/strategies.js';
import {normalizedText} from '../../../packages/dsh-zhiyun-core-quiz/src/concepts.js';

const resultBranch=node=>({nodeId:node.nodeId,title:node.title,questions:[],children:node.children.map(resultBranch)});
/** Traversal reserves node-owned work; only executable tickets enter a linear queue. */
export function createScheduler({library,ledger={},onCheckpoint=async()=>{}}){
 if(!library.root||library.ideas||library.assets)throw Error('调度器只接受保留 root.children 层级的考法树');
 let state=structuredClone(ledger);state.version??='r3-tree-tickets-v2';if(state.version!=='r3-tree-tickets-v2')throw Error('任务账本版本不一致，请使用独立实验目录');
 state.plans??={};state.allocated??={};state.fingerprints??={};state.resultTrees??={};
 state.extensions??={};
 state.resultTrees[library.key]??=resultBranch(library.root);state.fingerprints[library.key]??={};
 const nodeIds=new Set();let variants=0;for(const {node}of walkTree(library.root)){nodeIds.add(node.nodeId);for(const idea of node.ideas)variants=Math.max(variants,idea.variants.length);}
 const commit=serial();
 const change=work=>commit(async()=>{const next=structuredClone(state),result=await work(next);try{await onCheckpoint(structuredClone(next));}catch(cause){throw Object.assign(Error('任务账本保存失败'),{code:'PERSIST',cause});}state=next;return structuredClone(result);});
 const get=id=>{const plan=Object.hasOwn(state.plans,id)?state.plans[id]:null;if(!plan||plan.libraryKey!==library.key)throw Error('出题计划不存在或讲义资产版本已变化');return structuredClone(plan);};
 return {
  get snapshot(){return structuredClone(state);},get,
  get resultTree(){return structuredClone(state.resultTrees[library.key]);},
  nodeHistory:nodePath=>structuredClone(atPath(state.resultTrees[library.key],nodePath).questions),
  nodeVariants:nodePath=>{const node=atPath(library.root,nodePath);return node.ideas.map(idea=>({ideaKey:idea.key,variants:structuredClone([...idea.variants,...(state.extensions[idea.id]??[])])}));},
  extendVariants:(nodePath,rows)=>change(async next=>{
   const node=atPath(library.root,nodePath);if(!Array.isArray(rows)||rows.length>12)throw Error('节点变体扩展最多12项');
   for(const row of rows){
    const idea=node.ideas.find(i=>i.key===row.ideaKey);if(!idea)throw Error('变体必须属于原节点已有考法');
    const existing=[...idea.variants,...(next.extensions[idea.id]??[])];
    if(typeof row.key!=='string'||!row.key||existing.some(v=>v.key===row.key)||existing.length>=24||typeof row.instruction!=='string'||row.instruction.trim().length<12||existing.some(v=>normalizedText(v.instruction)===normalizedText(row.instruction))||typeof row.difference!=='string'||row.difference.trim().length<10||!row.parameters||Array.isArray(row.parameters)||typeof row.parameters!=='object'||Object.values(row.parameters).some(v=>typeof v!=='string'&&!(typeof v==='number'&&Number.isFinite(v))))throw Error('变体缺少独立编号、实质变化说明或有效参数');
    next.extensions[idea.id]??=[];next.extensions[idea.id].push({key:row.key,instruction:row.instruction,parameters:row.parameters,difference:row.difference});
   }return rows.length;
  }),
  requestRepair:(planId,ticketId,reason)=>change(async next=>{
   if(typeof reason!=='string'||!reason.trim())throw Error('返工需要明确原因');
   const plan=next.plans[planId];if(!plan||plan.libraryKey!==library.key)throw Error('计划不存在或资产版本已变');
   const ticket=plan.tickets.find(t=>t.id===ticketId);if(!ticket)throw Error('任务不存在');
   const owner=atPath(next.resultTrees[library.key],ticket.nodePath),old=ticket.question;
   if(old){owner.archivedQuestions??=[];owner.archivedQuestions.push({...old,status:'needs-repair',reason});owner.questions=owner.questions.filter(q=>q.id!==ticket.id);
    if(next.fingerprints[library.key][old.fingerprint]===ticket.id)delete next.fingerprints[library.key][old.fingerprint];}
   Object.assign(ticket,{state:'needs-repair',error:reason,draft:null,question:null,previousDrafts:[...(ticket.previousDrafts??[]),...(old?[old]:[])],toolFeedback:{toolCalls:ticket.submission?.toolCalls??[],text:ticket.submission?.text??'',error:reason}});
   return ticket;
  }),
  reserve:({count,types=['mcq'],scope='all',nodeIds:selected=null,strategies=null,quotas=null,requestId=crypto.randomUUID()})=>change(async next=>{
   if(!Number.isInteger(count)||count<1||count>100||!Array.isArray(types)||!types.length||new Set(types).size!==types.length||types.some(t=>!Object.hasOwn(QUESTION_TYPES,t))||!['all','local','cross'].includes(scope)||typeof requestId!=='string'||!requestId||strategies!==null&&(!Array.isArray(strategies)||!strategies.length||strategies.some(s=>!Object.hasOwn(QUESTION_STRATEGIES,s)))||selected!==null&&(!Array.isArray(selected)||!selected.length||selected.some(id=>!nodeIds.has(id))))throw Error('出题选择无效');
   if(quotas!==null&&(!quotas||Array.isArray(quotas)||typeof quotas!=='object'||Object.entries(quotas).some(([id,n])=>!nodeIds.has(id)||!Number.isInteger(n)||n<1)||Object.values(quotas).reduce((n,v)=>n+v,0)!==count))throw Error('节点配额必须为有效节点的正整数，且总和等于题数');
   const signature=JSON.stringify({count,types,scope,nodeIds:selected,strategies,quotas});
   if(Object.hasOwn(next.plans,requestId)){const previous=next.plans[requestId];if(previous.signature!==signature||previous.libraryKey!==library.key)throw Error('重复请求ID的参数或资产不同');return previous;}
   const tickets=[],selectedCounts=new Map();
   // Base work throughout the selected subtree precedes all variants. No idea pool is built.
   function *slots(node,path,variant,inScope){
    inScope=inScope||!selected||selected.includes(node.nodeId);
    for(const [i,child]of node.children.entries())yield*slots(child,[...path,i],variant,inScope);
    if(!inScope||scope!=='all'&&Boolean(node.children.length)!==(scope==='cross'))return;
    for(const idea of node.ideas){if(strategies&&!strategies.includes(idea.strategy))continue;
    const chosen=[...idea.variants,...(next.extensions[idea.id]??[])][variant];if(!chosen)continue;
     for(const type of types)yield {node,path,idea,type,chosen};
    }
   }
   let maxVariants=variants;for(const {node}of walkTree(library.root))for(const idea of node.ideas)maxVariants=Math.max(maxVariants,idea.variants.length+(next.extensions[idea.id]?.length??0));
   outer:for(let variant=0;variant<maxVariants;variant++)for(const {node,path,idea,type,chosen}of slots(library.root,[],variant,false)){
    if(quotas&&(!Object.hasOwn(quotas,node.nodeId)||(selectedCounts.get(node.nodeId)??0)>=quotas[node.nodeId]))continue;
    const slotId=await contentHash([idea.id,type,chosen.key]);if(Object.hasOwn(next.allocated,slotId))continue;
    tickets.push({id:await contentHash([requestId,slotId]),slotId,ideaId:idea.id,ideaKey:idea.key,nodeId:node.nodeId,nodePath:path,type,variant:chosen,state:'reserved',attempts:0,responses:{},draft:null,question:null,error:null});
    selectedCounts.set(node.nodeId,(selectedCounts.get(node.nodeId)??0)+1);
    if(tickets.length===count)break outer;
   }
   if(tickets.length!==count)throw Object.assign(Error(`可用考法/变体槽位不足：需要${count}，剩余${tickets.length}；不能用改编号伪造新题`),{code:'CAPACITY',shortages:quotas?Object.entries(quotas).filter(([id,n])=>(selectedCounts.get(id)??0)<n).map(([nodeId,n])=>({nodeId,needed:n-(selectedCounts.get(nodeId)??0)})):null});
   const plan={id:requestId,libraryKey:library.key,count,signature,tickets,createdAt:new Date().toISOString()};
   for(const t of tickets)next.allocated[t.slotId]={planId:plan.id,ticketId:t.id};next.plans[plan.id]=plan;return plan;
  }),
  update:(planId,ticketId,patch)=>change(async next=>{
   const plan=next.plans[planId];if(!plan||plan.libraryKey!==library.key)throw Error('资产版本已变，不能继续旧计划');
   const ticket=plan.tickets.find(t=>t.id===ticketId);if(!ticket)throw Error('任务不存在');
   for(const k of ['id','slotId','ideaId','ideaKey','nodeId','nodePath','type','variant'])if(Object.hasOwn(patch,k))throw Error('不能更改已预留的任务身份');
   if(patch.state==='ready'){
    const q=patch.question;if(!q?.fingerprint||q.id!==ticket.id||q.nodeId!==ticket.nodeId||q.ideaId!==ticket.ideaId)throw Error('题目必须归属原节点和原考法');
    const fingerprints=next.fingerprints[library.key],collision=fingerprints[q.fingerprint];
    if(collision&&collision!==ticket.id)throw Object.assign(Error('生成结果与已完成任务完全相同，需按原考法整改'),{code:'COLLISION'});
    const owner=atPath(next.resultTrees[library.key],ticket.nodePath);if(owner.nodeId!==ticket.nodeId)throw Error('结果树路径与任务不符');
    owner.questions=owner.questions.filter(old=>old.id!==ticket.id);owner.questions.push(structuredClone(q));fingerprints[q.fingerprint]=ticket.id;
   }
   Object.assign(ticket,structuredClone(patch));return ticket;
  })
 };
}
