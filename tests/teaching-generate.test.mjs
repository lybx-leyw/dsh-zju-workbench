import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = path.join(ROOT, '.tmp', `teaching-generate-${process.pid}-${Date.now()}`);
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'teaching-generate.mjs');

// 只替身 React 之外的依赖：GenerationModels 用真身会把整个 quiz 页拖进来，
// 这里替成一个可观测的桩，断言「传了哪些 props」。
const stub = path.join(dir, 'quiz.mjs');
fs.writeFileSync(stub, [
  "import React from 'react';",
  "export const GenerationModels = (props) => React.createElement('div', {",
  "  'data-generation-models': '1',",
  "  'data-purpose': props.purpose,",
  "  'data-label': props.label,",
  "  'data-requires-vision': String(props.requiresVision),",
  "  'data-generation-disabled': String(props.generationDisabled),",
  "  'data-disabled': String(props.disabled),",
  "});",
].join('\n'));

// 学习页**不再 import 题库页**：它只从 ui-shared 的契约表取组件。
// 这里替身 ui-shared，让 `usePublishedComponent` 返回上面那个可观测的桩 ——
// 断言的事没变（传了哪些 props、有没有 `.zs-qz` 祖先），但不再跨页 import。
const sharedStub = path.join(dir, 'ui-shared.mjs');
fs.writeFileSync(sharedStub, "export { usePublishedComponent } from './published.mjs';\n");
fs.writeFileSync(path.join(dir, 'published.mjs'), [
  `import { GenerationModels } from ${JSON.stringify(stub)};`,
  "export const usePublishedComponent = (name) => name === 'quiz.generationModels' ? GenerationModels : undefined;",
].join('\n'));
const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'packages/client/page-study/src/teaching-generate.jsx')],
  bundle: true, outfile: out, format: 'esm', platform: 'node', external: ['react', 'react-dom'],
  alias: { '@lybx-leyw/dsh-zju-ui-shared': sharedStub },
  jsx: 'automatic', logLevel: 'silent',
});
const React = (await import('react')).default;
const { renderToStaticMarkup } = (await import('react-dom/server')).default;
const { TeachingGenerate } = await import(pathToFileURL(out).href);

const render = props => renderToStaticMarkup(React.createElement(TeachingGenerate, props));

test('reuses the provider+workers configuration panel instead of a bespoke number', () => {
  const html = render({ controller: {}, onGenerate() {} });
  assert.match(html, /data-generation-models="1"/, '必须复用 GenerationModels，而不是自造浮窗');
  assert.match(html, /data-purpose="teaching"/, '教学配额要单独一份，不能和解析/出题共用');
});

test('wraps the panel in .zs-qz so quiz styles actually apply', () => {
  const html = render({ controller: {}, onGenerate() {} });
  // GenerationModels 的每条样式都限定在 .zs-qz / .zs-qz-page 下；缺这一层，
  // 用真实浏览器量到 .zs-generation-split 会退回 display:block。
  assert.match(html, /class="zs-teach-generate zs-qz"/, '缺 .zs-qz 祖先时面板布局会失效');
});

test('no vision model required: teaching generates no images', () => {
  assert.match(render({ controller: {}, onGenerate() {} }), /data-requires-vision="false"/);
});

test('primary action stays available until a run is actually in flight', () => {
  const idle = render({ controller: {}, onGenerate() {} });
  assert.match(idle, /data-generation-disabled="false"/);
  assert.match(idle, /data-label="生成课件"/);
  const running = render({ controller: {}, running: true, onGenerate() {} });
  assert.match(running, /data-generation-disabled="false"/, '运行中不锁住配置入口，用户随时能看/改配额');
  assert.match(running, /data-label="正在备课…"/);
});

test('existing result switches the label to re-prepare', () => {
  assert.match(render({ controller: {}, hasResult: true, onGenerate() {} }), /data-label="重新备课"/);
});

test('the old bespoke chapter-concurrency popover is gone', () => {
  const source = fs.readFileSync(path.join(ROOT, 'packages/client/page-study/src/teaching-generate.jsx'), 'utf8');
  // 注释里会提到旧名字（说明为什么不用它），所以先把注释剥掉再断言。
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /chapterConcurrency/, '不能再出现独立的章节并发数字');
  assert.doesNotMatch(code, /zs-teach-panel/, '不能再自造一套 popover');
  assert.doesNotMatch(code, /<input/, '不再自己画输入框：配额编辑交给 GenerationModels');
  assert.match(code, /purpose="teaching"/);
});
