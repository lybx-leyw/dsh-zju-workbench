# dsh-radar-foliate-reader

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 这里只有占位代码，`apply()` 恒返回 `ok: false`，`loadView()` 直接抛错。
> 它的唯一作用是：把「这个上游锁得住 + 这个位置是空的」这件事固化成可评审的脚手架。

## 集成性质：**强化式集成**（判据③**半成立**，如实标注）

按 skill 的三条判据逐条核对：

| 判据 | 结论 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 落在**笔记页既有的 iframe 阅读器**，不新增页面/导航项 |
| ② 功能仍相似正交 | ✅ | 仍是「打开文件 → 翻页」，与 PDF 阅读同一件事；只是多一种格式 |
| ③ 底层多调了更优质实现 | **半成立** | 本仓**当前没有任何 EPUB 实现**（`packages/dsh-zhiyun-*/src` grep `epub` = 0），因此谈不上「换个更好的底层」，而是「补一个不存在的格式」 |

所以准确的描述是：**同面板内的格式补齐 + 借用成熟上游渲染器**。
不写成「纯强化」，也不写成「全新面板」—— 两头都不是。

## 它解决的具体问题

笔记页 `page-notes/src/client.jsx` 第 1279 行：

```jsx
accept="application/pdf,.pdf"
```

文件树只把 `.md` 当笔记、其余当附件，阅读区只为 `.pdf` 提供渲染。
教材、专著、教辅大量是 EPUB —— 这类文件今天只能当附件存着，点开是「无法预览」。

## 上游：`johnfactotum/foliate-js@1.0.1`

- **许可证 MIT** ✅（宽松白名单内）
- ★1146 · 纯 ES 模块 · 无构建步骤
- 本轮 npm 实测：`added 2 packages in 685ms`，整包 476 KB
- 解压依赖 `vendor/zip.js`（55 KB）、`vendor/fflate.js`（3.8 KB）**已随包发布**
- `exports: { "./*.js": "./*.js" }` ⇒ 深导入受支持

选用理由见 `docs/ecosystem-radar/2026-11-02-21.md` §2.1：★28698 的 Koodo 是 AGPL 直接出局，
Bibi 在 npm 上没有同名包（404）锁不了版，epubjs-reader 是示例页不是库。

## 风险（评审必读）

| # | 风险 | 等级 | 说明 / 缓解 |
| --- | --- | --- | --- |
| 1 | **上游 API 不稳定** | **高** | README 原文：*"not stable. Expect it to break and the API to change at any time."*，且建议用 git submodule。缓解：只允许经 `src/upstream.js` 接触上游；升级前 diff 上游 README 的 Modules 章节 |
| 2 | **CSP 需放行 `blob:`** | 中 | 上游 `reader.html` 用 `blob:` URL 把 EPUB 内容装进 iframe。宿主阅读器路由需允许 `blob:` |
| 3 | **字体反混淆需 SHA-1** | 低 | IDPF 算法默认走 Web Crypto，**仅 secure context** 可用；`localhost` 满足 |
| 4 | **中文排版未验证** | 中 | 上游面向英文 EPUB；竖排 / CJK 断行 / 标点挤压**均未实测**，不得对外声称支持 |
| 5 | 笔记库文件是宿主路径 | 中 | `view.open()` 要 URL 不是路径，需一个本地路由或 `blob:` 把字节递给 iframe（见 `src/index.js` 的 TODO） |

## 刻意没做的事

- **没有搬任何上游源码**：本包只有 `package.json` 的锁版依赖和占位注释，故无 `ATTRIBUTION.md`。
- **没有写测试**：按仓库规则，radar 包不放 `test/`、`*.test.*`。
- **没有接 profile**：`profiles/zhiyun-bench/package.json` 未被改动。
- **没有处理 PDF**：PDF 已有自己的阅读器，本包只管 EPUB/MOBI/FB2。
