import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ElectronCaptcha, imageRect, validateAnswer } from '../lib/captcha/electron.mjs'

test('coordinates come from the rendered background, original image size and parent frame',()=>{
  assert.deepEqual(imageRect([224,240,448,480],{x:10,y:80,width:336},672,{x:300,y:100}),{x:422,y:300,width:112,height:120})
})
test('six-image answers permit multiple actual IDs; slider answers remain original-image top-left coordinates',()=>{
  const choice={kind:'image-choice',choices:[{id:2},{id:5}]}
  assert.deepEqual(validateAnswer(choice,{selected:[5,2]}),{selected:[5,2]})
  for(const answer of [{selected:[]},{selected:[2,2]},{selected:[7]},{selected:[2],confidence:0.2}])assert.throws(()=>validateAnswer(choice,answer))
  const slider={kind:'slider',background:{width:672,height:480},piece:{x:20,y:100,width:50,height:50}}
  assert.deepEqual(validateAnswer(slider,{targetX:240,targetY:100}),{targetX:240,targetY:100})
  assert.throws(()=>validateAnswer(slider,{targetX:650,targetY:100}))
  const ordered={kind:'ordered-click',background:{width:672,height:480}}
  assert.deepEqual(validateAnswer(ordered,{points:[{x:300,y:120},{x:50,y:220}]}),{points:[{x:300,y:120},{x:50,y:220}]})
  for(const points of [[],[{x:NaN,y:30}],[{x:672,y:30}],[{x:50,y:-1}]])assert.throws(()=>validateAnswer(ordered,{points}))
  const audio={kind:'audio',length:6}
  assert.deepEqual(validateAnswer(audio,{text:'012345'}),{text:'012345'})
  for(const text of [12345,'12345','01234x'])assert.throws(()=>validateAnswer(audio,{text}))
})
function setup(){
  const sent=[]
  const debuggerAPI=Object.assign(new EventEmitter(),{attached:false,isAttached(){return this.attached},attach(){this.attached=true},detach(){this.attached=false},async sendCommand(method,params,session){sent.push({method,params,session});if(method==='Network.getResponseBody')return{body:'_aq_test({"data":{"dyn_show_info":{"show_type":"click_image_uncheck"}}});'}}})
  const wc={debugger:debuggerAPI,mainFrame:{url:'https://weread.qq.com/'},executeJavaScript:async()=>({status:'opened'})}
  return{wc,sent,captcha:new ElectronCaptcha({webContents:wc,appId:'test-app',taskId:'current-task',resultBridge:'testHost'})}
}
test('network observation includes subframes and parses SDK configuration as data',async()=>{
  const{captcha,sent}=setup();await captcha.open()
  await captcha.observe('Target.attachedToTarget',{sessionId:'frame-session'})
  await captcha.observe('Network.responseReceived',{requestId:'r',response:{url:'https://t.captcha.qq.com/cap_union_prehandle'}})
  await captcha.observe('Network.loadingFinished',{requestId:'r'})
  assert.equal(captcha.display.show_type,'click_image_uncheck')
  assert.ok(sent.some(c=>c.method==='Network.enable'&&c.session==='frame-session'))
  captcha.cancel()
})

test('a successful SDK refresh replaces the puzzle metadata; a rejected refresh cannot replace it',async()=>{
  const {captcha,wc}=setup()
  await captcha.observe('Network.responseReceived',{requestId:'first',response:{url:'https://t.captcha.qq.com/cap_union_prehandle'}})
  await captcha.observe('Network.loadingFinished',{requestId:'first'})
  const before=captcha.revision
  const next={show_type:'click_image_uncheck',instruction:'new question',bg_elem_cfg:{size_2d:[672,480],img_url:'/cap_union_new_getcapbysig?image=new'}}
  wc.debugger.sendCommand=async()=>({body:JSON.stringify({ret:0,data:next})})
  await captcha.observe('Network.responseReceived',{requestId:'refresh',response:{url:'https://t.captcha.qq.com/cap_union_new_getsig'}},'frame')
  await captcha.observe('Network.loadingFinished',{requestId:'refresh'},'frame')
  assert.deepEqual(captcha.display,next);assert.notEqual(captcha.revision,before)
  const current=captcha.revision
  wc.debugger.sendCommand=async()=>({body:JSON.stringify({ret:217,data:{instruction:'must not replace'}})})
  await captcha.observe('Network.responseReceived',{requestId:'rejected',response:{url:'https://t.captcha.qq.com/cap_union_new_getsig'}},'frame')
  await captcha.observe('Network.loadingFinished',{requestId:'rejected'},'frame')
  assert.deepEqual(captcha.display,next);assert.equal(captcha.revision,current)
})
test('only a complete callback for the current task completes verification; late receipts are ignored',()=>{
  const{captcha}=setup()
  assert.equal(captcha.receive({taskId:'other',ret:0,ticket:'x',randstr:'y'}),false)
  assert.equal(captcha.receive({taskId:'current-task',ret:0,ticket:'x'}),false)
  assert.equal(captcha.receive({taskId:'current-task',ret:0,ticket:'x',randstr:'y'}),true)
  assert.equal(captcha.receive({taskId:'current-task',ret:0,ticket:'x',randstr:'y'}),false)
  captcha.cancel()
})
test('SDK image responses are retained as pixels instead of parsing binary data as JSON',async()=>{
  const{captcha,wc}=setup()
  wc.debugger.sendCommand=async()=>({base64Encoded:true,body:'cGljdHVyZS1maXh0dXJl'})
  const url='https://t.captcha.qq.com/cap_union_new_getcapbysig?image=synthetic'
  await captcha.observe('Network.responseReceived',{requestId:'image',response:{url,mimeType:'image/png'}},'child')
  await captcha.observe('Network.loadingFinished',{requestId:'image'},'child')
  assert.equal(captcha.resources.get(url),'data:image/png;base64,cGljdHVyZS1maXh0dXJl')
})

test('native-page verification observes the SDK result without replacing its callback, and a new challenge clears it',async()=>{
  const {captcha,wc}=setup()
  captcha.resultBridge=undefined
  wc.debugger.sendCommand=async()=>({body:JSON.stringify({errorCode:0,ticket:'native-ticket',randstr:'native-rand'})})
  await captcha.observe('Network.responseReceived',{requestId:'verify',response:{url:'https://t.captcha.qq.com/cap_union_new_verify'}})
  await captcha.observe('Network.loadingFinished',{requestId:'verify'})
  assert.deepEqual(captcha.proof,{ticket:'native-ticket',randstr:'native-rand'})
  assert.equal((await captcha.run()).status,'verified','an invisible pass needs no model')
  wc.debugger.sendCommand=async()=>({body:JSON.stringify({data:{dyn_show_info:{show_type:'move_slide'}}})})
  await captcha.observe('Network.responseReceived',{requestId:'next',response:{url:'https://t.captcha.qq.com/cap_union_prehandle'}})
  await captcha.observe('Network.loadingFinished',{requestId:'next'})
  assert.equal(captcha.proof,undefined)
})

test('image lookup accepts an SDK request tag but keeps the image index and session bound',()=>{
  const {captcha}=setup();captcha.resourceOrigin='https://turing.captcha.qcloud.com'
  captcha.resources.set('https://turing.captcha.qcloud.com/cap_union_new_getcapbysig?image=fixture&img_index=1&sess=current&tkid=tag','background')
  captcha.resources.set('https://turing.captcha.qcloud.com/cap_union_new_getcapbysig?image=fixture&img_index=0&sess=current&tkid=tag','sprite')
  assert.equal(captcha.resource('/cap_union_new_getcapbysig?img_index=1&image=fixture&sess=current'),'background')
  assert.equal(captcha.resource('/cap_union_new_getcapbysig?img_index=0&image=fixture&sess=current'),'sprite')
  assert.equal(captcha.resource('/cap_union_new_getcapbysig?img_index=1&image=fixture&sess=other'),undefined)
  assert.equal(captcha.resource('/cap_union_new_getcapbysig?image=fixture&sess=current'),undefined)
})
test('a changed challenge is rejected before any input',async()=>{
  const{captcha,sent}=setup()
  captcha.revision='new'
  const puzzle={kind:'image-choice',revision:'old',choices:[{id:1}],layout:{}}
  captcha.layout=async()=>({})
  await assert.rejects(captcha.submit(puzzle,{selected:[1]}),e=>e.code==='verification_changed')
  assert.equal(sent.filter(c=>c.method.startsWith('Input.')).length,0)
})

test('SDK continuation advances to the new challenge; rejection and throttling stop submission',async()=>{
  for(const code of [30,51,12,217]){
    const {captcha,wc}=setup()
    const layout={frame:{x:0,y:0},button:{x:100,y:100,width:40,height:30}}
    captcha.revision='initial';captcha.layout=async()=>layout
    const puzzle={kind:'image-choice',revision:'initial',layout,choices:[{id:2,rect:{x:20,y:20,width:30,height:30}}]}
    let releases=0
    wc.debugger.sendCommand=async(method,params)=>{
      if(method==='Input.dispatchMouseEvent'&&params.type==='mouseReleased'&&++releases===2){captcha.replies.push(code);if([30,51].includes(code))captcha.revision='next'}
    }
    if([30,51].includes(code))assert.deepEqual(await captcha.submit(puzzle,{selected:[2]}),{status:'next_challenge'})
    else await assert.rejects(captcha.submit(puzzle,{selected:[2]}),e=>e.code===(code===217?'verification_rate_limited':'verification_not_passed')&&e.details.providerCode===code)
    assert.equal(releases,2)
  }
})

test('an authenticated SDK receipt wins over capture, late recognition and disappearing UI',async()=>{
  for(const stage of ['capture','recognition','recognition-error','layout-error']){
    const {captcha,sent}=setup()
    const receive=()=>captcha.receive({taskId:'current-task',ret:0,ticket:'synthetic-ticket',randstr:'synthetic-rand'})
    captcha.capture=async()=>{
      if(stage==='capture')receive()
      captcha.revision='current'
      return {kind:'image-choice',revision:'current',layout:{},choices:[{id:1}]}
    }
    captcha.recognizer={recognize:async()=>{
      assert.notEqual(stage,'capture','an existing receipt needs no recognition')
      if(stage.startsWith('recognition'))receive()
      if(stage==='recognition-error')throw new Error('late model failure')
      return {selected:[1]}
    }}
    captcha.layout=async()=>{receive();throw new Error('SDK removed the completed UI')}
    assert.equal((await captcha.run()).status,'verified',stage)
    assert.equal(sent.filter(call=>call.method.startsWith('Input.')).length,0,stage)
  }
})
