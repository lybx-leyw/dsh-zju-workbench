# 学术资源服务 scholar.edu.cn（浙大「国际学术资源服务」的真身）

## 本页索引

<!-- yonkik:toc -->
> 按节读：grep -n "^## <标题>" wiki.md 取行号。

- 结论速览
- 它到底是什么（不是什么）
- 入口（SPA 壳 vs legacy 真页）
- 准入机制（不需要账号密码）
- 接口（全部已验证）
- 资源清单（91 条，实测枚举）
- 专用客户端清单（5 个）
- FAQ 原文
- 坑
- 未探候选

---
**状态：done（2026-11-20 只读探索）** —— 清单、准入机制、客户端下载表全部拿到；**唯一未做的是「下载并安装专用浏览器后实际访问境外资源」**，任务禁止。

## 结论速览

- 它是浙大正版软件平台导航栏里「**国际学术资源服务**」指向的外部站（公网域名，**不在 zju.edu.cn 下**），京ICP备15006448号-79。
- **不是** WebVPN / RVPN / aTrust，**也不是**网页代理。是「**专用浏览器（出境通道）+ 导航清单**」形态。
- **不需要账号密码**。准入靠：① 专用浏览器（UA 白名单）+ ② 服务端按 IP 识别学校。
- **免登录能拿到完整资源清单（91 条）和客户端下载表（5 个）**——本机实测全部可读。
- 本机在校内网络（`<本机IP>`，中国教育网/杭州市）访问，`identifyIP` 直接认定 `schoolName=浙江大学`。CC98 楼主「没返校访问 403」与此一致：**校外 IP 会被识别不出学校 → 准入失败**。

## 它到底是什么（不是什么）

| 说法 | 判定 | 证据 |
|---|---|---|
| 「等于其它学校的学术专用出境服务」 | **成立** | 平台名「学术资源服务」；FAQ 原文「请确保您已正确接入专网并使用专用浏览器进行访问」 |
| 「下载专用浏览器以后可以访问国际学术资源」 | **成立** | `/legacy/download.html` 提供 Open 浏览器/夸克云桥版/千问科创版/学术浏览器；UA 白名单含 `YDXBrowser`(学术浏览器)、`Quark`(夸克)、Chrome 指定版本 |
| 「是网页代理」 | **不成立** | 没有任何代理网关；靠客户端 |
| 「是 RVPN/aTrust」 | **不成立** | 完全独立域名与体系，见 `sites/myvpn.zju.edu.cn/wiki.md` |
| 「不用挂 tizi 就能用」 | **无法验证** | 需装客户端实测，本次禁止 |

## 入口（SPA 壳 vs legacy 真页）

**这是本页最重要的一条**：

| 路径 | 实际返回 | 值不值得抓 |
|---|---|---|
| `/` | 5943B SPA 壳（正文只有「加载中，请稍候…」） | 否 |
| `/download.html` | **同一个 5943B SPA 壳** —— 它是前端路由，不是独立页 | 否 |
| `/robots.txt` | 也是 SPA 壳（无真实 robots） | 否 |
| **`/legacy/`** | **92KB 静态 HTML，完整导航清单** | **是，主入口** |
| `/legacy/download.html` | 69KB，客户端下载表 | 是 |
| `/legacy/faq.html` | 6.4KB，常见问答 | 是 |
| `/legacy/question.html` | 23KB，问题反馈页 | 是 |
| `/legacy/ytb/` | YouTube 资源列表 | 是 |

SPA 壳里 `/legacy/` 的链接是硬编码的（`https://scholar.edu.cn/legacy/`），说明新版导航页是把老静态页包了一层。**抓取一律走 `/legacy/`。**

## 准入机制（不需要账号密码）

`/legacy/` 的内联脚本原文（这就是准入逻辑）：

```js
const hideIpList = ["159.226.185.135","159.226.185.136","42.247.111.130","153.0.209.9","153.0.209.14"];
const allowedUAList = [
  'Chrome/122',   // win open_browser
  'Chrome/124',   // 安卓 open_browser
  'Chrome/132',   // mac open_browser
  'Chrome/140',   // mac open_browser
  'Chrome/130',   // Qwen pc
  'Quark',        // 夸克
  'YDXBrowser',   // 学术浏览器
];
const ua = navigator.userAgent;
const isAllowed = allowedUAList.some(item => ua.includes(item));
const res = await fetch('https://scholar.edu.cn/ipinfo');
const json = await res.json();
let nowIp = json.ip;
if (hideIpList.includes(nowIp)) { /* 隐藏所有 .target-div（即不展示资源） */ }
if (!hideIpList.includes(nowIp) && !isAllowed) {
  alert('请在导航页右上角‘浏览器及工具下载’下载‘适配浏览器’使用，否则网页可能无法使用。');
}
```

要点：
1. **UA 白名单是客户端的自我识别，不是服务端强制**——普通 Chrome 也能读 `/legacy/` 全部内容，只是会弹一个 alert 劝阻。
2. **真正的准入在服务端按 IP 判断学校**：`/api/system/school-info-entity/identifyIP` 返回 `schoolName`；识别不到学校就进不去资源。
3. `hideIpList` 里的 5 个 IP 会被隐藏导航块——**这是运维侧的屏蔽名单**（疑似云主机/出口 IP），不在名单内的校网 IP 正常。

## 接口（全部已验证）
Base `https://scholar.edu.cn`，业务前缀 **`/api/system`**。

| 接口 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/legacy/` | GET | 导航页全文 | 免登录 |
| `/ipinfo` | GET | 本机 IP 回显 | 免登录 |
| `/api/system/school-info-entity/identifyIP` | GET | **学校识别**（校网准入判定） | 免登录 |
| `/api/system/site-management-entity/page/list` | POST | **资源清单 91 条** | 免登录 |
| `/api/system/client-app-entity/page/list` | POST | **专用客户端 5 个** | 免登录 |
| `/api/system/system-notice-entity/page/list` | POST | 通知（HTML 全文） | 免登录 |
| `/api/system/system-notice-entity/homePage/top` | GET | 首页置顶通知 | 免登录 |
| `/api/system/system-dictionary-entity/dict/all` | GET | 站点分类字典 | 免登录 |
| `/api/system/system-notice-entity/systemHelp` | GET | 系统帮助（当前 data 为空） | 免登录 |

`identifyIP` 实测响应（本机，校内 IP）：
```json
{"code":200,"data":{"schoolName":"浙江大学","netType":1,
 "ipaddr":"<本机IP>","id":2139,
 "ipLocation":{"country":"中国","province":"浙江省","city":"杭州市","isp":"中国教育网"},
 "provinceCode":"330000","createTime":"2026-10-13 15:08:14"}}
```

## 资源清单（91 条，实测枚举）

按 `siteType` 分组（`dict/all` 给出分类字典）：

- **type=1 Google 系 (6)**：Google、Scholar、Translate、Gmail、Patents、Learning
- **type=173 Wiki (1)**：Wikipedia
- **type=345 学术文献/期刊 (15)**：MathSciNet、Statista、**JSTOR**、**ScienceDirect**、NCBI、Sage Journals、PWC、Research Square、Project Euclid、**Oxford Academic**、Ingenta Connect、**Taylor & Francis**、World Scientific、**Springer Nature Link**、**Wiley Online Library**
- **type=517 技术/开发者 (17)**：GitHub、HuggingFace、Docker Hub、Python、XDA forums、Windsurf、NVIDIA Omniverse、Tex Stack Exchange、Stack Overflow、NeoAxis、TryHackMe、Coursera、FinalScout、Kendo Email App、Auth0、Zenodo、medRxiv
- **type=689 资源列表 (1)**：YouTube 资源列表（站内 `/ytb/#/home`）
- **type=1898 学会/会议/出版社 (6)**：国际统计学会(IMS)、欧洲鼻科学会、剑桥大学出版社、ICLR、ICML、NeurIPS
- **type=2492 科研数据库 (17)**：LMFDB、GDC 癌症数据门户、ICGC ARGO、cBioPortal、DrugBank、HMDB、NOAA PSL、GOA-ON、TOMCCAP(ACM)、美国国会图书馆、Innovation Space(Ansys)、DAFoam、ACCJC、Tropicos、RCSB PDB、UniProt、Bloomsbury Collections
- **type=2789 海外高校/科研机构 (28)**：斯坦福、UCL、UNSW、多伦多、TUM、JHU、CUHK、UQ、UCLA、KAIST、CMU、高丽、UIUC、伯明翰、邦德、名古屋工业、NYU、华威、哥伦比亚、曼彻斯特、ANU、科罗拉多 LASP、桑格研究所、都柏林 UCD、UT Austin、华威、乔治布朗、WSCUC

**关键判定（回答「覆盖哪些资源」）**：
- **有**：Google Scholar（作 `Scholar`）、JSTOR、ScienceDirect、Springer、Wiley、Taylor & Francis、Oxford Academic、Sage、World Scientific、Ingenta、MathSciNet、PubMed 系（NCBI）、Google 全套、GitHub/HuggingFace。
- **没有**：**知网（CNKI）**、**Web of Science**、**IEEE Xplore**、万方、维普、百度学术。
- 全部 `allowScope` 都是「**全部大学**」——即清单是平台级的，浙大只是其中一个接入学校；**浙大没有专属条目**。

## 专用客户端清单（5 个）

`/api/system/client-app-entity/page/list` 实测（含完整下载地址）：

| 客户端 | 平台 | 版本 | 下载地址 |
|---|---|---|---|
| **AI浏览器（千问-科创版）** | Windows / MacOS-ARM / MacOS-X64 | V4.3.0.278 | `download.scholar.edu.cn/qianwen/QianwenPC_V4.3.0.259_x64.exe`<br>`download.scholar.edu.cn/qianwen/QianwenMac_V4.3.0.259_arm64.dmg` / `_x64.dmg`<br>（每组还有阿里云 CDN 备选 `umcdn.qianwen.com/...`） |
| **Open浏览器** | Windows / MacOS / Android / Ubuntu / 统信 / 麒麟 | V1.1.1076.64 (Win) | `download.scholar.edu.cn/openbrowser/windows/mini_installer1.1.1076.64.exe`<br>`.../openbrowser/mac/OpenBrowser-1.1.1057.64.pkg`<br>`.../openbrowser/android/open-browser-v3.9.9.130.apk`<br>`.../openbrowser/ubuntu/openbrowser-cn-stable_1.1.1073.0-1_amd64.deb`<br>统信/麒麟走 `.../openbrowserclean/{uos,kylin}/...deb` |
| **夸克浏览器（云桥版）** | Windows / MacOS / Android | V4.1.0.380 | `.../quark/windows/QuarkPC_V4.1.0.380.exe`<br>`.../quark/mac/QuarkMac_V4.1.0.380.dmg`<br>`.../quark/android/ucpro_V7.13.0.850.apk` |
| **学术浏览器** | Ubuntu | V1.9 | `.../AcademicBrowser/AcademicBrowser1.9.deb` |
| **学术工具** | Windows / Linux | V1.0 | `.../tools/windows_x64/scholartools.exe`<br>`.../tools/linux_amd64/scholartools` |

`/legacy/download.html` 还额外给了「学术工具使用说明」docx：`download.scholar.edu.cn/doc/学术工具使用说明.docx`。

发布说明（页面原文，日期）：
- 统信浏览器 3.0 全新发布 **2026/09/11**
- 麒麟浏览器 3.0 全新发布 **2026/09/11**
- Windows 浏览器 2.1 全新发布 **2025/05/07**
- Android 浏览器 1.0 全新发布 **2025/05/07**
- MacOS-ARM/x64 浏览器 1.0 全新发布 **2025/05/07**

## FAQ 原文（`/legacy/faq.html`，全文摘录）

> **Q: 网站无法打开？**
> A: 请确保您已正确接入**专网**并使用**专用浏览器**进行访问。对于已开放的网站，建议通过导航链接访问。需要注意的是，已开放的网站不一定会带有国家或地区后缀（如 com.hk），其中的 "hk" 通常并非必需。

> **Q: 使用过程中发现网站加载缓慢怎么办？**
> A: 1. 检查网络状况：访问测速网站… 2. 更新浏览器：确保浏览器为最新版本，可通过导航页面的"浏览器及工具下载"按钮进行下载并安装更新。

> **Q: 使用过程中发现互联网上其他网站异常怎么办？**
> A: **Open Browser 浏览器仅处理学术导航上的网站。** 如果您发现互联网上其他网站被异常篡改，建议访问 https://www.12321.cn 进行举报。

> **Q: 为什么问题反馈的图片是必填的？**
> A: 为了更准确地确认故障现象…我们需要通过图片来辅助判断问题是源于网站本身还是**访问通道**。

注意最后一条措辞「访问通道」——**这等于官方承认自己是「通道」角色**。

## 坑
1. **`/download.html` 是前端路由，不是独立页**：它和 `/` 返回**同一份 5943B SPA 壳**。想拿下载清单必须走 `/legacy/download.html` 或打 `client-app-entity/page/list` 接口。
2. **`robots.txt` 也是 SPA 壳**（命中前端 fallback），说明没有真 robots。
3. **业务前缀是 `/api/system`，不是 `/api`**。漏写 `/system` 时后端回 **500「系统繁忙，请稍后再试」**——极易误判成服务挂了。实测：`/api/notice`→500，`/api/system/system-notice-entity/page/list`→200。
4. **分页参数是 `current`/`size`，不是 `pageNum`/`pageSize`**。用后者分页被忽略：每页恒 10 条、翻页仍是第 1 页（实测 11 页全是同一批 10 条，`total=91` 却只拿到 10 个不同 id）。这是 MyBatis-Plus 默认字段名。
5. **`schoolIdList` 必须带**：`[0, 2139]`（0=全部大学，2139=浙大）。不带时 `site-management-entity/page/list` 回 500。
6. **`packagePath` 是逗号分隔多地址**，不是单个 URL。直接当 href 用会坏。
7. **UA 白名单只影响 alert 提示，不影响读内容**——普通 Chrome 单发能读 `/legacy/` 全部内容。所以「必须装专用浏览器才能看清单」是误解；**必须装才能实际访问境外资源**才是真的。
8. **校外网络会失败**：CC98 楼主「没返校直接访问 403」对应 `identifyIP` 识别不出学校。本机在校内（<本机IP>）正常。这条差异在排障时要先问「你在校网吗」。
9. **`systemHelp` 返回 data 为空**不是错误；`notice` 全站只有 1 条「系统迁移通知」。

## 未探候选
- **专用浏览器内实际访问 Google/Scholar/JSTOR 是否通**（需安装客户端，本次禁止）。这是唯一没闭环的环节。
- `/legacy/ytb/` YouTube 资源列表的接口结构。
- `/api/system/site-connect-entity/site/fetch/{id}`（站点连通性探测，需登录态）。
- `/permission/tokenregist` 与 `/personal-center` 的前端路由（登录/令牌注册，未探）。

## 与浙大其它通道的关系
| 通道 | 是否同一件事 |
|---|---|
| RVPN / 网费（`myvpn.zju.edu.cn`） | 不同。RVPN 是校内资源反向接入，网费是计费。 |
| WebVPN（`webvpn.zju.edu.cn`） | 不同。WebVPN 是 URL 包装式代理。 |
| 本服务（`scholar.edu.cn`） | **专项：只处理「学术导航上的网站」的出境访问**，需专用客户端。 |
