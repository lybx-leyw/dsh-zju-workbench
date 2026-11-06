# dsh-radar-me-memory —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-20 第四十二轮）。**仅用于人工评审。**
> `src/index.js` 是空实现，`TODO` 未落实；**请勿**加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [AskTheWay/dsh-auto-memory](https://github.com/AskTheWay/dsh-auto-memory) |
| npm | `dsh-auto-memory@0.9.0`（**写死，不用 `^`**） |
| 许可证 | **MIT** ✅（npm `license` 与仓内 `LICENSE` 两处一致，2026-10-20 核） |
| 作者 | AskTheWay |
| Stars | ★137，push 2026-10-20（活跃） |
| 包体 | unpacked **164,828 B**；`dependencies` **为空**（8 个 peer） |
| 上游挂载形状 | `dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: web` |
| 上游存储 | **纯 Markdown 文件**（`$DSH_HOME/memory/`），不用 SQLite |
| 宿主窗口 | peer `>=0.1.5-rc.2 <0.3.0`，`cordis >=4.0.2 <5.0.0` → 与本仓 `hostVersions`（`0.2.0-rc.2` / `0.2.1-alpha.1`）**相容** ✅ |

## 类型与集成判定

- **类型**：**A · 原生 DSH 插件包**（带 `dsh.bundle.patch` + `dsh.client`）
- **集成方式**：**强化式集成** —— 锁版挂载上游**宿主侧** + 外围兼容层，**绝不改上游源码**
- **与现有功能的关系**：**重复且可强化** ✅
- **增强哪个现有功能**：**「我的」页** `packages/dsh-zhiyun-page-me`（侧栏「个人」）
- **UI 预期**：仍是**同一个「我的」面板**，**不新增导航项**、不改交互路径

> ⚠️ **「不新增导航项」目前做不到**，原因见下方「阻塞项」第 1 条 —— 这是本骨架**最需要评审裁决**的地方。

### 三条判据

| # | 判据 | 本候选 |
| --- | --- | --- |
| 1 | **仍是同一个面板** | ⚠️ **条件性成立**：上游 client 注册 `main`（顶层页）+ `sidebar.panellist`（侧栏项），**原样挂载 = 新增两处入口**。须丢弃上游 client、只挂宿主侧（TODO-1），且 shell 要开一个 list 槽（TODO-0） |
| 2 | **功能仍相似正交** | ✅ 「我的」页答「怎么用」（外观 / AI 服务 / 网络偏好）；本包答「它记得我什么」 |
| 3 | **底层多调了更优质实现** | ✅ 本仓**零持久记忆**；上游给类型化记忆 + 提示段注入 + 查重更新语义 |

## 增强哪个现有功能

本仓没有任何「跨会话记忆」：`dsh-zhiyun-study-core` 的 `recent` / `recent-save` 是**学完一节的留痕**，
不是「关于用户的事实」。所以「我的」页今天只有**设置**，没有**台账**。
本包补的就是这一格：让「它记得我什么」在**同一个面板**里可见、可删、可追溯。

## 为什么选它而不是同轴的 `dsh-memory`（两者都是 A 类 MIT）

| | `dsh-auto-memory@0.9.0` | `dsh-memory@0.1.0` |
| --- | --- | --- |
| ★ | **137** | 1 |
| 存储 | 纯 Markdown 文件 | **`node:sqlite` + FTS5 虚表** |
| 在无 FTS5 的 `node:sqlite` 上 | 无影响 | **`apply()` 直接抛 `ERR_SQLITE_ERROR: no such module: fts5`**（第四十二轮 §2.1 实测），且留下 16 KB 半成品 db |
| 切分 | 工作区 + 用户双层 | **全机一份** `$DSH_HOME/memory/memory.db` |

后者形态更「像我们会做的」（FTS5、token 逐字引号化），但它把一个**编译期选项**变成了插件能否加载的前提；
而 `apply` 抛错在 Cordis 里不是「功能不可用」，是**整个 bundle 起不来**。

## 阻塞项（评审必须先裁决）

1. **落点（TODO-0）**：`dsh-zhiyun-shell/src/client.jsx:143` 把每页内容槽声明为
   `zhiyun.<page>.content: { kind: 'single' }`，全仓唯一的单点扩展是 `zhiyun.me.network`。
   **single 槽容不下第二个注册者** → 本包现在**无处可注册**。
   出路：shell 新增 `zhiyun.me.memory`（`kind: 'list'`），或驳回本包。
2. **上游 client（TODO-1）**：`dsh.client` 是**整包级**的，Loader 没有「只挂宿主侧」的开关。
   若宿主不支持裁剪，本候选在 A 类形态下**无法满足判据①**，应改判「需移植改造」（🟡）。
3. **账号切分（TODO-2）**：本仓一切数据按 `accountId` 切分；上游是全机一份。
   接之前必须先证明「换账号看不到别人的记忆」。
4. **提示预算（TODO-3）**：上游默认 2000 **字符**，按英文估；中文同字符数量的信息量不同，须重测。

## 尚未完成（采用前必做）

- TODO-0 ~ TODO-7 见 `src/index.js`；
- 中文召回质量**未实测**（本骨架只做形态与许可核实，未安装样品）；
- `promptMaxChars` 的中文建议值**未测**，**不得**沿用上游默认值上线。

## 许可与归属

MIT。本骨架**不含**任何上游源码副本：`package.json` 只写版本号，运行时由包管理器拉取。
因此**不需要** `ATTRIBUTION.md`（未参考其实现，仅按其公开接口形状做集成规划）。
