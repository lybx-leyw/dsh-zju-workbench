# ATTRIBUTION

本骨架**未摘取**上游任何源码。

- `5dbwat4/login-ZJU` 1.0.9 — **MIT** — <https://github.com/5dbwat4/login-ZJU>
  仅在其 `package.json` 中以精确版本引用（`dependencies: { "login-zju": "1.0.9" }`）。
  `src/` 下全部内容为本仓原创；`UPSTREAM_SERVICES` 是从 `dist/index.d.ts` 的
  `export { ... }` 一行**逐字抄录的导出名清单**（仅标识符，不含实现），
  用于评审时对照覆盖面。
- 上游 README 中的「上次成功时间」表格以**转述**形式记入 `src/upstream.js` 的注释，
  目的是让评审看见时效性风险；未复制其正文。

按 CONTRIBUTING 3.3：当前属于「未移植、仅锁版引用」，无需包级归属声明；
若评审通过并开始替换本仓会话层（`dsh-zhiyun-source-*`），届时须在此补记
所用上游模块、改动范围与核验日期。
