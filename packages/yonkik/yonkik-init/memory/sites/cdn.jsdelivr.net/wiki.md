# 国家节假日与调休（holiday-cn）

这是 [holiday-cn](https://github.com/NateScarlet/holiday-cn) 的第三方公开镜像，不是浙大校历 API。依据为国务院办公厅公告。只读路径来自[上游固定版本](https://github.com/Anchorite-no/dsh-zju-assistant/blob/aaf602aabf52f3f337cb2449a4495b685b9f5b07/plugin/host/holidays.mjs)；本地不更改校历、补课映射或用户日程。

## 已验证

| 公告年份 | 来源 | 放假日期数 | 补班日期数 |
|---|---|---:|---:|
| 2026 | [国办发明电〔2025〕7号](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm) | 33 | 6 |
| 2027 | [国办发明电〔2026〕10号](https://www.gov.cn/zhengce/zhengceku/202611/content_7085102.htm) | 29 | 5 |

2026-11-22 从同一 HTTPS 镜像各读取一次，两个年度的日期、节日和放假/补班值与原文转录逐项一致；镜像快照参考提交 e8ea0633fb5de9b03e72278b858554a60669ba99。2028 年文件本次 404，只记“镜像无文件”，不能当作年度无放假。

## 用法

- `crawler.mjs year 2027 --summary`：离线返回已对照的公告摘要，去掉 --summary 即返回完整条目。
- `crawler.mjs day 2027-01-31`：明确是春节调休补班；无记录且数据覆盖齐备，才显示普通周历推定，不表示雇主或学校安排。
- `crawler.mjs remote-year 2027 --summary`：只请求一个年度 JSON，无凭据、不跟跳、不重试。未对照过的年份标为镜像数据，不能当成独立官方验证。
- `verify-holidays.mjs`：离线校验日期、补班、跨年、遗漏及冲突。

## 边界

日期为中国节假日安排的民用日期，不与浏览器时区换算。`isOffDay=false` 是明确调休上班，不能当缺项；true 包括公告放假范围中的自然周末，不是狭义法定假日天数。自然周末不一定写入 JSON。文件按公告标题年份而非日期年份组织，12 月需查当年和下一年；覆盖不足返回未知，不补造默认值。例如 2019 年公告的数据包含 2018-12-29 补班及 2018-12-30、31 放假。另见[仓库说明](https://github.com/NateScarlet/holiday-cn#注意事项)。
