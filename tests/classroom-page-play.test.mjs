/**
 * 「课堂播放」页能渲染出来 —— 不是"语法正确"，是"跑起来不炸"。
 *
 * 这一页的失败模式与「规划」页那次同类：四类场景各走一条分支，任一分支在首次
 * 渲染时抛（TDZ / 空数据解引用），整页就是白屏，而 `node --test` 平时测的都是纯
 * 函数，esbuild 只看语法，谁也拦不住。
 *
 * 所以这里真把 `src/client.jsx` 打出来渲染一次，并逐场核对四类场景各自的标记：
 *   - slide：交给 `<ClassroomStage>`（用桩替换，断言收到 scene / ledger / width）；
 *   - quiz：题面、选项、对错反馈三块都在；判定规则单独用 `correctIndexOf` 验；
 *   - interactive：`<iframe srcdoc>`；
 *   - pbl：briefing 与交付物清单。
 * 另外守一条：空 classroom 显示空状态，而不是一片空白。
 *
 * 打桩两个 external（`dsh-zhiyun-shell-ui`、`dsh-zhiyun-core-classroom-stage`）：
 * 前者与本页无关，后者自带 renderer 的 vendor 树（motion / echarts / shiki），
 * 把整棵树拖进来只会让失败难归因，而舞台本身的 SSR 已由 classroom-stage.test.mjs 覆盖。
 *
 * 跑法：`node --test tests/classroom-page-play.test.mjs`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

const SHELL_STUB = `
  import React from "react";
  export const mountStyle = () => {};
  export const Icon = () => React.createElement("i");
`;

/** 渲染层桩：只留一个能被舞台认出的组件。 */
const RENDERER_STUB = `
  import React from "react";
  export function ClassroomSlide({ slide }) {
    return React.createElement("div", { className: "zyc-classroom-slide", "data-slide": slide?.id }, "slide");
  }
`;

/** 舞台桩：把「收到了什么」原样挂到 DOM 上，便于断言 slide 真的交给了它。 */
const STAGE_STUB = `
  import React from "react";
  export function ClassroomStage({ scenes = [], ledger = [], width = 800, autoplay = true, renderer }) {
    const scene = scenes[0];
    const slide = scene?.content?.canvas;
    return React.createElement("div", {
      className: "zyc-stage",
      "data-stage-scene": scene?.id,
      "data-autoplay": String(autoplay),
      "data-width": width,
      "data-records": (Array.isArray(ledger) ? ledger : []).length,
      "data-renderer": typeof renderer === "function" ? "explicit" : "default",
    }, slide
      ? (slide.elements || []).map((element) => React.createElement("span", { key: element.id, "data-slide-el": element.id }, element.content))
      : "没有可播放的场景");
  }
  export default ClassroomStage;
`;

/**
 * 把 `client.jsx` 打成可 import 的 ESM。
 *
 * @returns 客户端包导出的模块。
 */
async function loadClient() {
  const { build } = await import('esbuild');
  const dir = await mkdtemp(path.join(root, '.verify-play-'));
  const outfile = path.join(dir, 'client.mjs');
  try {
    await build({
      entryPoints: [path.join(root, 'packages/dsh-zhiyun-page-classroom-play/src/client.jsx')],
      bundle: true,
      write: true,
      outfile,
      format: 'esm',
      jsx: 'automatic',
      logLevel: 'silent',
      // React 必须 external：打进来会变成第二份 React，hooks 拿到 null dispatcher。
      external: ['react', 'react/jsx-runtime', 'react-dom'],
      loader: { '.css': 'text' },
      plugins: [{
        name: 'stub-externals',
        setup(builder) {
          builder.onResolve({ filter: /^dsh-zhiyun-shell-ui$/ }, () => ({ path: 'shell', namespace: 'stub' }));
          builder.onResolve({ filter: /^dsh-zhiyun-core-classroom-stage$/ }, () => ({ path: 'stage', namespace: 'stub' }));
          builder.onResolve({ filter: /^dsh-zhiyun-classroom-renderer$/ }, () => ({ path: 'renderer', namespace: 'stub' }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: args.path === 'shell' ? SHELL_STUB : args.path === 'stage' ? STAGE_STUB : RENDERER_STUB,
            loader: 'jsx',
            resolveDir: root,
          }));
        },
      }],
    });
    return await import(`file://${outfile.replace(/\\/g, '/')}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 一份含四类场景的 classroom（字段照 `buildClassroomManifest` 的清单形状）。 */
const DOC = {
  meta: { id: 'classroom-1', title: '线性代数：矩阵的秩' },
  assets: {},
  scenes: [
    {
      id: 'scene-slide',
      type: 'slide',
      title: '导入：矩阵的秩',
      order: 0,
      content: {
        type: 'slide',
        canvas: {
          id: 'slide-1',
          viewportSize: 1000,
          viewportRatio: 0.5625,
          elements: [
            { id: 'title', type: 'text', left: 100, top: 80, width: 800, height: 60, content: '秩就是有效的行数' },
          ],
        },
      },
      actions: [{ type: 'speech', text: '这一节我们看矩阵的秩。' }],
    },
    {
      id: 'scene-quiz',
      type: 'quiz',
      title: '随堂检测',
      order: 1,
      content: {
        type: 'quiz',
        questions: [{
          id: 'q1',
          stem: '矩阵 A（m×n）的秩不会超过',
          options: [
            { id: 'a', text: '行数 m' },
            { id: 'b', text: 'min(m, n)', correct: true },
            { id: 'c', text: 'm + n' },
          ],
          explanation: '秩不超过行数与列数的较小者。',
        }],
      },
    },
    {
      id: 'scene-interactive',
      type: 'interactive',
      title: '拖一拖：张成空间',
      order: 2,
      content: {
        type: 'interactive',
        html: '<!doctype html><html lang="zh"><body><p>把向量拖进张成空间</p></body></html>',
      },
    },
    {
      id: 'scene-pbl',
      type: 'pbl',
      title: '项目：用秩判断解的结构',
      order: 3,
      content: {
        type: 'pbl',
        briefing: { title: '项目简报', text: '给出一个线性方程组，判断解的自由度。' },
        deliverables: [
          { id: 'd1', title: '方程组的秩分析' },
          { id: 'd2', title: '解的几何解释', done: true },
        ],
      },
    },
  ],
};

const React = await import('react');
const { renderToStaticMarkup } = await import('react-dom/server');
const client = await loadClient();

/** 渲染第 index 场。 */
function renderAt(index, doc = DOC) {
  return renderToStaticMarkup(React.createElement(client.ClassroomPlay, {
    doc,
    width: 900,
    initialScene: index,
  }));
}

test('含四类场景的 classroom 在 renderToStaticMarkup 下不抛，四类标记都出现', () => {
  const html = renderAt(0);

  // 四类场景在进度条上各占一段（data-type 是这一页的类型标记）。
  for (const type of ['slide', 'quiz', 'interactive', 'pbl']) {
    assert.match(html, new RegExp(`class="zyc-play-progress-seg" data-type="${type}"`), `进度条缺 ${type}`);
  }
  // 标题、游标、控制条都在。
  assert.match(html, /zyc-play-title/);
  assert.match(html, /1 \/ 4/);
  assert.match(html, /上一场/);
  assert.match(html, /下一场/);
  assert.match(html, /朗读/);
  assert.match(html, /全屏/);
  // slide 交给舞台：scene 与账本原样传到，且不自动播放。
  assert.match(html, /class="zyc-play-canvas"/);
  assert.match(html, /class="zyc-stage"/);
  assert.match(html, /data-stage-scene="scene-slide"/);
  assert.match(html, /data-autoplay="false"/);
  assert.match(html, /data-width="900"/);
  assert.match(html, /data-records="1"/);
  assert.match(html, /data-renderer="explicit"/);
  assert.match(html, /data-slide-el="title"/);
  assert.match(html, /秩就是有效的行数/);
});

test('quiz：题面、选项与对错反馈都在，判定不吃"第一项是答案"', () => {
  const html = renderAt(1);
  assert.match(html, /zyc-play-scene--quiz/);
  assert.match(html, /zyc-play-quiz-stem/);
  assert.match(html, /矩阵 A（m×n）的秩不会超过/);
  assert.equal((html.match(/class="zyc-play-option"/g) ?? []).length, 3);
  assert.match(html, /min\(m, n\)/);
  // 还没有作答：反馈格存在但未判定。
  assert.match(html, /class="zyc-play-feedback" data-answered="false" data-correct="unknown"/);

  // 静态渲染点不了按钮，判定规则单独验：选项上的 correct 优先于其它字段。
  const question = DOC.scenes[1].content.questions[0];
  assert.equal(client.correctIndexOf(question), 1);
  assert.equal(client.correctIndexOf({ options: ['甲', '乙'], answer: 1 }), 1);
  assert.equal(client.correctIndexOf({ options: [{ id: 'x', text: '甲' }, { id: 'y', text: '乙' }], answer: 'y' }), 1);
  // 什么都没写时不判（返回 -1），而不是默认第 0 项。
  assert.equal(client.correctIndexOf({ options: ['甲', '乙'] }), -1);
});

test('interactive：用 iframe srcdoc 呈现，且带沙箱', () => {
  const html = renderAt(2);
  assert.match(html, /zyc-play-scene--interactive/);
  assert.match(html, /<iframe/);
  assert.match(html, /class="zyc-play-frame"/);
  // React 的服务端渲染把这两个属性写成驼峰（浏览器解析 HTML 时一律小写成
  // `srcdoc` / `referrerpolicy`，两者都合法），所以这里按原样匹配。
  assert.match(html, /srcDoc="/);
  assert.match(html, /把向量拖进张成空间/);
  assert.match(html, /referrerPolicy="no-referrer"/);
  assert.match(html, /sandbox="allow-scripts allow-forms allow-popups"/);
  assert.doesNotMatch(html, /allow-same-origin/);
});

test('pbl：briefing 与交付物清单都在', () => {
  const html = renderAt(3);
  assert.match(html, /zyc-play-scene--pbl/);
  assert.match(html, /zyc-play-briefing/);
  assert.match(html, /项目简报/);
  assert.match(html, /给出一个线性方程组，判断解的自由度。/);
  assert.match(html, /zyc-play-deliverables/);
  assert.equal((html.match(/class="zyc-play-deliverable"/g) ?? []).length, 2);
  assert.match(html, /方程组的秩分析/);
  assert.match(html, /解的几何解释/);
  // 已完成的交付物勾上（只在本页，不回写）。
  assert.match(html, /<input type="checkbox" checked=""/);
});

test('空 classroom 显示空状态，不出现进度条与舞台', () => {
  const html = renderToStaticMarkup(React.createElement(client.ClassroomPlay, {
    doc: { meta: { title: '空课堂' }, scenes: [], assets: {} },
  }));
  assert.match(html, /zyc-play-empty/);
  assert.match(html, /这一节课还没有场景/);
  assert.doesNotMatch(html, /zyc-play-progress-seg/);
  assert.doesNotMatch(html, /zyc-play-canvas/);
  // 控制条仍在，但两端都按不动。
  assert.match(html, /disabled=""/);
});

test('没有 doc、没有 classroomId 时是"没选中一节课"，不报错', () => {
  const html = renderToStaticMarkup(React.createElement(client.ClassroomPlay, {}));
  assert.match(html, /zyc-play-placeholder/);
  assert.match(html, /还没有选中一节课/);
});
