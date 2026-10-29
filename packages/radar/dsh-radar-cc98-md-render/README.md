# dsh-radar-cc98-md-render —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（2026-10-29 · r99），**仅用于人工评审**。
> 这不是一个可用的插件：`src/index.js` 的 `apply()` 只打一行日志，
> **不含任何上游代码、不含任何实现**（`dependencies` 为空）。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 集成性质：**强化式集成**（不是「全新功能」）

给「笔记」页**已有的** Markdown 通路换一个**更高保真的上游转换器** ——
不新增页面、不新增搜索入口、不换渲染器。

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ 成立 | 落点是笔记页已有的正文渲染通路（`dsh-zhiyun-page-notes/src/client.jsx` 用宿主 `MarkdownText`，见该文件 23-28 行注释「为什么正文用宿主的 MarkdownText」）。本包只改「这段 Markdown 由谁产生」 |
| ② 功能仍相似正交 | ✅ 成立 | 现有 `dsh-zhiyun-source-cc98/src/ubb.js` 的 `ubbToText()` 只做 **UBB → 纯文本**；本包做同一件事的**保结构档位**。与 `dsh-radar-cc98-ubb-bridge`（写方向）构成读写对偶，不重叠 |
| ③ 底层多调了更优质实现 | ✅ 成立 | 纯文本方案里，`[img]` / `[url]` / `[quote]` 都被压成文字，**翻页与引用楼层的链接关系不可回溯**；上游用 `documents.ts` + `navigation.ts` 建带锚点的文档图，链接是真的链接 |

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [amiongogo/cc98-vscode](https://github.com/amiongogo/cc98-vscode)（CC98 低调浏览） |
| 作者 | 季风 |
| 许可证 | **MIT** ✅（`spdx_id` + 根 `LICENSE` 实文 1060 B 双证） |
| 形态 | **VS Code 扩展**（TypeScript，★1，2026-07-27 push） |
| **能否锁版** | **❌ 不能** —— 运行时依赖 `vscode` 虚拟模块，npm 装不到。只能**能力提取** |

> 本包**不含任何上游源码**。`src/upstream.js` 记录的是「该提取哪几段语义、哪几段不要」，
> 实现要按本仓 `ubb.js` 的标记表重写。署名见 `ATTRIBUTION.md`。

## 与同簇包的关系

| 包 | 方向 | 关系 |
| --- | --- | --- |
| `dsh-zhiyun-source-cc98` | 取正文 | 复用其 `Cc98Client` / `TokenStore`，**不另建登录栈** |
| `dsh-radar-cc98-ubb-bridge` | **写**（MD → UBB） | 与本包构成读写对偶；**标记表必须同源**，否则写出去再读回来会对不上 |

## 评审要点（按优先级）

1. **判据②是否成立**：把「纯文本」升级为「保结构 Markdown」，算不算同一功能的增强，还是应算「新功能」？若不成立 → 整目录删除。
2. **标记表单一真源**：实现时必须扩 `source-cc98/src/ubb.js` 的标记表，**不要**在 radar 包内再抄一份。
3. **读/写对偶的方括号规则**：`cc98-ubb-bridge` 评审时已记「内联代码含 `[b]` 时方括号被剥」的隐患，本包若不同步修，对偶会双向失真。
4. **★1 的活跃度**：作者单人维护、无 issue 讨论。属于「语义可借鉴、不宜重依赖」。

## 明确不做

- ❌ 不写测试（radar 包规定）
- ❌ 不写入 `profiles/zhiyun-bench/package.json`
- ❌ 不搬运上游源码
- ❌ 不做写操作（回复 / 点赞 / 收藏）—— 写的方向归 `cc98-ubb-bridge`
