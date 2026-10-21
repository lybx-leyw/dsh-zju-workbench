/**
 * 「规划」页**能渲染出来**——不是"语法正确"，是"跑起来不炸"。
 *
 * # 为什么需要这个文件
 *
 * 新版加「日历 / 卡片完成 / 平台待办勾选」时，我把几个 `const`（`openTodos` 等）
 * 写在了 `groups` 之后，而 `groups` 的 `useMemo` 体里直接引用它们。`const` 有
 * 暂时性死区，于是**首次渲染就抛 ReferenceError，整页白屏**。
 *
 * 而当时所有检查都是绿的：
 *   - `node --test` 全过（那些测的是宿主侧纯函数，不渲染 React）；
 *   - `scripts/build.mjs` 成功（esbuild 只看语法，TDZ 是运行时错误）；
 *   - `check-hf` / `check-css-order` 与渲染无关。
 *
 * 也就是说**没有任何一道闸拦得住白屏**。这个文件补上那一闸：真把组件渲染一次。
 *
 * 代价是它依赖 esbuild + react-dom/server（都是 devDependency），且比别的测试慢
 * 一秒左右 —— 换取"页面打不开"这类问题不可能再静默通过，值得。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * 把 `client.jsx` 打成可 import 的 ESM，并把 UI 原语换成最小桩。
 *
 * 打桩而不是装真的原语包：这个测试只回答"组件树能不能渲染出 HTML"，
 * 不关心图标长什么样。桩越薄，失败时越容易归因到被测代码本身。
 *
 * @param suffix - 让两次构建不共用模块缓存。
 * @returns 客户端包导出的模块。
 */
async function loadClient(suffix = '') {
  const { build } = await import('esbuild');
  const dir = await mkdtemp(path.join(root, '.verify-render-'));
  const outfile = path.join(dir, `client${suffix}.mjs`);
  try {
    await build({
      entryPoints: [path.join(root, 'packages/dsh-zhiyun-page-planning/src/client.jsx')],
      bundle: true,
      write: true,
      outfile,
      format: 'esm',
      jsx: 'automatic',
      logLevel: 'silent',
      // React 必须是 external：打进来会变成第二份 React，
      // hooks 拿到 null dispatcher（"Invalid hook call"），与本测试想抓的问题无关。
      external: ['react', 'react/jsx-runtime', 'react-dom'],
      loader: { '.css': 'text' },
      plugins: [{
        name: 'stub-primitives',
        setup(builder) {
          builder.onResolve({ filter: /^dsh-zhiyun-shell-ui$/ }, () => ({ path: 'stub', namespace: 'stub' }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `
              import React from "react";
              export const Icon = () => React.createElement("i");
              export const Mark = () => null;
              export const StudentAvatar = () => null;
              export const Empty = (props) => React.createElement("div", null, props.title, props.children);
              export const SectionTitle = (props) => React.createElement("div", null, props.children, props.aside);
              export const Notice = (props) => React.createElement("div", null, props.children);
              export const useStore = (store) => store.getSnapshot();
              export const useStudy = (controller) => controller.getSnapshot();
              export const mountStyle = () => {};
            `,
            loader: 'jsx',
            resolveDir: root,
          }));
        },
      }],
    });
    return await import(`file://${outfile.replace(/\\/g, '/')}?v=${suffix}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('页面组件能真的渲染出 HTML（白屏的第一道闸）', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('a');

  assert.equal(typeof client.Planning, 'function', '必须导出页面组件');

  // ⚠️ 这一行就是全部的守卫：`const` 的暂时性死区、引用未定义的变量、
  //    hooks 顺序错乱 —— 都会在这里抛出来而不是在用户屏幕上变成白屏。
  const html = renderToStaticMarkup(React.createElement(client.Planning, { ctx: null }));
  assert.ok(html.length > 200, `渲染结果太短，可能是空页面：${html.length}`);
  assert.match(html, /zpg-page/, '应渲染出页面的根节点');
  /**
   * ⚠️ 这里**不再断言出现「规划」二字**。
   *
   * 页头的大标题已按设计去掉：侧栏已经写着「规划」，页面里再写一遍是重复。
   * 而这条断言的本意只是"别渲染成白屏"，所以改成检查**真正稳定的结构**。
   *
   * 注意：这个用例在**无缓存**下渲染，`loading` 初始为 true（页面会先显示
   * 「正在读取」），所以写入口还没出现 —— 那是真实行为，不该被断言成"必须有"。
   * 稳定的锚点是根节点与工具行：它们无论加载与否都在。
   */
  assert.match(html, /zpg-tools/, '应渲染出工具行（加载中也存在）');
  assert.match(html, /zpg-head/, '应渲染出页头');
});

test('两个设置分区都能渲染（拆开之后各自都要能站住）', async () => {
  // 原来只有一个 `SettingsSection`（中转站 + 拼题A 挤在一起）。现在拆成两个独立分区，
  // 所以两个都要单独验证 —— 白屏在设置里同样会露出来。
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('b');

  assert.equal(typeof client.PtaSection, 'function', '拼题A 分区必须导出');
  assert.equal(typeof client.RelaySection, 'function', '个人中转站分区必须导出');
  // 旧的那个合并组件必须已经不存在 —— 留着会让人以为还能注册
  assert.equal(client.SettingsSection, undefined, '旧的合并分区应已删除');

  const relay = renderToStaticMarkup(React.createElement(client.RelaySection));
  assert.ok(relay.length > 100, '中转站分区渲染结果为空的');
  assert.match(relay, /中转站域名/, '应出现域名配置字段');

  const pta = renderToStaticMarkup(React.createElement(client.PtaSection));
  assert.ok(pta.length > 100, '拼题A 分区渲染结果为空的');
  assert.match(pta, /Cookie/, '应出现 Cookie 配置字段');
});

test('页面组件在没有宿主 ctx 时也不炸（这是它必须能独立打开的前提）', async () => {
  // 领域包停用、控制器缺席时，`ctx?.get?.('zhiyunStudyController')` 返回 undefined，
  // 课表上下文应该**安静地降级**而不是抛错 —— 这是"不与今天页合并"那条决定的直接后果。
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('c');

  for (const ctx of [null, undefined, {}, { get: () => undefined }]) {
    assert.doesNotThrow(
      () => renderToStaticMarkup(React.createElement(client.Planning, { ctx })),
      `ctx=${JSON.stringify(ctx)} 时不该抛错`,
    );
  }
});

/* ────────────────────────────── 添加入口：右下角浮动按钮 */

/**
 * 写入口原先常驻页面顶部（输入框 + 时间片 + 备注区），占首屏最大一块。
 * 但用户多数时候是来**看**的 —— 那一大块只在真要添的时候才有意义。
 *
 * 现在收成一个圆形「+」，点了才展开面板。这组测试钉住：
 *   1. **默认收起**：HTML 里没有输入框（否则首屏还是被它占着）；
 *   2. 按钮本身存在，且带 `aria-expanded`（读屏要知道它控制一个面板）；
 *   3. 它在**加载态也渲染** —— 用户可以先写一条，不必等数据读完。
 */
test('添加入口默认收起：HTML 里不出现输入框', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('d');

  const html = renderToStaticMarkup(React.createElement(client.Planning, { ctx: null }));

  assert.match(html, /zpg-fab/, '应渲染出浮动的添加入口');
  assert.equal(
    /zpg-composer-title/.test(html), false,
    '默认不该渲染输入框 —— 那会重新占掉首屏',
  );
  assert.match(html, /aria-expanded="false"/, '按钮要声明当前是收起的');
});

test('加载中也能添加入口（不必等数据读完）', async () => {
  // 无缓存时 loading 初始为 true，主体被替换成"正在读取" —— 但添加按钮必须还在
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('e');

  const html = renderToStaticMarkup(React.createElement(client.Planning, { ctx: null }));
  assert.match(html, /正在读取/, '这个用例的前提是处于加载态');
  assert.match(html, /zpg-fab/, '加载中也应能添加');
});

/* ────────────────────────────── 详情默认收起：点「查看详情」才展开 */

/**
 * 列表的任务是"认出哪一条"，不是读完所有内容（skill ch13 识别优于回忆）。
 * 把详情直接铺出来，每条都占两三行，扫一眼分不出主次。
 *
 * 三种行（平台待办 / AI 拆出的卡片 / 我的规划）现在共用同一个 `<details>`：
 * 形态一致，用户不用记住"哪类条目要点哪里"。
 *
 * 这组测试钉两件事：
 *   1. 有 detail 的行默认收起（HTML 里**有**内容，但 `<details>` 不带 `open`）；
 *   2. 用原生 `<details>` 而不是 CSS 折叠（后者会被朗读器读到，等于"看不见但存在"）。
 */
test('卡片详情默认收起，不在 HTML 里铺开', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('f');

  const card = { title: '写报告', action: '先把提纲列出来', detail: '周三前给导师', done: false, id: 'c1' };
  const html = renderToStaticMarkup(React.createElement(client.CardRow, { row: card, onToggle: () => {}, busy: false }));

  assert.match(html, /zpg-details/, '有详情就该有展开控件');
  assert.equal(
    /<details[^>]*\sopen/.test(html), false,
    '默认不该带 open 属性（那会一进来就展开）',
  );
});

test('没有 detail/action 的卡片不渲染展开控件', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('g');

  const card = { title: '买水果', done: false, id: 'c2' };
  const html = renderToStaticMarkup(React.createElement(client.CardRow, { row: card, onToggle: () => {}, busy: false }));

  assert.equal(/zpg-details/.test(html), false, '没有详情时不该多一个"查看详情"');
});

test('已完成的卡片不渲染详情（勾掉就是不想再看）', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient('h');

  const card = { title: '写报告', action: '先列提纲', detail: '周三前', done: true, id: 'c3' };
  const html = renderToStaticMarkup(React.createElement(client.CardRow, { row: card, onToggle: () => {}, busy: false }));

  assert.equal(/zpg-details/.test(html), false, '勾掉的卡片不该再带详情');
});
