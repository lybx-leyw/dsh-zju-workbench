/**
 * 断言某包的客户端产物存在且比源码新。
 *
 * # 为什么抽成共享 helper
 *
 * 这段逻辑原先在 5 个测试文件里各抄了一份（paper-drawer-scroll / paper-tree-actions /
 * paper-tree-collapse / paper-tree-keys / paper-upload）。抄 5 份的代价在这次迁移里
 * 立刻显形：包名一改，5 处都要改，漏一处就是「包没有构建产物」这种指向错误的失败。
 *
 * # 为什么不能按包名拼路径
 *
 * 原实现是 `packages/<包名>/lib/client.js`。重构后包住在分组目录里
 * （`packages/client/page-paper`），目录名 ≠ 包名，拼路径必然 ENOENT。
 * 改成按 `manifest.name` 反查真实目录 —— 与 `ownPackages()` 同一套判据。
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownPackages } from '../../scripts/workspace-packages.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * @param packageName - **包名**（`@lybx-leyw/dsh-zju-page-paper`），不是目录名。
 * @param sourceFiles - 相对 `src/` 的文件名，用于检查产物是否比它们新。
 */
export async function assertBundleFresh(packageName, sourceFiles = []) {
  const entry = (await ownPackages(path.join(root, 'packages')))
    .find(candidate => candidate.manifest.name === packageName);
  if (entry === undefined) {
    throw new Error(`找不到包 ${packageName} —— 检查包名是否已改，或它是否被归档`);
  }

  const bundle = path.join(entry.path, 'lib', 'client.js');
  if (!existsSync(bundle)) {
    throw new Error(`${packageName} 没有构建产物，先跑 npm run build`);
  }

  const bundleAt = statSync(bundle).mtimeMs;
  for (const rel of sourceFiles) {
    const file = path.join(entry.path, 'src', rel);
    if (!existsSync(file)) continue;
    if (bundleAt < statSync(file).mtimeMs) {
      throw new Error(
        `${packageName}/src/${rel} 比构建产物新 —— 产物是旧的，这段测试会假通过。先跑 npm run build`,
      );
    }
  }
}
