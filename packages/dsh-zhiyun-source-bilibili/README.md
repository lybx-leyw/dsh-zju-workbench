# dsh-zhiyun-source-bilibili

> ⚠️ **空骨架：未实现、未接入 profile、不可直接使用。**
>
> 本目录目前只有 `package.json`、`OWNERS`、`src/index.js`（只有注释）、
> `src/upstream.js`（锁版凭据）与本 README。`apply()` 里没有任何行为。
> 它**没有** `cordis.patch.yml`，因此不会被当作 bundle 层加载；
> 也**没有**写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`。

---

## 一句话

给本仓加**第二条数据源**：**B 站视频 → `{ slides, subtitles }`**，
然后交给**已有的** `ctx.zhiyunParser.parse()`。

```text
智云课堂接口 ──┐
              ├──→ { slides[], subtitles[] } ──→ parse() ──→ 讲义 / 出题 / 笔记 / 图谱
B 站视频     ──┘        ↑ 本包
```

**下游一行都不用改。** 这是本包全部价值的前提。

---

## 为什么这条路比「本地视频」简单得多

上一轮我误判成「用户上传 mp4」，那是另一件事（要传几个 GB、要 ffmpeg 二进制、
**且完全没有 ASR 通道**）。B 站这条路把这些障碍绕开了：

| 卡点 | 本地视频 | **B 站视频** |
| --- | --- | --- |
| 上传通道（64 MB base64 上限） | ❌ 装不下 | ✅ **不用传**，只有 BV 号 + Cookie |
| ASR | ❌ 本仓零 ASR 通道 | ✅ **官方 AI 字幕**（需登录），退路才是 ASR |
| ffmpeg 二进制 | ❌ 与「浏览器工作台」判例冲突 | ⚠️ 仍需（抽帧），但**可换成浏览器 canvas** |
| 身份三元组（纯数字） | ❌ 本地文件没有 id | ✅ **`aid` / `cid` 都是纯数字** |
| PPT 来源 | 抽帧 | 抽帧（**同样要抽**，这是唯一没绕开的一项） |

---

## 两条上游，各管一半

| | [`dsh-bili-watch`](https://github.com/Sacredbluedragon/dsh-bili-watch) | [`bili-2-ppt`](https://github.com/ewkzcz/bili-2-ppt) |
| --- | --- | --- |
| 版本 / 提交 | **`0.3.5`**（npm） | `5ebdd759f9493855b82e49ab1d92319b272f906c` |
| 许可证 | MIT | MIT（**双版权头**，含上游 `bili-note`） |
| **能否锁版** | ✅ **已发布 npm** | ❌ 未发布，只能取设计 |
| 体积 | 443,445 B / 13 files | 6.29 MB / 74 files（**5.03 MB 是 PPT 模板**） |
| 运行时依赖 | `qrcode@^1.5.4`（唯一） | Python + venv + 外部 Chrome |
| **管什么** | **字幕** + 元数据 + 抽帧 + OCR | **帧 → 页**的判据 |
| 本地位置 | `.refers/dsh-bili-watch/` | `.refers/bili-2-ppt/` |

**两者不重复**：一个供给 `subtitles[]`，一个供给「怎么把帧变成 `slides[]`」。

> ⚠️ **`dsh-bili-watch` 不做页归并。** 它的 `frames` 是**固定间隔采样**
> （`--step`，默认按秒），同一页停留十分钟就是几十张几乎一样的图。
> 这正是本包 TODO-2 要补的，也是 `bili-2-ppt` 唯一值得我们借鉴的地方。

---

## 字幕这一半：形状已经对上了

上游 `tools/look.mjs` 的 `fetchSubtitle()`（已读本地副本）：

```js
const q = wbiSign({ aid, cid }, k.imgKey, k.subKey)          // WBI 签名
const j = await jget(`https://api.bilibili.com/x/player/wbi/v2?${q}`, headers)
const track = subs.find((s) => s.subtitle_url)               // lan = ai-zh
const sj = await jget(url, { 'User-Agent': UA })
return { ok: true, text, cues: sj.body ?? [], lan: track.lan }
```

`cues` 是 `[{ from, to, content }]`（**秒**，浮点）。转换只有四行：

| 本仓要求 | B 站给 | 换算 |
| --- | --- | --- |
| `text: string` | `content` | 直接用 |
| `startMs ≥ 0` | `from`（秒） | `Math.max(0, Math.round(from * 1000))` |
| `endMs ≥ startMs` | `to`（秒） | `Math.max(startMs, Math.round(to * 1000))` |

### ⚠️ 实测：官方字幕**必须登录态**（这是硬前提，不是优化）

2026-10-29 匿名实测 **92 个视频**：

| 样本 | 数量 | `subtitles` 非空 |
| --- | ---: | ---: |
| 热门榜（3 页 × 20） | 60 | **0** |
| 知识区排行 | 15 | **0** |
| 知名视频 + 分 P 视频 | 17 | **0** |
| **合计** | **92** | **0** |

关键不在「有没有字幕」，而在**签名路径本身是通的**：

```text
nav        → code=-101（未登录）但照样给了 wbi_img，imgKey/subKey 各 32 字符
wbi/v2     → code=0  message=OK           ← 签名正确，没被风控拦
subtitle   → {"subtitles": [], "ai_status": undefined}
```

**所以不是签名写错、也不是被拦，是服务端在匿名态下就不返回字幕轨。**

推论：**登录态是硬前提**。`SESSDATA` + `bili_jct` + `buvid3` + `buvid4` 四字段缺一不可
（与上游同口径），且必须走本仓 `ctx.credentials` / `source-card`，
**不读上游的 `$DSH_HOME/bili-watch/credential.json`**。

无字幕时的退路只有两条：
- **本地 ASR**（不出境，但需 Python venv / 算力评估）
- **第三方 ASR**（音频出境 —— **红线，须人工拍板**，见 `dsh-radar-lecture-notes` README）

### 自建字幕通道的实测代价：**50 行**

探针（`.verify-scratch/bili-subtitle-probe.mjs` + `bili-wbi-probe.mjs`）把
「不挂上游、只要字幕」的最小闭环跑通了。实际代码行统计：

| 段 | 行 | 性质 |
| --- | ---: | --- |
| WBI 签名（`MIXIN_KEY_ENC_TAB` + `getMixinKey` + `wbiSign`） | **20** | **纯函数**，零依赖，`node:crypto` 的 md5 |
| `jget`（fetch + HTML 风控识别 + JSON） | **8** | 去掉上游的重试/诊断/中文错误化之后 |
| `fetchSubtitle`（nav → 签名 → `wbi/v2` → 字幕 CDN → cues） | **18** | 含两次错误分支 |
| `cues → subtitles[]` 转换 | **4** | 三字段映射 + 边界钳位 |
| **合计** | **50** | 其中纯函数 **24 行**，可直接单测 |

对照挂载上游要付的代价：

| 项 | 量 |
| --- | --- |
| npm 包 | 443,445 B / 13 files |
| 宿主半边 `index.js` | 116,332 B |
| 客户端面板 `client.js` | 48,885 B（扫码登录 / 依赖管理 / 缓存清理 / 17 项参数） |
| **新增命令面** | `bili_watch` 工具 + `/bili` 命令**两个** |
| 额外依赖 | `qrcode@^1.5.4` |

> **结论：50 行 vs 一个完整插件 → 取「自建」。**
> 这不仅省钱，更主要是**不往工作台里塞两个命令面和一整套 B 站专用面板**。
> 该结论写在 [`src/upstream.js`](src/upstream.js) 的 `SELF_BUILD_VERDICT` 里。

### ✅ 已实现（2026-10-29）

| 文件 | 行数 | 内容 |
| --- | ---: | --- |
| [`src/wbi.js`](src/wbi.js) | 108 | WBI 签名（置换表 / `mixinKey` / `wbiSign` / `keysFromNav` / `keysLookValid`） |
| [`src/subtitles.js`](src/subtitles.js) | 132 | `cueToSubtitle` / `cuesToSubtitles` / `transcriptOf` |
| [`src/http.js`](src/http.js) | 134 | `getJson` / `getData` / `headersFor`（412 与 200-HTML 两条风控判据） |
| [`src/subtitle-channel.js`](src/subtitle-channel.js) | 170 | `fetchWbiKeys` / `fetchSubtitles` / `resolveLesson` / `inspectCredential` |
| [`src/errors.js`](src/errors.js) | 68 | 8 个具名失败码 + `explainCode` |
| [`src/triage.js`](src/triage.js) | 281 | **判型**：`analyze` / `classify` / `extractionAdvice` / `profileOf` |
| [`src/segment.js`](src/segment.js) | 286 | **帧 → 页**：`segmentFrames` / `buildSlides` / `slidesFromFrames` / `validateSlides` |
| [`src/frames.js`](src/frames.js) | 274 | **抽帧执行**：`downloadVideo` / `extractFrames` / `framesFromUrl` / `probeFfmpeg` |
| [`src/playurl.js`](src/playurl.js) | 137 | **播放地址**：`fetchPlayUrl`（`fnval=1` 取单文件 mp4） |
| [`src/lesson.js`](src/lesson.js) | 200 | **编排**：`buildLesson` / `finishFrames` |
| [`src/source.js`](src/source.js) | 379 | **同形数据源**：`createBilibiliSource` / `parseTarget` |
| [`src/upstream.js`](src/upstream.js) | 135 | 锁版凭据 + `SELF_BUILD_VERDICT` + `SUBTITLE_REQUIRES_LOGIN` |
| [`src/index.js`](src/index.js) | 85 | Cordis 包装（**`apply()` 只 warn**） |

**测试：[`tests/bilibili-source.test.mjs`](../../tests/bilibili-source.test.mjs)，88 条，全离线通过。**

> `npm test` 用 `node --test`（要 fork 子进程）。沙箱里 fork 被拦（`spawn EPERM`），
> 所以本地验证用 `node tests/bilibili-source.test.mjs` —— `node:test` 支持进程内跑。

实现过程中**实跑抓到两个 bug**，都已修并配了回归断言：

| bug | 表现 | 修法 |
| --- | --- | --- |
| `fetchWbiKeys` 走了 `getData` | 匿名 `nav` 回 `code=-101` → 直接抛 `CREDENTIAL_EXPIRED`，**匿名态连签名都拿不到** | 改用 `getJson` 拿原始 payload，只判 `wbi_img` 在不在 |
| `keysLookValid({ ... } = {})` | 传 `null` 时抛 `TypeError: Cannot destructure` —— 默认参数**只接管 `undefined`** | 改成 `keys ?? {}` |
| `transcriptOf` 的 `nextStampMs += Infinity` | 第一行之后 `nextStampMs` 变 `Infinity`，**后续行永远不再带时间戳** | 拆成「每行打戳」与「换桶才打戳」两个分支 |

前两个是**读注释时以为写对了、跑起来才发现**的典型；第三个是单测当场抓到的。

---

## 抽帧路线：**已裁定 —— 先下载再本地抽帧**

> 实测于 2026-10-29。这一段是 TODO-3 的结论，全部有数据支撑。

### ① B 站 CDN 的关键特性（与智云完全不同）

| 特性 | 实测结果 | 影响 |
| --- | --- | --- |
| **Referer 校验** | ❌ **不校验**（无 Referer / evil.test 都回 200） | 不需要智云那套转发层 |
| **UA 校验** | ⚠️ **屏蔽 `Lavf/*`**（ffmpeg 默认 UA 回 **403**），浏览器 UA 回 200 | **必须显式 `-user_agent`** |
| **CORS** | ✅ `access-control-allow-origin` **反射请求 Origin**（回显 `http://127.0.0.1:61621`） | **浏览器内 canvas 抓帧可行** |
| **Range** | ✅ 支持（回 `206` + `content-range`） | 可分段下载 |
| **faststart** | ✅ `moov@36`，在 `mdat` 之前 | 可边下边 seek |
| **durl 分片** | ✅ 现代接口 `fnval=1&platform=html5` 返回**单个 mp4** | 可直接 `<video src>` |

> ⚠️ **`Lavf/` 黑名单是踩出来的**：`ffmpeg -i <url>` 直接回 403，
> 而同一条 URL 用 node `fetch` 回 200、`ffmpeg -user_agent "浏览器UA"` 也回 200。
> 第一次误判成「CDN 不校验 UA」，因为只测了 node fetch —— **测工具时要用工具本身测**。

### ② 两条路线的时间成本（同一条 20 分钟视频）

| 路线 | 操作 | 实测耗时 |
| --- | --- | --- |
| **远端 seek**（`ffmpeg -ss N -i <url>`） | 逐页跳转截取 | **8 s / 897 s / 4.6 s**（极不稳定） |
| **先下载再抽** | 下载 18.9 MB | **约 20 s** |
| | `-vf fps=1/5` 一次顺序解码出 239 帧 | **2.5 s** |
| | 本地 `-ss N` 单帧 seek | **约 280 ms**（与时间点无关） |

**结论：远端 seek 完全不可用。**

那次 **896 秒**的失败不是偶发 —— 远端 seek 依赖 CDN 正确响应 Range 并支持
随机访问，任何一段没对上，ffmpeg 就退化成**从头顺序下载**，于是耗时随目标时间点线性增长。

**先下载（20 s）+ 一次顺序抽帧（2.5 s）≈ 23 s，且是确定的。**

### ③ 裁定

```text
1. 取 playurl（fnval=1&platform=html5）→ 单个 mp4 直链
2. ffmpeg -user_agent "<浏览器 UA>" -i <url> -c copy → 本地 mp4
3. ffmpeg -i <mp4> -vf "fps=<1/N>,scale=320:-1" → 全片等间隔帧（一次顺序解码）
4. 帧 → 页归并（见下方判据）
5. 对每一页，用本地 -ss 重新抽一张**全分辨率**的图（280 ms/页，作为交付图）
```

**为什么第 5 步要重抽**：第 3 步抽的是 320 宽的低分辨率帧，只用于**判同**；
交付给 vision 的必须是原分辨率（见「读字面板：面板里的字一律不采信」那条上游教训）。

**为什么不走浏览器 canvas**：CORS 虽然通过，但需要：
① 一个常驻的隐藏 `<video>`；② 顺序 seek 整个视频（或至少跳采样点，那又回到远端 seek 的坑）；
③ 把几百张 canvas 图传回宿主。**比下载 + ffmpeg 多三处失败点，且没有收益。**

> ⚠️ **ffmpeg 依赖**：本仓既有判例（`dsh-radar-zju-recorder`：「录制（ffmpeg）未做，
> 需要二进制分发，与浏览器工作台形态冲突，另行立项」）。
> 这条裁定**与那个判例冲突**，需要在接入前正式拍板：
> 要么接受「B 站源需要本机 ffmpeg」，要么把这条源做成**默认关闭的可选能力**。

---

## 画面这一半：必须自己补「帧 → 页」

`dsh-zhiyun-core-parser` 的 `validateInput()` 要求：

- `slide.page` **正整数、全局唯一**
- `slide.createdSec` 非 null 时须 ≥ 0

而抽帧产出的是一串**等间隔**的图。所以必须：

1. 把帧序列切成「同一视觉状态的连续段」
2. 每段只出一页，**保留段末帧**（第一帧可能停在淡入中间态或代码刚敲到一半）
3. `createdSec` 取**段首**（这一页其实从段首就在屏幕上）
4. `page` 从 1 起、**全局唯一**

段内判据必须是**双条件**：

```text
相邻帧差 < 阈值  &&  与本段首帧的累积差 < 阈值
```

> **⚠️ 这两条各防什么，我在实测前写反过一次。** 下面是跑出来的结论，不是读代码猜的。

用合成签名实测（4 维灰度、阈值 `T = 3`）：

| 场景 | 只用 `step` | 只用 `drift` | **双条件** | 说明 |
| --- | ---: | ---: | ---: | --- |
| 缓慢平移，每帧差 `0.5` | **1 段** ❌ | 20 段 | **4 段** ✅ | `step` 永远小于 T → **整段被吞成一页，只剩最后一帧** |
| 页内动画，每帧差 `1` | **1 段** ❌ | 10 段 | **4 段** ✅ | 同上：`step` 看不见累积变化 |
| 硬切页（10 → 200） | 2 段 ✅ | 2 段 ✅ | **2 段** ✅ | 两条都能切 |
| 缓慢平移，每帧差 `4`（> T） | 20 段 ❌ | 20 段 ❌ | 20 段 ❌ | 单帧就超阈值时，**双条件也救不了** —— 见下方「已知局限」 |

**准确的说法是：**

- **`step` 负责「硬切」**：换页那一帧的相邻差会跳变
- **`drift` 负责「反向的兜底」——防止把一整段缓慢变化吞成一页**：
  单靠 `step` 时，只要每帧都没超过阈值，20 帧的渐显/平移会被判成 1 段，
  最后只剩最后一张图，**过程信息全丢**
- **两条都只是必要条件**，不是充分条件

> 📌 我原来在这份 README 里写的是「只用 `step` 会把缓慢平移判成每帧都是新页」——
> **方向正好写反了**。那是「单帧差 > T」才会发生的事，与「缓慢」自相矛盾。
> 已按实测改正。

#### 已知局限（必须先接受，再谈落地）

| 局限 | 后果 | 缓解 |
| --- | --- | --- |
| 单帧差 > T 的连续变化（如快速滚动代码、翻页动画） | 每帧都被判成新页 → 页数爆炸 | 事后按 `drift` 再合并一轮；或提高采样间隔让单帧跨过动画 |
| 烧录字幕条（底部每帧都在变） | 抬高 `step`，同一页被判成多页 | **排除底部 12% 区域**（见下方「遮挡遮罩」） |
| 阈值 `3.0` 是别人的素材标的 | 可能偏松或偏紧 | **必须在本仓素材上重标**，验收标准见下 |

> 阈值 `3.0` 来自 `bili-2-ppt`（灰度 96×54 缩略图平均像素差）。
> 那是他们在 **B 站素材**上标定的 —— **这里的素材同样是 B 站**，
> 所以反而比「智云课件」场景更可信；但仍应以真实样本复核一遍。

### 判据设计（**已用真实素材标定**，未实现）

#### 实测素材与结论（2026-10-29）

素材：`BV11DXrYeE5D`《线性代数》全国青教赛理科组总决赛，19:58，18.9 MB。
采样：`ffmpeg -vf fps=1/5`，239 帧，**2.5 秒抽完**。

**相邻帧差分布（96×54 灰度平均绝对差）：**

| 分位 | p50 | p90 | p99 | **max** |
| --- | ---: | ---: | ---: | ---: |
| 值 | **2.25** | 4.18 | 8.46 | **113.25** |

**关键发现：这个分布是「单峰长尾」，不是「双峰」。**

| 事实 | 含义 |
| --- | --- |
| p50 = 2.25，绝大多数相邻帧几乎一样 | 同一页内的动画/光标/镜头微动 |
| 只有 **1 次** ≥ 40（帧 230，差 113.25） | 整段时间里真正的「硬切页」只有 1 次 |
| ≥ 8 的只有 **5 次** | 换页 + 少量大幅动画 |
| **Otsu 自适应阈值 = 12.21，按它切只有 3 段** | 这条视频**整节只有 2–3 页** |

→ **「课件视频是多数静止 + 偶尔整屏跳变」这个前提，在实拍课堂里不成立。**
这条素材是「一块黑板 + 一个老师走动」，画面**一直在小幅变化**。

#### 阈值不能靠「看分布取谷底」定 —— 谷底可能不存在

扫了 12 个阈值（同一批 239 帧）：

| T | 段数 | 单帧段占比 | 平均每页时长 |
| ---: | ---: | ---: | ---: |
| 2 | 168 | 71% | 7 s |
| 3 | 85 | 33% | 14 s |
| 4 | 44 | 25% | 27 s |
| 5 | 22 | **9%** | 54 s |
| 6 | 11 | **0%** | 109 s |
| 8 | 8 | 0% | 149 s |
| 12 | 6 | 0% | 199 s |

**拐点在 T≈5**（单帧段占比从 25% 骤降到 9%，T≥5.5 归零）。但拐点不等于正确 —— 要拿真实页数核对。

#### 更可靠的判据：**跨采样间隔稳定性**

这是本次标定最有价值的一条。同一素材按不同间隔重采样，看段数是否稳定：

| 采样间隔 | 帧数 | p50 | p90 | **T=6 段数** | **T=8 段数** | T=12 段数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 s | 239 | 2.25 | 4.18 | **11** | **8** | 6 |
| 10 s | 120 | 2.74 | 5.09 | **11** | **8** | 3 |
| 15 s | 80 | 3.19 | 5.48 | **11** | **8** | 6 |
| 20 s | 60 | 3.44 | 6.70 | **11** | **8** | 4 |

- **T=6 与 T=8 在四种采样间隔下给出完全相同的段数** ← 判据在**这个区间内是稳定的**
- **T=12 在 3–6 之间跳动** ← 已经吃到「采样间隔」这个无关变量，说明它超出了合理范围

> **结论：推荐区间是 T ∈ [6, 8]，不是 B 站上游用的 3.0。**
> 3.0 会把这条 2 页的视频切成 85 段（**过切 40 倍**）。

#### 已知盲区（实测出来的，不是推测）

第 12 段（210s–570s，360 秒）段内检查：

```
段首帧 f43 vs 段末帧 f115 → 距离 4.57   （< T=5，没触发 drift）
段内最大相邻差 3.89 在帧 115            （< T=5，没触发 step）
```

→ **双条件同时失效**：页面在 6 分钟里**缓慢渐变**（写板书、擦黑板、镜头推拉），
`step` 与 `drift` 都压在阈值以下，真实的内容变化被吞掉。

**试过的补丁与结果（都没解决问题）：**

| 补丁 | 结果 |
| --- | --- |
| 加第三个条件 `step < peak`（peak=3） | **更糟**：peak 比 p90 还严，22 个单帧段，100 段 |
| 抬到 T=6，靠 drift 兜 | 11 段、0 单帧段，但那段 6 分钟仍是一页 |
| Otsu 自适应 | 12.21，3 段（整节 3 页），**过粗** |

**根因**：这条素材本身**没有清晰的页边界**。它不是「翻页式课件」，是「一块板写满 20 分钟」。

→ **这不是阈值问题，是素材类型问题。** 判据对于「PPT 翻页式」视频适用，
对「板书/实拍」视频不适用。**接入时必须先判型**，不能一律套用。

#### 输入

```js
// 来自上游 frames（等间隔采样，按时间排序）
frames = [{ file: 'BVxxx-01.jpg', timeSec: 0 }, { file: 'BVxxx-02.jpg', timeSec: 10 }, ...]
```

#### 三步

```text
① 逐帧算签名   灰度 96×54 缩略图（sharp.resize），得到 5184 个字节
② 切段         step  = d(f[i-1], f[i])     相邻差
               drift = d(runStart, f[i])   与段首累积差
               step < T && drift < T  →  留在当前段
               否则                   →  开新段
③ 每段出行    imagePath  = 段末帧
               createdSec = 段首帧的 timeSec
               page       = 段序号（从 1 起）
```

#### 为什么「段末出图、段首计时」——两条都不能反

| 取错 | 症状 |
| --- | --- |
| 段末帧 + **段末**时间 | `createdSec` 落在这一页快结束的时刻；`anchor()` 会把**这一页本该接住的字幕**分给下一页 —— 讲解内容整体错位一页 |
| **段首**帧 + 段首时间 | 图可能是淡入中间态、代码敲到一半、动画未完成 —— 用户在讲义里看到的是一张残缺的页 |
| 取中间帧 | 两个问题各占一半 |

#### 阈值不能照抄的三个理由

| # | 理由 |
| --- | --- |
| 1 | `3.0` 是在 **ffmpeg 抽的 1920×1080 JPG** 上标的；若改浏览器 canvas 取帧，压缩噪声与色彩空间都不同 |
| 2 | 上游用 **Pillow 的 `ImageStat.mean`**（灰度平均绝对差）；本仓用 **sharp**，若换成 `raw` 直算需确认是同一量纲 |
| 3 | B 站视频有**烧录字幕条**（底部逐帧变化）与**画中画小窗**（讲师出镜）—— 这两块每帧都在变，会把 `step` 抬高，导致**同一页被判成多页** |

第 3 条最要命。上游的答案是**遮挡遮罩**：

- `bili-2-ppt` 的 `overlay` 阶段：识别「不是幻灯片内容」的像素（烧录字幕条 / 手写笔迹 / 画中画小窗 / 临时工具面板）
- `video-slide-extractor` 的 `mask`：标定阶段自动找出「一直在动的区域」并排除

**最小可行方案（建议）**：先只排除**底部固定高度的字幕条**（比如底部 12%），
那是 B 站画面里最稳定、最容易识别、影响最大的一块。画中画小窗位置不固定，留到第二轮。

#### 与 `anchor()` 的配合（这一步容易漏）

`dsh-zhiyun-core-parser/src/core.js` 的 `anchor()` 用 `createdSec` 把字幕分进各页时间窗：

```js
const anchors = slides.map(s => s.createdSec > 0 ? s.createdSec * 1000 : null);
const ends[i] = anchors.slice(i + 1).find(a => a !== null) ?? null;   // 下一页段首 = 本页窗口末
```

所以 `createdSec` **必须严格递增**。两段算出同一个 `createdSec`（采样点重合）时，
`anchor()` 会报「存在重复时间锚点，部分页时间窗为空」。

→ 归并阶段要**保证产出严格递增**：重复时保留前一页、丢掉后一页（它们本来就是同一页）。

#### 验收标准（先定判据，再写代码）

| 检查 | 期望 |
| --- | --- |
| `page` 从 1 起、连续、唯一 | `pages.every((p,i) => p.page === i+1)` |
| `createdSec` 严格递增 | `pages.every((p, i) => i === 0 ? true : p.createdSec > pages[i - 1].createdSec)` |
| 页数合理 | 一节 40 分钟的课 **30–80 页**（少于 20 = 严重合并；多于 200 = 没归并） |
| 抽检 10 页 | 人工比对视频对应时刻，**至少 8 页是「一页完整内容」** |
| 相邻页确实不同 | 特征相似的相邻页应 `drift >= T` |

---

## 待裁定（3 条已裁定，剩 2 条）

| # | 问题 | 结论 |
| --- | --- | --- |
| **1** | ~~锁版挂载 `dsh-bili-watch`，还是自建？~~ | ✅ **自建**（50 行 vs 116 KB 宿主 + 48 KB 面板 + 两个命令面）。依据见 `src/upstream.js` 的 `SELF_BUILD_VERDICT` |
| **2** | 「帧 → 页」用哪套判据、阈值定多少？ | ✅ **双条件，T ∈ [6, 8]**（跨采样间隔稳定的区间）。判型（`triage.js`）与归并（`segment.js`）均已实现 |
| **3** | 抽帧走 ffmpeg 还是浏览器 canvas？ | ✅ **ffmpeg，先下载再本地抽**（远端 seek 实测 8–897 s，不可用）。已实现（`frames.js`）。⚠ 与「不引入二进制」判例冲突，见「抽帧路线 · ③ 裁定」末段 |
| **4** | 产物存到哪个知识库？ | ❌ **未裁定**。B 站不进「学习」页，是将来「知识库」的接入源 —— 见下方「定位」一节 |
| **5** | 登录态与数据策略 | ⚠️ **登录态已定**（匿名 92 样本 0 字幕，硬前提；凭证走 `ctx.credentials`）。**数据策略未裁定**：无字幕时若引入第三方 ASR，视频音频出境须先拍板 |

---

## 定位：**B 站是知识库的接入源，不是学习页的课程源**

> ⚠️ 这一条很重要，写在这里是为了防止后来人（包括我自己）再走错方向。

**B 站视频不抢「学习」页的任何内容。**

| | 智云课堂 | B 站 |
| --- | --- | --- |
| 进哪个页面 | **「学习」页**（课程树 / 讲义 / 出题） | **将来的「知识库」** |
| 身份键 | `accountId:courseId:subId` | 待定（见下） |
| 谁提供 `zhiyunClassroom` | `dsh-zhiyun-source-classroom` | **本包不提供、不参与** |

**所以本包没有、也不该有 `listCourses` / `listLessons` / `getCurrentUser`。**
本包只负责把一条视频变成 `{ slides, subtitles }`，**产物怎么存、存到哪，不在本包**。

> 📌 曾经写过一份 `src/source.js`（395 行，同形 `zhiyunClassroom`），
> 方向是错的，已删除。错在把「B 站是第二种课程数据源」当成了前提 ——
> 而实际上它连「课程」这个概念都不属于。

### 知识库怎么接：**未定，等那个功能立项**

产物形状已经稳定（`{ slides, subtitles }` 能直接过 `parse()`），
但**存到哪**取决于知识库的设计：

| 方案 | 前提 | 状态 |
| --- | --- | --- |
| 复用 `zhiyunKnowledge` 的 `lectures` 表 | 知识库也按 `accountId:courseId:subId` 组织 | ❌ **未裁定** |
| 新开一个域（如 `zhiyun_bilibili`） | B 站有自己的元数据（BV 号 / UP 主 / 封面 / 分 P） | ❌ **未裁定** |
| 本包只产数据，由未来的知识库包来读 | 最解耦 | ✅ **当前做法** |

**当前的做法是第三行：本包到此为止，不碰存储。**

### 那现在还缺什么

| 事项 | 状态 |
| --- | --- |
| 字幕通道真拿一次字幕 | ⚠️ 需要登录态（匿名 92 样本 0 字幕） |
| `slides` 分支的真实 PPT 样本 | ⚠️ 只有合成夹具 |
| 知识库的存储形状 | ❌ **等立项** |

---

## 上游参考已落地

| 项 | 值 |
| --- | --- |
| `.refers/dsh-bili-watch/` | 提交 `6b2d3ccdaafa66e63090cb9032f7dbaa3272966e`，归档 SHA-256 `7e1e1ac15a91912c1019ae8a4c12645f0ccb7b73e5b9506ea19ffa46a67ee0aa`，174,998 B（解包 524 KB） |
| `.refers/bili-2-ppt/` | 提交 `5ebdd759f9493855b82e49ab1d92319b272f906c`，归档 SHA-256 `f5f42a38ce59983b98d09ce9486000a5206a58c40456ca7cd5f0a5b2a2669575`，4,523,988 B（解包 6.5 MB） |

两者都被 `.gitignore` 的 `/.refers/` 覆盖，**不随仓库分发**。
均已按 CONTRIBUTING 3.3「只做了简单借鉴」记录在根 [ATTRIBUTION.md](../../ATTRIBUTION.md)。

---

## 明确不做

- ❌ 不新增导航项
- ❌ 不改 `dsh-zhiyun-core-parser`
- ❌ 不写进 `profiles/zhiyun-bench/package.json`
- ❌ 不搬运 `.refers/bili-2-ppt/` 的源码
- ❌ 不读别人的凭证文件（`$DSH_HOME/bili-watch/credential.json` 是上游的，不是我们的）

---

## 相关

- `packages/radar/dsh-radar-slide-dedup/` —— 「跨页判同」的候选骨架，与本包画面那一半是同一个问题
- `docs/show/transcript-unit-architecture.md` —— `slides` 为空时那条链路的可执行规格
- `packages/dsh-zhiyun-core-parser/src/parser.js` —— `validateInput()` 与 `bytes()`，本包的输入契约来源
