# dsh-zju-shell-workbench

ZJU Workbench 的界面外壳插件：侧栏、页框架、主题层、导航服务与插槽契约。当前验证宿主为 `0.2.0-rc.2`。宿主提供 React 和全部 DSH 客户端服务；不要再打包一份 React。

外壳**不认识任何具体页面**：它声明 `NAV` 里每个页面（除「问一问」是宿主原生会话）的面板骨架和内容插槽，页面由各自的插件包填充（`dsh-zhiyun-page-today / -paper / -study / -me / -plugins / -feedback`）。内容插槽按 `NAV` 的条目逐个注册：加一项导航就自动多一个 `zhiyun.<id>.content`。页面包没装时页面显示「暂时不可用」占位，外壳照常工作。

> **课程与回放只有一页**：`courses`（我的课）与 `player`（看课）曾经是独立的两页，
> 现已并入 `study`（学习）—— 课程目录是它的左栏、回放是正文区的一栏、整理是其余几栏。
> 导航因此只剩 `study` 一个入口，`dsh-zhiyun-page-courses` / `-player` 两个包已删除
> （列在 `scripts/profile.mjs` 的 `retiredBundles` 里，老 profile 会在初始化时被清掉）。

构建：在仓库根运行 `npm run build`。本地 profile 通过目录链接加载 `lib/`；修改源文件后需重新构建，涉及布局桥接的启用、停用和升级后须完整刷新页面。

## 页面插槽

外壳在桥接插件的 `zhiyun.shell.page` 插槽里为 `NAV` 的每一页声明一个 **root / single** 内容插槽（声明即认领，页面包只注册内容，不重复声明 `children`）：

| 插槽 | 内容位置 |
| --- | --- |
| `zhiyun.today.content` | 今天页正文 |
| `zhiyun.paper.content` | 论文阅读页正文 |
| `zhiyun.study.content` | 学习页正文（课程目录 + 回放 + 整理，全在这一页） |
| `zhiyun.plugins.content` | 插件依赖页正文 |
| `zhiyun.feedback.content` | 反馈页正文 |

侧栏那一列还声明了几个**控件插槽**（与页面无关）：

| 插槽 | 内容位置 |
| --- | --- |
| `sidebar.account.signin` | **账号对话框正文**（头像 → 登录） |

> 导轨**最下方那格圆形头像不是页面**：点它浮出账号菜单（登录 / 设置）。设置打开的是
> **宿主原生浮窗**（与 DSH 一致），「账号与数据」是它里面的一个分区。
> 登录对话框正文由 `dsh-zhiyun-settings-account` 注册进 `sidebar.account.signin` ——
> 登录是应用级动作，入口因此在头像那一层，不会因为任何页面被停用而消失。
>
> 这里曾经有一页「个人」（`dsh-zhiyun-page-me`）：它只为承载账号与设置，页面已删除，
> 内容并入原生设置。`NAV` 里不再有 `me`。

页面包在客户端导出 `inject: ['slots']`，然后：

```js
// 只用外壳给的 controller（今天页）：
export function apply(ctx) {
  ctx.slots.inject('zhiyun.today.content', () =>
    ctx.slots.register({ name: 'zhiyun.today.content' }, TodayPage)
  );
}

// 还要领域状态（学习）：先等 controller 到位，再注册插槽
export function apply(ctx) {
  ctx.inject(['zhiyunStudyController'], (scope) => {
    scope.slots.inject('zhiyun.study.content', () =>
      scope.slots.register({ name: 'zhiyun.study.content', priority: 10 },
        () => <StudyPage controller={scope.zhiyunStudyController} />)
    );
  });
}
```

页面组件同时从渲染参数里拿到外壳注入的 `controller`（`navigate / toggleTheme / openSettings / openAccount / toggleSidebar`）和 `renderSlot`。`ctx.slots.inject` 在声明已存在时立即执行，声明后到也会补执行，外壳卸载时贡献随之撤销（连同 `ctx.inject` 的作用域一起）。`openSettings()` 打开宿主原生设置浮窗；原生设置项缺失时打印错误而不是静默无响应。

`controller.navigate(id)` 支持 `NAV` 中的页面 ID，`ask` 显示原生 DSH 工作区并保留其当前面板；不会强制将外部插件页面切回聊天。仅在聊天面板缺少会话时，显式进入 ask 才尝试绑定学习空间。此接口属于**客户端服务**（`zwNavigation`），不应在宿主插件中注入。外层 `Ctrl+K` 页面搜索仅在业务页面生效；ask 内将该组合键交还原生 DSH。

## 取消一页之后

「插件」页可以取消一个没有被依赖的叶包（例如不用「论文」就把 `dsh-zhiyun-page-paper` 关掉）。外壳的反应：

- 侧栏与 `Ctrl+K` 跳转都不再列它 —— 两处用**同一份**清单（`model.js` 的 `hiddenPageIds`），否则会出现「侧栏看不到、跳转却能过去」的半坏状态；
- 它的面板与内容插槽**照常注册**，只是页面包的内容不再挂载，于是那一页走 `Page` 的「暂时不可用」占位；
- 正停在被取消的那一页时，自动回「今天」。

状态来自宿主插件管理的行级读数（`listPlugins`），与「插件」页同一份真值，所以那边一勾这边立刻变。**`remote` 必须写进 `inject`**：`ctx.remote` 上的命名空间是注入门禁的，没声明就访问 `remote.pluginManager` 会抛（真机踩到过）；而 `remote` 与 `pluginManager` 由 `dsh-api-remotes` 无条件一起挂载，不会多出连坐面。读数失败或服务缺失时一律**退回空集**（一页都不藏）—— 宁可多一个入口，也不能因为可选能力缺席把导航弄没。

## 领域服务（由 `dsh-zhiyun-core-study` 提供）

外壳只按服务名取用，不静态依赖领域包 —— 领域包被停用时外壳仍能启动，只是列不出会话：

| 服务 | 用途 |
| --- | --- |
| `zhiyunStudyController` | 账号、课程树、讲义与习题的状态机（页面包用 `ctx.inject(['zhiyunStudyController'], …)` 取） |
| `zhiyunLearningSpace` | 学习空间的识别（显式进入 ask 的空聊天面板时用 `ctx.get('zhiyunLearningSpace')`） |

两侧都不写进 `inject`：页面包用 `ctx.inject(['zhiyunStudyController'], …)` 等它到位再注册插槽，外壳用 `ctx.get('zhiyunLearningSpace')` 直接取。领域包缺失或未激活时不自动绑定学习空间，原生工作区浏览器仍可使用，不会使整个外壳 pending。

## 生命周期与兼容

profile 同时加载本包与 `dsh-zju-shell-bridge` 两个 bundle，各自提供自己的组合条目；不再停用官方 `ui-sidebar`。本包只注册智云导航与业务页面槽位；原生侧栏、页面、会话入口和右侧栏在 ask 内保持完整。参见 [桥接插件](../dsh-zju-shell-bridge/README.md)。普通外部页面继续使用原生导航协议，不会自动进入智云主导航。

主题通过 `theme.overrideTokens('dsh-zju-shell-workbench', …)` 层叠，卸载后撤销。业务内容插槽在外壳卸载时消失，依赖插件应使用 `slots.inject` 随其声明生命周期装卸。

恢复原生界面时同时停用 `zhiyun-shell` 和 `zhiyun-shell-bridge`，然后完整刷新；原生侧栏无需额外启用。已有机器本地 patch 如果单独停用了 `ui-sidebar`，需移除那条覆盖。

设置**就是**宿主原生浮窗，与 DSH 本体一致：外壳只把原生 `sidebar.settings` 注册项的 store 动作接到导轨「设置」与账号菜单上，不复制分组、不另做一套界面。插件的 `settings.section` 注册零改动。注意它属于应用级浮层，portal 到 `body`，因此不受 ask 容器裁剪 —— 这是与原生 DSH 一致的行为。

共享的图标、品牌标记、空态与分区标题来自 `@lybx-leyw/dsh-zju-ui-shared`（`dsh.client.external` 里声明，esbuild 里 external）。

`src/style.css` 只保留智云导航与业务页面需要的 `.zw-*` 规则；原生工作区、原生侧栏、原生设置外观与浮层一律沿用宿主样式，不在这里覆盖。无前缀状态类（`is-active` 等）是跨包共享命名空间：给壳侧同名类新增属性前，先确认不与页面包的声明撞同名属性。

兼容范围仅包含锁定版本，不承诺与任意未来 DSH 或任意第三方 UI 同时工作。普通插件是否可用取决于它使用的槽位与服务是否仍在原生工作区内；本包不再逐个适配插件。README 中的 `NAV` 页面 ID 与 `zwNavigation` 契约保持不变，页面包无需因本次布局拆分而修改。

