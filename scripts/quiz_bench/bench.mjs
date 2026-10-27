import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { runQuizBench,atomicJson,defaultOptions } from './run.mjs';
import { fromLectureLog } from './input.mjs';
import { readLog } from '../knowledge_tree_bench/log.mjs';
import { prefill } from '../knowledge_tree_bench/defaults.mjs';
import { QUESTION_STRATEGIES,QUESTION_TYPES } from '../../packages/dsh-zhiyun-core-quiz/src/strategies.js';
import { applyReview,reviewTemplate,markdownReport,measure,trialSummary } from './metrics.mjs';
import {applyCorrections,evidenceOf,seedOf} from './evidence.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const sourceDefault=path.join(root,'scripts/knowledge_tree_bench/data/.logs');
const files={'/ui/app.mjs':['ui/app.mjs','text/javascript'],'/ui/evidence.mjs':['ui/evidence.mjs','text/javascript'],'/ui/style.css':['ui/style.css','text/css']};
const idOk=id=>/^[\w-]{1,100}$/.test(id??'');
const send=(res,status,value,type='application/json')=>{res.writeHead(status,{'content-type':type+'; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(type==='application/json'?JSON.stringify(value):value);};
async function bodyOf(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>24*1024*1024)throw new Error('导入资料超过 24 MB');}return JSON.parse(text||'{}');}
export async function startServer({port=0,outDir=path.join(root,'artifacts/quiz-bench'),sourceDir=sourceDefault,run=runQuizBench}={}) {
  const token=randomBytes(24).toString('hex');let active=null,curation=Promise.resolve();
  await fs.mkdir(outDir,{recursive:true});
  const reportOf=async id=>{
    if(!idOk(id))throw new Error('评测标识无效');
    let report;
    try{report=JSON.parse(await fs.readFile(path.join(outDir,id,'report.json'),'utf8'));}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      report=JSON.parse(await fs.readFile(path.join(outDir,id,'state.json'),'utf8'));
      report.status=active?.id===id?'running':'interrupted';
      for(const cell of report.cells)cell.metrics=measure({points:report.points,questions:cell.questions,conceptCache:cell.conceptCache,calls:cell.calls,gold:report.gold,completions:Object.values(cell.jobs??{}).flatMap(j=>Object.values(j.checkpoint?.completions??{}))});
      report.trials=trialSummary(report.cells);
    }
    try{report=applyCorrections(report,JSON.parse(await fs.readFile(path.join(outDir,id,'corrections.json'),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
    try{return applyReview(report,JSON.parse(await fs.readFile(path.join(outDir,id,'review.json'),'utf8')));}catch(error){if(error.code!=='ENOENT')throw error;}
    return report;
  };
  const server=http.createServer(async(req,res)=>{
    try{
      const host=req.headers.host??'';
      if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return send(res,403,{error:'只接受本机访问'});
      const url=new URL(req.url,'http://'+host);
      if(url.pathname==='/'&&req.method==='GET'){
        if(url.searchParams.get('t')!==token)return send(res,403,'请使用启动时提供的完整链接','text/plain');
        return send(res,200,await fs.readFile(path.join(here,'ui/index.html'),'utf8'),'text/html');
      }
      if(files[url.pathname]&&req.method==='GET'){const [file,type]=files[url.pathname];return send(res,200,await fs.readFile(path.join(here,file),'utf8'),type);}
      if(!url.pathname.startsWith('/api/'))return send(res,404,{error:'未找到'});
      if(req.headers['x-bench-token']!==token&&url.searchParams.get('t')!==token)return send(res,403,{error:'访问凭证无效'});
      if(req.headers.origin&&req.headers.origin!==url.origin)return send(res,403,{error:'不接受跨站请求'});
      if(url.pathname==='/api/config')return send(res,200,{defaults:defaultOptions,provider:prefill(),strategies:QUESTION_STRATEGIES,types:QUESTION_TYPES});
      if(url.pathname==='/api/sources'){
        const sources=[];
        for(const name of await fs.readdir(sourceDir).catch(()=>[]))if(name.endsWith('.jsonl')){
          try{const log=await readLog(path.join(sourceDir,name));if(log.broken)continue;const dataset=fromLectureLog(log.records,name.slice(0,-6));sources.push({id:name,title:dataset.title,points:dataset.points.length});}catch{/* Incomplete/truncated lecture logs are deliberately not offered. */}
        }
        return send(res,200,{sources});
      }
      if(url.pathname==='/api/runs'&&req.method==='GET'){
        const runs=[];
        for(const entry of await fs.readdir(outDir,{withFileTypes:true}))if(entry.isDirectory()&&idOk(entry.name)){
          try{const report=await reportOf(entry.name);runs.push({id:entry.name,title:report.title,status:report.status,startedAt:report.startedAt,model:report.model});}
          catch{try{const state=JSON.parse(await fs.readFile(path.join(outDir,entry.name,'state.json'),'utf8'));runs.push({id:entry.name,title:state.title,status:active?.id===entry.name?'running':'interrupted',startedAt:state.startedAt,model:state.model});}catch{}}
        }
        return send(res,200,{runs:runs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt))});
      }
      const id=url.searchParams.get('id');
      if(url.pathname==='/api/report'&&req.method==='GET')return send(res,200,await reportOf(id));
      if(url.pathname==='/api/evidence'&&req.method==='GET')return send(res,200,evidenceOf(await reportOf(id)));
      if(url.pathname==='/api/seed'&&req.method==='GET')return send(res,200,seedOf(await reportOf(id),Number(url.searchParams.get('cell'))));
      if(url.pathname==='/api/curate'&&req.method==='POST'){
        const payload=await bodyOf(req);
        const work=curation.catch(()=>{}).then(async()=>{
          if(active?.id===payload.id)throw new Error('请先停止评测，再修订考点账本');
          const report=await reportOf(payload.id),operations=[...(report.corrections?.operations??[])];
          if(payload.undo)operations.pop();else {
            applyCorrections(report,{datasetHash:report.datasetHash,operations:[payload.operation]});operations.push(payload.operation);
          }
          await atomicJson(path.join(outDir,payload.id,'corrections.json'),{datasetHash:report.datasetHash,operations});
          return reportOf(payload.id);
        });curation=work;return send(res,200,await work);
      }
      if(url.pathname==='/api/review-template'&&req.method==='GET')return send(res,200,reviewTemplate(await reportOf(id)));
      if(url.pathname==='/api/log'&&req.method==='GET'){
        if(!idOk(id))throw new Error('评测标识无效');const log=await readLog(path.join(outDir,id,'events.jsonl'));
        return send(res,200,{...log,hasEnd:log.records.at(-1)?.what==='end'});
      }
      if(url.pathname==='/api/review'&&req.method==='POST'){
        const {id,review}=await bodyOf(req);const report=applyReview(await reportOf(id),review);
        await atomicJson(path.join(outDir,id,'review.json'),review);await atomicJson(path.join(outDir,id,'report-reviewed.json'),report);
        await fs.writeFile(path.join(outDir,id,'report-reviewed.md'),markdownReport(report));return send(res,200,report);
      }
      if(url.pathname==='/api/cancel'&&req.method==='POST'){active?.controller.abort(new Error('用户停止，断点已保留'));return send(res,200,{ok:true});}
      if(url.pathname==='/api/run'&&req.method==='POST'){
        if(active)return send(res,409,{error:'已有评测正在运行'});
        const payload=await bodyOf(req);if(active)return send(res,409,{error:'已有评测正在运行'});
        const id=payload.resumeId??`${Date.now()}-${randomUUID().slice(0,8)}`;
        if(!idOk(id))throw new Error('评测标识无效');
        const controller=new AbortController();active={id,controller};
        res.writeHead(200,{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-store','connection':'close'});
        const event=value=>res.write(`data: ${JSON.stringify(value)}\n\n`);
        res.on('close',()=>controller.abort(new Error('连接关闭，断点已保留')));
        event({kind:'run',id});
        try{
          let config=payload;
          if(payload.resumeId){const state=JSON.parse(await fs.readFile(path.join(outDir,id,'state.json'),'utf8'));config={...state.config,seedArtifact:state.seedArtifact,dataset:{title:state.title,points:state.points,gold:state.gold},fixture:state.model==='fixture',model:state.model,baseUrl:state.provider,...payload,resume:true};}
          else if(payload.sourceId){if(path.basename(payload.sourceId)!==payload.sourceId||!payload.sourceId.endsWith('.jsonl'))throw new Error('讲义来源无效');config={...payload,dataset:fromLectureLog((await readLog(path.join(sourceDir,payload.sourceId))).records,payload.sourceId.slice(0,-6))};}
          await run(config,{outDir:path.join(outDir,id),signal:controller.signal,onEvent:event});
        }catch(error){let message=String(error.message);if(payload.apiKey)message=message.split(payload.apiKey).join('[REDACTED]');event({kind:'error',message:message.slice(0,600)});}
        finally{active=null;res.end();}
        return;
      }
      send(res,404,{error:'未找到'});
    }catch(error){if(!res.headersSent)send(res,400,{error:String(error.message).slice(0,300)});else res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}/?t=${token}`,close:()=>{active?.controller.abort();server.closeAllConnections();return new Promise(resolve=>server.close(resolve));}};
}
async function main(){
  const args=process.argv.slice(2),arg=(name,fallback)=>{const index=args.indexOf('--'+name);return index<0?fallback:args[index+1];};
  const runtime=await startServer({port:Number(arg('port',0)),sourceDir:path.resolve(arg('sources-dir',sourceDefault)),outDir:path.resolve(arg('out-dir',path.join(root,'artifacts/quiz-bench')))});
  console.log(`Quiz 基准台：${runtime.url}`);
  if(!args.includes('--no-browser')){
    if(process.platform==='win32')spawn('rundll32.exe',['url.dll,FileProtocolHandler',runtime.url],{stdio:'ignore',windowsHide:true}).unref();
    else spawn(process.platform==='darwin'?'open':'xdg-open',[runtime.url],{stdio:'ignore'}).unref();
  }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
