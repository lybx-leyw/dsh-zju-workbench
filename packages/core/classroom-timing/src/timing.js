/**
 * 朗读时长估算 —— 课堂系列里「一段话要读多久」的唯一实现。
 *
 * # 为什么单独成一个模块，而不是留在 timeline.js 里
 *
 * 这段逻辑被三处需要：舞台（排时间轴）、导出（生成视频音轨）、
 * agent（估算动作耗时）。原本三处各抄一份，实测数值一致纯属巧合 ——
 * 任何一处被单独调整，导出视频就会与播放器静默漂开。
 *
 * 收敛时如果把实现留在 `timeline.js`，另外两处 import 它就会**连带内联
 * 整条依赖链**（timeline → ledger → geometry），把 `stage` 这个客户端包
 * 拖进服务端包的产物里。所以把这 30 行纯逻辑抽出来单独成模块：
 * 它不 import 任何东西，谁都可以安全内联。
 *
 * # 数值来源
 *
 * 上游 `timing.ts:113-130`：中文按 150ms/字、西文按 240ms/词，
 * 最短 2000ms（一句话再短也要有基本停顿）。按语速线性缩放。
 */

/** CJK 判定：汉字、扩展 A、假名、谚文。 */
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g;

/** 超过这个比例就当整句是中文（中英混排时按主体语言算）。 */
const CJK_RATIO_THRESHOLD = 0.3;

/** 一句话的最短停顿。 */
const MIN_READING_MS = 2000;

/** 中文每字毫秒数。 */
const CJK_MS_PER_CHAR = 150;

/** 西文每词毫秒数。 */
const NON_CJK_MS_PER_WORD = 240;

/**
 * 估算一段旁白的朗读时长（无 TTS 音频时使用）。
 *
 * @param {string} text
 * @param {{ speed?: number }} [options] 语速倍数，默认 1
 * @returns {number} 毫秒
 */
export function estimateSpeechDurationMs(text, options = {}) {
  const speed = Number(options?.speed) > 0 ? Number(options.speed) : 1;
  const source = String(text ?? '');
  const cjkCount = (source.match(CJK_REGEX) || []).length;
  const isCJK = cjkCount > source.length * CJK_RATIO_THRESHOLD;
  const rawMs = isCJK
    ? Math.max(MIN_READING_MS, source.length * CJK_MS_PER_CHAR)
    : Math.max(MIN_READING_MS, source.split(/\s+/).filter(Boolean).length * NON_CJK_MS_PER_WORD);
  return rawMs / speed;
}
