# dsh-radar-score-practice

> ⚠️ **候选骨架：未评审、未接入 profile、不可直接使用。**
> 由「DSH 生态雷达」自动生成（2026-10-17 · 第十四轮 · 音乐/乐理正交轴）。采用前请**重写**并走正常包流程。
>
> **本包是「强化式集成」，不是「全新功能」。**

## 上游

| 项 | 值 |
| --- | --- |
| 渲染库 | `opensheetmusicdisplay` @ **2.2.1**（锁版，不用 `^`） |
| 仓库 | https://github.com/opensheetmusicdisplay/opensheetmusicdisplay |
| 许可证 | **BSD-3-Clause** ✅（宽松白名单） |
| 规模/活跃 | ★1992 · fork 384 · TS · 建 2016-02-08 · push 2026-10-15（十余年老库，仍在活跃维护） |
| 能力 | MusicXML → 浏览器 / Node 无头渲染（底层为 VexFlow），提供 cursor / 小节定位 / 逐音事件 |
| 回放库 | `osmd-audio-player` @ **0.7.0**（锁版） |
| 仓库 | https://github.com/jimutt/osmd-audio-player |
| 许可证 | **MIT** ✅ |
| 规模/活跃 | ★133 · fork 33 · **push 2023-01-07（≈3.8 年未更新）** |
| 能力 | PlaybackManager：按谱面调度音源、cursor 跟随、seek / 倍速 |

## 集成判定

- **类型**：**B · 其他 JS 项目** —— 上游无 `dsh.bundle.patch` / `cordis.patch.yml`，
  故本包**不含上游 DSH 依赖**，按 B 类「能力提取 + 封装」处理。
- **与现有功能的关系**：**强化式集成**，增强「看课」页（`dsh-zhiyun-page-player`）的**课件区素材类型**。
- **为什么算强化而非重复**：三条**同时**成立 ——
  1. **仍是同一个面板**：**不新增导航项、不新增页面**，只是「看课」页课件区多一种可跟随的素材；
  2. **功能仍相似正交**：仍然是「媒体 + 播放头 + 文本/位置对齐」，与现有「视频 + 字幕 + 课件同屏」
     是同一交互范式；谱面只是把「对齐对象」从字幕行换成了小节/音符 —— 正交而非取代；
  3. **底层多调了更优质实现**：本仓**没有**任何乐谱渲染 / MusicXML 解析能力。
     OSMD 是 MusicXML 渲染的事实标准之一（十年维护、★近 2000），自研不现实。
- **集成方式**：锁版引入 npm 包 + 薄封装（能力提取 + 封装，**不搬运上游源码**，尤其**不复制**
  `osmd-audio-player` 的 PlaybackManager 实现）。
- **边界**：播放状态仍归 `dsh-zhiyun-page-player`；本包只**只读消费**其时钟，
  并把自己的 seek 请求回写给播放器。**不自建播放器、不自建落盘**。

## ⚠ 关键前置裁决：`osmd-audio-player@0.7.0` 的版本错配

`osmd-audio-player@0.7.0` 的 `dependencies` 写死 `opensheetmusicdisplay: ^0.8.4`，而本骨架锁 **2.2.1**。
直接安装会出现**两份 OSMD**（一份给回放、一份给渲染），cursor 对象不互通 → **跟随必然失效**。

| 方案 | 做法 | 收益 | 代价 |
| --- | --- | --- | --- |
| ① **只留渲染**（默认） | 只装 `opensheetmusicdisplay@2.2.1`；回放用本仓播放器时钟驱动 cursor | 单一 OSMD 实例，无版本冲突；改动最小 | 需要自己写「时钟 → cursor」映射（约百行级，`src/upstream.js` TODO 2） |
| ② overrides 强统 | `npm overrides` 把 osmd 强制到 2.2.1，再用 osmd-audio-player | 现成 PlaybackManager | 上游声明的是 0.8.x API，**未实测前不成立**；且该库 3.8 年未更新 |
| ③ 换渲染库 | 直接用 `vexflow`（MIT，★247） | 依赖更轻 | 需自带 MusicXML 解析，工作量陡增 |

> **本骨架按【方案 ①】出具**：`package.json` 仍声明两个依赖（便于人工实测方案 ②），
> 但**默认实现路径只走 ①** —— 见 `src/upstream.js` 的 TODO 1。
> 若人工裁决为 ②/③，请改写或直接废弃本骨架。

## 上游未改动声明

本骨架**不含任何上游源码**，仅声明依赖并留下封装 TODO。
MusicXML 渲染完全由 OSMD（BSD-3-Clause）承担，音频调度（若采用）完全由 osmd-audio-player（MIT）承担；
若参照其 PlaybackManager 的设计**重写**，须按 CONTRIBUTING 3.3 记 ATTRIBUTION。

## 主要技术风险（采用前须验证）

1. **版本错配**（见上表）—— 这是本骨架**最大的未决问题**，不实测不得声称可用。
2. **打包体积**：OSMD 解包约 **2.3 MB**（自带 `vexflow@1.2.93` fork + jszip + typescript-collections）。
   须实测其对「看课」页首屏的影响，**建议按需动态 import**，不进关键路径。
3. **音源依赖网络**：`soundfont-player` 默认从 CDN 取 Soundfont，与本仓离线优先原则冲突 →
   须改为随包静态资源，或**直接降级为「静音跟随」**（只要 cursor 跟随，不出声）。
4. **场景窄**：本仓用户中「需要看乐谱」的比例未知，属**小众但真实**的场景；
   因此**必须保证无谱面时零存在感**（不渲染空容器）。
5. **回放库停更 3.8 年**：即便走方案 ②，也应做好随时回退到 ① 的准备。

## 尚未完成（采用前必做）

- [ ] 裁决版本错配（方案 ①②③，见上表）
- [ ] 确认「看课」页课件区是否已有非视频素材挂载位（无则先提 issue 定接缝）
- [ ] 实测打包体积与首屏影响，改为动态 import
- [ ] 实测音源离线化，或落地「静音跟随」降级
- [ ] 与 `dsh-zhiyun-player` 的时间轴单位对齐（ms / 秒）
- [ ] 补测试（`npm test`）、接入 profile、按 CONTRIBUTING 写 `OWNERS`
