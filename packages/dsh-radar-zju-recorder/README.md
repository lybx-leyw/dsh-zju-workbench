# dsh-radar-zju-recorder —— 候选骨架

> ## ✅ 评审结论：**已并入，本骨架待删**（2026-10-18）
>
> 本目录仍是候选骨架（未评审、未接入、不可直接使用）；它记录的能力**已评审通过**
> 并落地到正式包，见下表。**本目录不再是任何工作的起点**，保留只为让读到它的人
> 找到去处；确认无误后整目录可删（`git rm -r packages/dsh-radar-zju-recorder`）。
>
> | 骨架说的能力 | 实际去向 |
> | --- | --- |
> | OAuth2 授权码入口 | `dsh-zhiyun-classroom/src/auth.js` → `authenticate(…, { entry: 'oauth' })` |
> | `_token` cookie → JWT | 同上 `jwtFromTokenCookie()` / `inspectJwt()`；直播每条请求用它拼 Bearer |
> | 实时流观看（m3u8） | `dsh-zhiyun-classroom/src/live.js` + `stream.js`，页面侧 `dsh-zhiyun-page-study` |
> | CookieJar 迁移 | **作废** —— 本仓 `tough-cookie@6.0.2` 已覆盖（实测 domain / host-only / path 语义完备） |
> | RSA「交叉验证」 | **判断有误，已修正** —— 见下方「评审修正」 |
> | 录制（ffmpeg） | **未做**。需要二进制分发，与浏览器工作台形态冲突，另行立项 |
>
> ## 评审修正：骨架的三处说法与实际不符
>
> 1. **「本仓完全无 OAuth2 链路」是错的。** 现有 `auth.js` 从 `tgmedia/index.php?r=auth/login`
>    起跑的 20 跳循环**已经会经过** `cas/oauth2.0/authorize`（见 `tests/classroom.test.mjs`）。
>    真实差异只有两处：**入口**（`tgmedia` vs `yjapi/casapi`）与**终态取用户**
>    （`JWTUser` cookie vs `_token` 里的 JWT）。
> 2. **RSA「交叉验证」不成立。** 实测：短 ASCII 密码两边输出**完全相同**（所谓「同族不同法」
>    在单块时数学等价，交叉验证只会给假安全感）；中文密码因上游用 `charCodeAt`
>    逐 UTF-16 码元、本仓用 `Buffer` utf8 而**确实不同**；>126 字符时上游是**多块空格拼接**、
>    本仓单块，是**两种协议**而非两种实现。
> 3. **`apply()` 不是「纯占位」。** 骨架的 `apply()` 注册了 `/zhiyun-recorder` 路由，
>    且 handler 用了 Fetch 的 `Response` —— 宿主 `WebRoute.handler` 是
>    `(req, res) => void | Promise<void>`，返回值会被丢弃、请求挂到超时。
>    这正是「看起来能跑」的骨架最该避免的形态。
>
> ---

> ## ⚠ 以下为原始骨架声明（历史记录，已失效）
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [p16e0nd/zju-recorder](https://github.com/p16e0nd/zju-recorder) |
| 许可证 | **MIT** ✅（LICENSE 实文已核：`Copyright (c) 2026 ZJU Recorder contributors`） |
| 作者 | p16e0nd |
| Stars | ★0 |
| 语言 | JavaScript（Node.js 18+，手写 HTTP 服务 + 静态前端） |
| 最后推送 | 2026-09-30（距本轮约 1 个月） |
| upstream 挂载形状 | **无** —— 上游**不是** DSH 插件包：无 `dsh.bundle.patch`、无 `dsh.client`、未发布 npm |
| 依赖 | 运行时无 npm 依赖（`app/zjuauth.js` 明确「零依赖：Node 内置 BigInt + fetch」）；需外部 `ffmpeg`（由 `download-ffmpeg.bat` 安装） |
| 形态 | **Windows 本地工具**：`start.bat` 启动 → 浏览器打开 `127.0.0.1:8787`；录像落 `%USERPROFILE%\ZJU-Recordings\<课程_机位>\<日期>\`，每 30 分钟分段 |

### 仓库结构（已核）

```text
app/server.js      149 KB  Node.js 服务端（HTTP 仅监听 127.0.0.1）
app/zjuauth.js     7.7 KB  ZJUAM 自动登录（零依赖，含 RSA 分块 + CookieJar）
app/public/               前端：index.html 92 KB / app.css 33 KB
                          flv.min.js 144 KB / hls.min.js 415 KB  ← ⚠ 第三方构建产物，许可证未核
asr/                      可选本地语音识别 sidecar（实时字幕）
tools/                    命令行字幕抓取工具
DISCLAIMER.md / SECURITY.md   使用边界与安全边界声明
```

---

## 类型与集成判定

- **类型**：**B · 其他 JS 项目**
  —— ⚠ **不是 A 类**。上游没有 DSH 插件装载点，因此本包**不含上游 npm 锁版依赖**，
  也**不能**套用 `dsh-zhiyun-paper` 的「锁版挂载」形状（那是 A 类专属）。
- **集成方式**：**能力提取 + 封装**（B 类），**强化式集成**
- **与现有功能的关系**：**重复且可强化** ✅

### 三条判据（同时成立才算强化式集成）

| 判据 | 本候选 |
| --- | --- |
| 仍是同一个面板 | ✅ 仍是「**智云课堂**」页（`dsh-zhiyun-classroom`），不新增独立页面、不改导航 |
| 功能仍相似正交 | ✅ 同属「**智云课堂的视频从哪来、怎么看**」。本仓只有**下载后的离线解析**与 **CAS 直连**；上游补的是**实时流观看/录制**与**OAuth2 授权码链路** |
| 底层多调了更优质实现 | ✅ 上游的 **`_token` cookie → JWT** 抓取链路本仓**完全没有**；`CookieJar` 的完整度高于本仓手写版 |

---

## 增强哪个现有功能

`packages/dsh-zhiyun-classroom`（智云课堂页）的**直播 / 回放通路**。

| 本仓现状 | 上游补上的 | 结果 |
| --- | --- | --- |
| **CAS 直连**：`zjuam.../cas/login` → `v2/getPubKey` → POST(execution + RSA(密码)) | **OAuth2 授权码链路**：`casapi` → `oauth2.0/authorize` → `tgmedia get-info?code=ST-xxx` → `_token` cookie 内藏 JWT | 智云课堂页**首次有了第二条取 JWT 的抓手**（现只有 cookie 一条路） |
| cookie 处理散在 `src/transport.js` 里手写 | 独立 `CookieJar` 类，显式处理 `domain` / host-only / `path` | 会话正确性有了**单一职责的容器** |
| RSA 加密为**整块** BigInt 幂（`padStart(128)`） | RSA 为**密码反转 + 分块** `modpow` + 十六进制拼接 | 两套独立实现可**交叉验证**，反证任一方未漂移 |
| 只能看**已下载**的课件（离线、事后） | **实时流（FLV/HLS）** 直播观看 + 边看边录 | 课堂页从**事后**变成**在线** |
| 麦克风/字幕相关能力无 | 可选本地 ASR sidecar（实时字幕） | 字幕首次可来自**实时直播**而非只来自已录文件 |

> ⚠ 「实时流」与「离线解析」**互为补充而非互斥** —— 这是本候选**不构成
> 「重复且无增益」**的关键分界，也是人工评审最该先看的一处。

---

## 上游能力的三块证据（均已读源码，非 README 转述）

### ① OAuth2 授权码链路 —— `app/zjuauth.js` 头部注释原文

```
链路（逆向自 classroom 的 SSO）：
  casapi auth/login → cas/oauth2.0/authorize → cas/login(输账密)
  → POST(username + RSA(密码反转) + execution) → ticket
  → callbackAuthorize → tgmedia get-info?code=ST-xxx
  → 该响应 Set-Cookie: _token=<Yii签名>{... "eyJ...JWT..." } → 302 classroom
JWT 即藏在 _token cookie 里。
```

> ⚠ 这是上游的**注释**，不是机器可读契约。上游 2026-09 推送、距今 1 个月，
> **未经实测不得当作仍然有效**（见 `src/index.js` 的 TODO 2）。

### ② CookieJar —— 已核到的实现语义

```js
class CookieJar {
  constructor() { this.cookies = []; }
  setFrom(urlStr, setCookieList) {
    const host = new URL(urlStr).hostname;
    // 逐条解析 Set-Cookie：按 ';' 切属性，取 name=value，识别 domain / host-only / path
    ...
```

⇒ 显式维护 `domain` / `hostOnly` / `path` 三元匹配，本仓缺这一层抽象。

### ③ RSA 分块实现 —— 已核到的关键行

```js
function encryptPassword(password, modulusHex, exponentHex) {
  const m = BigInt('0x' + modulusHex), e = BigInt('0x' + exponentHex);
  let dc = 0, t = m; while (t > 0n) { dc++; t >>= 16n; }
  const chunkSize = 2 * (dc - 1);
  const rev = password.split('').reverse().join('');   // ← 先整串反转
  ... 每 chunkSize 个字符一组，modpow 后 bigToHexDigits 拼接 ...
}
```

注释自称「复刻 ohdave，已对真库逐字节验证」。
本仓 `src/auth.js` 的 `rsaEncrypt()` 是**整块**处理，两者**同族不同法** →
可作**交叉验证**（TODO 3）。

---

## 借鉴边界（**重要**）

| 项 | 处理 |
| --- | --- |
| 上游源码 | ❌ **不搬运**到本仓库。本包只有占位与 TODO |
| `flv.min.js` / `hls.min.js` | ❌ **不引入**。这是**第三方构建产物**（144 KB / 415 KB），**许可证本轮未核实**。若需 FLV/HLS 播放，走本仓自己的依赖选型 |
| 上游整体进程 | ❌ **不挂载**。上游是 Windows 本地工具（`127.0.0.1:8787`），形态不兼容 |
| 凭据 | ✅ **只走内存**，不落盘、不进日志、不进任何持久配置 |
| 录制能力 | ✅ 接入时**必须同步承接 `DISCLAIMER.md` 边界**（原文：「用于查看与录制**已获授权访问**的智云课堂直播」），且**默认关闭**、每次显式确认 |

---

## ⚠ 本骨架的生成背景（如实说明）

本轮（2026-10-16 第五轮）搜索到第 30 次调用时**触发了 GitHub API 403 限额**，
按 `dsh-ecosystem-radar` 的「失败处理」表应**不生成骨架**。

**本骨架是明示的偏离**，理由：本骨架所依赖的全部证据
（LICENSE 实文、`app/zjuauth.js` 全文、仓库结构、README、`app/public` 清单）
**均在 403 之前已成功拉取并逐段核对**；403 截断的是
「化学 / 生科 / Jupyter」三个**与本候选无关**的后续切片。

**若人工判定此偏离不可接受，删除本目录即可** ——
该候选在报告与 `registry.md` 中的登记**不受影响、仍然成立**。

---

## TODO 摘要

完整列表见 `src/index.js` 文件头。**前置拍板项**：

1. **【首要】** 确认「提取能力而非挂载整体」成立 —— 不成立则本包废弃。
2. 实测上游 OAuth2 链条**是否仍有效**（注释不是契约）。
3. RSA 与 `packages/dsh-zhiyun-classroom/src/auth.js` **交叉验证**，不一致时以本仓为准。
4. `CookieJar` 语义**归位到 `dsh-zhiyun-classroom/src/transport.js`**，
   不许同一 profile 里有两套 cookie 状态。
5. 凭据流向**全链路审计**，确认不绕开 `dsh-zhiyun-net-proxy`。
6. 补 `tests/radar-zju-recorder.test.mjs`，其中「凭据不出现在任何 status/日志输出里」
   **必须是会红的测试**。
