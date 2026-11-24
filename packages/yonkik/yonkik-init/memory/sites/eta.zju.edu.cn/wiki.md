# ETA 奖学金申请系统 eta.zju.edu.cn

## 本页索引

<!-- yonkik:toc -->
> grep -n "^## <标题>" wiki.md 取行号，只读该节。

- 一句话结论
- 站点身份（不是「ETA 一个系统」）
- 鉴权与匿名可读范围
- 接口
- 从 bundle 提取的接口族（含禁止清单）
- 限流
- 坑
- CC98 主张核实
- 未探候选

---
**状态：done（2026-11-20）** —— 鉴权形态与匿名边界已判定。**本条全程未提交任何申请/评审/材料**。

## 一句话结论

`eta.zju.edu.cn` 是**正方 `zftal-xgxt-web`（学生工作管理平台）**的前端，不是单一「ETA 奖学金系统」。Vue2 SPA 壳 38KB，后端 `.zf` 路由。

**匿名可读的只有 2 个探针接口**（`getCurrentUser` / `getPublicKey`），**其余全部 302 到 zjuam CAS**。奖学金申请、评审、公示、材料上传全在登录区。

## 站点身份（不是「ETA 一个系统」）

- 前端：Vue2 SPA，`/assets/js/app.4370c7dc.js`（**1,876,138B = 1.87MB**），head 里 ~200 个 prefetch chunk。
- 后端：**正方 `zftal-xgxt-web`**，路由后缀 `.zf` —— 与 `zdbk.zju.edu.cn`（正方 jwglxt）是**同一家厂商、不同产品线**。
- 服务器：Tengine/3.0.0。
- 从 bundle 提取的模块（说明它覆盖的面比「奖学金」宽得多）：
  | 前缀 | 含义 |
  |---|---|
  | `/pjpy/**` | 评奖评优（`xmgl` 项目管理、`zcfs` 综测分数、`cpmd` 测评名单、`tjgl` 统计） |
  | `/xspj/**` | 学生评奖评优项目 |
  | `/xsxx/**` | 学生信息（`xsxxxg` 学籍异动、`xscjList` 成绩、`xfqktj` 学分情况、`xygcyj` 学院观测） |
  | `/gygl/**` | 公寓管理（`ldgl` 楼栋、`qsgl` 寝室、`cwgl` 床位） |
  | `/szdw/**` | 师资队伍 |
  | `/rcsw/**` | 人才事务（`aqgl` 安全、`sytj` 统计） |
  | `/filemgr/**` | 文件管理（upload/download/listByIds/delete） |

> 所以「ETA」很可能只是它的一个入口名/子模块；这个域名背后是整套学生工作平台。

## 鉴权与匿名可读范围

**匿名可用（实测 200）**：

| 接口 | 返回 | 判读 |
|---|---|---|
| `GET /zftal-xgxt-web/teacher/xtgl/login/getCurrentUser.zf` | `{"msg":"success","code":0,"data":0}` | **`data:0` = 未登录**。这是登录态探针 |
| `GET /zftal-xgxt-web/teacher/xtgl/login/getPublicKey.zf` | `{data:{modulus:"AI4zcvs4...",exponent:"AQAB"}}` | RSA 公钥（账号密码登录时加密口令；但有 CAS 时不必手搓） |
| `GET /` | SPA 壳 38,156B | title 为空 |
| `GET /ie-warn.html` | 「IE 提醒」1,861B | — |

**需登录（实测 302）**：

```
GET /zftal-xgxt-web/pjpy/xmgl/list.zf
  → 302 https://zjuam.zju.edu.cn/cas/login?service=http%3A%2F%2Feta.zju.edu.cn%2Fzftal-xgxt-web%2Fteacher%2Fxtgl%2Findex%2Fcheck.zf

GET /zftal-xgxt-web/filemgr/file/downloadArea/list.zf
  → 同上
```

**结论**：免登录可见范围 = **零业务数据**。连「有哪些奖学金项目可申请」这种目录级信息都要登录。所以 ETA 对「预备资产」的意义在于**知道它是 CAS 站、知道探针在哪**，而不是能免登录拿数据。

## 接口

详见 `endpoints.json`（5 verified）。

| 名称 | 方法 | 路径 | 鉴权 |
|---|---|---|---|
| 登录态探针 | GET | `/zftal-xgxt-web/teacher/xtgl/login/getCurrentUser.zf` | 无（`data:0`=未登录） |
| RSA 公钥 | GET | `/zftal-xgxt-web/teacher/xtgl/login/getPublicKey.zf` | 无 |
| 任何业务 | GET/POST | `/zftal-xgxt-web/**/*.zf` | **CAS** |
| SPA 壳 | GET | `/` | 无 |

## 从 bundle 提取的接口族（含禁止清单）

从 `app.4370c7dc.js` 提取到约 200 条 `.zf` 路由。**只列只读的，写操作一律禁止**：

**疑似只读（未单发验证，均需登录）**：
```
/pjpy/xmgl/list.zf            评奖评优项目列表
/pjpy/xmgl/details.zf        项目详情
/pjpy/tjgl/getPjpyTjList.zf  统计列表
/pjpy/tjgl/actRsList.zf
/pjpy/cpmd/list.zf           测评名单
/pjpy/zcfs/zcfsList.zf       综测分数列表
/pjpy/zcfs/zcfstjList.zf
/xspj/pjxm/list.zf           学生评奖项目
/xsxx/xsxxxg/xscjList.zf     学生成绩列表
/xsxx/xsxxxg/xfqktjList.zf   学分情况统计
/szdw/ql/list.zf             师资
/gygl/ldgl/list.zf           楼栋
/gygl/qsgl/list.zf           寝室
```

**⛔ 写操作 —— 按安全契约绝不调用**（列出仅为让下一个 agent 认出并避开）：
```
/pjpy/xmgl/save|update|remove|sort|tj|sh|sq|copy|fw|bg.zf
/pjpy/zcfs/submit|cancel|save|import.zf
/pjpy/cpmd/lock|unlock.zf
/xspj/pjxm/on-off|remove|save|update.zf
/xsxx/xsxxxg/csszSave|firstLogin.zf
/gygl/ldgl/plscLdxx|plfp|plCancel|check.zf
/gygl/qsgl/plsc|pltj|checkQsh.zf
/filemgr/file/upload|delete.zf
/notification/batch/read.zf
```

> **本任务明确要求「绝不提交任何奖学金申请」——上表就是那条红线的具体清单。**

## 限流

- `/robots.txt` → **返回 SPA 壳**（不存在真 robots）。无 `X-RateLimit-*`。
- 保守默认：串行、并发 1、间隔 ≥2.1s。本次全程串行，0 次 429。

## 坑

1. **bundle 里两种路径前缀混用**：`/zftal-xgxt-web/pjpy/xmgl/list.zf`（全路径）与 `/pjpy/xmgl/list.zf`（相对）。Requests/axios 的 baseURL 是 `""`，相对路径要**手动补 `/zftal-xgxt-web`**。
2. **`getCurrentUser` 的 `data:0` 不代表报错** —— 是「未登录」的正常表示（`code:0` 是成功码）。
3. **SPA 壳 title 为空** —— 别用 title 判断这站是什么。
4. **HTTP → HTTPS 强制 302**（Tengine 层）。所以「明文 HTTP 流量」在**本站入口**上不成立（见 CC98 6677373 核实）。
5. bundle 1.87MB，一次下载即可，别反复拉。

## CC98 主张核实

| 主张（帖 id） | 实测 | 判定 |
|---|---|---|
| 6663417「ETA 奖学金申请系统繁忙」 | 匿名访问业务接口 → 302 CAS，无繁忙现象（本次只发了 3 个匿名请求）。申请高峰期的「繁忙」属业务后端并发，公开区无法观察 | **不可判定**（需登录态 + 高峰时段） |
| 5171097「eta 奖学金申请理由写错了」 | 业务接口全在 `/pjpy/xmgl/**`（save/update 类），需登录 | **间接证实**：理由字段是提交后由后端保存，改错要走业务端流程。**本次未做任何提交或修改** |
| 5716375「eta 和教学管理信息服务平台显示学分不一致」 | ETA 侧学分来自 `/xsxx/xsxxxg/xfqktjList.zf`（学分情况统计），zdbk 侧来自 `/jwglxt/cxdy/xscjcx_cXscjIndex.html`。**两个独立后端各算各的** | **结构性证实**：两套系统不同源，学分统计口径可能不同。**这是架构事实，不是 bug** |
| **6677373「ETA不安全？」**（本轮指定核实） | 楼主贴图疑明文传输；1 楼一名用户说「部分流量仍走的明文http，不过ETA只对校网和RVPN开放」。**实测**：`GET http://eta.zju.edu.cn/` → **302 → https**，`GET http://eta.zju.edu.cn/zftal-xgxt-web/...zf` → **302 → https**（Tengine 强制跳转） | **部分证伪**：**站点入口已强制 HTTPS**，不存在明文主流量。合规说法应为「历史上部分子资源/后端链路曾走明文，入口层现已 TLS 强制」。1 楼「只对校网和 RVPN 开放」这点**本次无法验证**（本机在校外网络也能 200/302，说明对外网并非完全关闭） |

> ⚠️ 关于「ETA」这个名字的**检索噪声**：Lead 已指出 CC98 搜索「ETA」会命中「BETAFPV LiteRadio」等无关帖（ETA 是子串）。所以基于关键词的 8 帖/34 回复统计**不可作为准数**。

## 未探候选

1. **登录后只读区**：`/pjpy/xmgl/list.zf`（有哪些奖学金项目）、`/xsxx/xsxxxg/xscjList.zf`（成绩）、`/pjpy/zcfs/zcfsList.zf`（综测分）。需 CAS 登录，本次按契约未做。
2. `/notification/**`（通知）—— 疑似只读 + 已读标记（写）。
3. `/api/dynamic/form/find/{formCode}/{extendCode}.zf` —— 动态表单，`dataId={学号}` 参数。**注意 `dataId` 是学号，属个人数据，不得遍历**。

## 一证多站

CAS（zjuam）→ `campus-sso`。`_sso.json` 的 `zjuam-cas` 家族**尚未登记本站**（名单里没有 `eta.zju.edu.cn`），建议 Lead 回写时补入。
