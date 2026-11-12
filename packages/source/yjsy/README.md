# @lybx-leyw/dsh-zju-source-yjsy

浙大**研究生教育管理信息系统**（`yjsy.zju.edu.cn`）数据源：**本人研究生课表**。

纯只读（D17：数据源只提供事实），不含任何写操作。

## 为什么单独一个包

本科教务网（`packages/source/zdbk`）**查不到研究生课**。研究生、以及选了研究生课的
本科生，他们的课在这个系统里；两边要排进同一张日程表，所以需要这个源。

上游对应的是一份 15.6 KB 的单方法模块（`core/zju/lib/yjsy/index.ts`，1 条 provides）。

## 能力

| 方法 | 作用 | 参数 |
| --- | --- | --- |
| `yjsy.timetable` | 本人一个学期的课表：教师、星期、节次、起止时间、地点、周次，**以及每次课的日期** | `year?` / `term?` |

`term` 可取 秋 / 冬 / 春 / 夏 / 秋冬 / 春夏；不给时问系统「现在是哪个学年学期」。

返回值里值得一提的几处：

- `periodTimes` —— 节次与起止时间的对照表（第 14 节的下课时间按官方页面口径强制成 `22:05`）；
- `courses[].meetings[].dates` —— **已经按教学日历算好的每次课日期**，调用方不用自己推；
- `courses[].meetings[].weeks` —— 冬、夏学期的周次已换算成**该小学期里的第几周**
  （接口按大学期从 1 数，直接用会与用户自己数的不一致）；
- `unscheduled` —— 上课时间地点由学院另行通知的课，单独一个数组，不混进 `courses`；
- `courses[].pending` —— `xkzt === 12`，页面上标橙色的「还没处理完的选课」；
- `courses[].undergraduate` —— `bkbj === 1`，本科生课（选了研究生课的本科生的课会混在这里）。

## 登录：注入优先，共享 CAS 兜底

研究生教务网要两跳：**CAS 给 `service` 签票**，再拿票
`GET dataapi/sys/cas/client/validateLogin?ticket=&service=` 换成 `X-Access-Token`。

第一跳是通用的，走 `source/login` 的 `casLoginFor`；**第二跳必须在本包做** ——
只有本包知道 `dataapi` 前缀与那两个入口。这与 `tyys` / `sztz` / `notice`
的做法一致：凭据与 CAS 流程都在 tier 0，数据源只说明自己要哪个 `service`。

```js
// 常规路径：装了 source/login 就能用（会在「设置 → 浙大一卡通」取账号）
const table = await ctx.get('zwYjsy').timetable({ username: '2234567890' })

// 可选：装配方有更完整的票据链时，注入自己的 provider，优先于共享 CAS
yjsy.setTokenProvider(async ({ entry, service, username }) => {
  // 返回 access token 字符串；返回空串会让本包去试另一个入口
})
```

`ready()` 两条路都算：注入过 provider，或宿主装了 `source/login`。

> 早先这里写「本包不碰 CAS，等集成层注入」。那个集成层**始终没有出现**，
> 结果是这个包挂得上、用不了（`abandoned.md` 的 A-4）。现在改成自己走共享 CAS，
> 与另外五个包同一条路。

两条路都没有时调 `timetable()` 会抛 `CONFIG` 并说清缺什么，不会静默返回空课表。

**换不到 token 时把平台原话带出来**：本科生走研究生入口会拿到 500「无效的用户信息」，
那句话会出现在最终错误里 —— 否则用户只会看到「登录失败」。

## 服务面

| 成员 | 作用 |
| --- | --- |
| `routePath` | `/api/zw-yjsy` |
| `readOnly` | 恒为 `true` |
| `methods` | `['yjsy.timetable']` |
| `setTokenProvider(handler)` | 注入取 token 的能力（优先于共享 CAS）；返回撤销函数 |
| `ready()` | 是否已接入登录（注入过 provider，或宿主装了 `source/login`） |
| `timetable(input)` | 取课表；会话失效时自动重换一次 token |
| `reset()` | 清掉缓存的会话（换账号、或用户点了「重新登录」） |

同源数据路由 `POST /api/zw-yjsy`，信封 `{ action: 'timetable', input: {...} }`，
响应 `{ ok, value }` 或 `{ ok: false, error: { code, message } }`。

## 出口与网络

`network: public` —— 研究生教务网从校外**能直连**（`hosts.js` 里判 `public`），
所以即使 `mode: 'webvpn'` 也不会被绕道网关。这是 D4 主机表裁决的直接效果：
改成主机表之前，它和所有 `*.zju.edu.cn` 一样被无谓绕行。

请求走 `sharedFetch(ctx)`（`source/http` 提供），它绕开宿主为 LLM 配的全局代理 ——
实测浙大域名经海外代理 7 秒后 `ECONNRESET`。

## 没有设置分区

与 `zdbk` / `classroom` 同类：只走 CAS，没有任何用户可配置项，状态读数并入
「浙大统一身份认证」分区的「这份凭据的用途」卡片。硬造一个只显示状态的设置页，
会让同一件事在设置里出现两处（`tests/source-settings.test.mjs` 的白名单记了这条理由）。

## 已知限制

- **token 缓存只在进程内**，不落盘。重启后要重新过一次 CAS。
- 上游 2026-11-02 的实测记录写明：「用没选研究生课的本科生账号实测过登录、学年学期、
  教学日历和**空课表**，有课时的数据还没对过真实账号」。本仓的解析逻辑照该记录实现，
  但**同样没有用有课的真实账号验证过**。
- 单次调用会对每个小学期各发一次课表请求（秋冬 = 2 次）。上限固定，不随课数增长。
