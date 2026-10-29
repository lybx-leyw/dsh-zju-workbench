const count=value=>Number.isInteger(value)&&value>=0?value:null;
/** Receipts can be fewer than attempts; length is not a safe resumed index. */
export const attemptOffset=(receipts=[],events=[])=>Math.max(0,...receipts.map(r=>count(r.index)??0),...events.map(e=>count(e.index)??0));
/** Cache/reasoning counts are subsets, never additional tokens. Unknown bills stay unknown. */
export function tokenLedger(receipts,{attempts=receipts.length}={}){
  const ledger={attempts,receipts:receipts.length,usageReceipts:0,inputTokensKnown:0,outputTokensKnown:0,totalTokensKnown:0,cacheHitInputTokensKnown:0,cacheMissInputTokensKnown:0,reasoningOutputTokensKnown:0,cacheUnknownReceipts:0,derivedTotalReceipts:0,totalMismatchReceipts:0};
  for(const receipt of receipts){
    const usage=receipt.response?.usage??receipt.usage;
    const input=count(usage?.prompt_tokens??usage?.input_tokens??usage?.input),output=count(usage?.completion_tokens??usage?.output_tokens??usage?.output);
    if(input==null||output==null)continue;
    ledger.usageReceipts++;ledger.inputTokensKnown+=input;ledger.outputTokensKnown+=output;
    const reported=count(usage?.total_tokens??usage?.total),total=reported??input+output;
    if(reported==null)ledger.derivedTotalReceipts++;
    else if(reported!==input+output)ledger.totalMismatchReceipts++;
    ledger.totalTokensKnown+=total;
    const hit=count(usage?.prompt_cache_hit_tokens??usage?.prompt_tokens_details?.cached_tokens??usage?.input_tokens_details?.cached_tokens);
    const miss=count(usage?.prompt_cache_miss_tokens)??(hit!=null&&hit<=input?input-hit:null);
    if(hit==null||miss==null)ledger.cacheUnknownReceipts++;
    if(hit!=null)ledger.cacheHitInputTokensKnown+=hit;
    if(miss!=null)ledger.cacheMissInputTokensKnown+=miss;
    ledger.reasoningOutputTokensKnown+=count(usage?.completion_tokens_details?.reasoning_tokens)??0;
  }
  ledger.unknownUsageAttempts=Math.max(0,attempts-ledger.usageReceipts);
  ledger.totalTokens=ledger.unknownUsageAttempts===0?ledger.totalTokensKnown:null;
  return ledger;
}

/** Observed request occupancy: elapsed wall time is already parallel, never divide it by slots. */
export function timingLedger(events,{wallMs,slots=1,delivered=0}={}){
  if(!Number.isFinite(wallMs)||wallMs<=0||!Number.isInteger(slots)||slots<1)throw new Error('时间和并发配额无效');
  const requests=new Map();for(const event of events){const row=requests.get(event.index)??{};if(event.status==='started')row.start=event.at;else if(['completed','failed'].includes(event.status))row.end=event.at;requests.set(event.index,row);}
  const intervals=[...requests.values()].filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>=r.start);
  const boundaries=intervals.flatMap(r=>[{at:r.start,delta:1},{at:r.end,delta:-1}]).sort((a,b)=>a.at-b.at||a.delta-b.delta);
  let active=0,peak=0,busy=0,last=boundaries[0]?.at??0;
  for(const edge of boundaries){if(active>0)busy+=edge.at-last;active+=edge.delta;peak=Math.max(peak,active);last=edge.at;}
  const service=intervals.reduce((n,r)=>n+r.end-r.start,0),longest=Math.max(0,...intervals.map(r=>r.end-r.start));
  return {wallMs,slots,closedIntervals:intervals.length,openOrInvalidIntervals:requests.size-intervals.length,requestServiceMs:service,requestBusyUnionMs:busy,peakRequestConcurrency:peak,averageRequestConcurrency:service/wallMs,slotUtilization:service/(slots*wallMs),idealServiceLowerBoundMs:Math.max(longest,service/slots),deliveredPerMinute:delivered*60000/wallMs};
}
