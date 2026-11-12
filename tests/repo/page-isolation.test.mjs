/**
 * 分层守卫：**页面之间互不相识**。
 *
 * 需求原话是「每个 page 不认识其他 page）。core 是各层交互的，但对于 page 来说，
 * 他们只应该处理 ui，不问数据从哪里来，所以各个 page 就无交互」。
 *
 * 这条规矩以前是破的：`page-study` 直接
 *
 * ```js
 * import { QuizPanel } from '@lybx-leyw/dsh-zju-page-quiz';
 * ```
 *
 * 后果不只是「不好看」：用户在「插件」页取消题库页之后，学习页的产物里仍然
 * require 那个模块，运行时解析不到 → 整页空白。现在改成向 `ui-shared` 的
 * 组件契约表发布/取用，谁没装就退回一句说明。
 *
 * 这是一条**静态守卫**：不 import 就不可能在运行时依赖，比开机看现象可靠。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLIENT = path.join(ROOT, 'packages', 'client');
const SLASH = String.fromCharCode(92);

/**
 * 这些包的**裸入口**带 `node:` 依赖，客户端只能用它们的 `/browser` 子入口。
 *
 * - `core-planning`：入口 re-export 了 `schedule.js` / `ticks.js`（`node:fs`）；
 *   `./browser` 只导出纯函数。
 * - `core-vault`：整个包都是宿主侧的（落盘 + PDF 字节流 + pdfjs-dist）。
 * - `core-plugin-graph`：入口 `apply()` 会注册 `/api/zw-plugins` 路由并 inject
 *   `connection`/`loader`；客户端只需要 `./browser` 里那几个折叠函数。误引入口虽然
 *   不会白屏（它不碰 node 内置模块），但会把一个宿主插件塞进浏览器产物 ——
 *   更糟的是它看起来"能用"，于是没人发现边界破了。
 */
const BROWSER_SAFE_PACKAGES = [
  '@lybx-leyw/dsh-zju-core-planning',
  '@lybx-leyw/dsh-zju-core-vault',
  '@lybx-leyw/dsh-zju-core-plugin-graph',
];

/** 一个包目录里的全部源文件（递归，跳过 lib/ 产物与 node_modules）。 */
function sources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib' || entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { sources(full, out); continue; }
    if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 本仓的页面包清单：`packages/client/page-<id>`。 */
function pagePackages() {
  return readdirSync(CLIENT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.startsWith('page-'))
    .map(entry => entry.name);
}

/** 剥离注释：说明性文字里会提到别的页，那不是依赖。 */
function code(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** 这个文件是否把 `name` 当作模块引用（`from '…'` 或 `import('…')`）。 */
function references(body, name) {
  // 用 substring 而不是拼正则：包名里有 `/` 和 `@`，手拼正则容易漏转义。
  for (const prefix of ["from '", 'from "', "import('", 'import("']) {
    const at = body.indexOf(prefix + name);
    while (at !== -1) {
      const after = body.charAt(at + prefix.length + name.length);
      // 必须正好在引号处结束，避免 `@x/page-quiz-extra` 被当成 `@x/page-quiz`。
      if (after === "'" || after === '"') return true;
      break;
    }
  }
  return false;
}

test('页面包之间没有任何 import（含 jsx / js / mjs）', () => {
  const pages = pagePackages();
  assert.ok(pages.length > 5, `页面包清单解析失败（只找到 ${pages.join(',') || '空'}）`);

  // 每个页面包的**包名**，用来识别「import 的是另一页」。
  const names = new Map();
  for (const page of pages) {
    const manifest = JSON.parse(readFileSync(path.join(CLIENT, page, 'package.json'), 'utf8'));
    names.set(manifest.name, page);
  }

  const violations = [];
  for (const page of pages) {
    for (const file of sources(path.join(CLIENT, page, 'src'))) {
      const body = code(readFileSync(file, 'utf8'));
      for (const [name, owner] of names) {
        if (references(body, name)) {
          violations.push(`${path.relative(ROOT, file).split(SLASH).join('/')} → ${name}（${owner}）`);
        }
      }
    }
  }
  assert.deepEqual(violations, [],
    '页面之间必须互不相识，改用 ui-shared 的 publishComponent/usePublishedComponent:\n' + violations.join('\n'));
});

test('页面包的 package.json 不把另一页列成依赖或 external', () => {
  const pages = pagePackages();
  const names = pages.map(page => JSON.parse(readFileSync(path.join(CLIENT, page, 'package.json'), 'utf8')).name);
  const violations = [];
  for (const page of pages) {
    const manifest = JSON.parse(readFileSync(path.join(CLIENT, page, 'package.json'), 'utf8'));
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...(manifest.dsh?.client?.external ?? []),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ];
    for (const name of names) {
      if (name === manifest.name) continue;
      if (declared.includes(name)) violations.push(`${page}: 声明了对 ${name} 的依赖`);
    }
  }
  assert.deepEqual(violations, [],
    '页面之间不该有包级依赖（页面无交互）:\n' + violations.join('\n'));
});

test('页面包的宿主半边不做存储/取数（page 只含 UI）', () => {
  // 需求：page 包只含 UI，「各个 page 就无交互」，数据从哪里来不归它管。
  //
  // 历史上 page-notes 的 `src/index.js` 是 900 行的存储层（fs/promises、原子写、
  // PDF 字节流、RPC 路由），page-planning 那 91 KB 也同时管中转站拉取、快照与
  // 待办聚合。判据用**行为**而不是行数：出现文件 IO / 宿主路由注册就算越界。
  const violations = [];
  for (const page of pagePackages()) {
    const host = path.join(CLIENT, page, 'src', 'index.js');
    if (!existsSync(host)) continue;
    const body = readFileSync(host, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    const problems = [];
    if (/from\s+'node:fs|require\(\s*'node:fs/.test(body)) problems.push('文件 IO（node:fs）');
    if (/webServer\.register|connection\.fetch\.register/.test(body)) problems.push('注册宿主路由');
    if (/from\s+'node:child_process/.test(body)) problems.push('子进程');
    if (problems.length > 0) violations.push(`${page}: ${problems.join('、')}`);
  }
  assert.deepEqual(violations, [],
    '页面包不该管存储/取数，应下沉到 core:\n' + violations.join('\n'));
});

test('页面包 src 下的**任何**文件都不碰 node:fs（不只是 index.js）', () => {
  // 上一版只看 `src/index.js`，于是规划页里那两个直接读写用户 json 文件的
  // 存储模块（`ticks` 与 `schedule`）一直漏网。
  //
  // 它们后来整份搬进了 `@lybx-leyw/dsh-zju-core-planning`，迁走后页面侧一度只剩
  // 再导出的过渡文件；过渡文件现已删除，再导出也没有了。
  // 这条守卫盯的是**整个 src 目录**，将来再有人往页面里塞存储会立刻红。
  const violations = [];
  for (const page of pagePackages()) {
    for (const file of sources(path.join(CLIENT, page, 'src'))) {
      const body = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/from\s+'node:fs|require\(\s*'node:fs|from\s+'node:child_process/.test(body)) {
        violations.push(path.relative(ROOT, file).split(SLASH).join('/'));
      }
    }
  }
  assert.deepEqual(violations, [],
    '页面包在直接读写文件系统，应下沉到 core:\n' + violations.join('\n'));
});

/**
 * 规划域已经全部下沉 —— 这段注释留着是为了记住它曾经拖了多久。
 *
 * `page-planning/src/index.js` 原是 2068 行的宿主半边（中转站拉取、快照、待办聚合、
 * `?pta` 转发、AI 规划、pet 对话），`ticks.js` / `schedule.js` / `time.js` /
 * `local.js` / `pet.js` 等十几个模块两半共用。整块搬到
 * `@lybx-leyw/dsh-zju-core-planning` 之后，页面侧 `src/index.js` 只剩一个空
 * `apply()`（保留它是为了让客户端 bundle 进入启动图谱）。
 *
 * 上面那条「页面不许碰 node:fs」的断言现在是**全绿**的；它不会因为这段注释而放松。
 */

test('页面的**客户端半边**不 import 存储包（否则 node:fs 会被打进浏览器）', () => {
  // 存储下沉之后有一条新的坑：`core-planning` 是**非客户端**包（没有
  // `src/client.jsx`、没有 `lib/client.js`），页面 import 它时会被 esbuild
  // **内联**进客户端产物 —— 而它 `import 'node:fs'`。浏览器里没有 node:fs，
  // 后果是进笔记/规划页当场白屏，构建却是绿的（esbuild 对 node 内置模块只警告）。
  //
  // 所以：只有页面的**宿主半边**（src/index.js 及其它 node 侧文件）能 import 它；
  // `src/client.jsx` / `*.jsx` 一律不许。
  const violations = [];
  for (const page of pagePackages()) {
    for (const file of sources(path.join(CLIENT, page, 'src'))) {
      if (!/\.jsx?$/.test(file)) continue;
      // jsx 文件必然是浏览器半边；js 文件要看是不是被 client.jsx 引用 ——
      // 简化成「凡是 .jsx 与 client.jsx 都查」，覆盖真实风险面。
      if (!file.endsWith('.jsx') && !file.endsWith('client.js')) continue;
      const body = readFileSync(file, 'utf8');
      for (const pkg of BROWSER_SAFE_PACKAGES) {
        const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // 允许 `<pkg>/browser` 这类**纯函数子入口**；裸包名一律不许 ——
        // 裸入口会 re-export 带 `node:fs` 的存储模块。
        const banned = new RegExp(`from\\s+'${escaped}'`);
        if (banned.test(body)) {
          violations.push(`${path.relative(ROOT, file).split(SLASH).join('/')} → ${pkg}（应改走 ${pkg}/browser）`);
        }
      }
    }
  }
  assert.deepEqual(violations, [],
    '客户端半边 import 了带 node: 依赖的包入口（会进浏览器产物）:\n' + violations.join('\n'));
});

test('客户端的**间接依赖**也不许碰裸入口（沿 import 链走一遍）', () => {
  // 上一版只查 `*.jsx` 与 `client.js` 这两个**直接**入口。真实的坑是间接的：
  //   `client.jsx` → `./foo.js` → `@lybx-leyw/dsh-zju-core-planning`
  // 第一层文件名不带 jsx，于是整条链被跳过 —— 而 esbuild 照样会把 `node:fs`
  // 打进产物。所以这里从 `client.jsx` 出发，把同包内的相对 import 全部跟进。
  const violations = [];
  const banned = BROWSER_SAFE_PACKAGES.map(pkg => pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  for (const page of pagePackages()) {
    const srcDir = path.join(CLIENT, page, 'src');
    const entry = path.join(srcDir, 'client.jsx');
    if (!existsSync(entry)) continue;

    const seen = new Set();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      let body;
      try { body = readFileSync(file, 'utf8'); } catch { continue; }

      for (const pkg of banned) {
        if (new RegExp(`from\\s+'${pkg}'`).test(body)) {
          violations.push(`${path.relative(ROOT, file).split(SLASH).join('/')} → ${pkg}`);
        }
      }
      // 跟同包内的相对 import（只认 `./x.js` / `./x.jsx`，不跟目录索引）。
      for (const match of body.matchAll(/from\s+'\.\/([^']+\.jsx?)'/g)) {
        queue.push(path.join(srcDir, match[1]));
      }
    }
  }
  assert.deepEqual(violations, [],
    '客户端 import 链上出现了裸入口（node: 依赖会进浏览器产物）:\n' + violations.join('\n'));
});


test('跨域读数据只走 URL：笔记页的三条路径必须与 core-vault 的声明一致', () => {
  // 与上一条同源：笔记页不 import core-vault（页面不许认识它），只按 URL 读写。
  // 三条都是隐式契约，任何一条改名都会让**对应功能静默失效**：
  //   · 索引路由改了 → 反链/图谱永远是空的（看起来只是"没有链接"）
  //   · 笔记路由改了 → 列表读不出来，页面显示"空库"
  //   · PDF 前缀改了 → 附件打不开，只是一个白 iframe
  const notes = readFileSync(path.join(CLIENT, 'page-notes', 'src', 'client.jsx'), 'utf8');
  const vault = readFileSync(path.join(ROOT, 'packages', 'core', 'vault', 'src', 'notes-host.js'), 'utf8');
  const vaultIndex = readFileSync(path.join(ROOT, 'packages', 'core', 'vault', 'src', 'host.js'), 'utf8');

  const pick = (text, name) => {
    const found = new RegExp(`const ${name} = '([^']+)'`).exec(text);
    assert.ok(found !== null, `页面里没找到 ${name}，读法变了就要改本条测试`);
    return found[1];
  };
  const declared = (text, label) => {
    const found = /export const ROUTE_PATH = '([^']+)'/.exec(text);
    assert.ok(found !== null, `${label} 里没找到 ROUTE_PATH 声明`);
    return found[1];
  };

  assert.equal(pick(notes, 'NOTES_ROUTE'), declared(vault, 'notes-host.js'),
    '笔记页的 NOTES_ROUTE 与 core-vault 的 notes-host ROUTE_PATH 不一致');
  assert.equal(pick(notes, 'VAULT_ROUTE'), declared(vaultIndex, 'host.js'),
    '笔记页的 VAULT_ROUTE 与 core-vault 的索引 ROUTE_PATH 不一致');

  // PDF 前缀在 `pdf-viewer.js` 里定义，页面用的是带尾斜杠的拼接形式。
  const pdf = readFileSync(path.join(ROOT, 'packages', 'core', 'vault', 'src', 'pdf-viewer.js'), 'utf8');
  const prefix = /export const PDF_ROUTE_PREFIX = '([^']+)'/.exec(pdf);
  assert.ok(prefix !== null, 'pdf-viewer.js 里没找到 PDF_ROUTE_PREFIX');
  assert.equal(pick(notes, 'PDF_VIEWER_PREFIX'), `${prefix[1]}/`,
    '笔记页的 PDF_VIEWER_PREFIX 与 core-vault 的 PDF_ROUTE_PREFIX 不一致');
});

test('规划页与 core-planning 的线上协议常量必须一致（MASK / WRITE_HEADER）', () => {
  // 这两条也是**隐式契约**，失效方式同样安静：
  //   · `MASK`（'********'）：页面把打码值原样回传表示"不改密钥"。两边不一致时，
  //     宿主会把它当成真实密钥存下来 —— 用户下次连不上中转站，而界面显示"已保存"。
  //   · `WRITE_HEADER`：页面写操作必须带这个自定义头（CSRF 的那道闸）。
  //     不一致时所有写操作被 403，页面只能显示"保存失败"。
  const page = readFileSync(path.join(CLIENT, 'page-planning', 'src', 'client.jsx'), 'utf8');
  const core = readFileSync(path.join(ROOT, 'packages', 'core', 'planning', 'src', 'index.js'), 'utf8');

  const pageMask = /const MASK = '([^']+)'/.exec(page);
  const coreMask = /const MASK = '([^']+)'/.exec(core);
  assert.ok(pageMask !== null, '页面里没找到 MASK 声明');
  assert.ok(coreMask !== null, 'core-planning 里没找到 MASK 声明');
  assert.equal(pageMask[1], coreMask[1], 'MASK 不一致：打码值会被当成真密钥存下来');

  const pageHeader = /const WRITE_HEADER = '([^']+)'/.exec(page);
  const coreHeader = /export const WRITE_HEADER = '([^']+)'/.exec(core);
  assert.ok(pageHeader !== null, '页面里没找到 WRITE_HEADER 声明');
  assert.ok(coreHeader !== null, 'core-planning 里没找到 WRITE_HEADER 导出');
  assert.equal(pageHeader[1], coreHeader[1], 'WRITE_HEADER 不一致：所有写操作会被 403');
});
