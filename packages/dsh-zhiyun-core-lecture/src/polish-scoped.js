import { applyPolishPatch, decodePolishPatch, polishPatchWarnings } from './polish-patch.js';

/** Successful contexts are resumable; one malformed response never replays its neighbors. */
export async function polishScoped({contexts,text,llm,limiter,route,constant,buildVariable,signal,cache,cacheRoute,calls,onProgress,allowPartial=false}) {
  let done=0, failedCount=0;
  const settled=await Promise.allSettled(contexts.map(async context=>{
    let succeeded=false;
    try {
    const key=cache?.key('lecture-polish-topic-v1',[cacheRoute??route,constant,context.text]);
    let raw,patch,lastError;
    if(key){
      const saved=await cache.get(key);
      if(saved){try{patch=decodePolishPatch(saved.raw);applyPolishPatch(context.text,saved.raw);raw=saved.raw;}catch{patch=null;}}
    }
    for(let attempt=1;!patch&&attempt<=2;attempt++){
      signal.throwIfAborted();
      const response=await limiter.run(()=>llm.call({stage:'lecture-polish',route,constant,
        variable:buildVariable(context.text,{retryReason:lastError?.message??''}),signal}),signal);
      calls.push({stage:'lecture-polish',attempt,usage:response?.usage??null});
      signal.throwIfAborted();raw=String(response?.text??'');
      try{
        const decoded=decodePolishPatch(raw);
        applyPolishPatch(context.text,raw); // Unknown refs cannot cross topic boundaries.
        patch=decoded;
        if(key)await cache.put(key,raw);
      }catch(error){if(error.code!=='FORMAT')throw error;lastError=error;}
    }
    if(!patch)throw lastError;
    succeeded=true;
    return {...patch,warnings:polishPatchWarnings(raw)};
    } finally {
      if(!succeeded)failedCount++;
      onProgress?.({phase:'polish',done:++done,total:contexts.length,failed:failedCount});
    }
  }));
  const failed=settled.find(result=>result.status==='rejected');
  signal.throwIfAborted();
  if(failed && !allowPartial)throw failed.reason;
  const failures=[];
  const patches=settled.map((result,i)=>{
    if(result.status==='fulfilled')return result.value;
    if(result.reason?.code==='CANCELLED')throw result.reason;
    const topic=contexts[i].text.match(/^##!topic (.+)$/m)?.[1]??`段${i+1}`;
    const failure={topic,code:result.reason?.code??'LLM_FAILED',message:result.reason?.message??'终审失败'};
    failures.push(failure);
    return {edits:[],warnings:[`终审未完成，保留本知识点原稿：${topic}（${failure.code}：${failure.message}）`]};
  });
  signal.throwIfAborted();
  return {text:applyPolishPatch(text,JSON.stringify({edits:patches.flatMap(p=>p.edits)})),warnings:patches.flatMap(p=>p.warnings),
    complete:failures.length===0,failures};
}
