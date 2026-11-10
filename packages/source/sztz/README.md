# @lybx-leyw/dsh-zju-source-sztz

浙江大学大学生**素质拓展数智平台**（`sztz.zju.edu.cn/dekt`，简称「二三四课堂」）数据源：
第二、三、四课堂的活动、项目、记点与成绩单。

纯只读（D17），`auth: cas`，`network: campus`。

## ⚠️ 主机只解析到校内地址

`10.203.15.167` —— 校外必须经 WebVPN。

## 接口事实

| 项 | 值 |
| --- | --- |
| 根 | `https://sztz.zju.edu.cn/dekt` |
| 响应信封 | `{ code, msg, data, extend, count, totalPages }` |
| 成功判据 | **`code === 0`** |
| 未登录判据 | `code === -1` **且** `msg` 含「访问权限」 |
| 时间字段 | **UTC 的 ISO 串**，对外统一换成北京时间 |
| 请求头 | `X-Requested-With: XMLHttpRequest` |

### 三处容易写错的地方

**1. 未登录不报错，而是返回 `code: -1` + 「没有数据【…】访问权限!」**

所以「未登录」不是一个可抛的异常，而是一个**要重试的信号**：登录后重取一次。
活动列表更隐蔽 —— 它**可以匿名读**，只是负责人信息变成 `****`、不带本人报名状态。
本包对这两种情况都做「登录后重取一次」。

**2. 时区**

平台给 UTC，直接上屏会让用户看到差 8 小时的时间。`beijing()` 统一转成
`Asia/Shanghai` 的 `YYYY-MM-DD HH:mm`。

**3. 「已结束」看结束时间，不是开始时间**

上游注释写着「平台上有开始时间填错年份的活动」。用开始时间判断会把还**没结束**的
活动误判成已结束 —— 而长期活动的开始时间本来就早。本包用 `hdjssj`。

## 能力（6 个只读方法）

| 方法 | 作用 |
| --- | --- |
| `activities({ keyword?, date?, includeEnded?, limit? })` | 活动中心。默认只给还没结束的 |
| `projects({ keyword?, category? })` | 项目库（自己提交材料申请认定的，不是报名参加的） |
| `newActivities({ reset? })` | 上次查看之后新出现的、还能报名的活动 |
| `myActivities()` | 本人报名的、收藏的、已认定的活动 |
| `myCredits()` | 二三四课堂的记点、学分、等级与成绩单 |
| `bulletins()` | 平台通知（含附件下载地址） |

### `activities` 的排序

按 `报名中`（截止早的在前）→ `未开始报名` → `报名已截止` → `进行中` 排列。
`byStatus` 给出每种状态的条数。`includeEnded: false`（默认）时不列已结束的。

### `newActivities` 是纯本地比较

它读活动列表后在**本地**与已读记录比对，判断哪些是新的。已读记录由调用方通过
`setSeenStore({ load, save })` 持久化 —— 本包不决定存哪。

报名截止超过 7 天的记录会被清掉，免得越积越多。

**注意**：它只读活动列表、不读本人的报名与收藏，所以**不需要登录**。

## 登录

平台用统一身份认证的 **service 委托**：先 `GET login/getLoginUrl?returnUrl=<BASE>/`
拿到带 `service` 的 CAS 地址，走完 CAS 再回跳。

这段流程由集成层注入：

```js
const sztz = ctx.get('zhiyunSztz')
sztz.setSessionProvider(async () => {
  // 走一遍 CAS（D18 之后通用实现在 source/login/src/cas.js）
})
await sztz.activities({ limit: 10 })
```

本包不碰凭据、不重复实现 CAS。

## 写操作去哪了

按 D17，**写操作归 `packages/tool/`**。上游的三个写方法：

| 上游方法 | 平台接口 | 现在在哪 |
| --- | --- | --- |
| `signUp`（报名） | `student/home/hdbm` | 将来进 `packages/tool/campus-write` |
| `cancelSignUp`（取消报名） | `student/home/hdqxbm` | 同上 |
| `setFavorite`（收藏开关） | `student/home/hdsc` | 同上 |

三者在上游都过写闸，且「写请求只发一次、之后用本人列表回查」——
这套语义（包括「收藏是开关，重发会把状态翻回去」）要在 tool 包里实现，
本包**不含任何写代码**。

## 没有设置分区

`auth: cas` 但凭据由集成层注入，本包无用户可配置项 → 进
`tests/source-settings.test.mjs` 的 `NO_SETTINGS` 白名单。

## 已知限制

- **没有用真实账号验证过任何一个接口**：所有响应形状来自上游注释与逆向，
  测试全部用合成数据。上游 2026-09 的记录是这些字段的唯一依据。
- `listActivities` 的「往回读 90 天」是一个经验值：活动按开始时间倒序，
  要读到足够早才能覆盖「开始得早但还没结束」的长期活动。90 天不够时
  会漏掉更早开始的长期活动。
- 翻页上限 20 页（每页 50）。超出的部分读不到，会体现在 `hasMore`。
