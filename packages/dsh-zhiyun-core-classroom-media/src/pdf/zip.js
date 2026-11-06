// 源：ref/OpenMAIC/lib/pdf/mineru-cloud.ts:286-490（`JSZip.loadAsync` 的入口预算 +
//     `full.md` / `*_content_list.json` / `images/*` 的取用规则）
//
// 上游用 JSZip。**不新增 npm 依赖**，所以这里实现一个只读的 ZIP 解析：
// 从中央目录读条目，`stored`(0) 直接取、`deflate`(8) 用 `node:zlib` 解压。
// 加密 / zstd / 分卷一律不支持（MinerU 的产物只有前两种），遇到就明确报错。
//
// 安全边界与上游一致：入口数量、单条解压后字节、总解压字节都设上限，
// 防止"4 KB 的 zip 解出 4 GB"。

import { inflateRawSync } from 'node:zlib';
import { MediaError } from '../errors.js';

export const MAX_ZIP_BYTES = 256 * 1024 * 1024;
export const MAX_ZIP_ENTRY_COUNT = 10_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
export const MAX_ZIP_TEXT_ENTRY_BYTES = 64 * 1024 * 1024;
export const MAX_ZIP_IMAGE_ENTRY_BYTES = 32 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function findEocd(buffer) {
  // EOCD 在文件尾部，注释最长 65535 字节。
  const start = Math.max(0, buffer.length - 65_557);
  for (let i = buffer.length - 22; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

/**
 * 读一个 zip（内存中的完整字节）。
 *
 * @param {Buffer} buffer
 * @returns {Map<string, { name: string, method: number, compressedSize: number,
 *                          uncompressedSize: number, localOffset: number }>}
 */
function readCentralDirectory(buffer) {
  if (buffer.length > MAX_ZIP_BYTES) {
    throw new MediaError('E_UPSTREAM_ERROR', `zip 超过 ${MAX_ZIP_BYTES} 字节上限`, { retryable: false });
  }
  const eocd = findEocd(buffer);
  if (eocd < 0) throw new MediaError('E_INVALID_RESPONSE', 'zip 结构非法：找不到中央目录结尾');

  const entryCount = buffer.readUInt16LE(eocd + 10);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > MAX_ZIP_ENTRY_COUNT) {
    throw new MediaError('E_UPSTREAM_ERROR', `zip 条目数 ${entryCount} 超过上限 ${MAX_ZIP_ENTRY_COUNT}`);
  }

  const entries = new Map();
  let offset = directoryOffset;
  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new MediaError('E_INVALID_RESPONSE', 'zip 结构非法：中央目录条目损坏');
    }
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** 单条目的解压（带单条上限）。 */
function readEntryData(buffer, entry, capBytes) {
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) {
    throw new MediaError('E_INVALID_RESPONSE', `zip 条目 "${entry.name}" 的本地头损坏`);
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    throw new MediaError('E_INVALID_RESPONSE', `zip 条目 "${entry.name}" 越界`);
  }
  if (entry.uncompressedSize > capBytes) {
    throw new MediaError(
      'E_UPSTREAM_ERROR',
      `zip 条目 "${entry.name}" 声明 ${entry.uncompressedSize} 字节，超过 ${capBytes} 上限`,
    );
  }

  const raw = buffer.subarray(dataStart, dataEnd);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) {
    const out = inflateRawSync(raw, { maxOutputLength: Math.max(capBytes, 1) });
    return out;
  }
  throw new MediaError(
    'E_UNSUPPORTED_PROVIDER',
    `zip 条目 "${entry.name}" 的压缩方式 ${entry.method} 不支持（只支持 stored/deflate）`,
  );
}

/**
 * 把 zip 读成 `{ name → Buffer }`，全部按文本/图片两类上限分别设限。
 *
 * @param {Buffer} buffer
 * @param {{textOnly?: boolean}} [options]
 */
export function readZipEntries(buffer, options = {}) {
  const entries = readCentralDirectory(buffer);
  const files = new Map();
  let extractedBytes = 0;

  for (const entry of entries.values()) {
    if (entry.name.endsWith('/')) continue; // 目录
    const isImage = /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(entry.name);
    if (options.textOnly && isImage) continue;
    const cap = isImage ? MAX_ZIP_IMAGE_ENTRY_BYTES : MAX_ZIP_TEXT_ENTRY_BYTES;
    const data = readEntryData(buffer, entry, cap);
    extractedBytes += data.byteLength;
    if (extractedBytes > MAX_ZIP_UNCOMPRESSED_BYTES) {
      throw new MediaError(
        'E_UPSTREAM_ERROR',
        `zip 解压总量超过 ${MAX_ZIP_UNCOMPRESSED_BYTES} 字节上限`,
      );
    }
    files.set(entry.name, data);
  }
  return files;
}
