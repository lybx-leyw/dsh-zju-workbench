# dsh-radar-cc98-ubb-bridge —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` **直接抛错**，
> 而且**不含任何上游代码、不含任何实现**（`dependencies` 为空）。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

把 [obsidian-cc98-publish](https://github.com/stevenstg/obsidian-cc98-publish) 的
`markdownToUbb`（Markdown → **CC98 UBB 方言**）以**能力提取**方式移植进本仓，
接到「笔记」页**已有的正文区**，补上「CC98 读得回来、**写不出去**」这条单向边。

**集成方式：强化式集成（重复且可强化），不是「全新」。**

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落点是 `packages/dsh-zhiyun-page-notes/src/client.jsx` 的**已有正文区**：选中一篇 `.md` → 一个「复制为 CC98 UBB」按钮。不新建页面、不新增侧栏、不新增插槽 |
| ② 功能仍相似正交 | ✅ | 现有 `dsh-zhiyun-source-cc98/src/ubb.js` 只有 `ubbToText`（UBB → 纯文本，**读**进门）；本包是 `markdownToUbb`（Markdown → UBB，**写**出门）。方向相反、用途不同，不是第二份渲染器 |
| ③ 底层多调了更优质实现 | ✅ | 现有这一维**为 0**（全仓 `markdownToUbb|toUbb|toUBB` 0 命中）。上游提供 288+217 行、**专为 CC98 方言**写的转换：标题 `[size=7..2]`、按分隔符扫描的强调转换、代码区不参与替换、URL 先屏蔽后还原、`[bili]`/`[video]`/`[audio]` 三种媒体标签 |

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [stevenstg/obsidian-cc98-publish](https://github.com/stevenstg/obsidian-cc98-publish) |
| 许可证 | **MIT** ✅（GitHub `spdx_id` / `package.json.license` / `LICENSE` 1082 B 三处一致） |
| 作者 | stevenstg |
| Stars | ★8（建仓 2026-07-20，push 2026-10-19，活跃） |
| 语言 | TypeScript（Obsidian 插件） |
| npm | **未发布** → 只能锁 **git 提交**（TODO-0） |
| 拟移植的文件 | `src/md-to-ubb.ts`（288 行）、`src/links.ts`（217 行）、`src/convert.ts`（702 行）中的**纯函数部分** |
| **不**移植的文件 | `src/images.ts`（`import { App, TFile } from "obsidian"`）、`src/settings.ts`、`src/main.ts`（不存在，`main.js` 是构建产物） |
| 首次发现 | 2026-10-24（B 组 ·「笔记 → CC98 写出」轴，r59） |

### 为什么不是「锁版挂载」

上游是 **Obsidian 插件**：`images.ts` 第一行就是 `import { App, TFile } from "obsidian"`，
而 `obsidian` 是**宿主运行时注入的虚拟模块**，不在 npm 上 —— 锁版挂载在物理上不成立。

但核心三层恰好是**零宿主依赖的纯函数**（`md-to-ubb → links → convert` 单向链，
`convert` 不反向依赖前两者）。实测把它们直接丢进 `node --experimental-strip-types` 就能跑
（Node v22.13.1，零安装）。所以正确形态是**能力提取**，不是锁版挂载。

> 「能力提取」在这里**不是低配** —— 它把可以用的 1207 行纯逻辑全部拿过来，
> 只丢弃那些天然绑死 Obsidian 的外围文件。

---

## 上游的三个「按 Obsidian 成立、按 CC98 存疑」之处（实测）

不能对外宣称「复制出去就对了」。以下三条须在评审时逐条定性（详见骨架 TODO-3/4/5）：

| # | 行为 | 实测输出 | 为什么存疑 |
| --- | --- | --- | --- |
| 1 | `> 引用` → **`[quote]` 被剥掉** | `"> 引一句话\n> 第二行"` → `"引一句话\n第二行"` | `[quote]` 是 CC98 版聊最重要的结构，丢了就分不清「谁在回谁」 |
| 2 | 表格**原样透传** | `| a | b |` → `| a | b |` | CC98 是否渲染表格未知；不渲染就是一堆竖线 |
| 3 | 硬换行**原样保留** | `"第一行\n第二行"` → 同样 | 站点若按段落渲染，两行会糊成一段 |

另有一条**读/写不对偶**：`用 \`[b]x[/b]\` 表示粗体` → UBB `"[b]x[/b]"` → 用本仓
`ubbToText` 回读成 `用 "x" 表示粗体`（方括号被当标签剥掉）。只影响含 UBB 字面量的极少数笔记，
但需要一条守卫测试（TODO-6）。

---

## 落点与注入面

| 项 | 值 |
| --- | --- |
| 宿主半边 | **无**（纯前端字符串处理，不需要路由、不碰网络、不读磁盘） |
| 客户端半边 | 一个动作按钮，挂在 `dsh-zhiyun-page-notes` **已有**的正文区 |
| `inject` | `['slots']` |
| 新增插槽 | **0** |
| 新增页面 | **0** |
| 网络请求 | **0**（图片上传另立需求，见 TODO-4） |

---

## 评审要先拍板的七件事（= 骨架 TODO-0 ~ TODO-6）

- **TODO-0（阻塞）** 钉住上游提交 SHA。没有 SHA 的移植不可追溯。
- **TODO-1（阻塞）** 入口只有一个按钮，不加插槽、不建页面。
- **TODO-2** 标题映射是 CC98 方言（`#`→`[size=7]`、`######`→`[size=2]`），方向与 GitHub 相反，逐条照搬。
- **TODO-3** 表格三选一：保留 / 转对齐文本 / 拒绝并提示。**不能默认静默保留**。
- **TODO-4** 图片**只转换、不上传**（上传 `file.cc98.org` 是写操作，与「CC98 只读」冲突）。
- **TODO-5** 硬换行先上站点实测，再决定是否转 `[br]`。
- **TODO-6** 读/写互为逆运算的守卫测试（往返不改变可见文本）。

---

## 红线

- 本骨架**只放 `packages/`**，**未**写入 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`。
- **未搬运上游源码**：本目录零代码，`dependencies` 为空。
- 若评审通过并移植：必须保留上游版权声明、在移植文件头注明「来源仓库 + 提交 SHA」，
  并把 `ATTRIBUTION.md` 里本条目从「候选」上移到「含实现移植」。
- **不做「一键发帖」**。上游自己都明确「不会自动发帖」，本仓 CC98 源是只读的。
