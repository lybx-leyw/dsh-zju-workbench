import { randomUUID } from 'node:crypto'
import { setTimeout as pause } from 'node:timers/promises'
import { ElectronCaptcha } from './electron.mjs'
import { PtaSliderRecognizer } from './pta.mjs'
import { SkillError } from '../errors.mjs'

/** 浏览器脚本/导航也必须响应关闭或超时；宿主随后销毁窗口。 */
export function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason)
    signal.throwIfAborted()
    signal.addEventListener('abort', aborted, { once:true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}

/** 微信读书首页延迟初始化 OverlayScrollbars，会移动 body 子节点并重载 iframe。
 * 等它完成后再插入官方验证码；正文接口的文本页没有这个初始化过程。
 */
async function pageReady() {
  if (!document.querySelector('#__nuxt') || !document.body.classList.contains('wr_desktop')) return true
  const deadline = Date.now() + 10000
  while (!document.documentElement.hasAttribute('data-overlayscrollbars')) {
    if (Date.now() > deadline) return false
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return true
}

/** 微信读书模式：保留多模态识别，支持选图、点选、滑块等题型。 */
export function verifyWeRead(options) {
  return verifyComponent({ ...options, appId: '2044038556', script: 'https://captcha.gtimg.com/TCaptcha.js' })
}

/** PTA 模式：同一套取题、输入与回执流程，滑块在本地匹配，不查询模型配置。 */
export function verifyPta(options) {
  return verifyComponent({ ...options, appId: '194593025', script: 'https://turing.captcha.qcloud.com/TCaptcha.js',
    recognizer: new PtaSliderRecognizer(options.webContents) })
}

/** 官方 SDK 返回票据，由调用方恢复业务请求。manual 为真时，自动作答失败后等用户完成。 */
async function verifyComponent({ webContents, recognizer, signal, bind, appId, script, manual = false }) {
  const captcha = new ElectronCaptcha({ webContents, recognizer, appId, script, taskId:randomUUID(), resultBridge:'wereadVerification' })
  bind(captcha)
  try {
    if (!await abortable(webContents.executeJavaScript('(' + pageReady.toString() + ')()'), signal)) {
      throw new SkillError('verification_page_not_ready', '微信读书页面尚未完成初始化，未启动验证码，请稍后重试。')
    }
    await abortable(captcha.open(), signal)
    if (recognizer) {
      try { await abortable(captcha.run({ signal }), signal) }
      catch (error) { if (!manual || signal.aborted || captcha.closed) throw error }
    }
    while (!captcha.proof) {
      signal.throwIfAborted()
      if (captcha.closed || webContents.isDestroyed()) throw new SkillError('verification_cancelled', '验证窗口已关闭。')
      await pause(200, undefined, { signal })
    }
    return captcha.proof
  } catch (error) {
    if (signal.aborted) throw new SkillError(signal.reason?.name === 'TimeoutError' ? 'verification_timeout' : 'verification_cancelled',
      signal.reason?.name === 'TimeoutError' ? '没有在限定时间内完成验证。' : '验证窗口已关闭。')
    throw error
  } finally { captcha.cancel(); bind(undefined) }
}

/** 微信原文：使用页面自己的 SDK、appid、sid 及回调；成功后由原页面消费回执并跳转。 */
export async function verifyWeChat({ captcha, readPage, show, signal }) {
  let clicked = false, solved = false
  if (!captcha.recognizer) show()
  for (;;) {
    signal.throwIfAborted()
    const page = await readPage()
    if (!page.verification || page.content) return page
    if (page.button && !clicked) {
      captcha.proof = undefined
      await captcha.click(page.button)
      clicked = true
    }
    if (!solved && captcha.recognizer && captcha.display && !captcha.proof && await captcha.layout()) {
      solved = true
      await captcha.run({ signal })
    }
    if (page.message) throw new SkillError('verification_not_passed', page.message)
    await pause(150, undefined, { signal })
  }
}
