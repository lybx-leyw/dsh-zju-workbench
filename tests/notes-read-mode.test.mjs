/**
 * 笔记页阅读/编辑默认态的契约守卫。
 *
 * 这一条是产品口径，容易被后来的改动悄悄翻回去，所以用静态断言钉住：
 *
 *   1. **默认阅读** —— 笔记大多是拿来读的，Markdown 源码对读者不友好。
 *      同时它也是长文排版的入口：只有阅读态才走 `MarkdownText`。
 *   2. **新建笔记例外，进编辑态** —— 否则新建完用户看到的是一句「（空笔记）」，
 *      还得自己再点一次「编辑」才能开始写。这是个很容易漏的分支：把
 *      `useState(false)` 改成 `useState(true)` 时，新建流程不会报错，
 *      只是体验变差，测试也不会红。
 *   3. 阅读态**不能用 `variant="compact"`** —— 那个变体是给聊天气泡里的短
 *      Markdown 用的（13px/20px、标题被压平、段落 margin 4px），用在整页
 *      长文上就是「又小又挤」。
 *
 * 只读文件、纯静态比对：不起宿主、不跑构建。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const CLIENT = 'packages/dsh-zhiyun-page-notes/src/client.jsx';
const src = readFileSync(path.join(root, CLIENT), 'utf8');

test('阅读态是默认：preview 初值为 true', () => {
  const m = src.match(/const \[preview,\s*setPreview\]\s*=\s*useState\(([^)]*)\)/);
  assert.ok(m, '找不到 preview 状态声明');
  assert.equal(m[1].trim(), 'true', `preview 初值应为 true（当前是 ${m[1].trim()}）`);
});

test('新建笔记后切到编辑态，否则用户面对「（空笔记）」无从上手', () => {
  const at = src.indexOf('const createNote');
  assert.ok(at >= 0, '找不到 createNote');
  // 取到下一个顶层函数声明为止
  const end = src.indexOf('const createFolder', at);
  const body = src.slice(at, end === -1 ? at + 1200 : end);
  assert.ok(/openNote\(/.test(body), 'createNote 应当打开新建的那篇');
  assert.ok(/setPreview\(false\)/.test(body), 'createNote 里缺少 setPreview(false)');
});

test('阅读态不传 variant="compact"（那是聊天气泡的短 Markdown 变体）', () => {
  const at = src.indexOf('zs-nt-preview-body');
  assert.ok(at >= 0, '找不到阅读态容器');
  const body = src.slice(at, at + 900);
  // 注释里会提到 `variant="compact"` 作为反例，所以先剥注释再查真正会执行的代码。
  // ⚠️ 本仓的 .jsx 是 CRLF 换行：`//.*$` 在 `\r` 前匹配不到行尾，注释会残留，
  //    必须显式吃掉 `\r`。这条坑踩过一次（测试因此误报）。
  const code = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  assert.ok(/MarkdownText/.test(code), '阅读态应当用 MarkdownText 渲染');
  assert.ok(!/variant="compact"/.test(code), '阅读态不该用 compact 变体：13px/20px、标题被压平、段距 4px');
});

test('阅读/编辑切换按钮的文案与当前态对应', () => {
  // 阅读态时按钮要显示「编辑」（点它去编辑），编辑态时显示「阅读」。
  assert.ok(/\{preview \? '编辑' : '阅读'\}/.test(src), '切换按钮的文案反了或丢了');
});
