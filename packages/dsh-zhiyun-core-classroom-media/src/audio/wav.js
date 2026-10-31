// 源：ref/OpenMAIC/lib/audio/pcm-wav.ts:1-33（pcmS16leMonoToWav）
// 源：ref/OpenMAIC/lib/audio/wav-utils.ts:34-107（WAV 容器写入 / 单声道混音）
// 源：ref/OpenMAIC/lib/audio/wav-validate.ts:21-94（RIFF 块遍历与 fmt 校验）
// 源：ref/OpenMAIC/lib/media/sniff-audio-container.ts:1-90（容器嗅探）
//
// 只保留**服务端**需要的部分：上游 wav-utils 里 `AudioContext` 那半是浏览器解码，
// 本包不做客户端音频转换（那是 page/renderer 包的事，规范 §2 通道 4）。

const QWEN_REFERENCE_SAMPLE_RATE = 24_000;
const QWEN_REFERENCE_CHANNELS = 1;
const MIN_REFERENCE_DURATION_SECONDS = 1;
const MAX_REFERENCE_DURATION_SECONDS = 60;

/** source:pcm-wav.ts:6-33 —— 把无头 mono s16le PCM 包进 WAV 容器。 */
export function pcmS16leMonoToWav(pcm, sampleRate = 24_000) {
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);

  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

/** source:wav-validate.ts:21-23 */
function readAscii(bytes, start, end) {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

/**
 * 遍历 RIFF 块。source:wav-validate.ts:37-74 —— 保留 chunk 循环（而不是假设固定偏移），
 * 因为有的编码器会在 `data` 前插入 LIST / fact 块。
 *
 * @returns {{fmt: {format:number,channels:number,sampleRate:number,byteRate:number,blockAlign:number,bitsPerSample:number}|null,
 *            dataOffset:number, dataSize:number} | null}
 */
export function parseWavHeader(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 12) return null;
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 12) !== 'WAVE') return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;

  while (offset + 8 <= bytes.byteLength) {
    const chunkId = readAscii(bytes, offset, offset + 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (chunkId === 'fmt ' && body + 16 <= bytes.byteLength) {
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        byteRate: view.getUint32(body + 8, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (chunkId === 'data') {
      const remaining = bytes.byteLength - body;
      dataSize = chunkSize > 0 && chunkSize <= remaining ? chunkSize : remaining;
      dataOffset = body;
      break;
    }
    offset = body + chunkSize + (chunkSize % 2);
  }

  if (!fmt || dataOffset < 0) return null;
  return { fmt, dataOffset, dataSize };
}

/** 是否是 WAV（供 ASR 的"只收 WAV"分支与拼接前置校验用）。source:asr-providers.ts:292-306 */
export function isWavBytes(input) {
  return parseWavHeader(input) !== null;
}

/**
 * 容器嗅探（只认服务端会产出的四种）。source:media/sniff-audio-container.ts:40-90
 *
 * 存的旁白可能带着错的格式标签（provider 回了 WAV 但 Content-Type 缺失时会被记成 mp3），
 * 所以一律"字节优先"。
 */
export function sniffAudioContainer(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 4) return null;
  if (readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 12) === 'WAVE') return 'wav';
  if (readAscii(bytes, 0, 3) === 'ID3') return 'mp3';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    return (bytes[1] & 0x06) === 0 ? 'aac' : 'mp3';
  }
  if (readAscii(bytes, 0, 4) === 'fLaC') return 'flac';
  if (readAscii(bytes, 0, 4) === 'OggS') return 'ogg';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'webm';
  return null;
}

/**
 * 校验 Qwen 音色克隆的参考音频（24 kHz / mono / 16-bit PCM / 1–60s）。
 * source:wav-validate.ts:26-94 —— 逐条阈值照抄，包括 `offset === byteLength` 这条
 * （尾部多一块的 WAV 会被拒，上游就是这行为）。
 *
 * @returns {{durationSeconds:number, sampleRate:number, channels:number}}
 */
export function validateReferenceAudio(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const fail = () => {
    const error = new Error(
      'Reference audio must be a 24 kHz mono PCM WAV file between 1 and 60 seconds long',
    );
    error.code = 'QWEN_VC_REFERENCE_AUDIO_INVALID';
    throw error;
  };
  if (bytes.byteLength < 44) fail();

  const parsed = parseWavHeader(bytes);
  if (!parsed) fail();
  const { fmt, dataOffset, dataSize } = parsed;
  if (
    fmt.format !== 1
    || fmt.channels !== QWEN_REFERENCE_CHANNELS
    || fmt.sampleRate !== QWEN_REFERENCE_SAMPLE_RATE
    || fmt.bitsPerSample !== 16
    || fmt.blockAlign !== fmt.channels * 2
    || fmt.byteRate !== fmt.sampleRate * fmt.blockAlign
  ) {
    fail();
  }

  const durationSeconds = fmt.byteRate ? dataSize / fmt.byteRate : 0;
  if (
    dataOffset + dataSize !== bytes.byteLength
    || dataSize % fmt.blockAlign !== 0
    || durationSeconds < MIN_REFERENCE_DURATION_SECONDS
    || durationSeconds > MAX_REFERENCE_DURATION_SECONDS
  ) {
    fail();
  }
  return {
    durationSeconds,
    sampleRate: QWEN_REFERENCE_SAMPLE_RATE,
    channels: QWEN_REFERENCE_CHANNELS,
  };
}

/**
 * 把一段 WAV 的 PCM 负载读出来（用于拼接）。
 *
 * 上游没有这个函数：它是 `concatWav` 的输入侧。上游的"拼接"其实是
 * **不拼字节**（`tts-utils.ts:200-205`：每段各自一个文件），本仓保留那个约定，
 * 但同时给出拼接能力 —— 导出链路需要单文件音轨。
 */
export function wavPcmBytes(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const parsed = parseWavHeader(bytes);
  if (!parsed) return null;
  const { fmt, dataOffset, dataSize } = parsed;
  // 只拼同格式：采样率/声道/位深不同时硬拼出来的是噪音，调用方应先转码。
  return {
    pcm: bytes.subarray(dataOffset, dataOffset + dataSize),
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: fmt.bitsPerSample,
    byteRate: fmt.byteRate,
  };
}
