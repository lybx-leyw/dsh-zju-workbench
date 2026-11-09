/**
 * 发到 npm 前把仓库的 core/ 拷进本包的 core/：包里不能带 ../core，引擎侧照 host/core.mjs 先找包里的这一份。
 * 开发时不跑它：用链接装进 profile 时本包就是仓库里的 plugin/，core 在旁边，依赖也是仓库里 npm 装好的那一份。
 * 只拷插件用得到的：校园命令（zju）、公众号（weread）、两个聊天的读取器和它们共用的 chat、课程讲解（learn，不带配音）、
 * 技能里链到的工作流（skills）和初始化（initialize）。不拷 node_modules、测试和开发用的东西；第三方依赖写在 package.json 的 dependencies，
 * 装插件时由包管理器装好，core 的代码往上找得到。讲解引擎自带的 engine/vendor/node_modules 也不拷：gsap 和 three 解开有 30 MB，
 * 「课程讲解」打开时才下载（host/learn.mjs），esbuild 由 dependencies 装 esbuild-wasm（没有安装脚本，pnpm 不会拦）。
 * 用法：node plugin/pack-core.mjs（prepack 跑），node plugin/pack-core.mjs --clean（postpack 跑，删掉拷进来的）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyPublicTree } from '../scripts/private-paths.cjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = path.join(here, '..', 'core'), target = path.join(here, 'core')

/** 每一份拷哪些；路径相对 core/。 */
const PARTS = [
  'zju/SKILL.md', 'zju/package.json', 'zju/lib', 'zju/scripts', 'zju/references',
  'weread/SKILL.md', 'weread/package.json', 'weread/THIRD_PARTY_NOTICES.txt', 'weread/LICENSE-Tencent', 'weread/lib', 'weread/scripts', 'weread/references',
  'wechat/SKILL.md', 'wechat/package.json', 'wechat/THIRD_PARTY_NOTICES.txt', 'wechat/lib', 'wechat/scripts', 'wechat/references',
  'dingtalk/SKILL.md', 'dingtalk/package.json', 'dingtalk/lib', 'dingtalk/scripts', 'dingtalk/references',
  'chat/common.mjs',
  'learn/SKILL.md', 'learn/references', 'learn/engine', 'learn/tools/prep',
  'skills/course-selection', 'skills/course-study', 'skills/exam-prep', 'skills/homework-submit', 'skills/my-week',
  'initialize',
]
const copy = (from, to) => copyPublicTree(from, to, source)

fs.rmSync(target, { recursive: true, force: true })
if (!process.argv.includes('--clean')) {
  for (const part of PARTS) copy(path.join(source, part), path.join(target, part))
  console.log(`core 已拷到 ${target}`)
}
