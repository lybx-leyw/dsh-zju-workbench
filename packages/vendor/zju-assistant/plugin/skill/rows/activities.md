## 活动与场馆

素质拓展平台（sztz，二课三课）和体育场馆（tyys）。下表是 `zju` 的 `args`。

| 用户目标 | 调用 |
|---|---|
| 二课、三课分够不够 | `sztz credits` |
| 最近有什么二课活动 | `sztz activity list`，可加 `--keyword`、`--date`；只问有没有新出的 `sztz activity new` |
| 竞赛、实践能记多少点 | `sztz projects`，可加 `--keyword`、`--category 第三课堂` |
| 我报名和收藏的活动 | `sztz activity mine` |
| 报名、取消报名 | `sztz activity signup --name 活动名 --confirm`，取消加 `--cancel`；收藏 `sztz activity favorite --name 活动名 --confirm` |
| 场馆空场 | `tyys venue list --sport 运动 --campus 校区 --venue 场馆 --date 今天`（今天到 3 天后） |
| 放号时间、预约须知 | `tyys venue notice` |
| 预约场馆 | `tyys venue book --venue 场馆 --sport 运动 --date 日期 --time 19:00 --confirm` |
| 我的预约、取消 | `tyys venue order list`；`tyys venue order cancel --venue 场馆 --date 日期 --time 时段 --confirm` |

目标明确时直接 `tyys venue book`，不先 list 或 notice 预检；它自己处理同伴、验证码和回查。还没放号时它返回预计放号时间，约满时返回相邻时段，照实告诉用户、问他要哪个，不擅自改时间。不抢场：一放号就抢的不做，可以建只查不约的空场提醒。

命令细节：[二三四课堂]({{core}}/zju/references/sztz.md) · [体艺]({{core}}/zju/references/tyys.md)
