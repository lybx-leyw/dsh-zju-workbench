# @lybx-leyw/dsh-zju-tool-chalaoshi

查老师读工具包。一个域一个包：`source/chalaoshi` ↔ `tool/chalaoshi`。

| 工具 | 动作 |
| --- | --- |
| `campus_chalaoshi_read` | `search` / `teacher` / `course` |

三条 provides 全部是读，没有写面。

## 两条必须联网，而站点在国内不可达

`teacher` 取教师详情页、`course` 取绩点表，两者都不在本地索引里。失败原因是
**网络**而不是「查不到」—— 工具描述里写明了，免得模型把它说成「这位老师不存在」。

索引检索本身可离线（`search` 走本地缓存）。

## 同名教师不猜

`teacher` 不给 `teacherId` 时先搜再定位：同名（或命中多个）时**拒绝并列候选**，
不挑第一个。挑错的后果是把 A 老师的评价当成 B 老师的。
