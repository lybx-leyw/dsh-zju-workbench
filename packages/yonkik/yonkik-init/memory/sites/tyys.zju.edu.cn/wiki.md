# 浙大体艺 tyys.zju.edu.cn（公共体育与艺术部）

## 本页索引

<!-- yonkik:toc -->
> 按节读。grep -n "^## <标题>" wiki.md 取行号。

- 一句话结论
- ⚠️ GBK 编码：正确解码写法（本页最重要）
- 站点拓扑（三套子系统）
- 鉴权与免登录范围
- 栏目 id 表
- 分页与附件直链
- 个人数据在哪（谨慎）
- 接口
- 限流
- 坑
- CC98 主张核实
- 安卓客户端问题（网页端视角判定）
- 未探候选

---
**状态：done（2026-11-20）** —— 官网公开区全摸清 + GBK 坑定性 + 个人数据入口定位（未登录探）。

## 一句话结论

浙大体艺 = **三套互相独立的系统挂在同一域名下**：

| 子系统 | 路径 | 内容 | 鉴权 |
|---|---|---|---|
| **官网（wescms）** | `https://tyys.zju.edu.cn/` | 通知公告、体测安排、下载专区、场馆介绍、教学文件 | **免登录** |
| **体质健康动态信息系统** | `https://www.tyys.zju.edu.cn/ggtypt/` | **个人体测成绩 / 体测预约 / 打卡记录** | **CAS** |
| **场馆预约系统** | `https://www.tyys.zju.edu.cn/cgyy/` | 场馆余量与预约 | CAS / 校外自注册 |

学生口中的「浙大体艺」通常指 **ggtypt**（个人数据）或那款安卓 App。**网页端能免登录查到的只有「规则与安排」，查不到任何个人数据。**

## ⚠️ GBK 编码：正确解码写法（本页最重要）

**症状**：用 UTF-8 读 `https://tyys.zju.edu.cn/`，title 得到 `�㽭��ѧ����������������`。

**根因有三层，缺一层就解错**：

1. **HTTP 响应头不带 charset** —— `Content-Type: text/html`（实测无数次都是裸的，没有 `; charset=gbk`）。
2. **页面 meta 写的是 `charset="gb312"`** —— 这是个**不存在的编码名**（应写 gb2312）。浏览器靠容错猜成 gb2312，**Node 的 `TextDecoder('gb312')` 会直接抛 `RangeError: The "gb312" encoding is not supported`**，Python 的 `decode('gb312')` 同样报 LookupError。
3. 所以任何「按页面声明的编码去解」的逻辑都会踩空。

**正确写法（Node，唯一推荐）**：

```js
// ✅ 无条件用 gb18030 —— GBK/GB2312 的超集，覆盖面最广，且 Node 内置支持
const buf = await (await fetch(url)).arrayBuffer()
const html = new TextDecoder('gb18030').decode(buf)
```

**通用自动判定（要兼容别的站时）**：

```js
// 从 latin1 视图嗅探 meta charset，但把 gb312/gbk/gb2312 一律映射到 gb18030
const head = Buffer.from(buf).subarray(0, 4000).toString('latin1')
const declared = (head.match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1] || ''
const enc = /gbk|gb2312|gb312|gb18030/i.test(declared) ? 'gb18030' : 'utf-8'
const html = new TextDecoder(enc).decode(buf)
```

**实测对照（同一份 71,408B 响应）**：

| 编码 | title 的中文字符数 | 结果 |
|---|---|---|
| `utf-8` | 0 | `�㽭��ѧ����������������`（乱码） |
| `gb18030` | 12 | **浙江大学公共体育与艺术部** ✅ |
| `gbk` | 12 | 同上 ✅ |
| `gb2312` | 12 | 同上 ✅ |
| `big5` | 12 | `涳蔬湮悝鼠僕极郤迵眙扲窒`（假中文，会骗过字符数检查） |

> ⚠️ **别用「解出来有几个汉字」判断解码对不对**——big5 也能解出 12 个汉字但是错的。要么用 gb18030 无条件，要么人工看一眼 title。

**例外**：`https://www.tyys.zju.edu.cn/cgyy/index` 是 **UTF-8**（`Content-Type: text/html;charset=UTF-8`），用 gb18030 解反而错。所以**按 host+path 分流**：`tyys.zju.edu.cn/*`（wescms 官网）→ gb18030；`www.tyys.zju.edu.cn/cgyy/*` → utf-8；`ggtypt/*` → 未探。

## 站点拓扑（三套子系统）

```
tyys.zju.edu.cn          （官网，wescms，GBK）
├── /redir.php?catalog_id={id}                      ← 栏目/正文，catalog_id 路由
├── /wescms/sys/filebrowser/file.php?cmd=download&id={id}   ← 附件（302 → /attachments/）
├── /attachments/YYYY-MM/{seq}-{ts}-{id}.{ext}      ← 附件真实静态路径
└── 快捷入口（首页底部）
    ├─ 场馆服务系统   → redir 302 → /cgyy/
    ├─ 体质健康动态信息系统 → redir 302 → /ggtypt/
    └─ 公共体育信息平台 → (未探)

www.tyys.zju.edu.cn      （业务子系统，与官网同域不同 app）
├── /ggtypt/    → 302 /ggtypt/login → JS 跳 zjuam CAS   【个人体测数据】
└── /cgyy/index → 200 UTF-8 登录页                        【场馆预约】
```

## 鉴权与免登录范围

**免登录可读（实测 200）**：

| 内容 | 位置 |
|---|---|
| 通知公告、公示公告 | `catalog_id=172444`（/191753 是活动预告） |
| **体质健康测试安排通知（含全校体测政策）** | `catalog_id=172630`（4 页 ≈37 条，2016→2026） |
| **下载专区**（免测/缓测申请表、体测手工登记表、场地申请表） | `catalog_id=172442`（4 页） |
| 场馆介绍 / 场馆租借说明 / 审批流程 | `catalog_id=172636` / `172637` |
| 教学文件、教学公告 | `catalog_id=194111` / `206311` |
| 体艺部部门简介/领导/机构/黄页 | `172606`–`172609` |

**需登录**：
- `/ggtypt/**` —— 个人体测成绩、体测预约、打卡记录
- `/cgyy/**`（预约动作）—— 场馆下单

**关键判定**：`/ggtypt/` 匿名访问返回的**不是 401，而是一段 JS 跳转脚本**：

```html
<script>window.location.href='https://zjuam.zju.edu.cn/cas/login?service=http://www.tyys.zju.edu.cn/ggtypt/dologin'</script>
```

→ 所以 `curl` 拿到的 200 + 124 字节 body 其实是「跳去登录」的指令，**不要误判成「有数据」**。判据是 `body.length < 200 && body.includes('zjuam.zju.edu.cn/cas/login')`。

## 栏目 id 表（实测）

| catalog_id | 栏目 | 分页 |
|---|---|---|
| 172435 | 部门概况（容器） | — |
| 172606/172607/172608/172609 | 部门简介 / 部门领导 / 机构设置 / 部门黄页 | 无 |
| 172436 | 党政管理（容器） | — |
| 172610 / 172611 / 172612 / 190545 | 信息公开 / 制度文件 / 体艺之家 / 公示公告 | 无 |
| 172438 | 教育教学（容器） | — |
| **172630** | **体质健康测试** | **4 页** |
| 172628 / 172629 | 公共体育教育 / 公共艺术教育 | 无 |
| 194111 / 206311 | 教学文件 / 教学公告 | 无 |
| 172441 | 智慧场馆（容器，302 → 172636） | — |
| 172636 / 172637 / 172638 | 场馆介绍 / 场馆租借 / APP预约（图片说明，后续补证见末节） | 无 |
| **172442** | **下载专区** | **4 页** |
| 172444 | 通知公告 | 分页 |
| 191753 | 活动预告 | 分页 |
| 172448 | 快捷入口（172541=体质健康动态信息系统） | 无 |

**正文**：`/redir.php?catalog_id={id}&object_id={objectId}`，例如 `172630&object_id=219877` → 2026-2027 学年体测安排。

## 分页与附件直链

**分页（wescms，与苏迪不同！）**：

```html
<a href="redir.php?catalog_id=172630&page=1" class="num 0">2</a>
<a href="redir.php?catalog_id=172630&page=3" class="num">4</a>
```

- 参数是 **`&page=N`**（不是 `/list2.htm`），**0-based**：当前显示第 1 页时，「第 2 页」链接是 `page=1`，「第 4 页」是 `page=3`。
- 每页 10 条。
- 锚点 `class="num"` 页码 / `class="other"` 翻页（`上一页` `下一页` `尾页`）。

**附件两步法（与 courses 的 upload→blob 同构）**：

```
GET /wescms/sys/filebrowser/file.php?cmd=download&id={fileId}
  → 302 Location: /attachments/2026-04/01-1775809060-219881.xlsx
  → GET 该静态路径 → 200，10,710B  (首次会下发 wsess cookie)
```

实测：`id=219881` → `/attachments/2026-04/01-1775809060-219881.xlsx`，10,710B，xlsx 完整。

正文页里的附件写法（从 `/redir.php?catalog_id=172630&object_id=219877` 提取）：
```html
<a href="http://www.tyys.zju.edu.cn/wescms/sys/filebrowser/file.php?cmd=download&id=219881">
```
→ **注意是 `http://` + `www.` 前缀**，不是 `https://tyys.`。跟随 301/302 即可。

## 个人数据在哪（谨慎）

**结论：`www.tyys.zju.edu.cn/ggtypt/` 就是「体质健康动态信息系统」，个人体测成绩与预约全在这里，必须 CAS 登录。**

路径链（实测）：
```
首页快捷入口 172448&object_id=172541
  → 302 redir.php?catalog_id=256&object_id=257
  → 302 http://www.tyys.zju.edu.cn/ggtypt/
  → 302 /ggtypt/login;jsessionid=...
  → 200  JS 跳转 → zjuam CAS
```

**⚠️ 涉及个人数据，按安全契约处理**：
- 只取**本人**数据，绝不遍历他人学号。
- 本次**未登录、未探接口、未做任何批量调用**，只定位了入口形态。
- 如果要取本人数据：写 `login.mjs` 走 campus-sso → CAS（先探 `GET /cas/v2/getKaptchaStatus`）→ state-save → 再探 `/ggtypt/**` 的只读接口。**这是下一步，不是本次做的。**

**体测预约入口的官方表述**（正文 219877 原文）：
> 预约方式一：登录公共体育与艺术部（http://www.tyys.zju.edu.cn/）选择「体质健康动态信息系统」中的「体质健康预约管理」。
> 预约方式二：通过手机，使用浙大体艺 APP 中的体测模块进行预约。

## 接口

| 接口 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `GET /` | GET | 官网首页（GBK） | 无 |
| `GET /redir.php?catalog_id={id}` | GET | 栏目列表（GBK） | 无 |
| `GET /redir.php?catalog_id={id}&object_id={oid}` | GET | 正文（GBK） | 无 |
| `GET /wescms/sys/filebrowser/file.php?cmd=download&id={fid}` | GET | 附件（302 直链） | 无 |
| `GET /wescms/sys/filebrowser/file.php?cmd=preview&id={fid}` | GET | 图片预览 | 无 |
| `GET www.tyys.zju.edu.cn/ggtypt/` | GET | 体测系统入口（JS 跳 CAS） | **CAS** |
| `GET www.tyys.zju.edu.cn/cgyy/index` | GET | 场馆预约登录页（UTF-8） | CAS/自注册 |

详见 `endpoints.json`（8 verified）。

## 限流

- `/robots.txt` → **404**。无 `X-RateLimit-*`。
- ⚠️ **首字节偶发极慢**：实测首页一次 **17,834ms**（后续几次 60–180ms）。`site.json` 已把 `timeoutMs` 提到 **60000**，别用默认 30s。
- 保守默认：串行、并发 1、间隔 ≥2.2s（`minIntervalMs: 2200`）。

## 坑

1. **GBK（见本页第二节）** —— 最大坑。用 gb18030 无条件解。
2. **meta charset 是错别字 `gb312`** —— 不是 gb2312，不是笔误可忽略，它会让「按声明解码」的代码直接崩。
3. **`/ggtypt/` 匿名返回 200 + JS 跳转脚本**（124 字节），不是 401。判据见上文。
4. **官网与业务子系统是不同 host**：官网 `tyys.zju.edu.cn`，业务 `www.tyys.zju.edu.cn`。跨 host 时 cookie 不共享，`wsess` cookie 是各 host 自己的。
5. **`/cgyy/` 是 UTF-8，官网是 GBK** —— 同一域名下两种编码，别一刀切。
6. **附件链接是 `http://www.` 开头**（不是 https，也不是裸域名），会 302/301 一次。
7. **分页 0-based**：`&page=0` 与首页等价，`&page=3` 是第 4 页。别用 `page=1` 当第 1 页。
8. `/redir.php?catalog_id=172638`（APP预约）**是空栏目**（正文 0 字），不是坏了。
9. `/wescms/...php?cmd=download` 首次响应 302 + `Set-Cookie: wsess=...`，二次请求静态路径不带 cookie 也能下（静态路径无需鉴权）。

## CC98 主张核实

| 主张（帖 id） | 实测 | 判定 |
|---|---|---|
| 6707342「体育打卡跑步次数是以浙大体艺显示的为准吗」 | 官网免登录区**没有任何打卡/跑步数据**；该数据在 `/ggtypt/`，需 CAS | **证实「浙大体艺是唯一数据源」**（因为没有第二处可看）。但**网页匿名查不到**——必须登录或看 App |
| 6704189「去健身房浙大体艺不显示」 | 官网无健身房打卡记录页；`/cgyy/`（场馆预约）需登录才有「我的预约」 | **无法从公开区证伪**。说明打卡记录与场馆预约是两套系统，健身房记录同步与否属后端逻辑。App 端 issue |
| 6701272「体测多久成绩同步」 | 体测安排正文明确「测试结束后可通过 PC 端登录『体质健康动态信息系统』（**内网**）或使用浙大体艺 APP【体测】模块查询」 | **证实**：官方给的查询入口就两个（内网 PC + App），**没有网页公开查询**。同步延迟无官方承诺 |
| 6704911 / 6704842「打不开」 | 本次实测官网 200/171ms（除一次 17.8s 慢响应），CAS 入口正常跳转 | **官网/网页端正常**；打不开大概率是 **App 端**或内网 PC 端（正文写「（内网）」= 校外访问不了） |
| （Lead 汇总）「12 分钟跑被坑」「申诉入口在浙大体艺的意见反馈」 | 官网免登录区无申诉入口页；体测通知正文只说「联系公共体育教育中心，咨询电话：<电话>」，附件给免测/缓测申请表 | **证实官方只给电话 + 纸质申请表**，没有线上申诉系统 |
| （Lead 汇总）「现在好像要第二天才能看到记录」 | 站内无任何同步时效的书面承诺 | **无法证实**，属经验性说法 |

## 安卓客户端问题（网页端视角判定）

Lead 问：「小米/红米系统更新后打不开」「我的手机认为浙大体艺是病毒」「存在不合理的授权」「升级系统后打不开」——**网页端能判定什么？**

**能判定的**：
1. **官网 `catalog_id=172638`（APP预约）是空栏目**（正文 0 字）—— 官网**不提供 App 下载包、不提供包名、不提供系统版本要求**。全站 grep 无 `.apk` / `android` / `ios` / 应用商店链接。
2. 官网**无 App 兼容性说明、无版本公告**。
3. 体测通知正文里 App 只作为「预约/查分工具」被提及，无技术支持条款。

**不能判定的**（明确标注为推测，不是实测结论）：
- 包名、签名、targetSdkVersion、权限清单 —— **网页端完全拿不到**。
- 「被识别为病毒」的成因 —— 需要 APK 才能分析，网页端无法判定。

**结论**：`客户端问题，网页端不受影响`。网页端（官网 + CAS 登录的 ggtypt）本次实测可达性正常。App 崩溃属客户端侧，需要拿到 APK 才能定位。**如果用户只要查体测成绩/预约，走网页端 `ggtypt` 即可绕过 App 崩溃问题** —— 这是本页对用户最有用的一条。

## 未探候选

1. **`/ggtypt/**` 的只读接口**（本人成绩/预约/打卡）—— 需 CAS 登录，本次按契约未做。**这是本组最高价值的下一步。**
2. `/cgyy/**` 的场馆余量接口 —— 同上，需登录。
3. 「公共体育信息平台」（首页第三个快捷入口 `object_id=172537`）—— 未跟随，可能是体育课成绩系统。
4. `catalog_id=172630` 的第 2–4 页（2016–2024 年体测政策沿革）—— 只读了第 1 页。
5. 下载专区第 2–4 页的具体附件 id 清单。

## 一证多站

`/ggtypt/` 与 `/cgyy/` 走 **zjuam CAS**（`campus-sso`），本站在 `_sso.json` 的 `zjuam-cas` 家族名单内。见 `sites/_sso.json`。

## 早期探测：根路径和旧子系统并非场馆 API（2026-11-22）

`dsh-zju-campus` 的 tyys 模块列了 19 个 `/api/*` 端点，本机逐一实测后**没有一个能在根路径上命中**。
记录在这里，避免下次重复踩。

### 实测结果

| 路径 | 结果 |
|---|---|
| `www.tyys.zju.edu.cn/api/l/v6/u/info` | **404**（Apache 默认 404 页 213B） |
| `www.tyys.zju.edu.cn/api/reservation/campus/venue/info` | **404** 231B |
| `www.tyys.zju.edu.cn/api/reservation/day/info` | **404** |
| `www.tyys.zju.edu.cn/api/front/website/protocols/code/RESERVATION_PROTOCOL` | **404** |
| `/cgyy/api/l/v6/u/info`（加子应用前缀） | **404**（Tomcat 6.0.24 错误页 952B） |
| `/cgyy/api/reservation/…` | **404** Tomcat |
| `/ggtypt/api/l/v6/u/info` | **404**（返回 11KB 的 SPA 壳，说明被前端 catch-all 吃掉） |

### 已经确定的（可直接用）

| 项 | 值 |
|---|---|
| 官网（免登录） | **`https://tyys.zju.edu.cn/`**（不带 www）200 71,408B |
| 体测子系统 | `https://www.tyys.zju.edu.cn/ggtypt/` → 302 `/ggtypt/login`（CAS） |
| 场馆预约 | `https://www.tyys.zju.edu.cn/cgyy/` → 302 `/cgyy/loginsso`（CAS/校外自注册） |
| 证书 | **`www.tyys` 的证书 CN 与域名不匹配**（`ERR_TLS_CERT_ALTNAME_INVALID`），遇证书名不匹配时停止；不关闭校验 |
| 编码 | `tyys.zju.edu.cn` 整站 **gb18030**，且 meta 写的是**不存在的 `gb312`**（见本页「GBK 编码」节） |

### 判定

assistant 那 19 个 `/api/*` 大概率跑在**独立端口**（Vue/uni-app 常见 `:8080`/`:9090` 分离部署）
或**独立后端域名**上，而本机只探了 `www.tyys` 的 443。
**没有继续猜**——猜路径的成本高、命中率低，且预约类接口多为写操作（`order/submit`、`order/pay`、
`order/cancel`），按只读原则本就不该做。

### 下次怎么接

1. 用 playwright 打开 `https://www.tyys.zju.edu.cn/cgyy/`，跟完 CAS，**抓真实 XHR 的完整 origin**
   （重点看端口号与 host，别只看 path）
2. 拿到 origin 后再判断哪些是只读（`venue/info`、`day/info`、`orders/mine`），哪些是写（`order/submit`、`pay`、`cancel`）
3. 只读那几个再脚本化；写的明确不做

## 公开场馆规定与新预约后台的边界（2026-11-22）

- [场馆使用管理规定](http://www.tyys.zju.edu.cn/cgfw/redir.php?catalog_id=794&object_id=12021)：匿名 HTTP 200，GB2312 声明、按 GB18030 解码。页面显示发布时间 2013-05-06，正文落款 2013年7月19日；这两处日期各自保留。这是历史官网条文，不是 APP 当前排期或放号时间。
- [APP预约入口](http://www.tyys.zju.edu.cn/redir.php?catalog_id=172638)：匿名 HTTP 200，说明正文是图片引用；未访问图片，不把旧 Wiki 的「空」当事实。
- 上面的旧根路径和 cgyy/ggtypt 404 **没有覆盖** /venue-server。[固定版本源码](https://github.com/Anchorite-no/dsh-zju-assistant/blob/aaf602aabf52f3f337cb2449a4495b685b9f5b07/core/zju/lib/tyys/venue.ts) 的实际站点前缀为 http://www.tyys.zju.edu.cn/venue-server；只匿名单发了须知与场馆树，HTTP 200、text/json、业务 code=400、46B，两者都无有效业务数据。通用 Bad Request 不足以断言究竟缺少认证、请求上下文还是其他条件；没有跟着试登录或伪造客户端。
- 可复用公开命令：venue-guide.mjs rules [--summary]、venue-guide.mjs app；固定两个页面，无凭据，不自动打开图片或跟跳。日余量、放号与本人订单留待体艺正式入口和获准会话；不读订单、不提交预约。

## 体育考勤 ptm 端点已确认存在（2026-11-22）

上游清单第 42 行列了 `www.tyys…/ptm/api/l/v6/` 下的四个 GET。本轮逐个请求，四个**全部存在**：

| 端点 | 含义 | 无会话时 |
|---|---|---|
| `/ptm/api/l/v6/termlist` | 学期列表 | 200，返回业务错误码 2002「非法的请求参数」 |
| `/ptm/api/l/v6/student/courselist` | 本人体育课列表 | 200，返回业务错误码 2002「非法的请求参数」 |
| `/ptm/api/l/v6/student/attendancelist` | 本人考勤记录 | 200，返回业务错误码 2002「非法的请求参数」 |
| `/ptm/api/l/v6/course_times` | 课程时间 | 200，返回业务错误码 2002「非法的请求参数」 |

**判定**：返回 200 加统一错误码，说明**路由存在**（不是 404）；缺的是登录会话与业务参数。所以这四项从「本地完全没有」升级为「路由已确认、待授权会话」。

**必须记住的坑**：该站要用**单级域** `https://tyys.zju.edu.cn`。两级域 `www.tyys.zju.edu.cn` 的 HTTPS 证书是 `*.zju.edu.cn`，不覆盖两级子域，直接请求会报 `ERR_TLS_CERT_ALTNAME_INVALID`；但两级域的 **HTTP** 可用，同样返回 2002。

**明确不做**：不伪造会话、不猜参数绕过登录、不请求签到或打卡类写接口。

## 场馆接口整族路由确认（2026-11-22）

`/venue-server` 下四个端点全部实测：

| 端点 | 返回 |
|---|---|
| `…/protocols/code/RESERVATION_PROTOCOL` | 200，业务码 400，46B |
| `…/reservation/campus/venue/info` | 200，业务码 400，46B |
| `…/reservation/day/info` | 200，业务码 400，46B |
| `…/orders/mine` | 200，业务码 400，46B |

**判定**：四个端点表现完全一致，说明**整族路由存在**，不是个别 404。缺会话与参数。

**必须说清的局限**：业务码 400 是通用 Bad Request，**不能**据此判断到底是缺登录、缺签名还是缺参数。档案里只写「整族存在、缺会话/参数」，不替它编原因。

**不做**：不靠猜参数拼凑 200；`POST /api/reservation/order/info` 嵌在订场流程里，属写操作链路，不碰。
