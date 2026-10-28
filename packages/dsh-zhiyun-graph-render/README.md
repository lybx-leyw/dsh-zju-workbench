# dsh-zhiyun-graph-render

把 `dsh-zhiyun-core-vault` 算好的链接图 `{nodes, edges}` 画成可交互的画布。
「笔记」页右栏用它，**不新增页面、不新增导航项**。

## 来源：整包移植

从生态雷达候选 `packages/radar/dsh-radar-note-graph` **整包搬来**
（B 类纯库，上游 `cytoscape@3.34.4` + `cytoscape-fcose@2.2.0`，均 MIT）。候选骨架已删除。

> **移植 ≠ 提取。** 移植是「整包搬到一个正式位置」，骨架随之删除；
> 提取是「把某项能力摘出来写进已有的包」，骨架保留并标 🅿️。
> 本项目两种都发生过，但**不混用** —— 渲染拆散塞进页面，页面就得替「画图」
> 背 cytoscape 这份依赖，而那不是页面的事。

## 职责

| 做 | 不做 |
| --- | --- |
| 映射 `{nodes, edges}` → cytoscape elements | 不重算 `inDegree` / `outDegree`（vault 已算好，重算就有两套口径） |
| 选布局（节点多时退到圆周预设） | 不读磁盘、不发请求、不做存储 |
| 提供 React 组件与纯函数 | 不注册页面 / 插槽 / 导航项 |

## 接口

```js
import { NoteGraph, css } from 'dsh-zhiyun-graph-render';

// css 由调用方在同一个 ctx 里 mountStyle 挂上（样式随包走）
<NoteGraph graph={graph} current="目录/笔记.md" onOpen={(p) => open(p)} />
```

`graph` 缺失时组件渲染「库里还没有笔记」，**不会**当成加载失败。

## 接线（三处缺一即静默不显示，且都不会报错）

| 位置 | 作用 |
| --- | --- |
| 消费方的 `dsh.client.external` | 让 esbuild 外部化本包，而不是把 cytoscape 一起内联进去 |
| `scripts/build.mjs` 的 `CLIENT_PACKAGES` | 本包才会有 `lib/client.js` |
| `profiles/zhiyun-bench/package.json` 的 `bundles` | Loader 才会加载本包 |

本包自身的 `dsh.client.external` 是**空的**：cytoscape 与 fcose 没有共享实例需求，
随包内联即可；写进 external 却没人提供，运行时会 `require` 失败。

`tests/graph-render-wiring.test.mjs` 用真实构建产物跑一遍宿主的模块表来钉这三处。

## 已知限制

- **超过 800 个节点**不再跑力导向布局（fcose 在几千节点上是秒级且阻塞主线程），
  改用 `ringPositions` 的圆周排列，并在界面上说明。阈值待用真实笔记库校准。
- **导出 PDF 会空白**：组件用 canvas 渲染器（交互需要它）。走 PDF 导出时须显式切 SVG。
- 明暗主题靠壳的 `--zy-*` 变量，样式表里不写死色值（`tests/note-graph-model.test.mjs` 钉住了这条）。
