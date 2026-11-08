import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import net from 'node:net'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { WereadBridge } from './weread-bridge.mjs'
import { verifyCaptcha } from '../../core/zju/lib/pta/verification.ts'
import { Pta, sessionStore, ORIGIN } from '../../core/zju/lib/pta/client.ts'
import { CookieJar, HttpResponse, DEFAULT_UA } from '../../core/zju/lib/core/http.ts'

async function connect(endpoint) {
  const socket=net.connect(endpoint)
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject)})
  let sequence=0,received='';const pending=new Map()
  socket.setEncoding('utf8').on('data',chunk=>{
    received+=chunk
    while(received.includes('\n')){
      const end=received.indexOf('\n'),reply=JSON.parse(received.slice(0,end));received=received.slice(end+1)
      const callbacks=pending.get(reply.id);pending.delete(reply.id)
      if(reply.error)callbacks?.reject(Object.assign(new Error(reply.error.message),{code:reply.error.code}));else callbacks?.resolve(reply.result)
    }
  })
  socket.on('close',()=>{for(const p of pending.values())p.reject(Object.assign(new Error('closed'),{code:'browser_closed'}));pending.clear()})
  socket.on('error',()=>{})
  return {
    call:(action,interactive=true)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.write(JSON.stringify({id,action,input:{},interactive})+'\n')}),
    close:()=>socket.destroy(),
  }
}

async function fixture(t, { proof={ret:0,ticket:'pta-ticket',randstr:'pta-rand'}, missing=false }={}) {
  const calls=[],opened=new Set();let sandbox
  const browser={
    async open(label){calls.push(['open',label]);opened.add('pta');return 'pta'},
    async close(id){calls.push(['close',id]);opened.delete(id)},
    async restoreAuth(){assert.fail('PTA must not restore WeRead cookies')},
    async openUrl(id,input){
      calls.push(['url',input.url])
      sandbox=vm.createContext({location:{origin:new URL(input.url).origin}})
      sandbox.window=sandbox
      sandbox.document={querySelector:()=>null,createElement:()=>({}),head:{append(script){
        calls.push(['sdk',script.src])
        sandbox.TencentCaptcha=class{
          constructor(appId,callback){assert.equal(appId,'194593025');this.callback=callback}
          show(){if(proof)this.callback(proof)}
        }
        script.onload()
      }}}
    },
    async waitFor(){}, exists:id=>opened.has(id),
    async execute(id,{script}){
      calls.push(['script',script])
      return {value:await vm.runInContext(script,sandbox,{timeout:1000})}
    },
    // 验证码模块（core/weread/lib/captcha）用的两样，和插件的浏览器（browser.mjs）给的一样。
    relay(id,name,receive){sandbox[name]={complete:result=>receive(result)};return {ready:Promise.resolve(),stop(){}}},
    webContents(id){return {
      isDestroyed:()=>!opened.has(id),
      async executeJavaScript(code){calls.push(['script',code]);return vm.runInContext(code,sandbox,{timeout:1000})},
      debugger:{isAttached:()=>true,on(){},removeListener(){},async sendCommand(){return {}}},
      mainFrame:{framesInSubtree:[]},
    }},
  }
  const endpoint=process.platform==='win32'?`\\\\.\\pipe\\pta-test-${randomUUID()}`:path.join(os.tmpdir(),`pta-${randomUUID().slice(0,8)}.sock`)
  const bridge=new WereadBridge({dir:path.join(os.tmpdir(),`unused-pta-${randomUUID()}`),browser:()=>missing?undefined:browser,
    recognizer:async()=>{calls.push(['model']);throw new Error('PTA must not request a model')}})
  const stop=bridge.listen(endpoint,{onlyPta:true})
  t.after(stop)
  const before={endpoint:process.env.PTA_BROWSER_ENDPOINT,interactive:process.env.PTA_INTERACTIVE}
  process.env.PTA_BROWSER_ENDPOINT=endpoint;process.env.PTA_INTERACTIVE='1'
  t.after(()=>{for(const [key,value] of [['PTA_BROWSER_ENDPOINT',before.endpoint],['PTA_INTERACTIVE',before.interactive]]){if(value===undefined)delete process.env[key];else process.env[key]=value}})
  const runtime=await connect(endpoint)
  t.after(()=>runtime.close())
  return {runtime,calls,opened}
}

test('PTA resumes login through the DSH browser and saves the verified session',async t=>{
  const {runtime,calls,opened}=await fixture(t)
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pta-dsh-test-')),before=process.env.ZJU_DATA_DIR
  process.env.ZJU_DATA_DIR=root
  t.after(()=>{
    if(before===undefined)delete process.env.ZJU_DATA_DIR;else process.env.ZJU_DATA_DIR=before
    assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('pta-dsh-test-'))
    fs.rmSync(root,{recursive:true});assert.equal(fs.existsSync(root),false)
  })
  const posts=[]
  const ctx={http:{jar:new CookieJar(),userAgent:DEFAULT_UA},close(){},async fetch(url,options={}){
    let result={user:{id:'1',email:'dsh@example.test'}}
    if(options.method==='POST'){
      posts.push(JSON.parse(options.body))
      if(posts.length===1)result={error:{code:'GATEWAY_WRONG_CAPTCHA'}}
      else ctx.http.jar.put('PTASession','dsh-session','pintia.cn')
    }
    return new HttpResponse({url,status:200,headers:{},elapsedMs:0,body:JSON.stringify(result)})
  }}
  const client=new Pta(ctx,{username:'dsh@example.test',password:'fixture-password'})
  await client.login();client.close()
  assert.equal(posts.length,2)
  assert.deepEqual(posts[1],{...posts[0],ticket:'pta-ticket',randStr:'pta-rand'})
  assert.equal(sessionStore('dsh@example.test').load().jar.get('PTASession',ORIGIN),'dsh-session')
  assert.deepEqual(calls.filter(c=>c[0]==='url'),[['url','https://pintia.cn/auth/login']])
  const script=calls.find(c=>c[0]==='script'&&c[1].includes('new TencentCaptcha'))[1]
  assert.match(script,/194593025/);assert.match(script,/turing\.captcha\.qcloud\.com/)
  assert.doesNotMatch(script,/2044038556|password|email/)
  assert.deepEqual(calls.filter(c=>c[0]==='sdk'),[['sdk','https://turing.captcha.qcloud.com/TCaptcha.js']])
  assert.deepEqual(calls.filter(c=>c[0]==='model'),[])
  assert.equal(opened.size,0)
  await assert.rejects(runtime.call('cookie'),{code:'invalid_action'})
  await assert.rejects(runtime.call('request'),{code:'invalid_action'})
})

test('background calls and missing browser return clear errors without opening windows',async t=>{
  const {calls}=await fixture(t,{missing:true})
  process.env.PTA_INTERACTIVE='0'
  await assert.rejects(verifyCaptcha(),error=>error.code==='NEEDS_USER'&&/对话里重新查询/.test(error.hint))
  process.env.PTA_INTERACTIVE='1'
  await assert.rejects(verifyCaptcha(),error=>error.code==='NEEDS_USER'&&/Chrome 或 Edge/.test(error.hint))
  assert.equal(calls.length,0)
})

test('cancelled verification returns no proof and closes the window',async t=>{
  const {opened}=await fixture(t,{proof:{ret:2}})
  await assert.rejects(verifyCaptcha(),error=>error.code==='NEEDS_USER'&&/窗口已关闭/.test(error.hint))
  assert.equal(opened.size,0)
})

test('a disconnected command closes the pending PTA window',async t=>{
  const {runtime,opened}=await fixture(t,{proof:null})
  const pending=assert.rejects(runtime.call('ptaCaptcha'),{code:'browser_closed'})
  for(let i=0;!opened.size&&i<50;i++)await new Promise(r=>setTimeout(r,10))
  assert.equal(opened.size,1)
  await runtime.close();await pending
  for(let i=0;opened.size&&i<50;i++)await new Promise(r=>setTimeout(r,10))
  assert.equal(opened.size,0)
})
