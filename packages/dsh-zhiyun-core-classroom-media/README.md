# dsh-zhiyun-core-classroom-media

智云 Pro 互动课堂的**语音 / 媒体 / 检索**半边。把 OpenMAIC 的
`lib/audio`（9.7k）`lib/media`（9.1k）`lib/media-parse` `lib/web-search`（2.1k）
`lib/web-fetch` `lib/pdf`（2.1k）搬成一个 Cordis 插件。

```
ctx.zhiyunClassroomMedia.tts(text, voice?)       → { ok, bytes, format, durationSeconds }
ctx.zhiyunClassroomMedia.asr(file, opts?)        → { ok, text }
ctx.zhiyunClassroomMedia.image(prompt, opts?)    → { ok, url|base64, width, height }
ctx.zhiyunClassroomMedia.search(query, opts?)    → { ok, answer, sources, query, responseTime }
ctx.zhiyunClassroomMedia.fetchPage(url, opts?)   → { ok, title, markdown, finalUrl, truncated }
ctx.zhiyunClassroomMedia.parsePdf(buffer, opts?) → { ok, text, images, metadata }
ctx.zhiyunClassroomMedia.timeline(clips, opts?)  → { ok, timeline, track }
ctx.zhiyunClassroomMedia.providers(capability?)  → 六段 provider 的可用性
ctx.zhiyunClassroomMedia.status()
```

## 四条纪律

1. **`apply()` 永不抛**。缺 studio、`provide` 撞名、日志桩不全 —— 一律降级，不白屏。
2. **方法返回结果、不 throw**。课堂链路跑在渲染树里，一个 provider 没配不该炸页面；
   失败形状统一是 `{ ok: false, code, message, detail }`，`code` 见 `src/errors.js`。
3. **密钥只从宿主拿**：`ctx.zhiyunClassroomStudio.providers` → `config.providers` 注入 →
   `process.env`（仅桌面端过渡兜底，`src/providers.js` 有逐条注释）。
4. **二进制用 `Buffer`**，没有 Node stream。

## 文件 → 上游源

| 本包文件 | 上游源 |
|---|---|
| `src/index.js` | 无（宿主接缝；对应 `app/api/generate/{tts,asr}` 等 route 的形状） |
| `src/providers.js` | `lib/audio/constants.ts`、`lib/media/image-providers.ts:39-176`、`lib/web-search/constants.ts:1-160`、`lib/web-fetch/registry.ts`、`lib/pdf/constants.ts` |
| `src/audio/tts.js` | `lib/audio/tts-providers.ts:301-1490`、`json-stream.ts`、`voxcpm.ts`、`tts-utils.ts` |
| `src/audio/asr.js` | `lib/audio/asr-providers.ts:169-665`、`wav-utils.ts:109-123` |
| `src/audio/wav.js` | `lib/audio/pcm-wav.ts`、`wav-utils.ts:34-107`、`wav-validate.ts:21-94`、`lib/media/sniff-audio-container.ts` |
| `src/audio/duration.js` | `lib/audio/audio-duration.ts:1-227` |
| `src/audio/timeline.js` | `lib/audio/narration-tts.ts:262-278`、`tts-utils.ts:200-229` |
| `src/media/image.js` | `lib/media/image-providers.ts:39-268` |
| `src/media/adapters.js` | `lib/media/adapters/*.ts`（10 个 image adapter）、`require-model.ts`、`redirect-guard.ts` |
| `src/web/search.js` | `lib/web-search/*.ts`（12 个 provider + format/utils/endpoint） |
| `src/web/fetch.js` | `lib/web-fetch/builtin-extraction.ts:26-560` 与 `providers/*.ts` |
| `src/pdf/parse.js` | `lib/pdf/pdf-providers.ts`、`mineru-parser.ts`、`mineru-cloud.ts`、`alidocmind-client.ts` |
| `src/pdf/zip.js` | `lib/pdf/mineru-cloud.ts:286-490`（替代 JSZip） |

## provider 分支

- **TTS 11 个**：openai / azure / glm / qwen / voxcpm（vllm-omni·python-api·nano-vllm 三后端）/
  minimax / doubao（两种鉴权）/ elevenlabs / google / lemonade / browser-native（客户端专用），
  外加 `custom-tts-*` 走 OpenAI 兼容形状。
- **ASR 6 个**：openai-whisper / qwen-asr / azure-asr / funasr / lemonade / browser-native，
  外加 `custom-asr-*`。
- **图片 10 个**：seedream / openai-image / qwen-image / nano-banana / minimax / grok /
  glm / comfyui / lemonade / openrouter。
- **检索 12 个**：tavily / exa / bocha / searxng / brave（API + 免 key 抓取）/ minimax /
  doubao / kimi / deepseek / firecrawl / baidu（网页 + 百科 + 学术）/ claude。
- **抓取 4 个**：builtin / kimi / deepseek / firecrawl。
- **PDF 4 个**：unpdf / mineru（自建）/ mineru-cloud / alidocmind。

## 已知降级（都要在评审里明说）

| 项 | 原因 | 影响 |
|---|---|---|
| HTML→Markdown 自研 | 不新增依赖；`linkedom`/`@mozilla/readability`/`turndown` 不可用 | 比 Readability 弱：营销页会多留导航文字 |
| 无 undici Agent / DNS 钉扎 | 出口策略属 `source-netproxy` | 本包只做"不跟随重定向 + 协议/凭证校验" |
| `audioProviderFetch` → 注入 fetch | 同上 | 3xx 一律当失败，等价 `provider-fetch` 的结论 |
| qwen / voxcpm 音色克隆注册未搬 | 需要持久化注册状态（存储层） | 克隆音色按普通音色 ID 走同一端点 |
| `appAttributionHeaders` 未带 | 那是 OpenMAIC 的产品署名 | 本仓不该冒充上游产品 |
| AliDocMind 只保留分支 + 依赖探测 | 需要阿里云 SDK 的签名与请求类型 | 未装 SDK 时返回 `E_DEPENDENCY_MISSING` |
| ComfyUI 的 workflow 来自配置 | 没有 Next 的 `public/` 目录 | 需 `providerOptions.workflow` 或 `workflowPath` |

## 原生 / 可选依赖（桌面端分发风险）

| 依赖 | 用在哪 | 缺了会怎样 |
|---|---|---|
| `unpdf` | `parsePdf`（unpdf 分支）、`fetchPage` 抓到 PDF 页 | `E_DEPENDENCY_MISSING` |
| `sharp` | unpdf 分支的图片转 PNG（`@napi-rs/canvas` 系原生件） | 只出文本，不出图片 |
| `@alicloud/docmind-api20220711` | AliDocMind 分支 | `E_DEPENDENCY_MISSING` |
| 其他 | **无**（zip 用 `node:zlib`，音频头解析纯 JS） | — |

## 测试

```
node --test tests/classroom-media.test.mjs
```

15 条：apply 不抛（含 provide 撞名）、`tts()` 未配置返回 `E_NOT_CONFIGURED`、
`search()`/`fetchPage()` 用假 fetch 断言 URL 与解析结果、PDF 缺依赖的形状、时间轴排布。
