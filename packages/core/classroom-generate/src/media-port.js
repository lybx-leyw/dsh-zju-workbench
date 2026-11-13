/**
 * 媒体端口适配层。
 *
 * # 为什么需要这一层（这是本节最重要的注释）
 *
 * `phases/media.js` 期望的端口契约是：
 *
 *   ```js
 *   media = {
 *     image?:  async ({ prompt, elementId, aspectRatio, style }) => Buffer | { data, mime },
 *     speech?: async ({ text, sceneId, actionId })            => Buffer | { data, mime },
 *   }
 *   ```
 *
 * 但仓内**唯一真实存在**的媒体服务是 `ctx.zwClassroomMedia`，它的接口是：
 *
 *   ```js
 *   svc.tts(text, voice?)            -> { ok, provider, bytes, format, durationSeconds, voice }
 *   svc.image(prompt, options?)      -> { ok, provider, ...result }   // result 里是 base64 或 url
 *   svc.asr(file, options?)
 *   ```
 *
 * 三处不匹配，任何一处都足以让整段媒体失效：
 *
 * 1. **方法名**：没有 `speech`（叫 `tts`），没有 `video`。
 * 2. **调用形状**：`image(prompt, options)` 要的是**字符串**，而 `media.js` 传的是
 *    整个 item 对象 → 服务内部 `typeof prompt !== 'string'` 直接 `invalidInput` 失败。
 * 3. **返回信封**：服务返回 `{ ok, base64 }` / `{ ok, bytes }`，而 `media.js` 的
 *    `toBytes` 只认 `data` / `bytes` → 图片取出 `null`，抛"媒体端口没有返回字节"。
 *
 * 净效果是：**配图 100% 失败、配音 100% 跳过、视频 100% 跳过**，而管线照常报"生成成功"。
 * 用户看到的是"课堂生成完了但没有一张图、也没有声音"。
 *
 * 这一层就是把这三种不匹配在**边界上**一次性对齐，让 `media.js` 无需知道真实服务长什么样。
 * 放在这里而不是改 `media.js`：`media.js` 的契约本身是清楚的（与上游 `RunStepServices`
 * 同构），该改的是"谁去满足这个契约"。
 */

/** 音频格式 → MIME。服务的 `format` 是 'mp3' / 'wav' / 'opus' 这类短名。 */
function audioMimeOf(format) {
  const normalized = String(format ?? '').toLowerCase().replace(/^\./, '');
  if (normalized === 'mp3' || normalized === 'mpeg') return 'audio/mpeg';
  if (normalized === 'wav') return 'audio/wav';
  if (normalized === 'opus') return 'audio/opus';
  if (normalized === 'ogg') return 'audio/ogg';
  if (normalized === 'aac' || normalized === 'm4a') return 'audio/aac';
  if (normalized === 'flac') return 'audio/flac';
  return 'audio/mpeg';
}

/** 图片格式 → MIME。服务的 image 结果可能只给 base64/url，没有显式 mime。 */
function imageMimeOf(result) {
  if (typeof result?.mimeType === 'string' && result.mimeType) return result.mimeType;
  if (typeof result?.mime === 'string' && result.mime) return result.mime;
  if (typeof result?.format === 'string' && result.format) {
    const f = result.format.toLowerCase();
    if (f === 'png') return 'image/png';
    if (f === 'webp') return 'image/webp';
    if (f === 'gif') return 'image/gif';
  }
  return 'image/png';
}

/** 从服务的失败信封里取出错误码，用于媒体失败分类（对齐上游 mediaFailure 的 code 语义）。 */
function codeOfFailure(payload) {
  const code = payload?.code ?? payload?.error?.code;
  return typeof code === 'string' && code ? code : 'E_MEDIA_PROVIDER_FAILED';
}

/**
 * 把 `zwClassroomMedia` 包成 `media.js` 认的端口。
 *
 * @param {object|null} service `ctx.zwClassroomMedia`
 * @returns {object|null} 端口；服务不存在时返回 null（media 段会整体跳过）
 */
export function adaptMediaService(service) {
  if (!service || typeof service !== 'object') return null;

  const port = {};

  // ── 配音：speech → tts ──
  if (typeof service.tts === 'function') {
    port.speech = async (item, options = {}) => {
      const text = typeof item?.text === 'string' ? item.text : '';
      if (!text.trim()) return null;
      const result = await service.tts(text, { signal: options.signal });
      if (!result || result.ok === false) {
        throw Object.assign(new Error(result?.message ?? '配音合成失败'), {
          code: codeOfFailure(result),
        });
      }
      // 服务的 bytes 就是 Buffer（规范：不用 Node stream）。
      if (!result.bytes) throw new Error('配音服务没有返回音频字节');
      return { data: result.bytes, mime: audioMimeOf(result.format) };
    };
  }

  // ── 配图：image(item) → image(prompt, options) ──
  if (typeof service.image === 'function') {
    port.image = async (item, options = {}) => {
      const prompt = typeof item?.prompt === 'string' ? item.prompt.trim() : '';
      if (!prompt) throw new Error('配图请求缺少提示词');
      const result = await service.image(prompt, {
        aspectRatio: item?.aspectRatio,
        style: item?.style,
        signal: options.signal,
      });
      if (!result || result.ok === false) {
        throw Object.assign(new Error(result?.message ?? '配图生成失败'), {
          code: codeOfFailure(result),
        });
      }
      const mime = imageMimeOf(result);
      // 两种形态：直接给 base64，或给一个 URL 让我们自己取。
      if (typeof result.base64 === 'string' && result.base64) {
        return { data: Buffer.from(result.base64, 'base64'), mime };
      }
      if (result.bytes) return { data: result.bytes, mime };
      if (typeof result.url === 'string' && result.url) {
        // 交给 media.js 的 toBytes 下载（带字节上限）。
        return result.url;
      }
      throw new Error('配图服务没有返回图片数据');
    };
  }

  // ── 视频：服务没有这个能力，**不提供端口** ──
  // media.js 会把它记成 skipped；这比"提供了端口但每次都抛错"更诚实。
  // 上游在这里是 `mayGenerate` 判定槽位不可用 → 同样记 skipped。

  // ── 透传：`ports.media` 同时是 material-analysis 段的解析层 ──
  //
  // ⚠️ 适配层必须把它「转发」的服务的其余能力原样透出。
  // 踩过的坑：一开始只暴露了 image/speech，结果 `material-analysis` 里
  // `typeof media?.parsePdf !== 'function'` 直接判死，所有带讲义的 run 全失败。
  // 凡是不做形状改写的方法，一律 bind 回原服务。
  for (const key of ['parsePdf', 'asr', 'search', 'fetchPage', 'tts', 'image']) {
    if (port[key] || typeof service[key] !== 'function') continue;
    port[key] = service[key].bind(service);
  }

  return Object.keys(port).length > 0 ? port : null;
}
