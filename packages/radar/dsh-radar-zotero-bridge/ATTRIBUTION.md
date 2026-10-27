# ATTRIBUTION

本骨架**未摘取**上游任何源码。

- `nftuoa/dsh-zotero` v1.0.1 — MIT — <https://github.com/nftuoa/dsh-zotero>
  仅在其 `package.json` 中以精确版本引用（`dependencies`），并按其 README 的
  Compatibility 一节转述了宿主约束。`src/` 下的全部内容为本仓原创的占位代码。
- 上游 `vendor/` 内的第三方组件（pdf.js / KaTeX / 字体）**未复制进本仓**，
  许可证清单仅作为评审材料记录在 `README.md` 与 `src/upstream.js` 中。

按 CONTRIBUTING 3.3，若评审后决定采用「只借路由」的形态，则本包的运行方式
等价于对上游的一次**接口级复用**（`/zotero/*` 路由契约），届时需在此补记
所依赖的契约版本与核验日期。
