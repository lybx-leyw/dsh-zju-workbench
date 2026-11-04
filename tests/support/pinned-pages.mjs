/**
 * 定位本仓锁版本依赖 `@lybx-leyw/dsh-pages` 的安装目录。
 *
 * 页面壳已不再 vendor 到本仓：源码与产物都在根 `node_modules` 里，由
 * 根 package.json 用**精确版本**锁定（见 `PINNED_PAGES_VERSION`）。测试需要
 * 直接引用它内部的若干模块（`state` / `pages-service` / `preferences`），
 * 但**不**通过包说明符 —— 那样只会走 `exports` 暴露的公共面。这里按文件路径
 * 引用，等于对着「安装下来的那份产物」做集成验证；它不构成对外 API 承诺。
 *
 * 为什么要断言版本：升级依赖时测试会明确失败一次，提醒改这里与根
 * package.json，而不是让测试对着一个悄悄变了的实现继续变绿。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PINNED_PAGES_VERSION = '0.1.3';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
export const pagesPackageRoot = path.join(repoRoot, 'node_modules', '@lybx-leyw', 'dsh-pages');

const manifest = JSON.parse(readFileSync(path.join(pagesPackageRoot, 'package.json'), 'utf8'));
if (manifest.name !== '@lybx-leyw/dsh-pages') {
  throw new Error(`node_modules 里不是 @lybx-leyw/dsh-pages：${manifest.name}`);
}
if (manifest.version !== PINNED_PAGES_VERSION) {
  throw new Error(`@lybx-leyw/dsh-pages 版本为 ${manifest.version}，测试锁定的是 ${PINNED_PAGES_VERSION}；升级时请同步本文件与根 package.json。`);
}

/** 按文件路径引用已安装包内的一个模块。 */
export function pagesModule(relative) {
  return import(pathToFileURL(path.join(pagesPackageRoot, relative)).href);
}

/** 同一个模块的绝对路径，供 esbuild 入口使用。 */
export function pagesFile(relative) {
  return path.join(pagesPackageRoot, relative);
}
