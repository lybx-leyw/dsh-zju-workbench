import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { lookAt, startModelBridge } from './vision.mjs'

const pipe = () => process.platform === 'win32' ? `\\\\.\\pipe\\campus-model-test-${randomUUID()}` : path.join(os.tmpdir(), `campus-model-test-${randomUUID().slice(0, 8)}.sock`)

/** 像校园命令那样问一次：写一行，读到对面关上为止。 */
function ask(endpoint, line) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(endpoint)
    let received = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(line))
    socket.on('data', (chunk) => { received += chunk })
    socket.once('error', reject)
    socket.once('close', () => resolve(JSON.parse(received)))
  })
}

/** 假的引擎：记下发给模型的请求，照 reply 答。info 是这个模型的资料。 */
function engine({ info, reply = () => '看到了', selection = { provider: 'deepseek', model: 'deepseek-flash' } } = {}) {
  const requests = [], saved = [], files = []
  const services = {
    agentDefaultModel: { currentSelection: () => selection },
    attachments: {
      // 像引擎那样把图存成本机的一个文件，问得到它在哪。
      saveImage: async (image) => {
        saved.push(image)
        const file = path.join(os.tmpdir(), `campus-model-test-${randomUUID()}`)
        fs.writeFileSync(file, image.data)
        files.push(file)
        return { attachmentId: `a${saved.length}`, mediaType: image.mediaType, bytes: image.data.length, width: 1, height: 1 }
      },
      imageHostPath: ref => files[Number(ref.attachmentId.slice(1)) - 1],
    },
    llm: {
      resolveModelInfo: async () => { if (!info) throw new Error('没有这个模型的资料'); return info },
      async* stream(request) {
        requests.push(request)
        const text = reply(request)
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
  }
  return { ctx: { get: name => services[name], logger: { warn: message => assert.fail(message) } }, requests, saved, files }
}

const image = Buffer.from('fake png bytes').toString('base64')

test('用现在选的模型看图：图先存进附件库再引用，思考开到这个模型最低的一档', async () => {
  const deepseek = engine({ info: { name: 'DeepSeek Flash', inputModalities: ['text', 'image'], reasoning: { efforts: [{ id: 'off' }, { id: 'low' }, { id: 'high' }, { id: 'max' }] } } })
  assert.equal(await lookAt(deepseek.ctx, { text: '图里有什么字', image, mediaType: 'image/png' }), '看到了')
  assert.deepEqual([deepseek.requests[0].provider, deepseek.requests[0].model, deepseek.requests[0].reasoningEffort], ['deepseek', 'deepseek-flash', 'off'])
  assert.deepEqual(deepseek.requests[0].messages[0].content, [{ type: 'text', text: '图里有什么字' }, { type: 'image', attachment: { attachmentId: 'a1', mediaType: 'image/png', bytes: 14, width: 1, height: 1 } }])
  assert.equal(Buffer.from(deepseek.saved[0].data).toString(), 'fake png bytes')
  // 问完就把图从附件库里拿掉，不攒着。
  assert.equal(fs.existsSync(deepseek.files[0]), false)
  // GPT 关不掉思考，用它最低的一档；查不到资料的模型不指定。
  const gpt = engine({ info: { name: 'GPT', reasoning: { efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }] } }, selection: { provider: 'openai-codex', model: 'gpt' } })
  await lookAt(gpt.ctx, { text: 'x', image, mediaType: 'image/png' })
  assert.equal(gpt.requests[0].reasoningEffort, 'low')
  const unknown = engine()
  await lookAt(unknown.ctx, { text: 'x', image, mediaType: 'image/png' })
  assert.equal('reasoningEffort' in unknown.requests[0], false)
})

test('没配模型、选的模型看不了图，是要用户去处理的事，不去问', async () => {
  const blind = engine({ info: { name: '只读字的模型', inputModalities: ['text'] } })
  await assert.rejects(lookAt(blind.ctx, { text: 'x', image, mediaType: 'image/png' }), /只读字的模型.*看不了图/)
  assert.equal(blind.requests.length, 0)
  await assert.rejects(lookAt({ get: () => undefined }, { text: 'x', image, mediaType: 'image/png' }), /还没有配好模型/)
})

test('管道：一条连接问一次，问成了回文字，问不成说明是哪一种', async (t) => {
  const endpoint = pipe(), asked = []
  const replies = [async () => '认出来了', async () => { throw new Error('余额不足') }]
  const stop = startModelBridge({ logger: { warn: message => assert.fail(message) } }, { endpoint, look: async (input) => { asked.push(input); return replies.shift()() } })
  t.after(stop)
  const request = JSON.stringify({ text: '题目', image, mediaType: 'image/png' }) + '\n'
  assert.deepEqual(await ask(endpoint, request), { ok: true, text: '认出来了' })
  assert.deepEqual(asked[0], { text: '题目', image, mediaType: 'image/png' })
  assert.deepEqual(await ask(endpoint, request), { ok: false, code: 'failed', message: '余额不足' })
  assert.equal((await ask(endpoint, '不是 JSON\n')).code, 'bad_request')
  assert.equal((await ask(endpoint, JSON.stringify({ text: '题目', image, mediaType: 'text/html' }) + '\n')).code, 'bad_request')
  assert.equal(asked.length, 2)
})

test('管道连着真的那一步：要用户处理的事带着 needs_user 回去', async (t) => {
  const endpoint = pipe()
  const stop = startModelBridge(engine({ info: { name: '只读字的模型', inputModalities: ['text'] } }).ctx, { endpoint })
  t.after(stop)
  const reply = await ask(endpoint, JSON.stringify({ text: '题目', image, mediaType: 'image/png' }) + '\n')
  assert.deepEqual([reply.ok, reply.code], [false, 'needs_user'])
  assert.match(reply.message, /看不了图/)
})

test('没有给地址时不开管道', () => {
  const previous = process.env.CAMPUS_MODEL_ENDPOINT
  delete process.env.CAMPUS_MODEL_ENDPOINT
  try { assert.equal(typeof startModelBridge({}), 'function') } finally { if (previous !== undefined) process.env.CAMPUS_MODEL_ENDPOINT = previous }
})
