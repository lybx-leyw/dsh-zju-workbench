import {contentHash} from 'dsh-zhiyun-core-quiz/concepts';
import {normalizedText} from 'dsh-zhiyun-core-quiz/concepts';

const text=v=>typeof v==='string'&&v.trim().length>0;
const unique=xs=>new Set(xs).size===xs.length;
const strings=(xs,min=1)=>Array.isArray(xs)&&xs.length>=min&&xs.every(text)&&unique(xs);
// 每个失败都必须自带「下一步改哪里」。
// 实测（2026-10 dsa 真实跑）：`fail()` 只抛一句结论时，generator 把 error.instruct 写进
// mustFix，取不到就是 null —— 模型返工时只看到「三个干扰项须分别绑定不同错误机制」，
// 不知道动哪一项，于是连着两轮交回逐字相同的稿，撞上判重闸后整题报废。
// 所以这里把指令和消息绑在一处：消息给人看，instruction 给返工的模型照做。
//
// 另外要接住 fail(reviewFault(...)) 这种调用：传进来的已经是带 instruct/defects 的 Error。
// 旧写法 `Error(errorObj)` 会把消息变成 "Error: ..."，并把 instruct 丢掉 —— 这正好解释了
// 为什么 reviewFault 明明写了指令，真实跑里 mustFix 还是 null。
const fail=(message,instruction)=>{
 if(message instanceof Error){
  const error=Object.assign(Error(message.message),message);
  if(instruction&&!error.instruct)error.instruct=instruction;
  throw error;
 }
 throw Object.assign(Error(message),instruction?{instruct:instruction}:{});
};
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
 if(Object.keys(parameters).length!==model.variables.length||model.variables.some(v=>!Object.hasOwn(parameters,v.name)))fail('实例参数必须与题模变量逐一对应；缺少：'+model.variables.filter(v=>!Object.hasOwn(parameters,v.name)).map(v=>v.name).join(',')+'；多余：'+Object.keys(parameters).filter(k=>!model.variables.some(v=>v.name===k)).join(','),'- 必须修正【submission.parameters】：键集合要恰好等于 itemModel.variables 的 name 列表，一个不多一个不少。缺少的补上，多余的删掉；不要改动变量名或新增变量。');
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
 // 一次报全：实测某节点连续 3 轮各只收到一条错误（先「每个预期技能都需要解题证据」，
 // 补上后才轮到「变体必须改变显式参数」），模型每轮只能修一处，白烧三次调用。
 const issues=[];
 const collect=message=>{issues.push(message);};
 if(!model||model.version!=='r4-item-model-v1')collect('需要显式 r4-item-model-v1 题模');
 if(!strings(model.invariants)||!strings(model.preconditions)||!strings(model.evidenceRules))collect('题模须有不变量、前提和可观察证据规则');
 const adaptation=model.adaptation;
 if(!adaptation||!ADAPTATIONS.includes(adaptation.operation)||!text(adaptation.preservedKnowledge)||!text(adaptation.changedDemand)||!Array.isArray(adaptation.sourceBasisIndexes)||!adaptation.sourceBasisIndexes.length||!unique(adaptation.sourceBasisIndexes)||adaptation.sourceBasisIndexes.some(i=>!Number.isInteger(i)||i<0||i>=basisCount))collect('题模须声明有原文依据的改编操作、保留知识与改变的任务');
 if(!Array.isArray(model.attributes)||!model.attributes.length||!unique(model.attributes.map(a=>a.id)))collect('题模属性必须非空且唯一');
 for(const a of model.attributes)if(!text(a.id)||!text(a.label)||!strings(a.pointIds)||a.pointIds.some(id=>!pointIds.includes(id)))collect('题模属性必须绑定本次知识点');
 if(idea.relation&&pointIds.some(id=>!model.attributes.some(a=>a.pointIds.includes(id))))collect('综合题模缺少分支技能属性');
 if(!Array.isArray(model.variables)||!unique(model.variables.map(v=>v.name)))collect('题模变量名必须唯一');
 for(const v of model.variables){
  if(!/^[\p{L}][\p{L}\p{N}_]{0,39}$/u.test(v.name))collect('变量名不合法：'+String(v.name)+'；应以中文或其他字母开头，后接字母、数字或下划线，最多40字');
  if(!roles.includes(v.role))collect('变量 '+v.name+' 的角色须为 incidental 或 radical');
  if(!text(v.meaning)||!['number','enum'].includes(v.domain?.kind))collect('变量 '+v.name+' 缺少含义或合法域类型（number/enum）');
  const d=v.domain;
  if(d.kind==='number'&&(!Number.isFinite(d.min)||!Number.isFinite(d.max)||d.min>d.max||typeof d.integer!=='boolean'))collect('数值域无效');
  if(d.kind==='enum'&&(!Array.isArray(d.values)||!d.values.length||!unique(d.values)||d.values.some(x=>typeof x!=='string'&&!(typeof x==='number'&&Number.isFinite(x)))))collect('枚举域无效');
 }
 if(!Array.isArray(model.solutionSteps)||!model.solutionSteps.length)collect('题模须声明解题操作及技能证据');
 for(const step of model.solutionSteps)if(!text(step.action)||!model.attributes.some(a=>a.id===step.attributeId)||!Array.isArray(step.basisIndexes)||!step.basisIndexes.length||step.basisIndexes.some(i=>!Number.isInteger(i)||i<0||i>=basisCount))collect('解题步骤缺少有效属性或原文证据');
 if(model.attributes.some(a=>!model.solutionSteps.some(s=>s.attributeId===a.id)))collect('每个预期技能都需要解题证据');
 if(basisPointIds)for(const a of model.attributes){
  const indexes=model.solutionSteps.filter(s=>s.attributeId===a.id).flatMap(s=>s.basisIndexes);
  if(a.pointIds.some(id=>!indexes.some(i=>basisPointIds[i].includes(id))))collect('技能解题证据必须来自所绑定知识点：'+a.id);
 }
 if(!Array.isArray(model.errorModels)||!unique(model.errorModels.map(e=>e.id)))collect('错误模型必须有唯一身份');
 // 选择题只展示 3 个干扰项，但题模可以声明更多错误机制。
 // 实测出现过 E1/E2/E4（E3 缺失）：声明了 4 类、实例只用了其中 3 类，
 // 于是编号跳号，读报告的人会以为漏了一题。这里只要求**被用到的编号连续可数**。
 if(idea.types.includes('mcq')&&model.errorModels.length>3)collect('选择题模最多声明 3 类错误机制，多于 3 类时必然有未被使用的编号，会出现跳号（实测 E1/E2/E4）；请精简到恰好 3 类');
 // errorId 只要求**稳定、可区分**，不强制某种形态：语义名（subtract / misread-condition）
 // 比 E1/E2 更好读，强行改成代号反而会丢信息。真正要治的是「同一个题模跨批次换了写法」
 // （实测 c1 用 E1、c2 用 e1），那属于跨实例一致性问题，见 familyId 的输入集。
 for(const e of model.errorModels)if(!/^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(String(e.id)))collect('错误模型编号须以字母开头、只含字母数字下划线或连字符，且不超过 40 字，当前为：'+e.id);
 for(const e of model.errorModels)if(!text(e.id)||!text(e.misconception)||!text(e.operation)||!strings(e.attributeIds)||e.attributeIds.some(id=>!model.attributes.some(a=>a.id===id)))collect('干扰项错误机制缺少技能关联');
 if(idea.types.includes('mcq')&&model.errorModels.length<3)collect('选择题模须有至少三类可核对的错误机制');
 if(!['hypothesis'].includes(model.difficulty?.status)||!text(model.difficulty?.rationale))collect('无学生数据时只能记录设计难度假设');
 if(idea.types.includes('trueFalse')&&model.numeric!==null)collect('判断题题模必须使用 numeric:null，不能把真假标签作为数值答案');
 if(model.numeric!==null){
  if(!model.numeric||!Array.isArray(model.numeric.constraints)||model.numeric.constraints.some(c=>!['lt','lte','eq','ne','gte','gt'].includes(c.op)))collect('数值验证器定义无效');
  evaluate(model.numeric.answer,model.baseParameters);
  for(const e of model.errorModels)if(e.expression===null||e.expression===undefined)collect('数值题模的错误机制须有表达式');else evaluate(e.expression,model.baseParameters);
 }
 validateParameters(model,model.baseParameters);
 // Numeric instances and wording of administrative fields are not new families.
 // This is a structural identity, not a proof of semantic novelty.
 // 2026-10 扩了输入集：旧版只哈希 attributes / invariants / solutionSteps / answer，
 // 于是「仅前提不同」或「仅变量域不同」的两个题模会被判成同一家族，
 // 同模上限反而压低了真实多样性。把变量域、前提与错误机制纳入后，
 // 家族身份才追平它声称的「结构相同」。这是一次家族重算，旧检查点不能续跑。
 const familyId=await contentHash(['r4-family-v3',pointIds.slice().sort(),normalizedText(idea.target),normalizedText(idea.operation),model.attributes.map(a=>[a.id,a.pointIds.slice().sort()]).sort(),model.invariants.map(normalizedText),model.preconditions.map(normalizedText),model.variables.map(v=>[v.name,v.role,v.domain.kind,v.domain.kind==='number'?[v.domain.min,v.domain.max,v.domain.integer]:v.domain.values.slice().sort()]).sort(),model.solutionSteps.map(s=>[s.attributeId,normalizedText(s.action)]),model.errorModels.map(e=>[e.id,normalizedText(e.operation)]).sort(),model.numeric?.answer??null]);
 if(issues.length)throw Error('题模有 '+issues.length+' 处问题，请一次全部修正：\n- '+issues.join('\n- '));
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
 if(Object.keys(variant.parameters).some(k=>!Object.hasOwn(model.baseParameters,k)))fail('变体引用未定义变量','- 必须修正【submission.parameters】：只允许使用 itemModel.variables 里已声明的变量；出现的新名字请删掉，并在 itemModel 里另开变量（不要在本稿临时加）。');
 if(Object.keys(expected).some(k=>row.parameters[k]!==expected[k]))fail('实例未落实预留变体参数','- 必须修正【submission.parameters】：本次实例的参数已被预留，必须原样使用；请照抄给定的 parameters，不要自行重采样或改写成别的数值。');
 if(type==='mcq'){
  const wrong=row.choices.filter(c=>c.label!==row.answer),links=row.distractors;
  // 这句话以前只有结论。实测（dsa）作者连着两轮不知道要动哪个选项，最后交回逐字相同的稿。
  // 现在把「当前每个干扰项绑了谁 / 还差什么」直接摆出来，返工才有落脚点。
  const bound=Array.isArray(links)?links.map(d=>String(d?.label)+'→'+String(d?.errorId)):[];
  const need=`- 必须修正【submission.distractors】：三个非正确选项（${wrong.map(c=>c.label).join('、')}）每个都要单独绑定一个 errorId，且三个 errorId 互不相同。当前绑定：${bound.length?bound.join('，'):'（未提供）'}。请逐项补齐或改掉重复项，可用的 errorId：${model.errorModels.map(e=>e.id).join('、')}。改完要保证每个选项的数值/表述确实由它绑定的那个错误操作算出来。`;
  if(!Array.isArray(links)||links.length!==3||!unique(links.map(d=>d.label))||!unique(links.map(d=>d.errorId)))fail('三个干扰项须分别绑定不同错误机制',need);
  for(const link of links){
   if(!wrong.some(c=>c.label===link.label))fail('干扰项绑定了正确答案；允许的错误项：'+wrong.map(c=>c.label).join(','),`- 必须修正【submission.distractors】：${link.label} 是正确答案，不能在 distractors 里出现。distractors 只能覆盖非正确选项：${wrong.map(c=>c.label).join('、')}。`);
   if(!model.errorModels.some(e=>e.id===link.errorId))fail('干扰项绑定了未知错误机制 '+link.errorId+'；必须使用已有errorId：'+model.errorModels.map(e=>e.id).join(','),`- 必须修正【submission.distractors】：${link.label} 绑定的 "${link.errorId}" 不在题模的错误机制里。只能使用：${model.errorModels.map(e=>e.id).join('、')}；或者回到 idea.itemModel 里正规新增一条错误机制（含 misconception / operation / attributeIds / expression），不要在本题临时捏造 id。`);
  }
 }
 if(model.numeric){
  const correct=evaluate(model.numeric.answer,row.parameters),answer=type==='mcq'?row.choices.find(c=>c.label===row.answer)?.text:row.answer;
  if(!close(number(answer),correct))fail('参考答案与题模计算结果不符','- 必须修正【answer】：按题模的 numeric.answer 表达式代入本次参数重算一遍，把 answer 改成这个结果的字面量（小数或分数，单位留在题干）。不要改题模或参数去迎合现有答案。');
  for(const link of row.distractors??[]){
   const e=model.errorModels.find(e=>e.id===link.errorId),value=evaluate(e.expression,row.parameters);
   if(close(value,correct)||!close(number(row.choices.find(c=>c.label===link.label)?.text),value))fail('干扰项与错误操作不一致或等于正确答案',`- 必须修正【${link.label}】：你的 distractors 说这一项是用 "${link.errorId}" 的错误操作算出来的，但选项文字与那个操作的结果对不上（或正好等于正确答案）。请把 ${link.label} 的文字改成该错误操作在本次参数下的实际结果；若这个错误操作在本次参数下会得出正确答案，就换一个错误机制绑定它。`);
  }
 }
 return row;
}

/**
 * 审核回执本身不合规时抛的错误。
 *
 * 和「题目有缺陷」不同：这类错误的修复对象是**审核的回执**，不是题面。
 * 但返工链路只有一条（把错误回灌给作者），所以这里也要给出可直接照做的指令，
 * 否则作者会反复交同一份稿，三轮后整题报废（两次实跑都复现过）。
 *
 * 打上 code:'RECEIPT'：这类错误**不该发给作者**，作者根本改不了审核的回执。
 * 正确的处理是让审核重跑一次（generator 收到 RECEIPT 会作废该阶段缓存并重试审核者）。
 * 实测 run-3：vision 有一题因此把「必须修正审核回执」发给作者，作者原样交回两稿后报废。
 */
const reviewFault=(message,instruction)=>Object.assign(Error(message),{
 code:'RECEIPT',
 instruct:'- 必须修正审核回执（不是改题面）：'+instruction,
 defects:[{target:'stem',kind:'other',detail:instruction}],
});

/** 缺陷类型：审核说「哪里坏了」时必须落在这几个值上。 */
export const DEFECT_KINDS=['ambiguous','not-unique','wrong','not-self-contained','leaked','weak-distractor','other'];

/**
 * 把审核的 defects 规范成返工指令。
 *
 * # 为什么必须结构化
 *
 * 实测（2026-10-29 真实跑）：一道题的审核点名「D 项表述含糊」，但返工只拿到
 * 一段自由文本，三稿全在改 C 项、D 项一个字没动，白烧 3 轮 40778 token。
 * 所以这里把缺陷压成「改哪个位置 + 为什么」，返工时原样喂回去。
 *
 * target 允许选项标签或 stem/explanation/rubric；选项标签必须真的存在于本题，
 * 免得审核幻觉出一个不存在的 E 项把返工引到沟里。
 */
export function normalizeDefects(verdict,row){
 const raw=verdict?.defects;
 if(!Array.isArray(raw))return [];
 const labels=new Set([...(row.choices??[]).map(c=>c.label),'stem','explanation','rubric']);
 const seen=new Set();
 return raw.filter(d=>d&&typeof d.target==='string'&&text(d.target)&&labels.has(d.target.trim())&&!seen.has(d.target.trim())&&seen.add(d.target.trim())).map(d=>({
  target:d.target.trim(),
  kind:DEFECT_KINDS.includes(d.kind)?d.kind:'other',
  detail:text(d.detail)?d.detail.trim():'（审核未给出细节）',
 }));
}

/** 把缺陷渲染成返工提示里那段「必须改这些地方」。没有缺陷时返回 null。 */
export function defectInstruction(verdict,row){
 const defects=normalizeDefects(verdict,row);
 if(!defects.length)return null;
 return defects.map(d=>`- 必须修改【${d.target}】：${d.detail}（类型：${d.kind}）`).join('\n');
}

/**
 * 解析里不得出现内部错误代号。
 *
 * 实测（真实跑）：解析写成「…（B属E1）…故B…都属E2」，学生看到 E1/E2 完全无从解释；
 * 而且同一个 B 被判了两种错——代号一多，作者自己也对不上。
 * 要求解析用 misconception 的自然语言描述，而不是代号。
 */
export function assertNoInternalCodes(explanation,model){
 const text=String(explanation??'');
 const codes=(model?.errorModels??[]).map(e=>String(e.id)).filter(Boolean);
 const tokens=new Set(String(text).split(/[^A-Za-z0-9]+/));  const leaked=codes.filter(id=>tokens.has(String(id)));
 if(leaked.length)fail('解析不得引用内部错误代号（学生看不到它们的含义）：'+leaked.join('、')+'；请改写成该误解的自然语言描述');
 return text;
}

export function validateAttributeReview(verdict,row,model,type){
 const prompt=visiblePrompt(row);
 if(verdict.selfContained!==true||verdict.learningValue!==true||verdict.parametersMatched!==true||verdict.operationMatched!==true){
  const off=[['selfContained','题面自足性'],['learningValue','学习价值'],['parametersMatched','参数一致性'],['operationMatched','认知操作一致性']].filter(([k])=>verdict[k]!==true).map(([,label])=>label);
  fail('题面自足性、学习价值、参数或认知操作未通过',`- 必须修正学生可见题面或本次实例，命中的是：${off.join('、')}。逐条对症：题面自足 = 把解题必需的条件全部写进题干/选项，不靠解析补；参数一致 = 题干数值与本次预留参数逐一相同；认知操作一致 = 实际要求学生做的事就是 idea.operation 声明的那件事；学习价值 = 这道题不是只需复述原文措辞。改完请重交整题，不要只改一处措辞。`);
 }
 // 前提从「声明」升级成「可核对」：题模写了 preconditions，就必须逐条指回学生可见题面。
 // 旧版只校验 preconditions 非空，于是「两个数值都在题面给出」这种前提根本没有机器检查，
 // 只能靠 selfContained 这个裸布尔兜底 —— 而那道最典型的过审事故（缺题设题）恰恰栽在这里。
 const premises=verdict.preconditionChecks;
 if(!Array.isArray(premises)||premises.length!==model.preconditions.length||!unique(premises.map(c=>c.index)))
  fail(reviewFault('缺少逐条前提核验：题模声明了 '+model.preconditions.length+' 条前提',
   'preconditionChecks 必须为题模的每条前提各给一项，index 从 0 到 '+(model.preconditions.length-1)+'，不得缺项或重复。'));
 for(const [i,rule]of model.preconditions.entries()){
  const c=premises.find(c=>c.index===i);
  if(c?.satisfied!==true)fail('题面未满足题模前提：'+rule,`- 必须修正【stem】：题模第 ${i} 条前提「${rule}」在学生可见题面里没有成立。要么把这条前提明确写进题干（写清楚它的具体取值/条件），要么删掉题模里这条并不成立的前提。不要让审核去解析里找依据——学生看不到解析。`);
  // 引文长度下限用 2：中文里「互斥」「独立」「非负」这类前提关键词本身只有两个字，
  // 卡到 6（技能/证据那条的标准）会把合法前提全部误杀。这里要的是「能在题面逐字找到」。
  if(!text(c.promptQuote)||c.promptQuote.trim().length<2||!prompt.includes(c.promptQuote))fail('前提 '+i+' 必须在学生可见题面中找到逐字依据：'+rule,`- 必须修正审核回执中的 preconditionChecks[${i}].promptQuote（不是改题面）：从题干或选项里逐字复制一段确实承载这条前提的原句。若题面里根本没有这段原句，就说明题设不全——改题干把前提写进去。`);
 }
 const checks=verdict.attributeChecks;
 if(!Array.isArray(checks)||checks.length!==model.attributes.length||!unique(checks.map(c=>c.id)))fail(Object.assign(Error('缺少逐技能的实际作答核验'),{code:'RECEIPT'}),`- 必须修正审核回执中的 attributeChecks（不是改题面）：题模声明了 ${model.attributes.length} 个技能（${model.attributes.map(a=>a.id).join('、')}），必须每个技能各给一项，id 与之一一对应，不得缺项或重复。`);
 for(const a of model.attributes){
  const c=checks.find(c=>c.id===a.id);
  if(c?.required!==true)fail('实际作答未必需题模技能：'+a.id,`- 必须修正【stem】：本次题面不需要用到技能「${a.label??a.id}」就能答完，等于题模声明的技能是摆设。请把题干改成必须实际使用该技能才能得出结论（让它的结果进入必答判断）；若这个技能本来就不该考，回到 idea.itemModel 删掉它，而不是让审核放行。`);
  if(!text(c.promptQuote)||c.promptQuote.trim().length<6||!prompt.includes(c.promptQuote)||!text(c.reason))
   fail(reviewFault('技能证据须逐字来自学生可见题面：'+a.id,
    '技能「'+a.id+'」的 promptQuote 没有逐字出现在学生可见题面里。请重新从题干或选项中复制一段确实要求使用该技能的原句（至少 6 个字，不要改写、不要取解析里的句子）。'));
 }
 const evidence=verdict.evidenceChecks;
 if(!Array.isArray(evidence)||evidence.length!==model.evidenceRules.length||!unique(evidence.map(c=>c.ruleIndex)))
  fail(reviewFault('缺少逐条作答证据核验','evidenceChecks 必须逐条对应 evidenceRules，ruleIndex 从 0 到 '+(model.evidenceRules.length-1)+'，不得缺项或重复。'));
 for(const [i]of model.evidenceRules.entries()){
  const c=evidence.find(c=>c.ruleIndex===i);
  if(c?.observable!==true)fail('题目不能提供声明的可观察作答证据',`- 必须修正【stem】或【rubric】：题模的第 ${i} 条证据规则「${model.evidenceRules[i]}」要求的作答证据，本题的学生可见任务与评分点产生不出来。请把任务/评分点改成能真实观测到该证据，或回到题模把这条规则改成这道题实际能提供的证据。`);
  if(!text(c.promptQuote)||c.promptQuote.trim().length<6||!prompt.includes(c.promptQuote)||!text(c.reason))
   fail(reviewFault('作答证据须逐字来自学生可见题面','evidenceChecks['+i+'] 的 promptQuote 没有逐字出现在题面里。请复制题干或选项中真实存在的原句。'));
 }
 if(type==='mcq'){
  const checks=verdict.distractorChecks;
  if(!Array.isArray(checks)||checks.length!==3||!unique(checks.map(c=>c.label)))fail(Object.assign(Error('缺少逐干扰项机制核验'),{code:'RECEIPT'}),`- 必须修正审核回执中的 distractorChecks（不是改题面）：三个非正确选项（${row.choices.filter(c=>c.label!==row.answer).map(c=>c.label).join('、')}）每个各给一项，label 与 distractors 一致，不得缺项或重复。`);
  for(const link of row.distractors){const c=checks.find(c=>c.label===link.label);if(c?.errorId!==link.errorId||c?.errorMatched!==true||!text(c.reason))fail('干扰项没有实现声明的错误机制',`- 必须修正【${link.label}】：这一项声称由 "${link.errorId}" 的错误操作生成，但照题干条件走该错误操作得不到这个选项。请把选项文字改成该错误操作的实际结果；若改不了，就为它换一个真正能生成该选项的错误机制。`);}
 }
 return {modelAttributes:model.attributes.map(a=>a.id),actualAttributes:checks.filter(c=>c.required).map(c=>c.id),evidence:structuredClone(checks),evidenceRules:structuredClone(evidence),status:'model-reviewed-unvalidated'};
}
