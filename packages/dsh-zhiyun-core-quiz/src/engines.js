/** Product choices are separate from the four pedagogical strategies. */
import * as local from './points.js';
import * as r1 from './engines/r1/points.mjs';
import {
  registerEngine, registeredEngines, engineVersionOf, engineEntries, isBuiltinEngine,
  isNativeRegistered, sourceOf, _bindBuiltinCatalog, _bindR1Version, _bindLocalVersion,
} from './engine-registry.js';

export const QUIZ_ENGINES=Object.freeze([
  {id:'r1',label:'r1（推荐）',description:'知识点规划、单题并发，结合历史题统一复核与整改。'},
  {id:'r3-v9',label:'r3 v9（实验）',description:'沿知识图谱树提取并复用考法，再生成、复核题目。'},
  {id:'deeptutor-native',label:'DeepTutor 直调',description:'由 DeepTutor 原生链路规划并生成，不叠加本地出题流水线。'},
]);

/**
 * 把内核常量与内建目录交给注册表。
 *
 * 为什么是「反向注入」而不是注册表直接 import 内核：本文件要 import r1 内核，
 * 注册表若再 import 本文件就成环。注入之后注册表保持零依赖，
 * 且 `QUIZ_ENGINES` 仍是原来的常量对象 —— 未装 lab 时目录恒等于这三条。
 */
_bindBuiltinCatalog(()=>QUIZ_ENGINES);
_bindR1Version(()=>r1.POINT_QUIZ_CACHE_VERSION);
_bindLocalVersion(()=>local.POINT_QUIZ_CACHE_VERSION);

/**
 * 引擎断点版本号。未知引擎返回 **null**。
 *
 * 旧实现直接查 `versions[engine]`，未登记时得到 `undefined`，而 `canResumeEngine`
 * 用 `===` 比较，于是 `undefined === undefined` 把任意断点判成可恢复。
 * 现在走 `engineVersionOf`：未知引擎恒为 `null`，任何真实版本号都不等于它。
 */
export const engineVersion=engine=>engineVersionOf(engine);
export const isNativeEngine=engine=>isNativeRegistered(engine);
export const engineLabel=engine=>engineEntries().find(row=>row.id===engine)?.label??`已卸载的出题引擎：${engine}`;
/** 目录 = 内建三条 + 已注册项。未安装 lab 包时长度恒为 3。 */
export {QUIZ_ENGINES as BUILTIN_ENGINES,engineEntries,registeredEngines,registerEngine};
export function planEngineQuestions(points,input,random){
  const engine=input.engine??'local';
  if(engineVersionOf(engine)===null)throw Object.assign(Error('出题引擎无效'),{code:'INPUT'});
  // 注册项可以自己声明能用的资料源；未声明时沿用 native 推导。
  const declared=sourceOf(engine);
  if((declared==='course'||isNativeEngine(engine))&&input.source==='web')throw Object.assign(Error('所选引擎当前使用课内讲义，请选择课内资料'),{code:'INPUT'});
  const plan=(engine==='r1'?r1:local).planPointQuestions(points,input,random);plan.engine=engine;
  if(engine==='deeptutor-native')plan.sourcePoints=points;
  if(engine==='r3-v9'){
    plan.ideaScope=input.ideaScope??'all';
    if(!['all','local','cross'].includes(plan.ideaScope))throw Object.assign(Error('考法范围无效'),{code:'INPUT'});
  }
  return plan;
}
export function newEngineCheckpoint(plan){
  const checkpoint=(plan.engine==='r1'?r1:local).newPointCheckpoint(plan);
  checkpoint.version=engineVersionOf(plan.engine??'local');
  if(isNativeEngine(plan.engine))checkpoint.engineState={kernel:plan.engine,complete:false};
  return checkpoint;
}
export const canResumeEngine=job=>{
  const engine=job?.plan?.engine??'local',expected=engineVersionOf(engine);
  // 预期版本为 null（引擎未登记）时一律不可恢复：修掉 undefined===undefined 那个漏洞。
  if(expected===null)return false;
  return job?.checkpoint?.version===expected
    &&(!isNativeEngine(engine)||job.checkpoint.engineState?.kernel===engine);
};
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
export {createCapsuleStore,projectTeachingBooks,readOwnedMaterial} from './engines/r3-v9/capsules.mjs';
export {isBuiltinEngine};
