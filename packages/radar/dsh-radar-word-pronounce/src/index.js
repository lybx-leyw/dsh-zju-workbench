/**
 * dsh-radar-word-pronounce · 占位入口
 *
 * ⚠️ 候选骨架：未评审、未接入 profile、不可直接使用。
 * 本文件**只抛错**，不含任何实现 —— 目的是让「挂上去会立刻失败」而不是「静默什么都不做」。
 *
 * 上游：`cmu-pronouncing-dictionary@3.0.0`（ISC）。风险见 ./upstream.js。
 * 集成性质：**强化式集成**（不是全新能力）。见 README「强化三判据」。
 */

/**
 * cordis 插件入口（占位）。
 *
 * 之所以这里抛错而不是 `return`：
 * 一个「什么都不做的插件」挂进 profile 后，用户只会看到「没效果」，
 * 却查不出是插件没实现、还是上游没装、还是调用点没接。抛错能立刻定位。
 */
export function apply() {
  throw new Error(
    'dsh-radar-word-pronounce: 候选骨架，未评审、未实现。采用前请按 README 的 TODO 重写。',
  );
}

/**
 * TODO（评审需逐条拍板，按依赖顺序）
 *
 * [ ] 1. 归一化入口：`normalizeLookupKey(word)` —— 小写 → 去空白 → 去 `(n)` 取首变体
 *        → 去所有格 `'s`/`’s`。返回值须能反查回原词（客户端要显示原样）。
 *        **验收词**：`student's` / `students` / `Students` / `well-known`。
 *
 * [ ] 2. 查表：`lookup(word) → { arpabet, syllables, primaryStress } | null`
 *        —— 只在宿主侧调 `loadUpstreamDictionary()`（4.7 MB，见 R-2）。
 *        `syllables` 由「含数字的音素」切分：ARPAbet 里每个元音带 0/1/2，**元音数 = 音节数**。
 *
 * [ ] 3. 回落链：查不到 → 返回 `null`，**不抛错**，由调用方决定回落 TTS 直读还是隐藏。
 *        评审须确认：隐藏（不显示音标）与误显示（错音标）哪个对用户更糟 —— 本骨架倾向隐藏。
 *
 * [ ] 4. ARPAbet → IPA 映射表（**自写，约 39 项**）：`{ AA: 'ɑ', AA1: 'ˈɑ', ... }`。
 *        口音固定为**通用美式**（R-1）。不得摘取 `arpabet-to-ipa` 系的代码（它们无 npm 发布）。
 *
 * [ ] 5. 客户端接口：只下发 `{ ipa: string, syllables: number, stressIndex: number }`，
 *        **不下发整表、不下发 ARPAbet**（客户端看不懂，也没必要）。
 *
 * [ ] 6. 落点（三选一或全选，须评审确认「同一面板」不被破坏）：
 *        · `page-notes`  正文英文词的长按/悬停 —— 与既有「悬停翻译」（`page-paper` 的 dwell 机制）**不冲突但要错开触发**；
 *        · `page-quiz`   题干英文词 —— 只读展示，不参与判分；
 *        · `page-study`  词汇卡 —— 与 `dsh-radar-fsrs-scheduler` 的复习卡同步展示音标。
 *
 * [ ] 7. 与既有 TTS 的拼接：音标（本包） + 发音音频（`ctx.zhiyunClassroomMedia.tts`）。
 *        **两者不要合并成一个按钮** —— 一个给「看」，一个给「听」，合并会重演 r166 `confirm-gate` 的
 *        「两套语义塞进一个出口」问题。
 */
