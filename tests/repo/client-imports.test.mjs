import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 客户端插件的两个「静默白屏」陷阱，静态即可查。
 *
 * # 真机踩过的四次
 *
 * | 症状 | 原因 |
 * | --- | --- |
 * | `ReferenceError: PageTitle is not defined`，槽崩溃 | 用了 ui-shared 的组件但 import 段没加 |
 * | `ReferenceError: Section is not defined`，同上 | 同上（新组件未同步 import） |
 * | `ReferenceError: StatusLine is not defined`，同上 | **JSX 写法** `<StatusLine>` 没被守卫识别 |
 * | 设置标题恒为中文且无报错 | `ctx.locale` 被 Cordis 注入门禁拒绝（没写进 `inject`） |
 *
 * 共同点：构建通过、宿主日志干净，只有打开那个面板才看得见。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));
const UI_SHARED = '@lybx-leyw/dsh-zju-ui-shared';

/**
 * ui-shared 导出的设置组件 —— **必须与 `src/client.jsx` 的导出保持同步**。
 *
 * ⚠️ 这份清单漏项 = 守卫失效。本节踩过一次：`Section` / `Rows` 已加进
 * ui-shared 但清单没更新，于是用了不报、运行时崩。
 */
const SHARED = [
  'Actions', 'Card', 'Field', 'Intro', 'PageTitle', 'Rows', 'Section',
  'StatusLine', 'TextArea', 'TextInput', 'registerText', 'textOf', 'mountStyle',
];

function clientFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { clientFiles(full, out); continue; }
    if (entry.name === 'client.jsx') out.push(full);
  }
  return out;
}

const files = clientFiles(path.join(root, 'packages'));

/** 取该文件从 ui-shared 导入的符号集合；没导入过返回 null。 */
function uiSharedImports(text) {
  const block = /import\s*\{([^}]*)\}\s*from\s*'@lybx-leyw\/dsh-zju-ui-shared'/.exec(text);
  if (block === null) return null;
  return new Set(block[1].split(',').map(s => s.trim()).filter(Boolean));
}

/** 该文件是否「使用了」某个跨包符号：`createElement(X)` 或 JSX `<X>` 都算。 */
function usesSymbol(text, name) {
  const asCall = new RegExp(`createElement\\(${name}\\b`).test(text);
  const asElement = new RegExp(`<${name}[\\s/>]`).test(text);
  return asCall || asElement;
}

test('从 ui-shared 取组件时，用到就必须在同一条 import 里', () => {
  const problems = [];
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    if (rel.includes('client/ui-shared')) continue;   // 定义方不适用
    const text = readFileSync(file, 'utf8');
    const imported = uiSharedImports(text);
    if (imported === null) continue;                  // 不引 ui-shared 的文件不在范围
    for (const name of SHARED) {
      if (imported.has(name)) continue;
      if (!usesSymbol(text, name)) continue;
      // 本地已有同名函数 —— 是重名，不是缺 import（本仓真有 `function textOf`）。
      if (new RegExp(`function ${name}\\s*\\(`).test(text)) continue;
      problems.push(`${rel}: 用了 ${name} 但没从 ui-shared import`);
    }
  }
  assert.deepEqual(problems, [], `以下文件会把整个槽打崩（ReferenceError）：\n${problems.join('\n')}`);
});

test('用到 locale 服务的插件必须把 locale 写进 inject', () => {
  const problems = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const needsLocale = /registerText\(/.test(text) || /ctx\??\.locale\b/.test(text);
    if (!needsLocale) continue;
    const inject = /export const inject\s*=\s*\[([^\]]*)\]/.exec(text);
    // 没有 inject 声明的客户端文件（纯页面注册）不取 locale，不在本条范围。
    if (inject === null) continue;
    if (!/'locale'/.test(inject[1])) {
      problems.push(`${path.relative(root, file).replaceAll('\\', '/')}: inject = [${inject[1].trim()}]`);
    }
  }
  assert.deepEqual(problems, [], `以下文件缺 locale 注入（Cordis 门禁会拒绝，静默退回中文）：\n${problems.join('\n')}`);
});

test('SHARED 清单必须与 ui-shared 的实际导出一致', () => {
  // 这条防的是「清单腐烂」：新组件加进 ui-shared 但忘了加进 SHARED，
  // 守卫就会对它失效（上面那条测试仍然绿，但拦不住真 bug）。
  const source = readFileSync(path.join(root, 'packages/client/ui-shared/src/client.jsx'), 'utf8');
  const block = /export\s*\{([^}]*)\}\s*from\s*'\.\/settings-kit\.jsx'/.exec(source);
  assert.ok(block !== null, '找不到 settings-kit 的导出块');
  // 只比较「组件/函数」名：全大写的常量（SETTINGS_CSS 等）不是组件，不需要进 SHARED。
  const exported = block[1]
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .filter(name => !/^[A-Z][A-Z0-9_]*$/.test(name));
  const missing = exported.filter(name => !SHARED.includes(name));
  assert.deepEqual(missing, [], `以下组件已在 ui-shared 导出，但不在 SHARED 清单里（守卫会对它们失效）：\n${missing.join(', ')}`);
});
