> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
>
> 本包由每日「生态雷达」自动生成，**未经过人工评审**，**未接入** `profiles/zhiyun-bench/package.json`
> 的 `dsh.profile.bundles`。`src/index.js` 只有占位与 TODO，**没有可用实现**。
> 接入前必须先由人完成「接入前必须先做的事」一节的 6 项前置工作。

# dsh-radar-market

为智云 Pro「插件」页补上**生态检索与安装**能力的候选骨架：锁版挂载上游 [`dshmarket`](https://github.com/dsh-market/dsh-market) 的**宿主半边**。

## 集成性质：**强化式集成**（不是「全新」）

落在**已有的「插件」页**（`dsh-zhiyun-page-plugins`），不新开导航项。三条同时成立：

| 判据 | 本候选 |
| --- | --- |
| **仍是同一个面板** | 落在「插件」页，侧栏第 7 项不动 |
| **功能仍相似正交** | 现有包答「**我手上这几个包**谁依赖谁、能不能安全关掉」（本地运行时依赖事实 + 行级开关）；上游答「**生态里还有什么没装**、点一下就装」。一进一出，不重叠 |
| **底层多调了更优质实现** | catalog 拉取、registry 校验、安装与版本更新、pnpm / bundle 兼容、失败恢复 —— 本仓没有对应实现，也不应自己造 |

⇒ 按雷达的判据归类为 **重复且可强化**，而非「全新」，也**不是**「简单集成重复功能」。

## 上游信息

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/dsh-market/dsh-market> |
| npm 包名 | `dshmarket` |
| **锁版** | **`1.66.21`**（`package.json` 与 `src/upstream.js` 两处逐字符一致） |
| 版本核对 | GitHub tag `v1.66.21` ↔ npm `dist-tags.latest`，2026-10-13 17:25 UTC 发布 |
| 许可证 | **MIT** ✅ |
| 作者 | `dsh-market` |
| 体量 | 6 505 stars · 269 forks · 38 open issues |

## 上游包形态（已核实）

- `dsh.bundle.patch` → `./cordis.patch.yml` ✅ **原生 DSH 插件包**
- `dsh.client.platform: web`，`exports["./client"]` → `./client/client.js`
- 宿主半边源码面很宽：`catalog-npm / catalog-local-match / install / install-dsh / profile /
  patch / registry / pnpm-compat / recovery / compatibility / sources / updates` 等

## 只挂宿主半边——本候选最关键的判断

上游的 `dsh.client.inject` 里列着 `@deepseek-ai/dsh-client-ui-settings`，且自带 `./client` 导出，
即：**它会自己接管 settings 的 `plugins` 分组**。

这与 `dsh-paper-reader` 的客户端半边**刻意不引入**是**同一条理由**（见
[`packages/dsh-zhiyun-paper/README.md`](../dsh-zhiyun-paper/README.md)）：
它会抢本仓外壳的布局主张与设置分组（`sidebar.workspaces`、`shell.overlay`、设置分组）。

⇒ **本包只挂宿主半边；UI 由 `dsh-zhiyun-page-plugins` 重写。**
该重写**不在本骨架范围内**。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.js` | 挂载/拆卸的**占位**：版本核对的形状、自有前缀路由、TODO 清单 |
| `src/upstream.js` | 锁版凭据（包名 + 精确版本 + 仓库），单一真源 |
| `cordis.patch.yml` | `insert` 一条 `radar-market` **（但未被任何 profile 引用）** |

## 接入前必须先做的事（按依赖顺序）

1. **人工评审**：确认上面「只挂宿主半边」这条判断成立。不成立则本包应废弃。
2. **上游能力盘点**：确认上游宿主半边实际暴露的能力，哪些可在 profile 内直接调、哪些只能走 CLI。**只读，不改上游源码。**
3. **写入口克制**：安装/卸载/更新会改用户的 profile 与 `cordis.patch.yml`。参照
   `dsh-zhiyun-page-plugins` 的成例，**不另开写入口**，能用宿主既有 Remote 的一律走宿主自己的路径。
4. **数据目录**：确认 catalog 缓存/快照的落点，以及离线时的降级行为（上游 `snapshot` 脚本会连网抓 registry）。
5. **版本核对**：补上运行时核对，**只警告、不抛错**（理由见 `src/index.js` 文件头）。
6. **验证**：补 `tests/radar-market.test.mjs`（断言三处版本一致，照 `tests/paper.test.mjs` 成例），
   跑通 `npm test` 与 `npm run test:host`，并在真实宿主里确认**没有**抢占 settings 的 `plugins` 分组。

**以上全部完成后**，才由人决定是否把 `dsh-radar-market` 加进 `profiles/zhiyun-bench/package.json` 的
`dsh.profile.bundles`（依据 [CONTRIBUTING 3.1](../../docs/contributing/CONTRIBUTING.md)：
profile 中任何一条 Loader 条目解析失败，起不来的是**整个工作台**）。

## 边界

- `inject: ['profileContext']` 是唯一硬依赖。`webServer` / `connection` 走 `ctx.inject`，
  其余宿主服务走 `ctx.get` 惰性取 —— 可选宿主服务不写进 inject，否则对方没就绪时本插件会一直 pending。
- 自有前缀必须是 `/zhiyun-market`：宿主的 `webserver.register` 对同 `(kind, path)` 重复注册直接抛错。
- **绝不修改上游源码**；上游以 npm 依赖形式锁版引入，按 MIT 正常使用。

## 来源

见 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。
