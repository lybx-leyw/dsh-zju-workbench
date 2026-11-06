/** Mount the product plugin, never a benchmark-specific question generator. */
import { mount, serviceOf, setRoot } from '../knowledge_tree_bench/_base.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { openAiHost } from '../knowledge_tree_bench/openai.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
export async function mountQuiz({call,config={},dataDir}={}) {
  setRoot(root);
  const mounted=await mount('dsh-zhiyun-core-quiz',{dataDir:dataDir??path.join(root,'artifacts','quiz-bench'),services:{zhiyunParser:{llm:{call}}},config});
  const service=serviceOf(mounted,'zhiyunQuiz');
  return {generatePoints:service.generatePoints,dispose:()=>mounted.dispose?.()};
}

export function modelCall(config) {
  const host=openAiHost(config);
  return async request=>{
    const prepared=await host.prepareCall({},request.signal);
    let text='',usage=null,finished=false;
    for await(const chunk of prepared.stream({stage:request.stage,messages:[{role:'system',content:[{type:'text',text:request.constant}]},{role:'user',content:[{type:'text',text:request.variable}]}],signal:request.signal})){
      if(chunk.type==='text-delta')text+=chunk.text;
      if(chunk.type==='usage')usage=chunk.usage;
      if(chunk.type==='finish'){
        if(chunk.reason?.kind!=='stop')throw new Error('模型响应未完整结束，未作为有效产物采纳');
        finished=true;
      }
    }
    if(!finished||!text.trim())throw new Error('模型未返回完整正文');
    return {text,usage};
  };
}
