import * as base from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/tools.mjs';
import {ADAPTATIONS} from './item-model.mjs';
export {failedTool} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/tools.mjs';
/** Generic hosts may report failures as terminal chunks instead of throwing. */
export const createToolTransport=host=>base.createToolTransport({...host,async prepareCall(...args){
 const prepared=await host.prepareCall(...args);
 return {...prepared,async *stream(options){
  let finished=false;
  for await(const chunk of prepared.stream(options)){
   if(chunk.type==='finish'){
    const reason=chunk.reason;
    if(!['stop','tool-calls'].includes(reason?.kind))throw Object.assign(Error(reason?.failure?.message??'模型未完整结束：'+(reason?.kind??'unknown')),{code:reason?.kind==='aborted'?'CANCELLED':reason?.failure?.code??'INCOMPLETE'});
    finished=true;
   }
   yield chunk;
  }
  if(!finished)throw Object.assign(Error('模型流缺少完整结束标记'),{code:'INCOMPLETE'});
 }};
}});
export const TOOLS=structuredClone(base.TOOLS);
const string={type:'string',minLength:1},bool={type:'boolean'},object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const array=items=>({type:'array',items}),parameters={type:'object',additionalProperties:{anyOf:[string,{type:'number'}]}};
// Deep semantic checks live in item-model.mjs; the wire still declares all fields.
TOOLS.submit_idea.parameters.properties.itemModel=object({version:{type:'string',enum:['r4-item-model-v1']},attributes:array(object({id:string,label:string,pointIds:array(string)})),invariants:array(string),preconditions:array(string),evidenceRules:array(string),variables:array(object({name:string,meaning:string,role:{type:'string',enum:['incidental','radical']},domain:{type:'object'}})),baseParameters:parameters,solutionSteps:array(object({action:string,attributeId:string,basisIndexes:array({type:'integer'})})),errorModels:array(object({id:string,misconception:string,operation:string,attributeIds:array(string),expression:{anyOf:[{type:'null'},{type:'number'},string,{type:'object'}]}})),numeric:{anyOf:[{type:'null'},{type:'object'}]},difficulty:object({status:{type:'string',enum:['hypothesis']},rationale:string})});
TOOLS.submit_idea.parameters.required.push('itemModel');
TOOLS.submit_idea.parameters.properties.itemModel.properties.adaptation=object({operation:{type:'string',enum:ADAPTATIONS},sourceBasisIndexes:array({type:'integer'}),preservedKnowledge:string,changedDemand:string});
TOOLS.submit_idea.parameters.properties.itemModel.required.push('adaptation');
// Spell out executable fields on the wire, so a real model need not infer them
// from semantic validation errors or from our synthetic fixtures.
const operators={type:'string',enum:['add','subtract','multiply','divide','power']};
const expression={anyOf:[{type:'number'},string,object({op:operators,args:{type:'array',minItems:2,maxItems:2,items:{anyOf:[{type:'number'},string,{type:'object',description:'递归表达式，仍为 {op,args:[left,right]}，运算符同上；叶为有限数字或变量名。'}]}}})]};
const model=TOOLS.submit_idea.parameters.properties.itemModel.properties;
model.variables.items.properties.domain={anyOf:[object({kind:{type:'string',enum:['number']},min:{type:'number'},max:{type:'number'},integer:bool}),object({kind:{type:'string',enum:['enum']},values:{type:'array',minItems:1,items:{anyOf:[string,{type:'number'}]}}})]};
model.numeric={anyOf:[{type:'null'},object({answer:expression,constraints:array(object({op:{type:'string',enum:['lt','lte','eq','ne','gte','gt']},left:expression,right:expression}))})]};
model.errorModels.items.properties.expression={anyOf:[{type:'null'},...expression.anyOf]};
model.variables.items.properties.name={...string,maxLength:40,description:'稳定变量名，支持中文/其他字母开头，后接字母、数字或下划线，最多40字。'};
const item=TOOLS.submit_question.parameters.properties.items.items;
item.properties.parameters=parameters;item.properties.distractors=array(object({label:string,errorId:string}));item.required.push('parameters','distractors');
// 返工时的硬约束：上一轮审核点名的必改位置。可以不填（首次出题），填了就要真的改到。
item.properties.mustFix={anyOf:[{type:'null'},{type:'string'}]};
Object.assign(TOOLS.submit_review.parameters.properties,{selfContained:bool,learningValue:bool,parametersMatched:bool,operationMatched:bool,attributeChecks:array(object({id:string,required:bool,promptQuote:string,reason:string})),distractorChecks:array(object({label:string,errorId:string,errorMatched:bool,reason:string}))});
TOOLS.submit_review.parameters.required.push('selfContained','learningValue','parametersMatched','operationMatched','attributeChecks','distractorChecks');
TOOLS.submit_review.parameters.properties.evidenceChecks=array(object({ruleIndex:{type:'integer'},observable:bool,promptQuote:string,reason:string}));
TOOLS.submit_review.parameters.required.push('evidenceChecks');
// 前提核验：题模的 preconditions 逐条要求审核指回学生可见题面。
// 缺这个字段，preconditions 就只是「写了一句没人查」的装饰。
TOOLS.submit_review.parameters.properties.preconditionChecks=array(object({index:{type:'integer'},satisfied:bool,promptQuote:string,reason:string}));
TOOLS.submit_review.parameters.required.push('preconditionChecks');
Object.assign(TOOLS.submit_review.parameters.properties,{independentMatched:bool,independentReason:string});
TOOLS.submit_review.parameters.required.push('independentMatched','independentReason');
// 缺陷清单：审核判 false 时必须说清「改哪里、改什么」，返工才有落脚点。
// 实测过一次三稿都没动被点名的那一项 —— 旧版只给自由文本，模型自己猜错了位置。
// target 用选项标签 A–D 或 stem/explanation/rubric，让返工能精确指向学生可见的某一处。
TOOLS.submit_review.parameters.properties.defects=array(object({
  target:{type:'string'},
  kind:{type:'string',enum:['ambiguous','not-unique','wrong','not-self-contained','leaked','weak-distractor','other']},
  detail:string,
}));
TOOLS.submit_solution={name:'submit_solution',description:'只看题面独立作答；不查看作者答案、解析与题模。',parameters:object({valid:bool,selfContained:bool,answer:string,explanation:string,reason:string,optionTruth:{type:'object'},
 // 盲解同时报「题目本身有毛病」。盲解是最便宜的一步（实测约 1.9k token，审核约 5.5k），
 // 让它顺手标记歧义/多解，就能在付审核那份钱之前把问题拦下来。
 // 实测那次 D 项歧义，盲解其实看得出（它选了 B 也说明了理由），却没有任何字段能表达，
 // 只能等最贵的审核发现。
 ambiguity:{type:'string',enum:['none','another-option-also-true','option-unclear','question-ambiguous']},
 ambiguityDetail:{type:'string'}
},['valid','selfContained','answer','explanation','reason'])};

export const toolRequest=(name,request,binding)=>{
 const tool=structuredClone(TOOLS[name]);
 if(name==='submit_question'&&binding){
  const row=tool.parameters.properties.items.items,model=binding.idea.itemModel,parameters={...model.baseParameters,...binding.variant.parameters};
  row.properties.parameters=object(Object.fromEntries(Object.entries(parameters).map(([key,value])=>[key,{type:typeof value,enum:[value]}])));
  if(binding.type==='mcq'){
   row.properties.distractors.items.properties.label={type:'string',enum:['A','B','C','D']};
   row.properties.distractors.items.properties.errorId={type:'string',enum:model.errorModels.map(e=>e.id)};
  }else row.properties.distractors.maxItems=0;
 }
 if(name==='submit_solution'&&binding&&['mcq','trueFalse'].includes(binding.type))tool.parameters.properties.answer={type:'string',enum:binding.type==='mcq'?['A','B','C','D','无法确定']:['正确','错误','无法确定']};
 return {...request,tools:[tool],toolChoice:{type:'function',function:{name}}};
};
export const nodeToolRequest=request=>({...request,tools:[TOOLS.submit_idea,TOOLS.finish_node],toolChoice:'required'});
export function toolArguments(raw,name){
 if(!Array.isArray(raw?.toolCalls)||raw.toolCalls.length!==1||raw.toolCalls[0].name!==name||typeof raw.toolCalls[0].id!=='string'||!raw.toolCalls[0].id)throw Error('必须提交一次带字符串call ID的原生工具 '+name);
 const value=typeof raw.toolCalls[0].arguments==='string'?JSON.parse(raw.toolCalls[0].arguments):structuredClone(raw.toolCalls[0].arguments);
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('工具参数必须为对象');
 if(name==='submit_solution'){
  if(typeof value.valid!=='boolean'||typeof value.selfContained!=='boolean'||['answer','explanation','reason'].some(k=>typeof value[k]!=='string'||!value[k].trim()))throw Error('独立求解缺少明确判定和解答');
 }else{
  const stripped=structuredClone(value);
  if(name==='submit_idea'){if(!value.itemModel)throw Error('考法必须包含显式题模');delete stripped.itemModel;}
  if(name==='submit_question')for(const row of stripped.items??[]){delete row.parameters;delete row.distractors;}
  if(name==='submit_review')for(const key of ['selfContained','learningValue','parametersMatched','operationMatched','attributeChecks','distractorChecks','evidenceChecks','preconditionChecks','defects','independentMatched','independentReason'])delete stripped[key];
  base.toolArguments({toolCalls:[{...raw.toolCalls[0],arguments:JSON.stringify(stripped)}]},name);
 }
 return value;
}
