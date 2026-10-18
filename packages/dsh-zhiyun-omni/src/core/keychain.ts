/**
 * 账号凭据的存取（**移植改造点**）。
 *
 * # 与上游的差别（读这一节就够）
 *
 * 上游 `Vita0818/ZJU-Omni` 把凭据存进 **macOS 钥匙串**（调 `/usr/bin/security`），
 * 并在非 darwin 平台上直接抛 `CREDENTIAL_BACKEND_UNAVAILABLE`。也就是说上游在
 * Windows 上**只能**靠 `ZJU_USERNAME` / `ZJU_PASSWORD` 这类环境变量把密码摆在
 * 启动环境里。
 *
 * 本仓在 Windows 上运行，所以这里把「凭据保管」抽成一个**后端**，按平台选：
 *
 *   - `win32`  → **DPAPI**（`ProtectedData`，`CurrentUser` 范围）：密文落盘，
 *                只有同一台机器的同一用户能解开。与 `dsh-zhiyun-classroom`
 *                存智云会话用的是同一套办法，行为一致、也已在真机验证过。
 *   - `darwin` → 沿用上游的钥匙串实现（未改动），方便上游同步时对照。
 *   - 其他平台 → 只能靠环境变量，并给出明确指引。
 *
 * 环境变量**始终优先于**任何本地存储：用户显式导出的值最权威，也方便 CI 与临时换号。
 * 这一条与上游一致，不改。
 *
 * # 为什么不写成「Windows 就用环境变量」
 *
 * 那等于把密码明文留在 profile 的启动配置里（`cordis.patch.yml` 的 `env:` 段），
 * 任何能读该文件的人都能拿到。DPAPI 的密文则绑死在当前用户的凭据上 ——
 * 这是本仓既有的取舍（见 `dsh-zhiyun-classroom/src/session.js`），保持一致。
 */

import { execFile, spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { readFile, unlink } from 'node:fs/promises';
import { ToolError } from './errors.ts';
import { readJson, writePrivate } from './store.ts';

const exec = promisify(execFile);
const SECURITY = '/usr/bin/security';

export const ACCOUNT_KINDS = ['zju', 'webvpn', 'cc98', 'xxt'] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const KEYCHAIN_SERVICES: Record<AccountKind, string> = {
  zju: 'zju-omni.zjuam',
  webvpn: 'zju-omni.webvpn',
  cc98: 'zju-omni.cc98',
  xxt: 'zju-omni.xxt',
};

const ACCOUNT_LABELS: Record<AccountKind, string> = {
  zju: '浙大统一认证',
  webvpn: 'WebVPN 上网账号（非统一认证）',
  cc98: 'CC98',
  xxt: '学习通',
};

const ENV_NAMES: Record<AccountKind, [string, string]> = {
  zju: ['ZJU_USERNAME', 'ZJU_PASSWORD'],
  webvpn: ['WEBVPN_USERNAME', 'WEBVPN_PASSWORD'],
  cc98: ['CC98_USERNAME', 'CC98_PASSWORD'],
  xxt: ['XXT_USERNAME', 'XXT_PASSWORD'],
};

const LEGACY_TRONCLASS = { service: 'org.zju.tronclass.codex', dir: join(homedir(), '.local', 'share', 'zju-tronclass') };

export interface Credentials {
  username: string;
  password: string;
}

/** 凭据后端种类。写进 `accounts.json`，用来判断旧记录在当前平台是否还可用。 */
export type CredentialBackend = 'environment' | 'macos-keychain' | 'dpapi' | 'legacy-zju-tronclass' | 'host-credentials';

export interface AccountRecord {
  username: string;
  backend: 'macos-keychain' | 'dpapi';
  configured_at?: string;
}

export interface CredentialStatus {
  kind: AccountKind;
  configured: boolean;
  backend: CredentialBackend | null;
  username?: string;
}

export type SecurityRunner = (args: string[]) => Promise<string>;

const defaultRunner: SecurityRunner = async args => {
  const { stdout } = await exec(SECURITY, args, { timeout: 15000, maxBuffer: 65536 });
  return stdout;
};

type Env = Record<string, string | undefined>;

export interface AccountsOptions {
  env?: Env;
  runner?: SecurityRunner;
  legacyDir?: string | null;
  platform?: NodeJS.Platform;
  /** DPAPI 密文所在目录。默认与 `accounts.json` 同级。 */
  secretDir?: string;
  /**
   * 宿主凭据服务（`ctx.credentials`）的读取器。
   *
   * 本包原本只认自己那套 DPAPI，于是「用户在课堂登录了」和「omni 说没配账号」
   * 成了两件事。接入这个之后，**别处（`dsh-zhiyun-classroom`）存进宿主凭据的账号
   * 会被优先采用** —— 用户不需要为同一个浙大账号配两遍。
   *
   * 传 null / 不传表示宿主没有凭据服务，退回本包自己的后端。
   */
  hostCredentials?: HostCredentialReader | null;
}

/** 从宿主凭据服务读账号的最小接口（由调用方注入，避免 core 依赖 cordis）。 */
export interface HostCredentialReader {
  /** @returns `{ username, password }`，没配时 null。 */
  readAccount(): Promise<{ username: string; password: string } | null>;
}

/**
 * DPAPI 加解密（Windows）。
 *
 * 走**匿名管道**把明文交给 PowerShell，不经过命令行参数、环境变量或临时文件 ——
 * 命令行参数在 Windows 上对同机其他进程可见，临时明文文件更是会留在磁盘上。
 * 与 `dsh-zhiyun-classroom/src/session.js` 的做法一致。
 */
export function dpapi(bytes: Buffer, decrypt = false): Promise<Buffer> {
  if (process.platform !== 'win32') throw new ToolError('CREDENTIAL_BACKEND_UNAVAILABLE', 'DPAPI 仅在 Windows 上可用。');
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = 'Add-Type -AssemblyName System.Security; try { '
    + '$v=[Convert]::FromBase64String([Console]::In.ReadToEnd()); '
    + `$r=[Security.Cryptography.ProtectedData]::${operation}($v,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); `
    + '[Console]::Write([Convert]::ToBase64String($r)) } catch { exit 1 }';
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => reject(new ToolError('CREDENTIAL_BACKEND_UNAVAILABLE', '无法启动 DPAPI 保护器（powershell.exe 不可用）。')));
    child.on('close', code => (code === 0
      ? resolve(Buffer.from(output.trim(), 'base64'))
      : reject(new ToolError('CREDENTIALS_UNAVAILABLE', 'DPAPI 加解密失败；密文可能来自另一台机器或另一个 Windows 账号。'))));
    child.stdin.on('error', () => {});
    child.stdin.end(bytes.toString('base64'));
  });
}

export class Accounts {
  readonly file: string;
  private env: Env;
  private runner: SecurityRunner;
  private legacyDir: string | null;
  private platform: NodeJS.Platform;
  private secretDir: string;
  /** 宿主凭据读取器；null 表示宿主没装凭据服务。 */
  private host: HostCredentialReader | null;

  constructor(dataDir: string, options: AccountsOptions = {}) {
    this.file = join(dataDir, 'accounts.json');
    this.secretDir = options.secretDir ?? join(dataDir, 'credentials');
    this.env = options.env ?? process.env;
    this.runner = options.runner ?? defaultRunner;
    this.legacyDir = options.legacyDir === undefined ? LEGACY_TRONCLASS.dir : options.legacyDir;
    this.platform = options.platform ?? process.platform;
    this.host = options.hostCredentials ?? null;
  }

  /** 当前平台可用的本地后端。null 表示只能用环境变量。 */
  private get nativeBackend(): 'macos-keychain' | 'dpapi' | null {
    if (this.platform === 'darwin') return 'macos-keychain';
    if (this.platform === 'win32') return 'dpapi';
    return null;
  }

  /** 本平台是否有本地凭据后端（没有就只能靠环境变量）。CLI 用它决定要不要拒绝配置。 */
  get hasNativeBackend(): boolean {
    return this.nativeBackend !== null;
  }

  private secretPath(kind: AccountKind): string {
    return join(this.secretDir, `${kind}.dpapi`);
  }

  private async records(): Promise<Partial<Record<AccountKind, AccountRecord>>> {
    return (await readJson<Partial<Record<AccountKind, AccountRecord>>>(this.file)) ?? {};
  }

  private async legacy(): Promise<{ username: string } | null> {
    if (!this.legacyDir) return null;
    const account = await readJson<{ username?: string; backend?: string }>(join(this.legacyDir, 'account.json')).catch(() => null);
    return account?.username && account.backend === 'macos-keychain' ? { username: account.username } : null;
  }

  async status(kind: AccountKind): Promise<CredentialStatus> {
    const [userVar, passVar] = ENV_NAMES[kind];
    if (this.env[userVar] && this.env[passVar]) return { kind, configured: true, backend: 'environment', username: this.env[userVar] };

    // 宿主凭据优先于本包自己的 DPAPI：用户在「个人」页登录课堂时，
    // `dsh-zhiyun-classroom` 会把账号写进宿主凭据。同一个浙大账号不该被要两次。
    if (this.host) {
      try {
        const shared = await this.host.readAccount();
        if (shared?.username && shared.password) {
          return { kind, configured: true, backend: 'host-credentials', username: shared.username };
        }
      } catch {
        // 宿主凭据不可读就继续走本包的老路径，不把错误抛给用户
      }
    }

    const record = (await this.records())[kind];
    // 记录的后端必须与当前平台一致：把 macOS 上配好的 accounts.json 拷到 Windows 后，
    // 记录还在、密文却不可解 —— 那种状态要如实报「未配置」，而不是让用户撞解密失败。
    if (record?.username && record.backend === this.nativeBackend) {
      return { kind, configured: true, backend: record.backend, username: record.username };
    }
    if (kind === 'zju') {
      const legacy = await this.legacy();
      if (legacy) return { kind, configured: true, backend: 'legacy-zju-tronclass', username: legacy.username };
    }
    return { kind, configured: false, backend: null };
  }

  async load(kind: AccountKind): Promise<Credentials> {
    const [userVar, passVar] = ENV_NAMES[kind];
    if (this.env[userVar] && this.env[passVar]) return { username: this.env[userVar]!, password: this.env[passVar]! };

    // 宿主凭据（课堂登录时写入）—— 这就是「登录一次，两边都能用」的实现。
    if (this.host) {
      try {
        const shared = await this.host.readAccount();
        if (shared?.username && shared.password) return shared;
      } catch {
        // 落到本包自己的后端
      }
    }

    const status = await this.status(kind);
    if (!status.configured || !status.username) {
      throw new ToolError('CONFIGURATION_REQUIRED', `请先在本机终端运行 npm run configure -- ${kind}，把${ACCOUNT_LABELS[kind]}账号存入本机凭据库。只需配置一次，不要在对话中发送密码。`, {
        account: kind,
        setup_command: `npm run configure -- ${kind}`,
      });
    }

    if (status.backend === 'macos-keychain' || status.backend === 'legacy-zju-tronclass') {
      const service = status.backend === 'legacy-zju-tronclass' ? LEGACY_TRONCLASS.service : KEYCHAIN_SERVICES[kind];
      try {
        const stdout = await this.runner(['find-generic-password', '-s', service, '-a', status.username, '-w']);
        const password = stdout.replace(/\r?\n$/, '');
        if (!password) throw new Error('empty');
        return { username: status.username, password };
      } catch {
        throw new ToolError('CREDENTIALS_UNAVAILABLE', `无法读取${ACCOUNT_LABELS[kind]}的钥匙串凭据。请运行 npm run configure -- ${kind} 重新配置，或检查钥匙串访问权限。`, { account: kind });
      }
    }

    if (status.backend === 'dpapi') {
      let bytes: Buffer;
      try {
        bytes = await readFile(this.secretPath(kind));
      } catch (e: any) {
        if (e?.code === 'ENOENT') {
          throw new ToolError('CREDENTIALS_UNAVAILABLE', `${ACCOUNT_LABELS[kind]}的凭据文件缺失，请运行 npm run configure -- ${kind} 重新配置。`, { account: kind });
        }
        throw e;
      }
      try {
        const plain = await dpapi(Buffer.from(bytes.toString('utf8').trim(), 'base64'), true);
        const parsed = JSON.parse(plain.toString('utf8')) as Credentials;
        if (!parsed?.username || typeof parsed.password !== 'string') throw new Error('shape');
        return { username: parsed.username, password: parsed.password };
      } catch (error) {
        if (error instanceof ToolError) throw error;
        throw new ToolError('CREDENTIALS_UNAVAILABLE', `${ACCOUNT_LABELS[kind]}的凭据无法解密（可能被复制到了别的机器或 Windows 账号下）。请运行 npm run configure -- ${kind} 重新配置。`, { account: kind });
      }
    }

    // 走到这里说明本平台没有本地后端（linux 等），只能靠环境变量。
    throw new ToolError('CREDENTIAL_BACKEND_UNAVAILABLE',
      `本平台（${this.platform}）没有可用的凭据保管后端；请通过受保护的启动环境提供 ${userVar} 和 ${passVar}。`);
  }

  async record(kind: AccountKind, username: string): Promise<void> {
    const backend = this.nativeBackend;
    if (!backend) throw new ToolError('CREDENTIAL_BACKEND_UNAVAILABLE', `本平台（${this.platform}）没有可用的凭据保管后端。`);
    const records = await this.records();
    records[kind] = { username, backend, configured_at: new Date().toISOString() };
    await writePrivate(this.file, records);
  }

  /**
   * 写入一份凭据（密文落盘），并记下账号名。
   *
   * `accounts.json` 只存账号名与后端种类，密码进密文文件 —— 两个文件都能随便看，
   * 泄露不了密码。上游对应的做法是把密码交给 `security` 存钥匙串，这里在 Windows
   * 上换成 DPAPI。
   */
  async save(kind: AccountKind, username: string, password: string): Promise<void> {
    const backend = this.nativeBackend;
    if (backend === 'dpapi') {
      const encrypted = await dpapi(Buffer.from(JSON.stringify({ username, password }), 'utf8'));
      await writePrivate(this.secretPath(kind), encrypted.toString('base64'));
    } else if (backend === 'macos-keychain') {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(SECURITY, ['add-generic-password', '-U', '-a', username, '-s', KEYCHAIN_SERVICES[kind], '-w', password], { stdio: 'ignore' });
        child.on('exit', code => (code === 0 ? resolve() : reject(new ToolError('CREDENTIALS_UNAVAILABLE', '钥匙串写入失败。'))));
        child.on('error', () => reject(new ToolError('CREDENTIALS_UNAVAILABLE', '无法调用 security 写入钥匙串。')));
      });
    } else {
      throw new ToolError('CREDENTIAL_BACKEND_UNAVAILABLE', `本平台（${this.platform}）没有可用的凭据保管后端。`);
    }
    await this.record(kind, username);
  }

  async remove(kind: AccountKind): Promise<boolean> {
    const records = await this.records();
    const record = records[kind];
    if (!record) return false;
    if (record.backend === 'macos-keychain') {
      try {
        await this.runner(['delete-generic-password', '-s', KEYCHAIN_SERVICES[kind], '-a', record.username]);
      } catch (e: any) {
        if (e?.code !== 44) throw new ToolError('KEYCHAIN_REMOVE_FAILED', '账号记录可以移除，但钥匙串项目未能删除。请在“钥匙串访问”中手动删除。', { service: KEYCHAIN_SERVICES[kind] });
      }
    }
    if (record.backend === 'dpapi') {
      // 密文删不掉不算失败（账号记录已经不认它了），但要让用户知道磁盘上可能还有残留。
      await unlink(this.secretPath(kind)).catch((e: any) => {
        if (e?.code !== 'ENOENT') throw new ToolError('CREDENTIAL_REMOVE_FAILED', `账号记录可以移除，但密文文件未能删除：${this.secretPath(kind)}`);
      });
    }
    delete records[kind];
    await writePrivate(this.file, records);
    return true;
  }
}

/** 供 CLI 复用：提示语里要写出这个平台实际用的后端。 */
export function backendLabel(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return 'macOS 钥匙串';
  if (platform === 'win32') return 'Windows 凭据保护（DPAPI）';
  return '环境变量';
}

/**
 * 在用户自己的终端里**不回显**地读一次密码（Windows）。
 *
 * 为什么不让 Node 自己读 stdin：Windows 上 Node 没有跨平台的关回声 API，
 * 手搓 raw mode 会把退格、方向键一并暴露出来。交给 PowerShell 的
 * `Read-Host -AsSecureString` 更稳妥 —— 它是系统自带的隐藏输入。
 *
 * 密码经**匿名管道**回到本进程（不是命令行参数、不落临时文件），随即交给
 * DPAPI 加密。用完的明文只活在内存里。
 */
export function readPasswordHidden(prompt: string): Promise<string> {
  const script = 'try { '
    + `[Console]::Error.Write(${JSON.stringify(prompt)}); `
    + '$s=Read-Host -AsSecureString; '
    + '$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); '
    + 'try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)) } '
    + 'finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) } '
    + '} catch { exit 1 }';
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => reject(new ToolError('CREDENTIAL_BACKEND_UNAVAILABLE', '无法启动 powershell.exe 读取密码。')));
    child.on('close', code => (code === 0
      ? resolve(output.replace(/\r?\n$/, ''))
      : reject(new ToolError('CREDENTIALS_UNAVAILABLE', '未读到密码，账号配置未改变。'))));
  });
}

export function accountLabel(kind: AccountKind): string {
  return ACCOUNT_LABELS[kind];
}
