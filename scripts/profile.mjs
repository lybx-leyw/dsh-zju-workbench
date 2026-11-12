import { mkdir, readFile, writeFile, access, symlink, realpath, rename, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ownPackageDirs, ownPackageNames, ownPackages } from './workspace-packages.mjs';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const lock = JSON.parse(await readFile(new URL('../runtime.lock.json', import.meta.url), 'utf8'));
/**
 * 本仓自有的 bundle = `packages/` 下带 manifest、且不属于隔离区的包。
 *
 * 判据是**位置**而不是名字前缀（见 `workspace-packages.mjs`）：包名不再必须以
 * `dsh-zju-` 开头，`dsh-radar-*` 则始终排除。profile 的目录链接表、产品升级
 * 白名单、客户端构建产物检查都从这一份推导 —— 加包只需要建目录。
 *
 * 值是**包名**（manifest.name），不是目录名：profile 的 `bundles` 与宿主在
 * `node_modules` 里的解析都只认 npm 包名，目录名仅在仓库内部使用
 * （例如 `packages/client/pages-default/` → `@lybx-leyw/dsh-zju-pages-default`）。
 */
export const sourceBundles = await (async () => {
  const names = [];
  for (const dir of await ownPackageDirs(path.join(root, 'packages'))) {
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    names.push(manifest.name);
  }
  return names.sort();
})();
/**
 * 本仓**发布过但已不再提供**的包名（旧名登记表）。
 *
 * 改名/拆包时把旧名加进来：老 profile 里留着旧名的话 Loader 解不开那一行，
 * 整个 profile 起不来（拆包真机上踩过）。这里刻意**不用前缀猜测**：
 * 同前缀但没登记的条目可能来自别的分支或用户自己链进来的包，一律不动。
 */
export const retiredBundles = ['dsh-pages', 'dsh-zhiyun-pro-ui', 'dsh-zhiyun-study', 'dsh-zhiyun-page-courses', 'dsh-zhiyun-page-player',
  // 「个人」页整包删除：它的两块内容各自有了归属 —— 登录对话框与「账号与数据」
  // 设置分区进了 `dsh-zhiyun-settings-account`。老 profile 里还挂着这一行的话
  // Loader 解不开，整个 profile 起不来。
  'dsh-zhiyun-page-me',
  // 「无曰终审」整包删除（自由发挥那一步被并入习坎的全文润色）。
  // 老 profile 里还挂着这一行的话 Loader 解不开，整个 profile 起不来。
  'dsh-zhiyun-core-final-pass',
  // 共享 UI 原语改名并移入 `packages/client/ui-shared/`：
  // `dsh-zhiyun-shell-ui` → `@lybx-leyw/dsh-zju-ui-shared`。老 profile 里留着旧名时
  // Loader 解析不到该 bundle，整个 profile 起不来；`profile:init` 会按这张表清掉它，
  // 再补上新名（新名从 profile 模板的 bundles 里来）。
  'dsh-zhiyun-shell-ui',
  // 校园数据包按平台拆开：`source/campus`（学在浙大 + 拼题A 混装）
  // → `source/xuezai`（学在浙大）+ `source/pta`（拼题A）。
  // 老 profile 里还挂着 campus 的话 Loader 解不开，整个 profile 起不来。
  '@lybx-leyw/dsh-zju-source-campus'];
export async function exists(file) { try { await access(file); return true; } catch { return false; } }

/**
 * 断言宿主的**客户端内核**（`ui-slots` / `ui-primitives` / `client-store`）可用。
 *
 * # 它们在哪一层（0.2.2-rc.1 实测）
 *
 * 这三个模块**不再是独立 npm 包**，而是打包进前端产物：
 * `@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`。
 *
 * 我们的客户端 bundle 仍然按模块名 `require` 它们（构建期 external），
 * 由宿主前端的模块表在运行时解析 —— 所以**客户端代码不需要改**，
 * 但「装没装好」的判断必须换成查 dist。
 *
 * 查 node_modules 会得到「找不到宿主」的误报；而新版宿主确实没有那个包。
 *
 * @param modules - 宿主的 `node_modules` 绝对路径。
 * @param version - 宿主版本（报错信息用）。
 */
async function assertClientKernel(modules, version) {
  const distDir = path.join(modules, '@deepseek-ai', 'dsh-web-frontend', 'dist');
  if (!await exists(distDir)) {
    throw new Error(
      `宿主 ${version} 缺少 @deepseek-ai/dsh-web-frontend/dist —— `
      + '客户端内核模块（ui-slots / ui-primitives / client-store）由它提供，'
      + '缺了这个目录，所有客户端插件都会在运行时找不到模块。这个安装目录不完整。',
    );
  }
  // dist 里必须真的有打包产物：空目录等于「装了但没构建」，比没装更难查。
  const assets = path.join(distDir, 'assets');
  const files = await readdir(assets).catch(() => []);
  if (!files.some(name => name.endsWith('.js'))) {
    throw new Error(`宿主 ${version} 的 dsh-web-frontend/dist/assets 里没有 .js 产物 —— 前端未构建完整。`);
  }
}

/**
 * 哪些 bundle 来自 npm 依赖、不参与本仓链接与客户端构建。
 *
 * `@lybx-leyw/dsh-pages` 是锁版本的发布包（根 package.json 精确版本），
 * 源码与产物都在安装好的 node_modules 里，本仓既不再保留 vendor 副本，
 * 也不为它生成 profile 目录链接 —— profile 需要的链接由
 * {@link externalBundles} 里的包名从 node_modules 解析。
 */
// 不属于「本仓自有包」但需要在 profile 里出现的 bundle。
//
// `sourceBundles` 只收 `ownPackages()` 扫到的包；而 vendor 区块
// （`packages/vendor/`）被 `ISOLATED_GROUPS` 隔离，不在那个集合里 ——
// 但它确实是本仓维护、需要装配的包，所以在这里单列。
const EXTERNAL_BUNDLES = [
  '@lybx-leyw/dsh-pages',
  // 论文阅读：上游代码 + 我们的改动，住在 `packages/vendor/paper-reader/`。
  '@ggboy123/dsh-paper-reader',
];
export const externalBundles = EXTERNAL_BUNDLES;
/** 需要在 profile 里出现的 bundle 名（本仓包 + npm 依赖包）。 */
export const allBundles = () => [...sourceBundles, ...EXTERNAL_BUNDLES];
/**
 * 校验一个候选安装目录：宿主包版本一致、在清单内，Cordis 大版本匹配。
 *
 * # 为什么不能只查一份固定包名清单
 *
 * 原先这里硬编码六个包（含 `dsh-client-ui-slots`）。但 **0.2.1-rc.5 起，宿主把
 * `ui-slots` / `ui-primitives` / `client-store` 内嵌进了前端 dist**
 * （`@deepseek-ai/dsh-web-frontend/dist/assets/index-*.js`），不再作为独立 npm 包安装。
 *
 * 它们在浏览器里**依然存在** —— 宿主的 UI 包照旧
 * `require("@deepseek-ai/dsh-client-ui-primitives")`，由前端 dist 的模块表解析。
 * 所以我们的 `HOST_SEEDS`（构建期 external 名单）**不需要改**，要改的只是这里
 * 对「宿主装没装好」的判断方式。
 *
 * 现在的做法：
 *   1. 必查的只有四个**每条版本线都在**的包（dsh / dsh-base / dsh-web-app / ui-layout）；
 *   2. `ui-workspace` 按存在性记为可选（它是布局桥接用的，缺了功能降级但不该拒绝启动）；
 *   3. 内核包（primitives / store / slots）**不再查 node_modules**，
 *      改由前端 dist 是否就绪来判断（见 {@link assertClientKernel}）。
 */
async function readHost(app) {
  const modules = path.join(app, 'node_modules');
  const supported = lock.hostVersions;
  const seen = new Set();
  // 每个受支持版本都必须有的包。**不要在加版本时把已经内嵌的包塞回来** ——
  // 那会让新版宿主直接「找不到宿主」，而它其实是好的。
  const REQUIRED = ['dsh', 'dsh-base', 'dsh-web-app', 'dsh-client-ui-layout'];
  for (const name of REQUIRED) {
    const file = path.join(modules, '@deepseek-ai', name, 'package.json');
    if (!await exists(file)) throw new Error(`找不到 DSH 宿主：${file}。请用 ZW_DSH_APP_DIR 指向已安装的 resources/app。`);
    const { version } = JSON.parse(await readFile(file, 'utf8'));
    if (!supported.includes(version)) throw new Error(`DSH ${name}=${version}，本工作台验证过的版本是 ${supported.join(' / ')}。请指定匹配宿主，不能混用版本。`);
    seen.add(version);
  }
  // 每个包各自都在清单里还不够：一个目录里混着两个版本同样是坏状态。
  if (seen.size > 1) throw new Error(`宿主包版本不一致（${[...seen].join(' / ')}）—— 同一个安装目录不能混用版本。`);
  await assertClientKernel(modules, [...seen][0]);
  const cordis = JSON.parse(await readFile(path.join(modules, '@deepseek-ai/cordis/package.json'), 'utf8'));
  if (Number(cordis.version.split('.')[0]) !== lock.cordisMajor) {
    throw new Error(`Cordis 大版本不匹配：${cordis.version}，本工作台验证的是 ${lock.cordisMajor}.x`);
  }
  return { app, modules, cli: path.join(modules, '@deepseek-ai/dsh/lib/bin.js'), version: [...seen][0] };
}

/**
 * 找到要用的宿主。
 *
 * 候选顺序：`ZW_DSH_APP_DIR` 指定 → 本机已安装的 DSH Desktop →
 * 本仓库 `.runtime/dsh-<已验证版本>`（新版在前）。
 *
 * 为什么要回退：声明支持的版本一旦变化（例如不再支持已安装的那个 0.1.5），
 * `npm start` 不能因为「机器上恰好装着旧版」就启动失败。回退只发生在**清单内**的
 * 版本上，实际用的是哪个宿主会打印出来，不是隐式魔法。
 */
export async function locateHost(env = process.env) {
  const explicit = env.ZW_DSH_APP_DIR;
  // 回退顺序由 preferredHostVersion 决定（默认用 latest 那条线，而不是 alpha），
  // 不是一个隐式排序：写清楚了才看得出 `npm start` 会用到哪一份。
  const preferred = lock.preferredHostVersion ?? lock.hostVersions[0];
  const ordered = [preferred, ...lock.hostVersions.filter(version => version !== preferred)];
  const candidates = explicit
    ? [{ app: explicit, why: 'ZW_DSH_APP_DIR' }]
    : [
        { app: path.join(env.LOCALAPPDATA ?? '', 'Programs', 'DSH Desktop', 'resources', 'app'), why: '本机已安装的 DSH Desktop' },
        ...ordered.map(version => ({ app: path.join(root, '.runtime', `dsh-${version}`), why: `本仓库临时安装 ${version}` })),
      ];
  const problems = [];
  for (const candidate of candidates) {
    try { return await readHost(candidate.app); }
    catch (error) { problems.push(`${candidate.why}（${candidate.app}）：${error.message}`); }
  }
  throw new Error(`找不到可用的 DSH 宿主：\n- ${problems.join('\n- ')}`);
}

/**
/**
 * 把模板里**属于本仓 bundle** 的配置层合并进现有 patch，用户自己的覆盖一概不动。
 *
 * 规则刻意保守：
 *   - 只认模板里的 `- id: <id>` 块；`id` 必须是本仓 bundle（`ownedIds`），
 *     或该块的 `name` 是本仓包之一；
 *   - 现有一模一样的块 → 不动；
 *   - 现有同名 `id` 块但内容不同 → **用模板的替换**（这是产品层的配置，归本仓维护，
 *     与「用户覆盖」不是一回事；用户的其它 id 块原样保留）；
 *   - 现有文件里没有这个 id → 追加到末尾。
 *
 * @param current - 现在的 patch 文本（含用户的机器本地覆盖）。
 * @param template - 模板 patch 文本。
 * @param ownedIds - 本仓包名集合（用于判断某个 name 是不是我们的）。
 * @returns 合并后的文本；没有变化时原样返回。
 */
export async function mergeOwnedPatch(current, template, ownedIds) {
  const blocks = text => {
    // Split on top-level "- id:" entries, keeping their text.
    const lines = text.replaceAll('\r\n', '\n').split('\n');
    const out = [];
    let header = [];
    let block = null;
    for (const line of lines) {
      if (/^- id:\s*/.test(line)) {
        if (block !== null) out.push(block);
        block = [line];
      } else if (block === null) {
        header.push(line);
      } else {
        block.push(line);
      }
    }
    if (block !== null) out.push(block);
    return { header, blocks: out };
  };
  const blockId = lines => {
    const first = lines[0] ?? '';
    return /^- id:\s*(\S+)/.exec(first)?.[1];
  };
  const blockName = lines => {
    for (const line of lines) {
      const match = /^\s+name:\s*["']?([^"'\n]+)["']?\s*$/.exec(line);
      if (match) return match[1];
    }
    return undefined;
  };

  const templateParts = blocks(template);
  const currentParts = blocks(current);
  /**
   * 模板里属于本仓的块：`name` 是本仓包名，**或** `id` 是某个「由本仓装配」的
   * bundle patch 声明的条目 id。
   *
   * 后者必须同时看两类包：
   *   - 本仓 `packages/` 下的包；
   *   - **npm 依赖型 bundle**（如 `@lybx-leyw/dsh-pages`）——它的 patch 在
   *     `node_modules` 里，不在 `packages/` 下，只看前者会把
   *     `- id: dsh-pages` 那段整个漏掉，而它正是「默认宽度 51」的载体。
   */
  const templateIds = new Set();
  const patchSources = [
    ...(await ownPackages(path.join(root, 'packages'))).map(manifest => ({
      dir: manifest.path,
      patch: manifest.manifest.dsh?.bundle?.patch,
    })),
    ...externalBundles.map(name => ({
      dir: path.join(root, 'node_modules', name),
      patch: 'cordis.patch.yml',
    })),
  ];
  for (const source of patchSources) {
    if (typeof source.patch !== 'string') continue;
    try {
      const patchText = await readFile(path.join(source.dir, source.patch), 'utf8');
      for (const match of patchText.matchAll(/^\s*-\s*id:\s*(\S+)/gm)) templateIds.add(match[1]);
    } catch { /* a bundle without a readable patch just contributes nothing */ }
  }
  const ownTemplateBlocks = templateParts.blocks.filter(lines => {
    const name = blockName(lines);
    const id = blockId(lines);
    if (name !== undefined && ownedIds.has(name)) return true;
    return id !== undefined && templateIds.has(id);
  });
  if (ownTemplateBlocks.length === 0) return current;

  const merged = [...currentParts.blocks];
  let changed = false;
  for (const own of ownTemplateBlocks) {
    const id = blockId(own);
    const index = merged.findIndex(lines => blockId(lines) === id);
    const wanted = own.join('\n').replace(/\n+$/, '');
    if (index < 0) {
      merged.push(own);
      changed = true;
      continue;
    }
    const existing = merged[index].join('\n').replace(/\n+$/, '');
    if (existing === wanted) continue;
    merged[index] = own;
    changed = true;
  }
  if (!changed) return current;

  // Preserve the live file's header/comments; append blocks after them.
  const headerText = currentParts.header.join('\n').replace(/\n+$/, '');
  const body = merged.map(lines => lines.join('\n').replace(/\n+$/, '')).join('\n');
  return `${headerText}\n${body}\n`;
}

/**
 * 建立 profile 里指向宿主的目录链接。
 *
 * [adopt] 为真时，如果这个链接**是我们自己建的链接**（不是实体目录）却指向别处 ——
 * 宿主换了版本/安装位置 —— 就改指过去。用户自己放在这里的实体目录永远不覆盖，
 * 仍然报错退出。
 */
async function linkDirectory(target, link, { adopt = false } = {}) {
  if (await exists(link)) {
    const here = path.resolve(await realpath(link));
    if (here.toLowerCase() === path.resolve(await realpath(target)).toLowerCase()) return 'same';
    // 判断「这是链接还是用户自己放的实体目录」**不能**用 `lstat().isSymbolicLink()`：
    // Windows 的 junction 在那里报 `isDirectory()===true` / `isSymbolicLink()===false`，
    // 于是本脚本自己建的链接会被误判成实体目录，换宿主时永远改指不了。
    // 可靠判据是路径本身：实体目录的 realpath 就是它自己，链接的 realpath 指向别处。
    const isLink = here.toLowerCase() !== path.resolve(link).toLowerCase();
    if (!adopt || !isLink) throw new Error(`已有路径指向其他位置，未覆盖：${link}`);
    await rm(link, { recursive: true, force: true });
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return 'repointed';
  }
  await mkdir(path.dirname(link), { recursive: true });
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  return 'created';
}
/**
 * 数据目录改名表（旧 → 新）。
 *
 * 刻意写成**显式清单**而不是「把 `data/zhiyun-*` 批量改成 `data/zw-*`」：
 * 后者会顺手搬走用户自己放的目录，而那些目录不是我们的东西。
 * 加一个带持久数据的新包时，在这里补一行。
 */
export const DATA_DIR_RENAMES = Object.freeze([
  ['zhiyun-campus', 'zw-campus'],
  ['zhiyun-cc98', 'zw-cc98'],
  ['zhiyun-chalaoshi', 'zw-chalaoshi'],
  ['zhiyun-classroom', 'zw-classroom'],
  ['zhiyun-deeptutor', 'zw-deeptutor'],
  ['zhiyun-ebook', 'zw-ebook'],
  ['zhiyun-lab', 'zw-lab'],
  ['zhiyun-mail', 'zw-mail'],
  ['zhiyun-market', 'zw-market'],
  ['zhiyun-net-proxy', 'zw-net-proxy'],
  ['zhiyun-notice', 'zw-notice'],
  ['zhiyun-paper', 'zw-paper'],
  ['zhiyun-parser', 'zw-parser'],
  ['zhiyun-planning', 'zw-planning'],
  ['zhiyun-pta', 'zw-pta'],
  ['zhiyun-study', 'zw-study'],
  ['zhiyun-sztz', 'zw-sztz'],
  ['zhiyun-tyys', 'zw-tyys'],
  ['zhiyun-vault', 'zw-vault'],
  ['zhiyun-vault-notes', 'zw-vault-notes'],
  ['zhiyun-workshop', 'zw-workshop'],
  ['zhiyun-xuezai', 'zw-xuezai'],
  ['zhiyun-xxt', 'zw-xxt'],
  ['zhiyun-yjsy', 'zw-yjsy'],
  ['zhiyun-zdbk', 'zw-zdbk'],
]);

/**
 * 把旧前缀的 `<profile>/data/zhiyun-*` 目录改成新前缀 `zw-*`。
 *
 * # 为什么必须在启动时搬，而不是「让用户重新登一次」
 *
 * 这些目录里装的是**不可重建**的东西：DPAPI 加密过的会话、下载好的课件缓存、
 * 已解析的讲义、笔记库、规划快照。改名只动了代码里的路径常量，磁盘上的目录还是
 * 旧名 —— 不改的话表现是「升级后全都得像第一次用一样重新登录 / 重新解析」，
 * 而且旧数据仍占着几百 MB，用户根本发现不了它还躺在那里。
 *
 * # 三条必须守住的规则
 *
 * 1. **目标已存在就一个字节都不动。** 那说明用户已经在新名下产生了数据（或上一次
 *    迁移中途成功、这次是重跑）。往一个非空目录上合并会把两代数据混成一份，
 *    比「没搬」糟糕得多。这种情况只留下旧目录，由人来判断。
 * 2. **`rename` 而不是复制。** 同一文件系统内是原子操作，中途断电不会留下半份数据。
 * 3. **只搬登记过的名字。** 不按前缀通配：`data/` 下可能有用户自己放的目录，
 *    名字恰好同前缀；把它们搬走等于擅自改别人的文件。
 *
 * @param profile - profile 目录（数据根在它下面的 `data/`）。
 * @returns 实际搬动的 `[旧名, 新名]` 列表（启动日志用）。
 */
export async function migrateDataDirectories(profile) {
  const dataDir = path.join(profile, 'data');
  const entries = new Set(await readdir(dataDir).catch(() => []));
  const moved = [];
  for (const [before, after] of DATA_DIR_RENAMES) {
    if (!entries.has(before) || entries.has(after)) continue;
    try {
      await rename(path.join(dataDir, before), path.join(dataDir, after));
      moved.push([before, after]);
    } catch (error) {
      // 搬不动不该让产品起不来：旧目录原样留着，各包退回「没有数据」的首次状态。
      console.warn(`数据目录 ${before} → ${after} 迁移失败：${error.message}`);
    }
  }
  return moved;
}

export async function initialize({ home = path.join(root, '.runtime', 'home'), env = process.env } = {}) {
  const host = await locateHost(env);
  const profile = path.join(home, 'profiles', lock.profile);
  await mkdir(profile, { recursive: true });
  const template = JSON.parse(await readFile(path.join(root, 'profiles', lock.profile, 'package.json'), 'utf8'));
  const manifestFile = path.join(profile, 'package.json');
  if (await exists(manifestFile)) {
    const existing = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (existing.name !== template.name) throw new Error(`已有 profile 不属于智云，未覆盖：${profile}`);
    const bundles = existing.dsh?.profile?.bundles;
    // 产品改名/拆包：profile 里指向**本仓已发布的旧名**的条目必须删掉，否则 Loader
    // 解不开这一行，整个 profile 起不来。只认 `retiredBundles` 登记表：没有登记的
    // 条目（哪怕前缀相同）可能是别的分支或用户自己链进来的包，一律不动。
    const stale = Array.isArray(bundles)
      ? bundles.filter(bundle => retiredBundles.includes(bundle))
      : [];
    let changed = false;
    if (stale.length > 0) {
      existing.dsh.profile.bundles = bundles.filter(bundle => !stale.includes(bundle));
      changed = true;
      console.log(`已从 profile 移除本仓不再提供的 bundle：${stale.join('、')}`);
    }
    for (const bundle of template.dsh.profile.bundles) {
      if (!existing.dsh?.profile?.bundles?.includes(bundle)) {
        // Product upgrade: append our new source bundle to our existing profile.
        // Preserve every user-owned override and all other manifest fields.
        if (!allBundles().includes(bundle) || !Array.isArray(existing.dsh?.profile?.bundles)) throw new Error(`profile 缺少 ${bundle}，请检查自己的配置；初始化不会重写配置。`);
        existing.dsh.profile.bundles.push(bundle);
        changed = true;
      }
    }
    if (changed) await writeFile(manifestFile, JSON.stringify(existing, null, 2) + '\n');
  } else {
    await writeFile(manifestFile, JSON.stringify(template, null, 2) + '\n', { flag: 'wx' });
  }
  const patch = path.join(profile, 'cordis.patch.yml');
  // The live patch holds machine-local overrides, so it must never be overwritten
  // wholesale. But the template's **owned** layers (config for bundles this repo
  // declares) have to reach the live profile too — copying the template only when
  // the file is missing meant a new `dsh-pages` config silently never applied, and
  // "reset width" kept falling back to the shell's own default.
  const templatePatch = await readFile(path.join(root, 'profiles', lock.profile, 'cordis.patch.yml'), 'utf8');
  if (!await exists(patch)) {
    await writeFile(patch, templatePatch, { flag: 'wx' });
  } else {
    const current = await readFile(patch, 'utf8');
    const merged = await mergeOwnedPatch(current, templatePatch, sourceBundles);
    if (merged !== current) {
      await writeFile(patch, merged);
      console.log('已把模板里本仓 bundle 的配置层合并进 profile 的 cordis.patch.yml（用户覆盖未动）');
    }
  }
  // 宿主换版本时改指这两条链接（它们由本脚本创建）；用户自己放的实体目录不会被覆盖。
  // 本仓包链接从 `sourceBundles` 推导 —— 拆包后多出的包不需要在这里补行。
  // npm 依赖的 bundle（见 `externalBundles`）链到根 node_modules 里安装好的那份：
  // profile 在 `.runtime/home` 下，解析不到仓库根的依赖树，所以仍要一条目录链接。
  // 已退役的 bundle 在 profile 里留下的目录链接也要清掉：包目录已经删了，
  // 链接会指向一个不存在的路径，Loader 解析到它会报错。只清 `retiredBundles`
  // 登记表里的名字，且只清链接（实体目录不动）。
  //
  // ⚠️ 不能用 `exists()` 判断：悬空 junction 的 `access()` 会失败，正好把最该清掉
  //    的那一个漏过去。改为读目录项本身 —— 目录项存在即说明有这个链接。
  const modulesDir = path.join(profile, 'node_modules');
  const present = new Set(await readdir(modulesDir).catch(() => []));
  for (const name of retiredBundles) {
    if (!present.has(name)) continue;
    const link = path.join(modulesDir, name);
    // 实体目录（realpath 等于自身）是用户自己放的，不动；链接一律清掉。
    // 悬空链接的 realpath 会抛错，那正是最该清理的一种，所以抛错即视为链接。
    const isRealDirectory = await realpath(link)
      .then(here => path.resolve(here).toLowerCase() === path.resolve(link).toLowerCase())
      .catch(() => false);
    if (isRealDirectory) continue;
    await rm(link, { recursive: false, force: true });
    console.log(`已移除 profile 里已退役 bundle 的目录链接：${name}`);
  }
  const repointed = [];
  const sourceDirs = await ownPackageDirs(path.join(root, 'packages'));
  // 链接目标一律用**包名**（manifest.name），不是目录名：宿主按 profile
  // `bundles` 里的 npm 包名去 `node_modules` 解析，目录名只在仓库内使用
  // （例如 `packages/client/pages-default/` → `@lybx-leyw/dsh-zju-pages-default`）。
  const sourceLinks = [];
  for (const dir of sourceDirs) {
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const segments = manifest.name.split('/');
    sourceLinks.push([dir, path.join(profile, 'node_modules', ...segments)]);
  }
  for (const [target, link] of [
    [path.join(host.modules, '@deepseek-ai'), path.join(profile, 'node_modules', '@deepseek-ai')],
    ...sourceLinks,
    ...externalBundles.map(name => [path.join(root, 'node_modules', name), path.join(profile, 'node_modules', name)]),
  ]) {
    if (await linkDirectory(target, link, { adopt: true }) === 'repointed') repointed.push(path.basename(link));
  }
  await mkdir(path.join(home, 'workspace'), { recursive: true });
  const movedData = await migrateDataDirectories(profile);
  return { ...host, home: path.resolve(home), profile, repointed, movedData };
}
/**
 * 把 `profile.mjs start` 的额外参数拼成宿主参数表 —— **同名参数只出现一次**。
 *
 * 这里曾经是 `['--no-open', '--port', ZW_PORT ?? '3091', ...extra]`，于是
 * `npm start -- --port 3081` 会拼出 `--port 3091 --no-open --port 3081`，
 * 而宿主取**前一个** 3091：用户以为起在 3081，实际听的是 3091（那里常已被别的
 * 实例占着，于是表现为「启动了却打不开」，或报 EADDRINUSE 后连 webserver 一起
 * 拖垮十个依赖它的插件）。同名参数出现两次本身就是错的。
 *
 * 端口优先级：显式 `--port` / `--port=` > `ZW_PORT` > 3091。
 * `--no-open` 同理：调用方已经写了就不再补。
 *
 * @param extra - 传给宿主的额外参数（`process.argv.slice(3)`）。
 * @param envPort - `ZW_PORT` 的值，可为空。
 * @returns 宿主参数表。
 */
export function hostArgs(extra = [], envPort = undefined) {
  const hasExplicitPort = extra.some(arg => arg === '--port' || arg.startsWith('--port='));
  return [
    ...(extra.includes('--no-open') ? [] : ['--no-open']),
    ...(hasExplicitPort ? [] : ['--port', envPort ?? '3091']),
    ...extra,
  ];
}
export function runHost(runtime, args, { pipe = false } = {}) {
  return spawn(process.execPath, [runtime.cli, '--profile', lock.profile, ...args], {
    cwd: path.join(runtime.home, 'workspace'),
    env: { ...process.env, DSH_HOME: runtime.home },
    windowsHide: true, stdio: pipe ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
}
/**
 * 哪些**声明了 `dsh.client`** 的包缺 `lib/client.js`。
 *
 * 只查这一类包：它们的宿主半是空壳，少了客户端产物表现为「前端起来了但这一页空白」，
 * 比启动失败更难查。`npm start` 与桌面壳（`apps/desktop`）都调它 —— 提取出来是为了
 * 两处共用同一份判断，而不是各写一遍。
 *
 * @returns 缺产物的包名数组（空数组 = 齐全）。
 */
export async function missingClientBundles() {
  const missing = [];
  for (const dir of await ownPackageDirs(path.join(root, 'packages'))) {
    const name = path.basename(dir);
    // 带 `DETACHED.md` 的包是「已完工、但决定暂不接进 profile」的：它不参与构建，
    // 也就不会产出 lib/client.js。要求它有产物只会让 `npm start` 直接起不来。
    // 见各包的 DETACHED.md。
    if (await exists(path.join(dir, 'DETACHED.md'))) continue;
    const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    if (manifest.dsh?.client === undefined) continue;
    if (!await exists(path.join(dir, 'lib/client.js'))) missing.push(name);
  }
  return missing;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2] ?? 'check';
    if (!['init', 'check', 'dump', 'start'].includes(command)) throw new Error('用法：profile.mjs init|check|dump|start');
    const runtime = await initialize({ home: process.env.ZW_DSH_HOME });
    console.log(`ZJU Workbench · DSH ${runtime.version}\n宿主: ${runtime.app}\nProfile: ${runtime.profile}\n数据: ${runtime.home}`);
    if (runtime.repointed?.length) console.log(`已把 profile 的宿主链接改指到当前安装：${runtime.repointed.join('、')}`);
    if (runtime.movedData?.length) console.log(`已把旧前缀的数据目录迁到新名前缀：${runtime.movedData.map(([a, b]) => `${a} → ${b}`).join('、')}`);
    if (command === 'start' || command === 'dump') {
      const missing = await missingClientBundles();
      if (missing.length > 0) throw new Error(`请先运行 npm run build（缺客户端产物：${missing.join('、')}）`);
      const extra = process.argv.slice(3);
      const args = command === 'dump' ? ['--dump-config'] : hostArgs(extra, process.env.ZW_PORT);
      const child = runHost(runtime, args);
      child.on('error', error => { console.error(error.message); process.exitCode = 1; });
      child.on('exit', code => { process.exitCode = code ?? 1; });
      process.on('SIGINT', () => child.kill());
      process.on('SIGTERM', () => child.kill());
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
