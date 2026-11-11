/**
 * 分层守卫：**core 不含 UI**。
 *
 * 需求原话：「core 包不含 ui，page 包只含 ui，…数据处理和工具层走 core」。
 *
 * 这条以前是破的：`core/classroom-renderer` 里就住着一个 `import React` 的
 * 渲染组件（`src/view/slide.jsx`），而 `page-study` 直接 import 它。于是
 *   - core 的产物进浏览器时要依赖 React；
 *   - 页面与 core 之间多了一条「组件」耦合，而不只是服务/纯函数。
 *
 * 现在组件搬到 `ui-shared`，core 只留纯数据与纯逻辑。这条守卫盯着两件事：
 *   1. `packages/core/**` 里不许出现 React / JSX 组件；
 *   2. core 的包不再声明 `dsh.client`（声明了就说明又有浏览器半边了）。
 *
 * 例外的判定不是按包名写死，而是按**事实**：core 里允许存在 `src/client.jsx`，
 * 只要它只是把纯函数转出去（本仓 playback / player / quiz / classroom-agent
 * 就是这么做的 —— 浏览器要用它们的纯计算，但不渲染任何东西）。所以第 1 条
 * 只禁 `react` 的 import 与 `.jsx` 文件里的组件定义。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CORE = path.join(ROOT, 'packages', 'core');
const SLASH = String.fromCharCode(92);

/** 递归列出 core 下的源文件（跳过 vendor / lib / node_modules）。 */
function sources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'lib', 'vendor'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { sources(full, out); continue; }
    if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = file => path.relative(ROOT, file).split(SLASH).join('/');

test('core 里没有任何文件 import React（UI 归 ui-shared / page）', () => {
  const violations = [];
  for (const file of sources(CORE)) {
    const body = readFileSync(file, 'utf8');
    // 抓 `from 'react'` / `from 'react-dom'` / `require('react')`。
    // 注释里提到 React 是说明性文字，先剥掉再判断。
    const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/(from|require\s*\()\s*['"]react(-dom)?(\/[\w-]+)?['"]/.test(code)) {
      violations.push(rel(file));
    }
  }
  assert.deepEqual(violations, [],
    'core 不该含 UI：把 React 组件搬到 packages/client/ui-shared。违规文件:\n' + violations.join('\n'));
});

test('core 里的 .jsx 只能是纯再导出，且不得含 JSX 元素', () => {
  // ⚠️ 不能用「core 里不许有 .jsx」这种一刀切：`playback` / `player` / `quiz` /
  // `classroom-agent` / `study` 的客户端半边是**纯函数再导出**（浏览器要用它们的
  // 计算，但不渲染任何东西），文件名带 .jsx 是历史写法。判据必须是**内容**：
  //   - 出现 JSX 元素（`<Foo` / `</`）→ 那就是 UI，搬走；
  //   - 出现 `createElement` 调用 → 同上。
  const violations = [];
  for (const file of sources(CORE).filter(f => f.endsWith('.jsx'))) {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (/<[A-Za-z][\w.]*[\s/>]|<\/[A-Za-z]/.test(code) || /createElement\s*\(/.test(code)) {
      violations.push(rel(file));
    }
  }
  assert.deepEqual(violations, [],
    '这些 core 的 .jsx 在渲染 UI，应搬到 packages/client/ui-shared:\n' + violations.join('\n'));
});

test('core/classroom-renderer 只剩画布常量，没有客户端半边', () => {
  const pkg = path.join(CORE, 'classroom-renderer');
  const manifest = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8'));
  assert.equal(manifest.dsh?.client, undefined,
    'classroom-renderer 又声明了 dsh.client —— 渲染组件应留在 ui-shared');
  assert.equal(existsSync(path.join(pkg, 'src/client.jsx')), false,
    'classroom-renderer 又出现了 src/client.jsx');

  // 常量仍在 core（生成侧也要用），别顺手删掉。
  const index = readFileSync(path.join(pkg, 'src/index.js'), 'utf8');
  assert.match(index, /export const VIEWPORT_SIZE/, '画布常量丢了：生成侧与渲染侧会对不上');
  assert.match(index, /export const VIEWPORT_RATIO/, '画布常量丢了：生成侧与渲染侧会对不上');
});

test('渲染组件在 ui-shared，且被导出', () => {
  const root = path.join(ROOT, 'packages', 'client', 'ui-shared', 'src');
  assert.ok(existsSync(path.join(root, 'classroom-slide.jsx')), '课堂渲染组件不见了');
  const client = readFileSync(path.join(root, 'client.jsx'), 'utf8');
  assert.match(client, /export \{ ClassroomSlide \}/, 'ui-shared 没把 ClassroomSlide 导出，页面会拿到 undefined');
  assert.ok(existsSync(path.join(root, 'classroom-slide.css')), '渲染组件的样式没跟上来');
});

test('笔记存储搬进 core 之后，仍然**真的会被挂起来**', () => {
  // 搬迁有一个特有的失效模式：文件搬到位了，但没人装配它 —— 于是笔记页的两条
  // 路由都 404，页面看上去只是"空了"，没有任何报错。这条守卫盯的就是这件事。
  const vault = path.join(CORE, 'vault');
  const host = readFileSync(path.join(vault, 'src', 'host.js'), 'utf8');
  assert.match(host, /import\('\.\/notes-host\.js'\)/,
    'host.js 没有挂起 notes-host.js —— 笔记存储不会启动，页面会是空的');

  const patch = readFileSync(path.join(vault, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /name: '@lybx-leyw\/dsh-zju-core-vault'/,
    'core-vault 的 patch 没有指向包入口');

  // 存储半边必须还在（它是落盘、路径安全、PDF 路由的实现）。
  assert.ok(existsSync(path.join(vault, 'src', 'notes-host.js')), 'notes-host.js 不见了');
  assert.ok(existsSync(path.join(vault, 'src', 'pdf-viewer.js')), 'pdf-viewer.js 不见了');

  // 页面包里不该再有存储实现（page 只做 UI）。
  const pageIndex = path.join(ROOT, 'packages', 'client', 'page-notes', 'src', 'index.js');
  const page = readFileSync(pageIndex, 'utf8');
  assert.doesNotMatch(page, /node:fs|writeFileAtomic/, 'page-notes 又自己管起了文件');
});
