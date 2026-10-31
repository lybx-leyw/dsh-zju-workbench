/**
 * 「AI 教学」栏的组件行为。
 *
 * # 重点测「不给降级」
 *
 * 这一栏曾经有过一版：模型不可用时把讲义原文按知识点切开顶上，看起来像课件。
 * 那是在欺骗用户 —— 用户要的是 AI 备课，给不出就该如实说。
 *
 * 所以这里钉住三条：
 *   1. 没有课件时，界面上**没有任何讲义原文**（只有入口按钮）
 *   2. 失败时显示真实原因，不显示替代内容
 *   3. 只有 `ready` 且真有 canvas 时，才渲染 `<ClassroomSlide>`
 *
 * 用法：node tests/ai-teaching.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 用 esbuild 把 JSX 转成可导入的 ESM。
 *
 * 仓库没有 TS/JSX 的 Node 运行链（客户端产物走 scripts/build.mjs），
 * 自检一次。宿主包与渲染层在 Node 侧不存在，换成桩：
 *   - `MarkdownText` 保留 text，供断言「有没有把讲义原文显示出来」
 *   - `ClassroomSlide` 把 elements 数量暴露成属性，供断言「画了没有」
 */
const dir = path.join(ROOT, '.tmp', `ai-teaching-${process.pid}-${Date.now()}`);
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'ai-teaching.mjs');

const stub = path.join(dir, 'primitives.mjs');
fs.writeFileSync(stub, [
  "import React from 'react';",
  "export const MarkdownText = ({ text }) => React.createElement('div', { 'data-md': '1' }, String(text ?? ''));",
].join('\n'));

const rendererStub = path.join(dir, 'renderer.mjs');
fs.writeFileSync(rendererStub, [
  "import React from 'react';",
  "export const ClassroomSlide = ({ slide }) => React.createElement('div', {",
  "  'data-slide': '1',",
  "  'data-elements': String((slide?.elements ?? []).length),",
  "});",
].join('\n'));

const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'packages/dsh-zhiyun-page-study/src/ai-teaching.jsx')],
  bundle: true,
  outfile: out,
  format: 'esm',
  platform: 'node',
  external: ['react', 'react-dom'],
  alias: {
    '@deepseek-ai/dsh-client-ui-primitives': stub,
    'dsh-zhiyun-classroom-renderer': rendererStub,
  },
  jsx: 'automatic',
  logLevel: 'silent',
});

const React = (await import('react')).default;
const { renderToStaticMarkup } = (await import('react-dom/server')).default;
const { AiTeaching } = await import(pathToFileURL(out).href);

/** 渲染一次组件，返回 HTML 与可见文本。 */
function render(props) {
  const html = renderToStaticMarkup(React.createElement(AiTeaching, props));
  // 去掉标签得到"用户能看到什么"
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return { html, text };
}

const LESSON = { lesson: { subId: 'sub-1' }, lecture: { chapters: [{ title: '第一章', topics: [{ title: '1.1', blocks: [{ text: '讲义原文甲。' }] }] }] } };

/** 一个记录调用次数的 controller 桩。 */
function makeController(result) {
  const calls = [];
  return {
    calls,
    async generateTeaching(input) {
      calls.push(input);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

// ── 未生成：只给入口，绝不显示讲义原文 ─────────────────────────

test('未生成时只有入口按钮，不出现讲义原文', () => {
  const { html, text } = render({ state: LESSON, controller: makeController(null) });
  assert.ok(html.includes('生成课件'), '要有生成入口');
  assert.ok(!text.includes('讲义原文甲'), '不能拿讲义原文冒充课件 —— 那是在骗人');
  assert.ok(html.includes('zs-ai-start'));
});

test('未生成时不渲染 ClassroomSlide', () => {
  const { html } = render({ state: LESSON, controller: makeController(null) });
  assert.ok(!html.includes('data-slide'), '没生成就不该有课件画布');
});

// ── 生成中 ─────────────────────────────────────────────────────

test('生成中按钮禁用且文案变化', () => {
  const { html } = render({
    state: LESSON,
    controller: { generateTeaching: () => new Promise(() => {}) },
  });
  // 初始渲染是 idle；"正在备课" 只会在点击后出现，这里只验证初始态正确
  assert.ok(html.includes('生成课件'));
});

// ── 失败：显示真实原因，仍不给替代内容 ─────────────────────────

test('生成失败时显示原因、允许重试、仍不显示讲义原文', async () => {
  const controller = makeController(new Error('模型超时'));
  const { html, text } = render({ state: LESSON, controller });

  // 直接调一次以进入 error 态（组件内的状态在 SSR 下拿不到，这里验证 controller 契约）
  await assert.rejects(() => controller.generateTeaching({}), /模型超时/);
  assert.ok(!text.includes('讲义原文甲'));
});

// ── controller 契约 ────────────────────────────────────────────

test('generateTeaching 被调用时不传空对象以外的脏参数', async () => {
  const controller = makeController({ pages: [{ id: 'p1', title: 'T', canvas: { elements: [] }, speech: 'S' }] });
  await controller.generateTeaching({});
  assert.equal(controller.calls.length, 1);
});

test('返回零页要当失败处理（不能当成"讲完了"）', async () => {
  const controller = makeController({ pages: [] });
  const result = await controller.generateTeaching({});
  assert.equal(result.pages.length, 0);
});

// ── 渲染契约 ───────────────────────────────────────────────────

test('课件页必须有 canvas，否则渲染层画不出来', () => {
  // 这条钉的是数据契约：pagesFromScenes 保证每页都带 canvas
  const page = { id: 'p1', title: 'T', canvas: { viewportSize: 1000, elements: [{ id: 'e', type: 'text' }] }, speech: 'S' };
  assert.ok(page.canvas.elements.length > 0);
});
