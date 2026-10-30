# 第三方来源

## OpenMAIC

- 仓库：<https://github.com/THU-MAIC/OpenMAIC>
- 参考提交：`03dee2bb4e1bf2e3296ad05ca1f78ce863452921`（2026-10-30，版本 `1.3.0`）
- 协议：**MIT**（根 `LICENSE` 实文已核）

### 引入程度

**源码快照整体 vendor 进本仓，逐字节未改。** 上游是一套完整的 Next.js
应用，它的课堂生成、播放引擎、多智能体对话与导出全部依赖自己的服务端
路由，删除任何一部分都会让「功能无损」不成立。因此本包不裁剪、不改写
它的源码，只负责在宿主进程旁边把它托管起来。

快照位置：`vendor/openmaic/`（被 `.gitignore` 忽略，按 `upstream.lock.json`
的提交号与哈希拉回，不随仓库分发）。

校验方式（`npm run vendor:fetch -- --only openmaic`）：

| 项 | 值 |
| --- | --- |
| 归档 SHA-256 | `09d61133fdfbacce16d225756bca8dae481a229ef4f96a118106ead20aeab537` |
| 归档大小 | 95,250,584 B（90.8 MB） |
| 树摘要（`sha256-lines-v1`） | `7b009d1235762bcd50ed1c5dc91369ed83929974f0a07745135cd5188e5004cb` |
| 文件数 | 3,835 |

### 为什么这样是合法的

MIT 允许再分发与修改，前提是**保留版权声明与许可声明**。本仓的做法：

1. 快照里原封不动保留上游的 `LICENSE`；
2. 在本包与仓库根的 [ATTRIBUTION.md](../../ATTRIBUTION.md) 里写明来源、
   提交号、协议与改动情况（本包**无改动**）；
3. 快照本身不随仓库分发，由锁文件按哈希拉回 —— 分发时不会把上游源码
   混进本仓的 MIT 授权里。

### ⚠️ 例外：`packages/mathml2omml`

上游根 MIT **不覆盖**它自带的工作区包 `packages/mathml2omml`
（<https://github.com/fiduswriter/mathml2omml>），该包为
**LGPL-3.0-or-later**，见其 `packages/mathml2omml/LICENSE`。

这意味着分发整份快照时，该包仍受 LGPL 约束（本仓不改动它，因此不触发
LGPL 的衍生作品条款，但再分发它时必须带上那份许可）。

## 使用到的上游能力

本包不 import 上游任何模块，只以子进程方式启动它，经 HTTP 交互。
