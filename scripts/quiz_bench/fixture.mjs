/** Authored synthetic material; this mode tests the harness, never model quality. */
export const fixture={id:'synthetic-probability',title:'合成概率教材（仅验证基准流程）',points:[
  {id:'probability',title:'概率定义',text:'概率是描述随机事件发生可能性大小的数值，取值范围为零到一。互斥事件的概率可以相加。'},
  {id:'expectation',title:'期望定义',text:'数学期望是随机变量取值按其概率加权的平均值，离散情形通过各取值与概率的乘积求和计算。'},
  {id:'variance',title:'方差定义',text:'方差是随机变量与其数学期望之差的平方的数学期望，用于描述随机变量取值的离散程度。'},
]};
export function fixtureCall() {
  let sequence=0;
  return async request=>{
    // 统一整改的语义那一关：合成回包一律判「没有重复」，只验证流程走得通，不代表真实判断力。
    // 注意它送的是纯文本（两列题干），不是 JSON —— 必须在校验 JSON 之前拦下。
    if(request.stage==='quiz-rectify')return {text:JSON.stringify({duplicateIndexes:[]}),usage:{prompt_tokens:80,completion_tokens:10}};
    const data=JSON.parse(request.variable);
    if(request.stage==='quiz-source-check')return syntheticSourceCheck();
    if(request.stage==='quiz-source-proof-review')return syntheticProofReview(data);
    if(request.stage==='quiz-fact-audit')return syntheticFactAudit(data);
    if(request.stage==='quiz-concept-complete'){
      const extra=data.source.split('。').filter(Boolean).slice(1).filter(statement=>!data.existing.some(c=>c.statement===statement+'。'));
      return {text:JSON.stringify({concepts:extra.map(statement=>({statement:statement+'。',blanks:[{text:'互斥事件',start:0}]}))}),usage:{prompt_tokens:120,completion_tokens:50}};
    }
    if(request.stage==='quiz-concept-complete-review')return {text:JSON.stringify({verdicts:data.concepts.map(c=>({candidateId:c.candidateId,valid:true,novel:true}))}),usage:{prompt_tokens:100,completion_tokens:30}};
    if(request.stage==='quiz-rewrite'){
      const statement=data.source.split('。')[0]+'。';
      const words={'概率定义':['概率','随机事件','零到一'],'期望定义':['数学期望','随机变量','加权'],'方差定义':['方差','离散程度','平方']};
      const blanks=words[data.title].map(text=>({text,start:statement.indexOf(text)}));
      return {text:JSON.stringify({concepts:[{statement,blanks}]}),usage:{prompt_tokens:100,completion_tokens:50}};
    }
    if(request.stage==='quiz-point-review')return {text:JSON.stringify({verdicts:data.items.map((_,index)=>({index,valid:true,novel:true,targetMatched:true}))}),usage:{prompt_tokens:100,completion_tokens:30}};
    const slots=data.concepts.flatMap(concept=>concept.blanks.map(blank=>({concept,blank}))).filter(({blank})=>!data.history.usedPositions.some(p=>p.blankId===blank.id&&p.type===data.type));
    const items=slots.slice(0,data.count).map(({concept,blank})=>{
      const n=sequence++,parent=data.history.examples.find(q=>q.solutionPath);
      return {targetId:data.targets?.find(t=>t.blankId===blank.id)?.id,conceptId:concept.id,blankId:blank.id,angle:`${data.strategy}：${blank.text}`,solutionPath:`基于${data.title}组织推理`,
        stem:data.type==='cloze'?concept.statement.slice(0,blank.start)+`{{c1::${blank.text}}}`+concept.statement.slice(blank.start+blank.text.length)
          :data.type==='trueFalse'?`${data.title}：${concept.statement} 对吗？`
          :data.type==='mcq'?`关于${data.title}的${blank.text}，请选择正确描述（${n}）。`:`请就${data.title}的${blank.text}建立${data.strategy==='explore'?'实验检验方案':'应用分析步骤'}。`,
        answer:data.type==='cloze'?blank.text:data.type==='mcq'?'A':data.type==='trueFalse'?'正确':concept.statement,
        basis:concept.basis,explanation:concept.statement,rubric:['说明概念','给出推理与结论'],
        choices:data.type==='mcq'?[{label:'A',text:concept.statement},{label:'B',text:'与所给定义相反'},{label:'C',text:'不需要条件即可推断'},{label:'D',text:'所有量都恒等于零'}]:[],
        ...(parent&&data.strategy==='apply'?{parentId:parent.id,variantChange:'改变应用场景'}:{})};
    });
    return {text:JSON.stringify({items}),usage:{prompt_tokens:150,completion_tokens:100}};
  };
}

/** Synthetic responses for plumbing tests only; never used as a semantic evaluator. */
export function syntheticFactAudit(data) {
  return {text:JSON.stringify({positions:data.positions.map(p=>({position:p.ref,claim:`合成考点：${p.text}`,sameAs:data.existing.find(f=>f.claim===`合成考点：${p.text}`)?.ref??null,evidence:p.statement,meaningful:true,leaked:false,consistent:true,reason:''})),conflicts:[]})};
}
export function syntheticSourceCheck(){return {text:JSON.stringify({status:'consistent',checks:[{case:'合成材料流程检查',byDefinition:'合成定义',byRule:'合成定义',definitionValue:'一致',ruleValue:'一致',quotes:[]}],conflicts:[]})};}
export function syntheticProofReview(data){return {text:JSON.stringify({verdicts:data.checks.map((_,index)=>({index,faithful:true,equivalent:true,reason:'合成流程回包'}))})};}
