import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply } from '../packages/dsh-zhiyun-source-campus/src/index.js';
import { apply as applyClassroom } from '../packages/dsh-zhiyun-source-classroom/src/index.js';
import { createHandler } from '../packages/dsh-zhiyun-page-planning/src/index.js';

async function harness(t, {expire=false,rateLimit=false,badShape=false,realClassroom=false,classroomUnavailable=false}={}) {
 const dir=await mkdtemp(path.join(tmpdir(),'campus-contract-'));
 const services={},calls=[];let active=0,maxActive=0,authorizations=0,expired=false;
 let account={username:'student-fixture',password:'fake-password'};
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
 const fetch=async(url,init)=>{
  active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setImmediate(resolve));
  try {
   const target=new URL(url);calls.push({path:target.pathname,method:init.method});
      if (realClassroom && target.hostname !== 'courses.zju.edu.cn') {
    if (target.hostname === 'yjapi.cmc.zju.edu.cn') return new Response('', {status:302, headers:{location:'https://zjuam.zju.edu.cn/cas/login?service=fake'}});
    if (target.pathname === '/cas/v2/getPubKey') return json({modulus:'10001',exponent:'3'});
    if (target.hostname === 'zjuam.zju.edu.cn') {
     if(init.method==='POST')return new Response('', {status:302,headers:{'set-cookie':'iPlanetDirectoryPro=fake; Domain=zju.edu.cn; Path=/; Secure',location:'https://classroom.zju.edu.cn/'}});
     return new Response('<input name="execution" value="fixture">');
    }
    if(target.hostname==='classroom.zju.edu.cn') {
     const headers=new Headers();
     headers.append('set-cookie','JWTUser='+encodeURIComponent(JSON.stringify({id:'fixture-user'}))+'; Domain=zju.edu.cn; Path=/; Secure');
     const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:4000000000})).toString('base64url')+'.sig';
     headers.append('set-cookie','_token='+token+'; Domain=zju.edu.cn; Path=/; Secure');
     return new Response('ok',{headers});
    }
    if(target.hostname==='education.cmc.zju.edu.cn'&&classroomUnavailable)return json({},500);
    if(target.hostname==='education.cmc.zju.edu.cn')return json({params:{result:{data:[{Id:1,Title:'Fixture'}],total:1}}});
   }
   assert.equal(target.hostname,'courses.zju.edu.cn','SSO must avoid password submission');
   if(target.pathname==='/user/index')return new Response('ok',{headers:{'set-cookie':'session=fake; Path=/; Secure'}});
   if(target.pathname==='/api/my-semesters')return json({semesters:[{id:10,is_active:1}]});
   if(target.pathname==='/api/my-courses'){
    assert.equal(init.method,'GET');assert.deepEqual(JSON.parse(target.searchParams.get('conditions')).semester_id,[10,11,12]);
    return json({courses:[{id:1,name:'Example one'},{id:2,name:'Example two'}]});
   }
   if(expire&&!expired&&target.pathname==='/api/courses/2/exams') {expired=true;return new Response('',{status:302,headers:{location:'/login'}});}
   if(rateLimit&&target.pathname==='/api/courses/1/exams')return json({},429);
   if(target.pathname.endsWith('/activities'))return json(badShape?{changed:[]}:{activities:[{id:101,title:'Pending',published:1,end_time:'2099-10-30 23:59:00'},{id:102,title:'Submitted',published:1,end_time:'2099-10-30T23:59:00+08:00'}]});
   if(target.pathname.endsWith('/exams'))return json({exams:[{id:103,title:'Submitted exam',published:1,end_time:'2099-10-30T23:59:00+08:00'}]});
   if(target.pathname==='/api/course/1/homework/submission-status')return json({},404);
   if(target.pathname.endsWith('/homework/submission-status'))return json({homework_activities:[{id:102,status_code:'submitted'}]});
   if(target.pathname.endsWith('/submitted-exams'))return json({exam_ids:[103]});
   if(target.pathname.endsWith('/classroom-list'))return json({classrooms:[{id:301,status:'start',title:'Open classroom'}]});
   throw new Error('Unexpected endpoint');
  } finally {active--;}
 };
 const credentials={readRecord:async()=>account?{kind:'grant',payload:account}:null,modifyRecord:async()=>{}};
 const ctx={profileContext:{dir},logger:{info(){}},inject(){},get:name=>name==='credentials'?credentials:name==='zhiyunClassroom'&&!realClassroom?{acquireSso:async()=>{authorizations++;return [{toString:()=> 'iPlanetDirectoryPro=fake; Domain=zju.edu.cn; Path=/; Secure'}];}}:services[name],provide:(name,value)=>{services[name]=value;return()=>{};}};
 const disposeClassroom=realClassroom?await applyClassroom(ctx,{fetch,protect:async bytes=>bytes}):null;
 const dispose=await apply(ctx,{dataDir:dir,fetch,protect:async bytes=>bytes,readTtlMs:0});
 t.after(async()=>{await dispose();await disposeClassroom?.();await rm(dir,{recursive:true,force:true});});
 return {service:services.zhiyunCampus,calls,maxActive:()=>maxActive,authorizations:()=>authorizations,removeAccount:()=>{account=null;}};
}

test('empty profile → saved account SSO → all five endpoints → planning route',async t=>{
 const h=await harness(t);
 const handler=createHandler({getConfig:()=>({endpoint:'',readKey:''}),saveConfig(){},store:{list:()=>[],absorb:()=>({added:[],skipped:0})},local:{list:()=>[]},loadTodos:()=>h.service.todos(),ptaStatus:()=>h.service.ptaStatus(),fetchRemote:async()=>({ok:false,code:'NOT_CONFIGURED'}),plan:null});
 let body,status;
 await handler({method:'GET',url:'/',headers:{host:'127.0.0.1'},[Symbol.asyncIterator]:async function*(){}},{writeHead:code=>{status=code;},end:chunk=>{body=JSON.parse(chunk);}});
 assert.equal(status,200);assert.equal(body.todos.xzzd.error,null);
 const rows=body.todos.xzzd.rows;
 assert.ok(rows.some(r=>r.title==='Pending'&&r.due));
 assert.ok(rows.some(r=>r.title==='Open classroom'&&r.due===null));
 assert.ok(!rows.some(r=>r.title==='Submitted exam'));
 assert.equal(rows.filter(r=>r.title==='Submitted').length,1,'course one has no submission records; course two is submitted');
 assert.equal(h.maxActive(),1);assert.equal(h.authorizations(),1);
});
test('expired business session retries its read once without repeating course discovery',async t=>{
 const h=await harness(t,{expire:true});const result=await h.service.todos();
 assert.equal(result.xzzd.ok,true);assert.equal(h.authorizations(),2);
 assert.equal(h.calls.filter(c=>c.path==='/api/my-courses').length,1);
 assert.equal(h.calls.filter(c=>c.path==='/api/courses/2/exams').length,2);
});
test('rate limit stops the crawl before additional courses or status requests',async t=>{
 const h=await harness(t,{rateLimit:true});const result=await h.service.todos();
 assert.equal(result.xzzd.error.code,'RATE_LIMITED');
 assert.equal(h.calls.some(c=>c.path.includes('/courses/2/')),false);
 assert.equal(h.calls.some(c=>c.path.endsWith('/submitted-exams')),false);
});
test('response drift is an explicit error and removing credentials does not reuse old rows',async t=>{
 const h=await harness(t,{badShape:true});const first=await h.service.todos();
 assert.equal(first.xzzd.error.code,'API_SHAPE');assert.match(first.xzzd.error.message,/activities/);
 h.removeAccount();const before=h.calls.length;const second=await h.service.todos();
 assert.equal(second.xzzd.error.code,'NEED_LOGIN');assert.equal(h.calls.length,before);
});

test('a new user connects actual classroom and campus services with one CAS password submission',async t=>{
 const h=await harness(t,{realClassroom:true});
 const result=await h.service.todos();
 assert.equal(result.xzzd.ok,true,JSON.stringify(result.xzzd.error));
 assert.equal(h.calls.filter(c=>c.path==='/cas/login'&&c.method==='POST').length,1);
 assert.equal(h.calls.filter(c=>c.path==='/api/my-courses').length,1);
});

test('classroom business failure does not force a second CAS login or block campus',async t=>{
 const h=await harness(t,{realClassroom:true,classroomUnavailable:true});
 const result=await h.service.todos();
 assert.equal(result.xzzd.ok,true,JSON.stringify(result.xzzd.error));
 assert.equal(h.calls.filter(c=>c.path==='/cas/login'&&c.method==='POST').length,1);
});

