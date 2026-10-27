/** OpenAI-compatible bench transport with the same native tool history as the product host. */
export function deepTutorBenchHost({baseUrl,apiKey,model,maxCalls=60,requestTimeoutMs=90000,onCall=()=>{},onAttempt=()=>{}}){
  let calls=0;
  return {
    resolveModelInfo:async()=>({inputModalities:['text']}),
    async prepareCall(config,signal){return {config,async *stream(options){
      if(calls>=maxCalls)throw new Error('达到本次 DeepTutor 评测调用上限');
      const callIndex=++calls;
      const messages=[];
      if(options.system)messages.push({role:'system',content:options.system});
      for(const message of options.messages??[]){
        const content=(message.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
        const row={role:message.role,content};
        if(message.role==='tool')row.tool_call_id=message.source.callId;
        const tools=(message.content??[]).filter(b=>b.type==='tool-call');
        if(tools.length)row.tool_calls=tools.map(t=>({id:t.id,type:'function',function:{name:t.name,arguments:t.arguments}}));
        messages.push(row);
      }
      const body={model,messages,stream:false,thinking:{type:'disabled'},...(options.tools?{tools:options.tools.map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.parameters}}))}:{})};
      if(config.temperature!=null)body.temperature=config.temperature;
      if(config.maxTokens!=null)body.max_tokens=config.maxTokens;
      if(options.toolChoice!==undefined)body.tool_choice=options.toolChoice;
      const started=Date.now();
      await onAttempt({index:callIndex,status:'started',at:started,messages});
      try{
      const response=await fetch(baseUrl.replace(/\/+$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${apiKey}`},body:JSON.stringify(body),signal:AbortSignal.any([AbortSignal.timeout(requestTimeoutMs),...(options.signal??signal?[options.signal??signal]:[])])});
      if(!response.ok)throw new Error(`模型接口返回 ${response.status}：${(await response.text()).split(apiKey).join('[REDACTED]').slice(0,500)}`);
      const data=await response.json(),choice=data.choices?.[0];
      // Preserve the provider receipt even when a response is truncated or otherwise unusable.
      await onCall({index:callIndex,startedAt:started,finishedAt:Date.now(),ms:Date.now()-started,messages,response:data});
      if(!choice||!['stop','tool_calls'].includes(choice.finish_reason))throw new Error('模型未完整结束：'+(choice?.finish_reason??'missing choice'));
      await onAttempt({index:callIndex,status:'completed',at:Date.now()});
      if(choice.message.content)yield {type:'text-delta',index:0,text:choice.message.content};
      for(const [index,tool]of (choice.message.tool_calls??[]).entries())yield {type:'tool-call-delta',index,id:tool.id,name:tool.function.name,argumentsDelta:tool.function.arguments};
      if(data.usage)yield {type:'usage',usage:{input:data.usage.prompt_tokens,output:data.usage.completion_tokens,total:data.usage.total_tokens}};
      yield {type:'finish',reason:{kind:choice.finish_reason==='stop'?'stop':'tool-calls'}};
      }catch(error){await onAttempt({index:callIndex,status:'failed',at:Date.now(),error:String(error.message).split(apiKey).join('[REDACTED]')});throw error;}
    }};},
    get attempts(){return calls;},
  };
}
