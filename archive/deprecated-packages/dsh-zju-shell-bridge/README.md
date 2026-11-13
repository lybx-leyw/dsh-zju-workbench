# dsh-zju-shell-bridge

智云外壳与原生 DSH 工作区的布局桥接。智云主导航只表达学习场景；普通 DSH 插件的导航、页面、聊天扩展、工作区浏览器和右侧面板保留在「问一问」内部，不自动混入智云主导航。

## 组合与槽位

由 profile 作为独立 bundle 加载，向 `dsh-zju-shell-workbench` 提供布局服务，必须同时保留原生 `ui-layout`、`ui-sidebar`、`ui-sidebar-right`。桥接服务 `zhiyunWorkbench` 管理外层 `activePage`，与 `ctx.layout` 的内层面板选择独立。

本插件在原生 `shell.overlay` 注册一个生命周期所有者，声明两个新槽位；其渲染结果通过 React portal 放入外层布局的导航和页面容器：

| 槽位 | 类型 | 用途 |
| --- | --- | --- |
| `zhiyun.shell.navigation` | root / single | 智云主导航，owner 参数 `activePage` |
| `zhiyun.shell.page` | root / keyed | 智云业务页面，key 为页面 ID |

原生槽位不改名、不重声明、不复制内容。普通插件继续注册 `sidebar.panellist`、`main`、会话工具栏等原生槽位，无需引用本包。原生页面导航会显示 ask，但不会改变智云页面注册。外层离开 ask 时原生 React 树保持挂载，容器隐藏且 inert；返回时内层页面选择和视图状态保留。

设置不属于本桥接：它沿用 DSH 原生浮窗，由外壳把原生设置入口接到导轨；本插件不接管设置表单，也不参与它 portal 到 `body` 的行为。

## 宿主版本与生命周期

DSH 0.2 没有布局包装注册 API。本插件在现有 root 注册项上可逆替换 `component`，完整转交原始 props，保留该项的 `children`、store 和 inject 权限，不注册第二个 root。卸载时仅当该项仍使用本插件的包装器才恢复，避免覆盖后续修改。原生 root 注册项改变时重新绑定。

适配目标为仓库锁定的 `0.2.0-rc.2` 与 `0.2.1-alpha.1`。后者额外提供的底部槽位仍归原生布局管理。本适配依赖这些版本可变注册项的行为，不能宣称对任意未来版本兼容。首次启用、停用或更新桥接后应完整刷新页面；就地修改注册项本身不发出 renderer 更新通知，不承诺无刷新的热切换。

## 已知边界

- 这是同一应用内的布局组合，不是 iframe 或安全沙箱。插件仍共享 Cordis、document 和全局快捷键。
- 原生槽位内的常规浮层随 ask 容器显示；直接 portal 到 document.body 的弹窗、菜单、工具提示仍属应用级浮层，不承诺全部裁剪进 ask。自定义全局 DOM、全屏样式和全局快捷键可能需要额外兼容验证。
- 容器保持挂载不等于后台插件停用。用户操作引发的原生面板切换、以及已有会话之间的切换，会把 ask 显示出来；启动恢复和几何变化不会抢走业务页面，首次初始化会话也不会强制离开今天页。
- 两个插件同时替换原生 root/侧栏、重复占用同一槽位，或使用不同宿主 API，仍可能冲突；本插件不解决插件自身冲突。

## 验证

仓库根执行 `node --test tests/shell-bridge.test.mjs tests/learning-space.test.mjs` 验证状态、包装器清理、真实 React portal 和会话绑定。构建后执行 `node scripts/test-host.mjs --bridge-only`，使用临时 profile 在真实宿主安装一个不依赖智云接口的测试插件，验证原生页面入口、覆盖层、侧栏扩展、设置迁移和卸载恢复。该聚焦通道不代表论文模型链路、解析依赖图等完整业务验收通过。

本包仅改变客户端布局，不增加模型输入、工具、token 或 KV-cache 内容。
