# ATTRIBUTION

本包为**候选骨架**（B 类 · 能力提取），不含任何上游源码。

## 上游

| 项 | 值 |
| --- | --- |
| 项目 | `Cedar17/cc98-img-upload` |
| 许可证 | **Apache-2.0** |
| 版权 | Copyright 2026 Cedar17（见上游文件头） |
| 用途 | 仅**借鉴协议事实**：`POST https://api.cc98.org/file` 的 multipart 形状、403 重试语义、失败即整篇不输出、已上传不可撤回 |

## 本仓改动了什么（Apache-2.0 §4(b) 声明的意义）

- **未复制、未翻译、未摘录上游任何源码**（上游是 Python + `markdown-it-py`，本包是 JS，且 `dependencies` 为空）。
- **未移植**：Markdown 图片定位、字节级保真重写、CLI、`uv` 依赖、账号密码登录 —— 理由逐条写在
  `src/upstream.js` 的 `NOT_PORTED`。
- **重新实现**（评审通过后）：图片定位复用本仓 `dsh-zhiyun-core-notes` 的 `zy-asset://` 扫描；
  鉴权复用本仓 `dsh-zhiyun-source-cc98/src/token.js`；UI 落点是 `dsh-zhiyun-page-notes` 既有动作组。
- 因此**没有文件需要附带上游版权头**；本文件只为满足「改动说明」的披露义务而存在。

## 其他

本包不包含第三方代码，`dependencies` 为空，无可分发的第三方制品。
