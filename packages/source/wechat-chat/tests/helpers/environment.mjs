/**
 * 测试环境探测。
 *
 * 上游 `core/wechat/tests/` 的五个测试都在「依赖装好、微信可达」的假设下写。
 * 移进本仓之后有两类原因会让它们跑不起来，而**两类都不是被测代码的缺陷**：
 *
 * 1. **运行时依赖没装**：`htmlparser2` / `silk-wasm` 写在 `package.json` 的
 *    `dependencies` 里，但本仓按约定不跑 `npm install`，所以干净环境里解析不到。
 * 缺了它，静态 `import` 在**加载阶段**就抛 `ERR_MODULE_NOT_FOUND` ——
 *   那会让整个测试文件报错，而不是任何一个用例失败。所以探测必须在
 *    文件顶层做，并且用动态 `import()` 把模块加载推迟到探测之后。
 *
 * 2. **C# 现场编译被拦**：`scripts/local/*.cs` 要在 PowerShell 里经 `Add-Type`
 *    临时编译成内存程序集。本机杀毒软件会拦这一步（报
 *    “contains a virus or potentially unwanted software”）。这不是代码问题，
 *    换一台没装同类拦截的机器就能过；但测试既然跑在本机，就得如实跳过并
 *    说清原因，不能删测试、也不能改成必然通过的假断言。
 *
 * 两种情况下调用方都应把 `{ skip: 原因 }` 传给 `test()`：跳过并**留下原因**，
 * 而不是从测试集里消失。
 */
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = path.dirname(fileURLToPath(import.meta.url))
const local = (name) => path.join(here, '..', '..', 'scripts', 'local', name)

/** 依赖装没装。（探测的是「能否解析」，不是版本对不对。） */
export function dependencyMissing(name) {
  try {
    require.resolve(name)
    return false
  } catch {
    return true
  }
}

/** 缺依赖时给出跳过理由；装了返回 false（`test()` 认 `false` 为「不跳过」）。 */
export function skipWithout(name) {
  return dependencyMissing(name) ? `${name} 未安装（本仓约定不跑 npm install），依赖它的用例跳过` : false
}

let cachedCompile = null

/**
 * 现场编译 `scripts/local/*.cs` 能不能过。
 *
 * 只编译**不调用**：`Add-Type` 成功即说明工具链通，编译不出来就不是测试该管的事。
 * 结果缓存，五个测试文件共用一次探测。
 */
export function csharpCompileFailure() {
  if (cachedCompile !== null) return cachedCompile
  if (process.platform !== 'win32') {
    cachedCompile = '只在 Windows 上用 PowerShell 编译这些 .cs'
    return cachedCompile
  }
  const files = ['runtime-key.cs', 'snapshot.cs']
  for (const file of files) {
    if (!fs.existsSync(local(file))) {
      cachedCompile = `缺少 ${file}`
      return cachedCompile
    }
  }
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'"
  const sources = files.map((name) => `[IO.File]::ReadAllText(${quote(local(name))})`).join('+')
  const script = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition (${sources}); 'ok'`
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
  try {
    execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: 'pipe',
      timeout: 180_000,
    })
    cachedCompile = false
  } catch (error) {
    // 本机实测：杀毒软件拦截 Add-Type 时抛 IOException，编出来的 .cs 里带的是
    // “contains a virus or potentially unwanted software”。照原样引一句，别改写。
    const text = String(error?.stderr ?? error?.message ?? error)
    const blocked = /virus|potentially unwanted software|病毒/i.test(text)
    cachedCompile = blocked
      ? 'Add-Type 现场编译被本机杀毒软件拦截（"contains a virus or potentially unwanted software"），不是代码缺陷'
      : `Add-Type 现场编译失败：${text.split('\n')[0].trim()}`
  }
  return cachedCompile
}

let cachedRuntime = null

/**
 * 应用运行时不支持**内存数据库**吗。
 *
 * # 为什么需要这一类
 *
 * 上面两类（缺依赖、C# 被拦）之外还有第三类：`scripts/wechat.mjs` 的读库路径
 * 需要 `node:sqlite` 的 `DatabaseSync.serialize/deserialize` —— 那是
 * **Node 24.16.0** 才加的能力。本机 24.11.1 上两者都是 `undefined`，
 * CLI 会如实回 `{"ok":false,"status":"runtime_missing"}`。
 *
 * 探测的是**能力存不存在**，不是版本号：宿主可能跑 Electron 的 Node，
 * 版本号与能力不一定对得上。
 *
 * 不把这一条探出来，`profiles.test.mjs` 会因为子进程只回一个 `runtime_missing`
 * 而**以「JSON 解析失败」的假象失败** —— 那看起来像代码坏了，实际是环境不够。
 */
export function runtimeMissing() {
  if (cachedRuntime !== null) return cachedRuntime
  try {
    const { DatabaseSync } = require('node:sqlite')
    const probe = new DatabaseSync(':memory:')
    const ok = typeof probe.serialize === 'function' && typeof probe.deserialize === 'function'
    probe.close?.()
    cachedRuntime = ok ? false : '本机 Node 的 node:sqlite 没有 serialize/deserialize（需要 >= 24.16.0），读库用例跳过'
  } catch (error) {
    cachedRuntime = `node:sqlite 不可用（${error?.code ?? error?.message}），读库用例跳过`
  }
  return cachedRuntime
}
