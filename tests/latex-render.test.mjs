/**
 * 验证题目文本里的 LaTeX 真的会被渲染成 KaTeX 节点。
 *
 * # 为什么不直接渲染 MarkdownText
 *
 * 宿主 primitives 包依赖 `simple-icons`（peer dep），本仓库没装，
 * 直接 import 会失败。所以分两层验证：
 *
 *   一层：确认宿主解析器**认识**我们要用到的分隔符 —— 读它的实现，
 *         断言 mathFlow / mathText 的分支存在。这是「会不会被识别」。
 *   二层：确认 KaTeX 能把取出的公式**渲染出来** —— 直接调 katex。
 *         这是「认出来之后能不能画」。
 *
 * 两层都过，等于「$...$ 从解析到渲染」这条链是通的。
 * 任何一层缺失都会让题目里的公式显示成原始 TeX 文本，所以都得测。
 *
 * 用法：node tests/latex-render.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve('.');
const require = createRequire(path.join(ROOT, 'package.json'));

const PRIMITIVES = path.join(ROOT, 'node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/index.js');
const PAGE = path.join(ROOT, 'packages/dsh-zhiyun-page-quiz/src/question-bank.jsx');

const primitivesSrc = fs.existsSync(PRIMITIVES) ? fs.readFileSync(PRIMITIVES, 'utf8') : '';
const pageSrc = fs.readFileSync(PAGE, 'utf8');

// ── 第一层：宿主的解析器认识哪些分隔符 ──────────────────────────────

test('宿主的 Markdown 渲染器内置 KaTeX', { skip: !primitivesSrc }, () => {
  assert.match(primitivesSrc, /from ["']katex["']/, '必须 import katex');
  assert.match(primitivesSrc, /katex\.renderToString/, '必须真的调用渲染');
  assert.match(primitivesSrc, /katex\/dist\/katex\.min\.css/, '自带样式，页面不用再引一份');
});

test('解析器认识 $x$ 与 $$x$$（mathText / mathFlow 节点）', { skip: !primitivesSrc }, () => {
  assert.match(primitivesSrc, /"inlineMath"/, '行内公式节点');
  assert.match(primitivesSrc, /case "math":/, '块级公式节点');
  assert.match(primitivesSrc, /mathFlow/, '块级公式的 micromark 构造');
  assert.match(primitivesSrc, /mathText/, '行内公式的 micromark 构造');
});

test('解析器认识反斜杠括号写法（mathText 检查 backslash + leftParenthesis）', { skip: !primitivesSrc }, () => {
  // 这两行是决定性的：它说明 \\( ... \\) 不需要我们提前转换成 $...$
  assert.match(primitivesSrc, /code !== codes\.backslash/, '识别反斜杠起始');
  assert.match(primitivesSrc, /code !== codes\.leftParenthesis/, '识别左括号');
});

test('解析失败时降级成错误标记而不是抛异常', { skip: !primitivesSrc }, () => {
  assert.match(primitivesSrc, /katex-error/, '要有兜底的 error span');
  assert.match(primitivesSrc, /strict:\s*["']ignore["']/, '二次尝试用宽松模式');
});

// ── 第二层：KaTeX 真的能把公式画出来 ────────────────────────────────

test('KaTeX 能渲染行内公式', () => {
  const katex = require('katex');
  const html = katex.renderToString('x^2 + y^2 = 1', { displayMode: false, throwOnError: true });
  assert.match(html, /class="katex"/, '要有 katex 容器');
  assert.match(html, /<math|mathml/, '要有 MathML 无障碍层');
  assert.match(html, /katex-html/, '要有视觉层');
});

test('KaTeX 能渲染块级公式', () => {
  const katex = require('katex');
  const html = katex.renderToString('\\int_0^1 x^2 dx = \\frac{1}{3}', { displayMode: true, throwOnError: true });
  assert.match(html, /katex-display/, '块级公式要有 katex-display');
});

test('KaTeX 能渲染中文题目里常见的分式与概率符号', () => {
  const katex = require('katex');
  for (const tex of ['\\frac{1}{6}', 'P(A \\cup B)', '\\sum_{i=1}^{n} x_i', '\\lim_{x \\to 0}']) {
    const html = katex.renderToString(tex, { displayMode: false, throwOnError: true });
    assert.ok(html.includes('katex'), `${tex} 应能渲染`);
  }
});

// ── 第三层：刷题页确实把题目接到了这套渲染上 ────────────────────────

test('刷题页引入了宿主的 MarkdownText', () => {
  assert.match(pageSrc, /import \{ MarkdownText \} from '@deepseek-ai\/dsh-client-ui-primitives'/);
  assert.match(pageSrc, /<MarkdownText/, '必须真的渲染它');
});

test('labels 是模块级常量（否则每次渲染重建组件表）', () => {
  assert.match(pageSrc, /^const MARKDOWN_LABELS = \{/m, '必须是模块级常量');
  const uses = pageSrc.match(/labels=\{MARKDOWN_LABELS\}/g) ?? [];
  assert.ok(uses.length > 0, '渲染时必须传同一份 labels');
});

test('题干、选项、答案、解析四处都走富文本', () => {
  for (const [name, pattern] of [
    ['题干', /<RichText className="zs-qz-stem"/],
    ['选项', /<RichText className="zs-qz-choice-text"/],
    // 答案区改成了「标签 + RichText」的结构（判分增强时一并调整）：
    // 外层 .zs-qz-answer 带「答案」小标签，内容仍是 RichText
    ['答案', /zs-qz-answer["'][^>]*>\s*<span>答案<\/span>\s*<RichText/],
    ['解析', /<RichText className="zs-qz-explanation"/],
  ]) {
    assert.match(pageSrc, pattern, `${name}必须经过 RichText，否则那里的公式会显示成原始 TeX`);
  }
});

test('挖空标记在进 MarkdownText 之前就被替换掉', () => {
  // 否则 {{c1::答案}} 会被当成正文显示给用户
  assert.match(pageSrc, /question\.stem\.replace\(\/\\\{\\\{c\\d\+::/, 'questionText 要处理挖空');
});

test('不做多余的分隔符转换（宿主原生支持反斜杠写法）', () => {
  // 早先版本会把 \(...\) 改写成 $...$，读实现后确认没必要
  assert.ok(
    !/replace\(\/\\\\\\\\\\\[\/\g/.test(pageSrc),
    '不要自己转换分隔符 —— 宿主的 mathText 分支已经支持',
  );
});
