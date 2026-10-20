# dsh-zhiyun-shell-workbench

智云 Pro 的界面外壳插件：侧栏、页框架、主题层、导航服务与插槽契约。当前验证宿主为 `0.2.0-rc.2`。宿主提供 React 和全部 DSH 客户端服务；不要再打包一份 React。

外壳**不认识任何具体页面**：它声明 `NAV` 里每个页面（除「问一问」是宿主原生会话）的面板骨架和内容插槽，页面由各自的插件包填充（`dsh-zhiyun-page-today / -paper / -study / -me / -plugins / -feedback`）。内容插槽按 `NAV` 的条目逐个注册：加一项导航就自动多一个 `zhiyun.<id>.content`。页面包没装时页面显示「暂时不可用」占位，外壳照常工作。

> **课程与回放只有一页**：`courses`（我的课）与 `player`（看课）曾经是独立的两页，
> 现已并入 `study`（学习）—— 课程目录是它的左栏、回放是正文区的一栏、整理是其余几栏。
> 导航因此只剩 `study` 一个入口，`dsh-zhiyun-page-courses` / `-player` 两个包已删除
> （列在 `scripts/profile.mjs` 的 `retiredBundles` 里，老 profile 会在初始化时被清掉）。

构建：在仓库根运行 `npm run build`。本地 profile 通过目录链接加载 `lib/`，修改源文件后需重新构建，DSH 的客户端更新机制会更新页面。

## 页面插槽

外壳在 `main` 插槽里为 `NAV` 的每一页声明一个 **root / single** 内容插槽（声明即认领，页面包只注册内容，不重复声明 `children`）：

| 插槽 | 内容位置 |
| --- | --- |
| `zhiyun.today.content` | 今天页正文 |
| `zhiyun.paper.content` | 论文阅读页正文 |
| `zhiyun.study.content` | 学习页正文（课程目录 + 回放 + 整理，全在这一页） |
| `zhiyun.me.content` | 个人页正文 |
| `zhiyun.plugins.content` | 插件依赖页正文 |
| `zhiyun.feedback.content` | 反馈页正文 |

侧栏那一列还声明了几个**控件插槽**（与页面无关）：

| 插槽 | 内容位置 |
| --- | --- |
| `sidebar.settings` | 宿主的原生设置面（**被 CSS 刻意隐藏**，可见的设置面归「个人」页） |
| `sidebar.footer.action` | 导轨底部扩展入口（当前无人注册） |
| `sidebar.account.signin` | **账号对话框里的登录表单**（头像 → 登录） |

> 「个人」不在导轨的页面图标里：它是导轨**最下方那格圆形头像**。点头像浮出账号面板
> （身份 + 登录 + 设置），面板里点「设置」才进个人页。登录表单由 `dsh-zhiyun-page-me`
> 注册进 `sidebar.account.signin`，**不在个人页正文上** —— 登录是应用级动作，
> 入口在头像那一层，也因此不会因为「个人」页被停用而消失。

页面包在客户端导出 `inject: ['slots']`，然后：

```js
// 只用外壳给的 controller（今天页）：
export function apply(ctx) {
  ctx.slots.inject('zhiyun.today.content', () =>
    ctx.slots.register({ name: 'zhiyun.today.content' }, TodayPage)
  );
}

// 还要领域状态（学习 / 个人）：先等 controller 到位，再注册插槽
export function apply(ctx) {
  ctx.inject(['zhiyunStudyController'], (scope) => {
    scope.slots.inject('zhiyun.study.content', () =>
      scope.slots.register({ name: 'zhiyun.study.content', priority: 10 },
        () => <StudyPage controller={scope.zhiyunStudyController} />)
    );
  });
}
```

页面组件同时从渲染参数里拿到外壳注入的 `controller`（`navigate / toggleSidebar / toggleTheme`）和 `renderSlot`。`ctx.slots.inject` 在声明已存在时立即执行，声明后到也会补执行，外壳卸载时贡献随之撤销（连同 `ctx.inject` 的作用域一起）。

`controller.navigate(id)` 支持 `today / paper / ask / study / me / plugins / feedback`，`ask` 进入现有 DSH 会话。此接口属于**客户端服务**（`zhiyunNavigation`），不应在宿主插件中注入。

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
| `zhiyunLearningSpace` | 学习空间的识别与会话行投影（外壳的会话抽屉用 `ctx.get('zhiyunLearningSpace')`） |

两侧都不写进 `inject`：页面包用 `ctx.inject(['zhiyunStudyController'], …)` 等它到位再注册插槽，外壳用 `ctx.get('zhiyunLearningSpace')` 直接取。领域包缺失或未激活时降级（会话抽屉空列表、页面显示未连接），不会连坐成 pending。

## 生命周期与兼容

`cordis.patch.yml` 禁用官方 `ui-sidebar`，本插件声明同一组侧栏扩展点，保留原生设置与会话入口。右侧栏**不能停用**：宿主的文档/文件/终端分页等 9 个客户端插件都注入 `sidebarRight`，停用它会让整个前端启动失败。

主题通过 `theme.overrideTokens('dsh-zhiyun-shell-workbench', …)` 层叠，卸载后撤销。业务内容插槽在外壳卸载时消失，依赖插件应使用 `slots.inject` 随其声明生命周期装卸。

停用外壳时应在 profile patch 中同时设置 `zhiyun-shell.disabled: true` 和 `ui-sidebar.disabled: false`。移除整个 bundle 后其侧栏覆盖自然失效。

共享的图标、品牌标记、空态与分区标题来自 `dsh-zhiyun-shell-ui`（`dsh.client.external` 里声明，esbuild 里 external）。

`src/style.css` 里的 `.zy-*` 与旧外壳逐字一致（74 个类），另有 4 个无前缀状态类 `is-active` / `is-blank` / `is-current` / `is-danger`（`is-active` 只出现在 `.zy-nav button.is-active`，`.is-blank` 只出现在 `.zy-drawer-name.is-blank` 等，均带宿主前缀限定）。它们与 `dsh-zhiyun-page-study` 的 `.zs-asset-card.is-active`、`.zs-handout-drawer button.is-active` **属性不相交**，当前不会互相覆盖；但无前缀类名本身是跨包共享的命名空间，将来若要给壳侧 `.is-active` 增加属性，先确认不与页面包的声明撞同名属性。

兼容范围当前仅包含锁定版本；没有承诺与最新版 DSH 或任意第三方 UI 同时工作。
