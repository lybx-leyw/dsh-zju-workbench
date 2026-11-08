const { app, BrowserWindow, ipcMain, session } = require('electron')
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url')
const directory = process.argv[2]
app.setPath('userData', directory)
app.on('window-all-closed',()=>{})
app.whenReady().then(async () => {
  const { readArticlePage } = await import(pathToFileURL(path.join(__dirname, '../../lib/article/page.mjs')))
  const browser = session.defaultSession, calls = [], result = {shown:{},everVisible:false}
  let mode, captcha
  const article = '<h1 id="activity-name">Fixture</h1><div id="js_content">Rendered article<img data-src="https://images.example/picture.png"></div>'
  browser.protocol.handle('https', async request => {
    const url = new URL(request.url), ticket = request.headers.get('x-wr-ticket')
    if (mode === 'stall') return new Promise(()=>{})
    if (mode === 'unauthorized') return new Response('Unauthorized', {status:401})
    calls.push({ host:url.hostname, path:url.pathname, ticket, rand:request.headers.get('x-wr-randstr') })
    if (mode === 'delayed-home' && url.pathname === '/captcha-fixture') return new Response(`<script>
      addEventListener('message',event=>{if(event.data?.initialize)setTimeout(()=>parent.postMessage({fixtureDone:true},'*'),250)})
    </script>`, {headers:{'content-type':'text/html'}})
    if (mode === 'delayed-home' && !ticket) return new Response(`<div id="__nuxt"><pre>{"errCode":-2041}</pre></div><script>
      document.body.classList.add('wr_desktop');
      setTimeout(()=>{
        for(const node of [...document.body.childNodes])document.body.appendChild(node);
        document.documentElement.setAttribute('data-overlayscrollbars','');
      },150);
      window.TencentCaptcha=class {
        constructor(id,callback){this.callback=callback}
        show(){
          const frame=document.createElement('iframe');frame.id='tcaptcha_iframe_dy';frame.src='/captcha-fixture';
          frame.onload=()=>{frame.onload=null;frame.contentWindow.postMessage({initialize:true},'*')};
          addEventListener('message',event=>{if(event.source===frame.contentWindow&&event.data?.fixtureDone)this.callback({ret:0,ticket:'fixture-ticket',randstr:'fixture-rand'})});
          document.body.appendChild(frame);
        }
      }
    </script>`, {headers:{'content-type':'text/html'}})
    if (mode === 'wechat') {
      if (url.pathname.startsWith('/s') && !url.searchParams.has('verified')) return new Response('', {status:302, headers:{location:'https://mp.weixin.qq.com/mp/wappoc_appmsgcaptcha'}})
      if (url.pathname.startsWith('/s')) { result.trusted = url.searchParams.get('trusted'); return new Response(article, {headers:{'content-type':'text/html'}}) }
      // The native page owns the challenge and redirect. No WeRead SDK is injected here.
      return new Response(`<button id="js_verify">Verify</button><script>document.querySelector('button').onclick=e=>location.replace('/s/fixture?verified=1&trusted='+e.isTrusted)</script>`, {headers:{'content-type':'text/html'}})
    }
    if (mode === 'weread' && !ticket) return new Response(`<pre>{"errCode":-2041}</pre><script>
      window.TencentCaptcha=class {constructor(id,callback){this.callback=callback}show(){setTimeout(()=>this.callback({ret:0,ticket:'fixture-ticket',randstr:'fixture-rand'}),30)}}
    </script>`, {headers:{'content-type':'text/html'}})
    if (mode === 'renewal') {
      if (url.pathname === '/web/login/renewal') { result.renewal = JSON.parse(await request.text()); return Response.json({succ:1}) }
      if (!result.renewal) return Response.json({errCode:-2012})
    }
    return new Response(article, {headers:{'content-type':mode === 'weread' ? 'text/plain' : 'text/html'}})
  })
  const read = async (url, signal=AbortSignal.timeout(5000)) => {
    const window = new BrowserWindow({show:false,webPreferences:{session:browser,preload:path.join(__dirname,'../../lib/browser/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
    const automatic=mode==='delayed-home'||mode==='wechat'
    window.on('show',()=>{result.everVisible=true})
    try { return await readArticlePage({webContents:window.webContents,url,show:()=>{result.shown[mode]=(result.shown[mode]||0)+1},signal,bind:value=>{captcha=value},cookie:async()=> '1',
      recognizer:automatic?{recognize:async()=>{throw new Error('fixture should finish without a model')}}:undefined,
      request:async(url,options)=>{const response=await browser.fetch(url,options);return {status:response.status,body:await response.text()}}}) }
    finally { window.destroy() }
  }
  ipcMain.handle('weread:captcha-result',(event,receipt)=>event.senderFrame===event.sender.mainFrame && captcha?.receive(receipt))
  try {
    mode='plain'; result.plain=(await read('https://mp.weixin.qq.com/s/plain')).includes('Rendered article')
    mode='wechat'; result.wechat=(await read('https://mp.weixin.qq.com/s/fixture')).includes('Rendered article')
    mode='weread'; result.weread=(await read('https://weread.qq.com/web/mp/content?reviewId=MP_WXS_123_fixture')).includes('<div id="js_content">Rendered article')
    mode='delayed-home'; result.delayed=(await read('https://weread.qq.com/web/mp/content?reviewId=MP_WXS_123_fixture')).includes('Rendered article')
    mode='renewal'; result.renewed=(await read('https://weread.qq.com/web/mp/content?reviewId=MP_WXS_123_fixture')).includes('Rendered article')
    result.calls=calls
    await read('https://example.invalid').catch(error=>{result.invalid=error.code})
    mode='unauthorized'
    await read('https://mp.weixin.qq.com/s/unauthorized').catch(error=>{result.unauthorized=error.code})
    mode='stall'
    await read('https://mp.weixin.qq.com/s/stalled',AbortSignal.timeout(200)).catch(error=>{result.timeout=error.code})
  } catch(error) { result.error=error.stack;process.exitCode=1 }
  fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result));app.exit(process.exitCode||0)
})
