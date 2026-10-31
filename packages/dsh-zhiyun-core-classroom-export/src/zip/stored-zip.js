/**
 * 最小 ZIP 写入器：全部条目 stored（不压缩）。
 *
 * 源：ref/OpenMAIC/lib/export/standalone-html/stored-zip.ts:1-183
 *
 * 上游为什么要它：JSZip 会把每个输入 Blob 读成 ArrayBuffer，再把输出拼成
 * 一个大 ArrayBuffer —— 大包在标签页里占好几份内存。这里的媒体（MP3/MP4）
 * 本来就压缩过，stored 不损失体积，而每个条目只需要 CRC-32。
 *
 * 移植差别只有一处：上游返回 `Blob`（按块引用原 Blob），服务端没有 Blob 的
 * 流式优势，因此直接返回 `Buffer`。ZIP 结构、字段顺序、UTF-8 标志位、
 * ZIP64 哨兵判定全部照旧 —— 解压器（含 `unzip`/JSZip）读出来的东西不变。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** 源：stored-zip.ts:56-62 */
export function crc32(bytes, crc = 0) {
  let c = ~crc >>> 0;
  for (let index = 0; index < bytes.length; index++) {
    c = CRC_TABLE[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  }
  return ~c >>> 0;
}

/** 源：stored-zip.ts:38 */
export const STORED_ZIP_MAX_BYTES = 0xfffffffe;
/** 源：stored-zip.ts:41 */
export const STORED_ZIP_MAX_ENTRIES = 0xfffe;

/** 源：stored-zip.ts:78-81 */
export function isSafeArchivePath(path) {
  if (!path || /[\\:\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** 源：stored-zip.ts:83-89 */
function dosDateTime(date) {
  const year = Math.min(Math.max(date.getFullYear(), 1980), 2107);
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const FLAG_UTF8 = 0x0800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = (3 << 8) | VERSION_NEEDED;
const UNIX_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;

/**
 * 源：stored-zip.ts:103-183 —— 条目按给定顺序写入。
 * @param {{path:string, data:Buffer|Uint8Array|string}[]} entries
 * @param {{date?:Date}} [options]
 * @returns {Buffer}
 */
export function buildStoredZip(entries, options = {}) {
  if (entries.length > STORED_ZIP_MAX_ENTRIES) throw new Error('Stored ZIP: too many entries');
  const stamp = dosDateTime(options.date ?? new Date());
  const encoder = new TextEncoder();
  const seen = new Set();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    if (!isSafeArchivePath(entry.path)) {
      throw new Error(`Stored ZIP: unsafe entry path ${JSON.stringify(entry.path)}`);
    }
    if (seen.has(entry.path)) throw new Error(`Stored ZIP: duplicate entry ${entry.path}`);
    seen.add(entry.path);
    const data =
      typeof entry.data === 'string'
        ? Buffer.from(entry.data, 'utf8')
        : Buffer.isBuffer(entry.data)
          ? entry.data
          : Buffer.from(entry.data);
    const name = encoder.encode(entry.path);
    if (name.length > 0xffff) throw new Error('Stored ZIP: entry path too long');
    if (offset + 30 + name.length + data.size > STORED_ZIP_MAX_BYTES) {
      throw new Error('Stored ZIP: archive exceeds 4 GiB');
    }
    const crc = crc32(data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    Buffer.from(name).copy(local, 30);

    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(VERSION_MADE_BY, 4);
    header.writeUInt16LE(VERSION_NEEDED, 6);
    header.writeUInt16LE(FLAG_UTF8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    // extra 长度 / 注释长度 / 磁盘号 / 内部属性都留 0（源同一处理）。
    header.writeUInt32LE(UNIX_FILE_ATTRIBUTES, 38);
    header.writeUInt32LE(offset, 42);
    Buffer.from(name).copy(header, 46);
    central.push(header);

    parts.push(local, data);
    offset += local.length + data.length;
  }

  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  if (offset + centralSize + 22 > STORED_ZIP_MAX_BYTES) {
    throw new Error('Stored ZIP: archive exceeds 4 GiB');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}
