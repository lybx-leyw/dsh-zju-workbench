# dsh-radar-cc98-img-upload —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 与 `src/upstream.js` 只有占位与 TODO，
> `uploadImage()` 与 `rewriteForCC98()` 都直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成类型

**强化式集成**（不是全新，也不是简单集成）。

**不是「全新」**：它不新增一个「CC98 发帖器」面板。落点是 `dsh-zhiyun-page-notes` 里
**既有**的图片/导出动作组，与「导出 Markdown」并列。

**不是「简单集成」**：它做的事在现有面板里**没有对应实现**——
`dsh-zhiyun-source-cc98` 导出的是 `search / topic / hot / newTopics / boards / boardTopics / user /
notifications / conversations / messages`（**十个读，零个写**），
`dsh-zhiyun-core-notes` 的图片只有本地 `zy-asset://<id>`，**没有任何一处把本地图推到远端**。

**三条判据逐条核对**

| # | 判据 | 本轮核对结果 |
| --- | --- | --- |
| ① | 仍是同一个面板 | ✅ 笔记页既有动作组。**不**注册插槽/页面/导航 |
| ② | 功能仍相似正交 | ✅ 现有＝图片在**本仓内**渲染；新增＝**同一张图**换成**远端 URL**。同一对象，本地面 vs 外发面 |
| ③ | 底层多调了更优质实现 | ✅ `grep -r upload packages/dsh-zhiyun-source-cc98/src` **零命中** ⇒ 本仓确实没有上传实现；现调的是 CC98 官方 `POST https://api.cc98.org/file` |

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [Cedar17/cc98-img-upload](https://github.com/Cedar17/cc98-img-upload) |
| 许可证 | **Apache-2.0** ✅（文件头 `SPDX-License-Identifier` + 仓库 `LICENSE` 11358 B，一致） |
| 语言 | **Python 3.12**（`uv` 内联依赖：`requests` / `markdown-it-py`）—— **不可 import、不可锁版** |
| 规模 | 40 KB；`cc98_img_upload.py` 10826 B；另有 22447 B 的测试文件（**本仓不搬测试**） |
| 活跃 | 建仓 2026-10-29、push 2026-10-30、★2 |
| **分类** | **B 类 · 能力提取**（`dependencies` 为空；读语义 → 在本仓重写） |

**为什么不锁版**：上游没有 `package.json` / npm 包 / Release，只有一个 Python 脚本。
按本仓纪律 A 类才锁版，因此本包为 B 类，**不写任何上游依赖**。

---

## 要补的那一格

| 问法 | 现有实现 | 上游给的 |
| --- | --- | --- |
| 笔记里的图存在哪？ | `core-notes/src/store.js`：内联 `zy-asset://<id>`，字节落 `note_assets/<id>.<ext>` | —（**不动**） |
| 图能贴到 CC98 吗？ | **不能**（见上表） | 本地图 → `/file` 上传 → 服务端图片 id → `[img]…[/img]` |
| 鉴权怎么来？ | `source-cc98/src/token.js` 已有缓存/刷新/落盘 | 上游用**账号密码**换 token（**本包明确拒绝这条路**） |

---

## 骨架文件

| 文件 | 内容 |
| --- | --- |
| `package.json` | `private: true`、`dependencies: {}`（B 类） |
| `src/index.js` | `ADAPT_POINTS`（四处落点 + TODO）、`uploadImage()` / `rewriteForCC98()` 占位 |
| `src/upstream.js` | 协议事实常量：`UPLOAD` / `TOKEN_VIA_PASSWORD` / `FAILURE_POLICY` / `NOT_PORTED` / `HARD_BOUNDARIES` |
| `ATTRIBUTION.md` | Apache-2.0 §4(b) 的改动声明 |
| `OWNERS` | `Owner: shared` |

---

## 评审时要拍板的三件事

1. **token 的 audience 是否覆盖 `/file`**（`src/index.js` 的 `ADAPT_POINTS.token`）。
   若只签了读接口的 scope，上传会 401 —— 而**不能**为此另开账号密码登录。
2. **失败时是否允许「本地占位 + 稍后重传」**。上游口径是「任一图失败则整篇不输出」（防半张贴）；
   但笔记场景下用户可能只想先贴出去。当前骨架**沿用上游口径**，是否放宽需评审定。
3. **「已上传不可撤回」怎么写进 UI**。重跑会重传，静默重传会在 CC98 上留一堆孤儿图。

---

## 明确不做

见 `src/upstream.js` 的 `HARD_BOUNDARIES` 与 `NOT_PORTED`。要点：
不搬上游 Python、不引入账号密码、不做后台自动上传、不改笔记原文、不注册新页面。
