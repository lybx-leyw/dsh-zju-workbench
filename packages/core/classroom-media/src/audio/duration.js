// 源：ref/OpenMAIC/lib/audio/audio-duration.ts:1-227（逐函数照搬）
//
// 无依赖的音频时长测量：导出链路要把每段旁白映射到时间轴，就得知道时长。
// 上游刻意不在这里解码音频（慢，而且纯 manifest 测试跑不了 FFmpeg），
// 只解容器头 —— WAV 走 RIFF 块，MP3 走第一帧头 + Xing/VBRI。
// 解析不了返回 `null`，调用方按"时长未知"降级（音频照样存、照样放）。

function toBytes(input) {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function readAscii(bytes, offset, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i] ?? 0);
  return out;
}

function readUint32LE(bytes, offset) {
  return (
    (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24))
    >>> 0
  );
}

function readUint32BE(bytes, offset) {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
    >>> 0
  );
}

/** source:audio-duration.ts:65-101 */
export function measureWavDuration(input) {
  const bytes = toBytes(input);
  if (bytes.length < 12) return null;
  if (readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WAVE') return null;

  let byteRate = 0;
  let dataSize = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const chunkId = readAscii(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    const bodyOffset = offset + 8;
    if (chunkId === 'fmt ' && bodyOffset + 16 <= bytes.length) {
      byteRate = readUint32LE(bytes, bodyOffset + 8);
    } else if (chunkId === 'data') {
      // 未知长度的 data 块（0 / 0xFFFFFFFF）退回"剩余字节"。
      const remaining = bytes.length - bodyOffset;
      dataSize = chunkSize > 0 && chunkSize <= remaining ? chunkSize : remaining;
      break;
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2);
  }

  if (byteRate <= 0 || dataSize <= 0) return null;
  return dataSize / byteRate;
}

// MPEG version → layer → bitrate（kbps）。source:audio-duration.ts:105-127
const MP3_BITRATES = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};

const MP3_SAMPLE_RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  3: [11025, 12000, 8000], // 2.5
};

/** source:audio-duration.ts:130-138 */
function skipId3v2(bytes) {
  if (bytes.length < 10 || readAscii(bytes, 0, 3) !== 'ID3') return 0;
  const size =
    ((bytes[6] & 0x7f) << 21)
    | ((bytes[7] & 0x7f) << 14)
    | ((bytes[8] & 0x7f) << 7)
    | (bytes[9] & 0x7f);
  return 10 + size;
}

/** source:audio-duration.ts:120-195 */
export function measureMp3Duration(input) {
  const bytes = toBytes(input);
  const audioStart = skipId3v2(bytes);

  let frame = -1;
  for (let i = audioStart; i + 4 <= bytes.length; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      frame = i;
      break;
    }
  }
  if (frame < 0) return null;

  const b1 = bytes[frame + 1];
  const b2 = bytes[frame + 2];
  const versionBits = (b1 >> 3) & 0x03; // 0=2.5, 2=2, 3=1
  const layerBits = (b1 >> 1) & 0x03; // 3=L1, 2=L2, 1=L3
  const bitrateIdx = (b2 >> 4) & 0x0f;
  const sampleRateIdx = (b2 >> 2) & 0x03;

  if (versionBits === 1 || layerBits === 0) return null;
  if (bitrateIdx === 0 || bitrateIdx === 15) return null;
  if (sampleRateIdx === 3) return null;

  const versionNum = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = layerBits === 3 ? 1 : layerBits === 2 ? 2 : 3;
  const bitrateGroup = versionNum === 1 ? '1' : '2';
  const bitrateKbps = MP3_BITRATES[`${bitrateGroup}-${layer}`]?.[bitrateIdx];
  const sampleRate = MP3_SAMPLE_RATES[versionNum]?.[sampleRateIdx];
  if (!bitrateKbps || !sampleRate) return null;

  const samplesPerFrame = layer === 1 ? 384 : layer === 2 ? 1152 : versionNum === 1 ? 1152 : 576;

  const channelMode = (bytes[frame + 3] >> 6) & 0x03; // 3 = mono
  const xingOffset =
    frame + 4 + (versionNum === 1 ? (channelMode === 3 ? 17 : 32) : channelMode === 3 ? 9 : 17);
  if (xingOffset + 12 <= bytes.length) {
    const tag = readAscii(bytes, xingOffset, 4);
    if (tag === 'Xing' || tag === 'Info') {
      const flags = readUint32BE(bytes, xingOffset + 4);
      if (flags & 0x01) {
        const frameCount = readUint32BE(bytes, xingOffset + 8);
        if (frameCount > 0) return (frameCount * samplesPerFrame) / sampleRate;
      }
    }
  }

  const vbriOffset = frame + 4 + 32;
  if (vbriOffset + 18 <= bytes.length && readAscii(bytes, vbriOffset, 4) === 'VBRI') {
    const frameCount = readUint32BE(bytes, vbriOffset + 14);
    if (frameCount > 0) return (frameCount * samplesPerFrame) / sampleRate;
  }

  // CBR 估算：去掉尾部 ID3v1（128 字节、'TAG' 魔数）再算。
  let end = bytes.length;
  if (end - frame >= 128 && readAscii(bytes, end - 128, 3) === 'TAG') end -= 128;
  const audioBytes = end - frame;
  return (audioBytes * 8) / (bitrateKbps * 1000);
}

/** source:audio-duration.ts:197-205 */
function sniffFormat(bytes) {
  if (readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WAVE') return 'wav';
  if (readAscii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return 'mp3';
  }
  return null;
}

/**
 * source:audio-duration.ts:207-227 —— 魔数优先、`format` 提示只做兜底。
 *
 * 这条顺序不能反：`getAudioResponseFormat` 在 Content-Type 缺失时回落 'mp3'，
 * 把 WAV 字节喂给 MP3 解析器会误同步到一个错误时长。
 */
export function measureAudioDuration(input, format) {
  const bytes = toBytes(input);
  if (bytes.length === 0) return null;

  const sniffed = sniffFormat(bytes);
  if (sniffed === 'wav') return measureWavDuration(bytes);
  if (sniffed === 'mp3') return measureMp3Duration(bytes);

  const fmt = format?.toLowerCase();
  if (fmt === 'wav' || fmt === 'x-wav' || fmt === 'wave') return measureWavDuration(bytes);
  if (fmt === 'mp3' || fmt === 'mpeg' || fmt === 'mpga') return measureMp3Duration(bytes);
  return null;
}
