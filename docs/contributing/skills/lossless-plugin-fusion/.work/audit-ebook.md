# 数据源审核结果 · source/ebook

**审核代理**：`de251c7e`
**结论**：**高质量的移植** —— 19/19 测试全绿、D17 分层零违规、`requires` 与 import 一致、命名无冲突，**无阻断级缺陷**。
主要问题两处：`decodeEntities` 被降级为手写 5 实体（已实测复现）、请求链路完全没有超时。

---

## 阻断级：**无**

`node --test tests/ebook.test.mjs` → 19 pass
`node --test tests/source-capability.test.mjs` → 7 pass

---

## 重要（7 条）

### I-1 / I-2 · 实体解码降级（**已实测复现**）

`ebook.js:75-77` 用手写 5 条 `replace` 替代上游的 `decodeEntities`（`core/html.ts:8-13`）。

**代理实测**：
```
输入：<strong>&ldquo;C++&#20043;&#x9053;&rdquo;</strong>
本仓：&ldquo;C++&#20043;&#x9053;&rdquo;   ← 裸实体
上游：应为解码后的中文
```

且 `&amp;` **先替换导致双重解码**：`&amp;lt;b&amp;gt;` → `<b>`，上游为 `&lt;b&gt;`。

→ **直接污染中文书名、著者、出版社。**

### I-3 · 全链路无超时

`ebook.js:253`、`:289` → `index.js:31-34` → `http/src/index.js:63-73` → `egress.js:275-279` → `undici.fetch`

**没有任何一层设 `AbortSignal`。** 等于删掉了上游唯一的保护（`index.ts:91-96` 的 30s 超时 + 连接错误重发一次）。

而本仓注释自己写着「含汉字用 T_W_A **35 秒无响应**」（`ebook.js:16-18`）—— 半开连接会**无限挂起**，路由也不 `res.end()`。

### I-4 · HTML 结构漂移**静默变成「查不到」**

`ebook.js:123/125/126/137` + `:341-344`

**代理实测**：以下四种真实可能的漂移全部返回 `total=42, records=0` → `{books:0, count:0, hasMore:true}`：

| 漂移 | 结果 |
| --- | --- |
| `<a>` 属性换序 | 0 条 |
| `<div class="SS_Holding history">` | 0 条 |
| `class="SS_Holding "`（多空格） | 0 条 |
| `<strong class="t">` | 0 条 |

**而「不代表没有纸质书」这句关键前提只在 `total===0 && !sourceErrors.length` 时拼接** —— `total=42` 故**不出现**。

**用户看到「0 本」且无任何提示。**

### I-5 · README.md 确实不存在

包内仅 5 个文件。**评级：不是发布阻断**（npm 对 `files` 里不存在的条目静默忽略），但：
- `scripts/source-check.py:812/:822` 会判 README 覆盖 **WARN**
- `docs/contributing/CONTRIBUTING.md:237` 要求包内有 README

**代理诚实补充**：`cnki`、`http` 同样缺 README 且同样在 `files` 里声明 → **属仓级存量缺口，非本包独有**。

### I-6 · 未挂载

`profiles/zju-workbench/package.json` 的 44 条 bundles **无** `@lybx-leyw/dsh-zju-source-ebook`，而 `cordis.patch.yml` 已写好 insert。
`scripts/profile.mjs:337` 只遍历模板 bundles，不会自动补 → **服务与路由运行时都不存在**。
同缺：`cnki` / `chalaoshi` / `yjsy` / `netproxy`。

### I-7 · 夹具是**按正则反向构造**的

`tests/ebook.test.mjs:21-31`：独立 span、class 字面量、无嵌套、`href` 用**裸 `&U=`**。

- **全仓零 `&amp;U=` 用例** → `ebook.js:128` 的 `(?:amp;)?` 分支**零覆盖**
- 书名 `<strong>` 带属性、`SS_Authors` 嵌套**零覆盖**

→ **19 条测试一条都不会红。**

---

## 次要（7 条）

| # | 问题 |
| --- | --- |
| S-1 | 单引号属性直接 `SHAPE`（与上游同源） |
| S-2 | 双源失败只抛导航那条错误，**超星错误彻底丢失**（与上游同）；测试刻意只断言 `instanceof` |
| S-3 | 错误码未覆盖网络错误 / `JSON.parse` 失败（落 `FAILED`） |
| **S-4** | **ISBN-10 静默丢掉超星整条来源** —— 实测 `7-111-40701-8` → `超星:0`，13 位则 `超星:1`；而 `:243` 校验明确允许 10 位 |
| S-5 | `limit='abc'` → `pagesize=NaN` + `count:null`；`limit=-2` → `count:-2`。上游靠 CLI 的 `min:1,max:50` 拦，本包无 CLI 故无人拦 |
| S-6 | 导航请求不带 UA/Referer（**推测，未验证**该站是否因此拒绝） |
| S-7 | 链接解码失败被静默丢弃 |

---

## 三个「重点问题」的直接答复

### 1. 七字段是否逐字段一致：✅ **全部一致**

`books` / `count` / `found` / `hasMore` / `matchedBy` 逐字同构；`sourceErrors` 与上游同为**条件出现**。

**`note` 完整搬运** —— 逐字符归一化比对：上游 316 字符 vs 本仓 315 字符，**唯一差异在偏移 305：`--isbn` → `ISBN`**（CLI 标志改数据层参数名，正确适配）。「不代表没有纸质书」这句**在**。

⚠️ 但它的**触发条件**有缺口（I-4）。

### 2. `cjk` 是否等价：✅ **完全等价**

`ebook.js:80` 与上游 `index.ts:39` **逐字符相同**（`/\p{Script=Han}/u`），`term` 取值路径也同。

### 3. 解析是否逐条一致：除实体解码外**全部逐字一致**

代理逐条核了 15 项：`SS_ResultsCount` 正则、`.SS_Holding` 分块、`SS_JournalTitle>strong`、`U=` 解码（含 `&amp;`）、ISBN 取 13 位、`SS_Date` 取年份、阅读方式、URL 参数、publisher 前缀、`merge` 键/补字段/输出键序、`interleave`、`PAGE=20/MAX_PAGES=6` 与三个 break 条件、`field=1`/`all` 分支、登录页检测。

**两处有意改进**：
- 导航登录页判据放宽为 `/Serials Solutions Authentication/i`（去 `Service` 后缀 + `i`），**注释写明了理由** —— 代理评价「偏离上游的正确姿态」
- 超星 ISBN 分支沿用 `min(max(limit,10),40)`

---

## 上游覆盖度对账

`index.ts` 共 6 个导出：

| 上游 | 本仓 | 判定 |
| --- | --- | --- |
| `HOST` | `NAVIGATOR_HOST` | ✅ |
| `requirements` | `dsh.capability` + `hosts.js` | ✅ |
| `class Ebook` | **明确丢弃**（request 注入；生命周期由 `ctx.effect` 承担） | ✅ 理由成立 |
| `EbookQuery` | `searchEbooks` 形参 | ✅ |
| `openEbook` | **明确丢弃**（等价物是 `provide` + `requestOf`） | ✅ 理由成立 |
| `searchEbooks` | ✅ | ✅ |

`Ebook` 四方法：`navigator` ✅ / `chaoxing` ✅ / `get` **无对应物**（I-3）/ `close` ✅
`module.json` 1 条能力**已实现**；`cli.ts` 按 D17 明确丢弃。

---

## 做得对的地方（12 条，择要）

1. `cjk` / 分页 / 合并 / 交错**逐字对齐上游没乱改**
2. **`note` 完整搬运** —— 最易丢的关键前提保住了
3. **登录页判据主动放宽并写明理由** —— 偏离上游的正确姿态
4. `record()` 不写空字段
5. `ACCESS` 只给写明的平台加说明（「编一句怎么用比不说更糟」）
6. `allSettled` + `sourceErrors` 部分成功语义且写进 `note`
7. `LOGIN_REQUIRED ≠ SHAPE ≠ 空结果` 分工清楚
8. D17 零违规
9. 路由/服务名全仓唯一（9 条 `/api/zhiyun-*` 无冲突）
10. `network: campus` 判据正确（两站都在 campus 实测表）
11. `OWNERS` / `cordis.patch.yml` 与兄弟包逐字同
12. **测试用 `fakeRequest` 记录 `calls` 断言「不该发的请求没发」（`S=T_W_A` 未出现）—— 比「结果对不对」更有价值**

---

## 附注

代理指出上游未登记进根 `ATTRIBUTION.md` 的「含实现移植」一节（`:77` 起只列 OpenMAIC/ZJU-Omni/DeepTutor）—— **移植完成后的关联待办，非本包代码缺陷**。

---

## 四包总览

| | cnki | chalaoshi | yjsy | **ebook** |
| --- | --- | --- | --- | --- |
| 阻断 | 5 | 2 | 1 | **0** |
| 重要 | 7 | 10 | 9 | **7** |
| 测试 | 31 ✅ | 23 ✅ | 21 ✅ | 19 ✅ |
| 解析层 | 高 | 高 | 很高 | **很高（15 项逐字）** |
| 核心缺陷 | 传输/登录/cookie 全错 | hot 公式 + 缓存损坏 | `jar:null` + 隐私泄露 | 实体解码 + 无超时 + 漂移静默 |

**ebook 是四个里唯一能算「实现正确、有明确改进项」的包。**
它的缺陷类型也最轻：实体解码（一处改动）、超时（一处改动）、漂移检测（一处改动）。
