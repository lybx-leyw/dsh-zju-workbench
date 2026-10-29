/**
 * 把 r4 内核里的跨包深引用改写成 core-quiz 的公开子路径。
 *
 * 为什么要有这一步：内核原先住在 `scripts/quiz_bench/experimental-r4/`，
 * 用相对路径深入 `packages/dsh-zhiyun-core-quiz/src/**` 取值，而那批文件
 * 一个都没出现在 core-quiz 的 `exports` 里。搬进 `packages/` 之后，
 * 跨包深引用既过不了打包，也会让依赖关系在图里隐形 —— 所以改成包名子路径，
 * 并把缺的 `exports` 一并补上（只新增导出，不改任何实现）。
 *
 * 单独成脚本而不是手改八个文件：改错一处只会在运行到那行时才炸，
 * 而这个脚本可以重复跑，且能立刻验证「没有残留的相对引用」。
 */
import {readFile, writeFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** 本脚本在 `scripts/`，内核在 `src/kernel/` —— 两者不同层。 */
const KERNEL = path.join(here, '..', 'src', 'kernel');

/** 相对路径 → 包名子路径。键是 `from '...'` 里出现过的原文。 */
const REWRITES = [
  ['../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/common.mjs', 'dsh-zhiyun-core-quiz/engines/r3-v9/common'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/tree.mjs', 'dsh-zhiyun-core-quiz/engines/r3-v9/tree'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/graph.mjs', 'dsh-zhiyun-core-quiz/engines/r3-v9/graph'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/tools.mjs', 'dsh-zhiyun-core-quiz/engines/r3-v9/tools'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/generator.mjs', 'dsh-zhiyun-core-quiz/engines/r3-v9/generator'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/scheduler.mjs', 'dsh-zhiyun-core-quiz/engines/r3-v9/scheduler'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/compiler.mjs', 'dsh-zhiyun-core-quiz/engines/r3-v9/compiler'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/concepts.js', 'dsh-zhiyun-core-quiz/concepts'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/strategies.js', 'dsh-zhiyun-core-quiz/strategies'],
  ['../../../packages/dsh-zhiyun-core-quiz/src/generate.js', 'dsh-zhiyun-core-quiz/generate'],
];

export async function rewriteKernelImports(directory = KERNEL) {
  const changed = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.mjs')) continue;
    const file = path.join(directory, name);
    const before = await readFile(file, 'utf8');
    let after = before;
    for (const [from, to] of REWRITES) after = after.split(from).join(to);
    if (after === before) continue;
    await writeFile(file, after);
    changed.push(name);
  }
  return changed;
}

/** 校验：内核里不得残留任何指向 `packages/` 的相对引用。 */
export async function assertNoRelativePackageRefs(directory = KERNEL) {
  const offenders = [];
  for (const name of await readdir(directory)) {
    if (!name.endsWith('.mjs')) continue;
    const source = await readFile(path.join(directory, name), 'utf8');
    if (/from\s+['"][^'"]*packages\/dsh-zhiyun-/.test(source)) offenders.push(name);
  }
  return offenders;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify({changed: await rewriteKernelImports(), offenders: await assertNoRelativePackageRefs()}, null, 2));
}
