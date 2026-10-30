/**
 * dsh-zhiyun-source-bilibili —— **B 站视频数据源**。
 *
 * > ⚠️ **解析链路已完整实现；但「产物存到哪个知识库」未裁定（等那个功能立项）。**
 * > 本包**未接入 profile**、**未写进 `dsh.profile.bundles`**，
 * > 所以即使 `apply()` 什么都不做也不会影响工作台。
 *
 * # 定位：给**知识库**用的接入源，不是学习页的课程源
 *
 * B 站视频**不抢「学习」页的任何内容**：
 *
 * | | 智云课堂 | B 站 |
 * | --- | --- | --- |
 * | 进哪个页面 | 「学习」页（课程树 / 讲义 / 出题） | **将来的「知识库」** |
 * | 谁提供 `zhiyunClassroom` | `source-classroom` | **本包不提供、不参与** |
 *
 * 所以本包**没有**、也不该有 `listCourses` / `listLessons` / `getCurrentUser`。
 * 它只负责把一条视频变成 `{ slides, subtitles }`；**产物怎么存不在本包**。
 *
 * > 📌 曾经写过一份 `src/source.js`（395 行，同形 `zhiyunClassroom`），方向是错的，已删除。
 * > 错在把「B 站是第二种课程数据源」当成了前提 —— 它连「课程」这个概念都不属于。
 *
 * # 它补的是哪条路
 *
 * `ctx.zhiyunParser.parse({ slides, subtitles })` 是**通用**的加工入口：
 * 它不认识"智云"，只吃两个数组。智云课堂喂的是一份，B 站喂的是另一份。
 *
 * ```text
 * 智云课堂接口 ──→ slides[] + subtitles[] ──┐
 *                                        ├──→ parse() → vision → mix → 建树 → 讲义
 * B 站视频     ──→ slides[] + subtitles[] ──┘
 * ```
 *
 * **加工链是共用的，数据来源是并列的。** 本包负责把一条 B 站视频
 * 变成同样形状的两个数组 —— 但**产物去哪**由将来的知识库决定，不是本包。
 *
 * # 已完成的部分
 *
 * | 模块 | 内容 | 性质 |
 * | --- | --- | --- |
 * | `wbi.js` | WBI 签名（置换表 + 签名串 + 从 nav 取 key） | **纯函数**，可离线单测 |
 * | `subtitles.js` | B 站 `cues[]` → 本仓 `subtitles[]` | **纯函数**，可离线单测 |
 * | `http.js` | fetch + 风控识别（412 / 200-HTML）+ 业务码翻译 | 薄 IO 层 |
 * | `subtitle-channel.js` | nav → 签名 → `wbi/v2` → 字幕 CDN → 规范化 | 编排 |
 * | `errors.js` | 具名失败码（每个码对应一种处置） | 纯函数 |
 * | `triage.js` | **判型**：这条视频适不适合抽帧成页 | **纯函数**，可离线单测 |
 * | `segment.js` | **帧 → 页**：切段、出交付图、产出 `slides[]` | **纯函数**，可离线单测 |
 * | `frames.js` | **抽帧执行**：下载 + ffmpeg 抽帧 | IO 层（`spawn` 可注入） |
 * | `playurl.js` | **播放地址**：`aid`+`cid` → 单个 mp4 直链 | 薄 IO 层 |
 * | `lesson.js` | **编排**：BV 号 → `{ slides, subtitles }` | 编排层 |
 * | `upstream.js` | 锁版凭据 + 实测结论 | 常量 |
 *
 * # 实测事实（2026-10-29，见 `README.md`）
 *
 * - **匿名拿不到字幕**：92 个视频，`subtitles` 100% 为空；
 * - 但**签名路径是通的**（匿名 `wbi/v2` 回 `code=0`）→ 缺的是登录态，不是实现；
 * - 自建整条字幕通道 **50 行**（纯函数 24 行），远小于挂载体量。
 *
 * # 身份问题：B 站的 aid/cid 能直接用
 *
 * `workbench.js` 的 `identifier()` 要求纯数字（`/^[0-9]{1,20}$/`），
 * `knowledge` 的 `IDENTITY_RE` 要求「不含冒号与空白」。
 * B 站 `aid`（AV 号）与 `cid`（分 P 号）**都是纯数字**，都能直接过。
 *
 * 但 `courseId` 挂什么尚未拍板（单个视频 / 合集 / UP 主）—— 见 README 的待裁定表。
 *
 * # 为什么 `apply()` 不抛错
 *
 * 本包没有 `cordis.patch.yml`，本来就不会作为 bundle 层生效。
 * 而**一旦被误写进 `dsh.profile.bundles` 就抛错，会把整个工作台拖垮**
 * （见 CONTRIBUTING 3.1）。所以只 warn。
 *
 * # 还差什么（按依赖顺序）
 *
 *   [x] 字幕通道（`wbi.js` / `subtitles.js` / `http.js` / `subtitle-channel.js`）
 *   [x] **判型**（`triage.js`）：先判这条视频是不是「翻页式课件」，判不出就不抽
 *   [x] **「帧 → 页」归并**（`segment.js`）：双条件切段、段末出图 / 段首计时、契约自检
 *   [x] **抽帧执行**（`frames.js`）：下载 + 一次顺序解码抽帧；ffmpeg 参数已用真实素材验证
 *   [x] **播放地址**（`playurl.js`）：`fnval=1` 取单文件 mp4；真实接口验过
 *   [x] **编排**（`lesson.js`）：`buildLesson` / `finishFrames`；字幕与画面各自独立失败
 *   [ ] 抽帧路线（ffmpeg 还是浏览器 canvas）
 *   [ ] `courseId` 口径（产品决策）
 *   [ ] **产物存到哪**：等「知识库」功能立项后再定（见 README「定位」一节）
 *
 * # 明确不做
 *
 *   - ❌ 不新增导航项；
 *   - ❌ 不改 `dsh-zhiyun-core-parser`；
 *   - ❌ 不写入 `profiles/zhiyun-bench/package.json`；
 *   - ❌ 不搬运上游参考仓库的源码（见根 ATTRIBUTION.md）；
 *   - ❌ 不读别人的凭证文件（上游自己的 `credential.json` 与本包无关）。
 */

export const name = 'dsh-zhiyun-source-bilibili';

/**
 * 不注入任何宿主服务 —— **目前没有任何 `apply` 行为**。
 *
 * 真正接入时要 `['profileContext']`（落帧图缓存与凭证位置）。
 * 但**声明即契约**：没想清楚之前不写，免得 profile 因为一个空依赖 pending。
 */
export const inject = [];

export function apply(ctx) {
  ctx?.logger?.warn?.(
    '[zhiyun-source-bilibili] 解析链路已完整；产物存储未定（等知识库立项）；本包未接入 profile。'
    + ' 见 src/index.js 的模块表与 README 的待裁定列表。',
  );
}
