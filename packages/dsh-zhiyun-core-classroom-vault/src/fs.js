/**
 * 文件系统原语：原子替换、可降级的 JSON 读、进程内 / 跨进程写锁。
 *
 * 源：ref/OpenMAIC/packages/@openmaic/storage/src/document/pg.ts:262-300
 *     ref/OpenMAIC/lib/store/stage.ts:96-118（写失败退避的语义）
 *
 * 原子性照 `@deepseek-ai/dsh-atomic-write@0.2.0` 的 `writeFileAtomic` /
 * `withFileLock` 语义实现，但**不引依赖**（本包不加 npm 依赖）：
 *
 * - 同目录随机后缀临时文件用 `wx` 独占创建，拒绝跟随预置在临时路径上的符号链接；
 * - 写完 `rename` 覆盖目标：读者只能看到旧内容或完整新内容，永不看到半截；
 * - rename 发生在同一文件系统（同目录兄弟文件），目标位置的符号链接被替换本身；
 * - 失败时删除临时文件并原样抛出，目标文件保持不变；
 * - 刻意 **不 fsync**：与上游同取舍，崩溃后可能回退一次 rename，持久性归调用方。
 */

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** 锁等待超时。与上游默认值一致（2s），单文件工作量级足够。 */
const DEFAULT_LOCK_WAIT_MS = 2000;
const LOCK_RETRY_INITIAL_MS = 20;
const LOCK_RETRY_MAX_MS = 200;

/** 锁文件写不进去（等待超时 / 父目录非法）。 */
export class VaultLockError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'VaultLockError';
    this.code = 'E_LOCK_TIMEOUT';
    if (detail !== undefined) this.detail = detail;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 原子替换一个文件。
 *
 * @param {string} file 最终路径
 * @param {string|Uint8Array} content 完整的新内容（字符串或二进制）
 * @param {{ mode?: number }} [options] 替换 inode 的权限位，默认 0o600
 */
export async function writeFileAtomic(file, content, options = {}) {
  const mode = options.mode ?? 0o600;
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temp, content, { mode, flag: 'wx' });
    await rename(temp, file);
  } catch (error) {
    // 临时文件清理失败不该盖住真正的错误。
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

/** 原子写一份 JSON（两个空格缩进 + 结尾换行，便于 diff 与人工排查）。 */
export async function writeJsonAtomic(file, value) {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 读一份 JSON，**永不抛**。
 *
 * 返回值刻意区分三种结果 —— 「文件不在」「读失败」「内容不是 JSON」在业务上
 * 是三件事：不存在的课堂可以新建，损坏的课堂必须降级并留下痕迹，
 * 权限错误要进 `status().detail` 而不是被当成"空"。
 *
 * @returns {{ ok: true, value: unknown } | { ok: false, code: 'ENOENT'|'E_CORRUPT'|'E_IO', error?: Error }}
 */
export async function readJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, code: 'ENOENT' };
    return { ok: false, code: 'E_IO', error };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, code: 'E_CORRUPT', error };
  }
}

/** 列目录，目录不存在时给空数组（不把 ENOENT 当错误）。 */
export async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return [];
    throw error;
  }
}

/** 文件是否存在（`stat` 而非 `access`：目录也会返回 true）。 */
export async function pathExists(path) {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    return error?.code !== 'ENOENT';
  }
}

/**
 * 进程内按 key 串行化。
 *
 * 上游用 `BEGIN … COMMIT` 把「读-改-写」关进一个事务；文件系统没有事务，
 * 同进程内的竞态只能靠队列消掉。跨进程那半由 {@link withFileLock} 负责。
 */
const lockTails = new Map();

export function withKeyLock(key, work) {
  const previous = lockTails.get(key) ?? Promise.resolve();
  const next = previous.then(work, work);
  // 队列里存的是"已消化拒绝"的版本：否则一次失败会让后续所有等待者
  // 收到未处理的 rejection（Node 会直接因为 unhandledRejection 退出）。
  lockTails.set(key, next.then(() => {}, () => {}));
  return next;
}

/** 锁记录里的持有者进程是否已经不在了（信号探测 ESRCH 才算，超时不算）。 */
function holderExited(record) {
  if (!/^\d+\n$/.test(record)) return false;
  const pid = Number(record.trim());
  if (pid === 0 || pid > 2147483647) return false;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
}

/**
 * 跨进程写锁：读-改-写循环期间持有 `<file>.lock`。
 *
 * 语义与上游一致：`wx` 创建锁文件并写入 PID，竞争者指数退避到 `waitMs` 上限；
 * 只有当锁记录的进程**已不存在**时才接管（绝不因文件"太老"而抢锁）。
 * 读者从不取锁 —— rename 提交本身是原子的。
 */
export async function withFileLock(file, work, options = {}) {
  const waitMs = options.waitMs ?? DEFAULT_LOCK_WAIT_MS;
  const lockPath = `${file}.lock`;
  await mkdir(dirname(file), { recursive: true });

  const deadline = Date.now() + waitMs;
  let delay = LOCK_RETRY_INITIAL_MS;
  for (;;) {
    try {
      await writeFile(lockPath, `${process.pid}\n`, { mode: 0o600, flag: 'wx' });
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error;
      if (await takeOverExitedLock(lockPath)) continue;
      if (Date.now() >= deadline) {
        throw new VaultLockError(`等待写锁超时：${lockPath}`, { lockPath, waitMs });
      }
      await sleep(delay);
      delay = Math.min(delay * 2, LOCK_RETRY_MAX_MS);
    }
  }

  try {
    return await work();
  } finally {
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

/** 接管一个持有者已退出的锁。只在记录未变且 PID 仍不存在时删除。 */
async function takeOverExitedLock(lockPath) {
  let record;
  try {
    record = await readFile(lockPath, 'utf8');
  } catch {
    return false;
  }
  if (!holderExited(record)) return false;
  try {
    await rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}
