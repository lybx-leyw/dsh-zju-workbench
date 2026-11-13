# @lybx-leyw/dsh-zju-source-chalaoshi

查老师（`chalaoshi.de`）数据源：**教师评分与课程绩点**。纯只读，`auth: none`。

## ⚠️ 这个站点在国内不可达

上游 2026-09-17 在外部主机实测：站点、两个 `ip6.arpa` 镜像全部不通。
2026-11-10 在本仓开发机复测：站点、索引、API 三个地址**全部连接失败**，与上游一致。

**WebVPN 帮不上忙** —— 它不是校内站，网关没得转发。要能出海才能首次拉到索引。

因此本包的工作方式是：

| 场景 | 行为 |
| --- | --- |
| 有缓存 | **完全离线可用**，搜索走本地索引（这是主要价值） |
| 无缓存 | `search` 抛 `UNREACHABLE`，说明需要出海，不假装"没有这位老师" |

## 能力

| 动作 | 作用 |
| --- | --- |
| `chalaoshi.search` | 本地索引搜索：姓名 / 拼音 / 首字母，可带学院 |
| `chalaoshi.teacher` | 读教师详情页（**会打站点**，国内多半失败） |
| `chalaoshi.course` | 一门课所有任课老师的平均绩点表（**会打站点**；上游 `chalaoshi course`，审计 W-14） |
| `indexStatus()` | 索引状态（不联网）：有没有缓存、多少位教师、多久前拉的 |
| `refresh()` | 拉/刷新索引（条件 GET） |

### 搜索的分档

站点的索引约 1 MB、一万多位教师。**没有搜索接口** —— 站点自己也是把整份 JSON
下载后在浏览器里过滤。本包照做，搜索纯本地。

打分档次决定「用户到底想找谁」：全等 100 → 姓名开头 80 → 姓名包含 60 →
子序列 30；拼音全等 90 → 首字母全等 70 → 拼音开头 45–55 → 首字母开头 40 → 拼音包含 25。

再加小额加成（有评分 +3、人气 0–3、评分 0–2），同分档时把好老师排前。
**分数是相对的，不对外承诺** —— 排序稳定比数值精确重要。

`"王伟 数学"`、`"ww 计算机"` 这类混合查询会被自动拆开：能对上学院名的 token
转成学院过滤，剩下的当姓名。

### 评分字符串的三种值

站点给 `"9.4"`（有评分）、`"0.0"`（无评分）、`"N/A"`（没有数据）。
后两种都转成 `null` —— 区分它们对调用方没有意义，而 `0` 会被误读成「很差」。

## 服务面

| 成员 | 作用 |
| --- | --- |
| `routePath` | `/api/zw-chalaoshi` |
| `readOnly` | 恒为 `true` |
| `methods` | `['chalaoshi.search', 'chalaoshi.teacher', 'chalaoshi.course']` |
| `indexStatus()` | 索引状态 |
| `refresh(options)` | 拉索引；`{ fresh: true }` 忽略条件头 |
| `search(input)` | `{ keyword, sort?, limit?, ratedOnly?, college?, fresh? }` |
| `teacher(input)` | `{ id }` → 详情页 HTML |
| `course(input)` | `{ course }` → `{ course, count, teachers[] }`（均绩点 / 标准差 / 样本） |

同源路由 `POST /api/zw-chalaoshi`，动作 `search` / `teacher` / `course` /
`index-status` / `refresh`。

> `course` 早先被写成「解析留给消费方」。那不是裁决 —— 它等于把上游一条能力
> 丢给每个调用方各写一遍（审计 W-14 的改判）。现在解析在本包，返回结构化字段。

## 索引缓存

存在 `profileContext.dir` 下的 `chalaoshi-index.json`。缓存损坏或不存在都当作
**没有缓存** —— 搜索会退化成需要联网，而不是把坏文件当成空索引（那会让搜索结果
静默变空）。

新鲜期 7 天。过期后做一次条件 GET（`If-None-Match` / `If-Modified-Since`），
304 只更新 `fetchedAt`，不重写 1 MB 数据。

## 没有设置分区

与 `webvpn` / `http` / `classroom` / `zdbk` / `yjsy` 同类：没有任何用户可配置项。
见 `tests/source-settings.test.mjs` 的白名单。

## 已知限制

- **没有用真实索引验证过搜索质量**：开发机无法访问站点，测试全部用合成索引。
  分档分数照上游实现，但「哪些结果该排前面」需要在真实数据上再看一次。
- 教师详情页与课程绩点表**尚未解析成结构** —— 只返回原始 HTML，解析留给消费方。
  上游有 `fetchTeacherPage` 之外的评论/绩点解析，本包没搬。
