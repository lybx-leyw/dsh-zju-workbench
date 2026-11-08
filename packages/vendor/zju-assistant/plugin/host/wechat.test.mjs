import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Wechat } from './wechat.mjs'
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'campus-wechat-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
 const world={at:Date.parse('2026-10-16T10:00:00+08:00'),disabled:[],loggedIn:true,calls:[],tracked:[],articles:[{id:'a',title:'旧文章',url:'https://mp.weixin.qq.com/s/a',publishedAt:'2026-10-15T10:00:00+08:00'}],fresh:[]}
 const run=async(args,options)=>{world.calls.push({args,options});if(world.hold)await world.hold(options.signal)
   if(args[0]==='track'){if(args.includes('--cancel'))world.tracked=[];else if(args.includes('--account'))world.tracked=[{biz:'b',name:'测试号'}];return {ok:true,tracked:world.tracked}}
   if(args[0]==='login'){if(!args.includes('--check'))world.loggedIn=true;return {ok:true,loggedIn:world.loggedIn}}
   if(args[0]==='logout'){world.loggedIn=false;return {ok:true}}
   if(args[0]==='accounts')return {ok:true,accounts:[{biz:'b',name:'测试号'}]}
   if(args[0]==='list')return {ok:true,state:world.error?{ok:false,...world.error}:{ok:true},accounts:world.tracked.map(t=>({...t,...(world.error?{error:world.error}:{source:'web',articles:world.articles})}))}
   if(args[0]==='read')return {ok:true,article:{markdown:'完整正文'}}
 }
 const service=new Wechat({plugins:{disabled:()=>world.disabled},settingsFile:path.join(root,'settings.json'),cacheFile:path.join(root,'cache.json'),run,now:()=>world.at,schedule:fn=>{world.timer=fn;return 3},cancel:id=>world.cancelled=id,onNew:items=>world.fresh.push(items),env:{WEREAD_SOURCE:'local'}})
 t.after(()=>service.dispose());const settle=async()=>{while(service.pending)await service.queue};return {world,service,settle,root}
}
test('public accounts use WeRead only; initial articles are baseline and later additions notify once',async t=>{
 const {world,service,settle}=setup(t);await service.tick();assert.equal((await service.find()).accounts.length,1);await service.track({name:'测试号'});await settle();assert.equal(service.articles().articles[0].foundAt,null)
 world.articles.unshift({id:'b',title:'新文章',url:'https://weread.qq.com/web/mp/content?reviewId=b',originalUrl:'https://mp.weixin.qq.com/s/b',publishedAt:'2026-10-16T10:15:00+08:00'});world.at+=31*60_000;await service.tick()
 assert.equal(service.articles().articles[0].url,'https://weread.qq.com/web/mp/content?reviewId=b');assert.equal(world.fresh.length,1);world.at+=31*60_000;await service.tick();assert.equal(world.fresh.length,1)
 assert.ok(world.calls.every(c=>!c.args.includes('--source')));assert.equal('local' in service.snapshot(),false);assert.deepEqual(service.settings(),{autoVerify:true})
 await service.untrack({biz:'b'});assert.equal(service.articles().articles.length,0)
})
test('no WeRead login means no article lookup, logging in resumes',async t=>{
 const {world,service,settle}=setup(t);world.loggedIn=false;world.tracked=[{biz:'b',name:'测试号'}];await service.refresh();assert.equal(world.calls.some(c=>c.args[0]==='list'),false);assert.equal(service.snapshot().accounts[0].error.status,'login_required')
 service.login();await settle();assert.equal(service.snapshot().accounts[0].count,1);await service.logout();assert.equal(service.snapshot().weread.loggedIn,false)
})
test('verification and rate limiting preserve articles and suppress unattended retries',async t=>{
 const {world,service,settle}=setup(t);world.tracked=[{biz:'b',name:'测试号'}];await service.refresh();world.error={status:'verification_required',message:'需要验证'};world.at+=31*60_000;await service.tick();assert.equal(service.articles().articles.length,1)
 const count=()=>world.calls.filter(c=>c.args[0]==='list').length;const before=count();world.at+=31*60_000;await service.tick();assert.equal(count(),before)
 world.error=null;service.set({autoVerify:true});await settle();assert.ok(count()>before)
 world.error={status:'rate_limited',message:'限频'};await service.refresh();const limited=count();world.at+=31*60_000;await service.tick();assert.equal(count(),limited);world.at+=121*60_000;await service.tick();assert.ok(count()>limited)
})
test('closing plugin aborts pending reads and prevents skill calls',async t=>{
 const {world,service,settle}=setup(t);world.disabled=['zju-wechat'];const n=world.calls.length;await service.tick();await assert.rejects(service.find(),/关着/);assert.equal(world.calls.length,n)
 world.disabled=[];let began;const ready=new Promise(r=>began=r);world.hold=signal=>new Promise((resolve,reject)=>{began();signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true})});service.retry();await ready;world.disabled=['zju-wechat'];service.changed();await settle();assert.equal(service.snapshot().busy,false)
})
test('auto verify preference persists and article reads share the queue',async t=>{
 const {service,root}=setup(t);service.set({autoVerify:false,local:true});assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'settings.json'))),{autoVerify:false});assert.equal((await service.article('https://mp.weixin.qq.com/s/a')).markdown,'完整正文')
})

test('cached WeRead IDs reopen through the content API without another sync',async t=>{
 const {service,root,world}=setup(t)
 const id='MP_WXS_3070994044_WR1BcJ7SX6z6Eh60KVC3H80Q08W6eCF24Gr9Emp5TZ0MtE9U9xh4idFBm3SI5XDFot3wh02x9Qb'
 fs.writeFileSync(path.join(root,'cache.json'),JSON.stringify({accounts:[{biz:'b',name:'测试号',source:'web',articles:[{id,title:'旧缓存',url:'https://mp.weixin.qq.com/s/'+id.split('_').at(-1),foundAt:null}]}]}))
 const article=service.articles().articles[0]
 assert.equal(article.url,'https://weread.qq.com/web/mp/content?reviewId='+id)
 assert.equal(article.foundAt,null);assert.equal(world.calls.length,0)
 await service.article(article.url);assert.deepEqual(world.calls[0].args,['read','--url',article.url])
})
