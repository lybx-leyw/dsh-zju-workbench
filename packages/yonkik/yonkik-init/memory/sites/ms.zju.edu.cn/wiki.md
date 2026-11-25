# 正版软件管理与服务平台 ms.zju.edu.cn

## 本页索引

<!-- yonkik:toc -->
> 按节读：先看标题，再 grep -n "^## <标题>" wiki.md 取行号。

- 结论速览
- 入口与鉴权
- 接口（全部已验证）
- 软件目录（免登录可读的部分）
- 国际学术资源服务（重点，见独立站 scholar.edu.cn）
- 激活方式说明
- 坑
- 未探候选
- 一证多站

---
**状态：done（2026-11-20 只读探索）** —— 软件目录/版本/MD5/帮助文档全部免登录可读；下载与激活需 `user.ms.zju.edu.cn` 登录。

系统身份：浙江大学**正版软件管理与服务平台**（GP 平台），nginx/1.31.3，**仅 HTTP（443 ECONNREFUSED）**。

## 结论速览

1. **免登录能读到软件目录、版本号、MD5、帮助文档全文**——这已经能回答大部分「能不能下、下哪个版本、怎么激活」的问题。
2. **下载被登录拦**：所有下载按钮 → `http://user.ms.zju.edu.cn/login?ret=<回跳页>`。`/down/GP(zju)-4.0.2.0.exe` 未登录实测 **302 到 user 域登录页**。
3. **「国际学术资源服务」= 外部站 https://scholar.edu.cn**，不是一个校内页面。详见下节与 `sites/scholar.edu.cn/wiki.md`。
4. **站是 HTTP-only**：`ms.zju.edu.cn:443` 拒绝连接。别写 https。

## 入口与鉴权
- 首页 `http://ms.zju.edu.cn/` → 15KB，title「正版软件管理与服务平台(浙江大学)」。
- 静态资源在 `content.ms.zju.edu.cn`（css/layui/logo）。
- 登录域 **独立**：`http://user.ms.zju.edu.cn/login?ret=http://ms.zju.edu.cn`（所有下载按钮的 href 都是它）。
- `robots.txt` = `User-agent: *` + `Disallow:`（全站允许，25 字节）。

## 接口（全部已验证）
| 接口 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/` | GET | 首页/导航 | 免登录 |
| `/robots.txt` | GET | 全站允许抓取 | 免登录 |
| `/matlab/download.html` | GET | MATLAB 全版本 + MD5 | 免登录 |
| `/adobe/download.html` | GET | Adobe 全家桶 | 免登录 |
| `/microsoft/download.html` | GET | Win/Office/Visio/VS（**含 VS 明文密钥**） | 免登录 |
| `/othersoft/download.html` | GET | JetBrains 授权服务器 + 福昕 | 免登录 |
| `/jmp/download.html` | GET | JMP 学生版说明 | 免登录 |
| `/mworks/download.html` | GET | MWORKS 教育版说明 | 免登录 |
| `/wps/download.html` | GET | WPS365 教育版 | 免登录 |
| `/help/client` | GET | GP 激活客户端说明 | 免登录 |
| `/help/adobe_activate_patch_windows` | GET | Adobe「序列号已被吊销」解法 | 免登录 |
| `/help/officetool` | GET | 帮助中心索引 | 免登录 |
| `/help/f017` | GET | 0XC004F017 错误解法 | 免登录 |
| `/down/GP(zju)-4.0.2.0.exe` | GET | 客户端下载 | **需登录**（302→user 域） |
| `/change_token` | GET | 取 `gp4://` 唤醒 token | **需登录**（未登录 500） |

## 软件目录（免登录可读的部分）

### MATLAB（实测最新 R2025a）
`/matlab/download.html` 免登录列出 R2020b → R2025a **全部版本 × Windows64 / Mac-M / Mac-Intel / Linux64**，每条带 MD5；另有 RoadRunner R2021a。示例：
- MATLAB R2025a Windows 64 位 — MD5 `032C4E21B501B21CAFB1C1A6662B1D4C`
- MATLAB R2025a Mac M — MD5 `821FBED37CBF8E414D1C89CB5405B9E6`（需先装 Java 运行时）
- MATLAB R2025a Linux 64 位 — MD5 `4E326697E1555EDBBD88C232A0935F09`

### 微软
`/microsoft/download.html`：Windows 10/11 专业版、Office 2016 / 2019 / 2021 LTSC / 2024 LTSC、Mac Office 2016/2019/2021/2024、Visio 2010/2013/2016/2019/2021/2024、Visual Studio 2019/2017。
**Visual Studio 的密钥直接明文印在页面上**（页面公开印出具体 25 位密钥，此处不复录）：VS2019 `<密钥>`；VS2017 `<密钥>`。

### JetBrains（`/othersoft/download.html` 原文）
> 信息技术中心和 JetBrains 公司合作，针对校园网络环境推出校园授权服务…在校师生仅需连接上校园网络，访问校园授权服务器，开启 JetBrains IDE 时即可自动获取授权。
> Help > Register... > Get license from 选 **License server**，填 **`https://fls.zju.edu.cn`**（必须含 https）→ Active。
> IDE 每 10 分钟向服务器延长许可；**断连后仍可续用 48 小时**。教育许可证**不得用于商业/兼职/实习项目**；课堂许可证**不得用于开发内部项目**。

### 其他许可模式（都不是「点下载就行」）
- **MATLAB**：用 @zju.edu.cn 邮箱在 MathWorks 侧注册取许可证。
- **Adobe**：下载后用 @zju.edu.cn 邮箱登录、跳统一身份认证。
- **JMP 学生版**：到 jmp.com 学术认证后免费下载，**每 12 个月续订**，全体在校师生。
- **MWORKS（同元）**：tongyuan.cc 下载，**浙大教育邮箱注册同元账户**申请教育版许可，**6 个月，可免费续期**。
- **WPS**：浙大 WPS365 教育版（有独立下载及使用指南）。

## 国际学术资源服务（重点）

导航栏那一项 `<a href="https://scholar.edu.cn/client-application-download">国际学术资源服务</a>` **不是校内页面**，而是外部站 **`scholar.edu.cn`**（京ICP备15006448号-79）。

它是**「学术专用出境服务 + 专用浏览器」**形态，不是 WebVPN/RVPN，也不是网页代理。**完整侦察结论见 `sites/scholar.edu.cn/wiki.md`**，此处只留入口结论：
- 平台名「学术资源服务」，SPA 壳在裸域；真实导航页是 **`https://scholar.edu.cn/legacy/`（92KB 静态 HTML，免登录、内容完整）**。
- 必须用**专用 Open 浏览器 / 夸克云桥版 / 千问科创版**访问；普通 Chrome 打开导航页会被 alert 提示「请在导航页右上角『浏览器及工具下载』下载『适配浏览器』使用」。
- 资源清单免登录可读：91 条站点（Google/Scholar/Gmail/GitHub/Wikipedia/HuggingFace + JSTOR/ScienceDirect/Springer/Wiley/Taylor&Francis/Oxford Academic/Sage/World Scientific/Ingenta + PubMed 系 NCBI + 28 所海外高校）。

## 激活方式说明（`/help/client` 原文要点）
1. 下载 GP 激活客户端（当前 **4.0.2.0**）。
2. 首次运行自动弹登录界面，**用统一身份认证登录**（已登录则点页面上「登录客户端」）。
3. 登录后自动弹「商品激活管理」窗口——**Windows 和 Office 默认各分配 10 次激活次数**。
4. 勾选产品 → 「立即激活」。

首页四条注意事项原文：
1. 请使用平台的镜像安装并激活。**微软需每半年激活一次**。平台不支持 Win 旗舰版/家庭版/破解版等版本的激活。
2. 安装 Office 时用平台提供的卸载工具清除以前安装的其它 Office 版本。
3. 下载激活客户端进行激活，并注意：a) 校园网络环境；b) 电脑设置时间正确；c) 杀毒软件完全退出。
4. 安装客户端后，使用统一身份认证登录，并激活。

## 坑
1. **站点 HTTP-only**：`ms.zju.edu.cn:443` **ECONNREFUSED**。用 https 会直接失败并误判成「站点挂了」。
2. **登录域是 `user.ms.zju.edu.cn`，不是 ms 本域**。看到 `302 → user.ms.zju.edu.cn/login` 就是「要登录」，不是错误。
3. **软件目录页 ≠ 下载页**：`/matlab/download.html` 里的「下载」按钮 href 是 `user.ms.zju.edu.cn/login?ret=…`。所以「免登录能看到版本号与 MD5，但下不了文件」是设计如此，不是 bug。
4. **不能靠 https 跳到 scholar.edu.cn 之后就以为同源**：它是公网域名（不在 zju.edu.cn 下），校内/校外网络路径不同。
5. **`/jetbrains/download.html` 是 404**——JetBrains 没有独立目录页，内容在 `/othersoft/download.html` 里。
6. **页脚外链 `https://software.zju.edu.cn`** 是另一个正版软件域名（未探），别把它和 ms 混为一谈。
7. **帮助页有大量历史遗留错误码**（0XC004F074/F035/C003/F017、0x80070002、0xEFFFFFF…），是按错误码直接索引的；「无法激活」先按码查页，比问人快。

## 未探候选
- `user.ms.zju.edu.cn` 登录流程（CAS/统一身份认证）与登录后下载签名链接。
- 「正版软件AI小助手」的端点。
- `https://software.zju.edu.cn`（页脚外链，可能是旧域名或并行站）。
- Adobe 授权「每隔几天要重新认证」的机制（CC98 6530235）——需要 Adobe 侧账号授权管理文档，`/help/adobe_activate_patch_windows` 只覆盖「序列号已被吊销」。

## 一证多站
`user.ms.zju.edu.cn` 的登录走**统一身份认证**（页面原文「师生可通过统一身份认证登录下载安装激活」）。凭据键仍用 `campus-sso`。
