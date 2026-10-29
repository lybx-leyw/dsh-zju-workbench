import {contentHash} from '../../../packages/dsh-zhiyun-core-quiz/src/concepts.js';
import {normalizedText} from '../../../packages/dsh-zhiyun-core-quiz/src/concepts.js';

const text=v=>typeof v==='string'&&v.trim().length>0;
const unique=xs=>new Set(xs).size===xs.length;
const strings=(xs,min=1)=>Array.isArray(xs)&&xs.length>=min&&xs.every(text)&&unique(xs);
const fail=message=>{throw Error(message);};
const roles=['incidental','radical'];
export const ADAPTATIONS=['parameter-change','condition-change','representation-change','inverse-question','boundary-case','counterexample','transfer','synthesis'];

/** A deliberately small data-only arithmetic language. No eval or dynamic code. */
export function evaluate(expression,parameters,depth=0){
 if(depth>16)fail('数值验证表达式过深');
 if(typeof expression==='number'){if(!Number.isFinite(expression)||Math.abs(expression)>1e12)fail('表达式包含非有限数或超限常量');return expression;}
 if(typeof expression==='string'){if(!Object.hasOwn(parameters,expression)||!Number.isFinite(parameters[expression])||Math.abs(parameters[expression])>1e12)fail('表达式引用未知或超限数值变量');return parameters[expression];}
 if(!expression||!['add','subtract','multiply','divide','power'].includes(expression.op)||!Array.isArray(expression.args)||expression.args.length!==2)fail('只允许二元算术表达式');
 const [a,b]=expression.args.map(x=>evaluate(x,parameters,depth+1));
 if(expression.op==='divide'&&b===0)fail('数值约束禁止除零');
 const value=({add:()=>a+b,subtract:()=>a-b,multiply:()=>a*b,divide:()=>a/b,power:()=>a**b})[expression.op]();
 if(!Number.isFinite(value)||Math.abs(value)>1e12)fail('数值验证结果无效');return value;
}

export function validateParameters(model,parameters){
 if(!parameters||typeof parameters!=='object'||Array.isArray(parameters))fail('实例缺少题模参数');
 if(Object.keys(parameters).length!==model.variables.length||model.variables.some(v=>!Object.hasOwn(parameters,v.name)))fail('实例参数必须与题模变量逐一对应；缺少：'+model.variables.filter(v=>!Object.hasOwn(parameters,v.name)).map(v=>v.name).join(',')+'；多余：'+Object.keys(parameters).filter(k=>!model.variables.some(v=>v.name===k)).join(','));
 for(const v of model.variables){
  const x=parameters[v.name],d=v.domain;
  if(d.kind==='number'&&(typeof x!=='number'||!Number.isFinite(x)||x<d.min||x>d.max||d.integer&&!Number.isInteger(x)))fail('变量 '+v.name+' 超出数值域');
  if(d.kind==='enum'&&!d.values.includes(x))fail('变量 '+v.name+' 超出枚举域');
 }
 for(const c of model.numeric?.constraints??[]){
  const a=evaluate(c.left,parameters),b=evaluate(c.right,parameters);
  if(!({lt:()=>a<b,lte:()=>a<=b,eq:()=>a===b,ne:()=>a!==b,gte:()=>a>=b,gt:()=>a>b})[c.op]?.())fail('实例不满足题模联合约束');
 }
 return parameters;
}

export const parameterIdentity=(model,overrides={})=>JSON.stringify(model.variables.map(v=>[v.name,Object.hasOwn(overrides,v.name)?overrides[v.name]:model.baseParameters[v.name]]));
/** Only content shown to the student; explanations and hidden parameters excluded. */
export const visiblePrompt=row=>[row.stem,...(row.choices??[]).map(c=>c.label+'. '+c.text)].join('\n');

export async function validateItemModel(model,{idea,pointIds,basisCount,basisPointIds}){
 if(!model||model.version!=='r4-item-model-v1')fail('需要显式 r4-item-model-v1 题模');
 if(!strings(model.invariants)||!strings(model.preconditions)||!strings(model.evidenceRules))fail('题模须有不变量、前提和可观察证据规则');
 const adaptation=model.adaptation;
 if(!adaptation||!ADAPTATIONS.includes(adaptation.operation)||!text(adaptation.preservedKnowledge)||!text(adaptation.changedDemand)||!Array.isArray(adaptation.sourceBasisIndexes)||!adaptation.sourceBasisIndexes.length||!unique(adaptation.sourceBasisIndexes)||adaptation.sourceBasisIndexes.some(i=>!Number.isInteger(i)||i<0||i>=basisCount))fail('题模须声明有原文依据的改编操作、保留知识与改变的任务');
 if(!Array.isArray(model.attributes)||!model.attributes.length||!unique(model.attributes.map(a=>a.id)))fail('题模属性必须非空且唯一');
 for(const a of model.attributes)if(!text(a.id)||!text(a.label)||!strings(a.pointIds)||a.pointIds.some(id=>!pointIds.includes(id)))fail('题模属性必须绑定本次知识点');
 if(idea.relation&&pointIds.some(id=>!model.attributes.some(a=>a.pointIds.includes(id))))fail('综合题模缺少分支技能属性');
 if(!Array.isArray(model.variables)||!unique(model.variables.map(v=>v.name)))fail('题模变量名必须唯一');
 for(const v of model.variables){
  if(!/^[\p{L}][\p{L}\p{N}_]{0,39}$/u.test(v.name))fail('变量名不合法：'+String(v.name)+'；应以中文或其他字母开头，后接字母、数字或下划线，最多40字');
  if(!roles.includes(v.role))fail('变量 '+v.name+' 的角色须为 incidental 或 radical');
  if(!text(v.meaning)||!['number','enum'].includes(v.domain?.kind))fail('变量 '+v.name+' 缺少含义或合法域类型（number/enum）');
  const d=v.domain;
  if(d.kind==='number'&&(!Number.isFinite(d.min)||!Number.isFinite(d.max)||d.min>d.max||typeof d.integer!=='boolean'))fail('数值域无效');
  if(d.kind==='enum'&&(!Array.isArray(d.values)||!d.values.length||!unique(d.values)||d.values.some(x=>typeof x!=='string'&&!(typeof x==='number'&&Number.isFinite(x)))))fail('枚举域无效');
 }
 if(!Array.isArray(model.solutionSteps)||!model.solutionSteps.length)fail('题模须声明解题操作及技能证据');
 for(const step of model.solutionSteps)if(!text(step.action)||!model.attributes.some(a=>a.id===step.attributeId)||!Array.isArray(step.basisIndexes)||!step.basisIndexes.length||step.basisIndexes.some(i=>!Number.isInteger(i)||i<0||i>=basisCount))fail('解题步骤缺少有效属性或原文证据');
 if(model.attributes.some(a=>!model.solutionSteps.some(s=>s.attributeId===a.id)))fail('每个预期技能都需要解题证据');
 if(basisPointIds)for(const a of model.attributes){
  const indexes=model.solutionSteps.filter(s=>s.attributeId===a.id).flatMap(s=>s.basisIndexes);
  if(a.pointIds.some(id=>!indexes.some(i=>basisPointIds[i].includes(id))))fail('技能解题证据必须来自所绑定知识点：'+a.id);
 }
 if(!Array.isArray(model.errorModels)||!unique(model.errorModels.map(e=>e.id)))fail('错误模型必须有唯一身份');
 for(const e of model.errorModels)if(!text(e.id)||!text(e.misconception)||!text(e.operation)||!strings(e.attributeIds)||e.attributeIds.some(id=>!model.attributes.some(a=>a.id===id)))fail('干扰项错误机制缺少技能关联');
 if(idea.types.includes('mcq')&&model.errorModels.length<3)fail('选择题模须有至少三类可核对的错误机制');
 if(!['hypothesis'].includes(model.difficulty?.status)||!text(model.difficulty?.rationale))fail('无学生数据时只能记录设计难度假设');
 if(idea.types.includes('trueFalse')&&model.numeric!==null)fail('判断题题模必须使用 numeric:null，不能把真假标签作为数值答案');
 if(model.numeric!==null){
  if(!model.numeric||!Array.isArray(model.numeric.constraints)||model.numeric.constraints.some(c=>!['lt','lte','eq','ne','gte','gt'].includes(c.op)))fail('数值验证器定义无效');
  evaluate(model.numeric.answer,model.baseParameters);
  for(const e of model.errorModels)if(e.expression===null||e.expression===undefined)fail('数值题模的错误机制须有表达式');else evaluate(e.expression,model.baseParameters);
 }
 validateParameters(model,model.baseParameters);
 // Numeric instances and wording of administrative fields are not new families.
 // This is a structural identity, not a proof of semantic novelty.
 const familyId=await contentHash(['r4-family-v2',pointIds.slice().sort(),normalizedText(idea.target),normalizedText(idea.operation),model.attributes.map(a=>[a.id,a.pointIds.slice().sort()]).sort(),model.invariants.map(normalizedText),model.solutionSteps.map(s=>[s.attributeId,normalizedText(s.action)]),model.numeric?.answer??null]);
 return {...structuredClone(model),familyId};
}

const number=value=>{
 let s=String(value).trim().replaceAll('−','-');
 for(const [a,b]of [['$$','$$'],['$','$'],['\\(','\\)']])if(s.startsWith(a)&&s.endsWith(b))s=s.slice(a.length,-b.length).trim();
 const percent=s.endsWith('%');if(percent)s=s.slice(0,-1).replace(/\\$/,'').trim();
 const fraction=s.match(/^\\(?:frac|dfrac|tfrac)\{([^{}]+)\}\{([^{}]+)\}$/);if(fraction)s=fraction[1]+'/'+fraction[2];
 const parts=s.split('/').map(x=>x.trim()),numeric=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
 if(parts.length>2||parts.some(x=>!numeric.test(x)||!Number.isFinite(Number(x)))||parts.length===2&&Number(parts[1])===0)fail('数值校验需要有限且无歧义的数字答案；可用小数、分数字面量或百分数，单位放在题干，概念/公式陈述题应在题模使用 numeric:null');
 const result=Number(parts[0])/(parts.length===2?Number(parts[1]):1)/(percent?100:1);if(!Number.isFinite(result))fail('数值答案必须有限');return result;
};
const close=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
export function validateIndependentNumeric(solution,model,parameters,type){
 if(['shortAnswer','cloze'].includes(type)&&model.numeric&&!close(number(solution.answer),evaluate(model.numeric.answer,parameters)))fail('独立求解的数值简答或填空与题模计算结果不一致');
}
export function validateInstance(row,model,variant,type){
 validateParameters(model,row.parameters);
 const expected={...model.baseParameters,...variant.parameters};
 if(Object.keys(variant.parameters).some(k=>!Object.hasOwn(model.baseParameters,k)))fail('变体引用未定义变量');
 if(Object.keys(expected).some(k=>row.parameters[k]!==expected[k]))fail('实例未落实预留变体参数');
 if(type==='mcq'){
  const wrong=row.choices.filter(c=>c.label!==row.answer),links=row.distractors;
  if(!Array.isArray(links)||links.length!==3||!unique(links.map(d=>d.label))||!unique(links.map(d=>d.errorId)))fail('三个干扰项须分别绑定不同错误机制');
  for(const link of links){if(!wrong.some(c=>c.label===link.label))fail('干扰项绑定了正确答案；允许的错误项：'+wrong.map(c=>c.label).join(','));if(!model.errorModels.some(e=>e.id===link.errorId))fail('干扰项绑定了未知错误机制 '+link.errorId+'；必须使用已有errorId：'+model.errorModels.map(e=>e.id).join(','));}
 }
 if(model.numeric){
  const correct=evaluate(model.numeric.answer,row.parameters),answer=type==='mcq'?row.choices.find(c=>c.label===row.answer)?.text:row.answer;
  if(!close(number(answer),correct))fail('参考答案与题模计算结果不符');
  for(const link of row.distractors??[]){const e=model.errorModels.find(e=>e.id===link.errorId),value=evaluate(e.expression,row.parameters);if(close(value,correct)||!close(number(row.choices.find(c=>c.label===link.label)?.text),value))fail('干扰项与错误操作不一致或等于正确答案');}
 }
 return row;
}

export function validateAttributeReview(verdict,row,model,type){
 const prompt=visiblePrompt(row);
 if(verdict.selfContained!==true||verdict.learningValue!==true||verdict.parametersMatched!==true||verdict.operationMatched!==true)fail('题面自足性、学习价值、参数或认知操作未通过');
 const checks=verdict.attributeChecks;
 if(!Array.isArray(checks)||checks.length!==model.attributes.length||!unique(checks.map(c=>c.id)))fail('缺少逐技能的实际作答核验');
 for(const a of model.attributes){const c=checks.find(c=>c.id===a.id);if(c?.required!==true)fail('实际作答未必需题模技能：'+a.id);if(!text(c.promptQuote)||c.promptQuote.trim().length<6||!prompt.includes(c.promptQuote)||!text(c.reason))fail('技能证据须逐字来自学生可见题面：'+a.id);}
 const evidence=verdict.evidenceChecks;
 if(!Array.isArray(evidence)||evidence.length!==model.evidenceRules.length||!unique(evidence.map(c=>c.ruleIndex)))fail('缺少逐条作答证据核验');
 for(const [i]of model.evidenceRules.entries()){
  const c=evidence.find(c=>c.ruleIndex===i);
  if(c?.observable!==true)fail('题目不能提供声明的可观察作答证据');
  if(!text(c.promptQuote)||c.promptQuote.trim().length<6||!prompt.includes(c.promptQuote)||!text(c.reason))fail('作答证据须逐字来自学生可见题面');
 }
 if(type==='mcq'){
  const checks=verdict.distractorChecks;
  if(!Array.isArray(checks)||checks.length!==3||!unique(checks.map(c=>c.label)))fail('缺少逐干扰项机制核验');
  for(const link of row.distractors){const c=checks.find(c=>c.label===link.label);if(c?.errorId!==link.errorId||c?.errorMatched!==true||!text(c.reason))fail('干扰项没有实现声明的错误机制');}
 }
 return {modelAttributes:model.attributes.map(a=>a.id),actualAttributes:checks.filter(c=>c.required).map(c=>c.id),evidence:structuredClone(checks),evidenceRules:structuredClone(evidence),status:'model-reviewed-unvalidated'};
}
