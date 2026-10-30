/**
 * **判型**：这条视频适不适合「抽帧成页」。
 *
 * # 为什么必须先判型（实测结论，不是推测）
 *
 * 2026-10-29 对一条 19:58 的实拍课堂（`BV11DXrYeE5D`，青教赛）做了完整标定：
 * 239 帧（每 5 秒一帧）、96×54 灰度平均绝对差，得到：
 *
 * | 分位 | p50 | p90 | p99 | max |
 * | --- | ---: | ---: | ---: | ---: |
 * | 值 | **2.25** | 4.18 | 8.46 | **113.25** |
 *
 * 这是**单峰长尾，不是双峰**。整段时间里真正的「整屏跳变」只有 **1 次**，
 * 其余全是同一块黑板上写字的连续变化。
 *
 * 后果：
 *
 * - 用上游 `bili-2-ppt` 的阈值 `3.0` → 切成 **85 段**（真实页数 2–3 页，**过切 40 倍**）
 * - 用 Otsu 自适应 → 12.21 → **3 段**（把 6 分钟板书压成一页）
 * - 加第三个条件（`step < peak`）→ **更糟**，22 个单帧段
 *
 * **根因不是阈值，是素材类型。** 对板书/口播视频硬抽，会产出一份「3 页的讲义」——
 * 比不给讲义更糟，因为它看起来像真的。
 *
 * # 判据：不看单一阈值，看两个比例
 *
 * | 指标 | 含义 | PPT 翻页式 | 板书 / 实拍 |
 * | --- | --- | ---: | ---: |
 * | `staticRatio` | 相邻差 < `STATIC_EPS` 的占比 | **高**（同页内几乎不动） | **低**（一直在变） |
 * | `jumpRatio` | 相邻差 ≥ `jumpFloor` 的占比 | **高**（每翻一页跳一次） | **极低**（整段没几次） |
 *
 * 实测对照：
 *
 * | 素材 | staticRatio | jumpRatio | 判型 |
 * | --- | ---: | ---: | --- |
 * | 青教赛（板书） | 0.038 | 0.004 | `continuous` |
 * | 合成 PPT（60% 静止 + 12% 翻页） | 0.60 | 0.12 | `slides` |
 *
 * ⚠️ **诚实标注**：`continuous` 一支在**真实素材**上验过；`slides` 一支目前只有
 * **合成**夹具（本机没有可用的 PPT 式 B 站样本）。接入前应补一条真实 PPT 样本。
 *
 * # 纯函数
 *
 * 本文件不 import `sharp`、不读文件、不联网 —— 输入是**签名数组或距离序列**，
 * 由调用方决定怎么算（sharp / canvas / 别的方式）。所以它能离线单测，
 * 也能在浏览器里跑（`Uint8Array` 通用）。
 */

/** 少于这么多帧就不下结论 —— 样本不够时任何统计量都不可信。 */
export const MIN_FRAMES = 20;

/**
 * 「几乎没变」的绝对阈值（96×54 灰度平均绝对差）。
 *
 * 取值依据：实测同一页内的正常抖动 p50 = 2.25、p90 = 4.18。
 * 取 1.0 意味着「只有真正静止的帧对才算静止」—— 比 p50 严，宁可低估静止比例，
 * 也不要因为画面轻微压缩噪声就把板书判成 PPT。
 */
export const STATIC_EPS = 1.0;

/** 「跳变」的绝对下限：低于它的差值不可能是整屏换页，最多是局部动画。 */
export const JUMP_FLOOR = 6;

/**
 * 「跳变」的相对倍数：至少达到 **p75** 的这么多倍。
 *
 * ⚠️ 这里原本用 p90，实测发现是**错的**：
 * 造一个「10 页 × 5 帧」的标准 PPT 夹具（页内抖动 ≈ 0.9、跨页跳跃 = 23），
 * 跳变占 9/49 ≈ 18% —— **已经超过 90 分位**，于是 `p90 = 23`，
 * `jumpFloor = 23 × 3 = 69`，把真实的跳变自己排除在外，`jumpCount = 0`。
 *
 * 用 p75 的道理：只要跳变占比低于 25%，p75 落在「页内抖动」那一侧，
 * 不会被跳变自己污染。而翻页式课件的跳变占比实测就在 3%–20% 区间。
 */
export const JUMP_MULTIPLIER = 3;

/** `slides` 判型要求的静止比例下限。 */
export const SLIDES_STATIC_RATIO = 0.45;

/** `slides` 判型要求的跳变比例下限。 */
export const SLIDES_JUMP_RATIO = 0.03;

/** 判型结果。 */
export const KIND = Object.freeze({
  /** 翻页式课件：页内静止、翻页整屏跳变。**可以抽帧成页。** */
  SLIDES: 'slides',
  /** 连续变化：板书、实拍课堂、口播访谈。**不应抽帧成页。** */
  CONTINUOUS: 'continuous',
  /** 画面几乎不动：静止画面、黑屏、固定摄像头。**没有页结构。** */
  STATIC: 'static',
  /** 判不出来（帧数不足 / 落在边界）。**按「不抽」处理。** */
  UNKNOWN: 'unknown',
});

/**
 * 两个签名的**平均绝对差**。
 *
 * @param a - `Uint8Array` / `Buffer` / 普通数组（等长）。
 * @param b - 同上。
 * @returns 平均绝对差（0–255 区间）。长度不等时取较短的一侧（调用方应保证等长）。
 */
export function signatureDistance(a, b) {
  const length = Math.min(a?.length ?? 0, b?.length ?? 0);
  if (length === 0) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) sum += Math.abs(a[index] - b[index]);
  return sum / length;
}

/**
 * 把签名序列压成**相邻距离序列**。
 *
 * @param signatures - 签名数组（每个是等长的字节序列）。
 * @returns 长度 `signatures.length - 1` 的距离数组（少于 2 帧时为空）。
 */
export function stepDistances(signatures) {
  const list = Array.isArray(signatures) ? signatures : [];
  const steps = [];
  for (let index = 1; index < list.length; index += 1) {
    steps.push(signatureDistance(list[index - 1], list[index]));
  }
  return steps;
}

/**
 * 取分位数（线性插值）。
 *
 * @param sorted - **已升序**数组。
 * @param ratio - 0–1。
 */
export function quantile(sorted, ratio) {
  if (!Array.isArray(sorted) || sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const position = Math.min(1, Math.max(0, ratio)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/**
 * 从距离序列算出判型要用的全部统计量。
 *
 * @param steps - 相邻距离（`stepDistances` 的产物）。
 * @returns 见下方各字段注释。全部是纯数字，可直接序列化进日志。
 */
export function profileOf(steps) {
  const list = Array.isArray(steps) ? steps.filter((value) => Number.isFinite(value)) : [];
  const count = list.length;
  if (count === 0) {
    return { count: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0, staticRatio: 0, jumpFloor: JUMP_FLOOR, jumpCount: 0, jumpRatio: 0 };
  }
  const sorted = [...list].sort((a, b) => a - b);
  const p50 = quantile(sorted, 0.5);
  const p75 = quantile(sorted, 0.75);
  const p90 = quantile(sorted, 0.9);
  const p99 = quantile(sorted, 0.99);
  const max = sorted[count - 1];
  const mean = list.reduce((sum, value) => sum + value, 0) / count;
  const staticCount = list.filter((value) => value < STATIC_EPS).length;
  // `jumpFloor` 取「**p75** 的若干倍」与「绝对下限」中较大者：
  //   - 用 p75 而不是 p90：跳变占比达到 10% 时 p90 会被跳变本身污染，
  //     门槛被抬到跳变之上，`jumpCount` 归零（实测踩到，见常量处的注释）。
  //   - 保留绝对下限：一条 p75=0.3 的静止视频，若只按倍数算，
  //     会把 1.0 的压缩噪声当成换页。
  const jumpFloor = Math.max(p75 * JUMP_MULTIPLIER, JUMP_FLOOR);
  const jumpCount = list.filter((value) => value >= jumpFloor).length;
  return {
    count,
    p50, p75, p90, p99, max, mean,
    /** 相邻差 < `STATIC_EPS` 的占比 —— 「画面有多少时间其实没动」。 */
    staticRatio: staticCount / count,
    /** 本次算出的跳变门槛（p75×3 与绝对下限取大）。 */
    jumpFloor,
    /** 超过门槛的次数 —— 约等于「换了几页」。 */
    jumpCount,
    /** `jumpCount / count`。 */
    jumpRatio: jumpCount / count,
  };
}

/**
 * 判型。
 *
 * @param profile - `profileOf` 的产物。
 * @returns `{ kind, confidence, reasons }`。
 *          **`reasons` 是必须暴露给用户的**：判型结论会决定「这份视频要不要出讲义」，
 *          只给一个 `kind` 会让用户无从判断「为什么这视频没讲义」。
 */
export function classify(profile) {
  const reasons = [];
  const { count = 0, staticRatio = 0, jumpRatio = 0, jumpCount = 0, p50 = 0, p90 = 0, max = 0 } = profile ?? {};

  if (count < MIN_FRAMES) {
    return {
      kind: KIND.UNKNOWN,
      confidence: 'low',
      reasons: [`样本不足（${count} 对相邻帧 < ${MIN_FRAMES}）：统计量不可信，不下结论`],
    };
  }

  // ① 一帧都没超过「几乎没变」的阈值 —— 静止画面。没有页结构可言。
  if (max < STATIC_EPS) {
    return {
      kind: KIND.STATIC,
      confidence: 'high',
      reasons: [`最大相邻差 ${max.toFixed(2)} < ${STATIC_EPS}：画面全程未变`],
    };
  }

  // ② 双高 —— 页内静止 + 有足够多的翻页。
  if (staticRatio >= SLIDES_STATIC_RATIO && jumpRatio >= SLIDES_JUMP_RATIO) {
    return {
      kind: KIND.SLIDES,
      confidence: staticRatio >= 0.55 && jumpRatio >= 0.05 ? 'high' : 'medium',
      reasons: [
        `静止占比 ${(staticRatio * 100).toFixed(1)}% ≥ ${(SLIDES_STATIC_RATIO * 100).toFixed(0)}%：页内几乎不动`,
        `跳变占比 ${(jumpRatio * 100).toFixed(1)}% ≥ ${(SLIDES_JUMP_RATIO * 100).toFixed(0)}%：翻页次数 ${jumpCount}`,
      ],
    };
  }

  // ③ 双低 —— 一直在小幅变化，且没有成规模的整体跳变。板书 / 实拍 / 口播。
  if (staticRatio < SLIDES_STATIC_RATIO && jumpRatio < SLIDES_JUMP_RATIO) {
    return {
      kind: KIND.CONTINUOUS,
      confidence: staticRatio < 0.2 && jumpRatio < 0.01 ? 'high' : 'medium',
      reasons: [
        `静止占比 ${(staticRatio * 100).toFixed(1)}% < ${(SLIDES_STATIC_RATIO * 100).toFixed(0)}%：画面一直在变`,
        `跳变占比 ${(jumpRatio * 100).toFixed(1)}% < ${(SLIDES_JUMP_RATIO * 100).toFixed(0)}%：只有 ${jumpCount} 次整体跳变`,
        `中位差 ${p50.toFixed(2)} 已达 p90(${p90.toFixed(2)}) 的 ${((p50 / Math.max(p90, 1e-6)) * 100).toFixed(0)}%：变化是连续的，不是阶跃的`,
      ],
    };
  }

  // ④ 落在中间 —— 两个条件互斥但不满足任何一边。**不猜**。
  return {
    kind: KIND.UNKNOWN,
    confidence: 'low',
    reasons: [
      `静止占比 ${(staticRatio * 100).toFixed(1)}%、跳变占比 ${(jumpRatio * 100).toFixed(1)}% 落在边界`,
      '既不像翻页课件，也不像连续变化 —— 需要人工判型或用 OCR 旁证',
    ],
  };
}

/**
 * 一步到位：签名序列 → `{ profile, verdict }`。
 *
 * @param signatures - 签名数组。
 * @returns `{ profile, verdict }`。
 */
export function analyze(signatures) {
  const steps = stepDistances(signatures);
  const profile = profileOf(steps);
  return { profile, verdict: classify(profile) };
}

/**
 * 给调用方的**一句话建议**：这份视频该不该抽帧成页。
 *
 * 单独成一个函数（而不是让调用方自己 `if (kind === SLIDES)`），是因为
 * `UNKNOWN` 也必须落到一个明确动作上 —— **判不出来就不抽**，
 * 而不是「判不出来就照抽」。
 *
 * @param verdict - `classify` 的产物。
 * @returns `{ shouldExtract, reason }`。
 */
export function extractionAdvice(verdict) {
  const kind = verdict?.kind ?? KIND.UNKNOWN;
  if (kind === KIND.SLIDES) {
    return { shouldExtract: true, reason: '翻页式课件：可以抽帧成页' };
  }
  if (kind === KIND.CONTINUOUS) {
    return { shouldExtract: false, reason: '画面连续变化（板书 / 实拍 / 口播）：抽帧成页会产出假页，应只走字幕通道' };
  }
  if (kind === KIND.STATIC) {
    return { shouldExtract: false, reason: '画面全程未变：没有页结构，抽出来只有一张图' };
  }
  return { shouldExtract: false, reason: '判不出类型：按「不抽」处理，宁可只给字幕也不给假页' };
}
