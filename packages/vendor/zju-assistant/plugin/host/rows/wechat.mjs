/**
 * 「微信公众号」：跟踪的号和它们最近的文章（wechat.mjs），背后是 weread 技能（core/weread）。
 * 开着时起一个 Wechat 登记到根服务，半小时把跟踪的号看一遍，新文章进校园事务的通知；weread 要的浏览器由 weread-bridge.mjs 在一条管道上给，
 * 扫码登录和过验证开插件自己的浏览器窗口（browser.mjs，本机的默认浏览器），验证码先交给模型认，认不出来再让用户做。
 */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { Wechat, runWeread } from '../wechat.mjs'
import { WereadBridge } from '../weread-bridge.mjs'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { articlesAlert } from '../alerts.mjs'
import { output } from '../tools.mjs'
import { row } from '../row.mjs'

export default row('wechat', {
  inject: ['tools'],
  start(ctx, campus) {
    const dir = path.join(campus.home, 'weread')
    const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\dsh-zju-campus-weread-${randomUUID()}` : path.join(tmpdir(), `dsh-zju-weread-${randomUUID().slice(0, 8)}.sock`)
    const bridge = new WereadBridge({ dir, browser: () => campus.browser, recognizer: () => campus.recognizer() })
    ctx.effect(() => bridge.listen(endpoint), 'zju-campus: weread browser bridge')
    const wechat = new Wechat({
      plugins: campus.plugins, settingsFile: campus.store.file('wechat.json'), cacheFile: path.join(campus.home, 'cache', 'wechat.json'),
      run: (args, options) => runWeread(args, { ...options, env: { WEREAD_BROWSER_ENDPOINT: endpoint, WEREAD_DATA_DIR: dir } }),
      onNew: articles => campus.push(articlesAlert(articles)),
    })
    ctx.effect(() => campus.provide('wechat', wechat), 'zju-campus: public accounts')
    ctx.effect(() => wechat.start(), 'zju-campus: public-account checking lifecycle')
    // 给助手的：weread 技能的命令（读一篇文章、查一个号最近发了什么、存成 Markdown）。有人在场，要扫码、要验证时开插件自己的浏览器窗口。
    ctx.tools.register(defineTool({
      name: 'campus_wechat',
      description: '微信公众号文章（经微信读书）。先加载 zju-campus 技能。args 是 weread 命令后面那一串，一项一个：读一篇 ["read","--url","https://mp.weixin.qq.com/s/…"]；某号最近的文章 ["list","--account","名称"]；存成 Markdown 和图片 ["download","--url","链接","--out","对话的工作目录"]；不确定号名 ["accounts","--query","名称的一部分"]。公众号文章的链接直接用网页提取会被验证拦住，一律用它。结果是 JSON，ok 为 false 时按 message 告诉用户。',
      parameters: { args: { type: 'array', required: true, items: { type: 'string' }, description: 'weread 后面的参数，一项一个' } },
      output,
      presentCall: () => ({ card: 'generic', title: '读公众号', kind: 'other' }),
      execute: async (args, exec) => {
        if (!args.args.length || args.args.some(arg => typeof arg !== 'string')) throw new Error('args 要是一串参数，一项一个字符串。')
        return runWeread(args.args, { interactive: true, signal: exec.signal, timeoutMs: 320_000, env: { WEREAD_BROWSER_ENDPOINT: endpoint, WEREAD_DATA_DIR: dir } })
      },
    }))
  },
})
