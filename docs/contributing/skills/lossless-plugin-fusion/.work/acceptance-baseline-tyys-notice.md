# 验收基线 · tyys 与 notice

**用途**：子代理建包时，我作为验收方独立建立的「正确答案」。验收时逐条对照，不采信代理的自述。

---

## 一、tyys（体育场馆预约 + 体艺考勤）

### 上游事实

| 项 | 值 | 备注 |
| --- | --- | --- |
| 代码规模 | 886 行 TS（9 文件 75.3 KB） | |
| `auth` | `cas` | |
| **`network`** | **`public`** | ⚠️ **不是 campus**。主机 `tyys.zju.edu.cn` 公网可达 |
| `writes` | `true` | 但本仓按 D17 只收只读 |
| `hosts` | `tyys.zju.edu.cn`、`www.tyys.zju.edu.cn` | |

### 9 条 provides 与本仓归属

| # | provides | 归属 | 说明 |
| --- | --- | --- | --- |
| 1 | `tyys rollcall history` | **source** | 考勤记录，只读 |
| 2 | `tyys session login` | **source** | 登录不是写操作 |
| 3 | `tyys session status` | **source** | |
| 4 | `tyys session logout` | **source** | 清本地会话 |
| 5 | `tyys venue list` | **source** | 场馆/场地/时段查询 |
| 6 | **`tyys venue book`** | **tool** | ⚠️ 写操作 |
| 7 | `tyys venue order list` | **source** | 订单查询 |
| 8 | **`tyys venue order cancel`** | **tool** | ⚠️ 写操作 |
| 9 | `tyys venue notice` | **source** | 公告 |

**source 应实现 7 条，tool 收 2 条。**

### 签名算法（硬基准，逐字核对）

`sign.ts` 34 行，三处关键：

```js
const KEY = Buffer.from("ad8dad2869c5e017303e5f48858db3129bf4d07a47d85beaaaa9d26f436d232a", "hex");
const MASK = (1n << 64n) - 1n;
```

**1. `signingMaterial(token4)`**：base64 解码后必须 **52 字节**、`readUInt32BE(0) === raw.length`，否则抛 `BadResponse("体艺签名令牌格式无效")`。用 `aes-256-cbc` + `raw.subarray(4, 20)` 作 IV、`setAutoPadding(false)`，解 `raw.subarray(20)`。

**2. `canonicalize(path, query)`**：
- path 必须以 `/api/` 开头，且不含 `#`/`?`/`\r`/`\n`，否则 `ConfigError`
- query 参数**按 (key, value) 双键排序**，拼成 `path + key+value+key+value…`（**没有分隔符**）

**3. `signRequest(material, path, query, epochMs)`**：
- `material.length` 必须 32
- `time` 是 **8 字节大端** 的 `epochMs`
- `mixed` 是 splitmix64 变体：`(ms ^ (ms>>30n)) * 0xbf58476d1ce4e5b9n` → `(x ^ (x>>27n)) * 0x94d049bb133111ebn` → `x ^ (x>>31n)`，每步 `& MASK`
- hash = `sha256(material + canonical + time + reverse(material))` 的 hex，拆成字符数组
- **在位置 `[12, 28, 36, 38, 58]` 依次插入 `"199st"` 的字符**（`splice`，只插字符不替换）
- 返回 `{ timestamp: String(mixed), sign: 插字符后的 hex }`

⚠️ **这五处任一错都会让签名必然失败**，而错误表现为「站点拒绝」，容易被误认为账号问题。

### 只读接口的方法（venue.ts）

`row` / `rows` / `text` / `VENUE_BASE` / `beijingDate` / `localTime` / `atDate` / `addDays` / `targetDate` / `timeRange` / `venueSignature` / `catalog` / `notice` / `day` / `identity`

**注意 `READ_POSTS` 集合**：
```js
const READ_POSTS = new Set(["/api/reservation/order/info", "/api/captcha/check",
  "/api/vip/view/buddy_no", "/api/vip/check/buddy_no"]);
```
**这几个接口用 POST，但是只读**。验收时要看代理有没有把这个区分搞对——如果它按「POST = 写」来判断，会把只读接口误归 tool。

**`WRITES` 集合**：
```js
const WRITES = new Set(["/api/reservation/order/submit",
  "/api/venue/finances/order/pay", "/api/venue/finances/order/cancel"]);
```

### 三个只读接口的缓存与边界

| 接口 | 端点 | 缓存 |
| --- | --- | --- |
| `catalog()` | `GET /api/reservation/campus/venue/info` | **1 天**（`tyys-venue-catalog.json`，进程内也缓存 `catalogValue`） |
| `notice()` | `GET /api/front/website/protocols/code/RESERVATION_PROTOCOL` | **1 天**（`tyys-venue-notice.json`） |
| `day(site, date)` | `GET /api/reservation/day/info`（`venueSiteId` + `searchDate`） | 不缓存 |

⚠️ **`day()` 的 `notReleased` 分支返回 `days: NaN`**：
```ts
if (row(data).notReleased) return { date, open: false, days: NaN, weekStart: "", token: "", slots: [], message: text(row(data).message) };
```
这个 `NaN` 会污染任何算术。验收时看代理是**照搬**（可能是缺陷）、还是**改成 `null` 并说明**。
两种都可接受，但必须有意识地处理，不能不知不觉传下去。

缓存要用**原子写 + mkdir**（chalaoshi 的教训），且 1 天失效判断要真的生效（不是只写不读）。

### `targetDate` 的边界（易错）

- `今天`/`明天`/`后天`/`N天后`/`YYYY-MM-DD` 五种写法
- **`bounded=true` 时只允许今天到三天后（含当天）**，超出抛 `ConfigError("场馆查询与预约仅支持今天至三天后（含当天），不会自动更换日期")`
- 校验 `beijingDate(stamp) !== date` —— 要防「2026-02-30」这类不存在的日期

### vcaptcha（`captcha.ts` 107 行）

导出 `Point`/`Glyph`/`Ask`/`askApp`/`enlarge`/`glyphsIn`/`locate`/`CaptchaSolver`。

**这是「点选式图形验证码」的自动求解**（`enlarge` 放大、`glyphsIn` 找字形、`locate` 定位、`CaptchaSolver` 求解）。验收时判断：
- 它属于**规避站点反自动化措施**
- **不应搬**，但代理必须在 README 如实说明「明确丢弃 + 理由」
- 如果代理偷偷搬了，是**严重问题**

---

## 二、notice（校内通知公告）

### 上游事实

| 项 | 值 |
| --- | --- |
| 代码规模 | **1052 行 TS**（13 文件 153.8 KB） |
| `auth` | `cas` |
| `network` | `campus` |
| `writes` | `false` |
| `hosts` | `zju.edu.cn` |

### 4 条 provides

| provides | 归属 |
| --- | --- |
| `notice list` | source |
| `notice view` | source |
| `notice new` | source |
| `notice sources` | source |

全读，无写操作。

### ⚠️ 三套适配器（我给代理的第一版任务说成了两套，已发消息纠正）

`notice/adapters/`：

| 文件 | 行数 | 导出 | 是否在 `SOURCES` 里 |
| --- | --- | --- | --- |
| `webplus.ts` | 149 | `articleId`、`listColumn` | ✅ 8 个来源用它 |
| `zdbk.ts` | 146 | `listZdbk`、`withFullTitles`、`zdbkDetail` | ✅ 1 个来源用它 |
| `kyjs.ts` | 25 | `kyjsNotice` | ❌ **不在 `SOURCES` 里** |

**`kyjs` 是独立路径**：`index.ts:183` 直接 `await kyjsNotice(session.get, target)`，不走 `SOURCES` 的 adapter 分派。
所以「适配器」与「来源」是**两个维度**，验收时不要混为一谈。

### `SOURCES` 有 9 个来源（我一度数错，这里是核对过的准确值）

**9 个顶层来源，全部都有 `adapter` / `base` / `columns` 三个字段**：

| 计数方式 | 结果 |
| --- | --- |
| `adapter:` 出现次数 | **9** |
| `base:` 出现次数 | **9** |
| `columns:` 出现次数 | **9** |

adapter 分布：**`webplus` 8 + `zdbk` 1 = 9**。

⚠️ **我最初用 `grep '^\s*\{ id:'` 数出 35 条，那是错的** —— 把 `columns` 数组里的 `{ id: "76425", ... }` 也算进去了。`columns` 的总条目数才是那个量级的数字。

**验收时要注意**：如果代理报告「`SOURCES` 有 35 条」或「有 26 条」（后者是我用括号深度法数错的），说明它把 `columns` 与顶层来源混为一谈了。正确值是 **9**。

注意 `columns` 里有些条目是**纯数字 id**（如 `"76425"`），有些是**中文名**（如 `"本科生院通知公告"`）—— 这对应两种不同的列表页地址格式，实现时要都处理。

### ⚠️ 分层冲突（必须处理）

上游 `module.json` 的 `requires` 含 **`zdbk`** —— 但本仓硬规则是「tier 1 不得依赖另一个 tier 1」，而 `notice` 与 `zdbk` 都是 tier 1。

代理必须选一条路并在 README 写明：
- **(A)** 抽公共部分到 tier 0
- **(B)** 在 notice 内独立实现（只用 `source/http` 的 `Transport`）
- **(C)** 明确丢弃 zdbk 适配器

**我倾向 B**。验收时看它选了哪个、理由是否站得住、有没有偷偷 `import ... from '@lybx-leyw/dsh-zju-source-zdbk'`（那是硬违规）。

### 两份数据文件

- `hosts.json` 627 行 —— 主机表
- `colleges.json` 3113 行 —— 学院表

应在 `data/` 下，`files` 里包含 `data/`。**不应内联成 JS 常量**。

---

## 三、验收检查表（两个包通用）

### 上游覆盖度

- [ ] **全部导出逐个列出**，每条给「本仓对应物」或「明确丢弃 + 理由」
- [ ] **不允许第三态**（不能写「部分实现」而不说清哪部分）
- [ ] `module.json` 的每条 provides 都有交代
- [ ] 上游注释里的**实测事实与踩坑点**是否保留（尤其数值型事实）

### 分层合规

- [ ] 无 `ctx.tools.register` / `defineTool`
- [ ] 无写操作（`writes: false` 与代码一致）
- [ ] `requires` 只列本仓 `@lybx-leyw/*`，宿主包走 peerDependencies
- [ ] **tier 1 不依赖另一个 tier 1**
- [ ] 服务名 / 路由名全仓唯一
- [ ] 凭据不由数据源自己读

### 代码质量

- [ ] 纯逻辑与插件入口分离（`src/<name>.js` 不 import cordis）
- [ ] 错误码稳定且覆盖所有失败路径
- [ ] **无静默吞错**
- [ ] 错误文案可操作（不出现「集成层」「setTokenProvider」给终端用户）
- [ ] **超时真的生效**（`sharedFetch` 不读 `timeoutMs`，必须自己 race 定时器）
- [ ] 缓存/落盘用原子写 + mkdir

### 测试质量（前几轮事故最多的地方）

- [ ] 夹具**不配合实现**写；没把握时在文件头标注「未经真实验证」
- [ ] 断言**不是真空真**（空数组上 `every` 永远过）
- [ ] 公式/分派逻辑的夹具**有区分度**（能让对错实现产生不同结果）
- [ ] **集成层有测试**（`apply()`、服务名、路由、非法 action）
- [ ] 代理**实际验证过测试能抓回归**（改坏 → 红灯 → 改回）
- [ ] 数据文件有形状测试

### 工程

- [ ] 文件无 BOM
- [ ] `package.json` 的 `files` 与实际文件一致（**README 真的存在**）
- [ ] `description` 与代码一致（不宣称没实现的能力）
- [ ] workspace 链接 `missing` 为空
- [ ] 已挂 profile（一行，8 空格缩进，用 LF）
- [ ] 已加 `NO_SETTINGS` 白名单（一行）

### 我在前几轮抓到的具体事故（重点排查同类）

| 包 | 事故 | 同类风险 |
| --- | --- | --- |
| yjsy | `session: { jar: null }` → 一次请求也发不出 | tyys 也会用 Transport，**查 session 是否真实** |
| yjsy | 缓存不看 username → 隐私泄露 | tyys 有 session 概念，**查缓存键** |
| chalaoshi | `hot/10` vs `/maxHot*3` | tyys 的签名/时间计算有没有类似的「近似」 |
| cnki | `GET ?kw=<JSON>` 而应 POST 表单 | tyys 的 `READ_POSTS` 里 POST 是只读，**查有没有搞反** |
| cnki | 单位猜测把 20 分钟算成 1.2 秒 | tyys 的 `epochMs` 是毫秒，**查有没有当秒** |
| ebook | 全链路无超时 | notice 站点多，**超时尤其重要** |
| 四个包 | 集成层零测试 | **必查** |
