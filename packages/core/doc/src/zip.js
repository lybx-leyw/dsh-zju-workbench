/**
 * 只读 ZIP 解析（读 OOXML 文档里我们真正要的那几个 XML 部件）。
 *
 * # 为什么自己写，不用 JSZip
 *
 * 本包只需要「打开一个 docx / xlsx / pptx，取出几个明文 XML」这一件事。为它引
 * 一个完整 ZIP 库，等于让文档取字这条链多一个需要跟着升级、且要写进锁文件的依赖；
 * 而 ZIP 的**只读中央目录**格式只有几十行（stored / deflate 两种方法覆盖了
 * Office 的全部产出）。
 *
 * # 边界
 *
 * 加密、zstd、分卷、ZIP64 一律不支持 —— 遇到就**报错**，不猜。单条与总的解压量
 * 都有上限，防止「4 KB 的 zip 解出 4 GB」。这两条不是洁癖：输入来自用户下载的
 * 附件，它是不可信数据。
 *
 * @module @lybx-leyw/dsh-zju-core-doc/zip
 */

import { inflateRawSync } from 'node:zlib';

import { readFailed } from './errors.js';

/** 单个 zip 的字节上限。 */
export const MAX_ZIP_BYTES = 256 * 1024 * 1024;
/** 条目数上限。 */
export const MAX_ZIP_ENTRIES = 10_000;
/** 单条解压后上限（XML 部件用不到这么大，留足余量）。 */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** 全部条目解压后的总量上限。 */
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** EOCD 在文件尾部（注释最长 65535 字节），从后往前找。 */
function findEocd(buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  for (let at = buffer.length - 22; at >= start; at -= 1) {
    if (buffer.readUInt32LE(at) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

/**
 * 读中央目录。
 *
 * @param {Buffer} buffer 整个 zip 的字节。
 * @returns {Map<string, {name: string, method: number, compressedSize: number,
 *   uncompressedSize: number, localOffset: number}>}
 */
function readCentralDirectory(buffer) {
  if (buffer.length > MAX_ZIP_BYTES) {
    throw readFailed(`压缩包超过 ${MAX_ZIP_BYTES} 字节上限`, { bytes: buffer.length });
  }
  const eocd = findEocd(buffer);
  if (eocd < 0) throw readFailed('压缩包结构非法：找不到中央目录结尾');

  const count = buffer.readUInt16LE(eocd + 10);
  const offset = buffer.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES) throw readFailed(`压缩包条目数 ${count} 超过上限`);

  const entries = new Map();
  let at = offset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL_SIGNATURE) {
      throw readFailed('压缩包结构非法：中央目录条目损坏');
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const uncompressedSize = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * 解压单条。
 *
 * @param {Buffer} buffer 整个 zip。
 * @param {object} entry 中央目录里的一条。
 * @returns {Buffer} 解压后的字节。
 */
function readEntry(buffer, entry) {
  const at = entry.localOffset;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== LOCAL_SIGNATURE) {
    throw readFailed(`压缩包条目「${entry.name}」的本地头损坏`);
  }
  const nameLength = buffer.readUInt16LE(at + 26);
  const extraLength = buffer.readUInt16LE(at + 28);
  const start = at + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw readFailed(`压缩包条目「${entry.name}」越界`);
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw readFailed(`压缩包条目「${entry.name}」声明 ${entry.uncompressedSize} 字节，超过上限`);
  }

  const raw = buffer.subarray(start, end);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_BYTES });
  throw readFailed(`压缩包条目「${entry.name}」的压缩方式 ${entry.method} 不支持（只支持 stored/deflate）`);
}

/**
 * 打开一个内存里的压缩包，按名字取条目。
 *
 * 惰性解压：只有被 `text()` / `bytes()` 取到的条目才会解压，所以「一个 40 MB 的
 * docx 里有 30 MB 图片」不会因为我们要读 `word/document.xml` 就全部展开。
 *
 * @param {Buffer} buffer 整个 zip 的字节。
 * @returns {{names: () => string[], has: (name: string) => boolean, bytes: (name: string) => Buffer|undefined,
 *   text: (name: string) => string|undefined, match: (pattern: RegExp) => string[]}}
 */
export function openZip(buffer) {
  const entries = readCentralDirectory(buffer);
  let extracted = 0;

  const bytes = (name) => {
    const entry = entries.get(name);
    if (entry === undefined) return undefined;
    const data = readEntry(buffer, entry);
    extracted += data.byteLength;
    if (extracted > MAX_TOTAL_BYTES) throw readFailed('压缩包解压总量超过上限');
    return data;
  };

  return {
    names: () => [...entries.keys()],
    has: (name) => entries.has(name),
    bytes,
    text: (name) => bytes(name)?.toString('utf8'),
    /** 名字匹配某模式的全部条目，按名字排序（决定 PPT 幻灯片顺序时要用）。 */
    match: (pattern) => [...entries.keys()].filter((name) => pattern.test(name)).sort(),
  };
}
