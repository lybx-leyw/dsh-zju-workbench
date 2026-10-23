# dsh-radar-plugin-ledger —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar`（r58）自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 与 `src/upstream.js` 的两个函数
> **都直接抛错**，本包**不 import 上游**，也没有任何业务逻辑。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

锁版引入 `@zseven-w/dsh-harbor@0.1.0-rc.4`，把**「每个包会做什么（13 项能力 + file:line 证据）、
声明与检出是否一致」**接进「插件」页（`packages/dsh-zhiyun-page-plugins`）**已有的每一行** ——
强化现有的 `buildView()`（只答「谁依赖谁、谁可取消」），**不是**再造一个插件面板。

**集成方式：强化式集成（重复且可强化），不是「全新」。**

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| 仍是同一个面板 | ✅ | 只给**已有**的「插件」页每一行补字段；不新建页面、不加侧栏；上游自带的 `settings.section` **不消费** |
| 功能仍相似正交 | ✅ | 现有 = 结构维（模块边/服务硬边/插槽边 → 拓扑、叶、可取消）；接入 = 能力维（起进程？外发？开路由？读写别人配置？）。同一张表的两个维度 |
| 底层多调了更优质实现 | ✅（**有成色折扣**） | 现有：**零字段**（全仓 `spdx|license` grep = 0，能力面从未有过）。接入：13 项词表 + `file:line` 证据 + `undeclared/unused/unknown` 对账 + `coverage`。**但** M3 实测证据会命中**注释行** ⇒ 「更优」= 「有底座 vs 没有」，**不是**「更准」 |

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [ZSeven-W/dsh-harbor](https://github.com/ZSeven-W/dsh-harbor) |
| npm | **`@zseven-w/dsh-harbor@0.1.0-rc.4`**（2026-10-06T03:59Z；`dist-tags.latest` 即为该 rc 版，共 4 版） |
| 许可证 | **MIT** ✅ 三处一致（GitHub `license.spdx_id` / npm `license` / tarball `LICENSE`，Copyright 2026 ZSeven-W） |
| 作者 | ZSeven-W（同作者另有 `dsh-ios` ★323 / `dsh-crew` ★163 / `dsh-noema` ★129 / `openpencil` ★6304，均在册、与本包无关） |
| Stars | ★25（建仓 2026-08-22，push 2026-10-23，活跃） |
| 语言 | JavaScript（宿主，`.mjs`）+ TypeScript（客户端，`.tsx` → `lib/client.js`） |
| npm `dependencies` | **无**；peer 仅 `react@^18` / `react-dom@^18` |
| 体积 | `unpackedSize` **1,202,836 B**（≈1.15 MB，含 16 份 README/SPEC、4 张 png） |
| 宿主 `inject` | 只有 `['webServer']` |
| 注册点 | 6 条**回环**路由 + 客户端 1 个 `settings.section`。无 `main` 页、无侧栏 |

---

## 为什么是它、不是 `dsh-insight`（已在册 ⛔）

| | `ZSeven-W/dsh-harbor` | `gwsbhqt/dsh-insight`（★3，在册 ⛔ 重复无增益） |
| --- | --- | --- |
| 读的是 | 包源码 + `package.json` → 13 项**能力** + 证据 + 对账 | 运行时注册表（插件/服务/工具/方法） |
| 与 `buildView` 的关系 | **正交**（能力维 vs 结构维） | **重合**（「每个插件来自哪里」依赖图已有） |
| 是否导出可复用模块 | ✅ `exports: "./scan"`，同步纯函数 | ❌ 只有 `.` / `./client` |

⇒ 判 🟢 的理由**不是**「它更新」，而是「**它换的东西与现有不重合**」。

---

## 上游代价（评审必须知道的四条）

1. **没有许可证维度。** `grep -rni "license" src/scan/ src/hub/` → **0 条**。
   「每包什么许可」得本包自写（TODO-5）。**不要**把 license 说成 harbor 的能力。
2. **证据会命中注释行。** 对本仓 `dsh-zhiyun-source-campus` 实测：`network-egress` 的
   6 条证据**全部**是 `src/egress.js` 的 `/** … */` 注释（第 4/6/16/20/21/146 行），
   另有 **18 条被省略**。⇒ 界面文案必须写「启发式线索」，不能写「检测到」。
   同理 `tool-registration` / `env-read` 在上游自己标注的 tier 就是 `heuristic`。
3. **`dsh.capabilities` 是社区公约，宿主不读、不强制**（上游 `SPEC.zh.md` §1 原文）。
   接它 = 接一套**别人定的词表**；本包把词表**快照**在 `CAPABILITY_IDS_SNAPSHOT`，
   并在运行时比对，词表一变就报，而不是界面上悄悄少一行。
4. **扫描根可能对不上。** `discoverInstalls()` 以 `~/.dsh/profiles`（或 `$DSH_HOME/profiles`）为根，
   本仓 profile 在**仓库内**的 `profiles/zhiyun-bench/`。对不上 ⇒ 返回**空表且不报错**（TODO-0，阻塞）。

---

## TODO（全部是评审先拍板的）

| 编号 | 阻塞 | 内容 |
| --- | --- | --- |
| TODO-0 | ✅ 阻塞 | `~/.dsh/profiles` 与本仓 `profiles/` 是否同一处？空表即不可接 |
| TODO-1 | ✅ 阻塞 | 只挂宿主半边，**不消费** `./client`（否则一个概念两个入口） |
| TODO-2 | | 哪几项能力进那一行（提案：`subprocess` / `network-egress` / `web-routes` / `foreign-config`） |
| TODO-3 | | 1.15 MB 体积要不要裁 `files`（**建议接受**，裁剪等于改上游清单） |
| TODO-4 | | 两条**会联网**的路由（`/updates`、`/preflight*`）挂不挂 |
| TODO-5 | | 许可证字段必须**自写**（读 `package.json.license`） |
| TODO-6 | | 挂载后 `GET /_dsh/dsh-harbor/ping` 自检 `routes.mounted === 6` 且 `failed` 为空 |

---

## 上游凭据（2026-10-24 实查）

```bash
npm pack @zseven-w/dsh-harbor@0.1.0-rc.4

# 词表 13 项
node -e "import('./package/src/scan/index.mjs').then(m=>console.log(m.CAPABILITIES.length))"
# → 13

# 对真实包跑（入参是 { dir, name }，传 { packageDir } 会抛 ERR_INVALID_ARG_TYPE）
node -e "import('./package/src/scan/index.mjs').then(m=>{
  const r=m.inspectPlugin({dir:'packages/dsh-zhiyun-page-paper',name:'page-paper'});
  console.log(r.version, Object.keys(r.capabilities), m.reconcile(r).status);
})"
# → 0.1.0 [ 'client-injection', 'network-egress' ] not-declared
```

---

## 不做什么

- **不新建页面**：不注册 `main`、不加侧栏项、不改 `NAV`（`dsh-zhiyun-shell-workbench/src/model.js`）。
- **不消费上游的 `./client`**（`settings.section`）。
- **不改上游源码**：上游 `cordis.patch.yml` 原样保留，本包 patch 只插本包。
- **不碰 profile**：绝不写 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`。
