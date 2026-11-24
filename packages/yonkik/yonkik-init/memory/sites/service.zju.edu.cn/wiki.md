# 浙大服务平台 / 我的浙大（service.zju.edu.cn）

> ⚠️ **2026-11-20 晚实测：`s.zju.edu.cn`（百事通）已 502 不可用，本页的 `guide`/`faq`/`hot` 三 op 随之失效。**
> 替代方案见本页下方「服务目录 + 事项详情链路」及 `chain.mjs`。

## 本页索引

<!-- yonkik:toc -->
> 按节读，不要整篇加载：grep -n "^## <标题>" wiki.md 取行号，只读那一节。

- 概览
- 鉴权
- 限流
- 接口（详见 endpoints.json）
- 服务目录实况（2026-11-20 实测 49 项）
- 办事指南免登录检索（本页最高价值）
- CC98 主张的实测验证（本组核心交付）
- 坑
- 脚本用法
- 脚本用法（crawler.mjs）
- 本次探了什么 / 还剩什么

---
## 概览

`service.zju.edu.cn` 是浙大的**办事服务总门户**（苏迪 Sudytech 系，`/_s2/*.psp` + `/_web/customized/*` + lightapp `*.rst`）。
首页 `/` **302 到 zjuam CAS**，登录后是「我的浙大」个人工作台。

**但它的两条公开面都不需要登录，这才是重点：**

| 能做什么 | 入口 | 要登录吗 |
|---|---|---|
| **查服务目录**（学校有哪些系统/办事应用） | `GET /mobile/loadServiceApps.rst?parentCategoryId=36` | **不要** |
| **搜办事指南**（某证明怎么办、在哪个窗口、电话、材料） | `https://s.zju.edu.cn/search/workGuide.do?words=…` | **不要** |
| 查事项详情（受理机构/材料清单/流程/常见问题） | `/_web/customized/serviceCenter/detailnew.html?id=<数字id>` | **不要** |
| 查办事大厅窗口电话表 / 自助服务点 | `/_s2/anonymous_fwzn/main.psp`、`/_s2/anonymous_zzfw/main.psp` | **不要** |
| 看我的待办 / 提申请 / 收藏评价 | 登录后的工作台 | 要（campus-sso） |

**一句话：办事「怎么查」全公开，办事「怎么交」才要登录。** 对「预备资产」而言公开面已经够用——学生问「XX 证明怎么办」，不登录就能给出窗口号、电话、受理时间、材料清单。

同源的 `xwfw.zju.edu.cn` 是本站的别名（整站 301 过来），不是独立系统。

## 鉴权

- 站点 `/`：302 → `https://zjuam.zju.edu.cn/cas/login?service=https%3A%2F%2Fservice.zju.edu.cn%2F`（zjuam CAS，凭据键 `campus-sso`）。
- **CAS 验证码当前关闭**：`GET https://zjuam.zju.edu.cn/cas/v2/getKaptchaStatus` → `false`（2026-11-20 实测）。
- **公开面全免登录**，且**不需要任何 cookie** —— 实测裸请求（无 JSESSIONID）`/mobile/loadServiceApps.rst` 直接 200 返回完整 31KB 数据。
- 搜索枢纽 `s.zju.edu.cn` 是**独立 host**，同样免登录（页面上虽有「登录」链接，但检索结果本身公开）。

## 限流

- `robots.txt` → 404，但返回的是「访问无权限」HTML 页（1178B，非标准 404 页）。
- 响应头无 `X-RateLimit-*` / `Retry-After`。
- 按保守默认：**串行、间隔 ≥2s、并发 1**。本次全程未触发 429。

## 接口（详见 endpoints.json）

九条 verified，全部 GET、全部免登录：

| 接口 | 用途 |
|---|---|
| `/mobile/loadServiceApps.rst?parentCategoryId=36` | **服务目录全量**（49 项，含 appUrl 直链） |
| `/mobile/getPortalCenterTermByStrategy.rst` | 分类词表（服务对象 10 / 办理模式 3） |
| `/_web/customized/serviceCenter/detailnew.html?id=<n>` | 事项详情（材料/流程/窗口/电话） |
| `/_s2/anonymous_fwzn/main.psp` | 办事大厅 24 窗口电话表 + 管理办法全文 |
| `/_s2/anonymous_zzfw/main.psp` | 6 校区自助服务点位置与时间 |
| `s.zju.edu.cn/search/all.do?words=` | 百事通统一搜索（跨 7 库） |
| `s.zju.edu.cn/search/workGuide.do?words=&pageNo=` | **办事指南检索**（带受理时间/机构/电话） |
| `s.zju.edu.cn/search/faq.do?words=` | 常见问题检索 |
| `s.zju.edu.cn/hotsearch/hotWorkGuide.do?count=N` | 热点办事指南排行 |

### loadServiceApps.rst 参数语义（不看清会以为「接口没数据」）
- **`parentCategoryId=36` 是唯一有效的根分类**。传空串、17、11、35 全部回 `data:[]`（看着像没权限，其实只是参数不对）。
- `appName` 是可选的模糊搜；搜不到时返回**带空 appList 的分类壳**（如 `[{categoryId:13, categoryName:'教育教学', appList:[]}]`），不是空数组——别把它当成「该分类无服务」。
- 响应 31KB / 49 个应用，字段含 `appUrl`（真实系统地址）、`appDetail`（一句话简介）、`clickNum`、`favoritesCount`、`isAllow`。

### detailnew.html 的参数坑
- 参数名是 **`id`（数字 appId）**，**不是 `dataId`**。
- 传 `dataId=Z1606` 时页面**不报错**，而是静默回退渲染默认事项（实测返回「在校本科生出国成绩单开具」），极易误以为查到了。
- 还需要带 `_p=YXM9MiZ0PTUmZD0yMzAmcD0xJmY9NDAxJm09TiY_`（base64 解出 `as=2&t=5&d=230&p=1&f=401&m=N&?`）。

## 服务目录实况（2026-11-20 实测 49 项）

按分类（`parentCategoryId=36` 一次取全）：

**办公办事（12，22 项）**：协同办公系统、财务综合平台、仪器设备管理、导师资格审核、科研服务系统、电子签章、分析测试管理、材料与化学品采购、就业指导、**教室资源管理系统**、浙大植物、全流程电子化采购、人力资源服务与管理、远程查档预约、档案馆门户、人才招聘网、实验室安全管理、年度考核、用户自注册、外事工作服务、组织工作数字化、乐龄人才。

**教育教学（13，12 项）**：学在浙大、智云课堂、教师个人主页、研究生教育管理信息系统、**现代教务管理系统（zdbk）**、三全育人 ETA、教在浙大、公共体育立体化、研究生新生服务网、招生系统、一站式科研导航、浙小本找导师。

**浙大生活（16，8 项）**：**班车查询**、后勤服务、幼教服务、家具管理、校史馆参观预约、心理健康教育与咨询中心、公用房资源管理、校园数字医疗。

**实用工具（35，7 项）**：浙大云盘、浙大百事通、浙大图库、住房公积金查询、心理服务系统、学术数据管理平台、找教授。

**资源（14）/ 工具（15）**：当前 0 项（空分类保留）。

> 注意：这是**系统级应用目录**（一个应用=一个业务系统），不是「事项级」的办事清单。
> 事项级清单在 `s.zju.edu.cn` 的办事指南库里（`workGuide.do`）。两者别混。

## 办事指南免登录检索（本页最高价值）

`s.zju.edu.cn` 是浙大百事通，把校务信息库切成 7 个检索域，**全部免登录**：

```
/search/all.do?words=         全部（跨域聚合）
/search/faq.do?words=         常见问题
/search/workGuide.do?words=   办事指南   ← 找「某事怎么办」用这个
/search/addrBook.do?words=    通讯录
/search/normFile.do?words=    规范性文件
/search/schoolFile.do?words=  学校文件
/search/info.do?words=        资讯
```

`workGuide.do` 每条结果给你的字段（这是「办事指南」的真正价值）：

```
事项名（带 data_ZNNNN 事项编号）
受理时间: 工作日周一至周四 8:30-12:00,13:30-17:30；周五 …
监督电话: 0571-88981617
咨询电话: 0571-88981234
受理机构: 紫金港校区行政服务办事大厅111室第7、8号窗口
受理地方: （同上）
[点击详情] → 直达 infoplus 表单或 detailnew 页
```

**实例（2026-11-20 实抓，搜「证明」＝54 项 / 6 页）**：

| 事项 | 受理机构 | 电话 |
|---|---|---|
| 研究生毕业证明书/肄业证明/学习证明办理 | 办事大厅111室 7、8 号窗口（研究生院） | 88981234 |
| 本科毕业证明、学位证明办理 | 111室 10、11 号本科生院窗口 | 88206189 / 88981221 |
| GPA算法证明开具 | 111室 10、11 号本科生院窗口 | 88206189 |
| 学分转换证明 | 111室 10、11 号本科生院窗口 | 88206189 |
| 在职教职工在职证明（中文） | 115室 24 号人事处窗口 | 88981600 |
| 在职教职工在职收入证明（中文） | 115室 23、24 号人事处窗口 | 88981600 / 88981643 |
| 学生户籍证明办理（咨询） | 紫金港东四教学楼公安综合服务大厅 | 87281304 |
| **在校学生现实表现证明办理（政审）Z1606** | **111室 安保处 14 号窗口** | **88206065** |

> 最后一行直接证实了 CC98 的说法：**「在校表现证明」确实归安保处（安全保卫处）窗口**，流程里要过安保处审核。

## CC98 主张的实测验证（本组核心交付）

| # | CC98 主张（帖子 id） | 实测（2026-11-20） | 判定 |
|---|---|---|---|
| 1 | 5106751「快毕业了，才发现好多**证明**的办理流程可以在**校务服务网**上查到」 | `s.zju.edu.cn/search/workGuide.do?words=证明` 免登录回 **54 项**办事指南，每条含受理时间/机构/窗口/咨询+监督电话。`xwfw` 整站 301 到 `service.zju.edu.cn/_s2/cs_bszx/main.psp`——**校务服务网 = service 的别名** | ✅ 证实（且比帖子说的更强：连登录都不用） |
| 2 | 5555500「考生**在校表现证明**是不是校务服务网这个『校学生现实表现证明办理』」（回复称要过**安保处**审核、审核完发短信） | 搜到事项「**浙江大学在校学生现实表现证明办理（政审）**」，事项编号 **Z1606**，受理机构「**行政服务办事大厅111室安保处14号安保处窗口**」，咨询电话 **88206065**。FAQ 同时给另一条：学生无犯罪记录证明申请受理 **Z0287**，也与安保处同号 | ✅ 证实（安保处窗口确证） |
| 3 | 5612576「在**校务服务网**上**借教室**后要退怎么做」 | 办事指南搜「借用教室」回 4 项，首项即「**学生教室借用申请**」：受理机构 **本科生院**，咨询 **88981122**，监督 **88208618**，受理时间工作日 8:30-12:00/13:30-17:30。服务目录里另有「**教室资源管理系统**」（id=206, jxzygl.zju.edu.cn） | ✅ 证实（借教室确在 service 体系；退借须走本科生院窗口/系统） |
| 4 | 5170632「为了打卡每天和**浙大校务服务**聊天」（对话式入口/机器人） | 首页搜索区确有「**对话**」按钮（原「站内搜索」，JS 注释原文：「站内搜索按钮已改成『对话』按钮——直接跳转即可」），跳 `params.linkUrl`。**对话是独立入口，不在 service 域内**，未进一步打开 | ⚠️ 部分证实（有对话入口，未验证其对话能力/打卡机制） |
| 5 | 6544073「浙大钉电子校园卡升级，改用钉钉小程序，（据说）白色刷卡机支持无网支付」 | 服务目录**不含**校园卡/电子校园卡类应用；类目里只有「后勤集团（校园卡）」作为办事大厅 20 号**窗口**。电子校园卡是**钉钉侧**能力，不在 web 端 | ⛔ 本组无法验证（属钉钉客户端，web 无对应入口） |
| 6 | 5342846「**校务服务网**办理**研究生请假**后如何销假」 | 办事指南搜「请假」回 2 项，首项「**研究生请假手续办理**」：办理模式 **线上办理**，咨询 **88208146**，监督 **88981400**。即请假确实线上办；**销假不在指南里**（指南只覆盖「办」不覆盖「销」） | ⚠️ 半证实（请假线上办已证实；销假流程无公开指南，需问研究生院） |
| 7 | 4898634「**已毕业**还收到**校务服务网**待办提醒」 | 待办属登录区（未登录未验证）。但可解释：service 工作台待办与「协同办公 OA」（`oa.zju.edu.cn/SFYZServer?outsideSign=zhfwwtodolist`）联动，账号未注销/流程未办结则持续推待办 | ⚠️ 机制可信，未登录验证 |

**附：其他实测到的办事事项（同为免登录可查，供预备资产用）**

| 事项 | 受理机构/地点 | 电话 |
|---|---|---|
| 研究生毕业证明书 / 肄业证明 / 学习证明办理 | 办事大厅111室 7、8 号窗口（研究生院） | 88981234 / 88981221 |
| 本科毕业证明、学位证明办理 | 111室 10、11 号本科生院窗口 | 88206189 / 88981221 |
| 本科毕业证明书、学位证明书**补办** | 111室 10、11 号本科生院窗口 | 88206189 / 88981221 |
| GPA算法证明开具 | 111室 10、11 号本科生院窗口 | 88206189 |
| 学分转换证明 | 111室 10、11 号本科生院窗口 | 88206189 |
| 交流证明（含未进行学分转换） | 111室 10、11 号本科生院窗口 | 88206189 / 88981221 |
| 自考毕业生毕业证明及成绩证明申请 | 继教处学历办（紫金港图书信息C楼10层） | 88981102 |
| 在职教职工在职证明（中文） | 115室 24 号人事处窗口 | 88981600 |
| 在职教职工在职收入证明（中文） | 115室 23、24 号人事处窗口 | 88981600 / 88981643 |
| 学生户籍证明办理（咨询） | 紫金港东四教学楼公安综合服务大厅 / 各校区派出所 | 87281304 |
| 校园卡系统商户设备租借用服务 | 办事大厅111室信息技术中心 / 玉泉图书馆702 等 | 88206106 / 88273319 |

## 脚本用法（crawler.mjs）

`sites/service.zju.edu.cn/crawler.mjs` —— 5 个只读 op，**全部免登录，无需 state.json**。

```bash
node crawler.mjs --list
node crawler.mjs apps                       # 服务目录全量 49 项（6 分类）
node crawler.mjs apps --search 班车          # 按名称/简介过滤
node crawler.mjs apps --category 浙大生活    # 按分类过滤
node crawler.mjs guide --words 证明          # 办事指南（54 项 / 5 页）
node crawler.mjs guide --words 证明 --all    # 全量翻页（上限 20 页）
node crawler.mjs detail --id 206             # 事项详情（206=教师资源管理系统）
node crawler.mjs hot --count 31              # 热点指南 30 条（含表单直链）
node crawler.mjs faq --words 借教室          # 常见问题（56 项）
```

| op | 底层接口 | 已验证 |
|---|---|---|
| `apps` | `GET /mobile/loadServiceApps.rst?parentCategoryId=36` | ✅ 6 分类 / 49 应用 |
| `guide` | `GET s.zju.edu.cn/search/workGuide.do` | ✅ 「证明」54 项 / 5 页，字段解析正确 |
| `detail` | `GET /_web/customized/getServiceAppDetail.jsp?appVersionId=`（JSONP） | ✅ 返回 40+ 字段 |
| `hot` | `GET s.zju.edu.cn/hotsearch/hotWorkGuide.do` | ✅ 30 条 |
| `faq` | `GET s.zju.edu.cn/search/faq.do` | ✅ 「借教室」56 项 |

### 【重要更正】事项详情的真接口不是 detailnew.html

本 wiki 早前记「`detailnew.html?id=<数字>`」为事项详情入口 —— **实测该页是纯前端空壳**：
服务端恒渲染同一个默认事项（「在校本科生出国成绩单开具」，事项编号写着占位符 `dddd`），
**无论 `id` 传 483/546/206/2112 都返回同一内容**，且 `dataId`/`serviceId`/`appId` 参数一律被忽略。

真接口是：
```
GET /_web/customized/getServiceAppDetail.jsp
    ?callback=cb          # 必须，走 JSONP（页面用 dataType:'jsonp'）
    &appVersionId=483     # 参数名叫 appVersionId，但**值要传 appId**（不是 appVersionId）
    &_p=<PTOKEN>          # 门户上下文，缺了会 403
```
返回 `{result:'1', data:{...}}`，字段远超列表页：
`appName/appType/serviceMode/applyUserScope/responsibleDept/contactUser/contactPhone/handleTime/handleAddress/entranceUrl/isOpen/favoritesCount/starPoints/fileList/jbxx(基本信息)/sltj(受理条件)/sqcl(申请材料)/fwyj(服务依据)/fwfs(服务方式)/tbcx(投诉查询)/cjwt(常见问题)`。

**`PTOKEN` 是 `YXM9MiZ0PTUmZD0yMzAmcD0xJmY9NDAxJm09TiY_`**（base64 解出 `as=2&t=5&d=230&p=1&f=401&m=N&?`）。

### 解析注意（都已内置在 crawler.mjs）
1. **办事指南条目名要剥 `<div ... id="data_ZNNNN">` 开标签**，否则会得到 `id="data_Z0105">研究生毕业证明书…` 这种脏标题。
2. **命中数的数字被 `<span>` 包着**：页面是 `约有 <span>54</span> 项符合`，只匹配裸数字会得到 null。
3. **总页数没有「最后」文本**，要从 `searchPage(N,searchData)` 的出现值取最大值。
4. **FAQ 页结构与办事指南完全不同**：FAQ 用 `<dd class="D3">` + `<em>问</em>`/`<em>答</em>`，
   按 `dd class="D2"` 抓会得到 0 条（看着像「没结果」）。

## 坑

1. **`parentCategoryId` 只认 36。** 传别的值（17/11/35/空）都回 `data:[]`，看起来像「没权限/没数据」，其实只是参数不对。这是本站最容易误判的一条。
2. **`detailnew.html` 的参数是 `id` 不是 `dataId`**，且传错参数**不报错**而是静默渲染默认事项——会让人拿到错误的事项内容。
3. **`/_s2/anonymous_bszx/main.psp` 已经死了**（返回「访问地址无效，anonymous_bszx找不到对应的栏目！」），但 **`s.zju.edu.cn` 的 FAQ 仍在把学生导向这个死链**（原文：「可在浙大服务网站（https://service.zju.edu.cn/_s2/anonymous_bszx/main.psp）中搜索…」）。
4. **`/_web/customized/loadServiceApps.jsp` 和 `getServiceAppDetail.jsp` 是废弃老接口**，页面 JS 里还留着但实测恒错（`result:'0'`）。真接口是 `/mobile/*.rst`。别照着页面 JS 抄。
5. **服务目录 ≠ 办事事项清单。** `loadServiceApps.rst` 给的是「系统级应用」（学在浙大、教务系统…），`s.zju.edu.cn` 给的是「事项级指南」（怎么办某个证明）。分开查。
6. **办事指南条目名里的关键词被 `<font color='red'>` 包着**（搜索高亮），不加处理会把 HTML 标签带进结果里。
7. **`s.zju.edu.cn` 是独立 host，不是 service 的子路径。** 别拼成 `service.zju.edu.cn/s/search/...`。
8. **页面文字搜不到 ≠ 没这个事项。** 事项编号（Z1606/Z0287/Z1899…）比事项名更稳，FAQ 里常直接给编号；用编号去 `workGuide.do` 或 `detailnew.html` 更准。

## 脚本用法

站点无 `crawler.mjs`（本组资产以 `endpoints.json` + 本 wiki 为准；接口全是简单 GET，无需封装）。手工调用：

```bash
# 服务目录全量
curl -s 'https://service.zju.edu.cn/mobile/loadServiceApps.rst?parentCategoryId=36&categoryId=&orgId=&modeId=&appName='

# 办事指南检索
curl -s 'https://s.zju.edu.cn/search/workGuide.do?words=%E8%AF%81%E6%98%8E'

# 事项详情（483 = 班车查询）
curl -s 'https://service.zju.edu.cn/_web/customized/serviceCenter/detailnew.html?id=483&_p=YXM9MiZ0PTUmZD0yMzAmcD0xJmY9NDAxJm09TiY_'
```

## 本次探了什么 / 还剩什么

**已探（done）**：服务目录全量 49 项、分类词表、事项详情页、办事大厅窗口电话表全文、6 校区自助服务点、百事通 7 个检索域、办事指南「证明」类 54 项实证、FAQ 交叉验证「在校表现证明归安保处」。

**未探（unverified）**：
- **登录区**（我的待办、申请提交、收藏、评价）——本次未登录 CAS。服务目录与指南全公开，登录区对本任务无增量；如需待办清单再补。
- `_web/customized/getServiceAppDetail.jsp` 的正确参数名——未确定，已用 detailnew.html 替代。
- 事项附件下载（`/_web/customized/getFile.jsp`）——未验证。

## 【2026-11-20 实测】`s.zju.edu.cn`（浙大百事通）已不可用，办事指南检索随之失效

- **现象**：`http://s.zju.edu.cn/` 恒返回 **502 且 0 字节无响应头**；`https://s.zju.edu.cn/` 三个端点全部 **ECONNRESET**。
  连续 3 轮探测结果一致，非偶发。对照组同时刻 `service.zju.edu.cn` 200/31KB、`zjuam.zju.edu.cn` 200，
  说明不是本机网络或代理问题。
- **定性**：DNS 解析到内网 `10.203.9.28`（校内段），TCP 443/80 都 **open**，但 HTTP 层 502 ——
  这是**后端应用挂了、nginx 还在**的典型形态，不是 DNS 故障也不是防火墙拦截。
- **影响面**：
  - `sites/service.zju.edu.cn/wiki.md` 里「办事指南免登录检索（本页最高价值）」一节**当前不可用**；
    它的 `guide` / `hot` / `faq` 三个 op（`s.zju.edu.cn/search/*` 与 `/hotsearch/*`）现在都会失败。
  - 该 wiki 里实证的办事指南内容（「证明」54 项、Z1606 归安保处等）**仍然有效**——
    那些是 2026-11-20 同日早些时候抓到的，只是现在无法重新拉取。
- **不是我校搞错**：`service.zju.edu.cn` 站内的搜索组件（苏迪 `appcentersearch` widget）
  至今仍在 JS 里**硬编码指向这 7 个 `s.zju.edu.cn/search/*` 端点** —— 学校自己的前端也没适配。
  这说明是**站点侧持续故障**，不是改名迁移。
- **替代路径（已验证可用）**：走 `service.zju.edu.cn` 的服务目录 + 事项详情，
  能看到 49 个应用各自的**真实业务系统地址（entranceUrl）+ 负责部门 + 咨询电话 + 申请材料数**。
  脚本：`node sites/service.zju.edu.cn/chain.mjs find <关键词>`。
  这条链路**不依赖 `s.zju.edu.cn`**，是目前唯一的办事入口来源。
- **复检方法**：下次做办事相关任务前先打一发 `curl -sS -o /dev/null -w '%{http_code}' http://s.zju.edu.cn/`，
  返回 200 即恢复，可回到 `guide`/`faq` op；仍是 502 就走 `chain.mjs`。
- **教训**：
  - 内网站点「TCP 通 + HTTP 502」= 应用层故障，别误判成「网络不给访问」或「站被下线」。
  - **依赖单点接口的资产要有一条不依赖它的替代路径**。本库的 `guide` op 全押在 `s.zju.edu.cn` 上，
    这次它一挂，办事指南能力就整块没了。已补 `chain.mjs` 作为替代。
