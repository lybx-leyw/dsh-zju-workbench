# 新建数据源包的前置检查清单

**来源**：`source/yjsy` / `chalaoshi` / `ebook` / `cnki` 四个包的审核结果（94 条测试全绿，3 个包有阻断级缺陷）。
**用途**：建剩下 10 个包时**逐条对照**，把已发生的失败模式变成前置守卫。

---

## 一、三类系统性教训（每条都真实发生过）

### 教训 1 · 夹具配合实现

**现象**：测试全绿，但实现与真实行为不符。

| 实例 | 具体 |
| --- | --- |
| cnki 滑块检测 | 夹具 `<div class="slider">请拖动滑块</div>` **同时含两个关键词** —— 照着我的判据写的 |
| cnki 总数正则 | 夹具 `共找到<span><em>` 的嵌套**恰好让上游正则失配、我的正则命中** |
| chalaoshi hot 公式 | 夹具 hot `90/40` **都 ≥30**，`/10` 与 `/maxHot` 两种公式下差距被完全遮住 |
| chalaoshi ratedOnly | 夹具里没有「姓王的无评分教师」→ 空数组上 `every` 也过 → **删掉过滤逻辑仍绿** |
| ebook `&amp;U=` | 19 条**零覆盖**该分支，夹具只用了裸 `&U=` |
| yjsy 学号边界 | 只测 10 位，`{7,11}` 改错照样绿 |

**前置规则**：

- [ ] **能拿到真实响应的，夹具必须是真实快照**（脱敏后）。拿不到的，**在测试文件头显式写明**：
  `⚠️ 本文件夹具按上游注释手写，未经真实页面验证 —— 它只能证明「实现与夹具一致」。`
- [ ] **每条分支至少一条用例**：正则里的每个可选分支（`(?:amp;)?`）、每个边界（位数、区间端点）、每个「有/无」组合。
- [ ] **写「反证测试」**：故意用错误配置跑一遍，断言它确实失败。已有先例：`tests/webvpn-gateway-login.test.mjs` 的「白名单漏掉网关时登录必然抛错」。

### 教训 2 · 集成层零测试

**现象**：`src/index.js` 零覆盖，而**最严重的缺陷都在那个文件里**。

| 包 | 缺陷 | 位置 |
| --- | --- | --- |
| yjsy | `session: { jar: null }` → 所有请求必失败 | `index.js:78` |
| chalaoshi | 缓存非原子写 + 每次降级全量重写 1 MB | `index.js:60,69` |
| cnki | 无 Cookie 承载 | `index.js:38-41` |

**不是巧合** —— 三个包的 21/23/31 条测试**全部只 import 数据层文件**。

**前置规则**：

- [ ] **`apply()` 必须有测试**。用假 `ctx`（`effect` / `provide` / `inject` 三个方法）跑一遍装配。
- [ ] **传给 `Transport` 的 `session` 必须是真实 `SessionStore`**，不能是 `{ jar: null }` 之类的手写对象。
- [ ] **路由 handler 必须有测试**：合法 action、非法 action、错误兜底三条。

### 教训 3 · 上游实测数据被丢弃

**现象**：上游注释里的数值是**定常量的依据**，丢了就会拍脑袋。

| 实例 | 后果 |
| --- | --- |
| chalaoshi 丢了「索引 1.7–3.0s / 教师页 0.5–1.8s / 评论 0.7–1.2s / gpa 1.2s」 | **正是 B1（`timeoutMs` 无效）的来源** —— 我写 `30000` 时没有依据 |
| cnki 丢了「模块 20 分钟有效」的来源（是服务器 `Expire` 字段，不是硬编码） | 我硬编码 `20*60` 并猜单位 → 实际 1.2 秒 |
| ebook **保留**了「含汉字 T_W_A 35 秒无响应」 | ✅ 但没据此设超时（I-3） |

**前置规则**：

- [ ] **上游注释里的每个数值，要么变成代码常量并注明出处，要么写进 README 的「验证依据」**。
- [ ] **超时值必须有依据**。没有上游数据的，写明「按 XX 估算，未实测」。

---

## 二、技术性必查项（四包审核中反复出现的具体缺陷）

### 传输层

- [ ] `Transport` 的 `session` 是真实 `SessionStore`（**不是 `{ jar: null }`**）
- [ ] `hosts` 白名单**包含本包要碰的所有主机**（漏一个 = 会话永远空且不报错）
- [ ] **有超时**：`timeoutMs` 在各层会被静默忽略 —— 确认它真的被读（`Transport` 读它，`sharedFetch` 不读）
- [ ] **有 `AbortSignal`**：`ebook` 全链路无 signal，半开连接会无限挂起
- [ ] **Cookie 承载**：需要登录态的包，确认 jar 真的在传递（cnki 的 B3）

### 错误处理

- [ ] **Transport 的 `ClassroomError` 必须被翻译**成数据源自己的错误码（yjsy 的 I1：`NETWORK` 原样穿透且文案说「智云」）
- [ ] 错误码覆盖：`SHAPE` / `AUTH_EXPIRED` / `REJECTED` / `CONFIG` + **`NETWORK`/`TIMEOUT`**（cnki/ebook 都缺）
- [ ] **不吞 code 和 details**：逐入口 catch 只拼 message 会丢信息（yjsy 的 I6）
- [ ] 文案**可操作**：不写「集成层」「setTokenProvider」这类内部名词（yjsy 的 I4）
- [ ] **参数校验在网络之前**（cnki 的 M7：`queryJson` 在 `ensure()` 之后）

### 缓存与会话

- [ ] **原子写**（用 `@deepseek-ai/dsh-atomic-write`，本仓已有 4 处在用）
- [ ] **写前 `mkdir`**（chalaoshi 缺它 → 成功的检索也会 ENOENT）
- [ ] **缓存键包含账号**（yjsy 的 I2：**隐私泄露**，换账号返回上一个人的数据）
- [ ] **失败要有负缓存/退避**（chalaoshi 的 B1：缓存过期后每次 search 都重走失败刷新）
- [ ] `save()` 失败不该让逻辑整体 reject（cnki 的 S3）

### 声明的诚实性

- [ ] **`description` 与代码一致**（cnki/ebook 都宣称了没实现的能力）
- [ ] **文件头注释与代码一致**（cnki 写「检索与全文下载」但无下载）
- [ ] **`methods` 数组与实际 action 名一致**（yjsy 的 I5：`'yjsy.timetable'` vs `'timetable'`）
- [ ] **常量定义了就接上**，否则标注「预留，未接线」（cnki 的 `SORTS`、chalaoshi 的 `API`）
- [ ] **无死代码**（cnki 的 `titleWords`/`sameTitle` 配了 2 条无意义测试）

### 文档

- [ ] **README.md 存在**（`cnki` / `ebook` / `http` 三处缺失，且 `files` 里都声明了）
- [ ] README 的「已知限制」如实（chalaoshi 的「完全离线可用」有未披露的 7 天 TTL 前提）
- [ ] **引用别人的实测数据要说清是别人的**（yjsy 的 M5：把 `campus` 的本机代理实测说成「海外代理」）

---

## 三、装配与工程

- [ ] `packages/source/*` 只读，**无 `ctx.tools.register`**、无写操作
- [ ] `requires` 与 import **双向一致**（`source-capability.test.mjs` 会查）
- [ ] 服务名 / 路由名 / loader id **全仓唯一**
- [ ] 无可配置项的包 → 加进 `tests/source-settings.test.mjs` 的 `NO_SETTINGS`，**带理由**
- [ ] **`package.json` 无 BOM**（PowerShell 的 `Out-File -Encoding utf8` 会加，用 `UTF8Encoding($false)`）
- [ ] **挂进 profile**：`profiles/zju-workbench/package.json` 的 `dsh.profile.bundles`（四包全缺）
- [ ] workspace 链接：`node scripts/link-workspace-packages.mjs --check`

---

## 四、每个包交付前必须跑的命令

```powershell
node --check packages/source/<name>/src/*.js
node scripts/link-workspace-packages.mjs
node --test tests/source-capability.test.mjs tests/source-settings.test.mjs tests/publish-guard.test.mjs
node --test tests/<name>.test.mjs
```

**四项全绿还不够** —— 还要过本文件第一节的三条「前置规则」，因为那三条**恰恰是守卫抓不到的**。

---

## 五、已知的仓级存量缺口（不是新包引入的）

| 缺口 | 现状 |
| --- | --- |
| `README.md` 缺失 | `cnki`、`ebook`、`http` 三个包 `files` 里声明了但文件不存在 |
| 四包未挂 profile | `yjsy` / `chalaoshi` / `ebook` / `cnki` 都不在 `dsh.profile.bundles` |
| `publish-guard` 不校验 `files` 每项存在 | `tests/publish-guard.test.mjs:110-121` 只校验 patch 被 `files` 覆盖 —— **可以直接补这一格** |
| 根 `ATTRIBUTION.md` 未登记 vendor 移植 | 只列了 OpenMAIC/ZJU-Omni/DeepTutor，没列 `zju-assistant` |
