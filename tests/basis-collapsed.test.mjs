/**
 * 原文依据默认收起，可展开。
 *
 * # 为什么默认收起
 *
 * 原文依据是「核对用的证据」—— 用户在怀疑解析时才需要看。
 * 默认展开会让每次作答都多读一段引用，把解析的注意力分走。
 *
 * # 为什么用原生 <details>
 *
 * 不引 JS 状态：键盘可达（Enter/Space 展开）、屏幕阅读器识别为可展开区域、
 * 折叠状态由浏览器维护，组件重渲染不会丢。
 *
 * 用法：node tests/basis-collapsed.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = p => fs.readFileSync(path.resolve(p), 'utf8');

const practice = read('packages/dsh-zhiyun-page-quiz/src/question-bank.jsx');
const history = read('packages/dsh-zhiyun-page-quiz/src/question-history.jsx');
const css = read('packages/dsh-zhiyun-page-quiz/src/style.css');

test('练习页的原文依据用 details 包裹', () => {
  assert.match(practice, /<details className="zs-qz-basis">/, '必须是可折叠容器');
  assert.match(practice, /<summary>原文依据<\/summary>/, '标题在 summary 里');
});

test('details 不带 open 属性 —— 默认收起', () => {
  assert.ok(
    !/<details[^>]*className="zs-qz-basis"[^>]*\sopen/.test(practice),
    '默认要收起，不能给 details 加 open',
  );
  assert.ok(
    !/<details[^>]*\sopen[^>]*className="zs-qz-basis"/.test(practice),
    '默认要收起（属性顺序另一种写法）',
  );
});

test('历史题库页同样默认收起', () => {
  assert.match(history, /<details className="zs-qz-basis">/, '历史页也要折叠');
  assert.ok(!/<details[^>]*\sopen/.test(history), '历史页也不能默认展开');
});

test('原文依据不再直接铺在正文里', () => {
  assert.ok(!/<blockquote>原文依据/.test(practice), '练习页不该再用 blockquote 直接展示');
  assert.ok(!/<blockquote>原文依据/.test(history), '历史页同理');
});

test('展开后的内容是富文本（公式仍能渲染）', () => {
  assert.match(practice, /<details className="zs-qz-basis">[\s\S]{0,220}<RichText/, '依据里可能有公式，要走 RichText');
});

test('summary 可点击且有键盘焦点环', () => {
  assert.match(css, /\.zs-qz-basis > summary[^}]*cursor:\s*pointer/, 'summary 要显示可点击');
  assert.match(css, /\.zs-qz-basis > summary:focus-visible/, '要有键盘焦点环');
});

test('自绘展开箭头，且展开时旋转', () => {
  assert.match(css, /\.zs-qz-basis > summary::before/, '要自绘箭头');
  assert.match(css, /\.zs-qz-basis\[open\] > summary::before/, '展开态要变向');
  assert.match(css, /rotate\(90deg\)/, '箭头旋转 90 度表示展开');
});

test('隐藏浏览器默认的三角标记', () => {
  assert.match(css, /\.zs-qz-basis > summary::-webkit-details-marker/, 'WebKit 默认标记');
  assert.match(css, /list-style:\s*none/, '标准属性也要关掉');
});
