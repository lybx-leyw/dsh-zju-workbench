#!/usr/bin/env node
/**
 * `yonkik init`：记忆区不存在时，用内置初始记忆把它铺起来。
 *
 * # 为什么是「同级相对路径」而不是 npm 依赖
 *
 * 两个包是兄弟目录（`packages/yonkik/yonkik-tool` 与 `.../yonkik-init`）。
 * 记忆数据有 3 MB，跟着工具版本走会让工具包变臃肿；而把它写成 `dependencies`
 * 又要求它先被 npm 链接进 `node_modules` —— 本仓的 `packages/yonkik/*` **不在
 * workspaces 里**（见 `scripts/workspace-packages.mjs`），npm 不会链它。
 *
 * 所以按兄弟目录取。profile 装配时两个包各自被链进 profile 的 node_modules，
 * 但 Node 按 realpath 解析，工具里写裸包名会找不到 —— 相对路径没有这个问题。
 *
 * 用法：
 *   node init.mjs [--force] [--dry] [--root <dir>]
 *   无参数   = 记忆区没有内容时铺种子；有内容时**什么都不做**并如实说明
 *   --force  = 已有记忆也覆盖（危险）
 *   --dry    = 只报告会做什么
 *   --root   = 指定目标记忆区（默认 YONKIK_HOME 或 ~/.yonkik）
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sibling = path.resolve(here, '..', '..', 'yonkik-init', 'src', 'index.js');

let mod;
try {
  mod = await import(new URL('file://' + sibling.replace(/\\/g, '/')));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    action: 'yonkik:init',
    error: `找不到初始记忆包：${sibling}（${error?.code ?? error?.message}）`,
  }));
  process.exit(1);
}

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const dry = argv.includes('--dry');
const rootAt = argv.indexOf('--root');
const root = rootAt >= 0 && argv[rootAt + 1] ? path.resolve(argv[rootAt + 1]) : mod.memoryRoot();

const result = mod.seed({ root, force, dry });
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
