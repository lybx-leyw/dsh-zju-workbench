# 浙大各学院／部处官网通知聚合（zju-notices）

> **本页索引**：这是什么 · 能力 · 26 个源 · 为什么只有 24 个（64 个的实测结果） · 解析方案 · 坑 · 只读边界 · 未闭环

**状态**：done（2026-11-20）｜**鉴权**：全部免登录｜**限流**：1.2s/串行
**脚本**：`crawler.mjs`（list / sources / health）｜**源清单**：`sources.json`

---

## 这是什么

学院级、部处级的通知**只发在各自官网**，学校门户（`service` / `s1` 百事通）收录不到。
比如「心理系研究生奖助金评选」「光电学院任前公示」「数学学院 Colloquium」—— 这些在全校门户里搜不到。

本资产把 **26 个实测可解析的源**聚合成一个入口。

## 能力

```bash
node sites/zju-notices/crawler.mjs sources              # 看 26 个源
node sites/zju-notices/crawler.mjs list                # 全量聚合（按日期倒序）
node sites/zju-notices/crawler.mjs list --days 7       # 只看近 7 天
node sites/zju-notices/crawler.mjs list --site 心理     # 按单位筛选
node sites/zju-notices/crawler.mjs health              # 全部源健康检查
```

实测（2026-11-20）`health`：**26/26 源全部成功**；`--days 7` 取 16 条。样例：

| 日期 | 单位 | 标题 |
|---|---|---|
| 11-19 | 控制学院 | 【通知】2026控制学院「控·致未来」新锐论坛-第5期 |
| 11-19 | 心理系 | 【研究生资助】2025-2026学年学业优秀奖助金评选通知 |
| 11-18 | 公共卫生学院 | 党总支赴富阳开展师德师风教育培训暨主题党日活动的报名通知 |
| 11-18 | 艺术与考古学院 | 党委拟发展党员名单公示 |
| 11-17 | 光电学院 | 关于沈易同志任前公示的通告 |

## 26 个源（按最新日期）

| 单位 | 主机 | 栏目 | 最新 |
|---|---|---|---|
| 数学科学学院 | www.math.zju.edu.cn | School Colloquium | 2026-11-20 |
| 控制科学与工程学院 | www.cse.zju.edu.cn | 科研学术 | 2026-11-19 |
| 心理与行为科学系 | www.psych.zju.edu.cn | 学生/评奖 | 2026-11-19 |
| 管理学院 | www.som.zju.edu.cn | 新闻动态 | 2026-11-19 |
| 公共卫生学院 | www.phs.zju.edu.cn | 通知公告 | 2026-11-18 |
| 艺术与考古学院 | www.soaa.zju.edu.cn | 最新通知 | 2026-11-18 |
| 光电科学与工程学院 | opt.zju.edu.cn | 通知公告 | 2026-11-17 |
| 集成电路学院 | ic.zju.edu.cn | 通知公告 | 2026-11-16 |
| 传媒与国际文化学院 | www.cmic.zju.edu.cn | 学院动态 | 2026-11-14 |
| 材料科学与工程学院 | mse.zju.edu.cn | 消息公告 | 2026-11-11 |
| 信息与电子工程学院 | www.isee.zju.edu.cn | 全部通知 | 2026-11-09 |
| 海洋学院 | oc.zju.edu.cn | 通知公告 | 2026-11-06 |
| 地球科学学院 | gs.zju.edu.cn | 通知公告 | 2026-11-05 |
| 人工智能学院 | ai.zju.edu.cn | 招生通知 | 2026-10-27 |
| 学工部 | www.xgb.zju.edu.cn | 学风建设 | 2026-09-18 |
| 教育学院 | www.ced.zju.edu.cn | 研究生培养 | 2026-08-25 |
| 网络空间安全学院 | icsr.zju.edu.cn | 招生公告 | 2026-05-28 |
| 生工食品学院 | www.caefs.zju.edu.cn | 师资/学术 | 2026-03-19 |
| 航空航天学院 | saa.zju.edu.cn | 通知公告 | 2025-11-28 |
| 哲学学院 | www.philosophy.zju.edu.cn | 最新通知 | 2024-12-10 |
| 马克思主义学院 | marx.zju.edu.cn | 教学改革 | 2023-03-12 |
| 基础医学系 | bms.zju.edu.cn | 研究院公告 | 2022-04-06 |
| 经济学院 | www.cec.zju.edu.cn | 会议通知 | 2019-11-04 |
| 脑科学与脑医学系 | www.neuroscience.zju.edu.cn | 通知公告 | 2017-06-16 |

## 为什么只有 24 个（64 个的实测结果）

对应 `dsh-zju-assistant` 的 `notice/hosts.json`（69 个源，其中 64 个本库未收录）。**逐站实测结果**：

| 情况 | 数量 | 说明 |
|---|---|---|
| ✅ **可用** | **24** | 能解析出条目 |
| ⚠️ 首页过短（几百字节） | 12 | `me` 879B、`www.cas` 585B、`www.ccea` 483B、`www.sis` 582B…… 站点已停维护或只有框架壳 |
| ⚠️ 502 不可达 | 7 | `*.office.zju.edu.cn` 一批（内网子站，后端不对外） |
| ⚠️ 栏目存在但无日期条目 | 3 | `physics`、`www.lit`、`www.grs` 的 list 页结构不同，未适配 |

**关键结论：他们标 `status: 0` 的 18 个 campus 类站，我们这边有 9 个能正常访问**——
因为本机在校园网内（那些站是「仅校内 IP」限制）。这正是我们相对他们的优势面。

## 解析方案（本资产核心）

**不要用 li 块解析。** 这批站的标题/日期容器各不相同：

```html
<!-- 常见形态 -->
<li><span class="news_title"><a title>…</a></span><span class="news_meta">日期</span></li>
<!-- som：用 div -->
<div class="news_title"><a title>…</a></div><div class="news_meta">日期</div>
<!-- ai：h3 + 裸 span -->
<h3><a href title>…</a></h3> … <span>日期</span>
<!-- ced：a 包住 p + span -->
<a href><p class="tit3">标题</p><span class="fbdate">日期</span></a>
```

**统一方案：以「日期」为锚点，向前回溯最近的 `<a>`**，取 `title` 属性（更干净）或内文。
好处：不依赖任何 class 名，四种模板全部覆盖。实测 23/24 直接可用。

## 坑

1. **编码逐页判**。这批站 UTF-8 / GBK 混杂，按 host 判必错。用 `content-type` + `<meta>` 双读，命中 gb 系上 `gb18030`。
2. **标题优先取 `title` 属性**。内文常带 `<font>` 高亮标签和多余空白，`title` 属性是干净的那份。
3. **`www.ced` 的「研究生培养」栏目里，条目本身就是课程名**（教育领导与管理 / 学校课程与教学），不是解析错。
4. **一半条目可能是微信外链**（`mp.weixin.qq.com`），本脚本不区分，需要时自己按 url 过滤。
5. **不要信他们记的栏目路径**。`www.xgb` 的 `53388/list.psp` 已失效（返回登录页），但根路径 `www.xgb.zju.edu.cn` 首页 54KB 完整、栏目是 `/53388/list.htm`。**`.psp` 换 `.htm`** 是常见修正。

## 只读边界

`list` / `sources` / `health` 全是 GET。不提供任何提交、报名、回复。

## 未闭环

- **physics / www.lit / www.grs / www.cbeis / www.cps / www.cst 六个站**：栏目页 200 有内容，但当时结构未适配（日期在特殊容器里）。**【已解决】** 2026-11-22 核实：六站现已全部适配（`phys-li` / `litweb-li` / `grs-li` / `cbeis-li` / `cps-li` / `cst-li`），共 16 行中 15 行已开放，仅 `www.cst` 有 1 行属别名不一致。
- **分页**：只抓首页（约 8-50 条），翻页未做。
- **正文**：只给标题+链接，不抓正文。需要正文时直接 `doc text` 或抓 url。
- **增量**：没有「上次调用之后新增」的标记位，`--days` 是时间窗近似。

## 协议差异（重要）

这批 26 站的 **http/https 支持各不相同**，且会随本机网络环境变化：

| 情况 | 例子 | 处理 |
|---|---|---|
| 只支持 https（http 301→https） | `ic` `mse` `ai` `icsr` `bms` `www.cst` | 必须用 https |
| 只支持 http（https ECONNRESET） | 部分老站 | 用 http |
| 两者都通 | 多数 | 优先 https |

**教训**：2026-11-21 发现几个站 https 失败，批量把 5 个源改成 http，结果全部 301 死循环——
因为它们**只认 https**。正确做法是对每个失败源**单独**探两种协议再写回（`crawler` 已内置最多 3 跳跟随，
但 http↔https 互跳永不收敛，会报「重定向未收敛」）。

**网络状态跨小时会变**：11-20 全部 https 可用 → 11-21 部分被 reset → 11-22 恢复。
所以 `health` 的结论要带时间戳。

## 经 WebVPN 的源（27 个里的 1 个）

`ygb.zju.edu.cn`（研工部）直连 502，站点在 sources.json 里标 `viaVpn: true`，
由 `crawler` 自动重写成 WebVPN 地址访问（需先跑 `sites/webvpn.zju.edu.cn/login.mjs`）。

三个实现细节：

1. **不依赖额外包**：`crawler` 内联了深信服的 host 编码（AES-128-CFB）与 URL 重写。
2. **要跟随重定向**：WebVPN 把 http 升级成 https 时会回 301（Location 仍带 VPN 前缀），必须跟；
   但跳到 `/wengine-vpn/failed` 就是真失败，停。
3. **条目链接要还原**：页面里的相对链接会被 VPN 解析成 `https://webvpn.zju.edu.cn/<path>`，
   这种「无 /http/ 前缀」的地址其实是目标站路径，已还原成 `http://ygb.zju.edu.cn/<path>`。

> 踩过的坑：`req` 的返回值最初漏了 `loc` 字段，导致重定向跟随永不触发，
> 表现是「HTTP 301（重定向未收敛）」。补上 `loc` 后立刻正常。

## 合并 zju-colleges（2026-11-22）

`zju-notices`（本资产，41 源）与 `zju-colleges`（62 站扫描）是一对**互补**的资产，
2026-11-22 合并成统一入口 `crawler-merged.mjs`。

### 合并后的源表

| | 数量 |
|---|---|
| 总站数 | **63** |
| 可达（本机） | **47** |
| 纯内网（需校园网/WebVPN） | **15** |
| 有明确栏目配置 | 41 |

**按来源拆开**：

| 类别 | 数量 | 说明 |
|---|---|---|
| 双方都有 | 25 | 栏目配置（本资产）+ 协议/IP（colleges） |
| **仅 colleges** | **21** | 本资产原本没覆盖（含 `www.cs` `/csen/`、`www.lit`、`www.cmm` 等） |
| **仅 notices** | **16** | 其中 **15 是纯内网**（`*.office.zju.edu.cn` 等），本机进不去 |

### 关键修正：那 15 个「502 不可达」不是下线，是纯内网

本 wiki 早前记「⚠️ 502 不可达 7 个（`*.office` 一批，内网子站，后端不对外）」。
2026-11-22 用**公共 DNS（DoH）**复核，结论更准确：

```
ygb.zju.edu.cn           local=198.18.0.6    DoH=无 A 记录
ai.office.zju.edu.cn     local=198.18.0.14   DoH=无 A 记录
...（15 个全部如此）
```

**公共 DNS 上根本没有 A 记录** —— 它们只在校园网内部 DNS 里存在。
所以不是「后端不对外」也不是「站点挂了」，而是**纯内网专有主机**。

本机 `dns.resolve4` 看到的 `198.18.0.x` 是**代理伪造 IP**（TUN 模式惯用段，
公网站经它正常、只有内网站连不通），不是这些站的真实地址。

**处置**：源表里标 `requiresVpn: true`，脚本遇到直接报「需校园网或 WebVPN」而不是去试——
避免用 15 个必然失败的请求浪费一轮扫描。

### 统一后的能力

```bash
node sites/zju-notices/crawler-merged.mjs sources              # 63 站清单（按可达/VPN 分组）
node sites/zju-notices/crawler-merged.mjs sources --network campus   # 只看 15 个内网站
node sites/zju-notices/crawler-merged.mjs fetch www.lit.zju.edu.cn   # 单站（自动找栏目）
node sites/zju-notices/crawler-merged.mjs all --days 7         # 近 7 天全量
node sites/zju-notices/crawler-merged.mjs all --site 心理       # 按单位筛
node sites/zju-notices/crawler-merged.mjs health               # 47 站连通性
```

实测（2026-11-22）：`all --days 7` → 扫描 47 站、抓 **390 条**、近 7 天 **15 条**、**0 失败**。

### 相比两个前身各多了什么

| 能力 | zju-notices | zju-colleges | **merged** |
|---|---|---|---|
| 栏目配置表 | ✅ 41 条 | ❌ | ✅ 沿用 |
| 自动找栏目 | ❌ | ✅ | ✅ |
| 代理伪造 IP 处理（DoH 直连） | ❌ | ✅ | ✅ |
| HTTP/HTTPS 自动降级 | 部分 | ✅ | ✅ |
| 跳转页自动跟子路径 | ❌ | ✅ | ✅ |
| 日期锚点解析（抗模板） | ✅ | ❌ | ✅ |
| 内网站识别（不盲试） | 部分 | ❌ | ✅ 15 站显式标注 |
| DOM 解析 | ❌ 正则 | ✅ linkedom | ✅ linkedom |

### 合并时修掉的三个 bug

**1. `2026-20` 这种垃圾日期**

`normDate` 的「取年月」分支把 URL 里的 `/2026/1104/` 匹配成了 `2026` + `20`（`1104` 前两位）。
修法：月份必须 1-12，且 `(?!\d)` 保证后面不紧跟数字。

**2. 日期为空的条目排到了最前**

通路 B（无日期补漏）产出的条目 `date: ''`，排序时 `''.localeCompare('2026-11-19')` 返回负数，
导致它们排在最前面，看起来像「最新通知是 2026-11-19」而实际它在中间。
修法：空日期沉底。

**3. 列表页不显示日期时全空**

新增 `urlDate()` 从 Webplus URL 的 `/yyyy/mmdd/` 提日期兜底 ——
列表页常常只有标题和链接，**但 URL 里一定有日期**。加了这个，`www.psych` 从 20 条无日期变成 32 条全带日期。

> 注：`urlDate` 最初写成字面量正则时，反斜杠在多层字符串转义里丢了（`//(20\d{2})/` 变成空正则导致语法错）。
> 改用 `new RegExp('...')` 字符串构造，只需一层转义，更稳。

### 仍未闭环

- **15 个内网站**：需校园网或 WebVPN。源表已记栏目路径，拿到通道即可直接用。
- **分页**：只取首屏（约 8-50 条/站）。
- **正文**：只给标题+链接+日期，不抓正文。
- **增量标记**：`--days` 是时间窗近似，没有「上次抓取之后新增」的游标。
- **跨站重复**：有些通知被多个学院转发（如社科院通知出现在心理系列表），未做去重。

## WebVPN 打通 15 个内网站（2026-11-22，本轮最大突破）

前一轮把这 15 个站标为「纯内网，需校园网或 WebVPN」。**本轮已用 WebVPN 全部打通，15/15 可达。**

### 怎么做到的

`webvpn` 凭据已配置（`设置 → YONKIK 侦察凭据`），跑 `sites/webvpn.zju.edu.cn/login.mjs` 拿到
`wengine_vpn_ticketwebvpn_zju_edu_cn` 票据后，用深信服 URL 重写规则访问：

```
https://webvpn.zju.edu.cn/<scheme>/<enc(host)><path>?vpn-12-o2-<host>
enc(host) = hex("wrdvpnisthebest!") + hex(AES-128-CFB(host, key=iv="wrdvpnisthebest!"))
```

`crawler-merged.mjs` 已内置（`fetchViaVpn`），源表里 `requiresVpn: true` 的站自动走这条通道。

### 实测结果（15/15）

| 站 | 字节 | 标题 |
|---|---|---|
| `ygb.zju.edu.cn` | 15,301 | 通知公告（研工部，183 条 / 19 页） |
| `ai.office.zju.edu.cn` | 114,554 | 浙江大学人工智能学院校内网 |
| `bmsoa.zju.edu.cn` | 32,053 | 基础医学系办公网 |
| `che.cn.zju.edu.cn` | 65,104 | 化工学院办公网 |
| `cspo.zju.edu.cn` | 80,145 | 计算机科学与技术学院办公网 |
| `doe-oa.zju.edu.cn` | 88,464 | 能源工程学院办公网 |
| `ee.office.zju.edu.cn` | 66,240 | 电气工程学院办公网 |
| `office.cab.zju.edu.cn` | 105,420 | 农业与生物技术学院办公网 |
| `office.cas.zju.edu.cn` | 158,947 | 动物科学学院办公网 |
| `office.chem.zju.edu.cn` | 86,298 | 化学系办公网 |
| `office.cmic.zju.edu.cn` | 131,462 | 传媒与国际文化学院 |
| `office.ls.zju.edu.cn` | 108,758 | 历史学院办公网 |
| `office.polymer.zju.edu.cn` | 110,373 | 高分子科学与工程学系 |
| `saa.office.zju.edu.cn` | 98,197 | 航空航天学院办公网 |
| `www.cls.office.zju.edu.cn` | 169,958 | 生命科学学院办公网 |

**注意：这些是「办公网」，信息密度比公开站高** —— 评奖评优、内部公示、职称、人事等多在这里。

### 两个必须处理的细节

1. **协议要写 https**：WebVPN 会把 `http` 重写入口 **301 到 https** 版本。
   用 http 起会多一跳，且早期诊断脚本没跟 301 时只拿到 162B 的 301 页，误以为「不通」。
2. **VPN 返回的 HTML 里 href 用单引号**：`href='/2026/1117/c31555a3228402/page.htm'`。
   正则抓双引号会一条都拿不到 —— **DOM 解析（`querySelectorAll('a[href]')`）不受影响**。

## 全量聚合（62 站，含内网）

```bash
node sites/zju-notices/crawler-merged.mjs all --days 7        # 62 站（含 15 内网，经 VPN）
node sites/zju-notices/crawler-merged.mjs all --days 7 --no-vpn   # 只扫 47 个公网站
```

实测（2026-11-22）：

| 指标 | 仅公网 | **含内网（默认）** |
|---|---|---|
| 扫描站数 | 47 | **62** |
| 抓到条目 | 390 | **406** |
| 去重后 | — | **405** |
| 近 7 天 | 15 | **17** |
| 失败 | 0 | **0** |

### 跨站去重（新增）

同一篇通知常被多个学院转发（社科院/组织部文件尤甚）。去重键**必须用文章 id，不能用栏目号**：

```
/2026/1119/c39312a3229329/page.htm
         └──┬──┘└──┬───┘
         栏目号    文章 id ← 这才是唯一键
```

**踩过的坑**：第一版写成 `/[ca](\d{5,})/`，正则从左往右先命中 `c39312`（同栏目所有文章都相同），
导致 406 条被合并成 51 条（降 87%），近 7 天从 17 掉到 9。**修成优先匹配 `a(\d{6,})` 后正常（只去 1 条真重复）。**

## 分页（2026-11-22 实现）

**这是本资产最后一次大补。** 之前每站只取首屏（8-50 条），历史通知拿不到。

### 用法

```bash
--pages 1   # 默认，只取首屏（快，132s 扫 62 站）
--pages 3   # 每站取 3 页
--pages 0   # 取全部分页（慢，387s 扫 62 站）
```

```bash
node sites/zju-notices/crawler-merged.mjs all --days 7 --pages 0
node sites/zju-notices/crawler-merged.mjs fetch www.lit.zju.edu.cn --pages 0
```

### 实测对比（62 站）

| 模式 | 抓到条目 | 去重后 | 近 7 天 | 耗时 |
|---|---|---|---|---|
| 默认（--pages 1） | 406 | 405 | 17 | 132s |
| **全分页（--pages 0）** | **2,823** | **2,740** | 17 | 387s |

**提升约 7 倍。** 近 7 天条数不变是正常的 —— 分页补的是历史积累，近期通知本来就在首屏。

单站示例（`www.lit.zju.edu.cn`）：

| --pages | 条目 | 说明 |
|---|---|---|
| 1 | 13 | 首屏 |
| 2 | 26 | |
| 0 | **134** | 全部分页 |

### 分页规则（实测 4 站得出）

Webplus 站的分页路径是 **`/<column>/list2.htm`、`list3.htm` … `listN.htm`**。

**试错的四种形态，只有一种对：**

| 形态 | 结果 |
|---|---|
| **`list2.htm` / `listN.htm`** | ✅ **正确**，200 且内容不同 |
| `list_2.htm` | ❌ **301** |
| `?page=2` | ❌ **200 但与首页字节数完全相同**（假分页）| 
| `index_2.htm` | ❌ 404 |

**`?page=2` 这个坑最隐蔽**：它返回 200，看起来成功，但字节数与首页一模一样 —— 内容根本没变。
判据：**比字节数**，与首页相同就是假分页。

### 页数不能信页面声明

页面底部「尾页」链接里的 `listN.htm` 数字**偏大**：

| 站 | 页面声明 | 实际末页 |
|---|---|---|
| `ygb.zju.edu.cn` | 19 页 | **10 页**（第 11 页起 301） |
| `www.lit.zju.edu.cn` | 17 页 | **10 页**（第 11 页起 301） |
| `opt.zju.edu.cn` | 26 页 | **10 页** |

原因是**每页条数被调大过**：`ygb` 显示「总共 183 记录」，按 14 条/页算 19 页，
但当前实际是 20 条/页，所以只到 10 页。

**实现方式**：`detectTotalPages` 只作为**上限**用，真实边界靠「遇到 301/404 就停」。
返回值里区分两个字段：

- `declaredPages` —— 页面声明的页数（仅供参照，**不可信**）
- `fetchedPages` —— 实际抓到的页数（**这个才准**）

### 一个隐藏 bug（已修）

`fetch` 原来返回 `items.slice(0, 60)`，而 `all()` 直接用它的返回值 —— 
导致分页抓了 134 条，`all` 只看到 60 条（差 74 条）。
**修法**：上限放宽到 500，并验证 `fetch` 与 `all` 条数一致。

> 教训：**内部函数返回值上的 `slice` 会静默吃掉数据。** 分页类改动必须核对
> 「单站抓取数」与「聚合后条数」是否对得上，否则会以为分页没生效。

### 已知限制

- ~~**VSB（博达）站未适配**~~ → **2026-11-22 复核：这是误判，本站群里没有 VSB 站。**
  扫了 47 个可达站的首页，**真正用 `/info/NNNN/NNNNN.htm` 的站为 0 个**，30 个站全部是 Webplus
  （`/yyyy/mmdd/cNNNaNNN/page.htm`）。原先以为的「VSB 站」（`www.math` `www.neuroscience` `www.chem`）
  实测也是 Webplus，分页照 `listN.htm` 规则正常。现有实现已覆盖全部实际形态。
- **内网站经 VPN 分页更慢**：`ygb` 全 10 页需约 16 秒（每页一次 VPN 往返）。
- `--pages 0` 全量跑要 **387 秒**，日常用 `--pages 1`（132s）或 `--pages 3`。

## 修正：深页 301 到 .psp 是真实内容，不是末页（2026-11-22 第二轮）

**这是分页实现里最关键的修正。** 早前把「第 11 页返回 301」当成「越过末页」，
导致 www.lit 只拿到 10/17 页、ygb 只拿到 10/19 页。

### 真相

    /tzgg/list11.htm  → 301 → /tzgg/list11.psp   ← 跟过去是 200，有 14 条

Webplus 的**深页用 .psp 扩展名**，浅页用 .htm。.htm → .psp 是一次正常跳转，
**不是「页不存在」**。这跟本 wiki 早前记的「.psp 换 .htm 是常见修正」互为印证 ——
只是方向相反：从 .htm 跳去 .psp。

### 效果

| 站 | 修复前 | 修复后 |
|---|---|---|
| www.lit.zju.edu.cn | 10 页 / 134 条 | **17 页 / 225 条** |
| www.math.zju.edu.cn | 10 页 / 140 条 | **16 页 / 214 条** |
| ygb.zju.edu.cn（经 VPN） | 10 页 / 100 条 | **19 页 / 182 条** |

### 两个实现要点

1. **必须跟随一次 301**，不能 break。
2. **VPN 下的 Location 是重写过的**：

       直连：  http://www.lit.zju.edu.cn/tzgg/list11.psp
       经VPN： https://webvpn.zju.edu.cn/https/<hex>/31555/list11.psp?vpn-12-o2-ygb.zju.edu.cn

   判断跳转目标不能只看 u.hostname === host（VPN 下 hostname 是 webvpn.zju.edu.cn），
   要从路径里剥出 /https/<hex>/<真实path> 部分。**早前只判 hostname，所以 VPN 站全没跟上。**

## 精确栏目通路（2026-11-22）

- 与旧的按站聚合并行，不修改其 all/fetch/sources。columns.json 记住 418 个栏目场景 → 417 个请求键（两个教务分类共用 POST）→ 65 个主机；基线 28 个同路径记载不等于现网。最初开放团委 8 栏和本科生院 2 栏；后续见下方逐批记录。
- crawler-columns.mjs stats 与 columns [host] 只读本地，无出网；column <host> <完整目录路径> [页码] [--summary] 一次只请求一个明确验证过的路径（通常 HTTPS，个别公开 HTTP 只在显式白名单内），不带凭据、不跟任何跳转。例：column zjutw.zju.edu.cn /st_49186/list.htm、column bksy.zju.edu.cn /76425/list.htm --summary；仅团委通知总栏允许已验证第二页。
- 上游 .htm 路径与本地 .psp 证据分别保留，只有已证实的路由别名能启用。只比较自身页面标题和 curr_page；登录壳、别栏、疑似非空但提取不到不报空、不回退。仅展示外链，不访问。解析同站等同 URL 可附多个栏目出处，不把不同主机同号视作同一条。
- 本科生院本轮：/76425/list.htm 14 条（声明共 52 条/4 页；含置顶图标 14，未识别 0）；/76426/list.htm 14 条（声明共 76 条/6 页；含置顶图标 14，未识别 0）。以 HTML 观察/实际解析分别计数，置顶/同一文章转发不代表额外的新通知。
- 当前只支持两种已有真实样本的页面结构；后续按明确的分批现网证据引入新模板、主机、分页，未验证不开放。

## 第三批：学工部与综合服务网的精确首屏（2026-11-22）

- http://www.xgb.zju.edu.cn/53403/list.psp：14 条（外链 2；CMS 声明 804 条 / 58 页）
- http://www.xgb.zju.edu.cn/53395/list.psp：14 条（外链 1；CMS 声明 825 条 / 59 页）
- http://www.xgb.zju.edu.cn/53396/list.psp：14 条（外链 0；CMS 声明 1021 条 / 73 页）
- http://www.xgb.zju.edu.cn/53405/list.psp：10 条（外链 1；CMS 声明 10 条 / 1 页）
- https://zhfw.zju.edu.cn/zhfw_jyjx/list.htm：24 条（外链 1；CMS 声明 15203 条 / 634 页）
- https://zhfw.zju.edu.cn/zhfw_zdts/list.htm：10 条（外链 1；CMS 声明 10 条 / 1 页）
- https://zhfw.zju.edu.cn/zhfw_jsgx/list.htm：24 条（外链 7；CMS 声明 63990 条 / 2667 页）

学工部只验证公开 HTTP：四个目录 .htm 各自 301 到同站 .psp；HTTPS robots 连接被拒，HTTP robots 404。指定白名单路径，不向任何其他站或页降级。评奖评优/学生资助是父栏目，HTML 实际默认显示各自子栏「重要通知」（53397 / 53400）。要同时校验对应父、子面包屑，不把导航命中或重名 title 当身份。综合服务网在 ul.cg-news-list#arth 内读取条目，外链只列 URL，不访问。精确通路现已开放 17 栏，仍不自动请求任何未证实栏目、分页、正文或附件。

## 第四批：图书馆、研究生院和 ITC（2026-11-22）

- 图书馆本馆新闻 /55989、资源动态 /55543：两个公开 HTTPS 门户列表均以正确 title + 路径面包屑识别、各解析 14 条。只列公开公告的标题、日期、地址；不请求正文、外链、数据库或电子全文。
- 研究生院门户 www.grs 的公开 HTTP /qbgg/list.htm：面包屑确认「全部公告」，实得 14 条（CMS 声明 1569 条 / 113 页）。日期 YY-MM-DD 来自 div.date；只读 h3，不把条目摘要当标题。两条公告共用同一外部落地页但日期、标题不同，按条目保留，不仅按外链 URL 去重。HTTPS robots 连接拒绝，HTTP robots 404；不携带认证。
- ITC 90618：旧 .htm 301 指向同主机 HTTP .psp；选择已知目标的 HTTPS .psp → 302 到校园 CAS。停在登录前，单列 auth-required-observed，不启用匿名通路，也不将公共门户搜索冒充本栏。

## 第五批：学工部最新通知（2026-11-22）

HTTP 公开 /53388/list.htm 当下实测 301 指本栏 /53388/list.psp，后者 200（14 条，CMS 声明 177 条 / 13 页）。真实身份「党建工作 › 最新通知」，不是旧聚合器默认 /xfjs/ 学风建设。只开启这一页，不依赖相邻栏。固定栏目 24 个 GET 场景中，现有 21 个公开首屏；余 ITC 与研工部两栏按通道单列，不包括两个登录 POST。

## 第九批：控制科学与工程学院五个公开栏目（2026-11-22）

- http://www.cse.zju.edu.cn/39322/list.htm：本科生教育·最新消息（父栏 本科生教育），title 最新消息，20 条，外链 0；CMS 声明 2274 条 / 114 页
- http://www.cse.zju.edu.cn/39333/list.htm：研究生教育·最新消息（父栏 研究生教育），title 最新消息，20 条，外链 1；CMS 声明 979 条 / 49 页
- http://www.cse.zju.edu.cn/39342/list.htm：日常通告（父栏 学生思政），title 日常通告，20 条，外链 0；CMS 声明 1593 条 / 80 页
- http://www.cse.zju.edu.cn/39351/list.htm：相关通知（父栏 就业指导），title 相关通知，20 条，外链 0；CMS 声明 122 条 / 7 页
- http://www.cse.zju.edu.cn/39353/list.htm：通知公告（父栏 对外交流），title 通知公告，20 条，外链 17；CMS 声明 812 条 / 41 页

仅公开 HTTP：443 连接被拒、robots 404，不外推 HTTPS 或校外可达。版面 div#wp_news_wNN > ul > li，标题 a 在 div.con1rm2r、日期在 div.con1rm2l。本科生教育与研究生教育两栏列表 title 同为「最新消息」，靠「当前位置」父子文字与路径共同区分；历史台账把 /39351 标为科研学术，实测为就业指导·相关通知。精确通路累计 26／418，只开首屏，分页正文外链未取。

## 第十批：心理与行为科学系四个公开栏目（2026-11-22）

- http://www.psych.zju.edu.cn/27565/list.htm：学生天地，20 条，外链 0；CMS 声明 1125 条 / 57 页
- http://www.psych.zju.edu.cn/27568/list.htm：国际交流，20 条，外链 2；CMS 声明 242 条 / 13 页
- http://www.psych.zju.edu.cn/27572/list.htm：研究生教育，20 条，外链 8；CMS 声明 23 条 / 2 页
- http://www.psych.zju.edu.cn/27573/list.htm：本科生教育，20 条，外链 0；CMS 声明 41 条 / 3 页

仅公开 HTTP：443 连接被拒、robots 404。该站没有 dqwz/col_path 一类独立面包屑，栏目归属由 p.title（frag=窗口5）内的链接集合核验——末个链接的路径必须等于本栏路径且文字等于列表标题，因此不能把全局导航或同名标题当身份。版面 div#wp_news_wNN > ul > li，a 与 span.time 在同一 li 内。精确通路累计 30／418，只开首屏。

## 第十一批：机械工程学院六个公开栏目（2026-11-22）

- http://me.zju.edu.cn/meoffice/6427/list.htm：本科生教育·重要通知（父栏 本科生教育），14 条，外链 2；CMS 声明 1673 条 / 120 页
- http://me.zju.edu.cn/meoffice/6472/list.htm：学生三会（父栏 学生工作），14 条，外链 0；CMS 声明 275 条 / 20 页
- http://me.zju.edu.cn/meoffice/6469/list.htm：学生工作·重要通知（父栏 学生工作），14 条，外链 0；CMS 声明 1273 条 / 91 页
- http://me.zju.edu.cn/meoffice/6443/list.htm：教学培养（父栏 研究生教育），14 条，外链 2；CMS 声明 309 条 / 23 页
- http://me.zju.edu.cn/meoffice/6428/list.htm：学籍管理（父栏 本科生教育），14 条，外链 0；CMS 声明 19 条 / 2 页
- http://me.zju.edu.cn/meoffice/6435/list.htm：实践教学（父栏 本科生教育），14 条，外链 3；CMS 声明 334 条 / 24 页

仅公开 HTTP：443 连接被拒、robots 404。本科生教育与学生工作两个父栏下都有「重要通知」，显示标题完全一致，靠「当前位置」父栏目路径与文字共同区分，只比标题会混为一栏。版面 li.column-news-item + span.column-news-title/span.column-news-date；实践教学栏有指向 kyjs 的外链，只记地址不访问。精确通路累计 36／418。

## 第十二批：数学科学学院十个公开栏目（2026-11-22）

- http://www.math.zju.edu.cn/38100/list.htm：评奖评优（父栏 党群学工），10 条，外链 0；CMS 声明 427 条 / 43 页
- http://www.math.zju.edu.cn/38101/list.htm：学生资助（父栏 党群学工），10 条，外链 0；CMS 声明 117 条 / 12 页
- http://www.math.zju.edu.cn/66212/list.htm：团学通知（父栏 党群学工），10 条，外链 0；CMS 声明 377 条 / 38 页
- http://www.math.zju.edu.cn/38088/list.htm：培养工作（父栏 研究生），10 条，外链 0；CMS 声明 39 条 / 4 页
- http://www.math.zju.edu.cn/38090/list.htm：毕业学位（父栏 研究生），10 条，外链 0；CMS 声明 43 条 / 5 页
- http://www.math.zju.edu.cn/38086/list.htm：研究生（父栏 研究生），10 条，外链 2；CMS 声明 153 条 / 16 页
- http://www.math.zju.edu.cn/38077/list.htm：本科生（父栏 本科生），10 条，外链 1；CMS 声明 100 条 / 10 页
- http://www.math.zju.edu.cn/dwjl/list.htm：对外交流（父栏 本科生），10 条，外链 0；CMS 声明 60 条 / 6 页
- http://www.math.zju.edu.cn/38102/list.htm：学生文件资料（父栏 党群学工），10 条，外链 1；CMS 声明 19 条 / 2 页
- http://www.math.zju.edu.cn/tmgztz/list.htm：免试研究生推荐（父栏 本科生），4 条，外链 0；CMS 声明 4 条 / 1 页

「本科生·信息公告」与「研究生·信息公告」显示标题一致，靠「窗口05」的父栏目名（本科生 / 研究生）区分，不能只看标题。每页 10 条。另有两栏（毕业论文 / 主修专业确认）目录里的数字路径可访问，但页面自认的栏目路径分别是 /bylw/ 与 /zxzyqr/，属同一栏目的两个地址，未确认权威地址前不纳入精确通路，状态标为 identity-mismatch。精确通路累计 46／418。

## 第十三批：经济学院六个公开栏目（2026-11-22）

- http://www.cec.zju.edu.cn/bkssz/list.htm：本科生思政（父栏 学生思政），10 条，外链 0；CMS 声明 785 条 / 79 页
- http://www.cec.zju.edu.cn/xssz/list.htm：学生思政（父栏 学生思政，实际展示「重要通知」），10 条，外链 0；CMS 声明 908 条 / 91 页
- http://www.cec.zju.edu.cn/jxyjw/list.htm：教学与教务（父栏 本科生教育），10 条，外链 0；CMS 声明 67 条 / 7 页
- http://www.cec.zju.edu.cn/pygl/list.htm：培养管理（父栏 研究生教育），10 条，外链 0；CMS 声明 751 条 / 76 页
- http://www.cec.zju.edu.cn/dwjl_36145/list.htm：对外交流（父栏 研究生教育），10 条，外链 2；CMS 声明 94 条 / 10 页
- http://www.cec.zju.edu.cn/zxxx_36129/list.htm：研究生教育（父栏 研究生教育，实际展示「最新消息」），10 条，外链 1；CMS 声明 2154 条 / 216 页

本站的「窗口14」主标题区会同时列出父栏与当前栏，但 /xssz/list.htm 这类父栏地址实际渲染的是默认子栏「重要通知」（/zytz/），因此校验时用「标题命中项 + 上一项父栏」的配对，不把目录里的地址当成栏目身份。精确通路累计 52／418。

## 第十四批：哲学学院十二个公开栏目（2026-11-22）

- http://www.philosophy.zju.edu.cn/64683/list.htm：学生思政 › 评奖评优，14 条（本页），外链 0；CMS 声明 185 条 / 14 页
- http://www.philosophy.zju.edu.cn/64684/list.htm：学生思政 › 学生资助，14 条（本页），外链 1；CMS 声明 153 条 / 11 页
- http://www.philosophy.zju.edu.cn/gggs_65461/list.htm：国际合作 › 公告公示，14 条（本页），外链 0；CMS 声明 315 条 / 23 页
- http://www.philosophy.zju.edu.cn/zxtz/list.htm：教育教学 › 本科生教育 › 最新通知，14 条（本页），外链 3；CMS 声明 115 条 / 9 页
- http://www.philosophy.zju.edu.cn/64672/list.htm：学术研究 › 学术活动，14 条（本页），外链 2；CMS 声明 218 条 / 16 页
- http://www.philosophy.zju.edu.cn/zxtz_65348/list.htm：教育教学 › 研究生教育 › 最新通知，14 条（本页），外链 2；CMS 声明 149 条 / 11 页
- http://www.philosophy.zju.edu.cn/64679/list.htm：学生思政 › 最新通知，14 条（本页），外链 0；CMS 声明 172 条 / 13 页
- http://www.philosophy.zju.edu.cn/dwjl/list.htm：教育教学 › 研究生教育 › 对外交流，14 条（本页），外链 1；CMS 声明 59 条 / 5 页
- http://www.philosophy.zju.edu.cn/64670/list.htm：学术研究 › 最新通知，14 条（本页），外链 9；CMS 声明 39 条 / 3 页
- http://www.philosophy.zju.edu.cn/64681/list.htm：学生思政 › 学生团建，14 条（本页），外链 0；CMS 声明 44 条 / 4 页
- http://www.philosophy.zju.edu.cn/xwgl/list.htm：教育教学 › 研究生教育 › 学位管理，14 条（本页），外链 1；CMS 声明 15 条 / 2 页
- http://www.philosophy.zju.edu.cn/64676/list.htm：国际合作 › 国际交流，7 条（本页），外链 1；CMS 声明 7 条 / 1 页

「最新通知」在本科生教育、研究生教育、学生思政三处都出现，且都是完整三级链路（教育教学 › 本科生教育 / 教育教学 › 研究生教育 / 学生思政）。校验用整条「当前位置」链路逐项比对（层级数、路径、文字都要一致），不是只比末项标题；层级数不同也要报错。精确通路累计 64／418。

## 第十五批：公共管理学院十二个公开栏目（2026-11-22）

- http://www.spa.zju.edu.cn/spaoffice/14508/list.htm：学生思政 › 学生团建，14 条，外链 0；CMS 声明 706 条 / 51 页
- http://www.spa.zju.edu.cn/spaoffice/14509/list.htm：学生思政 › 学工事务，14 条，外链 0；CMS 声明 1048 条 / 75 页
- http://www.spa.zju.edu.cn/spaoffice/14507/list.htm：学生思政 › 学生党建，14 条，外链 0；CMS 声明 116 条 / 9 页
- http://www.spa.zju.edu.cn/spaoffice/13987/list.htm：研究生教育 › 最新通知，14 条，外链 0；CMS 声明 2369 条 / 170 页
- http://www.spa.zju.edu.cn/spaoffice/14473/list.htm：国际事务 › 学生交流，14 条，外链 0；CMS 声明 116 条 / 9 页
- http://www.spa.zju.edu.cn/spaoffice/zxtz/list.htm：本科教育 › 最新通知，14 条，外链 0；CMS 声明 802 条 / 58 页
- http://www.spa.zju.edu.cn/spachinese/jzhd_75663/list.htm：新闻中心 › 讲座活动，14 条，外链 0；CMS 声明 295 条 / 22 页
- http://www.spa.zju.edu.cn/spaoffice/14486/list.htm：专业学位教育 › 最新通知，14 条，外链 1；CMS 声明 44 条 / 4 页
- http://www.spa.zju.edu.cn/spaoffice/14746/list.htm：党政管理 › 最新通知，14 条，外链 2；CMS 声明 368 条 / 27 页
- http://www.spa.zju.edu.cn/spaoffice/14511/list.htm：学生思政 › 就业指导，14 条，外链 0；CMS 声明 1075 条 / 77 页
- http://www.spa.zju.edu.cn/spaoffice/14513/list.htm：学生思政 › 心理资助，14 条，外链 0；CMS 声明 33 条 / 3 页
- http://www.spa.zju.edu.cn/spaoffice/13991/list.htm：研究生教育 › 学位管理，14 条，外链 0；CMS 声明 121 条 / 9 页

四栏显示标题都是「最新通知」（研究生教育 / 本科教育 / 专业学位教育 / 党政管理），只比标题必然串栏；仍按「当前位置」完整链路逐项比对。注意 /spaoffice/zxtz/ 的父级与子级链接同为该路径、文字不同，校验须看文字而非只比路径。精确通路累计 76／418。

## 第十六批：艺术与考古学院十二个公开栏目（2026-11-22）

- http://www.soaa.zju.edu.cn/31727/list.htm：研究生教育 › 学位管理，15 条，外链 0；CMS 声明 37 条 / 3 页
- http://www.soaa.zju.edu.cn/31730/list.htm：学生思政 › 最新通知，15 条，外链 0；CMS 声明 367 条 / 25 页
- http://www.soaa.zju.edu.cn/31735/list.htm：学生思政 › 评奖评优，15 条，外链 0；CMS 声明 297 条 / 20 页
- http://www.soaa.zju.edu.cn/31736/list.htm：学生思政 › 学生资助，15 条，外链 0；CMS 声明 170 条 / 12 页
- http://www.soaa.zju.edu.cn/31717/list.htm：本科教育 › 学籍管理，15 条，外链 0；CMS 声明 20 条 / 2 页
- http://www.soaa.zju.edu.cn/31723/list.htm：研究生教育 › 最新通知，15 条，外链 2；CMS 声明 278 条 / 19 页
- http://www.soaa.zju.edu.cn/31718/list.htm：本科教育 › 教学教务，10 条，外链 5；CMS 声明 10 条 / 1 页
- http://www.soaa.zju.edu.cn/31726/list.htm：研究生教育 › 教学教务，15 条，外链 7；CMS 声明 37 条 / 3 页
- http://www.soaa.zju.edu.cn/31738/list.htm：学生思政 › 学生活动，15 条，外链 0；CMS 声明 156 条 / 11 页
- http://www.soaa.zju.edu.cn/31702/list.htm：党政管理 › 最新通知，2 条，外链 0；CMS 声明 2 条 / 1 页
- http://www.soaa.zju.edu.cn/31720/list.htm：本科教育 › 实践交流，15 条，外链 6；CMS 声明 29 条 / 2 页
- http://www.soaa.zju.edu.cn/31725/list.htm：研究生教育 › 学籍管理，12 条，外链 4；CMS 声明 12 条 / 1 页

本站用 div.column-path + h2.column-title 标识栏目，结构与哲学/公管相近但 class 全不同名；每页 15 条。同名更多：教学教务（本科/研究生）、学籍管理（本科/研究生）、最新通知（学生思政/研究生教育/党政管理）都要靠父级区分，统一按完整链路比对。精确通路累计 88／418。

## 第十七批：光华法学院十二个公开栏目（2026-11-22）

- http://www.ghls.zju.edu.cn/ghlsbg/13767/list.htm：学生工作 › 评奖评优（横幅 学生工作），20 条，外链 0；CMS 声明 403 条 / 21 页
- http://www.ghls.zju.edu.cn/ghlsbg/13761/list.htm：学生工作 › 最新消息（横幅 学生工作），20 条，外链 0；CMS 声明 395 条 / 20 页
- http://www.ghls.zju.edu.cn/ghlsbg/13762/list.htm：学生工作 › 学生党建（横幅 学生工作），20 条，外链 0；CMS 声明 455 条 / 23 页
- http://www.ghls.zju.edu.cn/ghlsbg/13763/list.htm：学生工作 › 学生团建（横幅 学生工作），20 条，外链 0；CMS 声明 261 条 / 14 页
- http://www.ghls.zju.edu.cn/ghlsbg/13768/list.htm：学生工作 › 学生资助（横幅 学生工作），20 条，外链 0；CMS 声明 152 条 / 8 页
- http://www.ghls.zju.edu.cn/ghlsbg/13771/list.htm：学生工作 › 学生组织（横幅 学生工作），20 条，外链 0；CMS 声明 126 条 / 7 页
- http://www.ghls.zju.edu.cn/ghlsbg/13813/list.htm：重点提示（横幅 重点提示），20 条，外链 0；CMS 声明 5468 条 / 274 页
- http://www.ghls.zju.edu.cn/ghlsbg/13789/list.htm：对外交流 › 公告（横幅 对外交流），20 条，外链 0；CMS 声明 463 条 / 24 页
- http://www.ghls.zju.edu.cn/ghlsbg/13729/list.htm：对外交流（横幅 对外交流），20 条，外链 1；CMS 声明 29 条 / 2 页
- http://www.ghls.zju.edu.cn/ghlsbg/jyfw/list.htm：就业服务（横幅 就业服务），20 条，外链 11；CMS 声明 1032 条 / 52 页
- http://www.ghls.zju.edu.cn/ghlsbg/xsjz1/list.htm：学术讲座（横幅 学术讲座），20 条，外链 0；CMS 声明 307 条 / 16 页
- http://www.ghls.zju.edu.cn/ghlsbg/zxtz/list.htm：教育教学 › 最新通知（横幅 教育教学），19 条，外链 0；CMS 声明 19 条 / 1 页

本站判据升级为「bread_crumb 全链路 + h1 横幅栏目名」双重校验：横幅是所属大类（学生工作 / 对外交流 / 教育教学），列表 title 是栏目名，二者不可互替。注意「公告」是「对外交流」子栏，「最新通知」的父级链接指向站群共享的 /_s331/main.psp，而不是本站路径。精确通路累计 100／418。

## 第十八批：教育学院十二个公开栏目（2026-11-22）

- http://www.ced.zju.edu.cn/cedoffice/26836/list.htm：学生思政 › 信息公告，14 条，外链 0；CMS 声明 960 条 / 69 页
- http://www.ced.zju.edu.cn/cedoffice/26841/list.htm：学生思政 › 评奖评优，14 条，外链 0；CMS 声明 435 条 / 32 页
- http://www.ced.zju.edu.cn/cedoffice/26808/list.htm：本科生教育 › 信息公告，14 条，外链 10；CMS 声明 1002 条 / 72 页
- http://www.ced.zju.edu.cn/cedoffice/26840/list.htm：学生思政 › 学生资助，14 条，外链 1；CMS 声明 251 条 / 18 页
- http://www.ced.zju.edu.cn/cedoffice/26794/list.htm：学院党政 › 信息公告，14 条，外链 0；CMS 声明 284 条 / 21 页
- http://www.ced.zju.edu.cn/jldt/list.htm：交流合作 › 国际交流 › 交流动态，14 条，外链 7；CMS 声明 47 条 / 4 页
- http://www.ced.zju.edu.cn/cedoffice/26831/list.htm：国际合作 › 信息公告，14 条，外链 3；CMS 声明 328 条 / 24 页
- http://www.ced.zju.edu.cn/cedoffice/26845/list.htm：学生思政 › 公示专区，14 条，外链 0；CMS 声明 362 条 / 26 页
- http://www.ced.zju.edu.cn/cedoffice/26822/list.htm：研究生教育 › 学位管理，14 条，外链 0；CMS 声明 184 条 / 14 页
- http://www.ced.zju.edu.cn/26970/list.htm：人才培养 › 研究生培养，14 条，外链 0；CMS 声明 15 条 / 2 页
- http://www.ced.zju.edu.cn/cedoffice/26782/list.htm：研究生教育，14 条，外链 10；CMS 声明 1300 条 / 93 页
- http://www.ced.zju.edu.cn/cedoffice/gsl/list.htm：本科生教育 › 公示栏，14 条，外链 0；CMS 声明 16 条 / 2 页

本站日期是 YYYY/MM/DD 斜杠格式，解析时先统一成 ISO 再校验；四栏同名「信息公告」只能靠父级区分。/jldt/list.htm 的「交流动态」页面无分页计数块，属单页列表，仍只记首屏。精确通路累计 112／418。

## 第十九批：马克思主义学院十二个公开栏目（2026-11-22）

- http://marx.zju.edu.cn/marxbg/23602/list.htm：学生思政 › 评奖评优（大类 学生思政），20 条，外链 0；CMS 声明 164 条 / 9 页
- http://marx.zju.edu.cn/marxbg/xsh/list.htm：学生思政 › 学生会（大类 学生思政），20 条，外链 0；CMS 声明 28 条 / 2 页
- http://marx.zju.edu.cn/marxbg/23588/list.htm：研究生教育 › 最新通知（大类 研究生教育），20 条，外链 0；CMS 声明 387 条 / 20 页
- http://marx.zju.edu.cn/marxbg/23604/list.htm：学生思政 › 就业指导（大类 学生思政），20 条，外链 2；CMS 声明 292 条 / 15 页
- http://marx.zju.edu.cn/marxbg/23524/list.htm：学生思政 › 最新通知（大类 学生思政），20 条，外链 1；CMS 声明 175 条 / 9 页
- http://marx.zju.edu.cn/marxbg/23522/list.htm：思政教学 › 最新通知（大类 思政教学），20 条，外链 3；CMS 声明 232 条 / 12 页
- http://marx.zju.edu.cn/marxbg/bksjy/list.htm：本科生教育 › 最新通知（大类 本科生教育），20 条，外链 1；CMS 声明 60 条 / 3 页
- http://marx.zju.edu.cn/marxbg/23541/list.htm：党政管理 › 信息公告（大类 党政管理），20 条，外链 0；CMS 声明 53 条 / 3 页
- http://marx.zju.edu.cn/marxbg/23583/list.htm：思政教学 › 现场教学（大类 思政教学），20 条，外链 0；CMS 声明 365 条 / 19 页
- http://marx.zju.edu.cn/marxbg/szry/list.htm：学生思政 › 思政荣誉（大类 学生思政），3 条，外链 0；CMS 声明 3 条 / 1 页
- http://marx.zju.edu.cn/marxbg/23593/list.htm：研究生教育 › 对外交流（大类 研究生教育），14 条，外链 6；CMS 声明 14 条 / 1 页
- http://marx.zju.edu.cn/marxbg/jxpy/list.htm：本科生教育 › 教学培养（大类 本科生教育），16 条，外链 0；CMS 声明 16 条 / 1 页

该站锚文本的 title 属性是空串，完整标题只在链接正文里，取属性会得到空标题；解析按文本取值。三栏同名「最新通知」靠父级区分，其中三个父栏地址默认渲染子栏「最新通知」。精确通路累计 124／418。

## 第二十批：化学系十二个公开栏目（2026-11-22）

- http://office.chem.zju.edu.cn/34507/list.htm：学生工作 › 信息公告，10 条，外链 1；CMS 声明 1131 条 / 114 页
- http://office.chem.zju.edu.cn/34510/list.htm：学生工作 › 奖助学金，10 条，外链 0；CMS 声明 661 条 / 67 页
- http://office.chem.zju.edu.cn/34509/list.htm：学生工作 › 学生活动，10 条，外链 4；CMS 声明 515 条 / 52 页
- http://office.chem.zju.edu.cn/34490/list.htm：研究生教育 › 信息公告（目录标签「研究生教育」），10 条，外链 1；CMS 声明 847 条 / 85 页
- http://office.chem.zju.edu.cn/52029/list.htm：就业服务 › 通知公告，10 条，外链 6；CMS 声明 88 条 / 9 页
- http://office.chem.zju.edu.cn/55184/list.htm：本科生教育 › 实践竞赛，10 条，外链 0；CMS 声明 33 条 / 4 页
- http://office.chem.zju.edu.cn/55192/list.htm：国际交流 › 公示公告，10 条，外链 0；CMS 声明 17 条 / 2 页
- http://office.chem.zju.edu.cn/55195/list.htm：国际交流 › 交流项目，10 条，外链 2；CMS 声明 97 条 / 10 页
- http://office.chem.zju.edu.cn/bksjy/list.htm：本科生教育 › 本科生教育，10 条，外链 0；CMS 声明 922 条 / 93 页
- http://office.chem.zju.edu.cn/xgtw/list.htm：学生工作 › 学生工作，10 条，外链 0；CMS 声明 146 条 / 15 页
- http://office.chem.zju.edu.cn/55185/list.htm：本科生教育 › 文件汇编（目录标签「党政综合·本科生教育」），7 条，外链 1；CMS 声明 7 条 / 1 页
- http://office.chem.zju.edu.cn/55193/list.htm：国际交流 › 办事指南（目录标签「国际交流」），10 条，外链 4；CMS 声明 14 条 / 2 页

本站三重校验：a.catalog 的父大类名、左侧导航 li.selected 的当前栏、h2 标题。/bksjy 与 /xgtw 是大类页本身，没有选中子项。另发现 /55185、/55193 的页面标题与上游目录标签不同，按页面实测记录。精确通路累计 136／418。

## 第二十一批：地球科学学院十二个公开栏目（2026-11-22）

- http://gs.zju.edu.cn/34774/list.htm：通知公告 › 重要通知（大类 通知公告），19 条，外链 12；CMS 声明 1495 条 / 75 页
- http://gs.zju.edu.cn/35100/list.htm：学生工作 › 通知公告（大类 学生工作），20 条，外链 0；CMS 声明 729 条 / 37 页
- http://gs.zju.edu.cn/35103/list.htm：学生工作 › 奖助贷补（大类 学生工作），20 条，外链 0；CMS 声明 465 条 / 24 页
- http://gs.zju.edu.cn/35102/list.htm：学生工作 › 团学建设（大类 学生工作），20 条，外链 0；CMS 声明 213 条 / 11 页
- http://gs.zju.edu.cn/35122/list.htm：就业指导 › 通知公告（大类 就业指导），20 条，外链 0；CMS 声明 168 条 / 9 页
- http://gs.zju.edu.cn/35081/list.htm：教育教学 › 本科生教育 › 信息公告（大类 教育教学），20 条，外链 0；CMS 声明 43 条 / 3 页
- http://gs.zju.edu.cn/35088/list.htm：教育教学 › 研究生教育 › 通知公告（大类 教育教学），18 条，外链 9；CMS 声明 18 条 / 1 页
- http://gs.zju.edu.cn/35089/list.htm：教育教学 › 研究生教育 › 培养管理（大类 教育教学），12 条，外链 2；CMS 声明 12 条 / 1 页
- http://gs.zju.edu.cn/35091/list.htm：教育教学 › 研究生教育 › 学位管理（大类 教育教学），6 条，外链 2；CMS 声明 6 条 / 1 页
- http://gs.zju.edu.cn/35109/list.htm：国际交流 › 通知公告（大类 国际交流），20 条，外链 9；CMS 声明 25 条 / 2 页
- http://gs.zju.edu.cn/gsxx/list.psp：通知公告 › 公示信息（大类 通知公告），20 条，外链 0；CMS 声明 321 条 / 17 页
- http://gs.zju.edu.cn/35056/list.psp：学院党政 › 通知公告（大类 学院党政），6 条，外链 0；CMS 声明 6 条 / 1 页

本站需三重校验：页面大类名（Column_Anchor）、「当前位置」完整链路、页面标题（Column_Name）。/34774 首屏 20 个候选中出现一条重复链接，去重后 19 条——去重前需先确认是同 URL 而非模板误抽。另新增两条上游未列出的路径 /gsxx/、/35056/，其 .htm 301 到 .psp，记录有效地址并保留原清单路径。精确通路累计 146／418，基线仍为 418 行：/gsxx、/35056 的内容虽已实测有效，但上游清单未列，故只作旁证、不新增行、不开放通路。

## 第二十二批：材料科学与工程学院十一个公开栏目（2026-11-22）

- https://mse.zju.edu.cn/51031/list.htm：学生思政 › 学生事务（大类 学生思政），20 条，外链 0；CMS 声明 545 条 / 28 页
- https://mse.zju.edu.cn/51043/list.htm：国际交流 › 外事通知（大类 国际交流），20 条，外链 3；CMS 声明 218 条 / 11 页
- https://mse.zju.edu.cn/50999/list.htm：教育教学 › 研究生教学 › 消息公告（大类 教育教学），20 条，外链 1；CMS 声明 902 条 / 46 页
- https://mse.zju.edu.cn/51029/list.htm：学生思政 › 学生党建（大类 学生思政），20 条，外链 0；CMS 声明 237 条 / 12 页
- https://mse.zju.edu.cn/50983/list.htm：教育教学 › 本科生教学 › 消息公告（大类 教育教学），20 条，外链 1；CMS 声明 569 条 / 29 页
- https://mse.zju.edu.cn/51001/list.htm：教育教学 › 研究生教学 › 学位申请（大类 教育教学），20 条，外链 1；CMS 声明 60 条 / 3 页
- https://mse.zju.edu.cn/50963/list.htm：党政综合 › 综合办公室 › 消息公告（大类 党政综合），20 条，外链 0；CMS 声明 89 条 / 5 页
- https://mse.zju.edu.cn/50982/list.htm：教育教学 › 研究生教学（大类 教育教学），14 条，外链 5；CMS 声明 14 条 / 1 页
- https://mse.zju.edu.cn/51027/list.htm：学生思政 › 最新消息（大类 学生思政），20 条，外链 0；CMS 声明 1768 条 / 89 页
- https://mse.zju.edu.cn/51050/list.htm：招生就业 › 就业工作（大类 招生就业），6 条，外链 0；CMS 声明 6 条 / 1 页
- https://mse.zju.edu.cn/50920/list.htm：学生思政（大类 学生思政），20 条，外链 1；CMS 声明 43 条 / 3 页

本站 HTTP 同路径 301 到 HTTPS，属协议升级而非跳错站，记录 HTTPS 为有效地址。日期是 YYYY.MM.DD 点号格式。/50918/list.htm 渲染的是「教育教学」大类导航，无列表与分页，标为 container-only 不开放。精确通路累计 157／418。

## 第二十三批：建筑工程学院十个公开栏目（2026-11-22）

- http://www.ccea.zju.edu.cn/gsgg_77254/list.htm：国际交流 › 公示公告（大类 国际交流），14 条，外链 0；CMS 声明 1322 条 / 95 页
- http://www.ccea.zju.edu.cn/18459/list.htm：学生工作 › 学生事务（大类 学生工作），14 条，外链 0；CMS 声明 434 条 / 31 页
- http://www.ccea.zju.edu.cn/18461/list.htm：学生工作 › 学生组织（大类 学生工作），14 条，外链 0；CMS 声明 269 条 / 20 页
- http://www.ccea.zju.edu.cn/19119/list.htm：学生工作 › 学生事务 › 评奖评优（大类 学生工作），14 条，外链 0；CMS 声明 1153 条 / 83 页
- http://www.ccea.zju.edu.cn/19120/list.htm：学生工作 › 学生事务 › 学生资助（大类 学生工作），14 条，外链 0；CMS 声明 440 条 / 32 页
- http://www.ccea.zju.edu.cn/zpxx/list.htm：就业工作 › 通知公告 › 就业信息（大类 就业工作），14 条，外链 4；CMS 声明 3517 条 / 252 页
- http://www.ccea.zju.edu.cn/xytz/list.htm：就业工作 › 通知公告 › 学院通知（大类 就业工作），14 条，外链 3；CMS 声明 83 条 / 6 页
- http://www.ccea.zju.edu.cn/12261/list.htm：国际交流 › 交流资助 › 公派资助（大类 国际交流），14 条，外链 8；CMS 声明 63 条 / 5 页
- http://www.ccea.zju.edu.cn/18417/list.htm：教育教学 › 研究生教育 › 学籍管理（大类 教育教学），14 条，外链 0；CMS 声明 66 条 / 5 页
- http://www.ccea.zju.edu.cn/18418/list.htm：教育教学 › 研究生教育 › 学位申请（大类 教育教学），14 条，外链 1；CMS 声明 81 条 / 6 页

结构与材料学院同源（col_path + Column_Anchor + news_list.list2），但每页 14 条而非 20，日期是 MM-DD 之前的 YYYY-MM-DD。/18403 的数字路径自认 /18410/，按路径别名不一致处理、不开放。精确通路累计 167／418。

## 第二十四批：航空航天学院十个公开栏目（2026-11-22）

- http://saa.office.zju.edu.cn/tzgg_70388/list.htm：学生工作 › 通知公告（大类 学生工作），14 条，外链 0；CMS 声明 1732 条 / 124 页
- http://saa.office.zju.edu.cn/66850/list.htm：党政综合 › 通知公告（大类 党政综合），14 条，外链 8；CMS 声明 677 条 / 49 页
- http://saa.office.zju.edu.cn/tzgg_70383/list.htm：本科生教育 › 通知公告（大类 本科生教育），14 条，外链 3；CMS 声明 1226 条 / 88 页
- http://saa.office.zju.edu.cn/tzgg_70384/list.htm：研究生教育 › 通知公告（大类 研究生教育），14 条，外链 3；CMS 声明 571 条 / 41 页
- http://saa.office.zju.edu.cn/66861/list.htm：本科生教育 › 实践教学（大类 本科生教育），14 条，外链 0；CMS 声明 223 条 / 16 页
- http://saa.office.zju.edu.cn/66866/list.htm：研究生教育 › 培养过程（大类 研究生教育），14 条，外链 0；CMS 声明 148 条 / 11 页
- http://saa.office.zju.edu.cn/67666/list.htm：学生工作 › 奖助贷补（大类 学生工作），14 条，外链 1；CMS 声明 41 条 / 3 页
- http://saa.office.zju.edu.cn/66921/list.htm：国际交流 › 经费资助（大类 国际交流），14 条，外链 1；CMS 声明 64 条 / 5 页
- http://saa.office.zju.edu.cn/66920/list.htm：国际交流 › 交流活动（大类 国际交流），14 条，外链 3；CMS 声明 267 条 / 20 页
- http://saa.office.zju.edu.cn/66773/list.htm：研究生教育（大类 研究生教育），6 条，外链 0；CMS 声明 6 条 / 1 页

四栏显示标题都是「通知公告」，只能靠完整链路 + 大类名区分。本站新增一条硬校验：面包屑末项必须等于请求路径，否则判为路径别名不一致。/66964、/dwjl 因此被拒，各自自认 /67668/、/tzgg_70387/。精确通路累计 177／418。

## 第二十五批：传媒与国际文化学院十一个公开栏目（2026-11-22）

- http://office.cmic.zju.edu.cn/zxtz_40722/list.htm：学生思政 › 最新通知（大类 学生思政），25 条，外链 0；CMS 声明 3329 条 / 134 页
- http://office.cmic.zju.edu.cn/40748/list.htm：其他 › 通知公告 › 重要通知（大类 其他），25 条，外链 0；CMS 声明 2225 条 / 89 页
- http://office.cmic.zju.edu.cn/40523/list.htm：学生思政 › 学生资助（大类 学生思政），25 条，外链 0；CMS 声明 486 条 / 20 页
- http://office.cmic.zju.edu.cn/40505/list.htm：研究生教育 › 教学培养（大类 研究生教育），20 条，外链 1；CMS 声明 20 条 / 1 页
- http://office.cmic.zju.edu.cn/40520/list.htm：学生思政 › 学生团建（大类 学生思政），25 条，外链 0；CMS 声明 334 条 / 14 页
- http://office.cmic.zju.edu.cn/40496/list.htm：本科教育 › 最新通知（大类 本科教育），25 条，外链 0；CMS 声明 841 条 / 34 页
- http://office.cmic.zju.edu.cn/40524/list.htm：学生思政 › 思政教育（大类 学生思政），25 条，外链 0；CMS 声明 114 条 / 5 页
- http://office.cmic.zju.edu.cn/40454/list.htm：学生思政（大类 学生思政），25 条，外链 0；CMS 声明 38 条 / 2 页
- http://office.cmic.zju.edu.cn/40521/list.htm：学生思政 › 就业信息（大类 学生思政），25 条，外链 0；CMS 声明 902 条 / 37 页
- http://office.cmic.zju.edu.cn/40465/list.htm：党政管理 › 最新通知（大类 党政管理），25 条，外链 0；CMS 声明 316 条 / 13 页
- http://office.cmic.zju.edu.cn/40529/list.htm：国际合作 › 通知公示（大类 国际合作），25 条，外链 6；CMS 声明 120 条 / 5 页

三栏显示标题都是「最新通知」，靠完整链路 + 大类名区分；每页 25 条。该站复用马克思主义学院同源的 cg-news-list#arthd 结构，但标题属性有值（马克思学院是空串），因此解析沿用「属性非空优先」。精确通路累计 188／418。

## 第二十六批：电气工程学院九个公开栏目（2026-11-22）

- http://ee.office.zju.edu.cn/88758/list.htm：本科生教育 › 教学事务（大类 本科生教育），14 条，外链 4；CMS 声明 903 条 / 65 页
- http://ee.office.zju.edu.cn/88757/list.htm：本科生教育 › 信息公告（大类 本科生教育），14 条，外链 6；CMS 声明 3410 条 / 244 页
- http://ee.office.zju.edu.cn/88775/list.htm：研究生教育 › 信息公告（大类 研究生教育），14 条，外链 5；CMS 声明 1266 条 / 91 页
- http://ee.office.zju.edu.cn/88748/list.htm：管理服务 › 通知公告（大类 管理服务），14 条，外链 1；CMS 声明 233 条 / 17 页
- http://ee.office.zju.edu.cn/88780/list.htm：研究生教育 › 培养过程（大类 研究生教育），14 条，外链 1；CMS 声明 134 条 / 10 页
- http://ee.office.zju.edu.cn/88736/list.htm：研究生教育（大类 研究生教育），2 条，外链 0；CMS 声明 2 条 / 1 页
- http://ee.office.zju.edu.cn/88808/list.htm：学生工作 › 奖助事务（大类 学生工作），14 条，外链 3；CMS 声明 355 条 / 26 页
- http://ee.office.zju.edu.cn/88784/list.htm：研究生教育 › 学籍管理（大类 研究生教育），8 条，外链 6；CMS 声明 8 条 / 1 页
- http://ee.office.zju.edu.cn/88891/list.htm：通知公告 › 就业服务（大类 通知公告），14 条，外链 10；CMS 声明 293 条 / 21 页

本站列表不是 ul/li，而是 div.col_news_list > div.jzlb 块，解析需按块匹配。/88740 与 /88759 的面包屑末项分别自认 /88804/、/88765/，按别名不一致标 identity-mismatch 不开放。精确通路累计 197／418。

## 第二十七批：集成电路学院九个公开栏目（2026-11-22）

- https://ic.zju.edu.cn/54032/list.htm：学生思政 › 评奖评优（大类 学生思政），14 条，外链 0；CMS 声明 107 条 / 8 页
- https://ic.zju.edu.cn/54029/list.htm：学生思政 › 通知公告（大类 学生思政），14 条，外链 0；CMS 声明 169 条 / 13 页
- https://ic.zju.edu.cn/54033/list.htm：学生思政 › 困难资助（大类 学生思政），14 条，外链 0；CMS 声明 22 条 / 2 页
- https://ic.zju.edu.cn/54036/list.htm：合作交流 › 国际交流（大类 合作交流），8 条，外链 2；CMS 声明 8 条 / 1 页
- https://ic.zju.edu.cn/54026/list.htm：教学招生 › 培养管理（大类 教学招生），14 条，外链 0；CMS 声明 80 条 / 6 页
- https://ic.zju.edu.cn/54027/list.htm：教学招生 › 学位管理（大类 教学招生），14 条，外链 0；CMS 声明 32 条 / 3 页
- https://ic.zju.edu.cn/tzgg/list.htm：教学招生 › 通知公告（大类 教学招生），14 条，外链 0；CMS 声明 238 条 / 17 页
- https://ic.zju.edu.cn/tzgg_54532/list.htm：综合服务 › 通知公告（大类 综合服务），14 条，外链 0；CMS 声明 70 条 / 5 页
- https://ic.zju.edu.cn/tzgg_81346/list.htm：教工之家 › 通知公告（大类 教工之家），14 条，外链 0；CMS 声明 39 条 / 3 页

五栏同名「通知公告」，靠完整链路 + h3 大类名区分。/53663 与 /54034 的面包屑末项分别自认 /tzgg_54534/、/tzgg_87720/，按别名不一致标 identity-mismatch 不开放。精确通路累计 206／418。

## 第二十八批：生命科学学院七个公开栏目（2026-11-22）

- http://www.cls.office.zju.edu.cn/25820/list.psp：科室信息 › 科研合作 › 最新通知，14 条，外链 14；CMS 声明 501 条 / 36 页
- http://www.cls.office.zju.edu.cn/cggs/list.psp：科室信息 › 国际交流 › 出国公示，14 条，外链 0；CMS 声明 452 条 / 33 页
- http://www.cls.office.zju.edu.cn/25875/list.psp：科室信息 › 本科生教育 › 海外交流，14 条，外链 3；CMS 声明 110 条 / 8 页
- http://www.cls.office.zju.edu.cn/25812/list.psp：科室信息 › 信息公开 › 安全教育，14 条，外链 6；CMS 声明 81 条 / 6 页
- http://www.cls.office.zju.edu.cn/gsgg_80891/list.psp：科室信息 › 研究生教育 › 公示公告，6 条，外链 0；CMS 声明 6 条 / 1 页
- http://www.cls.office.zju.edu.cn/gsgg_80892/list.psp：科室信息 › 本科生教育 › 公示公告，14 条，外链 0；CMS 声明 30 条 / 3 页
- http://www.cls.office.zju.edu.cn/gsgg_80890/list.psp：科室信息 › 科研合作 › 公示公告，6 条，外链 1；CMS 声明 6 条 / 1 页

目录写 .htm 但实际一律 301 到同站 .psp，属扩展名迁移而非跳错站，按 .psp 记录有效地址。/25821、/25824、/gjjl_79410、/qctx1 的面包屑末项自认另一路径，按别名不一致标 identity-mismatch 不开放。精确通路累计 213／418。

## 第二十九批：外国语学院八个公开栏目（2026-11-22）

- http://www.sis.zju.edu.cn/sischinese/12596/list.htm：学生思政 › 评奖评优，14 条，外链 0；CMS 声明 349 条 / 25 页
- http://www.sis.zju.edu.cn/sischinese/12597/list.htm：学生思政 › 学生资助，14 条，外链 0；CMS 声明 293 条 / 21 页
- http://www.sis.zju.edu.cn/sischinese/12600/list.htm：学生思政 › 学生组织，14 条，外链 3；CMS 声明 44 条 / 4 页
- http://www.sis.zju.edu.cn/sischinese/12610/list.htm：对外交流 › 国际交流，14 条，外链 0；CMS 声明 371 条 / 27 页
- http://www.sis.zju.edu.cn/sischinese/12587/list.htm：研究生教育 › 教学教务，14 条，外链 7；CMS 声明 67 条 / 5 页
- http://www.sis.zju.edu.cn/sischinese/12554/list.htm：党政管理 › 最新通知，14 条，外链 8；CMS 声明 472 条 / 34 页
- http://www.sis.zju.edu.cn/sischinese/12577/list.htm：本科教育 › 最新通知，14 条，外链 0；CMS 声明 957 条 / 69 页
- http://www.sis.zju.edu.cn/sischinese/12609/list.htm：对外交流 › 最新通知，14 条，外链 1；CMS 声明 378 条 / 27 页

四栏同名「最新通知」，靠完整链路 + dqwzlm 标题区分。/12541、/12542 的面包屑末项分别自认 /12584、/12593，按别名不一致标 identity-mismatch 不开放。精确通路累计 221／418。

## 第三十批：海洋学院十个公开栏目（2026-11-22）

- https://oca.zju.edu.cn/pjpy/list.psp：学生工作 › 评奖评优（目录「评奖评优」），20 条，外链 0；CMS 声明 502 条 / 26 页
- https://oca.zju.edu.cn/xszz/list.psp：学生工作 › 学生资助（目录「学生资助」），20 条，外链 0；CMS 声明 223 条 / 12 页
- https://oca.zju.edu.cn/xstj/list.psp：学生工作 › 学生团建（目录「学生团建」），20 条，外链 0；CMS 声明 395 条 / 20 页
- https://oca.zju.edu.cn/xsgz/list.psp：学生工作 › 信息公告（目录「学生工作」），20 条，外链 0；CMS 声明 1164 条 / 59 页
- https://oca.zju.edu.cn/dwxxgg/list.htm：对外合作 › 信息公告（目录「对外合作·信息公告」），20 条，外链 0；CMS 声明 1398 条 / 70 页
- https://oca.zju.edu.cn/xxgg_29992/list.psp：人才培养 › 信息公告（目录「人才培养·信息公告」），20 条，外链 12；CMS 声明 350 条 / 18 页
- https://oca.zju.edu.cn/rcjx/list.psp：人才培养 › 日常教学（目录「日常教学」），20 条，外链 6；CMS 声明 75 条 / 4 页
- https://oca.zju.edu.cn/rcpy/list.psp：人才培养 › 最新消息（目录「人才培养」），20 条，外链 2；CMS 声明 756 条 / 38 页
- https://oca.zju.edu.cn/tzgg/list.psp：图书信息 › 服务通知（目录「图书信息·通知公告」），20 条，外链 1；CMS 声明 141 条 / 8 页
- https://oca.zju.edu.cn/jzyg_68302/list.psp：图书信息 › 讲座预告（目录「讲座预告」），20 条，外链 17；CMS 声明 71 条 / 4 页

本站用页面内的 `var url = "/<栏目>/list.htm"` 自报栏目地址，正好可当「路径别名」的独立判据；配合 h1 标题与父栏目名三者一致才开放。目录 .htm 多数 301 到同站 .psp（/dwxxgg 例外），分开记录。精确通路累计 231／418。

## 第三十一批：信息与电子工程学院七个公开栏目（2026-11-22）

- http://www.isee.zju.edu.cn/51190/list.psp：通知公告 › 全部通知，20 条，外链 0；CMS 声明 13070 条 / 654 页
- http://www.isee.zju.edu.cn/51191/list.psp：通知公告 › 公示公告，20 条，外链 0；CMS 声明 624 条 / 32 页
- http://www.isee.zju.edu.cn/51193/list.psp：通知公告 › 本科生教学，20 条，外链 0；CMS 声明 2642 条 / 133 页
- http://www.isee.zju.edu.cn/51194/list.psp：通知公告 › 研究生教学，20 条，外链 2；CMS 声明 865 条 / 44 页
- http://www.isee.zju.edu.cn/51195/list.psp：通知公告 › 学生工作，20 条，外链 0；CMS 声明 4076 条 / 204 页
- http://www.isee.zju.edu.cn/51199/list.psp：通知公告 › 对外交流，20 条，外链 0；CMS 声明 34 条 / 2 页
- http://www.isee.zju.edu.cn/51200/list.psp：通知公告 › 就业实习，20 条，外链 0；CMS 声明 3040 条 / 152 页

本站日期被拆成 h3（日）与 p（YYYY-MM）两段，解析需拼合后校验；/21056、/21057、/50891 的「您的位置」末项分别自认 /21061、/21064、/50899，按别名不一致标 identity-mismatch 不开放。精确通路累计 242／418。

## 第三十二批：公共卫生学院八个公开栏目（2026-11-22）

- http://www.phs.zju.edu.cn/94008/list.htm：人才培养 › 研究生培养（大类 人才培养），14 条，外链 7；CMS 声明 22 条 / 2 页
- http://www.phs.zju.edu.cn/94009/list.htm：人才培养 › 本科生培养 › 培养管理（大类 人才培养），6 条，外链 0；CMS 声明 6 条 / 1 页
- http://www.phs.zju.edu.cn/94011/list.htm：人才培养 › 本科生培养 › 对外交流（大类 人才培养），2 条，外链 0；CMS 声明 2 条 / 1 页
- http://www.phs.zju.edu.cn/94014/list.htm：人才培养 › 研究生培养 › 通知公告（大类 人才培养），14 条，外链 6；CMS 声明 23 条 / 2 页
- http://www.phs.zju.edu.cn/94017/list.htm：人才培养 › 研究生培养 › 学位授予（大类 人才培养），4 条，外链 3；CMS 声明 4 条 / 1 页
- http://www.phs.zju.edu.cn/94021/list.htm：交流合作 › 国际合作 › 通知公告（大类 交流合作），14 条，外链 0；CMS 声明 55 条 / 4 页
- http://www.phs.zju.edu.cn/94024/list.htm：交流合作 › 国际合作 › 国际交流（大类 交流合作），14 条，外链 5；CMS 声明 29 条 / 3 页
- http://www.phs.zju.edu.cn/94033/list.htm：学生工作 › 学生活动（大类 学生工作），14 条，外链 11；CMS 声明 58 条 / 5 页

两栏页面标题同为「通知公告」，靠完整链路 + 大类名 + 标题三重校验区分；/93961、/93964 的面包屑末项分别自认 /94007、/94032，按别名不一致标 identity-mismatch 不开放。精确通路累计 250／418。

## 第三十三批：历史学院九个公开栏目（2026-11-22）

- http://office.ls.zju.edu.cn/65256/list.htm：学生思政 › 评奖评优（大类 学生思政），14 条，外链 0；CMS 声明 197 条 / 15 页
- http://office.ls.zju.edu.cn/65255/list.htm：学生思政 › 就业指导（大类 学生思政），14 条，外链 0；CMS 声明 125 条 / 9 页
- http://office.ls.zju.edu.cn/65257/list.htm：学生思政 › 学生资助（大类 学生思政），14 条，外链 0；CMS 声明 84 条 / 6 页
- http://office.ls.zju.edu.cn/65254/list.htm：学生思政 › 学生团建（大类 学生思政），14 条，外链 2；CMS 声明 143 条 / 11 页
- http://office.ls.zju.edu.cn/65259/list.htm：学生思政 › 公示专区（大类 学生思政），14 条，外链 0；CMS 声明 63 条 / 5 页
- http://office.ls.zju.edu.cn/65253/list.htm：学生思政 › 学生党建（大类 学生思政），14 条，外链 4；CMS 声明 20 条 / 2 页
- http://office.ls.zju.edu.cn/65251/list.htm：学生思政 › 最新通知（大类 学生思政），14 条，外链 0；CMS 声明 101 条 / 8 页
- http://office.ls.zju.edu.cn/65280/list.htm：教育教学 › 本科生教育 › 最新通知（大类 教育教学），14 条，外链 0；CMS 声明 82 条 / 6 页
- http://office.ls.zju.edu.cn/65292/list.htm：教育教学 › 研究生教育 › 最新通知（大类 教育教学），14 条，外链 3；CMS 声明 112 条 / 8 页

本站出现三种容易混淆的形态并存：/65251 是父栏渲染默认子栏（末项即本路径、文字为子栏名），/65280 与 /65292 的链路父级与末项同路径但文字不同。三者都通过「末项路径相等 + 文字逐项匹配」放行，说明该判据既能拒绝真别名，也不会误伤合理形态。精确通路累计 259／418。

## 第三十四批：能源工程学院六个公开栏目（2026-11-22）

- http://doe-oa.zju.edu.cn/75472/list.htm：人力资源 › 信息公告（大类 人力资源），14 条，外链 0；CMS 声明 581 条 / 42 页
- http://doe-oa.zju.edu.cn/75509/list.htm：研究生教育 › 课程培养 › 通知公告（大类 研究生教育），14 条，外链 0；CMS 声明 34 条 / 3 页
- http://doe-oa.zju.edu.cn/75516/list.htm：研究生教育 › 论文答辩 › 答辩通知（大类 研究生教育），14 条，外链 0；CMS 声明 74 条 / 6 页
- http://doe-oa.zju.edu.cn/75536/list.htm：学生工作 › 学工（大类 学生工作），14 条，外链 0；CMS 声明 552 条 / 40 页
- http://doe-oa.zju.edu.cn/77471/list.htm：研究生教育 › 专业实践 › 通知公告（大类 研究生教育），11 条，外链 0；CMS 声明 11 条 / 1 页
- http://doe-oa.zju.edu.cn/jxgg/list.htm：本科生教育 › 教学改革（大类 本科生教育），14 条，外链 0；CMS 声明 59 条 / 5 页

三栏同名「通知公告」，靠完整链路 + 大类名 + 标题三重校验区分；/75431、/75435、/75436 的面包屑末项分别自认 /75479、/tw、/75545，按别名不一致标 identity-mismatch 不开放。精确通路累计 265／418。

## 第三十五批：化学工程与生物工程学院九个公开栏目（2026-11-22）

- http://che.cn.zju.edu.cn/15222/list.htm：学生工作 › 学生思政（大类 学生工作），20 条，外链 0；CMS 声明 150 条 / 8 页
- http://che.cn.zju.edu.cn/ygcgwjwgs/list.htm：国际交流 › 出国公示（大类 国际交流），20 条，外链 0；CMS 声明 758 条 / 38 页
- http://che.cn.zju.edu.cn/15188/list.htm：研究生教育 › 消息公告（大类 研究生教育），20 条，外链 3；CMS 声明 1015 条 / 51 页
- http://che.cn.zju.edu.cn/15198/list.htm：本科生教育 › 消息公告（大类 本科生教育），20 条，外链 2；CMS 声明 782 条 / 40 页
- http://che.cn.zju.edu.cn/15227/list.htm：学生工作 › 学生思政 › 学生事务（大类 学生工作），20 条，外链 0；CMS 声明 373 条 / 19 页
- http://che.cn.zju.edu.cn/15157/list.htm：学生工作（大类 学生工作），20 条，外链 0；CMS 声明 173 条 / 9 页
- http://che.cn.zju.edu.cn/15226/list.htm：学生工作 › 学生思政 › 学生党建（大类 学生工作），20 条，外链 0；CMS 声明 60 条 / 3 页
- http://che.cn.zju.edu.cn/xgtz/list.htm：国际交流 › 消息公告（大类 国际交流），20 条，外链 0；CMS 声明 225 条 / 12 页
- http://che.cn.zju.edu.cn/15154/list.htm：本科生教育（大类 本科生教育），20 条，外链 0；CMS 声明 156 条 / 8 页

两栏同名「消息公告」靠完整链路 + 标题 + 大类名三重校验区分。本站日期写作 `[YYYY-MM-DD]`（带方括号），解析需容忍括号；面包屑末项硬校验在本站同样生效。精确通路累计 274／418。

## 第三十六批：光电科学与工程学院八个公开栏目（2026-11-22）

- http://opt.zju.edu.cn/73609/list.psp：对外交流 › 出国出境公示（大类 对外交流），20 条，外链 0；CMS 声明 363 条 / 19 页
- http://opt.zju.edu.cn/72740/list.psp：学生工作 › 评奖评优（大类 学生工作），20 条，外链 0；CMS 声明 55 条 / 3 页
- http://opt.zju.edu.cn/72768/list.htm：通知公告 › 重点提示（大类 通知公告），20 条，外链 1；CMS 声明 4424 条 / 222 页
- http://opt.zju.edu.cn/72701/list.htm：综合服务 › 通知公告（大类 综合服务），20 条，外链 0；CMS 声明 518 条 / 26 页
- http://opt.zju.edu.cn/72724/list.psp：本科生教育 › 学籍管理（大类 本科生教育），20 条，外链 0；CMS 声明 65 条 / 4 页
- http://opt.zju.edu.cn/72739/list.htm：学生工作 › 团学组织（大类 学生工作），20 条，外链 0；CMS 声明 130 条 / 7 页
- http://opt.zju.edu.cn/tzgg/list.htm：发展联络 › 通知公告（大类 发展联络），20 条，外链 14；CMS 声明 31 条 / 2 页
- http://opt.zju.edu.cn/72735/list.htm：对外交流 › 通知公告（大类 对外交流），20 条，外链 1；CMS 声明 390 条 / 20 页

三栏同名「通知公告」（综合服务 / 发展联络 / 对外交流）靠完整链路 + 大类名 + 标题三重校验区分；本批 8 栏中有 3 栏的 .htm 会 301 到同站 .psp，5 栏 .htm 直接可用，同类站点内也可能混用。精确通路累计 282／418。

## 第三十七批：农业与生物技术学院五个公开栏目（2026-11-22）

- http://office.cab.zju.edu.cn/28876/list.htm：学生工作（大类 学生工作），14 条，外链 0；CMS 声明 64 条 / 5 页
- http://office.cab.zju.edu.cn/28972/list.htm：本科生教育 › 教学培养（大类 本科生教育），13 条，外链 9；CMS 声明 13 条 / 1 页
- http://office.cab.zju.edu.cn/28974/list.htm：本科生教育 › 对外交流（大类 本科生教育），10 条，外链 0；CMS 声明 10 条 / 1 页
- http://office.cab.zju.edu.cn/28985/list.htm：研究生教育 › 海外交流（大类 研究生教育），14 条，外链 2；CMS 声明 58 条 / 5 页
- http://office.cab.zju.edu.cn/29000/list.htm：国际合作与交流 › 师生交流（大类 国际合作与交流），14 条，外链 0；CMS 声明 389 条 / 28 页

本站列表用 ul.wp_article_list + span.Article_Title/Article_PublishDate（与博达默认模板的其他站不同）。/28946、/28947、/28949 的面包屑末项分别自认 /28971、/28979、/28999，按别名不一致标 identity-mismatch 不开放。精确通路累计 287／418。

## 第三十八批：动物科学学院六个公开栏目（2026-11-22）

- http://office.cas.zju.edu.cn/15927/list.htm：学子在线 › 研究生事务（大类 学子在线），20 条，外链 0；CMS 声明 681 条 / 35 页
- http://office.cas.zju.edu.cn/15893/list.htm：国际交流 › 通知公告（大类 国际交流），19 条，外链 17；CMS 声明 52 条 / 3 页
- http://office.cas.zju.edu.cn/15929/list.htm：学子在线 › 就业工作（大类 学子在线），20 条，外链 2；CMS 声明 416 条 / 21 页
- http://office.cas.zju.edu.cn/16447/list.htm：本科生教育 › 实践竞赛 › 实践教学（大类 本科生教育），12 条，外链 0；CMS 声明 12 条 / 1 页
- http://office.cas.zju.edu.cn/16449/list.htm：本科生教育 › 实践竞赛 › 学科竞赛（大类 本科生教育），10 条，外链 0；CMS 声明 10 条 / 1 页
- http://office.cas.zju.edu.cn/15925/list.htm：学子在线 › 学生党建（大类 学子在线），20 条，外链 0；CMS 声明 185 条 / 10 页

/15889（实践竞赛）实测是多子栏容器页：把实践教学、科研训练、学科竞赛各渲染成一段列表拼在一页，CMS 总数 19 恰为三子栏之和。已标 container-only 且解析器直接拒绝，子栏 /16447、/16449 单独验证。精确通路累计 293／418。

## 第三十九批：高分子科学与工程学系五个公开栏目（2026-11-22）

- http://office.polymer.zju.edu.cn/37282/list.htm：系务动态 › 消息公告（大类 系务动态），10 条（有日期 10），外链 0；CMS 声明 9078 条 / 908 页
- http://office.polymer.zju.edu.cn/sjjx/list.htm：本科生教育 › 实践教学（大类 本科生教育），14 条（有日期 0），外链 0；CMS 声明 199 条 / 15 页
- http://office.polymer.zju.edu.cn/xsh/list.htm：学生工作 › 学生会（大类 学生工作），10 条（有日期 10），外链 0；CMS 声明 453 条 / 46 页
- http://office.polymer.zju.edu.cn/xtw/list.htm：学生工作 › 系团委（大类 学生工作），10 条（有日期 10），外链 0；CMS 声明 364 条 / 37 页
- http://office.polymer.zju.edu.cn/37264/list.htm：学生工作（大类 学生工作），3 条（有日期 3），外链 0；CMS 声明 3 条 / 1 页

本站有两处需要特殊处置：① /sjjx 的日期块被 HTML 注释掉，页面不显示日期，解析器先剥离注释再取，按「无日期列表」开放并明确记录 datedCount=0；② /37259 的面包屑末项自认 /xxgg/，标 identity-mismatch 不开放。精确通路累计 298／418。

## 第四十批：生物医学工程与仪器科学学院六个公开栏目（2026-11-22）

- http://www.cbeis.zju.edu.cn/tzgg_65357/list.htm：学生工作 › 通知公告（大类 学生工作），14 条，外链 0；CMS 声明 394 条 / 29 页
- http://www.cbeis.zju.edu.cn/tzgg_65360/list.htm：国际交流 › 通知公告（大类 国际交流），14 条，外链 0；CMS 声明 120 条 / 9 页
- http://www.cbeis.zju.edu.cn/63901/list.htm：教育教学 › 本科生教育 › 通知公告（大类 教育教学），14 条，外链 0；CMS 声明 57 条 / 5 页
- http://www.cbeis.zju.edu.cn/xszz/list.htm：学生工作 › 学生组织（大类 学生工作），14 条，外链 0；CMS 声明 52 条 / 4 页
- http://www.cbeis.zju.edu.cn/tzgg/list.htm：教育教学 › 研究生教育 › 通知公告（大类 教育教学），14 条，外链 4；CMS 声明 198 条 / 15 页
- http://www.cbeis.zju.edu.cn/gsgg/list.psp：通知公告 › 公示公告（大类 通知公告），14 条，外链 0；CMS 声明 133 条 / 10 页

三栏同名「通知公告」，靠 dc-weizhi 全链路 + m1 内 h2 大类名区分；/tzgg 与 /63901 存在父子同路径（父级与末项 href 相同、文字不同）。/gsgg 的 .htm 301 到同站 .psp。精确通路累计 304／418。

## 第四十一批：脑科学与脑医学系六个公开栏目（2026-11-22）

- http://www.neuroscience.zju.edu.cn/45474/list.htm：教育思政，15 条，外链 2；CMS 声明 60 条 / 4 页
- http://www.neuroscience.zju.edu.cn/xssz/list.htm：教育思政 › 学生思政，15 条，外链 0；CMS 声明 56 条 / 4 页
- http://www.neuroscience.zju.edu.cn/gsgg_54816/list.psp：综合服务 › 公示公告，11 条，外链 0；CMS 声明 11 条 / 1 页
- http://www.neuroscience.zju.edu.cn/dwjl/list.htm：交流合作 › 国际交流，15 条，外链 13；CMS 声明 39 条 / 3 页
- http://www.neuroscience.zju.edu.cn/dxsxly_75666/list.htm：教育思政 › 大学生夏令营，9 条，外链 0；CMS 声明 9 条 / 1 页
- http://www.neuroscience.zju.edu.cn/bksjy/list.htm：教育思政 › 本科生教育，5 条，外链 3；CMS 声明 5 条 / 1 页

本站与信电学院同源（list-top_pos + titl + list_guild），日期同样是 h3（日）+ p（YYYY-MM）两段拼合。与信电不同的是本站没有 Column_Anchor 大类名，身份判据只有「您的位置」全链路 + titl 标题两项。/gsgg_54816 的 .htm 301 到同站 .psp。精确通路累计 310／418。

## 第四十二批：软件学院四个公开栏目（2026-11-22）

- http://www.cst.zju.edu.cn/zytz_49383/list.htm：旧版栏目 › 校园服务 › 重要通知（大类 旧版栏目），14 条，外链 0；CMS 声明 21 条 / 2 页
- http://www.cst.zju.edu.cn/36233/list.htm：旧版栏目 › 实习就业 › 最新通知（大类 旧版栏目），14 条，外链 0；CMS 声明 304 条 / 22 页
- http://www.cst.zju.edu.cn/36191/list.htm：旧版栏目 › 教学管理（大类 旧版栏目），14 条，外链 0；CMS 声明 24 条 / 2 页
- http://www.cst.zju.edu.cn/36216/list.htm：旧版栏目 › 教学管理 › 教务信息（大类 旧版栏目），14 条，外链 0；CMS 声明 69 条 / 5 页

本站日期写成 YYYY.MM.DD 点分隔、标题在 div 而非 span，均与前几批不同。/36192（思政工作）实测是单篇文章页：内容区只有一篇正文，没有列表、分页与 CMS 总数，标 container-only 不开放。精确通路累计 314／418。

## 第四十三批：人工智能学院五个公开栏目（2026-11-22）

- http://ai.office.zju.edu.cn/nbgs/list.htm：国际交流 › 教师国际交流 › 内部公示，20 条，外链 0；CMS 声明 111 条 / 6 页
- http://ai.office.zju.edu.cn/90093/list.htm：行政综合 › 行政综合-通知公告，3 条，外链 0；CMS 声明 3 条 / 1 页
- http://ai.office.zju.edu.cn/tzgg_89914/list.htm：教育教学 › 教育教学-通知公告，18 条，外链 0；CMS 声明 18 条 / 1 页
- http://ai.office.zju.edu.cn/tzgg_89915/list.htm：国际交流 › 国际交流-通知公告，2 条，外链 0；CMS 声明 2 条 / 1 页
- http://ai.office.zju.edu.cn/tzgg_92951/list.htm：学生工作 › 通知公告，2 条，外链 0；CMS 声明 2 条 / 1 页

本站是 Tailwind 重写版模板：没有 ul/li 列表、没有 col_path/Column_Anchor 类名，列表项是 a.w-full.p-6，日期与标题在 span.font-mono / h3 里。幸而 CMS 仍输出 all_count 与 all_pages，计数校验照旧可用。精确通路累计 319／418。

## 第四十四批：动物科学学院四个公开栏目（2026-11-22）

- http://www.cas.zju.edu.cn/caschinese/jxxz/list.htm：人才培养 › 教学相长（大类 人才培养），14 条，外链 0；CMS 声明 69 条 / 5 页
- http://www.cas.zju.edu.cn/caschinese/15939/list.htm：人才培养 › 研究生教育 › 通知公告（大类 人才培养），14 条，外链 0；CMS 声明 86 条 / 7 页
- http://www.cas.zju.edu.cn/caschinese/pxtz/list.htm：科学研究 › 公用平台 › 培训通知（大类 科学研究），9 条，外链 0；CMS 声明 9 条 / 1 页
- http://www.cas.zju.edu.cn/caschinese/xsgz/list.htm：人才培养 › 学生工作（大类 人才培养），14 条，外链 0；CMS 声明 226 条 / 17 页

本站列表项日期有两种形态并存：time-box 内 date（日）+ month（YYYY-MM）拆分，以及 time.btnText 的完整 YYYY-MM-DD，解析器两种都认。/caschinese/15907 的面包屑末项自认 /caschinese/15911/，按别名不一致标 identity-mismatch 不开放。精确通路累计 323／418。

## 第四十五批：文学院三个公开栏目（2026-11-22）

- https://literature.zju.edu.cn/bksjy_65102/list.htm：人才培养 › 本科生教育，14 条，外链 0；CMS 声明 66 条 / 5 页
- https://literature.zju.edu.cn/yjsjy/list.htm：人才培养 › 研究生教育，14 条，外链 1；CMS 声明 34 条 / 3 页
- https://literature.zju.edu.cn/zxtz/list.htm：党政管理 › 最新通知，7 条，外链 1；CMS 声明 7 条 / 1 页

本站**完全没有面包屑**，是已收录站点里第一个只能靠导航选中项判身份的：判据是「左侧导航 li.menu-item.selected 的 href 与文字」+「侧栏 h3 大类名」。/rcpy 不在左侧导航里，没有 selected 项可核，按 identity-mismatch 不开放。精确通路累计 326／418。

## 第四十六批：能源工程学院官网两个公开栏目（2026-11-22）

- http://www.doe.zju.edu.cn/74397/list.htm：学生工作 › 科创竞赛（大类 学生工作），2 条，外链 2；CMS 声明 2 条 / 1 页
- http://www.doe.zju.edu.cn/74389/list.htm：研究生教育 › 信息公告（大类 研究生教育），20 条，外链 2；CMS 声明 122 条 / 7 页

注意本站（www.doe.zju.edu.cn，官网）与 doe-oa.zju.edu.cn（办公网）是同一学院的两个站，此前已单独收录 doe-oa 的六个栏目。本站 /74364 与 /74397 渲染同一栏目内容，页面末项自认 /74397，故按 /74397 记录权威通路。精确通路累计 328／418。

## 第四十七批：化工学院官网 /checn/ 子站两个公开栏目（2026-11-22）

- http://che.zju.edu.cn/checn/16306/list.htm：教育教学 › 研究生教育（大类 教育教学），5 条，外链 0；CMS 声明 5 条 / 1 页
- http://che.zju.edu.cn/checn/16305/list.htm：教育教学 › 本科生教育（大类 教育教学），2 条，外链 0；CMS 声明 2 条 / 1 页

注意 host：本站是 che.zju.edu.cn 的 /checn/ 子站，与已收录的 che.cn.zju.edu.cn 是不同 host、不同目录体系，属于「同学院不同站」，需独立核对。/checn/15792 与 /checn/16305 渲染同一栏目内容（同为 2 条），页面末项自认 16305，按 16305 记录。精确通路累计 330／418。

## 第四十八批：物理学院两个公开栏目（2026-11-22）

- https://physics.zju.edu.cn/zxxx_69701/list.htm：研究生教育 › 最新消息（大类 研究生教育），15 条，外链 1；CMS 声明 24 条 / 2 页
- https://physics.zju.edu.cn/zxxx/list.htm：本科生教育 › 最新消息（大类 本科生教育），15 条，外链 3；CMS 声明 20 条 / 2 页

两栏页面标题完全同名「最新消息」，靠左侧导航 selected 项 + 侧栏 h3 大类名区分；日期是 span.d（日）+ span.y（YYYY-MM）两段，需拼合。精确通路累计 332／418。

## 第四十九批：海洋学院官网 oc.zju.edu.cn 两个公开栏目（2026-11-22）

- http://oc.zju.edu.cn/tzgg/list.htm：学院动态 › 通知公告（目录「学院动态·通知公告」），20 条，外链 0；CMS 声明 471 条 / 24 页
- http://oc.zju.edu.cn/86050/list.htm：学院动态 › 学术活动（目录「学术活动」），20 条，外链 0；CMS 声明 130 条 / 7 页

注意：oc.zju.edu.cn 与 oca.zju.edu.cn 同属海洋学院但为不同 host，模板同源、结论须分别核对。精确通路累计 334／418。

## 第五十批：计算机学院官网 csen 子站两个公开栏目（2026-11-22）

- http://www.cs.zju.edu.cn/csen/zdts/list.htm：重点提示 › 重点提示（14 条，外链 0；CMS 声明 456 条 / 33 页）
- http://www.cs.zju.edu.cn/csen/xsjz/list.htm：学术讲座 › 学术讲座（14 条，外链 3；CMS 声明 15 条 / 2 页）

与 cspo.zju.edu.cn 是不同 host 与目录体系，须分别核对。两栏的父级与末项同名同目录（重点提示 / 学术讲座），需靠完整路径比对区分。精确通路累计 336／418。

## 第五十一批：网络空间安全学院一个公开栏目（2026-11-22）

- https://icsr.zju.edu.cn/xsgz/list.htm：人才培养 › 学生工作（14 条，外链 0；CMS 声明 35 条 / 3 页）

/xsjl（学术讲座）页面可访问、标题正确，但「当前位置」末项自认 /xsjz/，标 identity-mismatch 不开放；同目录的 /xsjz 未在清单中、也未验证。精确通路累计 337／418。

## 第五十二批：基础医学系一个公开栏目（2026-11-22）

- https://bms.zju.edu.cn/85147/list.htm：教育教学 › 研究生教育教学（20 条，外链 16；CMS 声明 119 条 / 6 页）

/85097 同时命中两个问题：清单标签「教育教学」与页面标题「本科生教育教学」不同，且末项自认 /85146/。按别名不一致处理、不开放。精确通路累计 338／418。

## 第五十三批：计算机学院 cspo 站收尾（2026-11-22）

/27111 与 /27180 的「当前位置」末项分别自认 /27197/、/27186/，按别名不一致标 identity-mismatch、不开放。至此该站 10 个目录路径全部处置完毕：4 栏开放、6 栏别名不一致。精确通路累计保持 338／418。

## 第五十四批：经济学院补四个栏目、两条默认子栏不开放（2026-11-22）

- http://www.cec.zju.edu.cn/xwgl/list.htm：研究生教育 › 学位管理（10 条 / 842 总）
- http://www.cec.zju.edu.cn/bsszqkh/list.htm：研究生教育 › 博士生中期考核（10 条 / 28 总）
- http://www.cec.zju.edu.cn/xjgl_36132/list.htm：研究生教育 › 学籍管理（10 条 / 111 总）
- http://www.cec.zju.edu.cn/tjmsyjs/list.htm：本科生教育 › 推荐免试研究生（10 条 / 87 总）

/yjssz 与 /dwjl1 在 div.main-header 里自认的栏目地址分别是 /jdgz_36461、/zxxx_36164，说明请求的是父栏、渲染的是默认子栏。按「声明地址须等于请求路径」判为别名不一致，不开放。精确通路累计 342／418。

## 第五十五批：控制学院 cse 站补齐七栏、整站 12 栏全开（2026-11-22）

- http://www.cse.zju.edu.cn/39344/list.psp：评奖评优（20 条 / 744 总）
- http://www.cse.zju.edu.cn/39345/list.psp：勤工资助（20 条 / 360 总）
- http://www.cse.zju.edu.cn/39343/list.psp：学生党建（20 条 / 878 总）
- http://www.cse.zju.edu.cn/73393/list.htm：学生团建（20 条 / 153 总）
- http://www.cse.zju.edu.cn/xjgl/list.htm：学籍管理（19 条 / 19 总）
- http://www.cse.zju.edu.cn/39334/list.htm：学位管理（20 条 / 27 总）
- http://www.cse.zju.edu.cn/73491/list.htm：在职硕士（单证）·最新消息（20 条 / 42 总）

/39344、/39345、/39343 的 .htm 301 到同站 .psp，按 .psp 记录。至此该站 12 个目录路径全部开放。精确通路累计 349／418。

## 第五十六批：机械学院办公网补齐六栏、整站 12 栏全开（2026-11-22）

- http://me.zju.edu.cn/meoffice/6486/list.htm：党建与工会 › 学生党建（14 条 / 839 总）
- http://me.zju.edu.cn/meoffice/6492/list.htm：资产与安全 › 通知公告（14 条 / 51 总）
- http://me.zju.edu.cn/meoffice/6444/list.htm：研究生教育 › 学籍事务（14 条 / 45 总）
- http://me.zju.edu.cn/meoffice/zyxw/list.htm：研究生教育 › 专业学位（5 条 / 5 总）
- http://me.zju.edu.cn/meoffice/jxjypt/list.htm：学院简介 › 教育教学平台（2 条 / 2 总）
- http://me.zju.edu.cn/meoffice/sx/list.htm：实践教学 › 实习（14 条 / 22 总）

父栏路径全部取自各页实际面包屑（如 /meoffice/djygh、/meoffice/zcyaq），不是按编号猜的。精确通路累计 355／418。

## 第五十七批：历史学院 ls 站一个公开栏目（2026-11-22）

- https://ls.zju.edu.cn/65203/list.htm：学生思政 › 风采动态（14 条，CMS 62 条 / 5 页）

注意：清单标签写「学生思政」，页面标题是「风采动态」，且面包屑两级同路径（父级文字学生思政、末项文字风采动态）。首屏 14 条全部指向微信公众号外链。精确通路累计 356／418。

## 第五十八批：研工部两个公开栏目（2026-11-22）

- https://ygb.zju.edu.cn/31555/list.htm：通知公告（10 条 / 183 总）
- https://ygb.zju.edu.cn/31546/list.htm：奖助事务（3 条 / 3 总）

身份靠 div.position_dqwz 链路 + Column_Anchor；/31546 只有两级面包屑（父级即本路径），只校验末项与标题。精确通路累计 358／418，剩余未验证 16 行。

## 第五十九批：地球科学学院补两栏（2026-11-22）

- http://gs.zju.edu.cn/gsxx/list.psp：通知公告 › 公示信息（20 条 / 321 总）
- http://gs.zju.edu.cn/35056/list.psp：学院党政 › 通知公告（6 条 / 6 总）

/gsxx 与 /35056 都在「通知公告 / 学院党政」大类下，靠完整链路 + Column_Name + Column_Anchor 三重校验；目录 .htm 一律 301 到同站 .psp。精确通路累计 360／418，剩余未验证 14 行。

## 第六十批：管理学院讲座活动（2026-11-22）

- http://www.som.zju.edu.cn/xshd/list.htm：新闻中心 › 讲座活动（首屏 5 条 / CMS 1623 条 / 325 页）

该站每页只有 5 条（per_count=5），是所有已收录站里最少的；日期写成 [YYYY/MM/DD] 带方括号与斜杠。首屏 1 条为微信公众号外链。精确通路累计 361／418，剩余未验证 13 行。

## 第六十一批：电气学院官网讲座活动（2026-11-22）

- http://ee.zju.edu.cn/jzhd/list.htm：讲座活动（14 条 / 353 总 / 26 页）

该栏是一级栏目，面包屑只有本路径，属「末项路径 == 请求路径」即可成立的情形。注意 ee.zju.edu.cn（官网）与 ee.office.zju.edu.cn（办公网）是不同 host。精确通路累计 362／418，剩余未验证 12 行。

## 第六十二批：建筑工程学院学生工作（2026-11-22）

- http://www.ccea.zju.edu.cn/xsgz/list.htm：学生工作（14 条 / 18 总 / 2 页）

一级栏目单级面包屑，复用该院 ccea-li 解析器直接通过。精确通路累计 363／418，剩余未验证 11 行。

## 第六十三批：高分子学系独立站的默认子栏（2026-11-22）

- polymer.zju.edu.cn /36748/list.htm：清单标签「研究生教育」，页面「当前位置」末项却是「公告栏(/36753)」——请求父栏、渲染默认子栏。
- 按「末项路径须等于请求路径」判为别名不一致，不开放；未新增开放通路，`usable` 保持 363／418。
- 与 office.polymer.zju.edu.cn（办公网，已收录 5 栏）是不同 host。

## 第六十四批：生命科学学院 /clscn 学生活动（2026-11-22）

- http://www.cls.zju.edu.cn/clscn/79312/list.htm：招生 › 学生活动（10 条 / 35 总 / 4 页）

/clscn 子站每页 10 条，日期是 span.d（日）+ span.y（YYYY-MM）两段。首屏 10 条全为微信公众号外链。与办公网 www.cls.office.zju.edu.cn 是不同 host。精确通路累计 364／418，剩余未验证 9 行。

## 第六十五批：生工食品学院教学培养（2026-11-22）

- http://www.caefs.zju.edu.cn/68237/list.htm：教育教学 › 本科教育 › 教学培养（7 条 / 1 页）

与建筑工程学院同模板，复用 ccea-li 解析器；同时把该 host 加入白名单并放宽 guard。精确通路累计 365／418，剩余未验证 8 行。

## 第六十六批：环资学院渲染默认子栏（2026-11-22）

- www.cers.zju.edu.cn /cercn/rcpy/list.htm：面包屑把 /cercn/rcpy 唤作「招生教育」，末项却是 /cercn/xxgg「信息公告」。
- 属父栏渲染默认子栏，末项 ≠ 请求路径，标 identity-mismatch、不开放；`usable` 保持 365／418。
- 剩余未验证 7 行。

## 第六十七批：农生学院渲染默认子栏（2026-11-22）

- www.cab.zju.edu.cn /chinese/11141/list.htm：请求「研究生教育」，面包屑末项却是 /chinese/11167「最新通知」。
- 标 identity-mismatch、不开放；usable 保持 365／418。

处置后 418 行的分布：开放 365、别名不一致 44、容器页 3、需认证独立场景 2、已观察需授权 1、仅记录路径 1、未验证 2。仍缺结论的 host：bmsoa.zju.edu.cn、itc.zju.edu.cn、www.cps.zju.edu.cn、www.lit.zju.edu.cn、zdbk.zju.edu.cn。 【历史快照：结论已被后续轮次覆盖，当前为 0】

## 第六十八批：药学院无面包屑栏目的三重校验（2026-11-22）

- http://www.cps.zju.edu.cn/58875/list.htm：研究生教育（14 条 / 124 总 / 9 页），首屏开放。
- **该站完全没有面包屑**，身份改用页内三项证据：脚本 `var url` 自报地址（须等于请求路径）、顶部横幅 `span.cn`（须等于页面标题）、条目链接的 `c<栏目ID>a…` 前缀（须等于路径里的 ID）。
- 导航里 /61595 /61596 /61597 三个子栏清单未列，未验证、不扩基线。

处置后 418 行分布：开放 366、别名不一致 44、容器页 3、需认证独立场景 2、已观察需授权 1、仅记录路径 1、未验证 1。仍缺结论的 host：bmsoa.zju.edu.cn、itc.zju.edu.cn、www.lit.zju.edu.cn、zdbk.zju.edu.cn。 【历史快照：结论已被后续轮次覆盖，当前为 0】

## 第六十九批：人文学院官网无面包屑栏目（2026-11-22）

- http://www.lit.zju.edu.cn/rcpy/list.htm：人才培养（14 条 / 36 总 / 3 页），首屏开放。
- 与 literature.zju.edu.cn（文学院办公网）是不同 host、不同模板。
- 无面包屑，身份用页面自报地址 + 导航项文字 + 条目栏目 ID 唯一 三重校验。
- 该栏日期只到月（2026-10），按当月 1 日归档并标 month-only，不伪装成精确日。

处置后 418 行分布：开放 367、别名不一致 44、容器页 3、需认证独立场景 2、已观察需授权 1、仅记录路径 1、未验证 0。仍缺结论的 host：bmsoa.zju.edu.cn、itc.zju.edu.cn、zdbk.zju.edu.cn。 【历史快照：结论已被后续轮次覆盖，当前为 0】

## 第七十批：基础医学系办公网内部公示（2026-11-22）

- https://bmsoa.zju.edu.cn/85937/list.htm：信息公开 › 内部公示（6 条 / 1 页），首屏开放。
- HTTP 301 到同站 HTTPS；与建筑工程学院同模板，复用 ccea-li，并把 https + bmsoa 加入白名单。
- 该页虽含登录入口，但**列表本身公开可读**，不属于需授权场景。

处置后 418 行分布：开放 368、别名不一致 44、容器页 3、需认证独立场景 2、已观察需授权 1、仅记录路径 0、未验证 0。仍缺结论的 host：itc.zju.edu.cn、zdbk.zju.edu.cn。 【历史快照：结论已被后续轮次覆盖，当前为 0】

## 第七十一批：两个认证场景收口（2026-11-22）

清单里最后两条缺结论的路径，本轮全部取证并归为「认证后可访问的独立场景」：

**itc.zju.edu.cn /90618/list.htm**（信息技术中心通知公告）
- https://itc.zju.edu.cn/90618/list.htm -> 301 http://itc.zju.edu.cn/90618/list.psp
- http://itc.zju.edu.cn/90618/list.psp -> 301 https://itc.zju.edu.cn/90618/list.psp
- https://itc.zju.edu.cn/90618/list.psp -> 302 https://zjuam.zju.edu.cn/cas/login

**zdbk.zju.edu.cn /jwglxt/xtgl/xwgl_cxXwListAlltzgg.html**（教务通知公告，清单挂两个标签）
- https://zdbk.zju.edu.cn/jwglxt/xtgl/xwgl_cxXwListAlltzgg.html -> 302 https://zdbk.zju.edu.cn/jwglxt/xtgl/login_slogin.html

两者终点都是登录页，未持凭据故不计入公开通路；跳转链逐跳记录，便于日后持凭据时直接接续。

**至此 418 行全部带有明确处置结论**：开放 368、别名不一致 44、容器页 3、需认证独立场景 3、已观察需授权 undefined，未验证与仅记录路径均为 0。

## 当前分发（2026-11-22 复核）

上述「处置后 418 行分布」是**逐轮进度快照**，最新一条（开放 368、未验证 0、仅记录路径 0）才是当前状态。仍需认证的独立场景 3 条（zdbk 通知、itc 通知等）与容器页 3 条已逐一定性，**不存在无结论的悬挂项**。
