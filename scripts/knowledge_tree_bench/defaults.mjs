/**
 * 供应商的**默认配置**（单一来源）。
 *
 * # 为什么要集中在这里
 *
 * "接口地址 / 模型名"这些默认值有三个地方要用：
 *   · 页面上预填（用户只填 Key 就能跑）；
 *   · `run.mjs` 兜底（用户清空了某个框，或直接用 CLI 传参）；
 *   · 测试断言。
 *
 * 三处各写一份的结局是"页面显示 deepseek-flash、实际请求发了别的模型"——
 * 那种不一致极难查。所以只在这里定义，其余地方 import。
 *
 * # 为什么只给 DeepSeek 默认值
 *
 * 默认值是**与供应商绑定的**：`https://api.deepseek.com` 只对 DeepSeek 有意义，
 * `deepseek-flash` 这个名字别家也没有。所以：
 *   · 用户不改接口 → 用 DeepSeek 的全套默认，只填 Key 就能跑；
 *   · 用户改成别家的接口 → 我们不猜它的模型名（猜错比空着更糟），
 *     而是明确要求他填。
 *
 * 这条边界很重要：给非 DeepSeek 也塞一个 `deepseek-flash`，请求会以
 * "模型不存在"失败，而用户看到的是他填的接口 + 我们塞的模型名，很难想到是谁的错。
 */

/** DeepSeek 官方接口的默认值。 */
export const DEEPSEEK = Object.freeze({
  /** 官方文档给的 OpenAI 兼容 BASE URL（`run.mjs` 会在后面接 `/chat/completions`）。 */
  baseUrl: 'https://api.deepseek.com',
  /**
   * 当前主力模型。它**支持图片输入**（官方文档：Vision ✓），
   * 所以视觉模型留空时回落到它就是对的。
   */
  model: 'deepseek-flash',
  /** 留空 = 与对话模型相同。 */
  visionModel: '',
});

/** 默认供应商（决定"接口地址为空时用谁"）。 */
export const DEFAULT_PROVIDER = 'deepseek';

/** 这个接口地址是不是 DeepSeek。用于判断"能不能套 DeepSeek 的模型默认值"。 */
export function isDeepSeek(baseUrl) {
  return /(^|\/\/|\.)deepseek\.com(\/|:|$)/i.test(String(baseUrl ?? '').trim());
}

/**
 * 把用户填的（可能残缺的）配置补成**可用**的。
 *
 * 规则：
 *   · `baseUrl` 为空 → 用 DeepSeek 的；
 *   · `model` 为空 → **仅当接口是 DeepSeek** 才用 `deepseek-flash`，
 *     否则留空（由调用方报"请填模型名"，而不是塞一个注定失败的默认值）；
 *   · `visionModel` 为空 → 与 `model` 相同（DeepSeek 的 flash 支持图片）。
 *
 * @param {object} raw 用户原样填的东西。
 * @returns {object} 补全后的配置；`model` 可能仍是空串（表示"必须由用户填"）。
 */
export function resolveConfig(raw = {}) {
  const baseUrl = String(raw.baseUrl ?? '').trim() || DEEPSEEK.baseUrl;
  const deepseek = isDeepSeek(baseUrl);

  const model = String(raw.model ?? '').trim() || (deepseek ? DEEPSEEK.model : '');
  const visionModel = String(raw.visionModel ?? '').trim() || model;

  return {
    ...raw,
    baseUrl,
    model,
    visionModel,
    /** 哪些字段是**我们填的**（用户没填）。界面据此标注"默认"。 */
    defaulted: {
      baseUrl: !String(raw.baseUrl ?? '').trim(),
      model: !String(raw.model ?? '').trim() && deepseek,
      visionModel: !String(raw.visionModel ?? '').trim(),
    },
  };
}

/** 给页面预填用的一份（全是默认值，等价于"用户什么都没填"）。 */
export function prefill() {
  return resolveConfig({});
}
