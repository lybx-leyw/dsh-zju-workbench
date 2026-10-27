/**
 * dsh-radar-zju-recorder —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 类型：B · 其他 JS 项目（注意：**不是** A 类原生 DSH 插件包）─────────
 *
 * 上游 `p16e0nd/zju-recorder` **没有** `dsh.bundle.patch`、**没有** `dsh.client`、
 * **没有发布到 npm**（仓库根即应用根，`app/server.js` 是入口）。
 * 因此本骨架**不含** `dependencies` 里的上游锁版依赖，也**不能**用
 * `dsh-zhiyun-host-paper` 那套「锁版挂载」形状 —— 那是 A 类专属。
 *
 * 本包走的是 **B 类：能力提取 + 封装**：
 * 读上游那两个文件（`app/zjuauth.js`、`app/server.js` 的相关段落），
 * 把其中**本仓缺失的能力**重新实现到本仓自己的模块里，
 * 而不是把上游整体搬进来。**不搬运上游源码**（见 README「借鉴边界」）。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 强化 `packages/dsh-zhiyun-source-classroom` 的**直播 / 回放**通路。上游可提取的能力有三块：
 *
 *   1. **智云 SSO 的第二条链路**（本仓完全没有）
 *      本仓 `src/auth.js` 走的是 CAS 直连：
 *        `zjuam.zju.edu.cn/cas/login` → `v2/getPubKey` → POST(execution + RSA(密码))
 *      上游走的是 **OAuth2 授权码中转**：
 *        `casapi auth/login` → `cas/oauth2.0/authorize` → `cas/login`
 *        → POST(username + RSA(密码**反转**) + execution) → ticket
 *        → `callbackAuthorize` → `tgmedia get-info?code=ST-xxx`
 *        → 该响应 `Set-Cookie: _token=<Yii签名>{... "eyJ...JWT..." }` → 302 classroom
 *      **JWT 藏在 `_token` cookie 里** —— 这是本仓从未走过的抓手。
 *
 *   2. **成熟的 cookie jar**（本仓是散落在 transport 里的手写处理）
 *      上游的 `class CookieJar` 显式处理 `domain` / host-only / `path` 三者匹配，
 *      并区分 `Set-Cookie` 的多值情况。本仓缺这一层抽象。
 *
 *   3. **RSA 密码加密的另一种实现**（可作交叉验证）
 *      上游 `encryptPassword()`：**先把密码整串反转**，按 modulus 的**十六进制位数分块**，
 *      每块 `modpow` 后 `bigToHexDigits` 拼接。
 *      本仓 `rsaEncrypt()`：明文字节 → hex → **整块** BigInt 幂 → `padStart(128)`。
 *      两者**同族不同法**。上游注释自称「复刻 ohdave，已对真库逐字节验证」。
 *
 * ── 为什么是「强化式集成」而不是简单集成 ────────────────────────
 *
 * 三条同时成立：
 *   1. **仍是同一个面板** —— 仍是「**智云课堂**」页（`dsh-zhiyun-source-classroom`），
 *      不新增独立页面、不改导航、不抢 `dsh-zhiyun-page-courses` 的布局主张。
 *   2. **功能仍相似正交** —— 两边都是「**智云课堂的视频从哪来、怎么看**」。
 *      本仓现状只有**已下载文件的解析**（`src/parser` / `dsh-zhiyun-core-parser`）
 *      与**CAS 直连取 cookie**；上游补的是**实时流（FLV/HLS）的观看与录制**，
 *      以及**另一条取 JWT 的授权码链路** —— 同一件事的缺失部分，
 *      不是并列的第二套课堂客户端。
 *   3. **底层多调了更优质实现** —— 上游的 `_token → JWT` 链路
 *      与本仓**毫无重叠**；`CookieJar` 的完整度高于本仓手写版。
 *
 * 缺任何一条都只能算重复集成，应当拒绝。
 *
 * ── 为什么不是「重复且无增益」（必须说清，否则应判 ⛔）──────────
 *
 * 本仓确实**已经能登录智云、已经能播放已下载的课**。但：
 *   - 现有：CAS 直连 → cookie → **下载已录制的课件** → 本地解析播放；
 *   - 本候选：OAuth2 授权码 → `_token` cookie → JWT → **实时流直播 / 边看边录**。
 * 前者是**离线、事后**，后者是**在线、实时**。**互为补充而非互斥。**
 * 这一点是本骨架与「重复且无增益」的分界线，也是人工评审最该先看的一处。
 *
 * ── 接入边界（三条硬约束，评审通过前不得放松）──────────────────
 *
 *   ❌ 不改上游源码；不搬运上游源码到本仓库。
 *   ❌ **不引入上游的 `app/public/flv.min.js` / `hls.min.js`**（144 KB / 415 KB）。
 *      这是**第三方构建产物**，许可证**本轮未核实** —— 未核实前不得引入。
 *      若确需 FLV/HLS 播放，走本仓自己的依赖选型。
 *   ❌ **不挂载上游整体**。上游是 Windows 本地工具（`start.bat` / `download-ffmpeg.bat`，
 *      服务监听 `127.0.0.1:8787`，录像落 `%USERPROFILE%\ZJU-Recordings\`），
 *      形态与本仓浏览器内工作台**不兼容**。只能提取能力。
 *   ✅ 凭据**只走内存**，不落盘、不进日志、不进任何持久配置。
 *   ✅ 若接入录制能力，**必须同步承接上游 `DISCLAIMER.md` 的边界声明**
 *      （原文已核：「用于查看与录制**已获授权访问**的智云课堂直播」），
 *      且**默认关闭**、每次显式确认。
 *
 * ── TODO（评审通过后再动，按依赖顺序）──────────────────────────
 *
 *   1. 【人工拍板 · 首要】确认「提取能力而非挂载整体」这条判断成立。
 *      这是本候选能否继续的前提。不成立则本包应废弃。
 *
 *   2. 【链路比对】把上游的 OAuth2 链条与本仓 `src/auth.js` 的 CAS 链条
 *      在同一份智云端点清单上跑通，**确认上游的 `_token` cookie 抓法仍然有效**
 *      （上游 2026-09 推送，距今 1 个月，未经验证不得当作有效）。
 *      ⚠ 上游的链路描述来自其**注释**，不是机器可读的契约；须实测。
 *
 *   3. 【RSA 交叉验证】用上游的分块实现与本仓的整块实现
 *      **对同一组明文/公钥产出相同密文**才算通过。不一致说明其中一方已漂移，
 *      **不一致时以本仓现有实现为准**（它已在生产路径上跑过）。
 *
 *   4. 【CookieJar 归位】把上游的 cookie 匹配语义（domain / host-only / path）
 *      实现到本仓的 `packages/dsh-zhiyun-source-classroom/src/transport.js`，
 *      **而不是**新建第三个 cookie 容器 —— 同一 profile 里不允许有两套 cookie 状态。
 *
 *   5. 【实时流协议】盘点 `tgmedia get-info` 返回的流地址形状
 *      （FLV / HLS / 机位列表 / 鉴权参数），只读、不改上游。
 *      ⚠ 机位切换与预约录制属于**写操作**，须比照 `dsh-zhiyun-page-plugins`
 *      的成例**不另开写入口**。
 *
 *   6. 【凭据流向】审计全链路：明文账密从哪进、经过哪些对象、哪些会序列化。
 *      本仓已有 `dsh-zhiyun-source-netproxy` 的网络边界，须确认新链路**不绕开**它。
 *
 *   7. 【测试】在仓库根补 `tests/radar-zju-recorder.test.mjs`：
 *      断言 RSA 交叉验证一致、cookie 匹配语义与 `Set-Cookie` 多值处理正确、
 *      以及**凭据不出现在任何 status / 日志输出里**（这条必须是会红的测试）。
 *
 *   8. 【验证】接入前跑通 `npm test` 与 `npm run test:host`，
 *      并在真实宿主里确认它**没有**影响 `dsh-zhiyun-source-classroom` 现有的下载通路。
 */

export const name = 'radar-zju-recorder';

/**
 * 只硬依赖 `profileContext`（数据目录）。
 * `webServer` / `connection` / `remote` 全部走 `ctx.inject` / `ctx.get` 惰性取 ——
 * 可选宿主服务不写进 inject，否则对方没就绪时本插件会一直 pending
 * （这条规矩见 dsh-zhiyun-host-paper 与 dsh-zhiyun-core-study 的 README）。
 */
export const inject = ['profileContext'];

/** 本包自有前缀。**不得**用上游可能占用的前缀，否则宿主 `webserver.register` 会抛错。 */
export const RECORDER_ROUTE_PREFIX = '/zhiyun-recorder';

// TODO(1..8)：见上方文件头。评审通过前本文件不写任何业务逻辑。

export async function apply(ctx, config = {}) {
  const status = {
    prefix: RECORDER_ROUTE_PREFIX,
    /** 候选骨架：即使被误接入，也要让页面能显示「这是未评审的骨架」。 */
    skeleton: true,
    /** B 类：无上游 npm 依赖可核对，此处如实标注，避免被误读成 A 类的锁版挂载。 */
    upstream: {
      kind: 'B-capability-extraction',
      repository: 'https://github.com/p16e0nd/zju-recorder',
      license: 'MIT',
      /** 上游是 Windows 本地工具，形态不兼容 —— 只提取能力，不挂载。 */
      mountable: false,
      extracted: false,
    },
  };

  console.warn('[radar-zju-recorder] 骨架：能力提取尚未实现（见 src/index.js 的 TODO 1–8）。'
    + '本包为未评审骨架，不得接入 profile。');

  // ── 本包自有路由（骨架阶段只答只读状态）─────────────────────────────
  ctx.inject(['webServer', 'connection'], (scope) => {
    scope.effect(() => {
      const dispose = scope.webServer.register({
        kind: 'prefix',
        path: RECORDER_ROUTE_PREFIX,
        handler: async () => new Response(JSON.stringify({ ok: true, status }), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
      });
      return dispose;
    }, 'radar: zju-recorder routes');
  });

  const removeService = ctx.provide('radarZjuRecorder', {
    prefix: RECORDER_ROUTE_PREFIX,
    skeleton: true,
    status: () => status,
  });

  return () => {
    if (typeof removeService === 'function') removeService();
  };
}
