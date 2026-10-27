/** Product choices are separate from the four pedagogical strategies. */
import * as local from './points.js';
import * as r1 from './engines/r1/points.mjs';
export const QUIZ_ENGINES=Object.freeze([
  {id:'r1',label:'r1（推荐）',description:'知识点规划、单题并发，结合历史题统一复核与整改。'},
  {id:'r3-v9',label:'r3 v9（实验）',description:'沿知识图谱树提取并复用考法，再生成、复核题目。'},
  {id:'deeptutor-native',label:'DeepTutor 直调',description:'由 DeepTutor 原生链路规划并生成，不叠加本地出题流水线。'},
]);
const versions={'r1':r1.POINT_QUIZ_CACHE_VERSION,'r3-v9':'point-quiz-r3-v9','deeptutor-native':'point-quiz-deeptutor-native-v1',local:local.POINT_QUIZ_CACHE_VERSION,deeptutor:local.POINT_QUIZ_CACHE_VERSION};
export const isNativeEngine=engine=>['r3-v9','deeptutor-native'].includes(engine);
export const engineLabel=engine=>QUIZ_ENGINES.find(row=>row.id===engine)?.label??'历史出题批次';
export function planEngineQuestions(points,input,random){
  const engine=input.engine??'local';
  if(!Object.hasOwn(versions,engine))throw Object.assign(Error('出题引擎无效'),{code:'INPUT'});
  if(isNativeEngine(engine)&&input.source==='web')throw Object.assign(Error('所选引擎当前使用课内讲义，请选择课内资料'),{code:'INPUT'});
  const plan=(engine==='r1'?r1:local).planPointQuestions(points,input,random);plan.engine=engine;
  if(engine==='r3-v9'){
    plan.ideaScope=input.ideaScope??'all';
    if(!['all','local','cross'].includes(plan.ideaScope))throw Object.assign(Error('考法范围无效'),{code:'INPUT'});
  }
  return plan;
}
export function newEngineCheckpoint(plan){
  const checkpoint=(plan.engine==='r1'?r1:local).newPointCheckpoint(plan);
  checkpoint.version=versions[plan.engine??'local'];
  if(isNativeEngine(plan.engine))checkpoint.engineState={kernel:plan.engine,complete:false};
  return checkpoint;
}
export const canResumeEngine=job=>job?.checkpoint?.version===versions[job.plan?.engine??'local']
  &&(!isNativeEngine(job.plan.engine)||job.checkpoint.engineState?.kernel===job.plan.engine);
export const engineComplete=job=>local.checkpointCount(job.checkpoint)===job.plan.count&&
  (isNativeEngine(job.plan.engine)?job.checkpoint.engineState?.complete===true:job.checkpoint.rectify?.state==='completed');
export {createPointQuizGenerator as createR1Generator} from './engines/r1/points.mjs';
export {contentHash,pointIdentity} from './concepts.js';
export {graphFromRecord,inspectGraph} from './engines/r3-v9/graph.mjs';
export {compileIdeas} from './engines/r3-v9/compiler.mjs';
export {createScheduler} from './engines/r3-v9/scheduler.mjs';
export {reserveWithExpansion} from './engines/r3-v9/expansion.mjs';
export {createQuestionGenerator} from './engines/r3-v9/generator.mjs';
export {createToolTransport} from './engines/r3-v9/tools.mjs';
