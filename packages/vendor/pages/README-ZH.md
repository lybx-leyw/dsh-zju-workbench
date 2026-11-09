# dsh-pages

npm 包名：`@lybx-leyw/dsh-pages`。仓库名和插件 id 仍为 `dsh-pages`。

[English](<https://github.com/lybx-leyw/dsh-pages/blob/chore/initial-import/README.md>) | 中文

![dsh-pages 与原生 DSH 工作台](<https://raw.githubusercontent.com/lybx-leyw/dsh-pages/refs/heads/chore/initial-import/docs/screenshot.png>)

为 DeepSeek Harness 增加常驻页面导航栏，内置 **DSH 工作台**和**页面管理**。可添加自己的页面，不替换、不重挂载原生工作台。

## 安装

需要 Node.js **22.x 中的 22.19+，或 24+**，以及 DSH Web 宿主。本包是 DSH 插件，不是独立网页应用。

在目标 DSH profile 目录执行：

```sh
npm install @lybx-leyw/dsh-pages
```

将 `@lybx-leyw/dsh-pages` 追加到该 profile 的 `dsh.profile.bundles`，保留宿主 bundle 和已有插件。例如：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@lybx-leyw/dsh-pages"]
    }
  }
}
```

安装后重启目标 DSH 宿主，并刷新其网页。

## 页面管理

打开**页面管理**调整导航：

- **顶部组**：导航栏顶部的普通入口。
- **回收组**：收起的页面；非空时显示 **…**，仍能从中打开页面。
- **底部组**：导航栏底部的入口。
- 可切换分组、排序、打开或回收页面，管理页自身也遵循相同规则。
- 固定回收页面后，在顶部组的 **…** 后追加快捷入口。页面仍留在回收菜单中，取消固定只移除快捷入口。
- 导航位置可选 **左侧、顶部、底部、右侧**，默认左侧，始终常驻；切换立即生效并记住选择。
- 导航尺寸可设为 **40–96px**，默认 **64px**；左右为宽度、上下为高度，图标、按钮、间距和留白同比缩放。横向排列时顶部组位于起始端、底部组位于末尾端；入口过多可沿导航方向滚动。
- 原生工作台和外部页面都为当前停靠边预留空间；“更多页面”菜单向内容区展开，并随滚动或窗口尺寸变化保持在视口内。

修改立即生效。排列和宽度保存在同一浏览器、同一 origin 的本地偏好中，不跨设备或标签页同步。

## 添加页面

贡献页面的客户端插件需注入 `pages` 和 `slots`。导航元数据与内容使用同一 id，并分别用 effect 管理注册生命周期：

```jsx
export const inject = ['pages', 'slots'];

export function apply(ctx) {
  ctx.effect(() => ctx.pages.registerPage({
    id: 'notes', label: '笔记', region: 'top', order: 10,
  }));

  ctx.effect(() => ctx.slots.inject('page.content', () =>
    ctx.slots.register({ name: 'page.content', key: 'notes' }, NotesPage)
  ));
}
```

`NotesPage` 是你自己的 React 组件。存活页面 id 必须唯一。移除活动页面后返回工作台；保存的偏好不会凭空恢复已卸载的页面。示例使用默认内容槽名。

产品 bundle 也可从 `@lybx-leyw/dsh-pages/client` 导入 `apply` 或 `applyWithConfig`，通过代码安装页面壳。安装插件应注入 `slots` 和 `locale`，不要注入它自己将创建的 `pages` 服务。两种安装方式选其一，不要重复安装。`./client` 使用条件导出：DSH 宿主读取的 `default` 仍为会自注册的加载包，标准 ESM `import` 则选用可导入模块。

## 导航栏当前页操作槽

导航栏顶部的 `page.rail-action` 是独立的 keyed 槽，使用当前页面 id 选择组件（包括 `home` 和 `pages`）。组件收到 `pageId`、`railWidth` 和 `railPosition`，可渲染纯图标或自带事件、无障碍标签的按钮；壳不额外包装按钮或绑定点击事件。

```jsx
function NotesAction({ pageId }) {
  return <button aria-label="新建笔记" onClick={() => createNote(pageId)}>＋</button>;
}

// 在贡献页面的 apply(ctx) 中，与页面注册一起由 effect 管理：
ctx.effect(() => ctx.slots.inject('page.rail-action', () =>
  ctx.slots.register({ name: 'page.rail-action', key: 'notes' }, NotesAction)
));

// 可选：用户/产品的占位图标；卸载时恢复先前设置。
ctx.effect(() => {
  const previous = ctx.pages.getSnapshot().railPlaceholderIcon;
  ctx.pages.setRailPlaceholderIcon(ProductIcon);
  return () => ctx.pages.setRailPlaceholderIcon(previous);
});
```

回退顺序：当前页槽位组件 → `railPlaceholderIcon` → **P /**。仅当该页没有槽位贡献时回退，组件主动返回 null 不触发回退。切页卸载旧操作组件，清理其 React effects，再挂载新页组件；注册本身存活至插件 effect 销毁。图标组件不写入 localStorage。代码安装也可传入 `railPlaceholderIcon` 与自定义 `railActionSlot`（必须以 `page.` 开头且不同于内容槽）。这不修改任何原生 DSH 槽协议。

## 限制

- 原生设置仍归 DSH 所有；不导出原生槽、不重建设置、不自动把浮窗转为页面。
- 被覆盖的原生 UI 保持挂载；切页不会停止原生插件、后台任务或全局快捷键。
- 插件共享文档与服务，本包不是安全沙箱。
- 兼容性取决于宿主槽契约、overlay 层级、root 几何与浏览器 CSS 支持；未验证任意第三方组合。
- 存储失败时仍能在内存中操作，但偏好可能无法跨刷新保留。

## 相关链接

- [设计与生命周期边界](<https://github.com/lybx-leyw/dsh-pages/blob/chore/initial-import/DESIGN-ZH.md>)
- [发布检查清单](<https://github.com/lybx-leyw/dsh-pages/blob/chore/initial-import/VERSIONING.md>)
- [问题反馈](<https://github.com/lybx-leyw/dsh-pages/issues>)

## 许可证

[MIT](<https://github.com/lybx-leyw/dsh-pages/blob/chore/initial-import/LICENSE>)
