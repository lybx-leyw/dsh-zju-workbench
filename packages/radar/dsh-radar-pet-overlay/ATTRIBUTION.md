# ATTRIBUTION

本包为**候选骨架**，尚未引入任何上游源码或素材。以下为**计划借鉴**的来源，
一旦评审通过并实际抄录代码/数据，必须按下表核对并更新本文。

| 上游 | 许可证 | 本包借什么 | 是否已抄入本仓 |
| --- | --- | --- | --- |
| [liyupi/dsh-kun-like-pet](https://github.com/liyupi/dsh-kun-like-pet) `1.0.0` | **MIT**（`Copyright (c) 2026 liyupi`） | 仅 `src/client.js` 顶部 `ROWS` 的**帧表数据**（8 列 × 9 行：状态名 / 帧数 / 每帧毫秒）与 9 条气泡文案 | ❌ **未抄入**。骨架只登记行名（见 `src/upstream.js` 的 `UPSTREAM_ROWS`），不含帧时长与文案 |

## 明确**不**借

| 项 | 原因 |
| --- | --- |
| `src/host.js` 全文 | 含 `child_process` 系统命令放音与 `agents` 500ms 轮询，与本仓事件流重复且引入风险面 |
| `assets/spritesheet.webp`（2079622 B） | 代码 MIT **不等于**素材 MIT；上游未单独声明素材归属。评审若需素材须自备 |
| `assets/voice.mp3`（32539 B） | 同上，且是特定网络流行语录音，不适合放进工作台 |
| `shell.overlay` 挂载方式 | 本仓规划页已有 pet，全局覆盖层构成「重复且无增益」 |

> MIT 要求保留版权声明与许可全文。若将来抄入帧表常量，本目录需同时放入
> 上游 `LICENSE` 的副本，或在文件头保留 `Copyright (c) 2026 liyupi / MIT` 声明。
