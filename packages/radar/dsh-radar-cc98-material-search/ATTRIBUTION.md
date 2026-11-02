# ATTRIBUTION · dsh-radar-cc98-material-search

> **候选骨架阶段**：本包当前**不含任何上游代码**（`src/index.js` 是占位）。
> 本文件先把归属关系记下来，等评审通过、真正改写规则时**必须**同步更新「改写范围」。

## 上游

| 项 | 值 |
| --- | --- |
| 项目 | CC98 科目资料检索（cc98-material-search） |
| 仓库 | https://github.com/gvvg5272-code/cc98-material-search |
| 版本 | `v0.1.0`（2026-11-02） |
| 许可证 | MIT |
| 版权 | Copyright (c) 2026 CC98 Material Search contributors |

## 引用承诺

按仓库 CONTRIBUTING 3.3，若最终实现中保留了上游的**规则表或算法结构**
（`lib/triage.js` 的帖子类型关键词表、`lib/attachment.js` 的附件识别规则），
须在本文件写明：

1. **改写范围**：哪几个文件、哪些规则表源自上游；
2. **改写性质**：从浏览器扩展（MV3）移植为宿主机纯 ESM 模块，
   去掉 `chrome.*` 依赖与弹窗 UI，仅保留纯函数；
3. **MIT 声明保留**：随包附带上游 MIT 许可证全文。

## 明确不做的事

- **不搬运上游源码**：不整文件复制，只提取规则思路并用本仓口径重写（含注释与命名）。
- **不内嵌扩展**：不打包 `popup/`、`background/`、`manifest.json`。
- **不修改上游**：任何改进回馈给上游应以 PR 形式提出，而不是在本仓分叉。
