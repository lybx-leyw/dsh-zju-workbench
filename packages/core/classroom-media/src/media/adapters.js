// 源：ref/OpenMAIC/lib/media/adapters/openai-image-adapter.ts:63-105
// 源：ref/OpenMAIC/lib/media/adapters/seedream-adapter.ts:38-135
// 源：ref/OpenMAIC/lib/media/adapters/qwen-image-adapter.ts:31-134
// 源：ref/OpenMAIC/lib/media/adapters/nano-banana-adapter.ts:101-160
// 源：ref/OpenMAIC/lib/media/adapters/minimax-image-adapter.ts:19-97
// 源：ref/OpenMAIC/lib/media/adapters/grok-image-adapter.ts:43-128
// 源：ref/OpenMAIC/lib/media/adapters/glm-image-adapter.ts:25-130
// 源：ref/OpenMAIC/lib/media/adapters/lemonade-image-adapter.ts:26-96
// 源：ref/OpenMAIC/lib/media/adapters/openrouter-image-adapter.ts:32-163
// 源：ref/OpenMAIC/lib/media/adapters/comfyui-image-adapter.ts:110-660（只搬生成链，见下）
// 源：ref/OpenMAIC/lib/media/require-model.ts:11-22、redirect-guard.ts:41-45
//
// # ComfyUI 的差别
//
// 上游的 workflow 来自 Next 的 `public/` 目录（`comfyui-workflows.ts` 扫文件名）。
// 本仓没有 `public/`，也没有那张"允许的 workflow 名单"，所以改成：
//   - 显式 `providerOptions.workflow`（已解析的对象）优先；
//   - 否则 `providerOptions.workflowPath`（绝对路径，运维配置）；
//   - 都没有 → `E_NOT_CONFIGURED`。
// 节点补丁（prompt / width / height / seed）与轮询逻辑逐行照搬。

import { invalidInput, invalidResponse, notConfigured, upstreamError } from '../errors.js';

/** source:require-model.ts:17-22 —— 绝不回落到厂商默认模型。 */
function requireModel(model, label) {
  if (!model) throw invalidInput(`${label} 必须先配置模型`, 'model');
  return model;
}

/** source:redirect-guard.ts:41-45 —— 3xx 带着凭证跳到别的 host 是 SSRF 的入口。 */
function assertNotRedirected(response, providerName) {
  if (response.status >= 300 && response.status < 400) {
    throw upstreamError(providerName, response.status, '不允许重定向');
  }
}

async function readError(response) {
  return response.text().catch(() => response.statusText);
}

function normalizeBase(baseUrl, fallback) {
  return (baseUrl || fallback).replace(/\/$/, '');
}

function resolveSize(options) {
  return `${options.width || 1024}x${options.height || 1024}`;
}

/** source:openai-image-adapter.ts:63-105 */
export async function generateWithOpenAIImage(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'https://api.openai.com/v1');
  const model = requireModel(config.model, 'OpenAI Image');
  const width = options.width || 1024;
  const height = options.height || 1024;

  const response = await ctx.fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model, prompt: options.prompt, n: 1, size: resolveSize(options) }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  assertNotRedirected(response, 'OpenAI Image');
  if (!response.ok) throw upstreamError('OpenAI Image', response.status, await readError(response));

  const data = await response.json();
  const imageData = data.data?.[0];
  if (!imageData?.url && !imageData?.b64_json) throw invalidResponse('OpenAI Image', '图片响应为空');
  return { url: imageData.url, base64: imageData.b64_json, width, height };
}

/** source:seedream-adapter.ts:38-61 —— 裸 host 补 `/api/v3`，带路径的原样用。 */
function resolveArkRoot(baseUrl) {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return /\/api\//.test(trimmed) || /\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v3`;
}

/** source:seedream-adapter.ts:48-61 —— Seedream 要求 ≥3,686,400 像素。 */
function resolveSeedreamSize(options) {
  if (options.width && options.height) {
    const pixels = options.width * options.height;
    if (pixels < 3_686_400) {
      const scale = Math.ceil(Math.sqrt(3_686_400 / pixels));
      return `${options.width * scale}x${options.height * scale}`;
    }
    return `${options.width}x${options.height}`;
  }
  return '2K';
}

/** source:seedream-adapter.ts:92-135 */
export async function generateWithSeedream(ctx, config, options) {
  const url = `${resolveArkRoot(config.baseUrl || 'https://ark.cn-beijing.volces.com')}/images/generations`;
  const response = await ctx.fetch(url, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: requireModel(config.model, 'Seedream'),
      prompt: options.prompt,
      size: resolveSeedreamSize(options),
      watermark: false,
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  assertNotRedirected(response, 'Seedream');
  if (!response.ok) throw upstreamError('Seedream', response.status, await readError(response));

  const data = await response.json();
  const imageData = data.data?.[0];
  if (!imageData) throw invalidResponse('Seedream', '图片响应为空');
  return {
    url: imageData.url,
    base64: imageData.b64_json,
    width: options.width || 1024,
    height: options.height || 1024,
  };
}

/** source:qwen-image-adapter.ts:31-35 —— DashScope 用 `W*H`。 */
function resolveDashScopeSize(options) {
  return `${options.width || 1024}*${options.height || 576}`;
}

/** source:qwen-image-adapter.ts:64-134 */
export async function generateWithQwenImage(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'https://dashscope.aliyuncs.com');
  const response = await ctx.fetch(
    `${baseUrl}/api/v1/services/aigc/multimodal-generation/generation`,
    {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: requireModel(config.model, 'Qwen Image'),
        input: { messages: [{ role: 'user', content: [{ text: options.prompt }] }] },
        parameters: {
          negative_prompt: options.negativePrompt || undefined,
          prompt_extend: true,
          watermark: false,
          size: resolveDashScopeSize(options),
        },
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
  assertNotRedirected(response, 'Qwen Image');
  if (!response.ok) throw upstreamError('Qwen Image', response.status, await readError(response));

  const data = await response.json();
  const choices = data.output?.choices;
  if (!choices || choices.length === 0) {
    if (data.code || data.message) throw upstreamError('Qwen Image', 200, `${data.code} - ${data.message}`);
    throw invalidResponse('Qwen Image', '图片响应为空');
  }
  const imageContent = choices[0]?.message?.content?.find((c) => c.image);
  if (!imageContent?.image) throw invalidResponse('Qwen Image', '响应缺少图片 URL');
  return { url: imageContent.image, width: options.width || 1024, height: options.height || 576 };
}

/** source:nano-banana-adapter.ts:101-160 */
export async function generateWithNanoBanana(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'https://generativelanguage.googleapis.com');
  const model = requireModel(config.model, 'Nano Banana');
  const response = await ctx.fetch(`${baseUrl}/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: options.prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  assertNotRedirected(response, 'Nano Banana');
  if (!response.ok) throw upstreamError('Nano Banana', response.status, await readError(response));

  const data = await response.json();
  if (data.error) throw upstreamError('Nano Banana', 200, `${data.error.code} - ${data.error.message}`);
  const parts = data.candidates?.[0]?.content?.parts;
  if (!parts || parts.length === 0) throw invalidResponse('Nano Banana', '图片响应为空');
  const imagePart = parts.find((p) => p.inlineData);
  if (!imagePart?.inlineData) {
    const textPart = parts.find((p) => p.text);
    throw invalidResponse('Nano Banana', `模型只回了文本：${textPart?.text || 'none'}`);
  }
  return {
    base64: imagePart.inlineData.data,
    width: options.width || 1024,
    height: options.height || 1024,
  };
}

/** source:minimax-image-adapter.ts:19-97 */
export async function generateWithMiniMaxImage(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'https://api.minimaxi.com');
  const aspectRatio = options.aspectRatio || '1:1';
  const response = await ctx.fetch(`${baseUrl}/v1/image_generation`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: requireModel(config.model, 'MiniMax Image'),
      prompt: options.prompt,
      negative_prompt: options.negativePrompt,
      aspect_ratio: aspectRatio,
      response_format: 'url',
      n: 1,
      prompt_optimizer: false,
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  assertNotRedirected(response, 'MiniMax Image');
  if (!response.ok) throw upstreamError('MiniMax Image', response.status, await readError(response));

  const data = await response.json();
  if (data?.base_resp?.status_code !== undefined && data.base_resp.status_code !== 0) {
    throw upstreamError(
      'MiniMax Image',
      200,
      `${data.base_resp.status_code}: ${data.base_resp.status_msg || 'unknown error'}`,
    );
  }
  const imageUrls = data?.data?.image_urls;
  if (!imageUrls || imageUrls.length === 0) throw invalidResponse('MiniMax Image', '没有 image_urls');

  let width = options.width || 1024;
  let height = options.height || 1024;
  if (!options.width && !options.height) {
    const [w, h] = aspectRatio.split(':').map(Number);
    if (w && h) {
      if (w > h) {
        width = 1024;
        height = Math.round((1024 * h) / w);
      } else {
        height = 1024;
        width = Math.round((1024 * w) / h);
      }
    }
  }
  return { url: imageUrls[0], width, height };
}

/** source:grok-image-adapter.ts:35-45 —— b64_json 不带媒体类型，只能看字节签名。 */
const JPEG_BASE64_PREFIX = '/9j/';

function inlineImageMimeType(base64) {
  return base64.startsWith(JPEG_BASE64_PREFIX) ? 'image/jpeg' : 'image/png';
}

/** source:grok-image-adapter.ts:74-128 */
export async function generateWithGrokImage(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'https://api.x.ai/v1');
  const response = await ctx.fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({
      model: requireModel(config.model, 'Grok Image'),
      prompt: options.prompt,
      n: 1,
      // 要内联字节：URL 指向中转/CDN，服务端网络未必可达。
      response_format: 'b64_json',
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  assertNotRedirected(response, 'Grok Image');
  if (!response.ok) throw upstreamError('Grok Image', response.status, await readError(response));

  const data = await response.json();
  const imageData = data.data?.[0];
  if (!imageData) throw invalidResponse('Grok Image', '图片响应为空');
  const inline = imageData.b64_json;
  const mimeType = inline ? inlineImageMimeType(inline) : undefined;
  return {
    url: imageData.url ?? (inline ? `data:${mimeType};base64,${inline}` : undefined),
    base64: inline,
    mimeType,
    width: options.width || 1024,
    height: options.height || 1024,
  };
}

/** source:glm-image-adapter.ts:25-46 —— CogView 只收固定尺寸，按宽高比取最近。 */
export const COGVIEW_SUPPORTED_SIZES = Object.freeze([
  { width: 1024, height: 1024 },
  { width: 768, height: 1344 },
  { width: 864, height: 1152 },
  { width: 1344, height: 768 },
  { width: 1152, height: 864 },
  { width: 1440, height: 720 },
  { width: 720, height: 1440 },
]);

export function resolveCogViewSize(options) {
  const width = options.width || 1024;
  const height = options.height || 1024;
  const target = width / height;
  let best = COGVIEW_SUPPORTED_SIZES[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const size of COGVIEW_SUPPORTED_SIZES) {
    const delta = Math.abs(size.width / size.height - target);
    if (delta < bestDelta) {
      best = size;
      bestDelta = delta;
    }
  }
  return `${best.width}x${best.height}`;
}

/** source:glm-image-adapter.ts:89-130 */
export async function generateWithGlmImage(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
  const size = resolveCogViewSize(options);
  const [width, height] = size.split('x').map(Number);

  const response = await ctx.fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: requireModel(config.model, 'GLM Image'), prompt: options.prompt, n: 1, size }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  assertNotRedirected(response, 'GLM Image');
  if (!response.ok) throw upstreamError('GLM Image', response.status, await readError(response));

  const data = await response.json();
  const imageData = data.data?.[0];
  if (!imageData?.url && !imageData?.b64_json) throw invalidResponse('GLM Image', '图片响应为空');
  const inline = imageData.b64_json;
  const mimeType = inline ? (inline.startsWith(JPEG_BASE64_PREFIX) ? 'image/jpeg' : 'image/png') : undefined;
  return {
    url: imageData.url ?? (inline ? `data:${mimeType};base64,${inline}` : undefined),
    base64: inline,
    mimeType,
    width,
    height,
  };
}

/** source:lemonade-image-adapter.ts:26-96 */
export async function generateWithLemonadeImage(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'http://localhost:13305/v1');
  const width = options.width || 1024;
  const height = options.height || 1024;
  const key = config.apiKey?.trim();
  const response = await ctx.fetch(`${baseUrl}/images/generations`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({
      model: requireModel(config.model, 'Lemonade Image'),
      prompt: options.prompt,
      n: 1,
      size: resolveSize(options),
      response_format: 'b64_json',
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  assertNotRedirected(response, 'Lemonade Image');
  if (!response.ok) throw upstreamError('Lemonade Image', response.status, await readError(response));

  const data = await response.json();
  const imageData = data.data?.[0];
  if (!imageData?.url && !imageData?.b64_json) throw invalidResponse('Lemonade Image', '图片响应为空');
  return { url: imageData.url, base64: imageData.b64_json, width, height };
}

/** source:openrouter-image-adapter.ts:32-53 */
export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

export function openRouterBaseUrl(baseUrl) {
  const raw = baseUrl?.trim() || OPENROUTER_DEFAULT_BASE_URL;
  return raw.replace(/\/+$/, '').replace(/\/(images|videos)$/, '');
}

function getDimensions(aspectRatio) {
  switch (aspectRatio) {
    case '9:16':
      return { width: 720, height: 1280 };
    case '1:1':
      return { width: 1024, height: 1024 };
    case '4:3':
      return { width: 1024, height: 768 };
    default:
      return { width: 1280, height: 720 };
  }
}

/** source:openrouter-image-adapter.ts:126-163 */
export async function generateWithOpenRouterImage(ctx, config, options) {
  const baseUrl = openRouterBaseUrl(config.baseUrl);
  const body = { model: requireModel(config.model, 'OpenRouter Image'), prompt: options.prompt, n: 1 };
  if (options.aspectRatio) body.aspect_ratio = options.aspectRatio;

  const response = await ctx.fetch(`${baseUrl}/images`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify(body),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw upstreamError('OpenRouter Image', response.status, await readError(response));

  const data = await response.json();
  if (data.error) {
    throw upstreamError('OpenRouter Image', 200, `${data.error.code ?? ''} ${data.error.message ?? ''}`.trim());
  }
  const first = data.data?.[0];
  if (!first?.b64_json) throw invalidResponse('OpenRouter Image', '没有图片数据');

  const { width, height } = getDimensions(options.aspectRatio);
  const mediaType = first.media_type || 'image/png';
  return {
    url: `data:${mediaType};base64,${first.b64_json}`,
    base64: first.b64_json,
    width: options.width || width,
    height: options.height || height,
  };
}

// ── ComfyUI ────────────────────────────────────────────────────────────────
// source:comfyui-image-adapter.ts:110-660（loadWorkflow 由配置提供，见文件头）

const COMFYUI_POLL_INTERVAL_MS = 1500;
const COMFYUI_GENERATION_TIMEOUT_MS = 300_000;
const COMFYUI_FETCH_TIMEOUT_MS = 30_000;

const PROMPT_NODE_TITLE = 'String (Multiline - Prompt)';
const LATENT_NODE_TITLE = 'Empty Flux 2 Latent';
const SAMPLER_NODE_TITLE = 'KSampler';

/** source:comfyui-image-adapter.ts:110-135 */
async function loadWorkflow(config) {
  const options = config.providerOptions || {};
  if (options.workflow && typeof options.workflow === 'object') return options.workflow;
  if (typeof options.workflowPath === 'string' && options.workflowPath.trim()) {
    const { readFile } = await import('node:fs/promises');
    try {
      return JSON.parse(await readFile(options.workflowPath, 'utf8'));
    } catch (error) {
      throw invalidInput(`读取 ComfyUI workflow 失败：${error?.message ?? error}`, 'workflowPath');
    }
  }
  throw notConfigured('图片生成', 'comfyui-image', 'ComfyUI 需要 providerOptions.workflow 或 workflowPath');
}

/** source:comfyui-image-adapter.ts:273-302 */
function nodeInputs(node) {
  return node && typeof node === 'object' ? node.inputs : undefined;
}

function findNodeIdByTitle(workflow, title) {
  for (const [id, node] of Object.entries(workflow || {})) {
    if (node?._meta?.title === title) return id;
  }
  return undefined;
}

/** source:comfyui-image-adapter.ts:304-437 —— 只补三个节点的输入。 */
function patchWorkflow(workflow, options) {
  const patched = JSON.parse(JSON.stringify(workflow));
  const promptId = findNodeIdByTitle(patched, PROMPT_NODE_TITLE);
  const promptInputs = promptId ? nodeInputs(patched[promptId]) : undefined;
  if (promptInputs) promptInputs.value = options.prompt;

  const latentId = findNodeIdByTitle(patched, LATENT_NODE_TITLE);
  const latentInputs = latentId ? nodeInputs(patched[latentId]) : undefined;
  if (latentInputs) {
    if (options.width) latentInputs.width = options.width;
    if (options.height) latentInputs.height = options.height;
  }

  const samplerId = findNodeIdByTitle(patched, SAMPLER_NODE_TITLE);
  const samplerInputs = samplerId ? nodeInputs(patched[samplerId]) : undefined;
  if (samplerInputs) samplerInputs.seed = Math.floor(Math.random() * 2 ** 32);

  if (!promptInputs) {
    throw invalidResponse('ComfyUI', `workflow 缺少「${PROMPT_NODE_TITLE}」节点，无法写入提示词`);
  }
  return patched;
}

/** source:comfyui-image-adapter.ts:439-453 */
function extractExecutionError(entry) {
  const messages = entry?.status?.messages;
  if (!Array.isArray(messages)) return undefined;
  for (const [type, payload] of messages) {
    if (type === 'execution_error') {
      return payload?.exception_message || payload?.message || 'ComfyUI 执行失败';
    }
  }
  return undefined;
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // 不 unref：同上，轮询期间没有别的句柄撑着事件循环。
  });
}

/** source:comfyui-image-adapter.ts:585-660 */
export async function generateWithComfyuiImage(ctx, config, options) {
  const baseUrl = normalizeBase(config.baseUrl, 'http://localhost:8188');
  const workflow = patchWorkflow(await loadWorkflow(config), options);
  const clientId = `zhiyun-${Math.random().toString(36).slice(2)}`;

  const queue = await ctx.fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
    signal: AbortSignal.timeout(COMFYUI_FETCH_TIMEOUT_MS),
  });
  if (!queue.ok) throw upstreamError('ComfyUI', queue.status, await readError(queue));
  const { prompt_id: promptId } = await queue.json();
  if (!promptId) throw invalidResponse('ComfyUI', '/prompt 没有返回 prompt_id');

  const deadline = Date.now() + COMFYUI_GENERATION_TIMEOUT_MS;
  let imageRef = null;
  while (Date.now() < deadline) {
    await sleep(COMFYUI_POLL_INTERVAL_MS);
    if (options.signal?.aborted) throw options.signal.reason;

    const historyRes = await ctx.fetch(`${baseUrl}/history/${promptId}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(COMFYUI_FETCH_TIMEOUT_MS),
    });
    if (!historyRes.ok) throw upstreamError('ComfyUI', historyRes.status, await readError(historyRes));
    const history = await historyRes.json();
    const entry = history?.[promptId];
    if (!entry) continue;

    const executionError = extractExecutionError(entry);
    if (executionError) throw invalidResponse('ComfyUI', executionError);

    for (const output of Object.values(entry.outputs || {})) {
      const images = output?.images;
      if (Array.isArray(images) && images.length > 0) {
        imageRef = images[0];
        break;
      }
    }
    if (imageRef) break;
  }
  if (!imageRef) throw invalidResponse('ComfyUI', `生成超时（${COMFYUI_GENERATION_TIMEOUT_MS / 1000}s）`);

  const params = new URLSearchParams({
    filename: imageRef.filename,
    subfolder: imageRef.subfolder || '',
    type: imageRef.type || 'output',
  });
  const imageRes = await ctx.fetch(`${baseUrl}/view?${params.toString()}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(COMFYUI_FETCH_TIMEOUT_MS),
  });
  if (!imageRes.ok) throw upstreamError('ComfyUI', imageRes.status, await readError(imageRes));

  const bytes = Buffer.from(await imageRes.arrayBuffer());
  const mimeType = imageRes.headers.get('content-type') || 'image/png';
  return {
    base64: bytes.toString('base64'),
    url: `data:${mimeType};base64,${bytes.toString('base64')}`,
    mimeType,
    width: options.width || 1024,
    height: options.height || 1024,
  };
}
