# dsh-radar-tool-plus —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 只有占位与 TODO，未实现任何逻辑。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [xiaoso456/dsh-tool-plus](https://github.com/xiaoso456/dsh-tool-plus) |
| npm | `@xiaoso/dsh-tool-plus@0.1.14` |
| 许可证 | **MIT** ✅（仓库根 `LICENSE` 首行 `MIT License / Copyright (c) 2026 xiaoso456`；`package.json` `license: MIT`；GitHub 元数据 MIT，三源一致） |
| 上游的内核 | [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi) —— **MIT** ✅，★35,776，2026-10-18 仍在推送；上游 `THIRD_PARTY_NOTICES.md` 已声明移植范围 |
| 作者 | xiaoso456 |
| Stars | ★10（2026-10-17 仍在推；**按热度看很低，按能力看是本轮唯一 🟢**） |
| 语言 / 运行时 | JavaScript（ESM），`node ^22.19 \|\| >=24`；`engines.dsh: >=0.2.1-0 <0.3.0-0` |
| 挂载形状 | `dsh.bundle.patch` —— **三份 patch**；`dsh.client.inject` —— locale / settings 两个面 |
| 首次发现 | 2026-10-18（第二十二轮 · A 组 · `topic:deepseek-harness-plugin stars:>0` 第 2 页） |

## 类型与集成判定

- **类型**：A · 原生 DSH 插件包（带 `dsh.bundle.patch` + `dsh.client.inject`）—— 最高优先
- **集成方式**：**强化式集成** —— 锁版挂载 + 只重定向一个落点，**绝不改上游源码**，**不整包套用上游 patch**
- **与现有功能的关系**：**重复且可强化** ✅（对话里已有「终端分页」，但执行器是宿主官方那套）

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 |
| --- | --- |
| 仍是同一个面板 | ✅ 终端分页仍在「今天」页，不新增导航项、不新增顶层入口。⚠ 但上游 patch 会停用四行官方工具，**必须只重定向、不整包套用**（TODO-1） |
| 功能仍相似正交 | ✅ 「在终端里跑命令」是输入侧，「跑完把输出交回模型」是输出侧；上游动的正是输出侧（压缩 / 后台化 / 落盘回读），不是另起一件事 |
| 底层多调了更优质实现 | ✅ 本仓终端分页没有：持久会话、输出最小化、后台作业托管、`rm` 回收站、行区间读取、AST 检索 |

### 上游带来的、本仓确实没有的能力

| 能力 | 本仓现状 | 上游做法 |
| --- | --- | --- |
| 持久 shell | 每次调用新 shell，`cd` / `export` / `conda activate` 全丢 | 会话级 shell，状态跨调用保持 |
| 冗长输出 | 全量灌进上下文 | git / npm / cargo 等自动压缩；超长只留头尾，全文落盘可回读 |
| 长命令 | 阻塞到超时 | 自动转后台作业，可轮询 |
| 文件读取 | 整文件读 | 行区间（`:N-M` / `:raw` / 多区间）、大文件先给结构摘要；zip / tar / SQLite / notebook / PDF 直读 |
| 写入 | 直接覆盖 | 原子写 + 返回 diff；可直接写归档成员与 SQLite |
| 编辑 | 单一 replace | replace / patch / hashline / apply-patch 四种，带唯一性校验与空白模糊匹配 |
| 搜索 | 单一实现 | grep / glob 双引擎 + mtime 排序 + 可选 `ast_grep` / `ast_edit` |
| 误删 | `rm` 即消失 | 默认进系统回收站，`command rm` 才真删 |

## ⚠ 为什么**不能**整包套用上游 patch（本候选的核心争议点）

上游 `cordis.patch.yml` 的前四行是：

```yaml
- id: tool-bash
  disabled: true
- id: tool-pwsh
  disabled: true
- id: tool-fs
  disabled: true
- id: tool-fs-search
  disabled: true
```

它把**宿主官方的四行工具整体停用**，换成自己的实现。上游自己解释得很清楚：
`bash-sandbox` / `pwsh-sandbox` **保留**（服务于 `ctx.shell` 能力缝），只替换「模型可见的工具行」。

**但这对本仓仍然太重**：

1. 本仓的沙箱治理挂在被停用的那几行上。整包套用 = **治理层没了**；
2. 上游 patch 注释里写明 *"The OMP executor does not confine commands, so no
   sandbox-permission parameters are advertised"* —— **它没有沙箱参数**。
   对一个「无独立 API key、受限权限」的校园工作台，这等于默认 `danger-full-access`；
3. 本仓只想要「终端分页那一格」变好，不想要「全站工具层换血」。

所以本骨架的 `cordis.patch.yml` **只有一条 insert**，并在注释里写明「故意不复刻上游 patch」。
这两条（TODO-1 / TODO-2）**不解决就不能接**，见下。

## 评审要点（按优先级）

| 级别 | 事项 |
| --- | --- |
| **P0** | **沙箱语义**（TODO-2）。上游执行器不设沙箱参数。若终端分页借此绕过权限模式，本包**直接判 ⛔**，不是「改一改就能上」 |
| **P0** | **能否只重定向一个落点**（TODO-1）。不能 → 降级 🟡，改抽 `src/bash-runtime` 源码级移植，不再走锁版 |
| **高** | **二进制可审性**（TODO-4）。`@oh-my-pi/pi-natives` 随包分发编译好的 Rust 二进制。建议关掉 hashline、只用纯 JS 的 `replace` / `patch`，代价很小 |
| **中** | **安装期放行**（TODO-3）。需要 `--allow-build` 两次（含 `koffi`）。若本仓 CI 禁构建脚本，此包装不上 |
| **中** | `puppeteer-core` 会调用**本机浏览器**抓 SPA 页面。校园网环境 / 无图形界面机器上行为需实测 |
| **低** | 版本锁 `0.1.x` —— 上游任一 patch 版本都可能改工具 id，而 `disabled: true` 对不上 id 是**静默失效**。必须靠 TODO-5 的运行时核对兜住 |

## 依赖

`package.json` 只声明上游一个依赖，**精确版本** `0.1.14`（不用 `^`，理由见 `src/upstream.js`）。
上游自己的 13 个运行时依赖（`@oh-my-pi/*` 整族、`koffi`、`puppeteer-core`、`trash` 等）
由 npm 正常解析 —— 按 CONTRIBUTING 3.3，第三方库经 `package.json` 正常引入**不需要**额外归属声明。

## 归属

未移植任何上游代码，仅锁版依赖，**按 CONTRIBUTING 3.3 无需额外 `ATTRIBUTION.md`**。
根 `ATTRIBUTION.md` 已追加一行「只做简单借鉴」级说明，指向上游仓库。

## 文件

| 文件 | 用途 |
| --- | --- |
| `package.json` | 包名 / 精确版本依赖 / `dsh.bundle.patch` |
| `cordis.patch.yml` | 仅有**一条 insert**（故意不复刻上游 patch） |
| `src/index.js` | 占位 + TODO-1…6 |
| `src/upstream.js` | 锁版凭据单一真源（版本、仓库、上游 patch 清单、被停用的工具 id、运行时风险项） |
| `OWNERS` | `Owner: shared` |
