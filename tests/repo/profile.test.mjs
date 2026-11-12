import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { initialize, locateHost, root, lock, exists, hostArgs, sourceBundles, retiredBundles } from '../../scripts/profile.mjs';
import { ownPackages , vendorPackages } from '../../scripts/workspace-packages.mjs';
import { activePage, matchingPages, beijingDate, hiddenPageIds, pageBundle, visiblePages, NAV } from '../../packages/client/ui-shared/src/pages-model.js';

test('navigation preserves native conversation and ignores foreign panel ids', () => {
  // 原生会话面板不再是产品页：原生工作台已是页面壳的首页（`home`），
  // 所以导轨上不高亮任何产品页 —— 返回 null 而不是硬塞一个页 id。
  assert.equal(activePage(null), null);
  assert.equal(activePage('conversation'), null);
  assert.equal(activePage('zw.today'), 'today');
  assert.equal(activePage('other-plugin'), null);
  // 「规划」只命中真实存在的那一页：「问一问」已删除，不再参与搜索。
  assert.deepEqual(matchingPages('规划').map(page => page.id), ['planning']);
  assert.equal(matchingPages('未知页面').length, 0);
  assert.equal(NAV.some(page => page.id === 'ask'), false, '原生工作台不再是产品页');
});

test('被取消的页从侧栏与跳转里一起消失（两处必须同一份清单）', () => {
  // 原生工作台已不是产品页（它是页面壳的首页），所以这里不再有「永远在」的特例：
  // 每个 NAV 页都推导得出承载包。
  assert.equal(NAV.some(page => page.id === 'ask'), false);
  assert.equal(pageBundle('today'), '@lybx-leyw/dsh-zju-page-today');
  assert.equal(pageBundle('paper'), '@lybx-leyw/dsh-zju-page-paper');
  // 「题库」曾经是寄居在学习页里的一个 tab，`pageBundle` 给它开了特例把包名指到
  // `dsh-zju-page-study`。拆成独立包之后特例去掉 —— 这条断言就是那个特例的
  // 纪念碑：谁再把它改回指向学习页，这里立刻红（包被取消时藏页与跳转都靠这条）。
  assert.equal(pageBundle('quiz'), '@lybx-leyw/dsh-zju-page-quiz');

  // 论文页的包被取消。
  const enabled = new Map([['@lybx-leyw/dsh-zju-page-paper', false], ['@lybx-leyw/dsh-zju-page-today', true]]);
  const hidden = hiddenPageIds(enabled);
  assert.deepEqual([...hidden], ['paper']);
  const pages = visiblePages(hidden);
  assert.equal(pages.some(page => page.id === 'paper'), false, '侧栏不再列它');
  assert.equal(matchingPages('PDF', pages).length, 0, 'Ctrl+K 也不该跳到一个没有入口的页');
  assert.equal(matchingPages('PDF', NAV).length, 1, '未过滤时它照旧可搜 —— 说明过滤真的起了作用');
  assert.equal(pages.some(page => page.id === 'today'), true, '没被取消的页不受影响');

  // 读不到状态（宿主没装插件管理 / 读数失败）时一律当作还在：宁可多一个入口，
  // 也不能因为可选能力缺席把整个导航弄没。
  assert.deepEqual([...hiddenPageIds(new Map())], []);
  // 基数按「上侧栏的页」算 —— `sidebar: false` 的子页（看课）本来就不该列在侧栏，
  // 它不参与这条断言。用 NAV.length 会比出「少一个」，那是把两件事混在了一起。
  const sidebarPages = NAV.filter(page => page.sidebar !== false);
  assert.equal(visiblePages(hiddenPageIds(new Map())).length, sidebarPages.length);
});

test('「我的课」「看课」已并入「学习」：导航只剩一个入口，两个页面包不再被访问', () => {
  // ⚠️ 这条钉的是**合并**而不是删除功能：回放与课程目录都还在，只是住进了「学习」页
  //    （`zws-content-switch` 的「视频」栏 + 左栏课程目录）。留在这里的守卫是：
  //    NAV 里不许再出现 courses / player 两个 id —— 它们对应的 bundle 已经删了，
  //    留着 id 会让 `navigate()` 把一个没人承载的面板切出来（空白页）。
  assert.equal(NAV.some(page => page.id === 'courses'), false, '「我的课」不再是独立页');
  assert.equal(NAV.some(page => page.id === 'player'), false, '「看课」不再是独立页');
  assert.equal(NAV.some(page => page.id === 'study'), true, '合并后的落点是「学习」');
  // 承载页面的包名由 id 推导，所以这两个名字也就不该再有包：`sourceBundles` 是从
  // `packages/` 目录读出来的，目录没了它就自然消失。这条防的是「目录删了、清单没删」。
  assert.equal(sourceBundles.includes('dsh-zhiyun-page-courses'), false);
  assert.equal(sourceBundles.includes('dsh-zhiyun-page-player'), false);
  // 而「学习」页自己要还在清单里 —— 上面两条若因为删错目录而通过，这条会红。
  assert.equal(sourceBundles.includes('@lybx-leyw/dsh-zju-page-study'), true);
  // 老 profile 里可能还留着这两个名字：Loader 解不开那一行，整个 profile 起不来。
  // 所以它们必须登记在 `retiredBundles` 里，初始化时被清掉（下面那条用例会实测）。
  assert.ok(retiredBundles.includes('dsh-zhiyun-page-courses'));
  assert.ok(retiredBundles.includes('dsh-zhiyun-page-player'));
});

test('activePage 只认还在的页：被取消的页不再算作当前页', () => {
  const pages = visiblePages(hiddenPageIds(new Map([['@lybx-leyw/dsh-zju-page-paper', false]])));
  assert.equal(activePage('zw.paper', pages), null, '取消后它不是一个可停留的页');
  assert.equal(activePage('zw.paper', NAV), 'paper', '未过滤时照旧');
  assert.equal(activePage('zw.today', pages), 'today');
});
test('date uses Beijing midnight even when machine timezone differs', () => {
  assert.match(beijingDate(new Date('2026-10-06T16:01:00Z')), /10月7日/);
});
test('profile initialization is isolated, repeatable, and preserves user data and overlays', async () => {
  const parent = path.join(root, '.runtime', 'tests');
  await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, 'profile-'));
  const first = await initialize({ home });
  const patch = path.join(first.profile, 'cordis.patch.yml');
  // 本仓 bundle 的配置层（`- id: dsh-pages` 那段）由模板合并进 live patch，
  // 用户自己写的那一段原样保留 —— 所以期望是「用户段 + 本仓段」，不是原样不动。
  const custom = '# user overlay\n[]\n';
  // 本仓段：取模板里**条目部分**（第一个 `- id:` 起），不含开头的说明注释。
  //
  // `initialize()` 只合并 YAML 条目，不抄模板顶部那段注释 —— 期望值若用整篇
  // 模板去比，差的就是那 18 行注释（本节因此红过两轮，最后靠逐字符对比才定位）。
  const templateBody = (await readFile(path.join(root, 'profiles', lock.profile, 'cordis.patch.yml'), 'utf8'))
    .replace(/\r\n/g, '\n');
  const firstEntry = templateBody.indexOf('- id:');
  const expectedPatch = custom + templateBody.slice(firstEntry).trimEnd() + '\n';
  await writeFile(patch, custom);
  await writeFile(path.join(home, 'user-note.txt'), 'keep my notes');
  const manifest = path.join(first.profile, 'package.json');
  const data = JSON.parse(await readFile(manifest, 'utf8'));
  data.description = 'user customization';
  await writeFile(manifest, JSON.stringify(data));
  await initialize({ home });
  assert.equal(await readFile(patch, 'utf8'), expectedPatch, '用户覆盖与本仓配置层共存');
  assert.equal(await readFile(path.join(home, 'user-note.txt'), 'utf8'), 'keep my notes');
  assert.equal(JSON.parse(await readFile(manifest, 'utf8')).description, 'user customization');
  // 抽一个**当前真在 profile 里**的本仓包，验证它的目录链接指向真实源码。
  //
  // ⚠️ 这里原来写死 `dsh-zju-shell-workbench` —— 那个包早已不在 profile 里
  //    （Step 1 瘦身 + 本轮归档）。它以前之所以没红，只是因为**包目录还在仓库里**，
  //    `realpath` 能解析到源码；`shell-workbench` 一移进 `archive/` 就暴露了。
  //    写死具体包名的断言，会在「包退役」时给出与主题无关的失败。
  const sampleBundle = JSON.parse(await readFile(path.join(root, 'profiles', lock.profile, 'package.json'), 'utf8'))
    .dsh.profile.bundles.find(name => name.startsWith('@lybx-leyw/dsh-zju-source-'));
  const samplePkg = (await ownPackages(path.join(root, 'packages'))).find(entry => entry.manifest.name === sampleBundle);
  assert.ok(samplePkg !== undefined, `找不到样例包 ${sampleBundle} 的目录`);
  assert.equal(
    await realpath(path.join(first.profile, 'node_modules', sampleBundle)),
    await realpath(samplePkg.path),
  );
  // 这份清单是 profile 的**期望形态**：新增本仓 bundle 时要在这里补一项。
  // 下面那条循环（`sourceBundles`）保证每个包都有目录链接，但「清单里有没有它」
  // 只能靠这份逐字期望 —— 漏写不会报错，会让 profile 少挂一个包。
  assert.deepEqual(data.dsh.profile.bundles, JSON.parse(await readFile(path.join(root, 'profiles', lock.profile, 'package.json'), 'utf8')).dsh.profile.bundles,
    'profile 的 bundles 必须与模板逐项一致（新增本仓 bundle 只改模板，不必再改这里）');
  // 每个本仓包都要有 profile 里的目录链接 —— 漏一个的表现是「启动了但那一页空白」。
  // 包目录既可能平铺也可能在分组目录下（`packages/client/pages-default/`），
  // 所以按 manifest.name 反查真实目录，不拼路径。
  for (const { manifest, path: dir } of await ownPackages(path.join(root, 'packages'))) {
    const name = manifest.name;
    assert.equal(await realpath(path.join(first.profile, 'node_modules', name)), await realpath(dir), `${name} 缺 profile 链接`);
  }
});
test('existing profiles add the bridge once without altering user bundles or overlays', async t => {
  const parent = path.join(root, '.runtime', 'tests');
  await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, 'bridge-upgrade-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const runtime = await initialize({ home });
  const file = path.join(runtime.profile, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== '@lybx-leyw/dsh-zju-source-cc98');
  manifest.dsh.profile.bundles.push('user-owned-plugin');
  manifest.custom = { keep: true };
  await writeFile(file, JSON.stringify(manifest));
  const patch = path.join(runtime.profile, 'cordis.patch.yml');
  const userPatch = '# user bridge overrides\n[]\n';
  await writeFile(patch, userPatch);
  await initialize({ home });
  await initialize({ home });
  const upgraded = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(upgraded.dsh.profile.bundles, [...manifest.dsh.profile.bundles, '@lybx-leyw/dsh-zju-source-cc98']);
  assert.deepEqual(upgraded.custom, manifest.custom);
  // 用户段不动，本仓配置层被合并进来（且重复初始化不会叠第二份）。
  const merged = await readFile(patch, 'utf8');
  assert.ok(merged.startsWith(userPatch), '用户覆盖必须原样保留在最前');
  assert.equal(merged.split('- id: dsh-pages').length - 1, 1, '本仓配置层只应出现一次');
  // 补回来的包必须有指向真实目录的链接。
  // ⚠️ 不能拼 `packages/<包名>`：包可能住在分组目录（`packages/source/<目录>`），
  //    而目录名不等于包名。按 manifest.name 反查才是唯一稳的写法。
  const restored = (await ownPackages(path.join(root, 'packages')))
    .find(entry => entry.manifest.name === '@lybx-leyw/dsh-zju-source-cc98');
  assert.ok(restored, 'source-cc98 应当能按 manifest.name 反查到目录');
  assert.equal(
    await realpath(path.join(runtime.profile, 'node_modules', '@lybx-leyw/dsh-zju-source-cc98')),
    await realpath(restored.path),
  );
});

test('foreign profile is refused without overwriting its manifest', async () => {
  const parent = path.join(root, '.runtime', 'tests');
  await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, 'foreign-'));
  const dir = path.join(home, 'profiles', lock.profile);
  await mkdir(dir, { recursive: true });
  const original = '{"name":"someone-elses-profile"}';
  await writeFile(path.join(dir, 'package.json'), original);
  await assert.rejects(initialize({ home }), /不属于智云/);
  assert.equal(await readFile(path.join(dir, 'package.json'), 'utf8'), original);
});
test('existing product profile upgrades the parser bundle while preserving overlays', async () => {
  const parent = path.join(root, '.runtime', 'tests'); await mkdir(parent,{recursive:true});
  // 样例取模板里的**最后五个**本仓 bundle：它们一定存在，且「追加到末尾」的语义最直观。
  // 从模板读而不是写死名字 —— 写死的话每次增删 bundle 都要回来修这条测试（已经发生过两次）。
  const templateBundles = JSON.parse(await readFile(path.join(root, 'profiles', lock.profile, 'package.json'), 'utf8')).dsh.profile.bundles;
  const sampleBundles = templateBundles.slice(-5);
  const home = await mkdtemp(path.join(parent,'parser-upgrade-')); const runtime = await initialize({home});
  const file = path.join(runtime.profile,'package.json'), manifest = JSON.parse(await readFile(file,'utf8'));
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(b => !sampleBundles.includes(b)); manifest.custom = {preserved:true};
  const overlay = path.join(runtime.profile,'cordis.patch.yml'); await writeFile(overlay,'# preserve my routes\n[]\n');
  await writeFile(file,JSON.stringify(manifest)); await initialize({home});
  const upgraded = JSON.parse(await readFile(file,'utf8')); assert.deepEqual(upgraded.custom,manifest.custom);
  assert.deepEqual(upgraded.dsh.profile.bundles, [...manifest.dsh.profile.bundles, ...sampleBundles],
    '被移除的 bundle 要按模板顺序补回来');
  // 用户段保留，本仓配置层合并进来。
  assert.ok((await readFile(overlay,'utf8')).startsWith('# preserve my routes\n[]\n'));
  // 每个补回来的 bundle 都要有指向真实目录的链接。
  //
  // ⚠️ 这里原先写死 `@lybx-leyw/dsh-zju-core-parser` / `-lecture` 两个包名**加**
  //    路径（`packages/<包名>`）。两处都会随重构失效：
  //      - 包改名（`core-*` → `@lybx-leyw/dsh-zju-core-*`）；
  //      - 目录进分组（`packages/core/lecture`），目录名 ≠ 包名。
  //    改成用上面已经动态取的 `sampleBundles`，并按 manifest.name 反查目录。
  //
  // ⚠️ 反查**不能只用 ownPackages()**：它刻意排除隔离区（`packages/vendor/`），
  //    而 vendor 的包同样会出现在 `sampleBundles` 里（它们确实要装配）。
  //    只查一边会让「取到 vendor 包」的那次运行红掉 —— 而红的原因是**扫描范围**
  //    而不是链接错了。
  const byName = new Map([
    ...(await ownPackages(path.join(root, 'packages'))).map(p => [p.manifest.name, p.path]),
    ...(await vendorPackages(path.join(root, 'packages'))).map(p => [p.manifest.name, p.path]),
  ]);
  for (const name of sampleBundles) {
    const dir = byName.get(name);
    assert.ok(dir !== undefined, `${name} 应当能按 manifest.name 反查到目录（含 vendor 区）`);
    assert.equal(await realpath(path.join(runtime.profile, 'node_modules', name)), await realpath(dir));
  }
});

test('existing product profile adds the source bundle without replacing user settings', async () => {
  const parent = path.join(root, '.runtime', 'tests'); await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, 'upgrade-')); const runtime = await initialize({ home });
  const file = path.join(runtime.profile, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  // 从模板里挑一个真实存在的 bundle 当作「老 profile 缺的那一条」。
  const templateBundles = JSON.parse(await readFile(path.join(root, 'profiles', lock.profile, 'package.json'), 'utf8')).dsh.profile.bundles;
  const missingBundle = templateBundles[templateBundles.length - 1];
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(b => b !== missingBundle);
  manifest.dsh.profile.bundles.push('my-custom-plugin'); manifest.description = 'keep custom description';
  await writeFile(file, JSON.stringify(manifest));
  const patch = path.join(runtime.profile, 'cordis.patch.yml'); await writeFile(patch, '# custom overrides\n[]\n');
  await initialize({ home });
  const actual = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(actual.description, 'keep custom description');
  assert.deepEqual(actual.dsh.profile.bundles, [...manifest.dsh.profile.bundles, missingBundle]);
  // 用户段保留，本仓配置层合并进来。
  assert.ok((await readFile(patch, 'utf8')).startsWith('# custom overrides\n[]\n'));
});
test('改名/拆包后，profile 里指向已不存在的本仓包会被移除', async () => {
  // ⚠️ 这条钉的是拆包真机踩过的坑：`dsh-zhiyun-pro-ui` 改名成 `dsh-zju-shell-workbench` 之后，
  //    老 profile 里仍留着旧名 —— Loader 解不开那一行，整个 profile 起不来。
  //    只清 `retiredBundles` 登记表里的旧名，不做前缀猜测：同前缀但没登记的条目
  //    可能来自别的分支或用户自己链进来的包。
  const parent = path.join(root, '.runtime', 'tests'); await mkdir(parent, { recursive: true });
  const home = await mkdtemp(path.join(parent, 'rename-'));
  const runtime = await initialize({ home });
  const file = path.join(runtime.profile, 'package.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  // 取模板里真实存在的两个包当「被误删、应当补回来」的样例。
  // ⚠️ 不要写死名字：`@lybx-leyw/dsh-zju-core-study` 曾经在 profile 里，瘦身之后就不在了 ——
  //    写死的后果是「移除后补不回来」，而失败信息只会说「新包要被补上」，看不出是样例过期。
  const templateBundles = JSON.parse(await readFile(path.join(root, 'profiles', lock.profile, 'package.json'), 'utf8')).dsh.profile.bundles;
  const [keepA, keepB] = templateBundles.slice(-2);
  manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(b => ![keepA, keepB].includes(b));
  manifest.dsh.profile.bundles.splice(2, 0, 'dsh-zhiyun-pro-ui', 'dsh-zhiyun-study');
  manifest.dsh.profile.bundles.push('my-custom-plugin', 'dsh-zhiyun-not-ours');
  await writeFile(file, JSON.stringify(manifest));
  await initialize({ home });
  const actual = JSON.parse(await readFile(file, 'utf8')).dsh.profile.bundles;
  assert.ok(!actual.includes('dsh-zhiyun-pro-ui'), '旧名必须被移除');
  assert.ok(!actual.includes('dsh-zhiyun-study'), '旧名必须被移除');
  assert.ok(actual.includes(keepA), `${keepA} 应当被补上`);
  assert.ok(actual.includes(keepB), `${keepB} 应当被补上`);
  assert.ok(actual.includes('my-custom-plugin'), '用户自己的插件不许动');
  assert.ok(actual.includes('dsh-zhiyun-not-ours'), '不认识的本仓前缀条目也不许动（可能来自别的分支）');
});

test('unsupported host version fails with an actionable error', async () => {
  const parent = path.join(root, '.runtime', 'tests');
  await mkdir(parent, { recursive: true });
  const app = await mkdtemp(path.join(parent, 'wrong-host-'));
  const dir = path.join(app, 'node_modules', '@deepseek-ai', 'dsh');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'package.json'), '{"version":"0.9.0"}');
  await assert.rejects(locateHost({ ZW_DSH_APP_DIR: app }), /不能混用版本/);
});

test('本机已安装版本不受支持时，回退到仓库内已验证的临时安装', async (t) => {
  const parent = path.join(root, '.runtime', 'tests');
  await mkdir(parent, { recursive: true });
  const fallback = path.join(root, '.runtime', `dsh-${lock.preferredHostVersion}`);
  if (!await exists(fallback)) return t.skip(`本机没有 ${fallback}，无法验证回退`);
  // 装一个「不受支持的本机 DSH Desktop」：回退只能落在清单内的版本上，不能拿它凑合。
  const local = await mkdtemp(path.join(parent, 'localappdata-'));
  const app = path.join(local, 'Programs', 'DSH Desktop', 'resources', 'app');
  await mkdir(path.join(app, 'node_modules', '@deepseek-ai', 'dsh'), { recursive: true });
  await writeFile(path.join(app, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), '{"version":"0.1.5-rc.2"}');
  const host = await locateHost({ LOCALAPPDATA: local });
  assert.equal(host.version, lock.preferredHostVersion, '回退应落在首选版本上');
  assert.match(host.app, /[\\/]\.runtime[\\/]dsh-/);
});

test('宿主换版本时改指链接，但用户自己的实体目录不覆盖', async (t) => {
  const parent = path.join(root, '.runtime', 'tests');
  await mkdir(parent, { recursive: true });
  const [first, second] = lock.hostVersions.map(version => path.join(root, '.runtime', `dsh-${version}`));
  if (!await exists(first) || !await exists(second)) return t.skip('本机没有两份临时安装，无法验证换宿主');
  const home = await mkdtemp(path.join(parent, 'switch-'));
  assert.equal((await initialize({ home, env: { ZW_DSH_APP_DIR: first } })).version, lock.hostVersions[0]);
  const switched = await initialize({ home, env: { ZW_DSH_APP_DIR: second } });
  assert.equal(switched.version, lock.hostVersions[1]);
  assert.ok(switched.repointed.includes('@deepseek-ai'), '换宿主应改指宿主链接');
  // 把那条链接换成用户自己放的实体目录 → 一律不覆盖，直接报错。
  const link = path.join(home, 'profiles', lock.profile, 'node_modules', '@deepseek-ai');
  await rm(link, { recursive: true, force: true });
  await mkdir(link, { recursive: true });
  await assert.rejects(initialize({ home, env: { ZW_DSH_APP_DIR: first } }), /未覆盖/);
});
test('启动参数里同名参数只出现一次（显式 --port 优先，不再拼出两个）', () => {
  // ⚠️ 这条钉的是一个真机上踩过的坑：`npm start -- --port 3081` 曾拼出
  //    `--port 3091 --no-open --port 3081`，宿主取前一个 3091 —— 用户以为
  //    起在 3081，实际听 3091（常被别的实例占着），表现为「启动了却打不开」。
  const countPorts = args => args.filter(a => a === '--port' || a.startsWith('--port=')).length;
  const countNoOpen = args => args.filter(a => a === '--no-open').length;

  assert.deepEqual(hostArgs(['--port', '3081'], undefined), ['--no-open', '--port', '3081']);
  assert.equal(countPorts(hostArgs(['--port', '3081'], undefined)), 1, '显式 --port 不许再补一个');
  assert.equal(countPorts(hostArgs(['--port=3081'], '3091')), 1);
  assert.deepEqual(hostArgs([], '3081'), ['--no-open', '--port', '3081'], 'ZW_PORT 生效');
  assert.deepEqual(hostArgs([], undefined), ['--no-open', '--port', '3091'], '都没给时用默认端口');
  // 调用方自己写了 --no-open 时不许再补一个（实测命令行里出现过两个）。
  assert.equal(countNoOpen(hostArgs(['--no-open', '--port', '3081'], undefined)), 1);
  assert.deepEqual(hostArgs(['--no-open', '--port', '3081'], undefined), ['--no-open', '--port', '3081']);
  // 额外参数原样带上，且位置在端口之后。
  assert.deepEqual(hostArgs(['--verbose'], '3081'), ['--no-open', '--port', '3081', '--verbose']);
});


test('旧前缀的数据目录在启动时搬到新名，已有的新目录不会被合并覆盖', async () => {
  // 数据目录里装的是 DPAPI 会话、课件缓存、笔记库这类**不可重建**的东西。
  // 改名只动了代码里的路径常量；磁盘上的目录若还叫旧名，用户看到的就是
  // 「升级后全部得像第一次用一样重来一遍」，而旧数据仍占着几百 MB 没人知道。
  const { mkdir: make, writeFile: put, readdir: list } = await import('node:fs/promises');
  const parent = await mkdtemp(path.join(root, '.runtime', 'data-move-'));
  const home = path.join(parent, 'home');
  const dataDir = path.join(home, 'profiles', lock.profile, 'data');
  await make(path.join(dataDir, 'zhiyun-classroom', 'slides'), { recursive: true });
  await put(path.join(dataDir, 'zhiyun-classroom', 'slides', '1.jpg'), 'bytes');
  await make(path.join(dataDir, 'zhiyun-study'), { recursive: true });
  await put(path.join(dataDir, 'zhiyun-study', 'session.json'), '{}');
  // 用户自己放的目录：名字不在登记表里，一个字节都不许碰。
  await make(path.join(dataDir, 'my-own-notes'), { recursive: true });
  // 已经存在的新目录：绝不与旧目录合并（两代数据混成一份比没搬更糟）。
  await make(path.join(dataDir, 'zw-pta'), { recursive: true });
  await put(path.join(dataDir, 'zw-pta', 'new.json'), '{"new":true}');
  await make(path.join(dataDir, 'zhiyun-pta'), { recursive: true });
  await put(path.join(dataDir, 'zhiyun-pta', 'old.json'), '{"old":true}');

  const runtime = await initialize({ home });
  assert.deepEqual(
    runtime.movedData.map(([before]) => before).sort(),
    ['zhiyun-classroom', 'zhiyun-study'],
    '只搬两个没撞名的',
  );
  const after = (await list(dataDir)).sort();
  assert.ok(after.includes('zw-classroom'), '课件缓存要跟着改名');
  assert.ok(!after.includes('zhiyun-classroom'), '旧名不该留下');
  assert.equal(await readFile(path.join(dataDir, 'zw-classroom', 'slides', '1.jpg'), 'utf8'), 'bytes', '内容原样搬过去');
  assert.ok(after.includes('my-own-notes'), '没登记过的目录不动');
  assert.ok(after.includes('zhiyun-pta'), '撞名时旧目录原样留着，由人判断');
  assert.equal(await readFile(path.join(dataDir, 'zw-pta', 'new.json'), 'utf8'), '{"new":true}', '新目录不被旧数据覆盖');

  // 重跑一次必须是空操作（幂等）：这次没有可搬的。
  assert.deepEqual((await initialize({ home })).movedData, []);
  await rm(parent, { recursive: true, force: true });
});
