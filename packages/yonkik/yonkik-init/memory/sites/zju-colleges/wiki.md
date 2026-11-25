# 浙大学院站群（62 个子站，聚合探法）

> **本页索引**：这是什么 · 两个致命环境问题 · 能力 · 栏目号怎么找 · 可达清单 · 坑 · 未闭环

**状态**：done（2026-11-22）｜**鉴权**：全免登录｜**可达**：46/62
**脚本**：`crawler.mjs`（list / columns / notices / page）｜配置：`hosts.json`

---

## 这是什么

浙大 62 个**学院/学系/部门子站**（`ai.zju.edu.cn`、`www.cs.zju.edu.cn`、`physics.zju.edu.cn` …）。
它们各自独立发布**通知公告、招生简章、学术活动**，是「某个学院有什么通知」的唯一来源。

这些站不在地图式导航里集中列出——本清单来自 `dsh-zju-assistant` 的 `colleges.json`（62 站），
逐个实测后得到本页的可用性结论。

## 两个致命环境问题（本页最重要）

### 问题 1：代理把所有站解析成伪造 IP `198.18.0.x`

```
bksy.zju.edu.cn      → 198.18.0.4
www.xgb.zju.edu.cn   → 198.18.0.5
ygb.zju.edu.cn       → 198.18.0.6
www.cs.zju.edu.cn    → 198.18.0.7
physics.zju.edu.cn   → 198.18.0.8
```

**`198.18.0.0/15` 是 RFC 2544 基准测试保留段**，绝不可能是真实校园 IP。
它也是 Clash/Surge 类代理 TUN 模式的惯用伪造段：公网站经它完全正常（实测 GitHub 200/537KB、Vercel 200、Cloudflare 200），**只有校内站连不通**——代理出口在墙外，回不到 210.32.x.x。直接请求全部 `ECONNRESET`，看起来像「62 个站全挂了」。

**解法：走 DoH 取真实 IP 并绕过代理直连**，再用 `host: <IP>` + `Host: <域名>` 直连：

```
GET https://223.5.5.5/resolve?name=<host>&type=A   （Host: dns.alidns.com）
→ 真实 IP 在 210.32.x.x（浙大公网段）
```

`crawler.mjs` 已内置 DoH + 内存缓存。

### 问题 2：一半的站根本不开 443

拿到真实 IP 后，**还是有一批 ECONNRESET**——因为 TLS 握手就被 reset。
实测 62 站里 **只有 9 个支持 HTTPS，37 个只有 HTTP(80)**：

| 协议 | 数量 | 例 |
|---|---|---|
| **只有 HTTP(80)** | **37** | `www.xgb` `www.lit` `www.cs` `www.math` `opt` `marx` `www.som` … |
| 支持 HTTPS(443) | 9 | `ai` `bms` `ic` `icsr` `ls` `mse` `physics` `polymer` `www.phs` |
| 不可达 | 16 | DoH 也查不到 A 记录 |

对 HTTP-only 的站，**任何 SNI 变体都救不了**（试过默认 SNI / 无 SNI / IP 当 SNI，全 reset）。

`crawler.mjs` 的做法：先按 `hosts.json` 记录的 proto 试，失败自动降级另一个。

## 能力

```bash
node sites/zju-colleges/crawler.mjs list                          # 46 个可达站 + 协议 + 是否有通知栏目
node sites/zju-colleges/crawler.mjs columns www.cmm.zju.edu.cn    # 列出该站所有栏目（实测 42 个）
node sites/zju-colleges/crawler.mjs notices www.lit.zju.edu.cn tzgg   # 读通知列表（实测 13 条带日期）
node sites/zju-colleges/crawler.mjs all-notices                   # 批量：46 站，实测 31 站成功 / 215 条
node sites/zju-colleges/crawler.mjs page www.cs.zju.edu.cn /     # 读任意页正文
```

**批量实测（2026-11-22，`all-notices`）**：46 站扫描 → **31 站拿到通知**、共 **215 条**。

几个样例（真实抓取）：

| 学院 | 栏目 | 条目 | 最新一条 |
|---|---|---|---|
| 计算机学院 | `/csen/27028` | 15 | 香港科技大学代表团访问浙江大学计算机学院 |
| 集成电路学院 | `tzgg_54532` | 14 | 浙江大学“集成电路科学与工程”博士后科研流动站获批设立 |
| 海洋学院 | `tzgg` | 20 | 第七届地球物理流体泥沙运动两相模拟研讨会 |
| 文学院 | `tzgg` | 13 | 浙江大学文学院诚聘海内外英才 |
| 软件学院 | `gggs` | 13 | 2026.11.19 分散自行采购评审会议纪要 |
| 医学院 | `xzfc` | 1 | 迷彩映心，白衣启航丨医学院慰问全体参训学生 |

## 解析必须用 DOM，不能用正则

**这是本轮最重要的一条经验。**

正则版（`<a href>` + 三级 title 回退）在 `www.lit/tzgg` 只抓到 **4/14 条**；
改用 linkedom 真实 DOM 后抓到 **13 条**（另外 1 条是页脚重复链接）。**差 3 倍。**

原因：Webplus `simpleList` 模板的 DOM 是

```html
<li class="list-item">
  <a href="/2026/1028/c64565a3220069/page.htm">
    <div class="content">
      <div class="date"><p class="y">2026-10</p></div>
      <div class="info clearfix">
        <p class="title">标题正文</p>
        <p class="dec">摘要…</p>
      </div>
    </div>
  </a>
</li>
```

`<a>` 内套了三四层 div，正则要么写的 `[sS]{0,800}` 够不到，
要么因为贪婪匹配把相邻条目吃掉。**深层嵌套 + 结构不统一 = 正则必然漏。**

**实现**：用 pnpm store 里现成的 `linkedom@0.18.15`（本 profile 没直接装，被其它包间接带上）：

```js
const { DOMParser } = await import('file://<本地路径>/.pnpm/linkedom@0.18.15/node_modules/linkedom/esm/index.js')
const doc = new DOMParser().parseFromString(html, 'text/html')
doc.querySelectorAll('a[href]')        // 标准 DOM API
```

注意 linkedom 的 **`document.textContent` 是 null**（不是空串），要取 `doc.body.textContent`。

## 「首页是跳转页」要自动跟子路径

部分站的首页只是个跳板，真站在子目录：

| 站 | 首页 | 真站 |
|---|---|---|
| `www.cs.zju.edu.cn` | 6,530B，只有 4 个 a 标签 | **`/csen/`** 38,823B，10+ 栏目 |
| `me.zju.edu.cn` | 879B | **`/mecn/`** |
| `www.cab.zju.edu.cn` | 1,427B → `office.cab.zju.edu.cn/main.htm` | 另一个域名 |

**判据**：首页 `a` 标签极少（<5）且没有任何 `list.htm` 栏目时，抓首页里指向子目录的 `.htm` 链接试一遍。
`crawler.mjs` 的 `all-notices` 已内置（`homeCandidates`），加上后成功站 29 → 31。

## 栏目号怎么找（两种体系）

| 体系 | 形态 | 例 |
|---|---|---|
| **数字栏目号**（Webplus 老站） | `/<4-6位数字>/list.htm` | `bksy/76425`（学籍管理）、`www.xgb/53388`（最新通知）、`ygb/31555` |
| **拼音栏目名**（新模板） | `/<拼音>/list.htm` | `www.lit/tzgg`（通知公告）、`/xyjj`（学院简介）、`/szdw`（师资队伍） |

**别猜栏目号，用 `columns` 从首页抓**。同一站群两种体系并存。

## 条目链接的三种格式

| 格式 | 例 | 站点类型 |
|---|---|---|
| `/yyyy/mmdd/cNNNaNNN/page.htm` | `/2026/1020/c64565a3216836/page.htm` | Webplus |
| `/info/NNNN/NNNNN.htm` | `/info/1036/104067.htm` | VSB（博达） |
| `content.jsp?wbtreeid=&wbnewsid=` | `content.jsp?urltype=news.NewsContentUrl…` | VSB 老条目 |

## 坑

1. **标题不在 `title` 属性里是常态**。Webplus `simpleList` 模板的标题在 `<a>` 内文的
   `<p class="title">` 里，且 `<a>` 内还套着 `<div class="date">` 等多层。
   `crawler.mjs` 按「`title` 属性 → `<p class="title">` → 内文」三级回退取。
2. **首页常常抓不到条目**：首页的通知区块可能是 JS 渲染或只放 3-5 条。
   **要先 `columns` 找栏目，再 `notices <host> <栏目>`**，别指望首页。
3. **部分站首页只有 500B-2KB**（框架页/重定向页），如 `www.cas`（585B）、`www.ccea`（483B）、
   `www.sis`（582B）。这类站标题为空不是坏了，是首页本身就这么小，内容在子页。
4. **`www.cls.zju.edu.cn` 与 `www.cls.office.zju.edu.cn` 是两个不同站**，后者 DoH 查不到（已下线）。
5. 有些站首页链接指向**兄弟域名**（`www.lit` 首页里出现 `literature.zju.edu.cn`），
   后者本地 DoH 也没有 A 记录——**站群内部存在已废弃的交叉链接**。

## 可达清单（46/62）

<details>
<summary>展开看全部（host / 协议 / 标题）</summary>

| host | proto | 标题 |
|---|---|---|
| ai.zju.edu.cn | https | 浙江大学人工智能学院 |
| bms.zju.edu.cn | https | 基础医学系 |
| che.zju.edu.cn | http | 化学工程与生物工程学院 |
| ee.zju.edu.cn | http | 电气工程学院 |
| gs.zju.edu.cn | http | 地球科学学院 |
| ic.zju.edu.cn | https | 集成电路学院 |
| icsr.zju.edu.cn | https | 网络空间安全学院 |
| ls.zju.edu.cn | https | 历史学院 |
| marx.zju.edu.cn | http | 马克思主义学院 |
| me.zju.edu.cn | http | 机械工程学院 |
| mse.zju.edu.cn | https | 材料科学与工程学院 |
| oc.zju.edu.cn | http | 海洋学院 |
| opt.zju.edu.cn | http | 光电科学与工程学院 |
| physics.zju.edu.cn | https | 物理学院 |
| polymer.zju.edu.cn | https | 高分子科学与工程学系 |
| saa.zju.edu.cn | http | 航空航天学院 |
| sociology.zju.edu.cn | http | 社会学系 |
| www.cab.zju.edu.cn | http | 农业与生物技术学院 |
| www.caefs.zju.edu.cn | http | 生物系统工程与食品科学学院 |
| www.cbeis.zju.edu.cn | http | 生物医学工程与仪器科学学院 |
| www.cec.zju.edu.cn | http | 经济学院 |
| www.ced.zju.edu.cn | http | 教育学院 |
| www.cmic.zju.edu.cn | http | 传媒与国际文化学院 |
| www.cmm.zju.edu.cn | http | 医学院 |
| www.cps.zju.edu.cn | http | 药学院 |
| www.cs.zju.edu.cn | http | 计算机科学与技术学院 |
| www.cse.zju.edu.cn | http | 控制科学与工程学院 |
| www.cst.zju.edu.cn | http | 软件学院 |
| www.doe.zju.edu.cn | http | 能源工程学院 |
| www.ghls.zju.edu.cn | http | 光华法学院 |
| www.isee.zju.edu.cn | http | 信息与电子工程学院 |
| www.lit.zju.edu.cn | http | 文学院 |
| www.math.zju.edu.cn | http | 数学科学学院 |
| www.neuroscience.zju.edu.cn | http | 脑科学与脑医学学院 |
| www.philosophy.zju.edu.cn | http | 哲学学院 |
| www.phs.zju.edu.cn | https | 公共卫生学院 |
| www.psych.zju.edu.cn | http | 心理与行为科学系 |
| www.soaa.zju.edu.cn | http | 艺术与考古学院 |
| www.som.zju.edu.cn | http | 管理学院 |
| www.chem.zju.edu.cn | http | 化学系 |
| www.cls.zju.edu.cn | http | 生命科学学院 |
| www.cas.zju.edu.cn | http | （空标题，框架页） |
| www.ccea.zju.edu.cn | http | （空标题，483B） |
| www.cers.zju.edu.cn | http | （空标题，1KB） |
| www.sis.zju.edu.cn | http | （空标题，582B） |
| www.spa.zju.edu.cn | http | 公共管理学院 |

</details>

**不可达 16 个**（DoH 无 A 记录）：`ai.office` `bmsoa` `che.cn` `cspo` `doe-oa` `ee.office`
`literature` `oca` `office.cab` `office.cas` `office.chem` `office.cmic` `office.ls` `office.polymer`
`saa.office` `www.cls.office`。

## 未闭环

### 15 个站仍拿不到通知（各有具体原因）

| 站 | 原因 | 可怎么办 |
|---|---|---|
| `che.zju.edu.cn` | 首页 1,198B，0 个 a 标签（纯框架页） | 需 playwright 跟进 frame |
| `ee.zju.edu.cn` | 首页 2,126B 框架页 | 同上 |
| `www.chem.zju.edu.cn` | 2,361B，5 个 a 但无 .htm | 内容在 JS 里 |
| `ls.zju.edu.cn` | HTTP 301 → HTTPS，HTTPS 侧仅 1,431B | 也是跳转页，真站未找到 |
| `www.sis / www.spa / www.cas / www.ccea / www.cers` | 首页 483-996B 极小壳 | 真站可能在别处 |
| `www.cls / www.ghls / www.doe / sociology / www.cab / polymer` | 首页无 list.htm 栏目 | 需人工看导航结构 |

### 4 个站栏目选对了但抓到 0 条

`gs`（35056）、`physics`（tz）、`www.caefs`（tzgg）、`www.cbeis`（gsgg）、`www.math`（tzgg_29114）、`www.psych`（27561）
—— 说明 `pickNoticeColumn` 按名字挑栏目猜错了，或该栏目列表是 JS 渲染。
**调用方应显式传 column 参数覆盖，别依赖自动挑。**

### 其他

- **分页**：栏目列表翻页（`list2.htm` / `list_2.htm`）未探，目前只取首屏。
- **附件**：通知里的 PDF/Word 附件未抓。
- **日期精度**：Webplus 列表页 `.date` 常只有年月（`2026-10`）。我没有补全成具体某天——**补全会造假日期**。
  要精确日期得进详情页（URL 里的 `/2026/1028/` 含 mmdd）。
- **`hasNotice` 字段不可靠**：那是首页关键词判断；现在有 `all-notices` 的真实扫描结果，应以那个为准。
