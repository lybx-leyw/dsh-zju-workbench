const string={type:'string',minLength:1},index={type:'integer',minimum:0};
const array=(items,minItems=0,maxItems=100)=>({type:'array',items,minItems,maxItems});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const reference=object({path:{...array(index,0,64),description:'从输入 subtree 根出发的相对路径，复制节点上标注的 path；叶节点为 []'},source:{type:'string',enum:['lecture','page']},page:{anyOf:[{type:'integer'},string]},field:{type:'string',enum:['text','visual']},part:{...index,description:'选择该节点 lecture 或指定页字段中已标注的 part 编号；原文由程序取回，不重写引文'}},['path','source','part']);
const relation={anyOf:[{type:'null'},object({kind:string,explanation:string,needs:array(object({child:index,target:{...string,description:'需要学生根据本分支推断的内容，不能作为题干已知答案给出'},basisIndexes:array(index,1)}),2)})]};
const idea=object({key:string,focus:string,target:{...string,description:'这条考法要求学生得到的未知结论；区别于题目可以给定的条件'},operation:string,strategy:{type:'string',enum:['recall','understand','apply','explore']},types:array({type:'string',enum:['mcq','cloze','trueFalse','shortAnswer']},1,4),conditions:array(string),basis:array(reference,1),answerPoints:array(object({text:string,basisIndexes:array(index,1)}),1),variants:array(object({key:string,instruction:{...string,minLength:6},parameters:{type:'object',additionalProperties:{anyOf:[string,{type:'number'}]}}}),0,8),relation});
export const TOOLS={
 submit_idea:{name:'submit_idea',description:'向当前树节点提交一个考法。每次调用只提交一条；同一轮可多次调用。程序检查逐字来源、跨分支关系及变体，不由模型提供节点ID。',parameters:idea},
 finish_node:{name:'finish_node',description:'当前节点考法提交完毕后调用一次。可选记录覆盖内容、风险与简短说明；备注不代替程序的来源校验。可以与 submit_idea 同一轮调用。',parameters:object({included:array(string),unassessable:array(string),reason:{type:'string'}},[])},
 submit_question:{name:'submit_question',description:'提交当前预留任务的一道题。程序检查来源绑定与题型格式，随后复核答案；不接受改变节点、考法或变体身份。',parameters:object({items:array(object({stem:string,answer:string,explanation:string,choices:array(object({label:{type:'string',enum:['A','B','C','D']},text:string}),0,4),rubric:array(string),usedBasisIndexes:array(index,1)},['stem','answer','explanation']),1,1)})},
 submit_review:{name:'submit_review',description:'提交当前题目的独立复核结论；选择题逐项判断真假。跨节点题逐分支指明必答题干原句、是否必要、是否已由题干泄漏答案。',parameters:object({valid:{type:'boolean'},assetMatched:{type:'boolean'},variantMatched:{type:'boolean'},reason:string,optionTruth:object({A:{type:'boolean'},B:{type:'boolean'},C:{type:'boolean'},D:{type:'boolean'}}),branchChecks:array(object({child:index,promptQuote:{...string,minLength:6},necessary:{type:'boolean'},givenAway:{type:'boolean'},reason:string}),2)},['valid','assetMatched','variantMatched','reason'])},
 submit_audit:{name:'submit_audit',description:'独立质疑候选题的解析与跨分支推理。未提供预设正确选项或原考法，请根据材料检查推断；指出实际解析中的错误原句。',parameters:object({explanationValid:{type:'boolean'},unsupportedClaims:array(object({quote:string,reason:string})),reason:string,joint:{type:'boolean'},neededChildren:array(index),jointPromptQuote:{type:'string'},leakedTarget:{type:'boolean'}},['explanationValid','unsupportedClaims','reason'])},
 submit_variants:{name:'submit_variants',description:'仅给当前树节点已有考法补充有实质条件变化的变体；不能新造知识点、改变来源或用改写凑数。不能支持时返回空数组并说明原因。',parameters:object({variants:array(object({ideaKey:string,key:string,instruction:{...string,minLength:12},parameters:{type:'object',additionalProperties:{anyOf:[string,{type:'number'}]}},difference:{...string,minLength:10}}),0,12),reason:string})},
};
export function toolRequest(name,request){
 const tool=TOOLS[name];if(!tool)throw Error('未注册工具：'+name);
 return {...request,tools:[tool],toolChoice:{type:'function',function:{name}}};
}
export function nodeToolRequest(request){return {...request,tools:[TOOLS.submit_idea,TOOLS.finish_node],toolChoice:'required'};}
export function nodeArguments(raw){
 if(!Array.isArray(raw?.toolCalls)||!raw.toolCalls.length)throw Error('必须调用 submit_idea / finish_node，不接受正文中的伪工具调用');
 const ideas=[];let coverage;
 for(const call of raw.toolCalls){
  if(!['submit_idea','finish_node'].includes(call.name))throw Error('未注册的节点工具：'+call.name);
  const value=toolArguments({toolCalls:[call]},call.name);
  if(call.name==='submit_idea')ideas.push(value);else{if(coverage)throw Error('finish_node 只能调用一次');coverage=value;}
 }
 if(!coverage)throw Error('考法已提交，但缺少 finish_node 完成确认');
 if(ideas.length>64)throw Error('一个节点本轮最多提交64条考法');return {ideas,coverage:{included:coverage.included??[],unassessable:coverage.unassessable??[],reason:coverage.reason??''}};
}
function validate(value,schema,path='arguments'){
 if(schema.anyOf){if(schema.anyOf.some(choice=>{try{validate(value,choice,path);return true;}catch{return false;}}))return;throw Error(path+' 不符合允许的参数类型');}
 const type=value===null?'null':Array.isArray(value)?'array':typeof value;
 if(schema.type==='integer'?!Number.isInteger(value):type!==schema.type)throw Error(path+' 应为 '+schema.type);
 if(schema.enum&&!schema.enum.includes(value))throw Error(path+' 不在工具允许的取值内');
 if(type==='string'&&value.trim().length<(schema.minLength??0))throw Error(path+' 文字过短');
 if(type==='number'&&(!Number.isFinite(value)||schema.minimum!==undefined&&value<schema.minimum))throw Error(path+' 数值无效');
 if(type==='array'){
  if(value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))throw Error(path+' 项数不符合工具定义');
  value.forEach((item,i)=>validate(item,schema.items,path+'['+i+']'));
 }
 if(type==='object'){
  for(const key of schema.required??[])if(!Object.hasOwn(value,key))throw Error(path+'.'+key+' 为必需参数');
  for(const [key,part]of Object.entries(value)){
   if(schema.properties&&Object.hasOwn(schema.properties,key))validate(part,schema.properties[key],path+'.'+key);
   else if(schema.additionalProperties===false)throw Error(path+'.'+key+' 不是已注册工具的参数');
   else if(typeof schema.additionalProperties==='object')validate(part,schema.additionalProperties,path+'.'+key);
  }
 }
}
export function toolArguments(raw,name){
 if(!Array.isArray(raw?.toolCalls)||raw.toolCalls.length!==1||raw.toolCalls[0].name!==name)throw Error('必须调用一次工具 '+name+' 提交，不接受正文中的伪工具调用');
 const call=raw.toolCalls[0];if(typeof call.id!=='string'||!call.id)throw Error('工具调用缺少供应商分配的 call ID');
 const value=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('工具参数必须为对象');validate(value,TOOLS[name].parameters);return value;
}
export function failedTool(raw,error){return {toolCalls:raw?.toolCalls??[],text:raw?.text??'',error:String(error.message??error)};}

/** Execute the real native tool-call wire protocol, including error replies. Never text-to-JSON. */
export function createToolTransport(host){return async request=>{
 const blocks=text=>[{type:'text',text}],messages=[{role:'system',content:blocks(request.constant)},{role:'user',content:blocks(request.variable)}];
 for(const previous of [...(request.toolHistory??[]),...(request.toolFeedback?[request.toolFeedback]:[])]){
  if(previous.toolCalls.length){
   messages.push({role:'assistant',content:previous.toolCalls.map(c=>({type:'tool-call',id:c.id,name:c.name,arguments:typeof c.arguments==='string'?c.arguments:JSON.stringify(c.arguments)}))});
   for(const c of previous.toolCalls){const result=previous.results?.find(r=>r.id===c.id)??{ok:false,error:previous.error};messages.push({role:'tool',source:{callId:c.id},content:blocks(JSON.stringify(result))});}
  }else if(previous.text)messages.push({role:'assistant',content:blocks(previous.text)},{role:'user',content:blocks(previous.error)});
 }
 const prepared=await host.prepareCall({},request.signal),calls=new Map();let text='',usage;
 for await(const c of prepared.stream({messages,tools:request.tools,toolChoice:request.toolChoice,signal:request.signal})){
  if(c.type==='text-delta')text+=c.text;
  if(c.type==='tool-call-delta'){const call=calls.get(c.index)??{id:'',name:'',arguments:''};if(c.id)call.id=c.id;if(c.name)call.name=c.name;call.arguments+=c.argumentsDelta??'';calls.set(c.index,call);}
  if(c.type==='usage')usage=c.usage;
 }
 return {text,toolCalls:[...calls.values()],usage};
 };}
