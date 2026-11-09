/**
 * 校园命令（core/zju）要模型看一张图时走的管道。命令是引擎启动的另一个进程，够不着引擎的模型服务，
 * 所以引擎在这里听一条管道：命令把一句话和一张图交过来，这里用用户现在选的那个模型问一次，把回答还回去。
 * 填的是 DeepSeek Key 还是登录的 ChatGPT 账号都一样用。现在只有体育场馆预约认验证码用它（core/zju/lib/tyys/captcha.ts）。
 * 管道地址由 DSH 插件根服务设置，通过 CAMPUS_MODEL_ENDPOINT 传给校园命令。
 * 和微信公众号插件的那条管道一样，只有这台电脑上同一个用户的程序够得着。
 *
 * 一条连接问一次。命令写一行 JSON：{ text, image, mediaType }，image 是 base64。
 * 这里回一行 JSON：{ ok: true, text }，或者 { ok: false, code, message }。
 * code 是 needs_user 时 message 是要用户自己去办的事（没配模型、选的模型看不了图），别的 code 是这一次没问成。
 */
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { askModel } from './model.mjs'
import { CORE_ROOT } from './core.mjs'

export const MODEL_ENDPOINT = 'CAMPUS_MODEL_ENDPOINT'
/** 一次请求最多这么大。验证码放大以后的图只有几百 KB。 */
const MAX_REQUEST = 8 * 1024 * 1024
const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
/** 看图认字这种事不用多想：这个模型能关掉思考就关掉，不能就用它最低的一档。多想只是更慢，认得并不更准（依据见 core/zju/lib/tyys/README.md）。 */
const QUICK = ['off', 'minimal', 'low']

/** 要用户自己去办的事。 */
class NeedsUser extends Error {}

/** 现在选的模型能不能看图，让它少想该用哪一档。problem 是用户要自己去办的事。 */
async function visionModel(ctx) {
  const llm = ctx.get?.('llm'), selection = ctx.get?.('agentDefaultModel')?.currentSelection()
  if (!llm || !selection?.provider || !selection.model) return { problem: '应用里还没有配好模型，先在设置里填 API Key 或者登录账号' }
  let info
  try { info = await llm.resolveModelInfo(selection.provider, selection.model) } catch { /* 查不到这个模型的资料时，照能看图的去问 */ }
  if (info?.inputModalities && !info.inputModalities.includes('image')) return { problem: `现在选的模型（${info.name ?? selection.model}）看不了图，在设置里换一个能看图的模型` }
  const offered = info?.reasoning?.efforts?.map(effort => effort.id) ?? []
  return { effort: QUICK.find(id => offered.includes(id)) }
}

/** 用现在选的模型看一张图、答一句话。 */
export async function lookAt(ctx, { text, image, mediaType }) {
  const { problem, effort } = await visionModel(ctx)
  if (problem) throw new NeedsUser(problem)
  return askModel(ctx, { text, image: { data: Buffer.from(image, 'base64'), mediaType, name: 'campus-command.png' }, reasoningEffort: effort, maxTokens: 2000, timeoutMs: 30_000 })
}

/**
 * 微信读书、公众号原文认题用的识别器：core/weread/lib/captcha 的那一套，问的是现在选的模型，和场馆验证码一样。PTA 使用本地滑块识别器。
 * 没配模型、或者这个模型看不了图时不给，验证码留在窗口里让用户自己做。引擎的模型服务收不了音频，语音题也交给用户。
 */
export async function captchaRecognizer(ctx) {
  const { problem, effort } = await visionModel(ctx)
  if (problem) return undefined
  const { CaptchaRecognizer } = await import(pathToFileURL(path.join(CORE_ROOT, 'weread', 'lib', 'captcha', 'recognizer.mjs')).href)
  return new CaptchaRecognizer({ audioInput: false, ask: async (content, signal) => {
    const parts = content.flatMap(part => part.type === 'text' ? [{ text: part.text }] : part.type === 'image_url' ? [{ image: dataImage(part.image_url.url) }] : [])
    const answer = await askModel(ctx, { parts, reasoningEffort: effort, maxTokens: 2000, timeoutMs: 45_000, signal })
    // 识别器要的是一段 JSON，有的模型会裹在 ```json 里，取出花括号那一段。
    return /\{[\s\S]*\}/.exec(answer)?.[0] ?? answer
  } })
}

/** 验证码模块给的 data:image/…;base64,… 换成附件库收的 { data, mediaType, name }。 */
function dataImage(url) {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(url)
  if (!match) throw new Error('验证码的图不是 data URL。')
  return { data: Buffer.from(match[2], 'base64'), mediaType: match[1], name: 'captcha.png' }
}

async function answer(line, look) {
  let request
  try { request = JSON.parse(line) } catch { return { ok: false, code: 'bad_request', message: '请求不是 JSON' } }
  if (typeof request?.text !== 'string' || !request.text || typeof request.image !== 'string' || !request.image || !MEDIA_TYPES.includes(request.mediaType)) {
    return { ok: false, code: 'bad_request', message: '请求要有 text、image 和 mediaType' }
  }
  try { return { ok: true, text: await look({ text: request.text, image: request.image, mediaType: request.mediaType }) } }
  catch (error) { return { ok: false, code: error instanceof NeedsUser ? 'needs_user' : 'failed', message: error instanceof Error ? error.message : String(error) } }
}

/**
 * 在 endpoint 上开始听，返回停下来用的函数。没有给地址时不开。
 * look 是真正去问模型的那一步，测试时换成假的。
 */
export function startModelBridge(ctx, { endpoint = process.env[MODEL_ENDPOINT], look = input => lookAt(ctx, input) } = {}) {
  if (!endpoint) return () => {}
  // 别的系统上管道是一个文件，上一次没收拾干净的要先删掉才听得上。
  if (process.platform !== 'win32') fs.rmSync(endpoint, { force: true })
  const sockets = new Set()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => { sockets.delete(socket) })
    socket.on('error', () => {})
    let received = '', answered = false
    socket.setEncoding('utf8')
    socket.on('data', (chunk) => {
      if (answered) return
      received += chunk
      const end = received.indexOf('\n')
      if (end < 0 && received.length <= MAX_REQUEST) return
      answered = true
      const reply = end < 0 ? Promise.resolve({ ok: false, code: 'bad_request', message: '请求太大' }) : answer(received.slice(0, end), look)
      reply.then((value) => { if (!socket.destroyed) socket.end(JSON.stringify(value) + '\n') })
    })
  })
  server.on('error', (error) => { ctx.logger?.warn?.(`campus: 校园命令问模型用的管道没有开成：${error.message}`) })
  server.listen(endpoint)
  return () => {
    server.close()
    for (const socket of sockets) socket.destroy()
  }
}
