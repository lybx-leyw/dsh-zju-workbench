# @lybx-leyw/dsh-zju-tool-yjsy

研究生教务网读工具包。一个域一个包：`source/yjsy` ↔ `tool/yjsy`。

| 工具 | 参数 |
| --- | --- |
| `campus_yjsy_read` | `year`、`term`（都可省略） |

只有一条 provides（`yjsy timetable`），纯只读。

## 这不是本科教务的课表

本科课表在 `campus_zdbk_read` 的 `timetable`：两个平台、两套登录、两份课表。
研究生同时有本科教务账号时会看到两份不同的表 —— 那是对的。
