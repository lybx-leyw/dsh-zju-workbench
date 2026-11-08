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

## 协议口径的上游

WebVPN 协议的原始参考链路：

> WebVPN URL scheme and login form adapted from EviterLesRoses2/cc98-mcp (MIT),
> which in turn credits Lucent-Snow/CC98-CLI (MIT).

本包**没有复制它的代码**，只沿用了协议事实（AES-128-CFB 常量、编码方式、
字段名、错误码），按 [CONTRIBUTING 3.3](../../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)
属于「简单借鉴」，无需在包内附完整许可说明。

## 算法

`https://<scheme>/<hex>` 里那段 hex 是 `AES-128-CFB` 密文，key 与 IV **都是**
`wrdvpnisthebest!` 的 ASCII 字节，前面再拼上 key 本身的 hex 当版本前缀；
登录表单的密码字段用另一把 `wrdvpnisawesome!`。

**这不是加密意义上的安全措施**（key 是公开常量），只是一层地址编码。

## 接口性质（如实标注）

WebVPN 转发的是**登录后**的校内数据，不是公开数据。网关登录需要「上网账号」，
而它与浙大统一身份认证是**两套系统**（账号通常都是学号，密码未必相同）。
