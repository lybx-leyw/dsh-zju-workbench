/**
 * 从 npm 装好以后 core 在 node_modules 里，Node 不肯给那里的 .ts 剥类型（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）。
 * 这里接手剥，用的是 Node 自己的 stripTypeScriptTypes，行号不变，能写进 core 的语法和直接跑时一样。node_modules 外面的照旧交给 Node。
 * core.mjs 经 NODE_OPTIONS 的 --import 挂上它，core 再起的 Node 子进程（字幕采集、微信读取器）也继承这个变量。
 */
import module from 'node:module'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

// 第一次调用时 Node 报一条实验特性的警告，会混进 core 的 stderr（助手读得到）；先空调一次，把那一条吞掉。
const emitWarning = process.emitWarning
process.emitWarning = () => {}
try { module.stripTypeScriptTypes('') } finally { process.emitWarning = emitWarning }

module.registerHooks({
  load(url, context, nextLoad) {
    const { protocol, pathname } = new URL(url)
    if (protocol !== 'file:' || !pathname.endsWith('.ts') || !pathname.includes('/node_modules/')) return nextLoad(url, context)
    const source = module.stripTypeScriptTypes(fs.readFileSync(fileURLToPath(url), 'utf8'))
    return { format: context.format === 'commonjs-typescript' ? 'commonjs' : 'module', source, shortCircuit: true }
  },
})
