import {evaluate} from './item-model.mjs';
// Explicit synthetic model: exercises mechanisms, never measures question quality.
const leaf=id=>({id,title:id,text:`知识点${id}的完整定义与边界。第二部分说明适用条件。`,pages:[{page:id,text:`页面${id}完整说明`,visual:'图示条件'}],point:{id},children:[]});
export const graph=()=>({id:'synthetic',root:{id:'root',title:'同一章节',children:[leaf('a'),leaf('b'),leaf('c')]}});
const tool=(name,value)=>({id:crypto.randomUUID(),name,arguments:JSON.stringify(value)});
export function model({legacy=false,expandModels=false}={}){
 const calls=[];return {calls,call:async request=>{
  const d=JSON.parse(request.variable);calls.push({stage:request.stage,input:d});
  if(request.stage.endsWith('-ideas')){
   const n=d.subtree,refs=n.children.length?n.children.map((c,i)=>({path:[i],source:'lecture',part:0})):[{path:[],source:'lecture',part:0}];
   const key=expandModels&&d.expanding?'task-'+d.acceptedKeys.length:'task';
   const idea={key,focus:n.title+'的条件判定'+key,target:n.title+'需要推出的条件关系'+key,operation:'根据条件作判断',strategy:'understand',types:['mcq'],conditions:['保持原条件'],basis:refs,answerPoints:refs.map((r,i)=>({text:'由对应证据推出条件',basisIndexes:[i]})),variants:[{key:'second',instruction:'改变数值后重新推导所求总量',parameters:{x:8,y:2}}],relation:n.children.length?{kind:'compare',explanation:'两分支共同决定一个判断',needs:n.children.map((c,i)=>({child:i,target:c.title+'中的必要推理',basisIndexes:[i]}))}:null};
   if(!legacy){
    const ids=d.selection.pointIds;
    const attributes=ids.map(id=>({id:'skill-'+id,label:'知识点'+id+'的条件与运算',pointIds:[id]}));
    idea.strategy=d.selection.strategies[0];idea.types=d.selection.types;
    idea.itemModel={version:'r4-item-model-v1',adaptation:{operation:n.children.length?'synthesis':'parameter-change',sourceBasisIndexes:refs.map((_,i)=>i),preservedKnowledge:'保留给定条件与运算关系',changedDemand:'从合成材料提出需利用全部条件求解的任务'},attributes,invariants:['给定变量后按照指定运算求解'],preconditions:['两个数值都在题面给出'],evidenceRules:['学生需要使用给定条件完成运算'],variables:[{name:'x',meaning:'第一个数量',role:'radical',domain:{kind:'number',min:6,max:10,integer:true}},{name:'y',meaning:'第二个数量',role:'radical',domain:{kind:'number',min:2,max:3,integer:true}}],baseParameters:{x:6,y:2},solutionSteps:attributes.map((a,i)=>({action:'使用对应条件并完成运算',attributeId:a.id,basisIndexes:[Math.min(i,refs.length-1)]})),errorModels:[{id:'subtract',misconception:'把合计误作差',operation:'减去第二个数量',attributeIds:attributes.map(a=>a.id),expression:{op:'subtract',args:['x','y']}},{id:'multiply',misconception:'把合计误作积',operation:'相乘两个数量',attributeIds:attributes.map(a=>a.id),expression:{op:'multiply',args:['x','y']}},{id:'divide',misconception:'把合计误作比',operation:'用第一个数量除第二个数量',attributeIds:attributes.map(a=>a.id),expression:{op:'divide',args:['x','y']}}],numeric:{answer:{op:'add',args:['x','y']},constraints:[{op:'gt',left:'x',right:'y'}]},difficulty:{status:'hypothesis',rationale:'两项条件和一次运算，未做学生作答校准'}};
   }

   if(!legacy&&d.expanding&&expandModels){
    idea.target=n.title+'需要用全部条件求乘积';idea.operation='计算两个数量的乘积';idea.focus=n.title+'的乘积任务';
    idea.itemModel.numeric.answer={op:'multiply',args:['x','y']};
    idea.itemModel.solutionSteps.forEach(step=>step.action='利用对应条件计算乘积');
    idea.itemModel.errorModels=[{id:'add',misconception:'把乘积误作合计',operation:'相加两个数量',attributeIds:idea.itemModel.attributes.map(a=>a.id),expression:{op:'add',args:['x','y']}},...idea.itemModel.errorModels.filter(e=>e.id!=='multiply')];
   }
   if(!legacy&&idea.types.includes('trueFalse'))idea.itemModel.numeric=null;
   return {toolCalls:[tool('submit_idea',idea),tool('finish_node',{included:[n.title],unassessable:[]})]};
  }
  if(request.stage==='r3-instantiate'){
   const parameters={...d.idea.itemModel.baseParameters,...d.variant.parameters},x=parameters.x,y=parameters.y;
   const itemModel=d.idea.itemModel,product=itemModel.numeric?.answer.op==='multiply',answer=product?x*y:x+y;
   const errors=itemModel.errorModels,values=[evaluate(errors[0].expression,parameters),answer,evaluate(errors[1].expression,parameters),evaluate(errors[2].expression,parameters)];
   const q={stem:d.idea.focus+'：给定x='+x+'，y='+y+'，求x'+(product?'*':'+')+'y。',answer:d.type==='mcq'?'B':String(answer),choices:d.type==='mcq'?values.map((v,i)=>({label:'ABCD'[i],text:String(v)})):[],explanation:'使用给定条件运算得到'+answer+'。',rubric:['使用所有条件完成指定运算'],parameters,distractors:d.type==='mcq'?['A','C','D'].map((label,i)=>({label,errorId:errors[i].id})):[]};
   if(d.type==='cloze')q.stem+='结果为{{c1::'+answer+'}}。';
   if(d.type==='trueFalse'){q.stem+='结果为'+answer+'，此判断是否正确？';q.answer='正确';}
   return {toolCalls:[tool('submit_question',{items:[q]})]};
  }
  if(request.stage==='r4-independent-solve'){
   const values=d.item.stem.match(/x=(\d+)，y=(\d+)/);
   if(!values)return {toolCalls:[tool('submit_solution',{valid:false,selfContained:false,answer:'无法确定',explanation:'不能借用例题的隐藏数值',reason:'题面未给出本实例的必要数值'})]};
   const [,x,y]=values,answer=d.item.stem.includes('求x*y')?Number(x)*Number(y):Number(x)+Number(y);
   const optionTruth=Object.fromEntries((d.item.choices??[]).map(c=>[c.label,Number(c.text)===answer]));
   const correct=Object.keys(optionTruth).filter(label=>optionTruth[label]);
   return {toolCalls:[tool('submit_solution',{valid:d.type!=='mcq'||correct.length===1,selfContained:true,answer:d.type==='mcq'?correct.join(',')||'无正确选项':d.type==='trueFalse'?'正确':String(answer),explanation:'由题面给定数值独立完成指定运算。',reason:'题面给出了全部条件',optionTruth})]};
  }
  if(request.stage==='r3-validate-instance')return {toolCalls:[tool('submit_review',{valid:true,assetMatched:true,variantMatched:true,reason:'任务匹配',independentMatched:true,independentReason:'独立计算与作者答案一致',optionTruth:{A:false,B:true,C:false,D:false},selfContained:true,learningValue:true,parametersMatched:true,operationMatched:true,attributeChecks:d.idea.itemModel.attributes.map(a=>({id:a.id,required:true,promptQuote:d.item.stem,reason:'给定条件参与本题计算'})),evidenceChecks:d.idea.itemModel.evidenceRules.map((rule,ruleIndex)=>({ruleIndex,observable:true,promptQuote:d.item.stem,reason:'题目和评分点要求显式使用条件并完成运算'})),distractorChecks:d.item.distractors.map(e=>({...e,errorMatched:true,reason:'按此错误操作得到该选项'})),...(d.idea.relation?{branchChecks:d.idea.relation.needs.map(n=>({child:n.child,promptQuote:d.item.stem,necessary:true,givenAway:false,reason:'共同依赖'}))}:{})})]};
  if(request.stage==='r3-critical-audit')return {toolCalls:[tool('submit_audit',{explanationValid:true,unsupportedClaims:[],reason:'推理成立',joint:true,neededChildren:d.requiredChildren,jointPromptQuote:d.item.stem,leakedTarget:false})]};
  throw Error('unexpected stage '+request.stage);
 }};
}
