/**
 * Publication guard.
 *
 * 这个守卫只管**发布身份会不会被误读**，不管包名里能不能出现 `zju` / `zhiyun`。
 *
 * # 为什么规则是「必须带 scope」而不是「不许出现机构名」
 *
 * 早先这里是四条正则（`/zju/i`、`/zw/i`、`/浙大/`、`/智云/`），理由是
 * 「机构名发到 npm 上会被读成官方发布」。那条理由**不成立**：
 *
 * - npm 的官方归属靠 **scope**，不靠名字里的词。`@lybx-leyw/dsh-zju-core-parser`
 *   的发布者显示为 `@lybx-leyw`，不会有人读成浙江大学的官方包；
 * - 反过来，`dsh-zju` 这种**无 scope** 的名字才是真危险 —— 它会被 npm 判为
 *   一个普遍命名空间下的无名包，任何人才都能抢注同名包，而 `zju` 二字
 *   摆在最前面恰恰最容易被误认为官方。
 *
 * 所以判据换成「发布时必须带 scope」，并且 `zju` / `zhiyun` 这类描述用途的词
 * 允许留在 scope 后面。这既守住了防混淆，也让「给学生用的」这件事留在名字里。
 *
 * # 三条硬要求
 *
 * 1. 可发布的包**必须带 scope**（`@owner/name`）；
 * 2. 必须声明 `license` 与 `repository`；
 * 3. 声明了 `dsh.bundle.patch` 的包，`files` 必须覆盖那个 patch 文件 ——
 *    否则 `npm pack` 打出来的 tarball 装得下、却永远加载不起来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Every package directory with a manifest, as `{ dir, manifest }`.
 *
 * The repo lays packages out flat (`packages/<name>`), with an optional grouping
 * level (`packages/<group>/<name>`) for bundles that want one. Both shapes are
 * scanned: assuming two levels silently skips every flat package, which is where
 * the publishable ones live.
 *
 * A manifest that cannot be parsed is a hard failure, not a skipped package: a
 * BOM or a syntax error would otherwise make a package invisible to this guard,
 * which is exactly the package most likely to be misconfigured.
 */
function packages() {
  const out = [];
  const broken = [];
  const readManifest = (dir, name) => {
    const manifestPath = path.join(dir, name, 'package.json');
    let raw;
    try { raw = readFileSync(manifestPath, 'utf8'); } catch { return false; }
    try {
      out.push({ dir: `${path.basename(dir)}/${name}`.replace(/^packages\//, ''), manifest: JSON.parse(raw) });
    } catch (error) {
      broken.push(`${name}: ${error.message}`);
    }
    return true;
  };

  const packagesRoot = path.join(root, 'packages');
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // Flat shape: packages/<name>/package.json
    if (readManifest(packagesRoot, entry.name)) continue;
    // Grouped shape: packages/<group>/<name>/package.json
    const groupDir = path.join(packagesRoot, entry.name);
    for (const child of readdirSync(groupDir, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      readManifest(groupDir, child.name);
    }
  }

  assert.deepEqual(broken, [], `以下 package.json 无法解析（会让守卫静默漏掉该包）：\n${broken.join('\n')}`);
  return out;
}

test('a publishable package must be scoped', () => {
  // scope 是 npm 上「这是谁发的」的唯一凭据。无 scope 的名字进公共命名空间后
  // 既可能被同名抢注，也无法表明与本项目的归属关系。
  const violations = [];
  for (const { dir, manifest } of packages()) {
    if (manifest.private === true) continue;
    const name = manifest.name ?? '';
    if (!name.startsWith('@') || !name.includes('/')) {
      violations.push(`${dir}: name "${name}" 没有 scope —— 发布前改成 @owner/name`);
    }
  }
  assert.deepEqual(violations, [], `发布身份不明确：\n${violations.join('\n')}`);
});

test('a publishable package declares a license and a repository', () => {
  const violations = [];
  for (const { dir, manifest } of packages()) {
    if (manifest.private === true) continue;
    if (typeof manifest.license !== 'string' || manifest.license.length === 0) {
      violations.push(`${dir}: missing "license"`);
    }
    if (manifest.repository === undefined) {
      violations.push(`${dir}: missing "repository"`);
    }
  }
  assert.deepEqual(violations, [], `发布元数据不完整：\n${violations.join('\n')}`);
});

test('a publishable package ships its bundle patch', () => {
  // Loader discovers a bundle through `dsh.bundle.patch`; a published tarball
  // that omits that file installs cleanly and then never loads. `npm pack`
  // honours `files`, so the patch must be listed there.
  const violations = [];
  for (const { dir, manifest } of packages()) {
    if (manifest.private === true) continue;
    const patch = manifest.dsh?.bundle?.patch;
    if (typeof patch !== 'string') continue;
    const files = manifest.files;
    if (!Array.isArray(files)) continue;
    const bare = patch.replace(/^\.\//, '');
    const covered = files.some((entry) => entry === bare || entry === patch
      || (entry.endsWith('/') && bare.startsWith(entry)));
    if (!covered) violations.push(`${dir}: dsh.bundle.patch "${patch}" is not covered by "files"`);
  }
  assert.deepEqual(violations, [], `发布产物会缺 patch 文件：\n${violations.join('\n')}`);
});

test('产品页走 DSH 原生槽，不再依赖第三方页面壳', async () => {
  // 2026-11：页面收窄到三页后，第三方页面壳 `@lybx-leyw/dsh-pages` 整体退役。
  // 页面改为成对注册 DSH 原生的两个槽（详见 ui-shared/src/page-native.jsx）：
  //   sidebar.panellist —— 导轨图标；main —— 中央面板，两者用同一个 id 关联。
  //
  // 这条守卫钉住「退役不会悄悄回潮」：任何一处把页面壳装回来，
  // 都会重新引入「在官方 main 旁边再建一套面板系统」的问题。
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  const readManifest = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
  const name = '@lybx-leyw/dsh-pages';

  // 1. 根 package.json 不再声明它。
  const rootManifest = readManifest('package.json');
  assert.equal(rootManifest.dependencies?.[name], undefined,
    `${name} 已退役，不应再出现在根依赖里`);

  // 2. profile 不再挂载它 —— 挂载了宿主就会加载第二个面板系统。
  const profile = readManifest('profiles/zju-workbench/package.json');
  assert.equal(profile.dsh.profile.bundles.includes(name), false,
    'profile 不应再挂载页面壳');

  // 3. `packages/` 下不再有页面壳目录，也没有包 vendor 一份源码。
  assert.equal(existsSync(path.join(root, 'packages', 'dsh-pages')), false,
    'packages/ 下不应有页面壳副本');
  const vendored = readdirSync(path.join(root, 'packages'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .filter(entry => existsSync(path.join(root, 'packages', entry.name, 'vendor', 'dsh-pages')));
  assert.deepEqual(vendored.map(entry => entry.name), [], '不应再有包 vendor 页面壳源码');

  // 4. 页面注册走原生槽：`registerPage()` 同时注册 sidebar.panellist 与 main。
  const native = readFileSync(
    path.join(root, 'packages/client/ui-shared/src/page-native.jsx'), 'utf8');
  assert.match(native, /name: 'sidebar\.panellist'/, '注册函数必须占用导轨图标槽');
  assert.match(native, /name: 'main'/, '注册函数必须占用中央面板槽');
});
