# dsh-radar-cc98-webvpn —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 的 `apply()` 直接抛错。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 一句话

让 `dsh-zhiyun-source-cc98` 那 **10 个只读方法**在校外也能通 —— **同一个面板、同一批方法**，
只多一条经 WebVPN 的出口。

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [oionus/CC98-CLI](https://github.com/oionus/CC98-CLI)（**非 fork**，README 自述「改版自 Lucent-Snow/CC98-CLI」） |
| 许可证 | **MIT** ✅ —— 三处互证：GitHub `/license` API `spdx_id: MIT`、根 `LICENSE` 实文 1060 B（`Copyright (c) 2026 Walavave`）、npm manifest `"license": "MIT"` |
| Stars | ★5（2026-11-03） |
| 创建 / 最近推送 | 2026-05-28 / **2026-09-02** |
| 语言 | TypeScript（ESM），`tsc` → `dist/` |
| npm | **`@walavave/cc98-cli@0.4.1` 已发布**（2026-09-02）✅ 锁版成立 |
| 运行时依赖 | **`{}` 零依赖** · `engines.node >= 20` |
| 对外形态 | `bin: { cc98: dist/main.js }`（CLI/TUI）。**但 `dist/api/*` 有 `.d.ts`，可当库用** |
| DSH 形状 | **无** `dsh.bundle.patch` / `cordis.patch.yml` / `dsh.client` → **非 DSH 插件** |

## 类型与集成判定

- **类型**：**B · 其他 JS 项目**（按「有无 DSH 形状」判）。
  但仍保留 `dependencies` 锁版，因为**上游在 npm 上有发行版且零依赖** —— 引入成本近乎为零。
  （对照：`dsh-radar-cc98-sdk` 的上游 `cc98-mcp` 在 npm 上 404，锁版不成立。）
- **集成方式**：**锁版引入 + 出口状态机**（非 iframe 承载 —— 上游没有 Web UI 可挂）。
- **与现有功能的关系**：**重复且可强化** —— 判据见下，**但第③条只在「会话状态机」上成立**。

### 三条判据

| 判据 | 本候选 | 结论 |
| --- | --- | --- |
| ① **仍是同一个面板** | 不注册页面、不注册 slot。调用方仍是 `cc98.search / topic / hot / newTopics / boards / boardTopics / user / notifications / conversations / messages`，参数与返回形状不变 | ✅ |
| ② **功能仍相似正交** | 同一个「读 98」，只多一条**出口**；不是第二个论坛客户端 | ✅ |
| ③ **底层多调了更优质的实现** | **仅部分成立** —— URL 改写的部分是**等价重写**，无净增益；有增益的是「会话过期判定 / 三段式登录 / 凭据分家」 | ⚠ **需评审裁定** |

#### ③ 的详细核对：哪些有增益、哪些没有

| 能力 | 上游 | 本仓现状 | 增益 |
| --- | --- | --- | --- |
| URL 改写 `convertUrl()` | `AES-128-CFB` + key `wrdvpnisthebest!` + hex 前缀 + `https-8443` 特殊端口 | `source-campus/webvpn/protocol.js → toWebvpnUrl()`，**同样算法**（更晚写入的动态，另有 `fromWebvpnUrl()` 反向解码） | **无** |
| 反向解码 | 上游没有 | `fromWebvpnUrl()` | 本仓更强 |
| **网关重定向判过期** | `fetchWithRedirects()` + `isLoginPageUrl()`：只在「**非**登录页请求被 302 到登录页」时判过期 | `protocol.js` 只有 `isWebvpnLoginUrl()` 这个**纯谓词**；判过期策略在 `egress.js`（`source-campus`），**未为 cc98 接线** | **有** |
| **三段式登录** | `login()` → `{ needCaptcha, needConfirm, captchaId }`，图形码/确认页当**正常状态** | `source-campus/webvpn/login.js` 有登录页解析，但无 captcha/confirm 状态回报 | **有** |
| **凭据分家** | `vpn-store` 自存网关凭据 | `source-campus` 注释已声明「网关登录用上网账号，与统一身份认证是两套系统」，但 **cc98 链路没有网关凭据落点** | **有（弱）** |
| CC98 API 全量 60+ 方法 | `Cc98Client`，含大量写方法 | `source-cc98` 刻意只开 10 个只读 | **负** ⛔ 不用 |

> **③ 的反驳必须写明**：若评审认为「会话状态机」属于 `dsh-zhiyun-net-proxy` /
> `source-campus` 的职责、应由那里统一补齐而不是为 cc98 单开包，
> 则**本包应整目录删除**，registry 从「重复且可强化」改判「重复且无增益」。
> 本次无法自动作出这个判断，故只出骨架、不挂载。

## `LOCK_CONFLICT`：落地阻塞（评审请先看）

1. **令牌存储错位** —— 上游 `Cc98Client` 要求自带 `tokenStore`；本仓 `TokenStore`
   是另一个类且**必须保持唯一刷新器**（CC98 的 refresh_token 一次性轮换，
   两个刷新器并存会互相踢下线）。适配层只能读上游，不能让它触发刷新。
2. **全局 `fetch`** —— 上游 `dist/api/*.js` 直调全局 `fetch`，绕开宿主 `sharedFetch` /
   代理 / 超时策略。若上游无注入点，这条**绕不开** ⇒ 只能做能力提取（读它状态机、
   在本仓 `egress.js` 重写），届时分级 🟢 → 🟡，且本包的 `dependencies` 应删掉。
3. **写侧一律不碰** —— 上游有 `replyTopic / createTopic / sendMessage / favoriteTopic /
   reactToPost`。本包**只** `import` `dist/api/webvpn.js` 的 `WebVpnService`，
   **不构造** `Cc98Client`。

## 需要新增的凭据落点

**不得**复用 `source-card` 的 `zhiyun-cc98/account`（那是 CC98 OAuth2 账号）。
网关凭据是**第三套**：CC98 账号 / 一卡通 / 上网账号（网关）。账户卡片已按三分展示，
新记录应挂在同一分区下，命名待定（建议 `zhiyun-webvpn/account`，与 `source-campus` 现有项对齐）。

## 与已登记项的重叠（需要归一）

本仓 registry 已登记 `Lucent-Snow/CC98-CLI`（★20，MIT，2026-08-05 推，**npm 404**，🟢 proposed）。
两者同源不同实现：

| | `Lucent-Snow/CC98-CLI` | `oionus/CC98-CLI`（本候选） |
| --- | --- | --- |
| npm | **404** | **`@walavave/cc98-cli@0.4.1`** ✅ |
| 最近推送 | 2026-08-05 | **2026-09-02** |
| WebVPN / RVPN / 三段式登录 | 未见 | **有**（`api/webvpn.ts`） |
| 仓库大小 | 1.4 MB | 9.8 MB（含 assets） |

**建议归一取本候选**，评审通过时把 `Lucent-Snow/CC98-CLI` 那行标 `superseded`。

> ⚠ **发布方身份未独立验证**：GitHub 是 `oionus`，npm 是 `@walavave`，
> npm `repository` 字段指向 `walavave/CC98-CLI`（该仓库 403/不存在）。
> 不影响 MIT 许可效力（三处互证），但建议人工过目再采用。

## 目录

```
package.json        # dependencies 锁 0.4.1（不用 ^）
cordis.patch.yml    # - insert: [{ id: radar-cc98-webvpn, name: dsh-radar-cc98-webvpn }]
src/index.js        # 占位：apply() 直接抛错 + 能力矩阵
src/upstream.js     # 锁版凭据、白名单、LOCK_CONFLICT
README.md           # 本文件
OWNERS              # Owner: shared
```
