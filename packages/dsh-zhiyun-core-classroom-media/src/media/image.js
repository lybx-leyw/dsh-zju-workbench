// 源：ref/OpenMAIC/lib/media/image-providers.ts:39-268（IMAGE_PROVIDERS 注册表 +
//     testImageConnectivity / generateImage / aspectRatioToDimensions / applyMinPixelFloor）
//
// 注册表在 `../providers.js`（那里统一了"密钥从宿主拿"这一层）；本文件只做**路由**，
// 保证 10 个 provider 分支一个不少：seedream / openai-image / qwen-image / nano-banana /
// minimax-image / grok-image / glm-image / comfyui-image / lemonade / openrouter-image。

import { invalidInput, notConfigured, unsupportedProvider } from '../errors.js';
import { IMAGE_PROVIDERS } from '../providers.js';
import {
  generateWithComfyuiImage,
  generateWithGlmImage,
  generateWithGrokImage,
  generateWithLemonadeImage,
  generateWithMiniMaxImage,
  generateWithNanoBanana,
  generateWithOpenAIImage,
  generateWithOpenRouterImage,
  generateWithQwenImage,
  generateWithSeedream,
} from './adapters.js';

/** source:image-providers.ts:240-247 */
export function aspectRatioToDimensions(ratio, maxWidth = 1024) {
  const [w, h] = String(ratio || '').split(':').map(Number);
  if (!w || !h) return { width: maxWidth, height: Math.round((maxWidth * 9) / 16) };
  return { width: maxWidth, height: Math.round((maxWidth * h) / w) };
}

/** source:image-providers.ts:254-268 */
export function applyMinPixelFloor(width, height, minPixels) {
  if (!(minPixels > 0) || width <= 0 || height <= 0) return { width, height };
  const area = width * height;
  if (area >= minPixels) return { width, height };
  const scale = Math.sqrt(minPixels / area);
  return {
    width: Math.ceil((width * scale) / 8) * 8,
    height: Math.ceil((height * scale) / 8) * 8,
  };
}

const ROUTES = {
  seedream: generateWithSeedream,
  'openai-image': generateWithOpenAIImage,
  'qwen-image': generateWithQwenImage,
  'nano-banana': generateWithNanoBanana,
  'minimax-image': generateWithMiniMaxImage,
  'grok-image': generateWithGrokImage,
  'glm-image': generateWithGlmImage,
  'comfyui-image': generateWithComfyuiImage,
  lemonade: generateWithLemonadeImage,
  'openrouter-image': generateWithOpenRouterImage,
};

/**
 * 生成一张图。source:image-providers.ts:210-238 的路由 + 各 adapter。
 *
 * @param {{fetch: Function}} ctx
 * @param {object} config `{ providerId, apiKey, baseUrl, model, providerOptions }`
 * @param {{prompt: string, width?: number, height?: number, aspectRatio?: string,
 *          negativePrompt?: string, signal?: AbortSignal}} options
 * @returns {Promise<{url?: string, base64?: string, mimeType?: string, width: number, height: number}>}
 */
export async function generateImage(ctx, config, options) {
  if (!options?.prompt || !String(options.prompt).trim()) {
    throw invalidInput('image(prompt) 需要非空提示词', 'prompt');
  }
  const meta = IMAGE_PROVIDERS[config.providerId];
  const route = ROUTES[config.providerId];
  if (!meta || !route) throw unsupportedProvider('图片生成', config.providerId, Object.keys(ROUTES));
  if (meta.requiresApiKey && !config.apiKey) throw notConfigured('图片生成', config.providerId);

  // 宽高比 → 像素：上游由调用方（媒体编排）算好再传，这里给个兜底，
  // 免得 `image('一只猫')` 这种最朴素的调用因为缺尺寸被 provider 拒。
  const options_ = { ...options };
  if (!options_.width && !options_.height && options_.aspectRatio) {
    const dims = aspectRatioToDimensions(options_.aspectRatio, 1024);
    options_.width = dims.width;
    options_.height = dims.height;
  }

  return route(ctx, config, options_);
}
