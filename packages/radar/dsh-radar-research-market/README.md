> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
>
> 本包由「生态雷达」自动生成，**未经过人工评审**，**未接入** `profiles/zhiyun-bench/package.json`
> 的 `dsh.profile.bundles`。`src/index.js` 只有占位与 TODO，**没有可用实现**。
> 接入前必须先由人完成下面「接入前必须先做的事」一节的检查。

# dsh-radar-research-market

为智云 Pro 的**科研候选簇**补一个「目录从哪来」的落点：锁版挂载上游 [`dsh-research`](https://github.com/dsh-research/dsh-research)。

## 集成性质：**强化式集成**（不是「全新」）

落在**已有的「插件」页**（`dsh-zhiyun-page-plugins`），不新开导航项。三条判据：

| 判据 | 本候选 |
| --- | --- |
| **仍是同一个面板** | 落在「插件」页，侧栏不动 |
| **功能仍相似正交** | 现有一半答「我装了什么、谁依赖谁、能不能关」；上游这一半答「科研方向还有什么可装」。进/出两个方向，不重叠 |
| **底层多调了更优质实现** | 上游做的是**人工读过**的目录 + allowlist 限定的安装通路 + 串行化 + 同源校验；本仓没有、也不应自己造 |

## ⛔ 上一版结论（r88）已经过时，此处订正

r88 的结论是「科研候选簇不再引入第四个插件市场」。**那个结论基于一个未经核实的判断**：
把 `dsh-research` 当成了又一个通用市场。逐条读 README 后不成立 —— 它是一个**限定目录的市场**，
上游自己在 README 里写明：

> The official market already installs anything in the community registry, and does it well.
> What it cannot do is tell a researcher which of its eleven hundred plugins are theirs.

也就是说：它**不是** `dsh-market` 的替代品，而是**在 `dsh-market` 之上的一层筛选**。
「第四个市场」与「通用市场的第七个替代品」是两回事，前一个结论本身没错，错在把这条当成了后者。

## 上游信息

| 项 | 值 |
| --- | --- |
| 仓库 | <https://github.com/dsh-research/dsh-research> |
| npm 包名 | `dsh-research` |
| **锁版** | **`0.4.4`**（`package.json` 与 `src/upstream.js` 两处逐字符一致） |
| 版本核对 | npm `dist-tags.latest = 0.4.4`（单一 dist-tag，无 beta 分支），2026-10-21 推送 |
| 许可证 | **MIT**（LICENSE 首行 `MIT License`，Copyright (c) 2025 ai4scholar） |
| 依赖 | **零运行时依赖**（`dependencies: null`） |
| bundle | `dsh.bundle.patch = ./cordis.patch.yml`，插入行 `id: research-market` |
| client inject | `dsh-client-runtime` / `-connection` / `-locale` / `-ui-settings` |

## 接入前必须先做的事

1. **先裁定「一个页、两套市场」**：`dsh-radar-market` 已锁 `dshmarket@1.66.21`，本包再锁
   `dsh-research@0.4.4`。两个上游都会往 profile 写，**必须只有一个 `allowInstall` 开关**
   处于开启状态，否则「一次装两个」的竞态会在同一份 `package.json` 上打架。
2. **确认不会挂两次**：上游 patch 行 id 是 `research-market`，本包是 `radar-research-market`。
   若两者同时启用，需要确认上游是否已自带那一行（`UPSTREAM_PATCH_ROW_ID`）。
3. **`allowInstall` 默认值**：上游默认 `true`。本仓语义下应显式关掉，先只读。
4. **catalog 的来源**：默认指向 `dsh-research.com/v1/market.json`。这是第三方域名，
   离线/断网时页面要有明确的「目录不可用」态，不能空列表冒充「没有插件」。
5. **不搬运上游源码**：只锁版挂载，不复制 `lib/` 里任何文件；需要改行为就写外围兼容层。
6. **不写测试、不接 profile**：本包内不得出现 `test/`、`*.test.*`，profile bundles 不得含 `dsh-radar-*`。

## 与现有功能的关系（一句话）

**重复且可强化** —— 与「插件」页是同一个面板，方向正交（浏览 vs 依赖图），底层换成了人工读过的目录与受控安装通路。
