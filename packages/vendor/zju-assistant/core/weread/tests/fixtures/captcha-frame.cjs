const { app, BrowserWindow, nativeImage, ipcMain } = require('electron')
const fs = require('node:fs'), path = require('node:path'), http = require('node:http')
const { pathToFileURL } = require('node:url')
const directory = process.argv[2]
app.setPath('userData', directory)
app.commandLine.appendSwitch('site-per-process')
app.whenReady().then(async () => {
  const { ElectronCaptcha } = await import(pathToFileURL(path.join(__dirname, '../../lib/captcha/electron.mjs')))
  const tracker = '<script>window.events=[];document.addEventListener("click",e=>events.push({target:e.target.tagName,trusted:e.isTrusted,x:e.clientX,y:e.clientY}))</script>'
  const submissions = []
  const server = http.createServer(async (request, response) => {
    if (request.url === '/verify') {
      let body=''; for await (const bytes of request) body+=bytes
      const answer=JSON.parse(body); submissions.push(answer)
      const correct=answer.kind==='image-choice' ? JSON.stringify(answer.selected)==='[2,5]' : answer.kind==='grid-nine' ? JSON.stringify(answer.selected)==='[3,8,9]' : answer.kind==='ordered-click' ? JSON.stringify(answer.points)==='[{"x":450,"y":80},{"x":80,"y":300},{"x":300,"y":200}]' : answer.kind==='audio' ? answer.text==='012345' : answer.left===115
      response.setHeader('content-type','application/json')
      response.end(JSON.stringify(correct ? {ret:0,ticket:'fixture-ticket',randstr:'fixture-rand'} : {ret:1}));return
    }
    response.setHeader('content-type', 'text/html')
    response.end(request.url === '/frame'
      ? '<button style="position:absolute;left:50px;top:40px;width:100px;height:50px">test</button>' + tracker
      : '<iframe id="tcaptcha_iframe_dy" style="position:absolute;left:200px;top:100px;border:0;width:360px;height:440px" src="http://localhost:' + server.address().port + '/frame"></iframe>' + tracker + '<script>addEventListener("message",event=>{if(event.source===document.querySelector("iframe").contentWindow&&event.data?.fixture)window.wereadVerification.complete(event.data.result)})</script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const window = new BrowserWindow({ width:800, height:650, show:false, webPreferences:{ preload:path.join(__dirname,'../../lib/browser/preload.cjs'),sandbox:true, contextIsolation:true, nodeIntegration:false, backgroundThrottling:false } })
  const wc = window.webContents
  await window.loadURL('http://127.0.0.1:' + server.address().port)
  const frame = wc.mainFrame.framesInSubtree.find(f => f.url.includes('/frame'))
  window.showInactive()
  await new Promise(resolve => setTimeout(resolve, 300))
  await wc.capturePage()
  wc.debugger.attach('1.3')
  // Keep the real DOM/layout and input path; only the fixture frame's public URL is adapted.
  const contents={debugger:wc.debugger,executeJavaScript:script=>wc.executeJavaScript(script),isDestroyed:()=>wc.isDestroyed(),mainFrame:{url:wc.mainFrame.url,framesInSubtree:[{url:'https://captcha.gtimg.com/static/template/fixture',executeJavaScript:script=>frame.executeJavaScript(script)}]}}
  const captcha = new ElectronCaptcha({ webContents:contents, appId:'offline', taskId:'offline', resultBridge:'wereadVerification' })
  ipcMain.handle('weread:captcha-result',(event,receipt)=>event.sender===wc&&event.senderFrame===wc.mainFrame&&captcha.receive(receipt))
  await captcha.click({ x:300, y:165 })
  const result = { separateProcesses:frame.processId !== wc.mainFrame.processId, main:await wc.executeJavaScript('events'), child:await frame.executeJavaScript('events') }
  const source=await wc.executeJavaScript('(()=>{const c=document.createElement("canvas");c.width=300;c.height=200;const x=c.getContext("2d");["red","lime","blue","yellow","cyan","magenta"].forEach((color,i)=>{x.fillStyle=color;x.fillRect(i%3*100,Math.floor(i/3)*100,100,100)});return c.toDataURL("image/png")})()')
  captcha.display={show_type:'click_image_uncheck',instruction:'fixture',bg_elem_cfg:{size_2d:[300,200],img_url:'/cap_union_new_getcapbysig?image=fixture'},json_payload:JSON.stringify({select_region_list:Array.from({length:6},(_,i)=>({id:i+1,range:[i%3*100,Math.floor(i/3)*100,i%3*100+100,Math.floor(i/3)*100+100]}))})}
  captcha.revision='fixture'
  captcha.resources.set('https://t.captcha.qq.com/cap_union_new_getcapbysig?image=fixture',source)
  await frame.executeJavaScript('document.body.innerHTML='+JSON.stringify('<h2 id="pHeaderTitle">选择所有符合条件的图片</h2><div id="instructionText">fixture</div><div id="slideBg" style="position:absolute;left:10px;top:90px;width:300px;height:200px"></div><button id="verifyBtn" style="position:absolute;left:240px;top:310px;width:100px;height:35px">验证</button>'))
  await frame.executeJavaScript(`(()=>{
    window.selected=[];window.trusted=[];
    const background=document.querySelector('#slideBg');background.style.backgroundImage='url(${source})';
    for(let i=0;i<6;i++){const e=document.createElement('button');e.textContent=String(i+1);e.style.cssText='position:absolute;left:'+(i%3*100)+'px;top:'+Math.floor(i/3)*100+'px;width:100px;height:100px;opacity:0.2';e.onclick=event=>{trusted.push(event.isTrusted);const id=i+1;selected=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]};background.append(e)}
    document.querySelector('#verifyBtn').onclick=async event=>{trusted.push(event.isTrusted);const result=await(await fetch('/verify',{method:'POST',body:JSON.stringify({kind:'image-choice',selected})})).json();parent.postMessage({fixture:true,result:{...result,taskId:'offline'}},'*')};
  })()`)
  wc.capturePage=()=>{throw new Error('Recognition must not rely on compositor screenshots')}
  const capture=await captcha.capture()
  result.tiles=capture.choices.map(choice=>{const tile=nativeImage.createFromDataURL(choice.image);return{id:choice.id,size:tile.getSize(),pixel:[...tile.toBitmap().subarray(0,4)]}})
  result.multi={status:(await captcha.submit(capture,{selected:[2,5]})).status,trusted:await frame.executeJavaScript('trusted')}
  captcha.proof=undefined
  const nineSource=await wc.executeJavaScript('(()=>{const c=document.createElement("canvas");c.width=300;c.height=300;const x=c.getContext("2d");["red","lime","blue","yellow","cyan","magenta","black","white","gray"].forEach((color,i)=>{x.fillStyle=color;x.fillRect(i%3*100,Math.floor(i/3)*100,100,100)});return c.toDataURL("image/png")})()')
  captcha.display={show_type:'click_image_uncheck_nine',instruction:'选择所有符合条件的图片',bg_elem_cfg:{size_2d:[300,300],img_url:'/cap_union_new_getcapbysig?image=nine'},json_payload:JSON.stringify({select_region_list:Array.from({length:9},(_,i)=>({id:i+1,range:[i%3*100,Math.floor(i/3)*100,i%3*100+100,Math.floor(i/3)*100+100]}))})}
  captcha.revision='nine-fixture';captcha.resources.set('https://t.captcha.qq.com/cap_union_new_getcapbysig?image=nine',nineSource)
  await frame.executeJavaScript(`(()=>{
    window.selected=[];window.trusted=[];
    const background=document.querySelector('#slideBg');background.innerHTML='';background.style.height='300px';background.style.backgroundImage='url(${nineSource})';
    for(let i=0;i<9;i++){const e=document.createElement('button');e.textContent=String(i+1);e.style.cssText='position:absolute;left:'+(i%3*100)+'px;top:'+Math.floor(i/3)*100+'px;width:100px;height:100px;opacity:0.2';e.onclick=event=>{trusted.push(event.isTrusted);const id=i+1;selected=selected.includes(id)?selected.filter(x=>x!==id):[...selected,id]};background.append(e)}
    const verify=document.querySelector('#verifyBtn');verify.style.top='400px';verify.onclick=async event=>{trusted.push(event.isTrusted);const result=await(await fetch('/verify',{method:'POST',body:JSON.stringify({kind:'grid-nine',selected})})).json();parent.postMessage({fixture:true,result:{...result,taskId:'offline'}},'*')};
  })()`)
  const nine=await captcha.capture()
  result.nine={tiles:nine.choices.map(choice=>{const tile=nativeImage.createFromDataURL(choice.image);return{id:choice.id,size:tile.getSize(),pixel:[...tile.toBitmap().subarray(0,4)]}}),status:(await captcha.submit(nine,{selected:[3,8,9]})).status,trusted:await frame.executeJavaScript('trusted')}
  captcha.proof=undefined
  const orderedSource=await wc.executeJavaScript('(()=>{const c=document.createElement("canvas");c.width=600;c.height=450;const x=c.getContext("2d");x.fillStyle="white";x.fillRect(0,0,600,400);["red","lime","blue"].forEach((color,i)=>{x.fillStyle=color;x.fillRect(i*20,410,20,20)});return c.toDataURL("image/png")})()')
  captcha.display={show_type:'click_icon_float',instruction:'按提示顺序点击',bg_elem_cfg:{size_2d:[600,400],sprite_pos:[0,0],click_cfg:{mark_style:'inc_number',data_type:['DynAnswerType_POS']}},sprite_url:'/cap_union_new_getcapbysig?image=ordered',ins_elem_cfg:[{id:3,size_2d:[20,20],sprite_pos:[40,410]},{id:1,size_2d:[20,20],sprite_pos:[0,410]},{id:2,size_2d:[20,20],sprite_pos:[20,410]}]}
  captcha.revision='ordered-fixture';captcha.resources.set('https://t.captcha.qq.com/cap_union_new_getcapbysig?image=ordered&tkid=sdk-tag',orderedSource)
  await frame.executeJavaScript(`(()=>{
    window.points=[];window.trusted=[];
    const background=document.querySelector('#slideBg');background.innerHTML='';background.style.height='200px';background.onclick=event=>{trusted.push(event.isTrusted);points.push({x:Math.round(event.offsetX*2),y:Math.round(event.offsetY*2)})};
    const verify=document.querySelector('#verifyBtn');verify.style.top='310px';verify.onclick=async event=>{trusted.push(event.isTrusted);const result=await(await fetch('/verify',{method:'POST',body:JSON.stringify({kind:'ordered-click',points})})).json();parent.postMessage({fixture:true,result:{...result,taskId:'offline'}},'*')};
  })()`)
  const ordered=await captcha.capture()
  result.ordered={hints:ordered.hints.map(value=>[...nativeImage.createFromDataURL(value).toBitmap().subarray(0,4)]),status:(await captcha.submit(ordered,{points:[{x:450,y:80},{x:80,y:300},{x:300,y:200}]})).status,trusted:await frame.executeJavaScript('trusted')}
  captcha.proof=undefined
  captcha.display={instruction:'请输入六位数字',addition_audio:{audio_url:'/cap_union_new_getcapbysig?audio=fixture'}}
  captcha.revision='audio-fixture';captcha.resources.set('https://t.captcha.qq.com/cap_union_new_getcapbysig?audio=fixture','data:audio/mp3;base64,Zml4dHVyZQ==')
  await frame.executeJavaScript('document.body.innerHTML='+JSON.stringify('<h2 id="pHeaderTitle">请输入六位数字</h2>'+Array.from({length:6},(_,i)=>'<input class="tencent-captcha-dy__audio-v2-input" maxlength="1" style="position:absolute;left:'+(10+i*50)+'px;top:100px;width:40px;height:35px">').join('')+'<button id="verifyBtn" style="position:absolute;left:240px;top:200px;width:100px;height:35px">验证</button>'))
  await frame.executeJavaScript(`(()=>{
    window.trusted=[];document.addEventListener('input',event=>trusted.push(event.isTrusted));
    document.querySelector('#verifyBtn').onclick=async()=>{const text=[...document.querySelectorAll('input')].map(e=>e.value).join('');const result=await(await fetch('/verify',{method:'POST',body:JSON.stringify({kind:'audio',text})})).json();parent.postMessage({fixture:true,result:{...result,taskId:'offline'}},'*')};
  })()`)
  const audio=await captcha.capture()
  result.audio={length:audio.length,status:(await captcha.submit(audio,{text:'012345'})).status,trusted:await frame.executeJavaScript('trusted')}
  captcha.proof=undefined
  const sprite=await wc.executeJavaScript('(()=>{const c=document.createElement("canvas");c.width=640;c.height=320;const x=c.getContext("2d");x.fillStyle="blue";x.fillRect(0,0,640,320);x.fillStyle="lime";x.fillRect(30,20,600,240);x.clearRect(50,270,40,40);x.fillStyle="red";x.fillRect(54,276,32,30);return c.toDataURL("image/png")})()')
  captcha.display={instruction:'拖动拼图',bg_elem_cfg:{size_2d:[600,240],sprite_pos:[30,20]},sprite_url:'/cap_union_new_getcapbysig?image=slider',fg_elem_list:[{id:3,size_2d:[600,20],sprite_pos:[0,0],init_pos:[0,210]},{type:'sprite',size_2d:[40,40],sprite_pos:[50,270],init_pos:[30,80],move_cfg:{data_type:['DynAnswerType_POS'],move_factor:[2,0]}}]}
  captcha.revision='slider-fixture';captcha.resources.set('https://t.captcha.qq.com/cap_union_new_getcapbysig?image=slider',sprite)
  await frame.executeJavaScript('document.body.innerHTML='+JSON.stringify('<h2 id="pHeaderTitle">拖动下方滑块完成拼图</h2><div id="slideBg" style="position:absolute;left:10px;top:90px;width:300px;height:120px"></div><div class="tc-fg-item" style="position:absolute;left:25px;top:130px;width:20px;height:20px"></div><div class="tc-fg-item" style="position:absolute;left:10px;top:210px;width:300px;height:10px"></div><div class="tc-slider-normal" style="position:absolute;left:20px;top:260px;width:40px;height:30px;background:gray"></div>'))
  await frame.executeJavaScript(`(()=>{
    window.dragEvents=[];let start;
    const handle=document.querySelector('.tc-slider-normal'),piece=document.querySelector('.tc-fg-item');
    handle.onmousedown=event=>{start=event.clientX;dragEvents.push({type:'down',trusted:event.isTrusted})};
    document.onmousemove=event=>{if(start===undefined)return;handle.style.left=20+event.clientX-start+'px';piece.style.left=25+(event.clientX-start)*2+'px';dragEvents.push({type:'move',trusted:event.isTrusted})};
    document.onmouseup=async event=>{if(start===undefined)return;start=undefined;dragEvents.push({type:'up',trusted:event.isTrusted});const result=await(await fetch('/verify',{method:'POST',body:JSON.stringify({kind:'slider',left:parseFloat(piece.style.left)-10})})).json();parent.postMessage({fixture:true,result:{...result,taskId:'offline'}},'*')};
  })()`)
  const slider=await captcha.capture(),bg=nativeImage.createFromDataURL(slider.background.image),piece=nativeImage.createFromDataURL(slider.piece.image)
  result.slider={background:{size:bg.getSize(),pixel:[...bg.toBitmap().subarray(0,4)]},piece:{size:piece.getSize(),pixel:[...piece.toBitmap().subarray(0,4)],contentBounds:slider.piece.contentBounds},status:(await captcha.submit(slider,{targetX:230,targetY:80})).status,events:await frame.executeJavaScript('dragEvents')}
  // PTA 本地模式：真实浏览器解码 PNG、匹配，再走同一个跨进程 CDP 拖动与回执流程。
  const { PtaSliderRecognizer } = await import(pathToFileURL(path.join(__dirname, '../../lib/captcha/pta.mjs')))
  const { ptaImages } = await import(pathToFileURL(path.join(__dirname, './pta-slider.mjs')))
  const localImages = await wc.executeJavaScript(`(()=>{
    const images=(${ptaImages.toString()})({width:600,height:240,pieceWidth:40,pieceHeight:40,targetX:230,y:80});
    return Object.fromEntries(['background','piece'].map(key=>{const image=images[key],canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;canvas.getContext('2d').putImageData(new ImageData(image.data,image.width,image.height),0,0);return[key,canvas.toDataURL('image/png')]}));
  })()`)
  captcha.proof=undefined;captcha.revision='pta-local-fixture'
  captcha.recognizer=new PtaSliderRecognizer(contents)
  captcha.display={bg_elem_cfg:{size_2d:[600,240],img_url:'/cap_union_new_getcapbysig?image=pta-bg'},fg_elem_list:[{type:'sprite',size_2d:[40,40],img_url:'/cap_union_new_getcapbysig?image=pta-piece',init_pos:[30,80],move_cfg:{data_type:['DynAnswerType_POS'],move_factor:[2,0]}}]}
  captcha.resources.set('https://t.captcha.qq.com/cap_union_new_getcapbysig?image=pta-bg',localImages.background)
  captcha.resources.set('https://t.captcha.qq.com/cap_union_new_getcapbysig?image=pta-piece',localImages.piece)
  await frame.executeJavaScript("dragEvents=[];document.querySelector('.tc-slider-normal').style.left='20px';document.querySelector('.tc-fg-item').style.left='25px'")
  result.pta={status:(await captcha.run()).status,events:await frame.executeJavaScript('dragEvents')}
  result.submissions=submissions
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result))
  captcha.cancel(); window.close(); server.close(); app.quit()
}).catch(error => { fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify({ error:error.message })); app.exit(1) })
