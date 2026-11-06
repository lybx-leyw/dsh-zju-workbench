/**
 * 上游包的**锁版凭据** + **实测能力边界**（单一真源）。
 *
 * 与 `packages/dsh-zhiyun-host-paper/src/upstream.js` 同一套理由：
 *
 *   1. `package.json` 里的依赖必须写**精确版本**（`0.3.5`，不是 `^0.3.5`）。
 *      `dsh-bili-watch` 的 B 站接口实现仍在快速变动（37 个版本，2026-10-19 建仓、
 *      2026-10-29 已到 0.3.5），`^` 会让 `npm install` 在某次无关改动里
 *      悄悄换掉底下的解析器。
 *   2. 光锁 `package.json` 不够 —— 真实 `node_modules` 里装的是什么，取决于
 *      别人的 lockfile、全局覆盖、`npm link`。所以还要在**运行时**核对一次。
 *   3. 将来补 `tests/` 时用这两个常量断言「声明、实际安装、代码预期」三者一致。
 *
 * ⚠️ **当前状态：可锁但尚未锁，而且大概率不锁。**
 *    本包 `package.json` 里**没有**这条依赖。`SELF_BUILD_VERDICT` 一节记录了
 *    「只取自建」的实测依据 —— 见下。
 */

export const UPSTREAM_PACKAGE = 'dsh-bili-watch';

/** 我们适配并测试过的上游版本，接进 `package.json` 时必须逐字符相同。 */
export const UPSTREAM_VERSION = '0.3.5';

/** 上游仓库（作者、许可证核实来源）。 */
export const UPSTREAM_REPOSITORY = 'https://github.com/Sacredbluedragon/dsh-bili-watch';

/** 上游许可证：MIT（`LICENSE` 实文已核，1073 B）。 */
export const UPSTREAM_LICENSE = 'MIT';

/**
 * 上游的**能力边界**（读 `README.md` 与 `tools/look.mjs` 得到，不是猜的）。
 *
 * 这份清单存在的意义是：**别把「上游没做的事」当成「上游做坏了」**。
 * 它的自述定位是「把 B 站视频读成文本给 AI 用」，不是「还原课件页」。
 */
export const UPSTREAM_CAPABILITIES = Object.freeze({
  /** `view`：元数据 + 简介 + 热评。匿名可用，不下载。 */
  metadata: true,
  /** `sub`：官方字幕轨（需登录态，WBI 签名 + 两次重试）。产出 `cues: {from,to,content}`（秒）。 */
  officialSubtitle: true,
  /** `asr`：本地 faster-whisper 转写，附「可信 / 疑似幻觉」判定。需 Python venv。 */
  localAsr: true,
  /** `frames` / `sheet`：ffmpeg 抽帧 + 九宫格拼图。**固定间隔采样，不做页检测**。 */
  frameSampling: true,
  /** `ocr`：抽帧后 rapidocr 识别。需 Python venv。 */
  ocr: true,
  /** `text`：四级降级链 字幕 → 转写 → 抽帧 OCR → 读图。 */
  degradationChain: true,

  /**
   * ❌ **没有「帧 → 页」的归并**。
   *
   * 这是本包必须自己补的那一步：`frames` 按固定间隔出图（`--step`），
   * 同一页停留 10 分钟就会产出几十张几乎一样的图。而本仓
   * `dsh-zhiyun-core-parser` 的 `validateInput()` 要求
   * `slide.page` **正整数且全局唯一** —— 同页多帧直接 `INPUT` 错。
   */
  slideSegmentation: false,
  /** ❌ 不产出 `createdSec`（换页时刻），只有帧文件名里的序号。 */
  slideTimeline: false,
});

/**
 * **「自建 vs 挂载」的实测结论**（2026-10-29，探针脚本未随仓库分发）。
 *
 * 探针实现了「不挂上游、只要字幕」所需的最小闭环，跑通后统计：
 *
 * | 段 | 实际代码行 | 说明 |
 * | --- | ---: | --- |
 * | WBI 签名（`MIXIN_KEY_ENC_TAB` + `getMixinKey` + `wbiSign`） | **20** | 纯函数，零依赖，`node:crypto` 的 md5 |
 * | `jget`（fetch + HTML 风控识别 + JSON 解析） | **8** | 去掉上游的重试/诊断/中文错误化之后 |
 * | `fetchSubtitle`（nav → wbiSign → wbi/v2 → 字幕 CDN → cues） | **18** | 含两次错误分支 |
 * | `cues → subtitles[]` 转换 | **4** | 三字段映射 + 边界钳位 |
 * | **合计** | **50 行** | |
 *
 * 而挂载上游要付的代价：
 *
 * | 项 | 量 |
 * | --- | --- |
 * | npm 包体积 | 443,445 B / 13 files |
 * | 宿主半边 `index.js` | 116,332 B |
 * | 客户端面板 `client.js` | 48,885 B（扫码登录 / 依赖管理 / 缓存清理 / 17 项参数） |
 * | 新增命令面 | `bili_watch` 工具 + `/bili` 命令**两个** |
 * | 额外依赖 | `qrcode@^1.5.4` |
 *
 * **结论：50 行 vs 一个完整插件。取「自建」。**
 *
 * 但有一条**前置事实**必须先看清（下面 `SUBTITLE_REQUIRES_LOGIN`）。
 */
export const SELF_BUILD_VERDICT = Object.freeze({
  /** 自建字幕通道需要的实际代码行（探针实测，含注释外的一切非空非注释行）。 */
  subtitleChannelLines: 50,
  /** 其中纯函数、可直接单测的部分（WBI 签名 + 转换）。 */
  pureFunctionLines: 24,
  /** 是否建议挂载上游整体。 */
  mountUpstreamWhole: false,
  /** 理由一句话。 */
  reason: '要的只有 50 行字幕逻辑；上游是一个完整插件（116 KB 宿主 + 48 KB 面板 + 两个命令面）',
});

/**
 * **官方字幕必须登录态**（实测，非推测）。
 *
 * 2026-10-29 匿名实测：
 *
 * - 热门榜 3 页 × 20 条，逐条打 `x/player/wbi/v2` → **60/60 全为空**；
 * - 知识区排行 15 条 → **15/15 全为空**；
 * - 另有 2 条知名视频 + 1 条分 P 视频 → 全为空；
 * - 合计 **92 个视频，`subtitles: []` 100%**。
 *
 * 关键在于**签名路径本身是通的**：
 *
 * ```text
 * nav       → code=-101（未登录）但**照样给了 wbi_img**，imgKey/subKey 各 32 字符
 * wbi/v2    → code=0  message=OK        ← 签名正确，没被风控拦
 * subtitle  → {"subtitles": [], "ai_status": undefined}
 * ```
 *
 * 也就是说：**不是签名写错了，也不是被拦了，而是匿名态下服务端就不返回字幕轨。**
 *
 * 推论：登录态是**硬前提**，不是可选优化。
 */
export const SUBTITLE_REQUIRES_LOGIN = Object.freeze({
  verifiedAt: '2026-10-29',
  anonymousSamples: 92,
  anonymousWithSubtitles: 0,
  wbiSignatureWorksAnonymously: true,
  /** 匿名态下 nav 的返回码（-101 = 未登录，但仍给 wbi_img）。 */
  navCodeAnonymous: -101,
  /** 匿名态下 wbi/v2 的返回码（0 = 签名被接受）。 */
  wbiV2CodeAnonymous: 0,
});

/** 登录态需要的 Cookie 字段（上游的四字段判据，缺一不可）。 */
export const REQUIRED_COOKIE_FIELDS = Object.freeze(['sessdata', 'bili_jct', 'buvid3', 'buvid4']);
