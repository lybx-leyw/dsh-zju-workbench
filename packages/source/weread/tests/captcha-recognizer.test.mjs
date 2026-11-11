import test from 'node:test'
import assert from 'node:assert/strict'
import { CaptchaRecognizer } from '../lib/captcha/recognizer.mjs'
import { validateAnswer } from '../lib/captcha/electron.mjs'

test('ordered visual recognition includes the instruction sprite before the background',async()=>{
  let request
  const model=new CaptchaRecognizer({endpoint:'https://model.example/v1/chat/completions',model:'fixture',fetcher:async(_url,options)=>{
    request=JSON.parse(options.body)
    return Response.json({choices:[{message:{content:JSON.stringify({points:[{x:100,y:200},{x:300,y:100}],confidence:0.9})}}]})
  }})
  const puzzle={kind:'ordered-click',question:'依次点击',hints:['data:image/png;base64,aGludA=='],background:{width:672,height:480,image:'data:image/png;base64,YmFja2dyb3VuZA=='}}
  const answer=validateAnswer(puzzle,await model.recognize(puzzle))
  assert.deepEqual(answer.points,[{x:100,y:200},{x:300,y:100}])
  assert.deepEqual(request.messages[0].content.filter(p=>p.type==='image_url').map(p=>p.image_url.url),[puzzle.hints[0],puzzle.background.image])
})

test('audio recognition sends MP3 media and retains leading zeroes through validation',async()=>{
  let request
  const model=new CaptchaRecognizer({endpoint:'https://model.example/v1/chat/completions',model:'fixture',fetcher:async(_url,options)=>{
    request=JSON.parse(options.body)
    return Response.json({choices:[{message:{content:'{"text":"012345","confidence":0.9}'}}]})
  }})
  const puzzle={kind:'audio',question:'输入数字',length:6,audio:'data:audio/mp3;base64,Zml4dHVyZQ=='}
  assert.deepEqual(validateAnswer(puzzle,await model.recognize(puzzle)),{text:'012345'})
  assert.deepEqual(request.messages[0].content.find(p=>p.type==='input_audio'),{type:'input_audio',input_audio:{data:'Zml4dHVyZQ==',format:'mp3'}})
})

test('slider recognition converts the visible gap coordinate using measured transparent padding',async()=>{
  let request
  const model=new CaptchaRecognizer({endpoint:'https://model.example/chat/completions',model:'configured',thinking:'disabled',responseFormat:'json_object',fetcher:async(_url,options)=>{
    request=JSON.parse(options.body)
    return Response.json({choices:[{message:{content:'{"gapX":375,"confidence":0.9}'}}]})
  }})
  const result=await model.recognize({kind:'slider',question:'滑动',background:{width:672,height:480,image:'data:image/png;base64,Ymc='},piece:{x:50,y:136,width:120,height:120,image:'data:image/png;base64,cGllY2U=',contentBounds:{x:20,y:20,width:94,height:80}}})
  assert.deepEqual(result,{targetX:355,targetY:136,confidence:0.9})
  assert.deepEqual(request.thinking,{type:'disabled'});assert.deepEqual(request.response_format,{type:'json_object'})
})

test('unsupported audio is stopped before sending media; provider errors do not echo response bodies',async()=>{
  const model=new CaptchaRecognizer({endpoint:'https://model.example/chat/completions',model:'configured',audioInput:false,fetcher:async()=>assert.fail('unsupported audio must not be sent')})
  await assert.rejects(model.recognize({kind:'audio',question:'数字',audio:'data:audio/mp3;base64,Zml4dHVyZQ==',length:6}),e=>e.code==='recognizer_audio_unsupported')
  const rejected=new CaptchaRecognizer({endpoint:'https://model.example/chat/completions',model:'configured',fetcher:async()=>Response.json({error:{message:'untrusted-private-value'}},{status:401})})
  await assert.rejects(rejected.recognize({kind:'image-choice',question:'选择',choices:[]}),e=>e.code==='recognizer_failed'&&e.details.httpStatus===401&&!e.message.includes('untrusted-private-value'))
})

test('high thinking with JSON output does not impose an output or reasoning token cap',async()=>{
  let request
  const model=new CaptchaRecognizer({endpoint:'https://model.example/chat/completions',model:'configured',thinking:'enabled',reasoningEffort:'high',responseFormat:'json_object',fetcher:async(_url,options)=>{
    request=JSON.parse(options.body)
    return Response.json({choices:[{message:{content:'{"selected":[1],"confidence":0.9}'}}]})
  }})
  await model.recognize({kind:'image-choice',question:'选择',choices:[{id:1,image:'data:image/png;base64,Zml4dHVyZQ=='}]})
  assert.deepEqual(request.thinking,{type:'enabled'});assert.equal(request.reasoning_effort,'high')
  assert.deepEqual(request.response_format,{type:'json_object'})
  assert.equal(Object.hasOwn(request,'max_tokens'),false);assert.equal(Object.hasOwn(request,'max_completion_tokens'),false)
  assert.equal(Object.hasOwn(request,'temperature'),false)
})
