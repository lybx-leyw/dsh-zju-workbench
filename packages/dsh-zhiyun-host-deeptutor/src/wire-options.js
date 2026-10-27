import {AsyncLocalStorage} from 'node:async_hooks';
import {DeepTutorError} from './protocol.js';

// The installed host accepts tool history but has no structured-output field.
// Apply protocol extensions at its existing fetch boundary: credentials, proxy
// routing and provider selection continue to belong to the host. AsyncLocalStorage
// confines each override to its own request, including concurrent model calls.
const context=new AsyncLocalStorage();
let installed=null;
function install(){
  if(installed&&globalThis.fetch===installed)return;
  const upstream=globalThis.fetch;
  installed=async function(input,init){
    const state=context.getStore();
    if(!state)return upstream(input,init);
    const request=new Request(input,init);
    if(request.method==='POST'&&/\/chat\/completions\/?(?:\?|$)/.test(request.url)){
      let body;try{body=await request.clone().json();}catch{return upstream(input,init);}
      if(body&&typeof body==='object'&&Array.isArray(body.messages)){
        Object.assign(body,state.fields);state.applied=true;
        const headers=new Headers(request.headers);headers.delete('content-length');
        return upstream(new Request(request,{headers,body:JSON.stringify(body)}));
      }
    }
    return upstream(input,init);
  };
  globalThis.fetch=installed;
}
export async function withWireOptions(params,work){
  const fields={};
  if(params.responseFormat)fields.response_format=params.responseFormat;
  if(params.toolChoice!==undefined)fields.tool_choice=params.toolChoice;
  for(const key of ['seed','top_p','presence_penalty','frequency_penalty'])if(params.wireOptions?.[key]!==undefined)fields[key]=params.wireOptions[key];
  if(!Object.keys(fields).length)return work();
  install();const state={fields,applied:false};
  const result=await context.run(state,work);
  if(!state.applied)throw new DeepTutorError('E_CAPABILITY_UNAVAILABLE','当前模型传输协议不支持本次结构化输出或工具选择约束，未将结果作为有效产物采纳');
  return result;
}
