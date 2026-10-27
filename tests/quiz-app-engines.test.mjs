import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {QUIZ_ENGINES,planEngineQuestions,newEngineCheckpoint,canResumeEngine,engineComplete} from '../packages/dsh-zhiyun-core-quiz/src/engines.js';
import {knowledgePoints} from '../packages/dsh-zhiyun-core-quiz/src/knowledge-points.js';
import {apply} from '../packages/dsh-zhiyun-core-quiz/src/index.js';
import {WorkerPoolLlm} from '../packages/dsh-zhiyun-core-parser/src/worker-pool.js';
import {createTreeQuizRun,createNativeQuizRun,selectedQuizGraph} from '../packages/dsh-zhiyun-core-study/src/quiz-engine-runtime.js';
import {StudyWorkbench} from '../packages/dsh-zhiyun-core-study/src/workbench.js';
import {mountKnowledge} from './fixtures/study-storage.mjs';
import {fixture,fixtureCall} from '../scripts/quiz_bench/fixture.mjs';

function record(){
 const topics=fixture.points.slice(0,2).map((p,i)=>({title:p.title,sourceBlockIndexes:[i+1],blocks:[{kind:'paragraph',text:p.text,sourceBlockIndexes:[i+1]}]}));
 return {accountId:'fixture',courseId:'c',subId:'s',schema:2,status:'ready',sourceId:'fixture-source',fetchedAt:'2026-01-01T00:00:00Z',sourceVersion:'v1',sentences:[],
  blocks:fixture.points.slice(0,2).map((p,i)=>({index:i+1,page:i+1,startMs:0,sentenceFrom:0,sentenceTo:0,sentences:[],text:p.text,bridge:'',tag:{role:'主线',summary:p.title,facets:[]}})),
  spine:'',outline:[],warnings:[],vocabulary:[],unassignedSentences:[],failedPages:[],
  pages:[{page:1,pageText:'原始页的完整文字，标题工作者也必须可见。',pageVisual:'图像中的箭头及条件详情。'}],
  tree:{id:'chapter',kind:'branch',title:'合成章节',children:topics.map((t,i)=>({id:'node-'+i,kind:'leaf',title:t.title,blocks:[{index:i+1}]}))},
  lecture:{generationVersion:'architecture-v4',revision:'final1',chapters:[{title:'合成章节',topics}]}};
}
const planFor=(engine,count=2)=>planEngineQuestions(knowledgePoints(record()),{engine,count,types:['mcq'],strategies:[{id:'understand',weight:1}],mode:'uniform',source:'course'});
const tool=(name,args)=>({id:crypto.randomUUID(),name,arguments:JSON.stringify(args)});
function toolModel(){
 const calls=[];let active=0,peak=0;
 const answer=async options=>{
  active++;peak=Math.max(peak,active);await delay(3);active--;
  const d=JSON.parse(options.messages[1].content[0].text),name=options.tools[0].name;calls.push({name,input:d,options});
  if(name==='submit_idea'){
   const n=d.subtree,leaf=node=>node.children.length?leaf(node.children[0]):node;
   const basis=n.children.length?n.children.map(c=>{const l=leaf(c);return {path:l.path,source:'lecture',part:l.lecture[0].part};}):[{path:[],source:'lecture',part:n.lecture[0].part}];
   const idea={key:'idea',focus:n.title+'的条件判定任务',target:n.title+'的未知条件与边界',operation:'根据给定条件判断结果',strategy:'understand',types:['mcq'],conditions:['保持给定条件'],basis,
    answerPoints:basis.map((_,i)=>({text:'从对应原文条件推出判断',basisIndexes:[i]})),variants:[{key:'variant',instruction:'将判定对象换成另一种状态后重新比较条件',parameters:{state:'second'}}],
    relation:n.children.length>=2?{kind:'compare',explanation:'两个分支的条件都参与判定',needs:n.children.map((c,i)=>({child:i,target:c.title+'的必要未知条件',basisIndexes:[i]}))}:null};
   return [...(n.children.length===1?[]:[tool('submit_idea',idea)]),tool('finish_node',{included:[n.title],unassessable:[]})];
  }
  if(name==='submit_question')return [tool(name,{items:[{stem:d.idea.focus+'，请比较'+d.variant.key+'所给条件？',answer:'B',choices:[{label:'A',text:'忽略原有条件'},{label:'B',text:'按原有条件判断'},{label:'C',text:'自行增加前提'},{label:'D',text:'假设所有条件相同'}],explanation:'根据材料条件得到相应判断。',rubric:['核对条件'],usedBasisIndexes:d.idea.basis.map((_,i)=>i)}]})];
  if(name==='submit_review')return [tool(name,{valid:true,assetMatched:true,variantMatched:true,reason:'条件一致且答案唯一',optionTruth:{A:false,B:true,C:false,D:false},...(d.idea.relation?{branchChecks:d.idea.relation.needs.map(n=>({child:n.child,necessary:true,givenAway:false,promptQuote:d.item.stem,reason:'共同条件参与主判断'}))}:{})})];
  if(name==='submit_audit')return [tool(name,{explanationValid:true,unsupportedClaims:[],reason:'解析各推断均由材料支持',joint:true,leakedTarget:false,neededChildren:d.requiredChildren,jointPromptQuote:d.item.stem})];
  throw Error('Unexpected tool: '+name);
 };
 const base={llm:{resolveModelInfo:async()=>({inputModalities:['text']}),prepareCall:async route=>({config:route,async *stream(options){for(const [index,c]of (await answer(options)).entries())yield {type:'tool-call-delta',index,id:c.id,name:c.name,argumentsDelta:c.arguments};}})},
  resolve:async(_s,{selection})=>({text:selection}),call:()=>{throw Error('Tool requests must not go through the text-only harness');}};
 const pool=new WorkerPoolLlm({base,entries:[{provider:'p1',model:'m1',workers:1},{provider:'p2',model:'m2',workers:1}]});
 return {pool,calls,get peak(){return peak;}};
}
const callbacks=box=>({onCheckpoint:async cp=>{box.saved=structuredClone(cp);},onQuestion:async(q,cp)=>{box.questions??=[];box.questions.push(q);box.saved=structuredClone(cp);}});
function nativeFixture({shortFirst=false}={}){
 const starts=[],released=[],cancelled=[];let sequence=0;
 const tutor={resources:{attach:async()=>({handleId:'resource',revision:'rev'}),release:async id=>released.push(id)},runs:{
  start:async request=>{starts.push(request);await request.modelDispatch(async route=>{assert.ok(['p1','p2'].includes(route.provider));return {};});return {runId:'run-'+(++sequence)};},
  async *events(){yield {stage:'exploring'};yield {stage:'planning'};yield {stage:'quizzing'};},
  result:async id=>{const request=starts[Number(id.split('-')[1])-1],count=request.options.config.num_questions-(shortFirst&&id==='run-1'?1:0);return {status:'succeeded',upstreamCommit:'fixture-commit',questions:Array.from({length:count},(_,i)=>({type:'mcq',stem:`原生题目 ${id}-${i}`,answer:'A',options:{A:'选项甲',B:'选项乙',C:'选项丙',D:'选项丁'},explanation:'原生参考解释。'}))};},cancel:async id=>cancelled.push(id)}};
 return {tutor,starts,released,cancelled,resources:{fromLecture:input=>input}};
}

test('App exposes precisely the three requested choices and distinct resumable checkpoint identities',()=>{
 assert.deepEqual(QUIZ_ENGINES.map(x=>x.label),['r1（推荐）','r3 v9（实验）','DeepTutor 直调']);
 for(const row of QUIZ_ENGINES){const plan=planFor(row.id),checkpoint=newEngineCheckpoint(plan);assert.equal(canResumeEngine({plan,checkpoint}),true);assert.equal(engineComplete({plan,checkpoint}),false);assert.equal(canResumeEngine({plan:{...plan,engine:'local'},checkpoint}),false);}
 assert.throws(()=>planFor('invented'),{code:'INPUT'});
 assert.throws(()=>planEngineQuestions(knowledgePoints(record()),{engine:'r3-v9',count:1,source:'web'}),/课内/);
});
test('published kernel files exactly match the measured promotion digests and never import bench fixtures',async()=>{
 const base='packages/dsh-zhiyun-core-quiz/src/engines',proof=JSON.parse(await fs.readFile(base+'/versions.json','utf8'));
 for(const [engine,files]of Object.entries(proof.kernels))for(const [name,row]of Object.entries(files)){
  const source=await fs.readFile(`${base}/${engine}/${name}`,'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),row.promotedSha256);assert.doesNotMatch(source,/from ['"].*(?:scripts\/quiz_bench|artifacts\/|fixture)/);assert.doesNotMatch(source,/from ['"]node:fs/);
 }
});
test('r1 service runs the frozen lab planning and review policy rather than the legacy product generator',async()=>{
 const base=fixtureCall(),stages=[];let service;
 const call=async r=>{stages.push(r.stage);const d=JSON.parse(r.variable);
  if(r.stage==='lab-source')return {text:JSON.stringify({positions:d.positions.map(p=>({position:p.position,claim:p.text,evidence:p.statement,meaningful:true,leaked:false,consistent:true})),conflicts:[]})};
  if(r.stage==='lab-blueprint')return {text:JSON.stringify({templates:d.tickets.map((t,i)=>({ticketId:t.ticketId,conceptId:d.concepts[0].id,focus:'已分配判定任务'+i,angle:'对应判定动作'+i,basis:d.source.slice(0,18)}))})};
  if(r.stage==='lab-dedupe')return {text:'{"duplicates":[]}'};
  const raw=await base(r);if(r.stage==='quiz-point-review'){const data=JSON.parse(raw.text);data.verdicts.forEach(v=>v.optionTruth={A:true,B:false,C:false,D:false});return {text:JSON.stringify(data)};}return raw;
 };
 const cleanup=await apply({provide:(_name,value)=>{service=value;}},{llm:{call}});
 try{const plan=planFor('r1',1);const result=await service.generateR1Points({plan,checkpoint:newEngineCheckpoint(plan),...callbacks({})});assert.equal(result.admitted,1);assert.ok(stages.includes('lab-blueprint'));assert.ok(stages.includes('lab-source'));assert.ok(result.checkpoint.rectify.state==='completed');}
 finally{cleanup();}
});
test('r3 uses the original tree, full page details, real Tool calls and native per-node ledger; complete retry makes no calls',async()=>{
 const model=toolModel(),plan=planFor('r3-v9'),box={},graph=selectedQuizGraph([record()],plan.tasks.map(t=>t.point));
 assert.equal(graph.root.children[0].children.length,2);assert.match(graph.root.children[0].children[0].pages[0].text,/完整文字/);
 assert.throws(()=>selectedQuizGraph([{...record(),tree:null}],plan.tasks.map(t=>t.point)),/知识图谱/);
 const run=createTreeQuizRun({pool:model.pool,records:[record()]});
 const result=await run.generatePoints({runId:'stable-run',plan,checkpoint:newEngineCheckpoint(plan),...callbacks(box)});
 assert.equal(result.produced,2);assert.equal(box.questions.length,2);assert.equal(engineComplete({plan,checkpoint:box.saved}),true);assert.equal(model.peak,2);
 assert.ok(box.questions.every(q=>q.provenance.engine==='r3-v9'&&q.ideaId&&q.pointId&&q.sourceEvidence.length));
 assert.ok(model.calls.some(c=>c.name==='submit_idea'&&c.input.subtree.children.length===2&&c.input.subtree.children[0].pages[0].text.length));
 const before=model.calls.length;await run.generatePoints({runId:'stable-run',plan,checkpoint:box.saved,...callbacks(box)});assert.equal(model.calls.length,before);
 const checkpoint=box.saved,graphAtStart=graph;record().lecture=null;
 const restored=createTreeQuizRun({pool:model.pool,records:[],graph:graphAtStart});await restored.generatePoints({runId:'stable-run',plan,checkpoint,...callbacks(box)});assert.equal(model.calls.length,before);
});
test('r3 resumes a ready ledger after failed bank publication without paying to regenerate the question',async()=>{
 const model=toolModel(),plan=planFor('r3-v9',1),box={},run=createTreeQuizRun({pool:model.pool,records:[record()]});
 await assert.rejects(run.generatePoints({runId:'persist',plan,checkpoint:newEngineCheckpoint(plan),onCheckpoint:async cp=>{box.saved=structuredClone(cp);},onQuestion:async()=>{throw Error('fixture write failure');}}),{code:'PERSIST'});
 const calls=model.calls.length;await createTreeQuizRun({pool:model.pool,records:[record()]}).generatePoints({runId:'persist',plan,checkpoint:box.saved,...callbacks(box)});
 assert.equal(model.calls.length,calls);assert.equal(box.questions.length,1);
});
test('r3 title questions use the measured cross-branch reviews and preserve all covered point ids',async()=>{
 const model=toolModel(),plan={...planFor('r3-v9',1),ideaScope:'cross'},box={};
 const result=await createTreeQuizRun({pool:model.pool,records:[record()],graph:selectedQuizGraph([record()],knowledgePoints(record()))}).generatePoints({runId:'cross',plan,checkpoint:newEngineCheckpoint(plan),...callbacks(box)});
 assert.equal(result.produced,1);assert.deepEqual(new Set(box.questions[0].coveredPointIds),new Set(knowledgePoints(record()).map(p=>p.id)));
 assert.equal(model.calls.find(c=>c.name==='submit_review').input.idea.relation.needs.length,2);
 assert.equal(model.calls.find(c=>c.name==='submit_audit').input.requiredChildren.length,2);
});
test('DeepTutor selection uses genuine native mode and saved candidates resume without local author/review calls',async()=>{
 const model=toolModel(),native=nativeFixture(),plan=planFor('deeptutor-native',1),box={};
 const run=createNativeQuizRun({...native,pool:model.pool,scope:'fixture'});
 await assert.rejects(run.generatePoints({plan,existingQuestions:[],checkpoint:newEngineCheckpoint(plan),onCheckpoint:async cp=>{box.saved=structuredClone(cp);},onQuestion:async()=>{throw Error('write failed');}}),{code:'PERSIST'});
 assert.equal(native.starts.length,1);assert.equal(native.starts[0].options.mode,'upstream-native');assert.equal(native.starts[0].options.workerSelection.length,2);assert.equal(model.calls.length,0);
 await run.generatePoints({plan,existingQuestions:[],checkpoint:box.saved,...callbacks(box)});
 assert.equal(native.starts.length,1);assert.equal(box.questions.length,1);assert.equal(box.questions[0].provenance.mode,'upstream-native');assert.equal(box.questions[0].reviewState,'upstream');assert.equal(native.released.length,2);
});
test('native partial batches retain questions and only request the missing count on retry',async()=>{
 const model=toolModel(),native=nativeFixture({shortFirst:true}),point=knowledgePoints(record())[0],plan=planEngineQuestions([point],{engine:'deeptutor-native',count:2,types:['mcq'],strategies:[{id:'understand',weight:1}]}),box={};
 const run=createNativeQuizRun({...native,pool:model.pool,scope:'fixture'});
 const first=await run.generatePoints({plan,existingQuestions:[],checkpoint:newEngineCheckpoint(plan),...callbacks(box)});assert.equal(first.produced,1);assert.ok(first.problems.length);
 await run.generatePoints({plan,existingQuestions:box.questions,checkpoint:box.saved,...callbacks(box)});
 assert.equal(native.starts.length,2);assert.equal(native.starts[1].options.config.num_questions,1);assert.equal(box.questions.length,2);assert.equal(new Set(box.questions.map(q=>q.id)).size,2);
});
test('real host storage persists the selected native engine, progress, questions and checkpoint after restart',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quiz-app-native-'));let host,workbench;
 const model=toolModel(),native=nativeFixture();
 const open=async()=>{host=await mountKnowledge(dir);workbench=new StudyWorkbench({directory:dir,knowledge:host.service,classroom:{getCurrentUser:async()=>({id:'fixture'}),listCourses:async()=>({items:[]})},parser:{llm:{...model.pool.base,routes:{}}},llm:{},quiz:()=>({generatePoints:()=>{throw Error('Must not invoke local generator');},createRun:()=>{throw Error('Must not invoke integrated wrapper');}}),deeptutor:()=>native.tutor,learningResource:()=>native.resources});await workbench.ready;};
 try{await open();await host.service.put(record());const catalog=await workbench.invoke('bank-catalog');assert.equal(catalog.defaultEngine,'r1');assert.equal(catalog.engines.length,3);
  const started=await workbench.invoke('bank-generate',{engine:'deeptutor-native',pointIds:[catalog.points[0].id],count:1,types:['mcq'],strategies:[{id:'understand',weight:1}],workers:[{provider:'p1',model:'m1',workers:1}]});
  await workbench.questionBank.runs.get('fixture').done;
  const bank=await workbench.invoke('bank-load');assert.equal(bank.run.state,'completed');assert.equal(bank.run.plan.engine,'deeptutor-native');assert.equal(bank.questions[0].generationEngine,'deeptutor-native');assert.equal(bank.questions[0].pointId,catalog.points[0].id);
  await workbench.dispose();await host.dispose();await open();const restored=await workbench.invoke('bank-progress',{runId:started.run.id});assert.equal(restored.run.resumable,true);assert.equal(restored.run.done,1);assert.equal(restored.run.state,'completed');
 }finally{await workbench?.dispose();await host?.dispose();assert.ok(dir.startsWith(path.join(os.tmpdir(),'quiz-app-native-')));await fs.rm(dir,{recursive:true,force:true});}
});
