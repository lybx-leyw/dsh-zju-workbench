/** Adapted generic authoring guidance; see this package's ATTRIBUTION.md. */
import {QuizError} from './quality.js';
export const DEEPTUTOR_GUIDANCE_ID='deeptutor-general-v1';
export const DEEPTUTOR_GENERAL_GUIDANCE=`通用出题工作指引：
1. 先在已有 questionTask 蓝图内确认本题的具体考查对象、题型与难度。利用 source、已核对底稿和确实提供的 external 取材；这些素材足够时不必扩展任务，不为凑题编造依据。
2. 优先采用用户给定的材料，而不是凭通用印象替换它。保留原文的定义、条件、数值、公式及来源标识，不在概括时改变它们。材料确有缺口或冲突时指出不确定，不把猜测写成课内事实。
3. 有历史题时先辨认其已经覆盖的具体内容，以实质不同的考查角度避开旧题；没有历史题时不虚构诊断或学习者薄弱点。不要重复已有蓝图的主题，也不要用改措辞冒充新主题。
4. 题目严格贴合既定蓝图。选择题恰好四个非空选项、只有一个正确答案；选项应可信，长度和语言风格相近，正确选项不要明显更长或更详细。
5. 给学习者清晰解释为什么参考答案成立，并使解释与参考答案及具体题面对应；使用材料时保留可核对的来源。不要输出与题目无关的过程、前言或额外题目。
6. 继续严格使用本系统已规定的 items、stem、choices、answer、basis 等结构和各策略字段。不输出上游的 PLAN/FINISH/THINK/TOOL 标签，也不更换本系统题型与挖空格式。`;
export function withDeepTutorGuidance(request,guidance=null){
  if(guidance==null||guidance==='none')return request;
  if(guidance!==DEEPTUTOR_GUIDANCE_ID)throw new QuizError('CONFIG','未知通用出题指引');
  if(!/^quiz-point-(mcq|cloze|trueFalse|shortAnswer)$/.test(request.stage))return request;
  return {...request,constant:request.constant+'\n\n'+DEEPTUTOR_GENERAL_GUIDANCE};
}
