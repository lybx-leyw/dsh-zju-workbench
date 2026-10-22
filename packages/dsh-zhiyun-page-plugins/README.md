# dsh-zhiyun-page-plugins

「插件」页：按**运行时依赖关系图**列出这个工作台由哪些包组成，并允许取消没有被任何包依赖的**叶包**。

侧栏第 7 项。它回答的是「我不用论文，能不能把论文那一整块关掉，而别把解析也弄坏」——把依赖关系摆出来，让取消这一步是有依据的。

## 依赖从哪里来（本包不扫描源码）

DSH 运行时本来就把依赖认好了，而且是两套真源，各自有各自的平面：

| 边 | 真源 | 说明 |
| --- | --- | --- |
| 模块边 | `ctx.modules.manifest.modules`（宿主侧 `ctx.clientModules.graph().entries`） | 每行的 `inject`（包名边）与 `external`（精确模块请求，`<包名>/client` 折回包名）。**顺序已经是拓扑序** —— DSH 的 `orderByModuleGraph` 保证被请求的行排在消费者之前 |
| 硬边 | 每个 Cordis fiber 的 `inject` 服务名 + `ctx.reflect.store` 里该服务的提供者 fiber | 唯一「停用提供方 → 消费者变 `pending`」的关系，也就是界面上那句「等待依赖」 |

两套真源分处两棵插件树：宿主的树与浏览器的树互不可见。而本仓最要命的几条边全在**宿主面**（`dsh-zhiyun-core-study` 的 `inject` 里写着 `zhiyunClassroom / zhiyunParser / zhiyunKnowledge`，解析包写着 `zhiyunClassroom`，讲义与出题包写着 `zhiyunParser`）。所以本包有真正干活的宿主半边：`/api/zhiyun-plugins` 把宿主面的读数交给浏览器，浏览器面（模块边、客户端硬边）由客户端就地读，最后用同一个纯函数折成一张图。

**只读宿主那棵树的依赖事实，不解析源码、不扫目录**：`src/runtime.js` 只碰 Loader 条目的 `options.name`/`fiber`、fiber 的 `inject`、以及 `ctx.reflect.store` 里每条实现的 `name`/`fiber`。

## 「叶」的定义

叶 = **没有任何包请求它**（上述两套真源里都没有入边）。

不加「入口包」之类的保护清单：本仓的设计刻意让可选加工步骤走 `ctx.get` 惰性取而不写进 `inject`（见 `dsh-zhiyun-core-study/README.md` 的「只声明硬依赖」），所以叶本来就是可以安全取消的那一批。取消一个叶包，最坏结果是别的包**按设计降级**（页面空着、抽屉空列表），不会连坐成 pending。反过来，页面上写着「被 N 个包依赖」的包，勾选框是禁用的 —— 取消它才真会让下游「等待依赖」。

## 取消走宿主自己的**行级**开关

勾选调的是 `remote.pluginManager.setPluginEnabled(entryId, enabled)`，与宿主「插件」页的行开关同一条路径：它把 `disabled` 写进用户自己的 `cordis.patch.yml`，因此共享宿主的只读保护与 `plugin-manager/changed` 通知。本包**不另开写入口**。

**为什么不用 `setBundleEnabled`**（真机验证时踩到过）：那个会把整个 bundle 从 profile 的 `dsh.profile.bundles` 里摘掉，而 `listBundles()` 只列**被选中**的 profile 依赖 —— 摘掉之后这一页就再也看不到它，成了单向门；更要命的是 profile 初始化会把本仓的源包重新补回 `bundles` 列表，于是这次取消在下次启动时被静默撤销，用户以为关掉了其实没关掉。行级开关写在用户 overlay 里，`initialize()` 明确保留（见 `scripts/profile.mjs` 与 `tests/profile.test.mjs` 的 overlay 断言），行也还在，随时能再打开。

## 取消之后会发生什么

- **侧栏那一项消失**：外壳按同一份行级状态过滤 `NAV`，所以被取消的页不再出现在侧栏，`Ctrl+K` 跳转里也搜不到（两处共用一份清单，见 `dsh-zhiyun-shell-workbench/src/model.js` 的 `hiddenPageIds`）。正停在那一页时会被送回「今天」。
- **它承载的面板与插槽仍在**（外壳照常注册），页面包的内容贡献因此不挂载 —— 那一页显示外壳的「暂时不可用」占位。这是有意的：撤注册要在远程事件回来的异步时点调 `ctx.slots.register`，容易撞 `INACTIVE_EFFECT`；把取消落在呈现上时序最简单。
- **再打开就回来**：行级开关写在用户 overlay 里，随时可撤销，侧栏那一项随之恢复。

## 层序与依赖序是两件事

`dsh.profile.bundles` 的**列表顺序就是层顺序**：后一层覆盖前一层。而把包重新打开会被**追加到列表末尾**，所以层序会随时间漂移，可能与依赖序不一致。页面把这件事摊开在折叠区里（「N 处」），而不是偷偷重排那个列表 —— 重排等于改配置优先级，不该由一次勾选顺手做掉。

## 边界

- 只声明 `slots` / `connection` / `remote` / `remote.pluginManager` / `loader` / `modules`。刻意**不**把领域服务（`zhiyunStudyController` 等）写进 `inject`：这一页要在领域包被停用时照样打得开 —— 那正是它存在的意义。
- 宿主半边只读一个方法 `graph`。要改开关请走 `pluginManager`，不要在这里加写入口。
- 样式用本包自己的 `zpl-` 前缀，不去改外壳的 `.zy-*`（改了会影响另外五个页面），也不与论文页已占用的 `zp-` 撞车。

## 插槽

在 `zhiyun.plugins.content` 注册内容。声明 `children` 的是外壳（`NAV` 里每一项都会自动声明 `<page>.content`，声明即认领），本包只注册。
