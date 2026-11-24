# 计财处财务综合平台 cwcx.zju.edu.cn

## 本页索引

<!-- yonkik:toc -->
> 按节读：先看标题，再 grep -n "^## <标题>" wiki.md 取行号。

- 结论速览（318B 之谜）
- 入口
- 鉴权
- 接口（全部已验证）
- 公开公告区（免登录）
- 坑
- 未探候选（下次从这里接）
- 一证多站

---
**状态：done（2026-11-20 只读探索）** —— 公开区已探通；登录区（预约报销/酬金/国库项目）整体 blocked，原因见「未探候选」。

系统身份：浙江大学**财务综合平台**，厂商 Wingsoft（惠光软件）高级财务管理平台，服务端 nginx 改写版（`Server: Web Server/x.x.x`）。

## 结论速览（318B 之谜）

**「318B 空响应」不是空站、不是错误页、不是 SPA 空壳，而是一段纯 JS 跳转壳。** 原文（318 字节，`text/html;charset=ISO-8859-1`，无 `<title>`）：

```html
<script language="javascript">
  document.location.href="WFManager/login.jsp";
  if ( window.location.href){
    var str = window.location.href;
    if(str.indexOf("pay.zju.edu.cn") != -1){ document.location.href="payment/login.jsp"; }
    else { document.location.href="WFManager/login.jsp"; }
  }
</script>
```

也就是说：**单发 GET `/` 永远只拿到这 318 字节**（不执行 JS），真实入口是 `/WFManager/login.jsp`（17.3KB，title=「欢迎访问浙江大学信息门户」）。同一壳还揭示本站在 `pay.zju.edu.cn`（浙大收费平台）有姊妹部署。

→ **爬虫第一句必须是 `/WFManager/login.jsp`，不要停在 `/`。**

## 入口
- `GET /` → 318B JS 跳转壳（见上）。
- `GET /WFManager/` → 302 → `http://cwcx.zju.edu.cn/WFManager/login.jsp`（**http 明文**）。
- 真实登录页：`/WFManager/login.jsp`。
- 业务前缀统一 `/WFManager`。

## 鉴权
两条路并存：
1. **页内账号密码 + 附加码**：`#uid` / `#pwd` / `#chkcode1`（图 `code_validateCode.action`）/ `#zhLogin`。
   - 密码加密是 **Base64**（`js/jiami.js` 的 `formInfoDealer`），**不是 RSA**——与 zjuam CAS 完全不同，别套 CAS 那套。
   - 另有短信码登录（`activation_huoQuCodesj.action`）与扫码登录，见 `js/login.js`。
2. **浙大通行证 CAS**：登录页「请点击【浙大通行证登录】」按钮 → `GET /WFManager/home2.jsp` →
   `302 zjuam.zju.edu.cn/cas/login?service=http%3A%2F%2Fcwcx.zju.edu.cn%2FWFManager%2Fhome2.jsp`。
   - 凭据键仍是 `campus-sso`（CAS 家族）。

## 接口（全部已验证，200）
| 接口 | 方法 | 用途 |
|---|---|---|
| `/` | GET | 318B JS 跳转壳（真实形态） |
| `/WFManager/login.jsp` | GET | 登录页 + 内嵌公告栏（免登录） |
| `/WFManager/` | GET | 302 到 login.jsp（http） |
| `/WFManager/home2.jsp` | GET | 302 到 zjuam CAS（service 为 http 明文） |
| `/WFManager/index.js` | GET | `AddTitle()` 公告渲染脚本 |
| `/WFManager/js/login.js` | GET | 登录/短信码/扫码逻辑 |
| `/WFManager/js/jiami.js` | GET | Base64 加解密 |
| `/WFManager/common/news.jsp?id={n}` | GET | 公告正文（**gb2312**） |
| `/WFManager/smsuserinfo.jsp` | GET | 重置密码页 |

## 公开公告区（免登录）
登录页左栏由 `index.js` 的 `AddTitle(标题, 链接)` 逐条渲染，**未登录即可读**，实测 **66 条**，覆盖 2005→2026。最值得注意的几条（原文标题）：
- 「关于学费到款线上认领系统试运行的通知」（id=66，最新）
- 「关于暂停使用财务系统的通知（2024-7-25）」
- 「关于2023年终财务账套结转及差旅平台年底关闭的通知」
- 「关于2022年会计档案开通线上自助查询（试运行）的通知」
- 「关于浙江大学差旅平台启动试运行的通知」
- 「关于因弱口令问题现无法登录财务综合平台的通知」
- 「关于本系统用户号统一切换通知」

正文接口：`/WFManager/common/news.jsp?id=N`。

**id 不是连续的**（实测）：1、24、39、50、57、63、64、66 存在（200）；**65、67、100 返回 500**（nginx 497B 错误页）。枚举时按状态码跳过，别当成断链。

**这是本站最有复用具价值的部分**：财务系统停机/结转/开账时间都发在这里，查「为什么报不了销」时先读公告栏，比盯预约界面有用。

## 坑
1. **`/` 只有 318B JS 跳转壳**——本页最重要的一条。curl/单发不执行 JS，会误判成「站点是空的/挂了」。直接打 `/WFManager/login.jsp`。
2. **全站是 http 明文跳转**：`/WFManager/` 302 到 `http://`；CAS 的 service 串也是 `http%3A%2F%2Fcwcx.zju.edu.cn`。浏览器/客户端若强制 https-only 或 SameSite=Strict，回跳会丢会话。
3. **公告正文是 gb2312**：`common/news.jsp` 返回 `text/html;charset=gb2312`，按 UTF-8 解会得到乱码（实测 title 解出来是「����ѧ�ѵ�...」）。`lib/http.mjs` 按 utf8 解码，拿中文需自行按 gb2312 重解码或用 playwright。
4. **密码加密是 Base64 不是 RSA**：`js/jiami.js` 只有 base64EncodeChars/DecodeChars。别照搬 zjuam 的 RSA 流程。
5. **公告 id 不连续**：65/67/100 等返回 500，枚举要按状态码跳过。
6. **`/WFManager/login.do`、`/WFManager/userinfosj.jsp`、`/WFManager/waiting.html`、`/index.html`、`/cwcx/` 全部 404**（nginx 默认错误页 497B），别拿这些猜路径。
7. **登录页有两条过时公告弹窗与缓存提示**（`myFunction()` 里写着「2021年元旦至5日年终决算」；右下角浮窗提示「清浏览器缓存否则预约不了」）——**这是历史遗留文案，不代表当前状态**，别据此判断系统在停用。

## 未探候选（下次从这里接）
**登录区整体未探（blocked）**，缺的是「合法登录态 + 允许进入业务页」。CC98 的 19 帖全部指向登录后模块：
- 预约报销额度（可约/已满/蹲不到）
- 酬金预约（劳务酬金查不到）
- 中央国库项目报账
- 资金有效日期 / 修改预约单

若后续要接：需 CAS 登录（`campus-sso`）→ 进 `/WFManager/home2.jsp` → 抓预约报销模块的只读查询 XHR。**额度查询是 GET/查询语义，可做；提交预约是写，禁止。**

## 一证多站
`_sso.json` 已把 cwcx 登记在 `zjuam-cas` 家族（credentialKey `campus-sso`）。
