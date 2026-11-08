import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { connectBrowser, openBrowser } from '../lib/browser/runtime.ts'

const electron = createRequire(import.meta.url)('electron') as string

test('the Skill starts its own Electron, serves only WeRead requests and exits on close', {skip:process.platform!=='win32',timeout:20000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weread-own-runtime-'))
  const runtime=await openBrowser(directory)
  try{
    assert.equal(await runtime.cookie('wr_vid'),undefined,'a new profile has no login')
    await assert.rejects(runtime.request('https://example.invalid/private'),(e:any)=>e.code==='invalid_endpoint')
    await assert.rejects(runtime.article('https://example.invalid/private'),(e:any)=>e.code==='invalid_endpoint')
    await assert.rejects(openBrowser(directory),(e:any)=>e.code==='browser_busy','one profile, one browser')
  }finally{
    await runtime.close()
    await assert.rejects(runtime.cookie('wr_vid'),(e:any)=>e.code==='browser_closed')
    await fs.rm(directory,{recursive:true,force:true})
  }
})

test('real article pages share a browser reader, with native WeChat redirect and WeRead ticket replay', {skip:process.platform!=='win32',timeout:20000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weread-page-')),env={...process.env}
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(electron,[fileURLToPath(new URL('./fixtures/article-page.cjs',import.meta.url)),directory],{env,windowsHide:true,stdio:'ignore'})
      const timer=setTimeout(()=>{child.kill();reject(new Error('Electron page test timed out'))},15000)
      child.on('error',error=>{clearTimeout(timer);reject(error)})
      child.on('exit',code=>{clearTimeout(timer);resolve(code)})
    })
    const result=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8'))
    assert.equal(code,0,result.error)
    assert.deepEqual([result.plain,result.wechat,result.weread,result.delayed,result.renewed],[true,true,true,true,true])
    assert.equal(result.everVisible,false)
    assert.equal(result.shown.wechat,undefined,'automatic native verification stays hidden')
    assert.equal(result.shown['delayed-home'],undefined,'automatic WeRead verification stays hidden through deferred page initialization')
    assert.equal(result.shown.weread,1,'manual verification still asks the host to show a window')
    assert.equal(result.trusted,'true','the existing native verify button gets real browser input')
    const replay=result.calls.filter((c:any)=>c.ticket)
    assert.deepEqual(replay,Array(2).fill({host:'weread.qq.com',path:'/web/mp/content',ticket:'fixture-ticket',rand:'fixture-rand'}))
    assert.deepEqual(result.renewal,{rq:'%2Fweb%2Fmp%2Fcontent',ql:true})
    assert.equal(result.invalid,'invalid_endpoint')
    assert.equal(result.unauthorized,'remote_rejected','a WeChat error must not invoke WeRead login renewal')
    assert.equal(result.timeout,'verification_timeout','navigation cannot hang beyond the command deadline')
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))
    await fs.rm(directory,{recursive:true,force:true})
  }
})

test('the owned Electron crops original media and submits grid, ordered, audio and slider input across processes', {skip:process.platform!=='win32',timeout:20000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weread-frame-')),env={...process.env}
  delete env.ELECTRON_RUN_AS_NODE
  try{
    const code=await new Promise((resolve,reject)=>{
      const child=spawn(electron,[fileURLToPath(new URL('./fixtures/captcha-frame.cjs',import.meta.url)),directory],{env,windowsHide:true,stdio:'ignore'})
      const timer=setTimeout(()=>{child.kill();reject(new Error('Electron test timed out'))},15000)
      child.on('error',error=>{clearTimeout(timer);reject(error)})
      child.on('exit',code=>{clearTimeout(timer);resolve(code)})
    })
    const result=JSON.parse(await fs.readFile(path.join(directory,'result.json'),'utf8'))
    assert.equal(code,0,result.error);assert.equal(result.separateProcesses,true)
    assert.deepEqual(result.main,[]);assert.deepEqual(result.child,[{target:'BUTTON',trusted:true,x:100,y:65}])
    assert.deepEqual(result.tiles.map((tile:any)=>tile.pixel),[[0,0,255,255],[0,255,0,255],[255,0,0,255],[0,255,255,255],[255,255,0,255],[255,0,255,255]])
    assert.ok(result.tiles.every((tile:any)=>tile.size.width===100&&tile.size.height===100))
    assert.deepEqual(result.multi,{status:'verified',trusted:[true,true,true]})
    assert.equal(result.nine.status,'verified');assert.deepEqual(result.nine.trusted,[true,true,true,true])
    assert.deepEqual(result.nine.tiles.map((tile:any)=>tile.id),[1,2,3,4,5,6,7,8,9])
    assert.ok(result.nine.tiles.every((tile:any)=>tile.size.width===100&&tile.size.height===100))
    assert.deepEqual(result.nine.tiles.slice(6).map((tile:any)=>tile.pixel),[[0,0,0,255],[255,255,255,255],[128,128,128,255]])
    assert.deepEqual(result.ordered,{status:'verified',hints:[[255,0,0,255],[0,0,255,255],[0,255,0,255]],trusted:[true,true,true,true]})
    assert.deepEqual(result.audio,{length:6,status:'verified',trusted:[true,true,true,true,true,true]})
    assert.equal(result.slider.status,'verified')
    assert.deepEqual(result.slider.background,{size:{width:600,height:240},pixel:[0,255,0,255]})
    assert.deepEqual(result.slider.piece,{size:{width:40,height:40},pixel:[0,0,0,0],contentBounds:{x:4,y:6,width:32,height:30}})
    assert.ok(result.slider.events.length>=3)
    assert.equal(result.slider.events[0].type,'down');assert.equal(result.slider.events.at(-1).type,'up')
    assert.ok(result.slider.events.every((event:any)=>event.trusted))
    assert.equal(result.pta.status,'verified')
    assert.equal(result.pta.events[0].type,'down');assert.equal(result.pta.events.at(-1).type,'up')
    assert.ok(result.pta.events.every((event:any)=>event.trusted))
    assert.deepEqual(result.submissions,[{kind:'image-choice',selected:[2,5]},{kind:'grid-nine',selected:[3,8,9]},{kind:'ordered-click',points:[{x:450,y:80},{x:80,y:300},{x:300,y:200}]},{kind:'audio',text:'012345'},{kind:'slider',left:115},{kind:'slider',left:115}])
  }finally{
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))
    await fs.rm(directory,{recursive:true,force:true})
  }
})

test('a host application serves its own Electron to several commands, refuses windows when nobody is there, and can switch the feature off', {skip:process.platform!=='win32',timeout:20000},async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'weread-hosted-')),endpoint='\\\\.\\pipe\\weread-hosted-'+process.pid,env={...process.env}
  delete env.ELECTRON_RUN_AS_NODE
  const child=spawn(electron,[fileURLToPath(new URL('./fixtures/hosted.cjs',import.meta.url)),directory,endpoint],{env,windowsHide:true,stdio:'ignore'})
  const before=process.env.WEREAD_INTERACTIVE
  try{
    for(let waited=0;!await fs.stat(path.join(directory,'ready')).catch(()=>null);waited+=100){assert.ok(waited<15000,'the host never listened');await new Promise(resolve=>setTimeout(resolve,100))}
    const first=await connectBrowser(endpoint)
    process.env.WEREAD_INTERACTIVE='0'
    const unattended=await connectBrowser(endpoint)
    assert.deepEqual(await Promise.all([first.cookie('wr_vid'),unattended.cookie('wr_vid')]),[undefined,undefined],'two commands share the host at once')
    await assert.rejects(first.request('https://example.invalid/private'),(e:any)=>e.code==='invalid_endpoint')
    await assert.rejects(unattended.solve(),(e:any)=>e.code==='verification_required','no window opens for a command nobody is watching')
    await assert.rejects(unattended.login(),(e:any)=>e.code==='login_required')
    await unattended.logout()
    await first.close()
    await assert.rejects(first.cookie('wr_vid'),(e:any)=>e.code==='browser_closed')
    assert.equal(await unattended.cookie('wr_vid'),undefined,'one command leaving does not stop the host')
    await fs.writeFile(path.join(directory,'off'),'')
    await assert.rejects(unattended.cookie('wr_vid'),(e:any)=>e.code==='plugin_disabled')
    await unattended.close()
    await assert.rejects(connectBrowser(endpoint+'-missing'),(e:any)=>e.code==='browser_start_failed')
  }finally{
    if(before===undefined)delete process.env.WEREAD_INTERACTIVE;else process.env.WEREAD_INTERACTIVE=before
    child.kill()
    await new Promise(resolve=>child.once('exit',resolve))
    assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep))
    await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:200})
  }
})
