// 浏览器能力本体：共用会话、文章页面、登录窗口及验证码输入。
// 独立运行时由 host.cjs 装进 Skill 自带的 Electron；被应用托管时由应用的主进程直接引用，命令连到它开的管道上（runtime.ts）。
const path = require('node:path')
const { createInterface } = require('node:readline')
const { pathToFileURL } = require('node:url')
const ORIGIN = 'https://weread.qq.com'
const error = (code,message) => Object.assign(new Error(message),{code})
const load = file => import(pathToFileURL(path.join(__dirname,file)))

/**
 * BrowserWindow、ipcMain 来自宿主的 Electron，session 是保存登录状态的会话。宿主还可以给：
 * parent 窗口挂在哪个窗口下面；vision 用宿主自己的识别模型配置替换调用方带来的；guard 每次调用前执行，抛错即拒绝这次调用。
 */
async function createBrowserService({ BrowserWindow, ipcMain, session:browser, parent, title='WeRead Skill', vision=requested=>requested, guard=()=>{} }) {
  const [{verifyWeRead},{CaptchaRecognizer},{readArticlePage}] = await Promise.all(['../captcha/index.mjs','../captcha/recognizer.mjs','../article/page.mjs'].map(load))
  let window, captcha, abort, queue = Promise.resolve()
  const cookie = async name => (await browser.cookies.get({url:ORIGIN,name}))[0]?.value
  const recognizer = requested => { const config=vision(requested); return config?new CaptchaRecognizer(config):undefined }

  async function openWindow(url = ORIGIN, visible = false) {
    if(window&&!window.isDestroyed())window.destroy()
    const view = window = new BrowserWindow({width:1060,height:800,show:false,title,parent,webPreferences:{
      session:browser,preload:path.join(__dirname,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,
    }})
    view.webContents.setWindowOpenHandler(()=>({action:'deny'}))
    const allow=(event,url)=>{if(![ORIGIN,'https://open.weixin.qq.com','https://mp.weixin.qq.com'].includes(new URL(url).origin))event.preventDefault()}
    view.webContents.on('will-navigate',allow)
    view.webContents.on('will-redirect',allow)
    // 只认当前这个窗口：上一次调用的窗口收尾时不能打断已经开始的下一次。
    view.on('closed',()=>{if(window!==view)return;window=undefined;captcha?.cancel();abort?.abort()})
    if(visible){view.show();view.focus()}
    if(url)await view.loadURL(url)
    return view
  }
  /** 窗口只有一个：用到它的调用排队，一次一个。调用方断开、窗口被关和超时都会打断它，结束时收掉窗口。 */
  function windowed(call,url,visible,run) {
    const result=queue.then(async()=>{
      call.signal.throwIfAborted()
      const view=await openWindow(url,visible)
      abort=new AbortController()
      try{return await run(view,AbortSignal.any([abort.signal,call.signal,AbortSignal.timeout(290000)]))}
      finally{abort=undefined;if(!view.isDestroyed())view.destroy()}
    })
    queue=result.catch(()=>{})
    return result
  }
  const actions = {
    cookie,
    async request({url,method,headers,body}) {
      if(new URL(url).origin!==ORIGIN)throw error('invalid_endpoint','微信读书会话不能访问其他站点。')
      const response=await browser.fetch(url,{method,headers,body,credentials:'include',redirect:'error',signal:AbortSignal.timeout(30000)})
      return{status:response.status,body:await response.text()}
    },
    /** 普通正文和有识别模型时的自动验证都在隐藏的窗口里完成；要用户自己验证时才显示。调用方声明没人在场时不显示，直接报需要验证。 */
    article:({url,vision:requested},call)=>windowed(call,null,false,(view,signal)=>readArticlePage({webContents:view.webContents,url,
      show:()=>{if(!call.interactive)throw error('verification_required','这篇文章要先完成一次验证。');view.showInactive()},
      recognizer:recognizer(requested),signal,bind:value=>{captcha=value},request:(url,options)=>actions.request({url,...options}),cookie})),
    /** 等用户在窗口里扫码；已有的登录有效时立即返回。verified=false 表示登录后的第一个请求被要求验证。 */
    login(_input,call) {
      if(!call.interactive)throw error('login_required','微信读书没有登录，需要在窗口里扫码。')
      return windowed(call,ORIGIN,true,async(view,signal)=>{
        let checked=''
        for(;;){
          if(signal.reason?.name==='TimeoutError')throw error('login_timeout','没有在限定时间内完成微信读书登录。')
          if(view.isDestroyed()||signal.aborted)throw error('login_cancelled','登录窗口已关闭。')
          const [vid,skey,rt,ql]=await Promise.all(['wr_vid','wr_skey','wr_rt','wr_ql'].map(cookie)),fingerprint=[vid,skey,rt,ql].join(':')
          if(vid&&skey&&fingerprint!==checked){
            checked=fingerprint
            const response=await browser.fetch(ORIGIN+'/web/shelf/sync?userVid=&synckey=0&lectureSynckey=0',{headers:{accept:'application/json',referer:ORIGIN+'/'},credentials:'include',signal:AbortSignal.timeout(30000)})
            const result=await response.json()
            if(Array.isArray(result.books))return{verified:true}
            if(Number(result.errCode)===-2041)return{verified:false}
          }
          await new Promise(resolve=>setTimeout(resolve,500))
        }
      })
    },
    /** 在官方验证码组件里完成一次验证，返回票据。有识别模型时在隐藏的窗口里自动作答；没有时显示窗口等用户完成，没人在场就直接报需要验证。 */
    captcha({vision:requested},call) {
      const solver=recognizer(requested)
      if(!solver&&!call.interactive)throw error('verification_required','微信读书要先完成一次验证。')
      return windowed(call,ORIGIN,!solver,(view,signal)=>verifyWeRead({webContents:view.webContents,recognizer:solver,signal,bind:value=>{captcha=value}}))
    },
    /** 退出登录：清掉这个会话里的全部站点数据。排在用窗口的调用后面，不打断正在进行的一次。 */
    logout() {
      const result=queue.then(async()=>{await browser.clearStorageData();await browser.cookies.flushStore()})
      queue=result.catch(()=>{})
      return result
    },
  }
  ipcMain.handle('weread:captcha-result',(event,result)=>{
    if(!window||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||new URL(event.senderFrame.url).origin!==ORIGIN)return{ok:false}
    return{ok:captcha?.receive(result)===true}
  })
  const cancel=()=>{captcha?.cancel();abort?.abort()}

  return {
    /**
     * 一条连接上一行一条 JSON：{id, action, input, interactive} 对应 {id, result} 或 {id, error}。连接断开时打断它还没做完的调用。
     * hooks.close 给了就接受 close：调用方用完了，宿主收尾（独立运行时是落盘后退出）。
     */
    serve(socket,hooks={}) {
      const gone=new AbortController()
      socket.on('close',()=>gone.abort())
      socket.on('error',()=>{})
      const send=value=>{if(!socket.destroyed)socket.write(JSON.stringify(value)+'\n')}
      createInterface({input:socket}).on('line',async line=>{
        let message
        try{message=JSON.parse(line)}catch{return}
        try{
          if(message.action==='close'&&hooks.close){cancel();await hooks.close();return}
          guard()
          if(!Object.hasOwn(actions,message.action))throw error('invalid_action','不支持的浏览器操作。')
          send({id:message.id,result:await actions[message.action](message.input,{signal:gone.signal,interactive:message.interactive!==false})})
        }catch(e){
          const code=typeof e.code==='string'?e.code:e.name==='TimeoutError'?'browser_timeout':'browser_error'
          send({id:message.id,error:{code,message:typeof e.code==='string'?e.message:code==='browser_timeout'?'请求超时。':'浏览器没有完成这次操作。',details:e.details}})
        }
      })
    },
    /** 登录状态写到磁盘上。 */
    flush:()=>browser.cookies.flushStore(),
    /** 打断正在进行的验证或取文。 */
    cancel,
    dispose() {
      cancel()
      ipcMain.removeHandler('weread:captcha-result')
      if(window&&!window.isDestroyed())window.destroy()
    },
  }
}

module.exports = { createBrowserService }
