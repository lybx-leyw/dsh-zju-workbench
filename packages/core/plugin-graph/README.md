# @lybx-leyw/dsh-zju-core-plugin-graph

插件依赖图的**宿主半边**（core）：不含 UI。

## 本包有什么

| 模块 | 职责 | 依赖 |
| --- | --- | --- |
| `src/runtime.js` | 把宿主/浏览器两面的运行时读数折成一张依赖图：模块边、服务硬边、插槽边、拓扑排序、环、层序违例 | 零（纯函数） |
| `src/index.js` | `/api/zw-plugins` 的**只读** `graph` 方法 | `connection`、`loader` |

入口 `…/browser` 只导出 `runtime.js` 那批纯函数，给页面的客户端半边用。

## 为什么在 core

两块原先都在 `packages/client/page-plugins/`：

1. `host.js` 注册了宿主路由 —— 那是「一个页面包同时是服务器」，与分层冲突；
2. `runtime.js` 被 **宿主半边与客户端 `store.js` 同时 import** —— 两端共用一份纯逻辑，
   正是「该放进 core」的信号（放在页面里，宿主半边就得反向依赖页面包）。

## 顺带修掉的一个真 bug

`buildView()` 里原写 `short: name.slice(prefix.length)`，而 `prefix` 是**数组**
（`ZW_PREFIXES` 有两个前缀，迁移期两种命名并存）。数组没有 `.length` 的语义，
算出来的 `short` 是 `undefined` 长度 —— 表现是页面上每个包的短名都从第 0 个字符开始截。
已改为「取实际匹配上的那个前缀」再减。

## 只读是刻意的

改开关走宿主自带的 `pluginManager.setPluginEnabled`（客户端直接调那个 Remote）。
这里再开一个写入口，就等于把同一件事做出两条路径 —— 一条会绕过宿主的只读保护
与事件通知。

## 验证

```bash
node --test tests/plugins-page.test.mjs tests/radar-provider-liveness.test.mjs
```
