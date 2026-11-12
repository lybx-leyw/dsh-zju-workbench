# @lybx-leyw/dsh-zju-source-notice

浙江大学校内通知公告数据源：教务网、本科生院、学工部、研工部、研究生院、团委、
综合服务网、信息技术中心、图书馆，以及各学院（系）官网的通知列表与正文。

纯只读（D17），`auth: cas`，`network: campus`。

## 平台事实

### 覆盖多少站点

| 层次 | 数量 | 来源 |
| --- | --- | --- |
| 部处 / 校级来源 | 9 个来源、22 个栏目 | `src/notice.js` 的 `SOURCES`（照上游 `sources.ts` 逐个搬来） |
| 学院（系）官网 | **44 个学院、392 个栏目** | `data/colleges.json`（上游 `scripts/notice/colleges.ts` 从学校主页学院名录生成） |
| 主机标注表 | **69 个主机**（50 个公网可达、19 个只在校园网） | `data/hosts.json`（上游 `scripts/notice/hosts.ts` 从校外实测生成） |

`hosts.json` 里还有 **2 个学院官网读不出来**（社会学系、医学院）—— 上游把它们记在
`colleges.json` 的 `skipped` 里，本包在 `sources` 动作的 `collegesNotReadable` 里如实列出。
**这两个学院的官网通知本包拿不到**，不是「没有通知」。

### 三套适配器，分派依据各不相同

这是本包最容易读错的地方 —— **分派依据不是同一件事**：

| 适配器 | 管什么 | 靠什么分派 |
| --- | --- | --- |
| `webplus` | 网站群站点的**列表页 + 正文页** | `SOURCES` 里每个来源的 `adapter` 字段；学院来源由 `colleges.json` 生成，一律 `webplus` |
| `zdbk` | 教务网的**列表页** | 同一个 `adapter` 字段（只有「教务网」这一个来源是 `zdbk`） |
| `kyjs` | 竞赛管理系统的**正文** | **不是来源字段**，而是**按 URL 特征**：主机 `kyjs.zju.edu.cn` + 有 `newsId` 查询参数 |

`kyjs` 为什么不在来源表里：它**没有自己的通知列表**。本科生院「实践交流」栏的学科竞赛、
大创条目**外链**到那里，所以它只在取正文（`detailOf`）时参与分派，不是一种「列表适配器」。

### 为什么列表适配器必须是两套

不是因为列表页长得不一样（虽然确实不一样），而是**取数通道完全不同**：

- `webplus`：`GET /<栏目号>/list.htm`，纯 HTML，条目与条数都靠 `#wp_paging_w<n>` 分页条推断；
- `zdbk`：`POST /jwglxt/xtgl/xwgl_cxXwListAlltzgg.html?doType=query&gnmkdm=index`，
  jqGrid 的 **JSON**（条件在表单体里，`queryModel.*` 传分页），且**必须带 CAS 会话**。

一套是「解析 HTML」，一套是「带会话 POST 拿 JSON」。硬合成一套只会让两边都变形。

### `webplus` 的列表条目是怎么定位的

各站模板不同（`li`、`div`、`tr` 都有），共同点只有一条：**分页条之前紧挨着的一组同级元素**，
每个里面有文章链接和日期。所以判据是：

1. 从分页条前最后一个链接往上找；
2. 第一层「同名兄弟元素不少于本页条数」的就是条目；
3. **条数由分页条自己算出**（`all_pages` / `all_count` / `per_count` / `curr_page`）——
   最后一页是 `total - per*(pages-1)`，不是 `per`；
4. 对不上就报 `DRIFT`，**绝不**随便找个容器当条目列表。

### 正文容器按什么顺序认

`news_con`（教务网）→ `wp_articlecontent` / `v_news_content` / `id="vsb_content"`（网站群）
→ `col-lg-offset-2` + `col-md-offset-1`（某学院模板）→ `<article>`。

⚠️ 第一条有个**例外**：信息技术中心（itc）的模板把导航栏也叫 `news_con`。所以只有
「没有 `wp_articlecontent`，或它嵌套在 `news_con` 里面」时才用 `news_con` ——
否则会把导航链接当正文。

## 能力（4 个只读方法）

| 方法 | 路由 action | 作用 |
| --- | --- | --- |
| `list({ keyword?, source?, since?, until?, limit?, profile? })` | `list` | 通知列表 + 正文（`limit` 默认 10、上限 200） |
| `view({ title?, url?, profile? })` | `view` | 按链接（可多个，竖线分隔）或标题取全文 |
| `noticeNew({ reset?, source? })` | `new` | 上次查看之后新发布的（只有标题、日期、来源、链接） |
| `sources({ profile? })` | `sources` | 已接入的来源、栏目、网络归属与学院名录。**不联网** |

同一个源上还有 `status` action（不给 AI 用，给设置页看）：返回 `{ ready, routePath, methods }`。

### `source` 怎么写

来源名（`学工部`）、别名（`奖学金` → 学工部·评奖评优）、栏目名（`学籍管理`）、
学院名（`计算机科学与技术学院`），多个用 `、` / `|` / `，` 分隔，`全部` 表示所有已接来源。
本人学院写 `学院`。

### 默认来源与增量来源不是同一批

- 不给 `source` 时读 `default` 栏目 —— 本人学院的栏目**排在最前**（学院转发校级通知时会
  加上院内的安排和截止时间，重复时留学院那条）；
- `noticeNew` 读 `feed` 栏目 —— 例如综合服务网的「即时更新」只在这里读，因为那是教职工事务
  为主的流，进默认集会淹掉学生通知。

## 两份数据文件

| 文件 | 是什么 | 谁生成的 |
| --- | --- | --- |
| `data/hosts.json` | 逐站标注表：每个主机从校外能不能直连（`public` / `campus`），带 `cas` 标记 | 上游 `scripts/notice/hosts.ts`，2026-10-09 从校外实测 |
| `data/colleges.json` | 学院名录：44 个学院的 id/名称/学部/主页，以及各自的栏目（id、base、audience、最新日期）；另有 `skipped`（读不出来的学院） | 上游 `scripts/notice/colleges.ts`，2026-10-06 从学校主页学院名录生成 |

两份都是从上游 `packages/vendor/zju-assistant/core/zju/lib/notice/` **原样复制**的
（SHA-256 逐字节一致），没有内联成 JS 常量 —— 表会继续变长，内联会让文件没法维护。

用 `readFileSync` 加载而不是 `import … with { type: 'json' }`：后者的语法在
Node 22 与 24 上不一致（`assert` 与 `with` 两种写法互不兼容），而本仓要同时支持。
`package.json` 的 `files` 里包含 `data/`，否则 `npm pack` 出来的包读不到这两份表。

表里**没有的主机按 `campus` 算**。猜成 `public` 会让校外用户拿到一个必然超时的请求。

## 「宁可报错也不猜」的地方

| 情形 | 本包怎么做 | 为什么不能猜 |
| --- | --- | --- |
| 页面说本页有 N 条，但一条也没解析出来 | 抛 `DRIFT` / 进结果的 `drift` | 静默返回空列表会让用户以为「这个栏目没有通知」 |
| 认不出正文容器 | 标 `summary-only`（只有 meta 摘要）或 `unavailable` | 退回「整页文本」会把导航、页脚、相关新闻当正文 |
| 网站群的错误提示页（200 + `wp_error_msg`） | 抛 `SHAPE` 并**转述页面上的话** | 那是「栏目不存在/无权查看」，不是「没有通知」 |
| 详情页缺少标题 | 抛 `SHAPE` | 编一个标题会让下游无法发现站点改版 |
| 学院名对不上名录 | 不含该学院的栏目，并在 `profile.hint` 里说明 | 猜一个学院会把别人的通知读给你 |
| 班级/学院名对得上多个 | 报 `CONFIG` 让你写全称 | 「公管」同时命中公共管理学院与公共政策研究院 |
| 教务网列表标题被截断到约 20 字 | 补正文时用详情页的完整标题换掉；取不到就保留带 `...` 的原样 | 猜全文会让关键词检索失真（见下） |
| 按标题找到多条 | 抛 `NEEDS_USER` 并给候选 | 随便挑一条等于替用户做了选择 |
| 链接指向 `10.x` / `192.168.x` / `172.16-31.x` | 抛 `UNREADABLE`，不发请求 | WebVPN 只代理声明的域名，那一跳必然超时 |
| 教务网返回 200 + 登录页 HTML | 判 `AUTH_REQUIRED` | 按状态码判会一路报「JSON 无法解析」，归因完全错了 |

## 关键词检索的两个坑（上游实测）

1. **简称搜不到全称**：「推免」搜不到「推荐免试研究生」，「大创」搜不到「创新训练」。
   本包对这两个词自动展开（`KEYWORD_ALIASES`），最多一次 8 个说法。
2. **教务网只比对截断标题**：列表里的 `xwbt` 被截断到约 20 字，「关于…本科课程第三轮选课
   的通知」搜「选课」搜不到。本包另取最近 100 条，用完整标题在本地再比一遍。

## 登录

上游 `module.json` 声明 `auth: cas`，但**绝大多数栏目其实不需要登录** —— 只有个别站点
（信息技术中心）落到统一身份认证登录页时才要。本包的做法是「遇到再说」：

```js
const notice = ctx.get('zwNotice')
notice.setServiceLoginProvider(async ({ service, host }) => {
  // 拿 service 走一遍 CAS（通用实现在 @lybx-leyw/dsh-zju-source-login/cas，tier 0）
})
await notice.list({ limit: 10 })
```

没注入这个回调时，遇到要登录的栏目会抛 `AUTH_REQUIRED` 并指到「设置 → 浙大一卡通」——
**不会**把登录页当数据去解析。同一站点的并发委托共用一次。

## 为什么不依赖 `zdbk`

上游的 `module.json` 里 `requires` 有 `zdbk`，因为它的教务适配器直接借了 zdbk 模块的会话。
**本仓不这么做**：`source/zdbk` 与 `notice` 都是 tier 1，而「tier 1 不得依赖另一个 tier 1」
是硬规则（`tests/source-capability.test.mjs` 有守卫）。

教务适配器需要的东西恰好只有两件，都来自 tier 0：

1. **一个已登录的会话** —— 由注入的 `request`（通常是 `Transport`）提供，`Transport` 来自
   `@lybx-leyw/dsh-zju-source-http`；
2. **CAS 登录流程** —— `@lybx-leyw/dsh-zju-source-login/cas`（tier 0）。

所以「POST jqGrid 列表 + 解析详情页」在 `src/notice.js` 里**独立实现**，与 `zdbk` 包
不共享一行代码。代价是教务的列表解析有两份实现；收益是删掉/改版 zdbk 不会连带弄坏通知。

`dsh.capability.requires` 因此只有 `@lybx-leyw/dsh-zju-source-http` 一个。

## 超时与并发

- **超时必须自己 race**：`sharedFetch` → `egress.fetch` → `undici.fetch` 这条链上
  **没有任何一层读 `timeoutMs`**（只有 `Transport` 读）。而本包收的 `request` 是注入的，
  未必是 `Transport`。所以 `withTimeout` 既传 `signal`（让守规矩的实现能取消），
  也自己 race 一个定时器（保证再差的实现也一定超时）。通知站点多、质量参差，这一条尤其要紧：
  一个挂死的栏目会让整次查询永远不返回。
- **重试三次**：前两次 3.5 秒短超时（上游实测：校外进校内的新连接有几个百分点会一直不回应），
  第三次 10 秒。只对 `TIMEOUT` / `NETWORK` 重试。
- **并发上限**：站点任务 8、取正文 4、补标题 6；栏目内取页 4。
  上游是用 `maxSockets: 8` 达到同一个效果，本包在任务层限流，不依赖出口实现。

## 没有设置分区

`auth: cas` 但统一身份认证由集成层注入，本包无用户可配置项 → 进
`tests/source-settings.test.mjs` 的 `NO_SETTINGS` 白名单。

## 写操作去哪了

**没有写操作**。上游 `notice new` 会写 `data/notice/seen.json`，本仓把这件事留在调用方：
`noticeNew` 返回算好的 `seen`，持久化由 `setSeenStore({ load, save })` 注入。
所以本包在磁盘上没有副作用，`writes: false`。

## 已知限制

**这些是事实，不是待办。**

### 已经验证过的

- 纯函数（实体解码、HTML 解析、日期、标题归一、去重、关键词、来源选择）—— 有 118 条测试；
- 三套适配器的分派与解析 —— 有测试，**但夹具是按上游注释推断的**；
- 两份数据文件的形状与数量 —— 有测试（断言「大于 N」而不是精确值）；
- 插件入口的服务名、路由路径、非法 action —— 有测试。

### 没有验证过的

- **没有打过任何一个真实站点。** 所有请求夹具都是合成 HTML。上游注释是页面结构的唯一依据。
- **`parseHtml` 不等价于 `parse5`。** 上游用 `parse5`（完整的 HTML5 树构建算法），本包自带一个
  容错解析器。它保证「标签、属性、文本、父子关系」对规整 HTML 成立，但**畸形 HTML 的隐式闭合
  行为**（`<p>` 里嵌 `<div>`、表格里漏 `</td>`）与 HTML5 规范有差距。正常网站群模板产出规整
  HTML，但这一点不能当成「等价」。
- **`webplus` 的条目定位是推断。** 「分页条之前紧挨着的一组同级元素」来自上游注释与实现，
  没在真实页面上核过。真实模板若把分页条放在条目**之前**，或条目与分页条之间隔了一层
  wrapper，会落到 `DRIFT`（明确报错，不是静默空）。
- **日期写法只覆盖上游记录的四种。** 上游说「日期可能是 `2026-09-30`、`2026.09.30`、`22-09-05`，
  只有 `2026-09`，或把日和年月拆成两个元素」。其他写法（英文月份、`9/30`）不认，会落到 `DRIFT`。
- **`hosts.json` 与 `colleges.json` 的时效性。** 分别生成于 2026-10-09 与 2026-10-06。
  学院官网的栏目号会变、站点会下线。变的后果是 `sourceErrors` 里出现 `HTTP 404` 或 `DRIFT`，
  不会静默给错数据 —— 但**表本身不会自己更新**，需要重新跑上游的生成脚本（本仓没有移植它们）。
- **`zdbk` 适配器的分页参数没有实测。** `queryModel.showCount` / `currentPage` / `sortName` /
  `sortOrder` 取自上游 `zdbk/client.ts` 的 `grid()` 与 `notice/adapters/zdbk.ts`，本仓重写了一遍。
  服务端若对参数名更敏感，症状是「回 200 但 items 全空」。
- **`kyjs` 的接口路径没有实测。** `/prod-api/home/news/detail?newsId=` 来自上游注释。
- **`detailUrl` 的 `doType=save` 是服务端副作用**（把该条标为已读）。上游照用，本包照用。
  重试可能重复标记，但重复标记没有可观察的副作用。**只有「按编号自己拼地址」时才加**这个参数，
  用户直接给的链接原样去取。
- **教务网标题缓存不落盘。** 上游把完整标题缓存在 `data/cache/`，本包由调用方注入一个 `Map`。
  进程重启后要重新取一次（每条一次详情请求）。
- **「全部」模式下本人学院排在来源之后**，与默认集（学院在前）相反。这是上游 `select()` 的
  行为，本仓照抄，测试里钉住了。它的后果是合并优先级在两种模式下不同。

### 与上游的已知差异（有意为之）

| 项 | 上游 | 本仓 | 为什么 |
| --- | --- | --- | --- |
| 身份推断 | 读个人档案，必要时从教务网课表读学院并落盘 30 天 | **不做**，`level` / `college` 由调用方注入 | 有副作用的身份推断不该藏在数据源里（D17 只读） |
| 已读记录 | 写 `data/notice/seen.json` | 返回 `seen`，由 `setSeenStore` 落盘 | 磁盘上不留副作用 |
| `isInternalAddress` | 正则 `/(?:10\|127\|192.168\|172.(?:1[6-9]\|2d\|3[01]))./` | 按 RFC 1918 的三段正确实现 | 上游那条有两个字面缺陷：点是未转义的（`192x168` 也命中）、`2d` 是从 `2[0-9]` 打错的（`172.20`–`172.29` 全漏） |
| HTML 解析 | `parse5` | 自带容错解析器 | 不为一个数据源新拉一棵 DOM 树 |
| 教务网的「无权访问」页 | 在 zdbk 适配器里重取 | 在 `zdbkDetail` 里重取（逻辑相同，位置不同） | 本包不 import zdbk |
| `requires` | `core`、`profile`、`zjuam`、`webvpn`、`zdbk` | 只有 `@lybx-leyw/dsh-zju-source-http` | tier 1 不得依赖 tier 1 |

## 来源与许可

移植自 [`dsh-zju-assistant`](https://github.com/Anchorite-no/dsh-zju-assistant)
（GPL-3.0-only）的 `core/zju/lib/notice/`。本仓是 GPL-3.0-or-later，兼容。

移植范围、**全部改动**（含 HTML 解析层替换、身份推断移除、`isInternalAddress` 的上游缺陷修复）
与明确丢弃的清单，见本包的 [ATTRIBUTION.md](ATTRIBUTION.md)。
⚠️ 仓库根 `ATTRIBUTION.md` 那条目前还写着「未复制其任何源码」——那是本包改造**之前**的结论，
需要一并上移，但那一步不在本包的改动范围内。
