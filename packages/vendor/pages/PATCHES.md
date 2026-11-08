# PATCHES — 我们对 dsh-pages 做了什么

> **这是代价清单。** 记录我们偏离上游多少。每次改动都要在这里加一条。

## 上游基线

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/lybx-leyw/dsh-pages |
| 提交 | `9999fa9f831c000b17ecfd82c0707b277eeef15e` |
| 分支 | `chore/initial-import` |
| 版本 | **0.1.3** |
| 许可证 | 见 `LICENSE` |
| 引入方式 | `git clone` 后删除 `.git` / `.release-check` / `package-lock.json`，作为普通文件纳入本仓 |

### 与 npm 上 `0.1.3` 的关系

同版本号，源码有极小差异（本仓库 `client.jsx` 多 16 字符，其余文件略大）。
**以本仓库为准** —— 它更新。构建产物 `lib/client.js` 与 npm 版逐字节相同（53861 B），
所以引入 vendor 不改变当前行为。

### 目录名

`packages/vendor/pages`（原 `packages/vendor/dsh-pages`）。

**包名仍是 `@lybx-leyw/dsh-pages`** —— 那是宿主的解析键，不能改。
目录名去掉 `dsh-` 前缀是为了与本仓其它 vendor 目录风格统一
（`vendor/pages`、`vendor/paper-reader` 都是「是什么」而不是「它叫什么包」）。

## 为什么 vendor 它

它是**页面壳**：导轨、页面管理、`page.content` 槽、`pages` 服务的宿主。
当前要解决的三件事，根子都在这里：

### 1. page 间渲染隔离

现状：`page-shell.jsx` 把整个壳 `createPortal` 到 `shell.overlay`（整页浮层）。
浮层天然跨页 —— 任何挂在里面的东西都同时属于所有页面。

### 2. 切页时彻底回滚

现状：没有「页面激活 / 失活」的生命周期钩子。页面要订阅什么，只能自己
`useEffect` + cleanup；漏一处就在切页后残留（真机踩过：阅读器 iframe 留在
home 上）。

### 3. 与原生宿主的边界

现状：页面壳与原生宿主的交界（sidebar / rightbar / 会话 / grid）没有显式契约。
第三方页面想做布局，只能去 `document.querySelector` 找宿主节点、改它的内联样式
（真机踩过：给官方 header 加 `marginLeft: 80px`、给 `[data-rightbar-col]` 的父元素
写 `data-rightbar-instant`、猴补丁 `layoutService.closeRightbar`）。

## 改造记录

### A. 页面生命周期契约（已完成）

`registerPage` 现在接受两个钩子：

```js
pages.registerPage({
  id, label, render,
  onActivate,      // 页面被选中时
  onDeactivate,    // 切走时撤销一切全局副作用
})
```

壳在 `activePage` 变化时**保证**调用顺序（`useLayoutEffect`，绘制前）：

1. 旧页 `onDeactivate()` —— 此时旧页 DOM 还在，清理能拿到自己的节点；
2. 新页 `onActivate()`；
3. 任一方抛错都只 `console.warn`，**不阻止导航** —— 一个页面的 bug 不该让用户切不走。

注销登记（`dispose()`）时也跑一次 `onDeactivate`，否则页面被移除后副作用没人清。

**钩子单独存**（`lifecycle` Map），不塞进页面条目：条目会 `publishPages()` 快照给
整个 UI，混入函数会让它每次都是新引用（无谓重渲染），也没法序列化做诊断。

### B. 页面作用域容器（已完成）

所有页面内容（**含内置的页面管理页**）都包在：

```html
<div data-page-scope="<pageId>" style="position:relative; contain:layout paint">
```

提供三件事：

| 能力 | 机制 |
| --- | --- |
| 样式不出界 | `scope.ownStyles(css)` 给每条顶层规则加 `[data-page-scope="<id>"]` 前缀 |
| 定位不越界 | `position: relative` —— 页内绝对定位以自己为基准 |
| 布局/绘制隔离 | `contain: layout paint` —— 内部尺寸变化不触发外部重排，绘制不溢出 |

**边界：只管 UI。** 这是渲染层的隔离，不动 cordis 服务、数据栈、功能插件 ——
那些在宿主进程里，与 DOM 无关。作用域只决定「这段 UI 画在哪、影响谁」。

真机验证（页面管理页）：

```
scopeCount: 1     scopeAttr: "pages"
contain: "layout paint"    position: "relative"    size: 1389x980
宿主 sidebar / header / workspaces 全程为 1（未被影响）
```

#### 一个过程中的错误

第一版把作用域容器放进 `manager ? A : B` 的 **B 分支**，结果内置的「页面管理」
走 A 分支没有作用域 —— 真机 `scopeCount: 0`。

**「所有页面内容都在自己的作用域里」是无条件契约，不该按分支写**。改成包外层。

### C. 宿主边界显式声明（已完成）

页面访问宿主 UI 现在只有一条路：`props.host`。

```js
// 页面里
function PaperPage({ host }) {
  const open = host.rightbarOpen()      // 右栏是否展开
  host.openRightbar({ track: true })    // 展开（返回布尔，失败可回退）
  const rect = host.rightbarRect()      // 面板几何
  const tracks = host.frameTracks()     // 宿主三栏轨道宽
  host.toggleSidebar()
  const scheme = host.colorScheme()     // 'dark' | 'light'
}
```

#### 优先级：服务 > DOM

宿主有正式的服务面（`ctx.layout` 的 `openRightbar` / `closeRightbar` /
`toggleSidebar` / `panelInfo`）。`host` **优先用它**，因为服务是契约，
DOM 属性是实现细节。

只有**几何测量**服务给不了（「这块区域现在多宽」`panelInfo` 只报轨道宽度，
不报面板滚到哪、被 dockkit 偏移多少），才回落到 DOM —— 而且回落路径集中在一个
文件里（`src/host-face.js`），宿主改实现时只需要改那一处。

#### 契约的三条保证

| 保证 | 做法 |
| --- | --- |
| 服务缺席不崩 | 全部方法 `try/catch`，读操作给安全默认值 |
| 写操作有反馈 | `openRightbar` / `closeRightbar` / `toggleSidebar` 返回布尔 |
| 惰性取服务 | `getLayout()` 每次现取，服务后来出现立刻可用（不缓存 undefined） |

#### 为什么是抽象层，不是文档

文档只能「建议」别碰 DOM。抽象层让页面**没有理由**去碰 —— 它要的东西这里都有，
形状还稳定。这也让审计变成可机械化的事：以后写一条守卫测试，扫页面源码里有没有
`document.querySelector('[data-rightbar-...]')` 就够了。

#### 现状（2026-11 重构后）

`paper-reader` 的客户端已按本契约重构完：**宿主 DOM 耦合从 16 处降到 0**。

删掉的是这些（它们全部在改宿主的节点或服务）：

| 原机制 | 它做了什么 |
| --- | --- |
| 会话切换护栏 | 给 `[data-rightbar-col]` 父元素写 `data-rightbar-instant`、猴补丁 `layoutService.closeRightbar` |
| 布局换位 `applySwap` | 每 200ms 改宿主 `gridColumn`/`gridRow`、面板 `maxWidth` |
| 头部按钮定位 | 给官方 header 加 `marginLeft: 80px` |
| `PdfTab` 右栏页签 | 阅读器靠它定位 |
| 全局样式注入 | `document.head` 里的 `!important` |
| `shell.overlay` 整页浮层 | 阅读器与按钮组都挂在跨页浮层上 |
| `sidebar.workspaces` 接管 | priority -1000 抢占整个侧栏 |

换来的是：阅读器成为页面内普通 iframe、按钮组进页面顶栏、会话操作留在本页。
真机验证：home / 论文页 / 切回 home 三种状态下，宿主的 `headerMarginLeft`、
`data-dpr-pad`、`gridColumn` **全程未被改动**。

## 清单

- [x] vendor 进来并建链接
- [x] 构建通过，产物与 npm 版一致
- [x] 改造 A：页面生命周期契约（6 条测试）
- [x] 改造 B：页面作用域容器
- [x] 改造 C：宿主边界显式声明（14 条测试）
