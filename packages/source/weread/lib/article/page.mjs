import { setTimeout as pause } from 'node:timers/promises'
import { ElectronCaptcha } from '../captcha/electron.mjs'
import { abortable, verifyWeChat, verifyWeRead } from '../captcha/index.mjs'
import { SkillError } from '../errors.mjs'

const WECHAT = 'https://mp.weixin.qq.com', WEREAD = 'https://weread.qq.com'

/** 同一浏览器入口加载各站链接；验证码按页面分派，返回后仍从当前页面提取 HTML。 */
export async function readArticlePage({ webContents: wc, url, show, recognizer, signal, bind, request, cookie }) {
  const target = new URL(url), wechat = target.origin === WECHAT
  if (!(wechat && (target.pathname === '/s' || target.pathname.startsWith('/s/'))) &&
      !(target.origin === WEREAD && target.pathname === '/web/mp/content' && /^MP_WXS_\d+_[\w~-]+$/.test(target.searchParams.get('reviewId')))) {
    throw new SkillError('invalid_endpoint', '文章窗口只接受微信原文或微信读书文章链接。')
  }
  const captcha = wechat ? new ElectronCaptcha({ webContents:wc, recognizer }) : undefined
  let status = 0
  const navigated = (_event, _url, code) => { status = code }
  wc.on('did-navigate', navigated)
  // 导航和页面执行也受命令超时约束，不能让一个未加载完的页面永久占住浏览器。
  const bounded = promise => abortable(promise, signal)
  const load = async headers => {
    try { await bounded(wc.loadURL(url, headers ? { extraHeaders:Object.entries(headers).map(([k,v]) => `${k}: ${v}`).join('\r\n') } : undefined)) }
    catch (error) { // 原页面可能自行跳转；其他导航错误不回显可能带验证参数的 URL。
      if (error.code !== 'ERR_ABORTED') throw new SkillError('article_load_failed', '浏览器没有完成文章页面加载，请稍后重试。')
    }
  }
  const readPage = async () => {
    while (!wc.isDestroyed() && wc.isLoadingMainFrame()) { signal.throwIfAborted(); await pause(100, undefined, { signal }) }
    if (wc.isDestroyed()) throw new SkillError('verification_cancelled', '文章窗口已关闭。')
    return bounded(wc.executeJavaScript(`(() => {
      const button = document.querySelector('#js_verify')?.getBoundingClientRect();
      const text = document.body?.innerText || '';
      let data; try { data = JSON.parse(text) } catch {}
      // 微信读书正文接口可能把文章 HTML 作为 text/plain 返回，浏览器会显示在 pre 中。
      return {html:document.contentType === 'text/plain' ? text : document.documentElement.outerHTML,content:!!document.querySelector('#js_content'),
        verification:location.pathname.startsWith('/mp/wappoc_appmsgcaptcha'),code:data?.errCode ?? data?.errcode,
        button:button?.width && button?.height ? {x:button.x+button.width/2,y:button.y+button.height/2} : null,
        message:/验证失败，请重试|系统繁忙，请稍后再试|系统失败/.exec(text)?.[0]};
    })()`))
  }
  let proof, renewed = false
  try {
    // 新 WebContents 尚无 renderer，先初始化空白页，才能在目标导航之前启用 CDP。
    if (captcha) { await bounded(wc.loadURL('about:blank')); await bounded(captcha.attach()) }
    await load()
    for (;;) {
      signal.throwIfAborted()
      let page = await readPage()
      if (page.content) return page.html
      if (wechat && page.verification) {
        page = await bounded(verifyWeChat({ captcha, readPage, show, signal }))
        if (page.content) return page.html
      }
      if (!wechat && Number(page.code) === -2041) {
        if (proof) throw new SkillError('verification_failed', '验证通过后微信读书仍然要求验证，请稍后重试。')
        if (!recognizer) show()
        proof = await bounded(verifyWeRead({ webContents:wc, recognizer, signal, bind }))
      } else if (!wechat && ([-2010, -2012].includes(Number(page.code)) || status === 401)) {
        if (renewed) throw new SkillError('login_required', '微信读书登录已失效，请先执行 login。')
        const response = await request(WEREAD + '/web/login/renewal', { method:'POST', headers:{'content-type':'application/json',referer:WEREAD+'/'},
          body:JSON.stringify({rq:encodeURIComponent(target.pathname),ql:await cookie('wr_ql') === '1'}) })
        if (JSON.parse(response.body)?.succ !== 1) throw new SkillError('login_required', '微信读书登录已失效，请先执行 login。')
        renewed = true
      } else if (Number(page.code) === -429 || status === 429) throw new SkillError('rate_limited', '文章站点暂时限制了访问，请稍后再试。')
      else if (page.code || status >= 400) throw new SkillError('remote_rejected', `文章站点拒绝了这次请求（${Number(page.code) || status}）。`)
      else return page.html
      await load(proof ? { 'x-wr-ticket':proof.ticket, 'x-wr-randstr':proof.randstr } : undefined)
    }
  } catch (error) {
    if (signal.aborted) throw new SkillError(signal.reason?.name === 'TimeoutError' ? 'verification_timeout' : 'verification_cancelled',
      signal.reason?.name === 'TimeoutError' ? '没有在限定时间内取得文章正文。' : '文章窗口已关闭。')
    throw error
  } finally { wc.removeListener('did-navigate', navigated); captcha?.cancel() }
}
