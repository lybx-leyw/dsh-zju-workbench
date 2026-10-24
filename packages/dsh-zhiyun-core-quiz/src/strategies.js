/** Shared vocabulary for planning, generation and the client. */
export const QUESTION_TYPES = Object.freeze({cloze:'填空题',mcq:'选择题',trueFalse:'判断题',shortAnswer:'简答题'});
export const QUESTION_STRATEGIES = Object.freeze({
  recall:{label:'基础巩固',description:'复用概念底稿，练定义、公式与记忆',types:['cloze','mcq','trueFalse','shortAnswer']},
  understand:{label:'理解拓展',description:'补足条件、边界、关系与易混点',types:['mcq','trueFalse','cloze','shortAnswer']},
  apply:{label:'应用变式',description:'围绕母题改变数字、场景与约束',types:['shortAnswer','mcq','cloze']},
  explore:{label:'综合探究',description:'尝试新的分析路径与实验设计',types:['shortAnswer','mcq']},
});
export const STRATEGY_PRESETS = Object.freeze({
  memorize:{label:'背知识',strategies:[{id:'recall',weight:3},{id:'understand',weight:1}],types:['cloze','mcq','trueFalse']},
  application:{label:'练应用',strategies:[{id:'apply',weight:3},{id:'explore',weight:1}],types:['shortAnswer']},
  comprehensive:{label:'综合自测',strategies:[{id:'recall',weight:1},{id:'understand',weight:1},{id:'apply',weight:1},{id:'explore',weight:1}],types:['cloze','mcq','trueFalse','shortAnswer']},
});

/** Largest remainder apportionment: the counts always sum to the requested total. */
export function allocateStrategies(count,strategies) {
  const sum=strategies.reduce((total,row)=>total+row.weight,0);
  const rows=strategies.map((row,index)=>({...row,index,count:Math.floor(count*row.weight/sum),remainder:(count*row.weight)%sum}));
  let remaining=count-rows.reduce((total,row)=>total+row.count,0);
  for(const row of [...rows].sort((a,b)=>b.remainder-a.remainder||a.index-b.index))if(remaining-->0)row.count++;
  return rows;
}
