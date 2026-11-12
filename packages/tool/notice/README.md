# @lybx-leyw/dsh-zju-tool-notice

校内通知读工具包。一个域一个包：`source/notice` ↔ `tool/notice`。

| 工具 | 动作 |
| --- | --- |
| `campus_notice_read` | `list` / `view` / `new` / `sources` |

纯只读数据源（`source/notice` 的 `readOnly: true`），所以本包**没有**写工具，
也不带审批。

## `new` 会写本地已读记录

它不动任何站点数据，但会更新本机「上次看到哪」。工具描述里写明了 —— 否则模型
会以为它是幂等查询，反复调用会把「新通知」这个状态消耗掉。

## 认证

部分栏目要统一身份认证：没配「浙大一卡通」时 source 会报 `AUTH_REQUIRED`
并说清去「设置 → 浙大一卡通」配一次。本包不重复那句话。
