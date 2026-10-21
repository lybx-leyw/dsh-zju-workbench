import { CookieJar } from 'tough-cookie';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import { ClassroomError } from './errors.js';

// Windows user-bound DPAPI: plaintext only travels over anonymous pipes, never
// command arguments, environment variables or a temporary plaintext file.
export async function dpapi(bytes, decrypt = false) {
  if (process.platform !== 'win32') throw new ClassroomError('STORAGE', '持久化会话需要 Windows DPAPI 或自定义保护器');
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; try { $v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r)) } catch { exit 1 }`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => reject(new ClassroomError('STORAGE', '无法启动会话保护器')));
    child.on('close', code => code === 0 ? resolve(Buffer.from(output.trim(), 'base64')) : reject(new ClassroomError('STORAGE', '会话保护器失败')));
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(bytes).toString('base64'));
  });
}

export class SessionStore {
  constructor({ file, protect = dpapi } = {}) {
    this.file = file; this.protect = protect; this.jar = new CookieJar(); this.pending = Promise.resolve(); this.epoch = 0;
    /**
     * 待落盘的防抖定时器。
     *
     * # 为什么必须防抖（2026-10-21 实测）
     *
     * `protect()` 会 spawn 一个 `powershell.exe` 做 DPAPI 加密，**单次约 1249ms**
     * （本机实测）。而 `Transport.request` 在**每个**带 `Set-Cookie` 的响应后都会
     * `await save()` —— 一次逐课待办有几十个请求，于是每次都白等一秒钟，
     * 且因为 `this.pending` 串行化，这些保存还会互相排队。
     *
     * 真机数据：42 个请求、单请求 p50 = 2112ms、总计 48 秒。其中约 1.2 秒/请求
     * 是这个子进程。对照 `zju-mcp`：它用内存会话、**不落盘**，所以几秒就返回。
     *
     * 修法不是"不保存"（那样重启就得重登），而是**把保存挪出请求路径**：
     * 请求照常返回，落盘延迟 N 毫秒合并成一次。
     */
    this.saveTimer = null;
    this.saveDelayMs = 1500;
  }
  async load() {
    if (!this.file) return;
    let bytes;
    try { bytes = await readFile(this.file); } catch (error) { if (error.code === 'ENOENT') return; throw new ClassroomError('STORAGE', '无法读取会话文件'); }
    try { const saved = JSON.parse((await this.protect(bytes, true)).toString('utf8')); this.jar = CookieJar.deserializeSync(saved); this.accountKey = saved.accountKey ?? null; }
    catch { throw new ClassroomError('STORAGE', '会话无法解密或已损坏，请清除后重新登录'); }
  }
  save() {
    if (!this.file) return Promise.resolve();
    const snapshot = JSON.stringify({ ...this.jar.serializeSync(), accountKey: this.accountKey ?? null });
    const operation = this.pending.catch(() => {}).then(async () => {
      const encrypted = await this.protect(Buffer.from(snapshot));
      // 会话文件写在 Windows 上，手写 `writeFile` + `rename` 会撞上瞬态
      // EACCES/EBUSY/EPERM；用宿主的原子替换（含重试）并钉住 0600。
      // ⚠️ 依旧写**原始二进制**（DPAPI 密文），不改成 base64：
      //    磁盘格式一变，用户已有会话就报废、被迫重新登录。
      await writeFileAtomic(this.file, encrypted, { mode: 0o600, dirMode: 0o700 });
    });
    this.pending = operation;
    return operation;
  }

  /**
   * 把「保存」推迟到这一批请求做完之后 —— **不阻塞请求**。
   *
   * 与 `save()` 的区别：`save()` 返回一个要 `await` 的 Promise（调用方会等），
   * 这个方法立刻返回，把真正的落盘交给定时器。
   *
   * 为什么这样安全：落盘的只是 **cookie jar 的快照**。同一进程内会话在内存里
   * 一直是最新的，磁盘副本只服务于"下次启动"。延迟 1.5 秒合并写一次，
   * 唯一代价是"进程恰好在延迟窗口内崩溃"会丢掉这一批 cookie —— 而那时
   * 用户重登一次即可，不至于像旧实现那样每个请求都白等一秒。
   *
   * @returns 立刻 resolve（真正的落盘在后台）。
   */
  scheduleSave() {
    if (!this.file) return Promise.resolve();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      // 落盘失败不该抛出到没人接的地方：它只影响"下次启动要不要重登"
      this.save().catch(() => {});
    }, this.saveDelayMs);
    // 不阻塞进程退出（Node 默认会等定时器，这里显式放行）
    this.saveTimer.unref?.();
    return Promise.resolve();
  }

  /** 立刻把挂起的保存刷下去（进程退出前、或需要落盘保证时调用）。 */
  async flush() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    await this.save().catch(() => {});
  }

  async clear() { this.epoch++; await this.jar.removeAllCookies(); await this.save(); }
}
