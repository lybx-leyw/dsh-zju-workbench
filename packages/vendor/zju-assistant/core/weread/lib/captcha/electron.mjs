import { setTimeout as pause } from 'node:timers/promises'

const fail = (code, message, details) => Object.assign(new Error(message), { code, details })
function readLayout() {
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x,y:r.y,width:r.width,height:r.height}:null}
  const bg=document.querySelector('#slideBg,.tencent-captcha-dy__verify-bg-img')
  return {
    background:rect(bg),button:rect(document.querySelector('#verifyBtn,.tencent-captcha-dy__verify-confirm-btn')),
    handle:rect(document.querySelector('.tc-slider-normal,.tc-slider-ie,.tencent-captcha-dy__slider-block')),
    inputs:[...document.querySelectorAll('.tencent-captcha-dy__audio-v2-input')].map(rect).filter(Boolean),
    ready:!document.querySelector('.show-loading')&&!rect(document.querySelector('.tencent-captcha-dy__verify-status-img--loading'))&&!rect(document.querySelector('.tencent-captcha-dy__network-status-area')),
    question:[...document.querySelectorAll('#pHeaderTitle,#instructionText,.tencent-captcha-dy__header-text')].map(e=>e.textContent.trim()).filter(Boolean).join('。'),
    viewport:[innerWidth,innerHeight]
  }
}
async function cropResource({source,areas,bounds=false}) {
  const image = new Image()
  await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('CAPTCHA image decode failed'));image.src=source})
  return areas.map(([x,y,width,height])=>{
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height
    const context=canvas.getContext('2d')
    context.drawImage(image,x,y,width,height,0,0,width,height)
    const pixels=canvas.toDataURL('image/png')
    if(!bounds)return pixels
    const data=context.getImageData(0,0,width,height).data
    let left=width,top=height,right=-1,bottom=-1
    for(let row=0;row<height;row++)for(let column=0;column<width;column++){
      if(data[(row*width+column)*4+3]<128)continue
      left=Math.min(left,column);top=Math.min(top,row);right=Math.max(right,column);bottom=Math.max(bottom,row)
    }
    return {image:pixels,contentBounds:right<0?null:{x:left,y:top,width:right-left+1,height:bottom-top+1}}
  })
}

/** Map original image coordinates into the actual frame and page, without fixed screen geometry. */
export function imageRect(range, background, originalWidth, frame) {
  const rate = background.width / originalWidth
  return { x: frame.x + background.x + range[0] * rate, y: frame.y + background.y + range[1] * rate,
    width: (range[2] - range[0]) * rate, height: (range[3] - range[1]) * rate }
}
export function validateAnswer(puzzle, answer) {
  if (answer?.confidence != null && (!Number.isFinite(answer.confidence) || answer.confidence < 0.75 || answer.confidence > 1)) throw fail('recognition_uncertain', '识别置信度不足，未操作验证码。')
  if (puzzle.kind === 'image-choice') {
    const ids = answer?.selected
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length || !ids.every(id => puzzle.choices.some(c => c.id === id))) throw fail('recognition_uncertain', '识别器未返回有效选项。')
    return { selected: ids }
  }
  if (puzzle.kind === 'ordered-click') {
    const points=answer?.points
    if(!Array.isArray(points)||!points.length||!points.every(p=>Number.isFinite(p?.x)&&Number.isFinite(p?.y)&&p.x>=0&&p.y>=0&&p.x<puzzle.background.width&&p.y<puzzle.background.height))throw fail('recognition_uncertain','点选答案必须是按顺序排列的原图坐标。')
    return {points:points.map(({x,y})=>({x,y}))}
  }
  if(puzzle.kind==='audio'){
    if(typeof answer?.text!=='string'||!/^\d+$/.test(answer.text)||answer.text.length!==puzzle.length)throw fail('recognition_uncertain','语音答案须是与输入框数量一致的数字字符串。')
    return {text:answer.text}
  }
  const p = puzzle.piece, x = answer?.targetX, y = answer?.targetY
  if (![x,y].every(Number.isFinite) || x < 0 || x + p.width > puzzle.background.width || Math.abs(y - p.y) > 2) throw fail('recognition_uncertain', '滑块缺口的原图坐标无效。')
  return { targetX: x, targetY: y }
}

/** Host owns the window, session and IPC authorization. This module has no Electron/package dependency. */
export class ElectronCaptcha {
  /** 宿主可启动独立组件，也可在导航前 attach，观察文章页面自己启动的组件。script 是装哪一份官方组件（PTA 用 turing 的那份）。 */
  constructor({ webContents, appId, taskId, resultBridge, recognizer, script = 'https://captcha.gtimg.com/TCaptcha.js' }) {
    this.webContents = webContents; this.appId = appId; this.taskId = taskId
    this.resultBridge = resultBridge; this.recognizer = recognizer; this.script = script
    this.requests = new Map(); this.resources = new Map(); this.reads = new Set(); this.replies = []; this.closed = false
    this.listener = (_event, method, params, sessionId) => { void this.observe(method, params, sessionId).catch(error => { this.observationError = error.message }) }
  }
  async attach() {
    const wc = this.webContents
    if (!wc.debugger.isAttached()) { wc.debugger.attach('1.3'); this.ownsDebugger = true }
    wc.debugger.on('message', this.listener)
    await wc.debugger.sendCommand('Network.enable')
    await wc.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true })
  }
  async open() {
    await this.attach()
    const wc = this.webContents
    const result = await wc.executeJavaScript('(async()=>{' +
      'const existing=document.querySelector("#tcaptcha_iframe_dy,#tcaptcha_transform_dy");if(existing){const style=getComputedStyle(existing),r=existing.getBoundingClientRect();if(r.width&&r.height&&style.opacity!=="0"&&style.visibility!=="hidden")return {status:"existing_verification"}};' +
      'if(typeof TencentCaptcha!=="function")await new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=' + JSON.stringify(this.script) + ';s.onload=resolve;s.onerror=reject;document.head.append(s)});' +
      'window.__wereadCaptcha=new TencentCaptcha(' + JSON.stringify(this.appId) + ',r=>window[' + JSON.stringify(this.resultBridge) + '].complete({taskId:' + JSON.stringify(this.taskId) + ',ret:r.ret,ticket:r.ticket,randstr:r.randstr}),{needFeedBack:true});' +
      'window.__wereadCaptcha.show();return {status:"opened"};})()')
    if (result?.status !== 'opened') throw fail('existing_verification', '窗口已有验证码，未新建第二题。')
  }
  async observe(method, params, sessionId) {
    const debuggerAPI = this.webContents.debugger
    if (method === 'Target.attachedToTarget') {
      await debuggerAPI.sendCommand('Network.enable', {}, params.sessionId)
      return
    }
    const key = (sessionId || '') + ':' + params.requestId
    if (method === 'Network.responseReceived') {
      const url = new URL(params.response.url)
      if (url.protocol==='https:' && ['t.captcha.qq.com','turing.captcha.qcloud.com'].includes(url.hostname) && ['/cap_union_prehandle','/cap_union_new_getsig','/cap_union_new_verify','/cap_union_new_getcapbysig'].includes(url.pathname)) this.requests.set(key, {path:url.pathname,url:url.href,mime:params.response.mimeType})
    }
    if (method !== 'Network.loadingFinished' || !this.requests.has(key)) return
    const resource = this.requests.get(key); this.requests.delete(key)
    const reading = (async () => {
      const body = await debuggerAPI.sendCommand('Network.getResponseBody', { requestId: params.requestId }, ...(sessionId ? [sessionId] : []))
      if(resource.path==='/cap_union_new_getcapbysig'){
        if(!/^(?:image\/(?:png|jpeg|gif|webp)|audio\/(?:mp3|mpeg|wav|x-wav))$/.test(resource.mime))throw fail('invalid_challenge','验证码媒体格式不受支持。')
        this.resources.set(resource.url,'data:'+resource.mime+';base64,'+(body.base64Encoded?body.body:Buffer.from(body.body,'binary').toString('base64')))
        return
      }
      const source = body.base64Encoded ? Buffer.from(body.body, 'base64').toString() : body.body
      const match = source.trim().match(/^[\w$]+\(([\s\S]*)\);?$/)
      const data = JSON.parse(match ? match[1] : source)
      if (resource.path === '/cap_union_new_verify') {
        this.replies.push(Number(data.errorCode))
        // 原文页面自己持有 SDK 回调；观察官方响应即可结束输入，业务跳转仍由原页面完成。
        if (!this.resultBridge && Number(data.errorCode) === 0 && data.ticket && data.randstr) this.proof = { ticket:data.ticket, randstr:data.randstr }
      }
      // prehandle wraps dyn_show_info; a successful SDK refresh returns that object as data.
      const display=resource.path==='/cap_union_new_getsig'
        ? Number(data.ret)===0?data.data:undefined
        : data.data?.dyn_show_info
      if (display) {
        this.resourceOrigin=new URL(resource.url).origin
        this.display = display
        this.revision = (this.revision || 0) + 1
        if (!this.resultBridge) this.proof = undefined
      }
    })()
    this.reads.add(reading)
    try { await reading } finally { this.reads.delete(reading) }
  }
  /** Only call after the host has checked the IPC sender, main frame and current task. */
  receive(input) {
    if (this.closed || this.proof || input?.taskId !== this.taskId) return false
    if (input.ret === 0 && typeof input.ticket === 'string' && input.ticket && typeof input.randstr === 'string' && input.randstr) {
      this.proof = { ticket: input.ticket, randstr: input.randstr }; return true
    }
    if (input.ret === 2) this.cancel()
    return false
  }
  resource(raw) {
    if(!raw)return undefined
    const expected=new URL(raw,this.resourceOrigin||'https://t.captcha.qq.com')
    if(this.resources.has(expected.href))return this.resources.get(expected.href)
    // The SDK may append a request tag (for example tkid) after publishing the image URL.
    // Match every supplied field, including image index and session; no request is changed.
    const matches=[...this.resources].filter(([value])=>{
      const actual=new URL(value)
      return actual.origin===expected.origin&&actual.pathname===expected.pathname&&[...expected.searchParams].every(([key,value])=>actual.searchParams.get(key)===value)
    })
    return matches.length===1?matches[0][1]:undefined
  }
  async layout() {
    const wc = this.webContents
    // 微信读书的组件框架在 captcha.gtimg.com/static/template/，PTA 用的 turing 那份在 turing.captcha.gtimg.com/1/template/。
    const child = wc.mainFrame.framesInSubtree.find(f => /^https:\/\/(?:captcha\.gtimg\.com\/static|turing\.captcha\.gtimg\.com\/1)\/template\//.test(f.url))
    const inner = await (child||wc.mainFrame).executeJavaScript('('+readLayout.toString()+')()')
    const outer = child
      ? await wc.executeJavaScript('(()=>{const e=document.querySelector("#tcaptcha_iframe_dy");if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()')
      : {x:0,y:0,width:inner.viewport[0],height:inner.viewport[1]}
    if (!outer || (!inner.background?.width && !inner.inputs?.length)) return null
    if (Math.abs(outer.width - inner.viewport[0]) > 2) throw fail('unsupported_verification', '验证码框架被额外缩放，未猜测坐标。')
    return { ...inner, frame: outer }
  }
  async capture(signal) {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      if (this.closed) throw fail('verification_cancelled', '当前验证码已关闭。')
      if (this.proof) return null
      await Promise.allSettled([...this.reads])
      const layout = await this.layout()
      if (this.display && layout?.ready) {
        if(this.display.addition_audio?.audio_url){
          const audio=this.resource(this.display.addition_audio.audio_url)
          if(!audio){await pause(100,undefined,{signal});continue}
          if(!layout.inputs?.length||!layout.button?.width)throw fail('unsupported_verification','当前语音输入布局尚未适配。')
          return {kind:'audio',question:layout.question||this.display.instruction,revision:this.revision,layout,audio,length:layout.inputs.length}
        }
        const display = this.display, size = display.bg_elem_cfg?.size_2d
        if (!size?.[0] || !size[1]) throw fail('invalid_challenge', '验证码未返回图片尺寸。')
        // Use the bytes the SDK actually loaded. Compositor screenshots can omit OOPIF image layers.
        const image = raw => this.resource(raw)
        const sprite=display.sprite_base64 ? (display.sprite_base64.startsWith('data:')?display.sprite_base64:'data:image/png;base64,'+display.sprite_base64) : image(display.sprite_url)
        const source=display.bg_elem_cfg.img_url?image(display.bg_elem_cfg.img_url):sprite
        if(!source){await pause(100,undefined,{signal});continue}
        const offset=display.bg_elem_cfg.img_url?[0,0]:(display.bg_elem_cfg.sprite_pos||[0,0])
        const crop=async(source,areas,bounds=false)=>this.webContents.executeJavaScript('('+cropResource.toString()+')('+JSON.stringify({source,areas,bounds})+')')
        const instructions=display.ins_elem_cfg||[]
        if(instructions.length&&!sprite){await pause(100,undefined,{signal});continue}
        const hints=instructions.length?await crop(sprite,instructions.map(p=>[...p.sprite_pos,...p.size_2d])):[]
        const base = { question: layout.question || display.instruction, revision: this.revision, layout, hints }
        const click=display.bg_elem_cfg.click_cfg
        if (['click_image_uncheck','click_image_uncheck_nine'].includes(display.show_type)||click?.mark_style==='mask') {
          const regions = JSON.parse(display.json_payload).select_region_list
          if (!regions?.length || !layout.button?.width) throw fail('unsupported_verification', '验证码选区尚未就绪。')
          const pixels=await crop(source,regions.map(r=>[r.range[0]+offset[0],r.range[1]+offset[1],r.range[2]-r.range[0],r.range[3]-r.range[1]]))
          const choices = regions.map((r,index) => {
            const area = imageRect(r.range, layout.background, size[0], layout.frame)
            return { id: r.id, rect: area, image:pixels[index] }
          })
          return { ...base, kind: 'image-choice', selection: 'multiple', choices }
        }
        if(['default','inc_number','icon'].includes(click?.mark_style)&&click.data_type?.some(t=>['DynAnswerType_POS','DynAnswerType_POS_L'].includes(t))){
          if(!layout.button?.width)throw fail('unsupported_verification','点选确认按钮尚未就绪。')
          const [backgroundPixels]=await crop(source,[[...offset,...size]])
          return {...base,kind:'ordered-click',background:{width:size[0],height:size[1],image:backgroundPixels}}
        }
        const pieces = (display.fg_elem_list||[]).filter(p => p.type !== 'slider' && p.move_cfg?.data_type?.length)
        if (display.show_type === 'move_slide'||pieces.length) {
          if (pieces.length !== 1 || !layout.handle?.width) throw fail('unsupported_verification', '当前不是单拼块滑块布局。')
          const p = pieces[0]
          const pieceSource=p.img_url?image(p.img_url):sprite
          if(!pieceSource){await pause(100,undefined,{signal});continue}
          const [backgroundPixels]=await crop(source,[[...offset,...size]])
          const [pieceImage]=await crop(pieceSource,[[...(p.img_url?[0,0]:p.sprite_pos),...p.size_2d]],true)
          if(!pieceImage.contentBounds)throw fail('invalid_challenge','拼块图片没有可见像素。')
          return { ...base, kind: 'slider', factor: p.move_cfg.move_factor?.[0] ?? 1,
            background: { width:size[0],height:size[1],image:backgroundPixels },
            piece: { x:p.init_pos[0],y:p.init_pos[1],width:p.size_2d[0],height:p.size_2d[1],image:pieceImage.image,contentBounds:pieceImage.contentBounds } }
        }
        throw fail('unsupported_verification', '当前腾讯题型尚未适配。')
      }
      await pause(100, undefined, { signal })
    }
    throw this.observationError
      ? fail('verification_resource_unavailable', '未能读取官方 SDK 加载的验证码资源。')
      : fail('verification_not_visible', '验证码未完成加载。')
  }
  publicPuzzle(puzzle) {
    const base={kind:puzzle.kind,question:puzzle.question,...(puzzle.hints?.length?{hints:puzzle.hints}:{})}
    if(puzzle.kind==='audio')return {...base,audio:puzzle.audio,length:puzzle.length}
    return puzzle.kind === 'image-choice'
      ? { ...base, selection:puzzle.selection, choices:puzzle.choices.map(({id,image})=>({id,image})) }
      : { ...base, background:puzzle.background, ...(puzzle.piece?{piece:puzzle.piece}:{}) }
  }
  async click(point) {
    const x=Math.round(point.x), y=Math.round(point.y), wc=this.webContents
    // sendInputEvent targets the root renderer and misses out-of-process iframes.
    // CDP performs Chromium's frame hit testing; coordinates remain parent-page CSS pixels.
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',x,y})
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,x,y})
    await wc.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,x,y})
  }
  async submit(puzzle, raw, { signal }={}) {
    if(this.proof)return {status:'verified',proof:this.proof}
    const answer=validateAnswer(puzzle,raw), layout=await this.layout()
    if (this.revision!==puzzle.revision || JSON.stringify(layout)!==JSON.stringify(puzzle.layout)) throw fail('verification_changed','验证码或布局已变化，请重新采集。')
    const replyIndex=this.replies.length
    if (['image-choice','ordered-click'].includes(puzzle.kind)) {
      const points=puzzle.kind==='image-choice'
        ? answer.selected.map(id=>{const r=puzzle.choices.find(c=>c.id===id).rect;return{x:r.x+r.width/2,y:r.y+r.height/2}})
        : answer.points.map(p=>({x:layout.frame.x+layout.background.x+p.x*layout.background.width/puzzle.background.width,y:layout.frame.y+layout.background.y+p.y*layout.background.height/puzzle.background.height}))
      for (const point of points) { signal?.throwIfAborted();await this.click(point);await pause(80,undefined,{signal}) }
    } else if(puzzle.kind==='audio'){
      for(const [index,text]of [...answer.text].entries()){
        signal?.throwIfAborted();const r=layout.inputs[index]
        await this.click({x:layout.frame.x+r.x+r.width/2,y:layout.frame.y+r.y+r.height/2})
        await this.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:text,text,windowsVirtualKeyCode:text.charCodeAt(0)})
        await this.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:text,windowsVirtualKeyCode:text.charCodeAt(0)})
      }
    } else {
      if (!puzzle.factor) throw fail('unsupported_verification','滑块运动比例无效。')
      const h=layout.handle, start={x:layout.frame.x+h.x+h.width/2,y:layout.frame.y+h.y+h.height/2}
      const distance=(answer.targetX-puzzle.piece.x)*layout.background.width/puzzle.background.width/puzzle.factor
      const send=event=>this.webContents.debugger.sendCommand('Input.dispatchMouseEvent',event)
      await send({type:'mouseMoved',x:Math.round(start.x),y:Math.round(start.y)})
      await send({type:'mousePressed',button:'left',buttons:1,clickCount:1,x:Math.round(start.x),y:Math.round(start.y)})
      for(let i=1;i<=24;i++){signal?.throwIfAborted();await send({type:'mouseMoved',button:'left',buttons:1,x:Math.round(start.x+distance*i/24),y:Math.round(start.y)});await pause(16,undefined,{signal})}
      await send({type:'mouseReleased',button:'left',buttons:0,clickCount:1,x:Math.round(start.x+distance),y:Math.round(start.y)})
    }
    if(puzzle.kind!=='slider'){
      const r=layout.button;await this.click({x:layout.frame.x+r.x+r.width/2,y:layout.frame.y+r.y+r.height/2})
    }
    const deadline=Date.now()+25000
    while(Date.now()<deadline){
      signal?.throwIfAborted()
      if(this.proof)return {status:'verified',proof:this.proof}
      if(this.closed)throw fail('verification_cancelled','验证已关闭。')
      const code=this.replies[replyIndex]
      if([30,51].includes(code)&&this.revision!==puzzle.revision)return {status:'next_challenge'}
      if(code!==undefined&&![0,30,51].includes(code))throw fail(code===217?'verification_rate_limited':'verification_not_passed','腾讯未确认验证通过。',{providerCode:code})
      await pause(100,undefined,{signal})
    }
    throw fail('verification_timeout','没有收到官方 SDK 的成功回执。')
  }
  async run({signal}={}) {
    for(let round=0;round<3;round++){
      if(this.proof)return {status:'verified',proof:this.proof}
      try {
        const puzzle=await this.capture(signal)
        if(this.proof)return {status:'verified',proof:this.proof}
        if(!this.recognizer)throw fail('recognizer_not_configured','请配置识别器，或在官方窗口完成当前题。')
        const answer=await this.recognizer.recognize({...this.publicPuzzle(puzzle),signal})
        const result=await this.submit(puzzle,answer,{signal})
        if(result.status==='verified')return result
      } catch(error) {
        // The user can finish the official window while recognition is still pending.
        if(this.proof)return {status:'verified',proof:this.proof}
        throw error
      }
    }
    throw fail('verification_round_limit','服务端仍要求继续验证，本次停止。')
  }
  cancel(){if(this.closed)return;this.closed=true;if(this.webContents.isDestroyed?.())return;this.webContents.debugger.removeListener('message',this.listener);if(this.ownsDebugger&&this.webContents.debugger.isAttached())this.webContents.debugger.detach()}
}
