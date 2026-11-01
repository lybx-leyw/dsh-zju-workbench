import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = path.join(ROOT, '.tmp', `teaching-progress-${process.pid}-${Date.now()}`);
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'teaching-progress.mjs');

const esbuild = await import('esbuild');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'packages/dsh-zhiyun-page-study/src/teaching-progress.jsx')],
  bundle: true, outfile: out, format: 'esm', platform: 'node', external: ['react', 'react-dom'],
  jsx: 'automatic', logLevel: 'silent',
});
const React = (await import('react')).default;
const { renderToStaticMarkup } = (await import('react-dom/server')).default;
const { TeachingProgress, formatElapsed } = await import(pathToFileURL(out).href);

const render = props => renderToStaticMarkup(React.createElement(TeachingProgress, props));

const running = (overrides = {}) => ({
  phase: 'html',
  chapterTotal: 3,
  chaptersDone: 1,
  slidesDone: 4,
  chapterProgress: [
    { chapterIndex: 0, chapterId: 'c1', title: '第一章', status: 'done', slidesDone: 4, scenesTotal: 4 },
    { chapterIndex: 1, chapterId: 'c2', title: '第二章', status: 'running', stage: 'html', slidesDone: 2, sceneIndex: 2, scenesTotal: 6 },
    { chapterIndex: 2, chapterId: 'c3', title: '第三章', status: 'pending', slidesDone: 0, scenesTotal: null },
  ],
  ...overrides,
});

test('names the current stage instead of only counting chapters', () => {
  const html = render({ progress: running(), startedAt: Date.now() });
  assert.match(html, /正在逐页生成图示/, '进行中的阶段要写出来');
  assert.match(html, /已备好 1\/3 章/);
  assert.match(html, /共 4 页/);
});

test('shows all three steps per chapter with explicit done/active/pending state', () => {
  const html = render({ progress: running(), startedAt: Date.now() });
  for (const label of ['预判理解障碍', '设计视觉讲解', '逐页生成图示']) assert.match(html, new RegExp(label));
  assert.match(html, /data-state="done"/);
  assert.match(html, /data-state="active"/);
  assert.match(html, /data-state="pending"/);
});

test('completed chapter shows all steps done, pending chapter shows none', () => {
  const html = render({ progress: running(), startedAt: Date.now() });
  // 第二章在第 3 步进行中：前两步 done。第三章还没轮到：三步都 pending。
  const chapterBlocks = html.split('<li data-status=').slice(1);
  const second = chapterBlocks.find(block => block.startsWith('"running"'));
  const third = chapterBlocks.find(block => block.startsWith('"pending"'));
  assert.equal((second.match(/data-state="done"/g) ?? []).length, 2, '进行中的章：前两步已完成');
  assert.equal((second.match(/data-state="active"/g) ?? []).length, 1);
  assert.equal((third.match(/data-state="pending"/g) ?? []).length, 3, '未开始的章：三步都未开始');
  assert.doesNotMatch(third, /data-state="active"/);
});

test('every chapter from the brief is listed, including not-yet-started ones', () => {
  const html = render({ progress: running(), startedAt: Date.now() });
  for (const title of ['第一章', '第二章', '第三章']) assert.match(html, new RegExp(title));
});

test('progress bar reports a real percentage and stuck-at-zero is not silent', () => {
  const partial = render({ progress: running(), startedAt: Date.now() });
  assert.match(partial, /role="progressbar"/);
  assert.match(partial, /aria-valuenow="33"/, '1/3 章 = 33%');
  assert.match(partial, /33%/);
  // 一章都没完成时百分比是 0，但阶段文字仍然说明在做什么。
  const early = render({ progress: running({ chaptersDone: 0, chapterProgress: [] }), startedAt: Date.now() });
  assert.match(early, /aria-valuenow="0"/);
  assert.match(early, /正在逐页生成图示/, '0% 时必须仍能看出在做什么');
});

test('unknown stage is shown verbatim rather than faked as a known step', () => {
  const html = render({ progress: running({ phase: 'html-something-new' }), startedAt: Date.now() });
  assert.match(html, /html-something-new/);
});

test('elapsed time is rendered and formatted readably', () => {
  assert.equal(formatElapsed(0), '0 秒');
  assert.equal(formatElapsed(6_000), '6 秒');
  assert.equal(formatElapsed(134_000), '2 分 14 秒');
  assert.equal(formatElapsed(3_600_000), '60 分 0 秒');
  // 负值/脏值不倒射出奇怪的时间
  assert.equal(formatElapsed(-5), '0 秒');
  const html = render({ progress: running(), startedAt: Date.now() - 134_000 });
  assert.match(html, /已用 2 分 14 秒/);
});

test('without a startedAt no timer text is rendered', () => {
  assert.doesNotMatch(render({ progress: running() }), /已用/);
});

test('resume shows the pages recovered from disk, not a fresh zero', () => {
  // 续跑开场：还没有阶段事件，但盘上已有 3 页。
  const html = render({ progress: {
    phase: null, chapterTotal: 2, chaptersDone: 0, slidesDone: 3,
    chapterProgress: [
      { chapterIndex: 0, chapterId: 'c1', title: '第一章', status: 'running', resumed: true, slidesDone: 3, sceneIndex: 2, scenesTotal: 5 },
      { chapterIndex: 1, chapterId: 'c2', title: '第二章', status: 'pending', slidesDone: 0 },
    ],
  }, startedAt: Date.now() });
  assert.match(html, /正在继续上次的进度/, '没有阶段事件但已有存档时要说清楚在续跑');
  assert.match(html, /其中 3 页是上次画好的/, '要让用户看到上次的成果没丢');
  assert.match(html, /已定 3 页/);
});

test('resume stage names are recognised, unknown ones still fall through verbatim', () => {
  assert.match(render({ progress: running({ phase: 'html-resume' }), startedAt: Date.now() }), /正在继续上次的进度/);
  assert.match(render({ progress: running({ phase: 'html-scene-reused' }), startedAt: Date.now() }), /正在继续上次的进度/);
  assert.match(render({ progress: running({ phase: 'html-unknown-future' }), startedAt: Date.now() }), /html-unknown-future/);
});

test('accessibility: step state is announced, not only colour-coded', () => {
  const html = render({ progress: running(), startedAt: Date.now() });
  assert.match(html, /class="zs-teach-sr-only"[^>]*>(已完成|进行中|未开始)</);
  assert.match(html, /aria-label="备课总进度/);
});
