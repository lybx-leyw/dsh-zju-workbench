// 源：ref/OpenMAIC/lib/audio/tts-providers.ts:301-1490（generateTTS 与 11 个 provider 实现）
// 源：ref/OpenMAIC/lib/audio/json-stream.ts:11-43（splitConcatenatedJsonObjects）
// 源：ref/OpenMAIC/lib/audio/pcm-wav.ts:6-33（Gemini 的 raw PCM 封 WAV）
// 源：ref/OpenMAIC/lib/audio/voxcpm.ts:1-60（三种后端协议与模型别名）
// 源：ref/OpenMAIC/lib/audio/tts-utils.ts:134-229（超长文本切分）
//
// # provider 分支全部保留
//
// openai / azure / glm / qwen / voxcpm(3 后端) / minimax / doubao(两种鉴权) /
// elevenlabs / google / lemonade / browser-native(客户端专用) / custom-tts-*。
//
// # 与上游的差别（都写在对应分支旁）
//
// 1. `audioProviderFetch`（重定向 + DNS 钉扎）换成本包注入的 `fetchImpl`：
//    SSRF/出口策略是宿主的活（本仓 `source-netproxy` 已在做），这里只要求
//    `redirect: 'manual'`，3xx 一律当失败 —— 同上游 `provider-fetch` 的结论。
// 2. `appAttributionHeaders` / `ProviderQuotaExhaustedError` 未搬：前者是 OpenMAIC
//    的产品署名，本仓不该带上；后者在本包里用 `MediaError('E_QUOTA_EXHAUSTED')` 表达。
// 3. 音色克隆（qwen-voice-clone.ts / voxcpm-voices.ts）未搬：clone 音色按普通音色 ID
//    走同一个合成端点，见 `generateQwenTTS` 的注释。

import { MediaError, invalidInput, invalidResponse, notConfigured, unsupportedProvider, upstreamError } from '../errors.js';
import { TTS_PROVIDERS } from '../providers.js';
import { pcmS16leMonoToWav } from './wav.js';

const DEFAULT_TTS_REQUEST_TIMEOUT_MS = 30_000;

const VOXCPM_VLLM_MODEL_ID = 'voxcpm2';
const VOXCPM_AUTO_VOICE_ID = 'voxcpm:auto';

/** source:tts-providers.ts:220-224 —— 请求超时（毫秒），env 只影响"多久算超时"。 */
function ttsRequestTimeoutMs() {
  const raw = process.env.TTS_REQUEST_TIMEOUT_MS?.trim();
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTS_REQUEST_TIMEOUT_MS;
}

/** source:tts-providers.ts:242-245 */
function ttsRequestSignal(callerSignal) {
  const timeout = AbortSignal.timeout(ttsRequestTimeoutMs());
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
}

/** source:tts-providers.ts:254-269 */
function parseRetryAfterMs(header, now = Date.now()) {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Math.max(0, Number(trimmed) * 1000);
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - now);
}

/** source:tts-providers.ts:277-291 */
function throwIfTtsRateLimited(provider, status, retryAfterHeader, extra) {
  if (status !== 429) return;
  throw new MediaError('E_RATE_LIMITED', `${provider} TTS 触发限流（HTTP 429）`, {
    provider,
    status,
    retryable: true,
    retryAfterMs: parseRetryAfterMs(retryAfterHeader),
    ...extra,
  });
}

/** source:tts-providers.ts:530-544 —— 跳过 BOM 与空白找首个有效字节。 */
function findFirstNonWhitespaceByte(bytes) {
  let i = 0;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) i = 3;
  for (; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) return b;
  }
  return null;
}

/** source:tts-providers.ts:635-645 */
function getAudioResponseFormat(contentType, fallbackFormat = 'mp3') {
  const lower = (contentType || '').toLowerCase();
  if (lower.includes('audio/wav') || lower.includes('audio/x-wav')) return 'wav';
  if (lower.includes('audio/mpeg') || lower.includes('audio/mp3')) return 'mp3';
  if (lower.includes('audio/flac')) return 'flac';
  if (lower.includes('audio/ogg')) return 'ogg';
  if (lower.includes('audio/webm')) return 'webm';
  if (lower.includes('audio/aac')) return 'aac';
  if (lower.includes('audio/opus')) return 'opus';
  return fallbackFormat;
}

/**
 * source:tts-providers.ts:557-633 —— 200 但不是音频一律拒。
 *
 * `Content-Type: audio/*` 时**跳过**首字节嗅探：裸 PCM / μ-law / A-law 没有魔数，
 * 且有约 1.2% 的合法音频块的第一个字节就是 '<' '{' '['（上游 #1395）。
 */
async function validateTTSAudioResponse(response, provider, fallbackFormat = 'mp3') {
  const contentType = response.headers.get('content-type') || '';
  const lowerContentType = contentType.toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.byteLength === 0) {
    throw invalidResponse(provider, 'TTS 返回了空音频（0 字节）');
  }
  if (lowerContentType.startsWith('audio/')) {
    return { audio: bytes, format: getAudioResponseFormat(contentType, fallbackFormat) };
  }

  const firstByte = findFirstNonWhitespaceByte(bytes);
  if (firstByte === null) throw invalidResponse(provider, 'TTS 返回了全空白响应');

  const snippet = () => bytes.toString('utf8').slice(0, 300);
  if (lowerContentType.includes('text/html') || lowerContentType.includes('application/xhtml+xml') || firstByte === 0x3c) {
    throw invalidResponse(provider, `TTS 返回 HTML 而不是音频（检查 baseURL）：${snippet()}`);
  }
  if (lowerContentType.includes('application/json') || firstByte === 0x7b || firstByte === 0x5b) {
    throw invalidResponse(provider, `TTS 返回 JSON 而不是音频：${snippet()}`);
  }
  if (lowerContentType.includes('text/plain')) {
    throw invalidResponse(provider, `TTS 返回 text/plain 而不是音频：${snippet()}`);
  }
  return { audio: bytes, format: getAudioResponseFormat(contentType, fallbackFormat) };
}

/** source:tts-providers.ts:834-849 */
async function readTTSApiError(response) {
  const text = await response.text().catch(() => response.statusText);
  if (!text) return response.statusText;
  try {
    const json = JSON.parse(text);
    if (typeof json.detail === 'string') return json.detail;
    if (typeof json.error === 'string') return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    /* 非 JSON 错误体原样返回 */
  }
  return text;
}

/** source:tts-providers.ts:1483-1490 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** source:json-stream.ts:11-43 —— 字符串感知的花括号计数。 */
export function splitConcatenatedJsonObjects(text) {
  const objects = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      if (depth === 0) start = i;
      depth += 1;
    } else if (char === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

/** source:tts-utils.ts:134-198 —— 句读优先、逗号次之、最后硬切。 */
export function splitLongSpeechText(text, maxLength) {
  const normalized = String(text ?? '').trim();
  if (!normalized || normalized.length <= maxLength) return [normalized];

  const units = normalized
    .split(/(?<=[。！？!?；;：:\n])/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';
  const pushChunk = (value) => {
    const trimmed = value.trim();
    if (trimmed) chunks.push(trimmed);
  };
  const appendUnit = (unit) => {
    if (!current) {
      current = unit;
      return;
    }
    if ((current + unit).length <= maxLength) {
      current += unit;
      return;
    }
    pushChunk(current);
    current = unit;
  };
  const hardSplitUnit = (unit) => {
    const parts = unit.split(/(?<=[，,、])/u).filter(Boolean);
    if (parts.length > 1) {
      for (const part of parts) {
        if (part.length <= maxLength) appendUnit(part);
        else hardSplitUnit(part);
      }
      return;
    }
    let start = 0;
    while (start < unit.length) {
      appendUnit(unit.slice(start, start + maxLength));
      start += maxLength;
    }
  };

  for (const unit of units.length > 0 ? units : [normalized]) {
    if (unit.length <= maxLength) appendUnit(unit);
    else hardSplitUnit(unit);
  }
  pushChunk(current);
  return chunks;
}

/** source:tts-utils.ts:134-137 —— 少数 provider 有硬文本上限。 */
export const TTS_MAX_TEXT_LENGTH = Object.freeze({ 'glm-tts': 1024 });

// ── provider 实现 ───────────────────────────────────────────────────────────

/** source:tts-providers.ts:371-413（+ 348-351 的 custom-tts-* 复用） */
async function generateOpenAITTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['openai-tts'].defaultBaseUrl).replace(/\/$/, '');
  const response = await ctx.fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini-tts',
      input: text,
      voice: config.voice,
      speed: config.speed || 1.0,
      // 明确要 mp3：OpenAI 默认是 mp3，但兼容端点（如 OpenRouter）默认是裸 pcm，
      // 会被下面的 validate 当成 mp3 存下来，客户端报 "no supported source"。
      response_format: 'mp3',
    }),
    signal,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throwIfTtsRateLimited('OpenAI', response.status, response.headers?.get('retry-after'));
    throw upstreamError('OpenAI TTS', response.status, error?.error?.message || response.statusText);
  }
  return validateTTSAudioResponse(response, 'OpenAI');
}

/** source:tts-providers.ts:418-452 */
async function generateLemonadeTTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['lemonade-tts'].defaultBaseUrl || '').replace(/\/$/, '');
  const response = await ctx.fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getBackendAuthHeaders(config.apiKey),
    },
    body: JSON.stringify({
      model: config.model || TTS_PROVIDERS['lemonade-tts'].defaultModelId,
      input: text,
      voice: config.voice || 'af_heart',
      speed: config.speed || 1.0,
      response_format: config.format || 'wav',
    }),
    signal,
  });

  if (!response.ok) {
    throwIfTtsRateLimited('Lemonade', response.status, response.headers?.get('retry-after'));
    throw upstreamError('Lemonade TTS', response.status, await readTTSApiError(response));
  }
  return validateTTSAudioResponse(response, 'Lemonade', config.format || 'wav');
}

/** source:tts-providers.ts:671-673 */
function getBackendAuthHeaders(apiKey) {
  return apiKey?.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {};
}

/** source:tts-providers.ts:647-657 */
function getVoxCPMAudioFormat(mimeType, fileName) {
  const lowerName = fileName?.toLowerCase() || '';
  if (mimeType?.includes('wav') || lowerName.endsWith('.wav')) return 'wav';
  if (mimeType?.includes('mpeg') || mimeType?.includes('mp3') || lowerName.endsWith('.mp3')) return 'mp3';
  if (mimeType?.includes('flac') || lowerName.endsWith('.flac')) return 'flac';
  if (mimeType?.includes('ogg') || lowerName.endsWith('.ogg')) return 'ogg';
  if (mimeType?.includes('webm') || lowerName.endsWith('.webm')) return 'webm';
  return 'wav';
}

/** source:tts-providers.ts:726-740 */
function getVoxCPMDataAudioUrl(base64, mimeType, fileName) {
  const format = getVoxCPMAudioFormat(mimeType, fileName);
  const mediaType =
    mimeType?.trim()
    || (format === 'mp3'
      ? 'audio/mpeg'
      : format === 'flac'
        ? 'audio/flac'
        : format === 'ogg'
          ? 'audio/ogg'
          : format === 'webm'
            ? 'audio/webm'
            : 'audio/wav');
  return `data:${mediaType};base64,${base64}`;
}

/** source:tts-providers.ts:742-749 */
function base64ToBlob(base64, mimeType) {
  return new Blob([Buffer.from(base64, 'base64')], { type: mimeType || 'audio/wav' });
}

/** source:tts-providers.ts:521-528 */
function buildVoxCPMTargetText(text, voicePrompt) {
  const prompt = voicePrompt
    ?.replace(/[\p{C}]+/gu, ' ')
    .replace(/[()（）]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  return prompt ? `(${prompt})${text}` : text;
}

/** source:tts-providers.ts:659-669 */
function getVLLMOmniSpeechUrl(baseUrl) {
  return baseUrl.endsWith('/v1') ? `${baseUrl}/audio/speech` : `${baseUrl}/v1/audio/speech`;
}

function getVLLMOmniModelId(config) {
  const modelId = config.model;
  if (!modelId || modelId === 'VoxCPM2') return VOXCPM_VLLM_MODEL_ID;
  return modelId;
}

/** source:tts-providers.ts:675-724 */
async function postVoxCPMVLLMOmni(ctx, baseUrl, params, config, signal) {
  const payload = {
    model: getVLLMOmniModelId(config),
    input: params.targetText,
    voice: 'default',
    response_format: 'wav',
    stream: false,
  };
  if (params.registeredVoiceId) {
    // 已注册音色用 id 带上音色（预编码 latent）：直接引用，发原文。
    payload.voice = params.registeredVoiceId;
    payload.input = params.rawText ?? params.targetText;
  } else if (params.referenceAudioBase64) {
    const referenceAudio = getVoxCPMDataAudioUrl(
      params.referenceAudioBase64,
      params.referenceAudioMimeType,
      params.referenceAudioName,
    );
    payload.ref_audio = referenceAudio;
    if (params.promptText?.trim()) {
      payload.prompt_audio = referenceAudio;
      payload.prompt_text = params.promptText.trim();
    }
  }
  return ctx.fetch(getVLLMOmniSpeechUrl(baseUrl), {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getBackendAuthHeaders(config.apiKey),
    },
    body: JSON.stringify(payload),
    signal,
  });
}

/** source:tts-providers.ts:751-791 */
async function postVoxCPMPythonAPI(ctx, baseUrl, params, apiKey, signal) {
  const formData = new FormData();
  formData.set('text', params.targetText);
  formData.set('cfg_value', String(params.cfgValue));
  formData.set('inference_timesteps', String(params.inferenceTimesteps));
  formData.set('normalize', String(params.normalize));
  formData.set('denoise', String(params.denoise));
  if (params.referenceAudioBase64) {
    const audioBlob = base64ToBlob(params.referenceAudioBase64, params.referenceAudioMimeType);
    const audioName = params.referenceAudioName || 'reference.wav';
    formData.set('reference_audio', audioBlob, audioName);
    if (params.promptText?.trim()) {
      formData.set('prompt_audio', audioBlob, audioName);
      formData.set('prompt_text', params.promptText.trim());
    }
  }
  return ctx.fetch(`${baseUrl}/tts/upload`, {
    method: 'POST',
    redirect: 'manual',
    headers: getBackendAuthHeaders(apiKey),
    body: formData,
    signal,
  });
}

/** source:tts-providers.ts:793-832 */
async function postVoxCPMNanoVLLM(ctx, baseUrl, params, apiKey, signal) {
  const payload = { target_text: params.targetText, cfg_value: params.cfgValue };
  if (params.referenceAudioBase64) {
    const format = getVoxCPMAudioFormat(params.referenceAudioMimeType, params.referenceAudioName);
    payload.ref_audio_wav_base64 = params.referenceAudioBase64;
    payload.ref_audio_wav_format = format;
    if (params.promptText?.trim()) {
      payload.prompt_wav_base64 = params.referenceAudioBase64;
      payload.prompt_wav_format = format;
      payload.prompt_text = params.promptText.trim();
    }
  }
  return ctx.fetch(`${baseUrl}/generate`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getBackendAuthHeaders(apiKey),
    },
    body: JSON.stringify(payload),
    signal,
  });
}

/** source:voxcpm.ts:44-48（DEFAULT_VOXCPM_BACKEND='vllm-omni'） */
function normalizeVoxCPMBackend(backend) {
  return backend === 'nano-vllm' || backend === 'python-api' ? backend : 'vllm-omni';
}

/** source:tts-providers.ts:454-519 */
async function generateVoxCPMTTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['voxcpm-tts'].defaultBaseUrl || '').replace(/\/$/, '');
  if (!baseUrl) throw notConfigured('TTS', 'voxcpm-tts', '自建 VoxCPM 必须给 baseURL');

  const options = config.providerOptions || {};
  const backend = normalizeVoxCPMBackend(options.backend);
  const voicePrompt =
    options.voicePrompt
    || (config.voice && config.voice !== 'default' && config.voice !== VOXCPM_AUTO_VOICE_ID
      ? config.voice
      : undefined);
  const registeredVoiceId = options.registeredVoiceId?.trim() || undefined;
  if (config.voice === VOXCPM_AUTO_VOICE_ID && !voicePrompt && !registeredVoiceId) {
    throw invalidInput('VoxCPM 的自动音色需要 agent 上下文（voicePrompt 或 registeredVoiceId）', 'voice');
  }

  const usePromptContinuation = Boolean(options.promptText?.trim() && options.referenceAudioBase64);
  const request = {
    targetText: usePromptContinuation ? text : buildVoxCPMTargetText(text, voicePrompt),
    rawText: text,
    registeredVoiceId,
    voicePrompt,
    promptText: options.promptText,
    cfgValue: options.cfgValue ?? 2.0,
    inferenceTimesteps: options.inferenceTimesteps ?? 10,
    normalize: options.normalize ?? false,
    denoise: options.denoise ?? false,
    referenceAudioBase64: options.referenceAudioBase64,
    referenceAudioMimeType: options.referenceAudioMimeType,
    referenceAudioName: options.referenceAudioName,
  };

  const response =
    backend === 'nano-vllm'
      ? await postVoxCPMNanoVLLM(ctx, baseUrl, request, config.apiKey, signal)
      : backend === 'python-api'
        ? await postVoxCPMPythonAPI(ctx, baseUrl, request, config.apiKey, signal)
        : await postVoxCPMVLLMOmni(ctx, baseUrl, request, config, signal);

  if (!response.ok) {
    throwIfTtsRateLimited('VoxCPM', response.status, response.headers?.get('retry-after'));
    throw upstreamError('VoxCPM TTS', response.status, await readTTSApiError(response));
  }
  return validateTTSAudioResponse(response, 'VoxCPM', 'wav');
}

/** source:tts-providers.ts:854-889 */
async function generateAzureTTS(ctx, config, text, signal) {
  const baseUrl = config.baseUrl || TTS_PROVIDERS['azure-tts'].defaultBaseUrl;
  const voiceLocale = resolveAzureVoiceLocale(config.voice);
  const rate = config.speed ? `${((config.speed - 1) * 100).toFixed(0)}%` : '0%';
  const ssml = `
    <speak version='1.0' xml:lang='${voiceLocale}'>
      <voice xml:lang='${voiceLocale}' name='${config.voice}'>
        <prosody rate='${rate}'>${escapeXml(text)}</prosody>
      </voice>
    </speak>
  `.trim();

  const response = await ctx.fetch(`${baseUrl}/cognitiveservices/v1`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Ocp-Apim-Subscription-Key': config.apiKey,
      'Content-Type': 'application/ssml+xml; charset=utf-8',
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3',
    },
    body: ssml,
    signal,
  });

  if (!response.ok) {
    throwIfTtsRateLimited('Azure', response.status, response.headers?.get('retry-after'));
    throw upstreamError('Azure TTS', response.status, response.statusText);
  }
  return validateTTSAudioResponse(response, 'Azure', 'mp3');
}

/** source:tts-providers.ts:891-905 —— Azure 音色 id 自带 BCP-47 前缀。 */
function resolveAzureVoiceLocale(voice) {
  return (
    voice?.match(
      /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?-(?:[A-Z]{2}|\d{3})(?:-(?:[a-z0-9]{5,8}|\d[a-z0-9]{3}))*(?=-[A-Z]|$)/,
    )?.[0] ?? 'zh-CN'
  );
}

/** source:tts-providers.ts:910-950 */
async function generateGLMTTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['glm-tts'].defaultBaseUrl).replace(/\/$/, '');
  const response = await ctx.fetch(`${baseUrl}/audio/speech`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: config.model || 'glm-tts',
      input: text,
      voice: config.voice,
      speed: config.speed || 1.0,
      volume: 1.0,
      response_format: 'wav',
    }),
    signal,
  });

  if (!response.ok) {
    throwIfTtsRateLimited('GLM', response.status, response.headers?.get('retry-after'));
    const errorText = await response.text().catch(() => response.statusText);
    let message = `GLM TTS API error: ${errorText}`;
    try {
      const errorJson = JSON.parse(errorText);
      if (errorJson.error?.message) {
        message = `GLM TTS API error: ${errorJson.error.message} (code: ${errorJson.error.code})`;
      }
    } catch {
      /* 非 JSON 错误体原样用 */
    }
    throw upstreamError('GLM TTS', response.status, message);
  }
  return validateTTSAudioResponse(response, 'GLM', 'wav');
}

/**
 * source:tts-providers.ts:955-1059
 *
 * ⚠️ 克隆音色分支：上游走 `qwen-voice-clone.ts`（先用 `qwen-voice-enrollment`
 * 注册，再用专用请求体合成）。本包**没有**搬那个注册客户端 —— 它要持久化
 * 音色注册状态，属于存储层。这里克隆音色按普通音色 ID 走同一个合成端点；
 * 若宿主注册出来的 id 需要专用协议，调用方应显式传 `providerOptions.qwenVoiceClone`
 * 之外的 provider（目前会拿到上游的"音色不存在"错误，而不是静默降级）。
 */
async function generateQwenTTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['qwen-tts'].defaultBaseUrl).replace(/\/$/, '');
  const rate = Math.round(((config.speed || 1.0) - 1.0) * 500);
  const modelId = config.model || 'qwen3-tts-flash';

  const response = await ctx.fetch(
    `${baseUrl}/services/aigc/multimodal-generation/generation`,
    {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        model: modelId,
        input: { text, voice: config.voice, language_type: 'Chinese' },
        parameters: { rate },
      }),
      signal,
    },
  );

  if (!response.ok) {
    throwIfTtsRateLimited('Qwen', response.status, response.headers?.get('retry-after'));
    throw new MediaError('E_UPSTREAM_ERROR', 'Qwen TTS 请求失败', {
      provider: 'qwen-tts',
      status: response.status,
      retryable: response.status >= 500,
      body: await response.text().catch(() => ''),
    });
  }

  const data = await response.json();
  if (!data.output?.audio?.url) throw invalidResponse('Qwen TTS', '响应里没有 audio.url');

  // 音频是二段下载：URL 由 DashScope 给出，可能是 OSS 域名。
  const audioRes = await ctx.fetch(data.output.audio.url, { signal });
  if (!audioRes.ok) {
    throw upstreamError('Qwen TTS 音频下载', audioRes.status, await audioRes.text().catch(() => ''));
  }
  return { audio: Buffer.from(await audioRes.arrayBuffer()), format: 'wav' };
}

// MiniMax 业务码。source:tts-providers.ts:1066-1073
const MINIMAX_RATE_LIMIT_STATUS_CODES = new Set([1002, 1039, 1041, 2045]);
const MINIMAX_QUOTA_STATUS_CODES = new Set([1008, 2056]);

function minimaxStatusCode(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/** source:tts-providers.ts:1085-1092 */
function minimaxBodyStatusCode(body) {
  try {
    return minimaxStatusCode(JSON.parse(body)?.base_resp?.status_code);
  } catch {
    return undefined;
  }
}

/** source:tts-providers.ts:1095-1102 */
function minimaxQuotaError(statusCode, message) {
  return statusCode !== undefined && MINIMAX_QUOTA_STATUS_CODES.has(statusCode)
    ? new MediaError('E_QUOTA_EXHAUSTED', message, { provider: 'minimax-tts', statusCode })
    : undefined;
}

/** source:tts-providers.ts:1105-1127 —— 非 0 的 base_resp 一律失败，哪怕带了音频。 */
function throwIfMiniMaxBaseRespFailed(data, retryAfterHeader) {
  const statusCode = minimaxStatusCode(data?.base_resp?.status_code);
  if (statusCode === undefined || statusCode === 0) return;
  const statusMsg =
    typeof data?.base_resp?.status_msg === 'string' && data.base_resp.status_msg.trim()
      ? data.base_resp.status_msg.trim()
      : `status ${statusCode}`;

  if (MINIMAX_RATE_LIMIT_STATUS_CODES.has(statusCode)) {
    throw new MediaError('E_RATE_LIMITED', `MiniMax TTS 触发限流：${statusMsg}`, {
      provider: 'minimax-tts',
      statusCode,
      retryable: true,
      retryAfterMs: parseRetryAfterMs(retryAfterHeader),
    });
  }
  const message = `MiniMax TTS API error (${statusCode}): ${statusMsg}`;
  throw minimaxQuotaError(statusCode, message) ?? new MediaError('E_UPSTREAM_ERROR', message, {
    provider: 'minimax-tts',
    statusCode,
    retryable: false,
  });
}

/** source:tts-providers.ts:1132-1204（十六进制音频体） */
async function generateMiniMaxTTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['minimax-tts'].defaultBaseUrl || '').replace(/\/$/, '');
  const response = await ctx.fetch(`${baseUrl}/v1/t2a_v2`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: config.model || 'speech-2.8-hd',
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: {
        voice_id: config.voice,
        speed: config.speed || 1.0,
        vol: 1,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: config.format || 'mp3',
        channel: 1,
      },
      language_boost: 'auto',
    }),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => response.statusText);
    const message = `MiniMax TTS API error: ${errorText}`;
    const quota = minimaxQuotaError(minimaxBodyStatusCode(errorText), message);
    throwIfTtsRateLimited('MiniMax', response.status, response.headers?.get('retry-after'), quota ? { quota } : undefined);
    throw quota ?? upstreamError('MiniMax TTS', response.status, message);
  }

  const data = await response.json();
  throwIfMiniMaxBaseRespFailed(data, response.headers?.get('retry-after'));
  const hexAudio = data?.data?.audio;
  if (!hexAudio || typeof hexAudio !== 'string') {
    throw invalidResponse('MiniMax TTS', `没有音频：${JSON.stringify(data).slice(0, 300)}`);
  }
  const cleanedHex = hexAudio.trim();
  if (cleanedHex.length % 2 !== 0) throw invalidResponse('MiniMax TTS', '十六进制音频长度非法');

  return {
    audio: Buffer.from(cleanedHex, 'hex'),
    format: data?.extra_info?.audio_format || config.format || 'mp3',
  };
}

/** source:tts-providers.ts:1210-1306 */
async function generateGoogleTTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['google-tts'].defaultBaseUrl || '').replace(/\/$/, '');
  const modelId = config.model || TTS_PROVIDERS['google-tts'].defaultModelId;
  const voice = config.voice || 'Kore';

  const response = await ctx.fetch(`${baseUrl}/interactions`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'x-goog-api-key': config.apiKey,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model: modelId,
      input: text,
      response_format: { type: 'audio' },
      generation_config: { speech_config: [{ voice }] },
    }),
    signal,
  });

  if (!response.ok) {
    throwIfTtsRateLimited('Google', response.status, response.headers?.get('retry-after'));
    throw upstreamError('Google TTS', response.status, await response.text().catch(() => response.statusText));
  }

  const payload = await response.json().catch(() => null);
  const audio = extractGoogleInteractionsAudio(payload);
  if (!audio) throw invalidResponse('Google TTS', '响应里没有 audio 内容');

  const bytes = Buffer.from(audio.data, 'base64');
  if (bytes.byteLength === 0) throw invalidResponse('Google TTS', '音频负载为空');

  const mimeType = audio.mimeType?.split(';')[0].trim().toLowerCase();
  if (mimeType === 'audio/wav') return { audio: bytes, format: 'wav' };
  if (mimeType && mimeType !== 'audio/l16') {
    throw invalidResponse('Google TTS', `不支持的音频格式：${mimeType}`);
  }
  return {
    audio: Buffer.from(pcmS16leMonoToWav(bytes, sampleRateFromL16Mime(audio.mimeType))),
    format: 'wav',
  };
}

/** source:tts-providers.ts:1275-1298 */
function extractGoogleInteractionsAudio(payload) {
  if (!payload || !Array.isArray(payload.steps)) return null;
  for (const step of payload.steps) {
    if (!step || typeof step !== 'object') continue;
    const content = step.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type !== 'audio' || typeof part.data !== 'string' || part.data.length === 0) continue;
      return { data: part.data, mimeType: typeof part.mime_type === 'string' ? part.mime_type : undefined };
    }
  }
  return null;
}

/** source:tts-providers.ts:1300-1306 —— `audio/l16;rate=24000` → 24000。 */
function sampleRateFromL16Mime(mime) {
  if (typeof mime !== 'string') return 24_000;
  const match = /(?:^|[;\s])rate=(\d+)/i.exec(mime);
  const rate = match ? Number(match[1]) : NaN;
  return Number.isFinite(rate) && rate > 0 ? rate : 24_000;
}

/** source:tts-providers.ts:1311-1358 */
async function generateElevenLabsTTS(ctx, config, text, signal) {
  const baseUrl = (config.baseUrl || TTS_PROVIDERS['elevenlabs-tts'].defaultBaseUrl).replace(/\/$/, '');
  const requestedFormat = config.format || 'mp3';
  const clampedSpeed = Math.min(1.2, Math.max(0.7, config.speed || 1.0));
  const outputFormatMap = {
    mp3: 'mp3_44100_128',
    opus: 'opus_48000_96',
    pcm: 'pcm_44100',
    wav: 'wav_44100',
    ulaw: 'ulaw_8000',
    alaw: 'alaw_8000',
  };
  const outputFormat = outputFormatMap[requestedFormat] || outputFormatMap.mp3;

  const response = await ctx.fetch(
    `${baseUrl}/text-to-speech/${encodeURIComponent(config.voice)}?output_format=${outputFormat}`,
    {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'xi-api-key': config.apiKey,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        text,
        model_id: config.model || 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: clampedSpeed },
      }),
      signal,
    },
  );

  if (!response.ok) {
    throwIfTtsRateLimited('ElevenLabs', response.status, response.headers?.get('retry-after'));
    throw upstreamError(
      'ElevenLabs TTS',
      response.status,
      (await response.text().catch(() => '')) || response.statusText,
    );
  }
  return validateTTSAudioResponse(response, 'ElevenLabs', requestedFormat);
}

/**
 * source:tts-providers.ts:1378-1478
 *
 * 两种鉴权：`appId:accessKey`（语音控制台）与单一 `ark-` 计划 key（Agent Plan），
 * 端点与鉴权头**绑定**，永远由 key 的形状同时决定两者。
 */
async function generateDoubaoTTS(ctx, config, text, signal) {
  const rawKey = config.apiKey || '';
  if (!rawKey) {
    throw notConfigured('TTS', 'doubao-tts', '豆包需要 Agent Plan key 或 "appId:accessKey"');
  }
  const colonIdx = rawKey.indexOf(':');
  const isPlanKey = colonIdx < 0;
  const appId = isPlanKey ? '' : rawKey.slice(0, colonIdx);
  const accessKey = isPlanKey ? '' : rawKey.slice(colonIdx + 1);
  if (!isPlanKey && (!appId || !accessKey)) {
    throw invalidInput('豆包 appId:accessKey 格式错误：两半都必需（或改用 Agent Plan key）', 'apiKey');
  }

  const baseUrl = config.baseUrl || TTS_PROVIDERS['doubao-tts'].defaultBaseUrl;
  const speechRate = Math.round(((config.speed || 1.0) - 1.0) * 100);
  const authHeaders = isPlanKey
    ? { 'X-Api-Key': rawKey }
    : { 'X-Api-App-Id': appId, 'X-Api-Access-Key': accessKey };

  const response = await ctx.fetch(`${baseUrl}/unidirectional`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      'X-Api-Resource-Id': 'seed-tts-2.0',
    },
    body: JSON.stringify({
      user: { uid: 'openmaic' },
      req_params: {
        text,
        speaker: config.voice,
        audio_params: { format: 'mp3', sample_rate: 24000, speech_rate: speechRate },
      },
    }),
    signal,
  });

  if (!response.ok) {
    throwIfTtsRateLimited('Doubao', response.status, response.headers?.get('retry-after'));
    throw upstreamError('Doubao TTS', response.status, await response.text().catch(() => response.statusText));
  }

  const responseText = await response.text();
  const audioChunks = [];
  for (const objectText of splitConcatenatedJsonObjects(responseText)) {
    let chunk;
    try {
      chunk = JSON.parse(objectText);
    } catch {
      continue;
    }
    if (chunk.code === 0 && chunk.data) {
      audioChunks.push(Buffer.from(chunk.data, 'base64'));
    } else if (chunk.code === 20000000) {
      break;
    } else if (chunk.code && chunk.code !== 0) {
      if (chunk.code === 45000000 || chunk.code === 45000292) {
        throw new MediaError('E_RATE_LIMITED', chunk.message || '并发配额用尽', {
          provider: 'doubao-tts',
          statusCode: chunk.code,
          retryable: true,
        });
      }
      throw new MediaError('E_UPSTREAM_ERROR', `Doubao TTS error: ${chunk.message || 'unknown'} (code: ${chunk.code})`, {
        provider: 'doubao-tts',
        statusCode: chunk.code,
      });
    }
  }
  if (audioChunks.length === 0) throw invalidResponse('Doubao TTS', '没有收到音频数据');
  return { audio: Buffer.concat(audioChunks), format: 'mp3' };
}

/** 内置 provider 的 switch。source:tts-providers.ts:301-366 */
const TTS_ROUTES = {
  'openai-tts': (ctx, config, text, signal) => generateOpenAITTS(ctx, config, text, signal),
  'azure-tts': (ctx, config, text, signal) => generateAzureTTS(ctx, config, text, signal),
  'glm-tts': (ctx, config, text, signal) => generateGLMTTS(ctx, config, text, signal),
  'qwen-tts': (ctx, config, text, signal) => generateQwenTTS(ctx, config, text, signal),
  'voxcpm-tts': (ctx, config, text, signal) => generateVoxCPMTTS(ctx, config, text, signal),
  'minimax-tts': (ctx, config, text, signal) => generateMiniMaxTTS(ctx, config, text, signal),
  'doubao-tts': (ctx, config, text, signal) => generateDoubaoTTS(ctx, config, text, signal),
  'elevenlabs-tts': (ctx, config, text, signal) => generateElevenLabsTTS(ctx, config, text, signal),
  'google-tts': (ctx, config, text, signal) => generateGoogleTTS(ctx, config, text, signal),
  'lemonade-tts': (ctx, config, text, signal) => generateLemonadeTTS(ctx, config, text, signal),
};

/**
 * 合成一段语音。
 *
 * source:tts-providers.ts:301-366 —— provider 校验、超时信号、限流分类逐条保留。
 * 返回值 `{ audio: Buffer, format: string }`；`Buffer` 而不是 stream（规范：二进制用 Buffer）。
 *
 * @param {{fetch: Function}} ctx `{ fetch }`
 * @param {object} config 已解析的 provider 配置（含 providerId/apiKey/baseUrl/voice/speed/format）
 * @param {string} text
 * @param {AbortSignal} [callerSignal]
 */
export async function generateTTS(ctx, config, text, callerSignal) {
  const meta = TTS_PROVIDERS[config.providerId];
  if (!meta && !String(config.providerId || '').startsWith('custom-tts-')) {
    throw unsupportedProvider('TTS', config.providerId, Object.keys(TTS_PROVIDERS));
  }

  if (config.providerId === 'browser-native-tts') {
    // source:tts-providers.ts:343-347 —— 客户端 provider 在服务端必须显式失败。
    throw new MediaError(
      'E_UNSUPPORTED_PROVIDER',
      'browser-native-tts 只能在客户端用 Web Speech API 播放，服务端无法合成',
      { provider: 'browser-native-tts', clientOnly: true },
    );
  }

  if (meta?.requiresApiKey && !config.apiKey) {
    throw notConfigured('TTS', config.providerId);
  }

  const signal = ttsRequestSignal(callerSignal);
  const route = TTS_ROUTES[config.providerId]
    ?? (String(config.providerId).startsWith('custom-tts-')
      // source:tts-providers.ts:348-351 —— 自定义 provider 走 OpenAI 兼容形状。
      ? (c, cfg, body, sig) => generateOpenAITTS(c, cfg, body, sig)
      : null);
  if (!route) throw unsupportedProvider('TTS', config.providerId, Object.keys(TTS_PROVIDERS));

  try {
    return await route(ctx, config, text, signal);
  } catch (error) {
    if (callerSignal?.aborted) throw error;
    if (signal.aborted && signal.reason?.name === 'TimeoutError') {
      throw new MediaError(
        'E_UPSTREAM_ERROR',
        `TTS 请求超过 ${ttsRequestTimeoutMs()}ms 没有响应（provider ${config.providerId}），可重试`,
        { provider: config.providerId, timeoutMs: ttsRequestTimeoutMs(), retryable: true },
      );
    }
    throw error;
  }
}
