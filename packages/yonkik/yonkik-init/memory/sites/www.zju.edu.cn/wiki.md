# 浙大总站 www.zju.edu.cn

## 学院目录页（2026-11-22）

- https://www.zju.edu.cn/xywxw/list.htm → 200，50,720B，标题「学院（系）」。
- **渲染方式**：sui-app 3.0.85（Webplus），学院数据写在 JS 的 `list._links` 与学院条目数组里，**不在 DOM 的 `<a>` 里**——按 DOM 解析会得到 0 条链接。
- 解析结果：**54 条**（含学部与相对路径），去掉学部与 `www.zju.edu.cn` 相对路径后为 **46 个学院主机**。
- 与本地索引交叉核对：**43 个已覆盖，3 个缺失** —— `sociology.zju.edu.cn`、`www.chem.zju.edu.cn`、`www.cmm.zju.edu.cn`（本轮已全部补入）。
- 这是上游用于生成学院目录的权威映射，比逐个猜主机可靠。
