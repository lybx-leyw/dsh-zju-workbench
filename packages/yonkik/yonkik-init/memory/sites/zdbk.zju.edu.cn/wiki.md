# 教务网（本科）zdbk.zju.edu.cn

## 本页索引

<!-- yonkik:toc -->
> 按节读，不要整篇加载：先看标题，再 grep -n "^## <标题>" wiki.md 取行号，只读那一节。

- 入口
- 鉴权（重要：本体没有账号密码表单）
- 接口（全部已验证，200）
- 内容结构（2026-11-19 观测）
- 限流
- 脚本
- 登录区（2026-11-19 二次探索，已验证）
- 未探候选（下次从这里接）
- 一证多站

---
**状态：done（2026-11-19 二次探索）** —— 公开通知区 + **登录区（学籍/成绩/培养方案/毕业自审）**均已探通。选课退课等写操作按安全契约不实现。

系统身份：浙江大学**本科教学管理信息服务平台**，正方软件 zfsoft `jwglxt`，服务端 Tengine/2.1.2 + Tomcat。
- 功能码总表（67 个）与课表/考试接口（2026-11-22 补）

## 入口
- 根 `https://zdbk.zju.edu.cn/` → 68 字节 meta refresh → `/jwglxt` → 302 `/jwglxt/` → 302 `/jwglxt/xtgl/login_slogin.html`。
- 全部业务都挂在 **`/jwglxt`** 前缀下（`_path = "/jwglxt"`）。

## 鉴权（重要：本体没有账号密码表单）
- 登录页只有一个 **`#ssodl`「统一身份认证」按钮** + 「访客登录」标签页。**不存在学号/密码输入框**，所以「抓表单 POST 账密」这条路在本站不成立。
  - SSO 按钮流程：`POST /jwglxt/xtgl/login_cxSsoLoginUrl.html` → `{status:'success', ssologinurl:'https://zjuam.zju.edu.cn/cas/login?service=…'}` → 浏览器跳 CAS。
  - 另有独立登录通道 `GET /jwglxt/xtgl/login_getPublicKey.html`（返回 `{modulus, exponent}`）→ 前端 `loginV2022.js` 用 RSA 加密 `#mm` 再 submit `#loginForm`。这个表单在正常浏览器访问下**不渲染**，供特殊入口/移动端用。
  - 结论：登录必须让浏览器走完 CAS（`campus-sso` 一卡通），纯 HTTP 手搓 RSA 不划算。**本次未登录也不需要**——通知公告是登录前公开区。
- **公开只读区**：通知公告列表/详情在**未登录**时完全可读（只需 JSESSIONID）。这是本 wiki 最有价值的部分。

## 接口（全部已验证，200）
Base `https://zdbk.zju.edu.cn`，带 `X-Requested-With: XMLHttpRequest`。

| 接口 | 方法 | 用途 |
|---|---|---|
| `/jwglxt/xtgl/xwck_cxMoreLoginNews.html?doType=query&time=0` | **POST** | 通知公告分页列表（真分页） |
| `/jwglxt/xtgl/login_cxLoginNews.html?mxb_id=newsnotice` | GET | 登录页 6 条置顶 HTML 片段 |
| `/jwglxt/xtgl/xwck_ckLoginNews.html?xwbh={id}&doType=save` | GET | 通知正文；部分条目 302 到外部站点 |
| `/jwglxt/xtgl/login_getPublicKey.html?time={ts}` | GET | RSA 公钥（登录用） |
| `/jwglxt/xtgl/login_cxSsoLoginUrl.html` | POST | 取 CAS 登录 URL |

### 列表分页的坑（必读）
```
POST /jwglxt/xtgl/xwck_cxMoreLoginNews.html?doType=query&time=0
Content-Type: application/x-www-form-urlencoded

queryModel.showCount=20&queryModel.currentPage=1&queryModel.sortName=sfzd%20desc,fbsj&queryModel.sortOrder=desc
```
- **必须 POST + `queryModel.*` 参数名**（来自 `jquery.jqgrid.settings.js` 的 `prmNames`）。
- GET 加 `page=/rows=/sidx=/sord=` 也返回 200，但**分页被忽略**：每页固定回 10 条、翻页仍是第 1 页，容易被误判成「站点只有 10 条」。实测 GET 63KB 的响应里 `currentPage` 永远是 1。
- 响应：`{totalCount, totalPage, pageSize, currentPage, items[]}`；item 字段 `xwbh`(编号) `xwbt`(标题) `xwfbr`(发布单位/人) `fbsj`(发布时间) `sfzd`(1=置顶) `fbdz`(外链字段；**本次 60/60 条全为空**，外链不在列表里，见下) `fbnr`(正文 HTML，列表里就带全文摘要)。
- `rows` 生效（决定 totalPage），但回显的 `pageSize` 恒为 15，别拿它算页数。
- 全站 575 条通知（2026-11-19），置顶 6 条固定占据首屏，实际新增要看非置顶段。

### 详情 302 的两种外链（列表 fbdz 字段全空，外链只能靠详情时的服务端 302 发现）
- 部分条目 `xwck_ckLoginNews.html` 直接 302：
  - `→ /kszx/login/xwxx/ckXwxx.zf?xwbh=…`（四六级口语提醒，可正常读）
  - `→ https://bksy.zju.edu.cn/2026/1030/c28350a3220964/page.htm`（课堂教学质量评价，**本机 TLS 握手被重置 / 不可达**，属校外网络限制，校内网应可访问）。

## 内容结构（2026-11-19 观测）
- 发布方主力：本科生院、教务处、外国语学院、各学院教务员（个人署名，如「<姓名>」）。
- 高频类型：选课通知（每轮一篇）、英语水平测试报名、四六级、考试安排、停开课通知、全英文课程选课、推免/辅修。
- 典型时点：选课通知集中在学期初；考试安排在期中；英语水平测试每学期 2 次（报名→口试）。

## 限流
- 响应头无 `X-RateLimit-*`；`/robots.txt`、`/jwglxt/robots.txt` 都不存在（302 回登录页）；全文未见自动化条款。
- 沿用保守默认：**串行 ≥2.2s、并发 1**。本次全程串行，0 次 429。

## 脚本
- `crawler.mjs` — `news --page N --rows M`（列表）/ `detail --id <xwbh>`（正文）。基于 `lib/http.mjs`，自动限流。
- 探索期工具：`probe.mjs`（任意路径转储）、`dump.mjs`（落盘 HTML/JS）、`collect2.mjs`（多页 POST 分页落盘）、`list-all.mjs`（打印已落盘列表）、`detail2.mjs`（跟随 302 抓正文）、`parse-news.mjs`（摘要字段）。

## 登录区（2026-11-19 二次探索，已验证）

### 登录怎么做（唯一可行路径）
`/jwglxt/xtgl/login_slogin.html` 只有 `#ssodl` 一个入口 → `POST /jwglxt/xtgl/login_cxSsoLoginUrl.html` → 跳 `zjuam.zju.edu.cn/cas/login?service=…%2Fjwglxt%2Fxtgl%2Flogin_ssologin.html` → 填 `#username`/`#password` 点 `#dl` → 回 `/jwglxt/xtgl/index_initMenu.html?jsdm=06`。
- **本次实测 CAS 登录页 `#authcode`/`#yzmPic` 均不存在（验证码关闭）**，账密直登成功。若日后开启，先 `#yzmPic` 截图走视觉识别，多次失败再请用户。
- 凭据 `campus-sso`（键一=学号，键二=密码）。登录脚本：`login.mjs`。
- 成功后 cookie 含 `iPlanetDirectoryPro`、`_csrf`、`JSESSIONID`(两域)、`JSESSIONTOKEN`、`_pv0/_pf0/_pc0`。

### ⚠️ 本页最重要的坑：lib/http.mjs 的 CookieJar 拿不住本站会话
用 `createClient('zdbk.zju.edu.cn')` 打登录区接口一律失败：**GET → 302 回 login_slogin；POST → 901**。
原因：本站同一路径下存在**两个同名 JSESSIONID**（`zdbk.zju.edu.cn/jwglxt` 与 `/jwglxt/xtgl`），而 `lib/cookies.mjs` 的 `#put` 键是 `domain|path|name`，importStorageState 又把所有 cookie 的 `hostOnly` 强制设为 false，导致同名同域不同 path 的会话被写进同一个 jar 键互相覆盖，最终 `headerFor` 只送出一份或送错一份。
**结论：登录区一律走 playwright 上下文（`ctx.request` 或页面内 `fetch`），cookie 由浏览器自己管。** 公开通知区不受影响（只需单份 JSESSIONID）。

### 接口（全部 verified，需登录态）
Base `https://zdbk.zju.edu.cn`，带 `X-Requested-With: XMLHttpRequest`。

| 用途 | 方法 | 路径 | 关键参数 |
|---|---|---|---|
| 功能菜单（功能码表） | GET | `/jwglxt/xtgl/index_initMenu.html?ignoreZoom=1` | — |
| 学籍信息 | GET | `/jwglxt/zxzygl/zxzyqr_cxZxzyxsxxIndex.html?gnmkdm=N3015` | 页面直出表单 |
| **成绩查询** | POST | `/jwglxt/cxdy/xscjcx_cxXscjIndex.html?doType=query&gnmkdm=N5083` | `xnm/xqm/'queryModel.showCount'` |
| **培养方案列表** | POST | `/jwglxt/pyfagl/pyfaxxcx_cxPyfaxscxIndex.html?doType=query&gnmkdm=N153020&su={学号}` | `synj`(年级) `xydm` `gjzydm` `zydm` `dlbs` `jxjhh` + `queryModel.*`(sortName=`synj desc, xymc, jxjhh`) |
| **培养方案 PDF** | GET | `/jwglxt/pyfagl/pyfayl_cxPyfaylPdf.html?id={pyfaxx_id}&doType=query` | 返回 `application/pdf` |
| **毕业资格自审** | POST | `/jwglxt/bysh/byshck_cxByshzsIndex.html?doType=query&gnmkdm=N6025&su={学号}` | `queryModel.showCount=10000` |
| 自审-提交审核 | POST | `/jwglxt/bysh/byshck_xszsBysh.html?gnmkdm=N6025&su={学号}` | `doType=submit` → `{taskid,status:RUNNING}`，再 `doType=status&taskid=…` 轮询 / `doType=cancel` |
| 自审-模块设置 | POST | `/jwglxt/bysh/bysh_cxByshmkbj.html?gnmkdm=N6025&su={学号}` | `xh={学号}`，弹窗选「本专业进阶/跨专业学习/学生自主修读」 |

### 登录区坑（必读）
1. **培养方案列表必须 POST**，且 `synj` 是**年级**（如 2025）不是当前学年。GET 只拿到渲染壳。
2. **`pyfaxx_id` 不一定是「年份+教学计划号」拼接**：有的专业是 `2025090420250921` 这种拼接，有的专业是纯数字形式的方案号。别用规律构造，从列表响应取。
3. **培养方案预览走 pdfjs viewer**：前端 `$.openWin(_path + '/js/plugins/pdfjs/web/viewer.htm?file=' + escape('/pyfagl/pyfayl_cxPyfaylPdf.html?id=…&doType=query'))`。
   - 该 viewer 路径 **`viewer.htm` 不是 `viewer.html`**，写成 .html → Tomcat 404 `No Action mapped for action name js/plugins/pdfjs/web/viewer`。
   - `/pyfagl/pyfaxxwh_ckPyfaJbxx.html` 对**学生**返回「无功能权限」（那是教师端维护页）。
4. **培养方案 PDF 是扫描件/无文本层**：pdfjs 文本层只有 1246 字符（全是标题），正文得靠 OCR 或渲染成图看。本机用 `<本地路径>/pdftoppm.exe -r 150 -png` 渲染，再逐页读图，效果确定。
5. **成绩接口响应字段是精简版**：只有 `kcmc/xf/cj/jd/xkkh`，**没有 kch、学分绩点、课程性质、开课学院**。要按模块（思政/军体/外语…）归集必须自己用课程名对培养方案匹配。
6. **毕业资格自审必须先设置「个性修读课程模块」**：否则 `byshck_xszsBysh.html` 直接回 `{"message":"【学号】还未设置个性修读课程审核模块！","type":"gxxdkcmk","status":"none"}`，审核结果 `cxByshzsIndex` 回 `[]`，页面显示「没有符合条件记录！」。这是**未配置**不是**无数据**，极易误判成「该生无毕业问题」。
7. `/jwglxt/zycjtj/xszgkc_cxXsZgkcIndex.html`（成绩主修数据查询）**对当前账号返回 0 条**，成绩请用 `xscjcx_cxXscjIndex`。
8. 自审页按钮 id：`btn_sh`(审核) `btn_dcsh`(导出) `btn_mkbj`(模块设置) `btn_kcbj`(有效学分标注)；确认框 `#byshmkbjModal` 会拦截点击，需先点「确 定/关 闭」。

### 产物（本次落盘）
`knowledge/` 下：`<培养方案号>-培养方案.pdf`（原件）、`<培养方案号>-textlayer.txt`、`grades-<学年>.json`（个人成绩单）、`programs-<年份>-all.json`（该年级全部专业计划）、`program-<培养方案号>.json`（个人专业计划摘要）。

### 未探候选（下次从这里接）
1. 课表查询 `/jwglxt/xskbcx/xskbcx_cxXskbcxIndex.html?gnmkdm=N2151`（菜单里有 `xskbcx_cxXskbcxIndex.html`，本次未单发）。
2. 考试安排 `kscx_cxXsgrksIndex.html`。
3. 毕业资格自审设置完模块后重新跑审核，才能拿到逐节点 `通过/不通过` 明细。

## 未探候选（下次从这里接）
1. **登录区**：成绩、课表、考试安排、学分统计——需先让浏览器走完 CAS 并 `state-save`。
2. `POST /jwglxt/xtgl/xwgl_cxXwListGyxtzgg.html`（关键词检索通知，`xwbt` 参数）——疑似只读，未单发验证；可能需要登录态。
3. `/jwglxt/xtgl/xwck_cxXwList.html` —— 登录后通知全量（含本科生院栏目）。
4. **研究生教务 yjsy.zju.edu.cn 是另一套系统**（Vue 2 SPA，`/api/*` 返回 `{code:401,msg:'invalid token'}`），不是 zdbk 的别名，需单独探索。

## 一证多站
`campus-sso` → zjuam CAS → 整个 zjuam-cas 家族（本站在 `_sso.json` 名单内）。见 `sites/_sso.json`。

# 课表 / 考试 / 学期（登录区，2026-11-22 新探）

> 本节由「按 dsh-zju-assistant 清单逐个探」补齐。原 wiki 的「未探候选」第 1、2 条已闭环。

## 脚本

```bash
node sites/zdbk.zju.edu.cn/login.mjs                       # CAS 登录（会话约 30 分钟不动就失效）
node sites/zdbk.zju.edu.cn/crawler-kb.mjs terms            # 学期码表
node sites/zdbk.zju.edu.cn/crawler-kb.mjs kb 2026-2027 "1|秋"
node sites/zdbk.zju.edu.cn/crawler-kb.mjs exams
```

## 一、功能码总表（67 个，从菜单页提取）

`GET /jwglxt/xtgl/index_initMenu.html?ignoreZoom=1` 返回的 HTML 里，每个功能都是一个：

```html
<div class="panel-gnmkdm" data-gnmkdm="N253508" data-gndyym="/kbcx/xskbcx_cxXskbcxIndex.html" data-gnmkmc="学生课表查询">
```

**989 处 `gnmkdm`，去重得 67 个功能码**，`data-gnmkdm` + `data-gndyym` + `data-gnmkmc` 三者齐全。
这是一份**权威功能码表**，比任何第三方整理都完整。教学核心 25 个：

| 功能码 | 功能 | 路径 |
|---|---|---|
| N253508 | **学生课表查询** | `/kbcx/xskbcx_cxXskbcxIndex.html` |
| N509070 | **考试查询** | `/xskscx/kscx_cxXsgrksIndex.html` |
| N5083 | **成绩查询** | `/cxdy/xscjcx_cxXscjIndex.html` |
| N153020 | **培养方案查询** | `/pyfagl/pyfaxxcx_cxPyfaxscxIndex.html` |
| N509060 | 成绩单自助打印申请 | `/cxdy/cjdzzdysq_cxCjdzzdysqIndex.html` |
| N503255 | 成绩公示查询 | `/cjgzgl/cjgzgl_cxCjgzgsIndex.html` |
| N908550 | 成绩主修数据查询 | `/zycjtj/xszgkc_cxXsZgkcIndex.html` |
| N537054T | 学生成绩查询（毕业生） | `/glybysjgl/xscjcx_cxXscjxxIndex.html` |
| N253530 | 自主选课 | `/xsxk/zzxkghb_cxZzxkGhbIndex.html` |
| N253540 | 补退选申请 | `/xsbtx/xsbtx_cxXsbtxIndex.html` |
| N253545 | 补考资格查询与确认 | `/xsbkqr/xsbkqr_cxXsbkqrIndex.html` |
| N214505T | 推荐课表查询 | `/kbdy/bjkbdy_cxBjkbdyIndex.html` |
| N151040 | 课程信息查看 | `/kckgl/kcjbxxwh_cxXsKcjbxxIndex.html` |
| N253535 | 教材预订 | `/xsxjc/xsxjc_cxXsxjcIndex.html` |
| N729955 | 教材领用查询 | `/jcdjgl/jcxxcx_cxXsjccxIndex.html` |
| N729960 | 教材库存查询 | `/jcdjgl/jcxxcx_cxJckccxIndex.html` |
| N3035 | 学籍相关文档下载 | `/wddyxz/wddyxz_cxWddyxzIndex.html` |
| N3015 | 主修专业确认 | `/zxzygl/zxzyqr_cxZxzyxsxxIndex.html` |
| N6025 | 毕业资格自审 | `/bysh/byshck_cxByshzsIndex.html` |
| N6016 | 毕业生信息核对 | `/xsxxxggl/xsxxhd_cxXsxxhdIndex.html` |
| N532541T | 论文查重 | `/xsbysjgl/xslwcc_cxXslwccIndex.html` |
| N532530T | 学生选题 | `/xsbysjgl/xsxt_cxXsxtIndex.html` |
| N106020 | 学生辅修申请 | `/fxbmgl/xsfxbm_cxXsfxbmIndex.html` |
| N104515 | 推免生网上申请 | `/tmsgl/tmssq_cxTmsxssq.html` |
| N108001 | 第二三四课堂查询 | `/dessktgl/dessktcx_cxDessktcxIndex.html` |

完整 67 条见 `endpoints.json` 的 `gnmkdm` 字段。**URL 规则**：功能页必须带 `?gnmkdm=<码>&su=<学号>`（`index` 不需要 su）。

## 二、课表查询（N253508）

### 数据接口（关键：不在页面 HTML 里，在业务 JS 里）

页面上没有查询按钮——进页面就自动加载。真正的接口藏在
`/jwglxt/js/comp/jwglxt/xkgl/kbcx/xskbcx.js` 里：

```
POST /jwglxt/kbcx/xskbcx_cxXsKb.html
   xnm=2026-2027      学年
   xqm=1|秋           学期码（含竖线，注意编码）
   xqmmc=秋           学期名
   xxqf=              选课学期？空即可
   xsfs=1             显示方式（1=列表，0=表格）
```

配套两个：

```
POST /jwglxt/kbcx/xskbcx_cxXueqiList.html   body: xxqf=1
  → [{"xxq":"1|秋、冬","xqmc":"秋、冬"},{"xxq":"2|春、夏","xqmc":"春、夏"}]

POST /jwglxt/kbcx/xskbcx_cxSfkc.html?xn=<学年>&xqm=<学期码>   （参数在 URL 上）
  → 文本 "OK" 表示该学期课表已开放；否则返回提示文案
```

### 返回结构（实测某学期课表）

```json
{
  "xh": "<学号>", "xm": "<姓名>", "xzb": "<行政班>",
  "xy": "<学院>", "zy": "<专业>",
  "xnm": "2026-2027", "xqm": "秋", "xkkg": true,
  "kbList": [ /* 每门课 */ ]
}
```

每条课程字段（去掉正方 grid 噪音后）：

| 字段 | 含义 | 例 |
|---|---|---|
| `kcmc` | 课程名 | `<课程名>` |
| `kcdm` | 课程代码 | `<课程代码>` |
| `jsxm` | 教师 | `<教师姓名>`（多人用 `<br>` 分隔） |
| `jszgh` | 教师工号 | `<教师工号>` |
| `skdd` | 上课地点 | `<教学楼-教室><br><地点>` |
| `sksj` | 上课时间 | `周二第6,7,8节<br>周五第1,2节` |
| `xkkh` | 选课课号 | `<学年学期>-<课程代码>-<教师工号>-<课序号>` |
| `xxq` | 开课学期 | 秋冬 / 秋 / 短 |
| `xkzy` | 选课志愿 | 1 |
| `sfqd` | 是否确定 | 1=蓝色确定 |
| `xksj` | 选课时间 | `<选课时间>` |

**最大坑：没有结构化的「星期」和「节次」字段。** 时间全在 `sksj` 的文本里，`<br>` 分隔多个时段，
还会出现 `{单周}` `{双周}` 标记（如 `周二第11,12,13节{单周}`）。要渲染成课表必须自己解析这个字符串。
我一开始按 `xqj`/`jcs` 字段找，结果全是 `null` —— 那两个字段不存在。

## 三、考试查询（N509070）

```
POST /jwglxt/xskscx/kscx_cxXsgrksIndex.html?doType=query&gnmkdm=N509070&su=<学号>
   queryModel.showCount=200&queryModel.currentPage=1
```

返回 `{ items: [...], totalResult, totalPage }`（jqGrid 标准壳）。

字段：`kcmc` 课程名、`kssj` 考试时间、`jsmc` 考试教室、`zwxh` 座位号、`xf` 学分、`xkkh` 选课课号、`xxq` 学期，
以及补考/清考用的 `qzkssj`（期中考试时间）、`qzjsmc`（期中教室）、`qzzwxh`（期中座位）。

### ⚠️ 本页第二个重要坑：考试接口忽略学年学期参数

实测：传 `xnm=2026-2027&xqm=1|秋`、传 `xnm=2025-2026&xqm=2|春`、传 `xnm=2020-2021&xqm=1|秋`（故意乱填）、
甚至完全不传 —— **四次返回字节数完全相同（byte-for-byte 一致），total 恒定，首条都是同一条往年考试**。

**结论：`xnm`/`xqm` 对它无效，它返回你在本系统里所有历史考试。**
要「本学期有几场考试」必须自己按 `kssj` 里的年份过滤。
若不注意，会得到「这学期有几十场考试」的荒谬结论 —— 实际里面混着往年的军训记录和
`kcmc=军训`、`kcmc=身体素质课` 这类**根本不是考试**的行。

## 四、学期码表

| `xqm` 值 | 含义 |
|---|---|
| `1|秋` | 秋 |
| `1|冬` | 冬 |
| `1|短` | 秋短学期 |
| `1|暑` | 暑 |
| `2|春` | 春 |
| `2|夏` | 夏 |
| `2|短` | 春短学期 |

`xnm` 形如 `2026-2027`（学年第 1 年 - 第 2 年）。下拉框只给最近 3 个学年。

## 五、登录区仍然必须走浏览器

原 wiki 那条坑依然成立且已再次验证：本站同一域名有两个同名 `JSESSIONID`
（`/jwglxt` 与 `/jwglxt/xtgl`），`lib/cookies.mjs` 的 `domain|path|name` 键会互相覆盖。
所以 `crawler-kb.mjs` **全程用 playwright 页面上下文里的 `fetch`**，cookie 由浏览器管。
用 node:https 自己拼 cookie 会 302 回登录页或 901。

会话 TTL 实测：**约 30 分钟不动就失效**。失效表现是 302 到 `login_slogin`。
`crawler-kb.mjs` 会在 boot 阶段检测并提示重跑 `login.mjs`。

## 通知公告需学号登录（2026-11-22）

跳转链：
- https://zdbk.zju.edu.cn/jwglxt/xtgl/xwgl_cxXwListAlltzgg.html -> 302 https://zdbk.zju.edu.cn/jwglxt/xtgl/login_slogin.html

- 清单里同一路径挂了两个标签（本科生院通知公告 / 各院系通知公告）。
- 归档为「认证后可访问的独立场景」，不计入公开通路。

## 评教状态查询端点（2026-11-22）

- 上游清单提到 `POST /jwglxt/xtgl/index_cxMyCosJxpj.html`（本人课程评教**状态查询**）。
- **本轮未请求**：该站需 StuId 会话；且评教类路径与提交侧同前缀，静态探测无法确认是只读还是写入，按纪律不盲试。
- 结论：属于「已知路径、待授权会话下再确认读写性质」。
