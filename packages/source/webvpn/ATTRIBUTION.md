# 来源

本包是**本仓原生实现**。这一节说明它的来源，以便日后追溯。

## 直接来源

`src/protocol.js` 与 `src/login.js` 从本仓 `packages/source/campus/src/webvpn/`
（原 `packages/source/campus/src/webvpn/`）**逐字复制**，只改了两处：

1. 错误类型：`../cas/errors.js` 的 `ClassroomError` → 本包 `./errors.js` 的
   `WebvpnError`。独立成包后不能反过来 import campus 的内部路径，否则依赖方向
   又倒回去了（同 `campus/ATTRIBUTION.md` 里「为什么把 classroom 的 CAS 那几份
   复制过来」一节的理由）。
2. 新增 `src/index.js` 与 `src/errors.js`。

## 其后引入的部分（2026-11）

以下三块来自对上游第三方插件 `packages/vendor/zju-assistant` 的**行为口径**移植
（该插件以 GPL-3.0-only 发布，与本包同族；本仓只在 `packages/vendor/` 下按原样保留它，
没有把它复制进本包）。三块都**重写**过，不是逐字复制：

| 本包文件 | 上游参照 | 移植内容 |
| --- | --- | --- |
| `src/hosts.js` | `core/zju/lib/*/module.json` 的 `network` 字段、`lib/notice/hosts.json` 的逐站实测表 | 主机归属（campus / public / cas 三份名单）与判定函数 |
| `src/egress.js` 的三级判定与会话内降级 | `lib/webvpn/transport.ts:34-41,127-140` | 「模块声明优先、未知主机回退」的选路；直连失败或落到 `nopermit_zjusub.jsp` 后逐主机降级 |
| `src/doctor.js` | `lib/webvpn/doctor.ts` | 三项并行探测与 `advice[]` 的可操作指引 |
| `src/login.js` 的 `probeWebvpnSession` / `importWebvpnTicket` | `lib/webvpn/client.ts:142-148,195-200` | 会话有效性判据、浏览器 ticket 导入 |
| `src/protocol.js` 的动态 key/iv | `lib/webvpn/client.ts:47-52,99-105` | 从登录页解析 `encrypt(pwd,"key","iv")`，替代写死常量 |
| `scripts/probe-hosts.mjs` | `scripts/notice/hosts.ts` | 逐站可达性探测的判法（跟跳转、看最终落点） |

**与上游的两处刻意偏离**（都是更保守的方向）：

1. 登录页挖不到 key/iv 时**回退**到内置常量，而不是像上游那样直接抛错
   —— 页面结构变化不该等价于「完全不能登录」；
2. `doctor()` 的凭据**由调用方传入**，而不是自己读 profile —— 本包是 tier 0，
   不依赖任何业务包。

## 协议口径的上游

WebVPN 协议的原始参考链路：

> WebVPN URL scheme and login form adapted from EviterLesRoses2/cc98-mcp (MIT),
> which in turn credits Lucent-Snow/CC98-CLI (MIT).

本包**没有复制它的代码**，只沿用了协议事实（AES-128-CFB 常量、编码方式、
字段名、错误码），按 [CONTRIBUTING 3.3](../../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)
属于「简单借鉴」，无需在包内附完整许可说明。

## 算法

`https://<scheme>/<hex>` 里那段 hex 是 `AES-128-CFB` 密文，key 与 IV **都是**
`wrdvpnisthebest!` 的 ASCII 字节，前面再拼上 key 本身的 hex 当版本前缀。

登录表单的密码字段用另一把钥匙：**优先用登录页里内联的 `encrypt(pwd, "key", "iv")`
挖出来的那一对**（页面决定，不由我们决定），挖不到时才回退到内置的
`wrdvpnisawesome!`。上游也是动态取的（`client.ts:99-105,172`）——
写死一个常量在网关轮换 key 时会表现为「密码怎么都不对」，正是最需要避免的误导。

**这不是加密意义上的安全措施**（key 是公开常量），只是一层地址编码。

## 接口性质（如实标注）

WebVPN 转发的是**登录后**的校内数据，不是公开数据。网关登录需要「上网账号」，
而它与浙大统一身份认证是**两套系统**（账号通常都是学号，密码未必相同）。
