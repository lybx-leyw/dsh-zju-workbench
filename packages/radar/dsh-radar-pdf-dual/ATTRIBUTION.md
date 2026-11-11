# ATTRIBUTION

本包为**候选骨架**，未评审、未接入 profile、不可直接使用。以下为借鉴与引用说明，
按 `CONTRIBUTING` 的 3.3 节登记。

## 锁版引入的上游

| 项 | 值 |
| --- | --- |
| 仓库 | [`xiayifan1024/dsh-pdf-math-reader`](https://github.com/xiayifan1024/dsh-pdf-math-reader) |
| 版本 | `1.1.0`（**锁版**，`dependencies` 写死，不用 `^`） |
| 许可证 | MIT |
| 引了什么 | 仅 `lib/translation.js` 的**翻译契约**：段落级双语对照、批内等长 JSON 数组对齐、术语表强制译名、公式/DOI/编号原样保留 |

**没有**搬运上游源码。`src/upstream.js` 里每个函数都是 `throw`，
注释里写的是「要封哪几件事」，不是上游实现。上游 `assets/cmaps`、`pdf.min.mjs`
等二进制资产**一律不带入本仓**。

上游同时引用了 [PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate)
「保持公式、引用与版式语义」的设计思路；本包若后续实现 prompt 校准，须追溯至此。

## 契约借鉴（不摘码）

| 来源 | 借鉴内容 |
| --- | --- |
| 本仓 `dsh-zhiyun-host-paper/src/selection.js` | 三件事的收敛方式：**在飞请求合并**、**LRU 缓存带模型名**、**超长截断并如实标记**。本包 `segmentCacheKey(model, text)` 直接对齐其 `cacheKey(model, text)` 口径 |
| 上游 `README` §限制与路线图 | 「当前是段落对照，不生成重排后的单语/双语 PDF」「扫描版无文本层时不自动 OCR」两条边界，本包 README 原样继承，不承诺超出 |

## 与既有骨架的边界

`packages/radar/dsh-radar-pdf-anchor` 已占「PDF 文本层行内标记」这一格。
本包**不碰文本层**，只读文本、只画在自己的抽屉里。若评审要求「点段落出译文」，
两者必须合并，不能并存 —— 见 README §6 风险表。
