#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { authForget, authLogin, authStatus } from './auth/actions.ts';
import { ALL_PLATFORMS, loadConfig, type PlatformId } from './core/config.ts';
import { createContext } from './core/context.ts';
import { safeError } from './core/errors.ts';
import { ACCOUNT_KINDS, accountLabel, backendLabel, readPasswordHidden, type AccountKind } from './core/keychain.ts';
import { createRuntime, PLATFORM_LABELS } from './platforms/index.ts';
import { PtaClient } from './platforms/pta/client.ts';
import { XxtClient } from './platforms/xxt/client.ts';

const USAGE = `用法: dsh-zhiyun-source-omni <命令>

  configure [zju|webvpn|cc98|xxt]  把账号存入本机凭据库（默认 zju，浙大统一认证）
  login [平台]                     立即登录指定平台（默认 xzzd）
  status [--check]                 查看凭据、会话；--check 对已有会话做只读验证
  forget [平台] [--credentials]    删除会话；--credentials 同时删除本机保存的凭据
  pta-cookie                       从标准输入导入拼题A Cookie
  xxt-cookie                       从标准输入导入学习通 Cookie

平台: ${ALL_PLATFORMS.join(', ')}

凭据后端（本机）: ${backendLabel()}`;

function print(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function platformArg(value: string | undefined, fallback?: PlatformId): PlatformId | undefined {
  if (!value || value.startsWith('--')) return fallback;
  if (!(ALL_PLATFORMS as readonly string[]).includes(value)) throw new Error(`未知平台：${value}`);
  return value as PlatformId;
}

async function configure(kindArg: string | undefined) {
  const kind = (kindArg ?? 'zju') as AccountKind;
  if (!(ACCOUNT_KINDS as readonly string[]).includes(kind)) throw new Error(`未知账号类型：${kind}。可选：${ACCOUNT_KINDS.join(', ')}`);
  if (!process.stdin.isTTY) throw new Error('请在你自己的终端里运行此命令。不要把密码粘贴到 AI 对话中。');
  const cfg = loadConfig();
  const ctx = createContext(cfg);
  // 移植改造：上游在这里硬性要求 macOS 钥匙串，本仓按平台选后端
  // （Windows 走 DPAPI，见 core/keychain.ts 的文件头）。
  const backend = backendLabel();
  if (!ctx.accounts.hasNativeBackend) {
    throw new Error(`本平台（${process.platform}）没有可用的凭据保管后端。请通过受保护的启动环境提供账号变量。`);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const username = (await rl.question(`${accountLabel(kind)}账号：`)).trim();
  rl.close();
  if (!username || username.length > 200 || /[\x00-\x1f]/.test(username)) throw new Error('账号格式无效。');
  process.stdout.write(`下面输入密码（不显示字符），保存到${backend}。\n`);
  const password = process.platform === 'win32'
    ? await readPasswordHidden('密码：')
    : await rl.question('密码：').catch(() => '');
  if (!password) throw new Error('未读到密码，账号配置未改变。');
  await ctx.accounts.save(kind, username, password);
  const stale: string[] = kind === 'zju' ? ['xzzd', 'zdbk', 'zhiyun', 'webvpn'] : [kind];
  for (const name of stale) await ctx.sessions.remove(name);
  process.stdout.write(`已配置${accountLabel(kind)}账号（${backend}）。回到客户端即可自动登录；也可以运行 npm run login 验证。\n`);
}

/**
 * 列出启用的平台及其数据能力。
 *
 * 上游这里是 `tools [full|lite]`：走 MCP 协议列出工具目录与体积。本包不做工具层，
 * 所以换成「列出平台 + 该平台读取器上可用的方法」—— 消费方（页面 / AI / 脚本）
 * 拿到的是**函数**，这里如实列出有哪些函数可用。
 */
function catalog() {
  const cfg = loadConfig();
  const runtime = createRuntime(createContext(cfg));
  const readers: Record<string, string[]> = {};
  const collect = (name: string, reader: object | undefined) => {
    if (!reader) return;
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(reader))
      .filter(key => key !== 'constructor' && typeof (reader as any)[key] === 'function')
      .sort();
    readers[name] = methods;
  };
  collect('xzzd', runtime.xzzd?.reader);
  collect('zdbk', runtime.zdbk?.reader);
  collect('zhiyun', runtime.zhiyun?.reader);
  collect('pta', runtime.pta?.reader);
  collect('cc98', runtime.cc98?.reader);
  collect('xxt', runtime.xxt?.reader);
  print({
    package: 'dsh-zhiyun-source-omni',
    platforms: [...cfg.platforms].map(id => ({ id, name: PLATFORM_LABELS[id], enabled: true })),
    available: readers,
    note: '本包是数据包：上面列出的都是可直接 import 调用的数据函数，不作为 AI 工具注册。',
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'configure':
      return configure(args[0]);
    case 'login': {
      const runtime = createRuntime(createContext(loadConfig()));
      return print(await authLogin(runtime, platformArg(args[0], 'xzzd')!));
    }
    case 'status': {
      const runtime = createRuntime(createContext(loadConfig()));
      return print(await authStatus(runtime, { check: args.includes('--check') }));
    }
    case 'forget': {
      const runtime = createRuntime(createContext(loadConfig()));
      return print(await authForget(runtime, { platform: platformArg(args[0]), remove_credentials: args.includes('--credentials') }));
    }
    case 'tools':
      return catalog();
    case 'xxt-cookie': {
      if (process.stdin.isTTY) throw new Error('请通过管道传入，例如：pbpaste | npm run cli -- xxt-cookie');
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      const xxt = new XxtClient(createContext(loadConfig()));
      const saved = await xxt.importCookie(Buffer.concat(chunks).toString('utf8'));
      const check = await xxt.checkLogin().catch(e => ({ authenticated: false, reason: safeError(e).code }));
      return print({ imported_from: saved.source, cookie_names: saved.cookie_names, missing_required: saved.missing_required, ...check });
    }
    case 'pta-cookie': {
      if (process.stdin.isTTY) throw new Error('请通过管道传入，例如：pbpaste | npm run cli -- pta-cookie');
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      const ctx = createContext(loadConfig());
      const pta = new PtaClient(ctx);
      const saved = await pta.importCookie(Buffer.concat(chunks).toString('utf8'));
      const check = await pta.check().catch(e => ({ authenticated: false, reason: safeError(e).code }));
      return print({ imported_from: saved.source, cookie_names: saved.cookie_names, ...check });
    }
    default:
      process.stdout.write(`${USAGE}\n`);
      if (command && command !== 'help' && command !== '--help') process.exitCode = 2;
  }
}

try {
  await main();
} catch (e) {
  const error = safeError(e);
  process.stderr.write(`${error.code === 'INTERNAL_ERROR' && e instanceof Error ? e.message : JSON.stringify(error, null, 2)}\n`);
  process.exitCode = 1;
}
