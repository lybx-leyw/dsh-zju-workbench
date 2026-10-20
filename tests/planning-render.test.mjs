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
          builder.onResolve({ filter: /^dsh-zhiyun-ui-primitives$/ }, () => ({ path: 'stub', namespace: 'stub' }));
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
  assert.match(html, /规划/, '应出现页面标题');
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
