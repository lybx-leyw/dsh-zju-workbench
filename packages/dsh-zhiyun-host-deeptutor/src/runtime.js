/**
 * DeepTutor 宿主 Python 运行时桥（Node 侧）。
 *
 * 契约真源：`packages/dsh-zhiyun-host-deeptutor/docs/contracts.md`
 * - §2 解释器解析优先级（recorded → env → managed venv → py launcher）
 * - §3 NDJSON RPC（Node→Python 请求 id `c<N>`，Python→Node 反向请求 id `s<N>`）
 * - §7 状态枚举 / §9 错误 taxonomy
 * - §13 本文件导出：PythonBridge / resolvePython / probeVendorDeps / ndjsonReader
 *
 * # 三条设计约束（不是风格偏好）
 *
 * 1. **全文件只有一处 `spawn`**（`spawnProcess`）。所有起进程的地方都走它，
 *    这样「注入假 spawn 做测试」才真能覆盖全部路径。散落的 `spawn(` 会让测试
 *    变绿而生产路径没被测到 —— 那是最坏的一种绿。
 * 2. **传输层可注入**。生产是 stdio 管道；某些受限沙箱里 `spawn` 带
 *    `stdio:'pipe'` 直接 EPERM（不能开命名管道），所以另有 `ndjson-over-files`
 *    调试传输。默认 `'auto'`：先试管道，撞 EPERM 降级并**记一条 warn** ——
 *    降级是事实，得让人看得见，不能悄悄发生。
 * 3. **路径只运行时解析**。解释器、vendor、home 全部来自调用方上下文或运行时
 *    探测结果，绝不写死开发者机器上的绝对路径。
 */

import { spawn as nodeSpawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { closeSync, openSync, writeSync } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';

import { DeepTutorError, METHODS, PROTOCOL_VERSION } from './protocol.js';

// ── 常量 ────────────────────────────────────────────────────────────────────

/** 契约 §2：Python 3.11–3.14（`>=3.11,<3.15`）。 */
const PYTHON_MIN_MINOR = 11;
const PYTHON_MAX_MINOR = 14;

/** Node 侧发起用 `c<N>`，Python 侧发起用 `s<N>`（契约 §3.1）。 */
const REQUEST_ID_PREFIX = 'c';

const DEFAULT_REQUEST_TIMEOUT_MS = 900_000;
const DEFAULT_START_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RESTARTS = 2;

/** 契约 §7 / §13：`state()` 的取值域。 */
const BRIDGE_STATES = Object.freeze(['stopped', 'starting', 'idle', 'ready', 'crashed']);

const METHOD_VALUES = new Set(Object.values(METHODS));

/** 桥脚本相对包根的位置（契约 §13、scripts/deeptutor_bridge_selftest.mjs 都认这个路径）。 */
const BRIDGE_SCRIPT_REL = join('python', 'deeptutor_bridge.py');

const STDERR_TAIL_LIMIT = 200;
const TRANSPORT_POLL_MS = 15;

// ── 小工具 ──────────────────────────────────────────────────────────────────

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errText(error) {
  if (!error) return '';
  return String(error?.message ?? error);
}

/** 受限环境里「不能开管道」的表现是 EPERM/EACCES，不同 Node 版本措辞略有差异。 */
function isPipeUnavailable(error) {
  const text = `${error?.code ?? ''} ${errText(error)}`;
  return /EPERM|EACCES|ENOTSUP|ENOSYS|not permitted|operation not supported/i.test(text);
}

/**
 * 把「桥自报的传输名」收敛成 Node 侧的两档：`pipe` / `files`。
 *
 * Python 侧的生产传输叫 `stdio`（那是它视角：走 stdin/stdout），Node 侧叫 `pipe`。
 * 两边名字不同是正常的，但必须在这里**收敛成同一个词**，
 * 否则 status 里会出现 `stdio`，而所有按 `pipe`/`files` 分支的代码都认不出来。
 */
function normalizeTransportKind(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  if (text === 'stdio' || text === 'pipe' || text === 'pipe-ndjson') return 'pipe';
  if (text === 'files' || text === 'ndjson-over-files' || text === 'file') return 'files';
  return text;
}

function makeLogger(logger) {
  const noop = () => {};
  return {
    debug: typeof logger?.debug === 'function' ? logger.debug.bind(logger) : noop,
    info: typeof logger?.info === 'function' ? logger.info.bind(logger) : noop,
    warn: typeof logger?.warn === 'function' ? logger.warn.bind(logger) : noop,
    error: typeof logger?.error === 'function' ? logger.error.bind(logger) : noop,
  };
}

function toDeepTutorError(error, fallbackKind = 'E_BRIDGE_UNAVAILABLE') {
  if (error instanceof DeepTutorError) return error;
  const kind = typeof error?.kind === 'string' ? error.kind : fallbackKind;
  const detail = error?.detail ?? (error?.code ? { code: error.code } : undefined);
  return new DeepTutorError(kind, errText(error) || 'Python 桥不可用', detail);
}

/** 解析 `3.11.9` → `{ major, minor, patch }`；认不出返回 null。 */
function parsePythonVersion(version) {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(version ?? '').trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

/**
 * 版本是否在支持区间内。
 * @returns {boolean|null} 版本串认不出时返回 `null`（不据此判定「不支持」）。
 */
export function isSupportedPythonVersion(version) {
  const parsed = parsePythonVersion(version);
  if (!parsed) return null;
  if (parsed.major !== 3) return parsed.major > 3;
  return parsed.minor >= PYTHON_MIN_MINOR && parsed.minor <= PYTHON_MAX_MINOR;
}

// ── 进程派生：全文件唯一 spawn 落点 ─────────────────────────────────────────

/**
 * 派生一个子进程。**本文件里唯一调用 `spawn` 的地方。**
 *
 * @param {Function} spawnImpl - 可注入的 `child_process.spawn`（测试用）
 * @param {string} command - 解释器绝对路径，或 Windows 的 `py` 启动器
 * @param {string[]} args - 参数数组；**永不拼接 shell 字符串**（避免注入与转义问题）
 * @param {object} options - `{ cwd, env, stdio, windowsHide }`
 */
function spawnProcess(spawnImpl, command, args, options) {
  return spawnImpl(command, args, options);
}

// ── 临时目录 / 一次性命令捕获 ───────────────────────────────────────────────

/**
 * 建一个本次运行专用的工作目录。
 *
 * 优先 `baseDir`（调用方给的包内目录），不可写时退到系统临时目录 ——
 * 「包目录只读」不该让解释器探测这一步整体失败。
 */
export async function createWorkDir(baseDir) {
  const stamp = `${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const candidates = [baseDir, join(tmpdir(), 'zhiyun-deeptutor')].filter(Boolean);
  let lastError = null;
  for (const base of candidates) {
    try {
      const dir = join(base, `probe-${stamp}`);
      await mkdir(dir, { recursive: true });
      return dir;
    } catch (error) {
      lastError = error;
    }
  }
  throw toDeepTutorError(lastError ?? new Error('无法创建临时目录'), 'E_BRIDGE_UNAVAILABLE');
}

/**
 * 跑一次短命命令并捕获完整输出。
 *
 * **故意不用管道**：输出重定向到文件，`stdio: ['ignore', fd, fd]`。
 * 理由有二 —— 受限沙箱禁止命名管道（`stdio:'pipe'` 直接 EPERM），而这里本来
 * 也只需要「跑完拿整段输出」，不需要流。生产环境同样正确。
 *
 * @returns {Promise<{ code:number|null, signal:string|null, stdout:string, stderr:string, error:string|null }>}
 */
export async function runCapture({
  spawnImpl = nodeSpawn,
  command,
  args,
  cwd,
  env,
  timeoutMs = 30_000,
  baseDir,
} = {}) {
  const dir = await createWorkDir(baseDir);
  const outPath = join(dir, 'probe.out');
  const errPath = join(dir, 'probe.err');
  try {
    await writeFile(outPath, '', 'utf8');
    await writeFile(errPath, '', 'utf8');
    const outFd = openSync(outPath, 'w');
    const errFd = openSync(errPath, 'w');
    let child;
    try {
      child = spawnProcess(spawnImpl, command, args, {
        cwd,
        env,
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      });
    } finally {
      // 句柄已交给子进程，父进程必须立刻关掉自己这一份，否则 Windows 上文件锁着读不全。
      closeSync(outFd);
      closeSync(errFd);
    }
    const outcome = await new Promise((resolveDone) => {
      let settled = false;
      const finish = (payload) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolveDone(payload);
      };
      const timer = setTimeout(() => {
        try {
          child.kill?.();
        } catch {
          // 忽略：超时后杀不掉也只能等它自己退。
        }
        finish({ code: null, signal: 'timeout', error: `命令超时（${timeoutMs}ms）` });
      }, timeoutMs);
      child.once('error', (error) => finish({ code: null, signal: null, error: errText(error) }));
      child.once('exit', (code, signal) => finish({ code, signal, error: null }));
    });
    const [stdout, stderr] = await Promise.all([
      readFile(outPath, 'utf8').catch(() => ''),
      readFile(errPath, 'utf8').catch(() => ''),
    ]);
    return { ...outcome, stdout, stderr };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── 解释器探测 ──────────────────────────────────────────────────────────────

/** 探针代码保持纯 ASCII，避免不同终端/编码下的乱码。 */
const VERSION_PROBE_CODE = 'import sys; print("PYVER=" + sys.version.split()[0])';

function extractProbedVersion(stdout) {
  const match = /PYVER=([0-9][0-9A-Za-z.+-]*)/.exec(String(stdout ?? ''));
  return match ? match[1] : null;
}

/**
 * 对一个候选解释器做版本探测。
 * @returns {Promise<{ ok:boolean, version:string|null, reason:string }>}
 */
async function probePythonVersion({ spawnImpl, command, baseArgs = [], cwd, env, timeoutMs = 20_000, baseDir } = {}) {
  const result = await runCapture({
    spawnImpl,
    command,
    args: [...baseArgs, '-c', VERSION_PROBE_CODE],
    cwd,
    env,
    timeoutMs,
    baseDir,
  }).catch((error) => ({ code: null, stdout: '', stderr: '', error: errText(error) }));
  if (result.error) return { ok: false, version: null, reason: result.error };
  const version = extractProbedVersion(result.stdout);
  if (!version) {
    const detail = String(result.stderr ?? '').trim().split('\n').slice(-2).join(' ').slice(0, 300);
    return { ok: false, version: null, reason: detail || `退出码 ${result.code}，但没打印版本` };
  }
  return { ok: true, version, reason: '' };
}

/** 仓库根 = 包根上两级；只用于定位受管 venv，不作为常量写死。 */
function inferRepoRoot({ rootDir, repoRoot }) {
  if (repoRoot) return resolvePath(repoRoot);
  if (!rootDir) return null;
  return resolvePath(rootDir, '..', '..');
}

/**
 * 受管 venv 的解释器候选（契约 §2 优先级 3）。
 *
 * 契约写的是 `.runtime/deeptutor-py<minor>`；这里把 3.11–3.14 都列出来，
 * 因为用户装的可能是 3.12/3.13 的受管环境 —— 只认 311 会在"明明装了却报找不到"。
 */
function managedVenvCandidates(repoRoot) {
  if (!repoRoot) return [];
  const result = [];
  for (let minor = PYTHON_MIN_MINOR; minor <= PYTHON_MAX_MINOR; minor += 1) {
    // 目录名是 `deeptutor-py<版本号>`，即 3.11 → `deeptutor-py311`（不是 `deeptutor-py11`）。
    // 少写一位会变成「明明装了却报找不到」，而错误又被归到 PYTHON_MISSING，极难排查。
    const base = join(repoRoot, '.runtime', `deeptutor-py3${minor}`);
    result.push(join(base, 'Scripts', 'python.exe'), join(base, 'bin', 'python3'));
  }
  return result;
}

/**
 * 读 profile 里记录的绝对解释器路径（契约 §2 优先级 1）。
 * 记录文件坏掉不算错误，只是「没有记录」——用户手改坏了不该让整条链挂掉。
 */
async function readRecordedPython({ profileDir }) {
  if (!profileDir) return null;
  const file = join(profileDir, 'data', 'zhiyun-deeptutor', 'python.json');
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    const path = typeof parsed?.path === 'string' ? parsed.path.trim() : '';
    return path ? { path, source: 'recorded' } : null;
  } catch {
    return null;
  }
}

/**
 * 解析要用的 Python 解释器（契约 §2）。
 *
 * 返回的 `source` 说明路径**是怎么来的**，而不是「我们猜它可用」：
 * `recorded`（用户显式指定）/ `env` / `managed-venv` / `py-launcher` / `provided`。
 *
 * @returns {Promise<{ ok:boolean, path:string|null, version:string|null, source:string, reason:string, args:string[] }>}
 */
export async function resolvePython({
  profileDir,
  rootDir,
  repoRoot,
  env = process.env,
  logger,
  spawnImpl = nodeSpawn,
  timeoutMs = 20_000,
  baseDir,
} = {}) {
  const log = makeLogger(logger);
  const candidates = [];

  const recorded = await readRecordedPython({ profileDir });
  if (recorded) candidates.push({ ...recorded, args: [] });

  const fromEnv = typeof env?.ZHIYUN_DEEPTUTOR_PYTHON === 'string' ? env.ZHIYUN_DEEPTUTOR_PYTHON.trim() : '';
  if (fromEnv) candidates.push({ path: fromEnv, source: 'env', args: [] });

  const repo = inferRepoRoot({ rootDir, repoRoot });
  for (const path of managedVenvCandidates(repo)) {
    candidates.push({ path, source: 'managed-venv', args: [] });
  }

  if (process.platform === 'win32') {
    // `py` 启动器只拿到启动器路径，具体小版本靠 `-3.11` 之类的参数固定。
    for (let minor = PYTHON_MIN_MINOR; minor <= PYTHON_MAX_MINOR; minor += 1) {
      candidates.push({ path: 'py', source: 'py-launcher', args: [`-3.${minor}`] });
    }
  }

  if (candidates.length === 0) {
    return {
      ok: false,
      path: null,
      version: null,
      source: 'none',
      reason: '没有任何候选解释器：未记录、未设置 ZHIYUN_DEEPTUTOR_PYTHON、也没有受管 venv',
      args: [],
    };
  }

  const failures = [];
  for (const candidate of candidates) {
    const probed = await probePythonVersion({
      spawnImpl,
      command: candidate.path,
      baseArgs: candidate.args,
      env,
      timeoutMs,
      baseDir,
    });
    if (!probed.ok) {
      failures.push(`${candidate.source}(${candidate.path}): ${probed.reason}`);
      continue;
    }
    if (isSupportedPythonVersion(probed.version) === false) {
      // 版本不合规必须**明确记下来**：否则最后只报「找不到解释器」，
      // 把「装错了版本」和「根本没装」两件事混成一句，用户无从下手。
      failures.push(`${candidate.source}(${candidate.path}): Python ${probed.version} 不在 3.11–3.14 内`);
      continue;
    }
    log.debug?.('已解析 Python 解释器', { source: candidate.source, version: probed.version });
    return {
      ok: true,
      path: candidate.path,
      version: probed.version,
      source: candidate.source,
      reason: '',
      args: candidate.args,
    };
  }

  return {
    ok: false,
    path: null,
    version: null,
    source: candidates[0]?.source ?? 'none',
    reason: `没有可用的 3.11–3.14 解释器：${failures.slice(-6).join('；')}`,
    args: [],
  };
}

// ── 上游依赖探测 ────────────────────────────────────────────────────────────

/** 探 vendor 依赖的 Python 片段；输出 `PROBE={json}`。纯 ASCII，便于任何编码下读回。 */
function depsProbeCode(vendorPath) {
  return [
    'import json, sys',
    `vendor = ${JSON.stringify(vendorPath ?? '')}`,
    'if vendor:',
    '    sys.path.insert(0, vendor)',
    'result = {"ok": False, "deeptutorVersion": None, "missing": [], "reason": ""}',
    'try:',
    '    import deeptutor  # noqa: F401',
    '    from deeptutor.__version__ import __version__ as _v',
    '    result["deeptutorVersion"] = str(_v)',
    'except Exception as exc:',
    '    result["missing"].append("deeptutor")',
    '    result["reason"] = type(exc).__name__ + ": " + str(exc)',
    'else:',
    '    try:',
    '        from deeptutor.app.facade import DeepTutorApp  # noqa: F401',
    '        result["ok"] = True',
    '    except ModuleNotFoundError as exc:',
    '        result["missing"].append(str(getattr(exc, "name", "") or "unknown"))',
    '        result["reason"] = type(exc).__name__ + ": " + str(exc)',
    '    except Exception as exc:',
    '        result["reason"] = type(exc).__name__ + ": " + str(exc)',
    'print("PROBE=" + json.dumps(result))',
  ].join('\n');
}

/**
 * 探测 vendor 下的上游依赖是否装好（契约 §2 依赖就绪判定 / §7 `deps-missing`）。
 *
 * 判据是「`deeptutor` 能 import 且 `deeptutor.app.facade` 能 import」——
 * 只看 `__version__.py` 文件在不在不够：依赖装了一半时文件是在的，import 却会炸。
 *
 * @returns {Promise<{ installed:boolean, deeptutorVersion:string|null, missing:string[], reason:string }>}
 */
export async function probeVendorDeps({
  pythonPath,
  pythonArgs = [],
  vendorPath,
  env = process.env,
  spawnImpl = nodeSpawn,
  timeoutMs = 120_000,
  baseDir,
} = {}) {
  if (!pythonPath) {
    return { installed: false, deeptutorVersion: null, missing: [], reason: '尚未解析 Python 解释器' };
  }
  if (!vendorPath) {
    return { installed: false, deeptutorVersion: null, missing: [], reason: '未提供 vendor 路径' };
  }
  const result = await runCapture({
    spawnImpl,
    command: pythonPath,
    args: [...pythonArgs, '-c', depsProbeCode(vendorPath)],
    env,
    timeoutMs,
    baseDir,
  }).catch((error) => ({ code: null, stdout: '', stderr: '', error: errText(error) }));

  if (result.error) {
    return { installed: false, deeptutorVersion: null, missing: [], reason: `探测依赖时无法运行解释器：${result.error}` };
  }
  const match = /PROBE=(\{.*\})/s.exec(String(result.stdout ?? ''));
  if (!match) {
    const tail = String(result.stderr ?? '').trim().split('\n').slice(-3).join(' ').slice(0, 400);
    return {
      installed: false,
      deeptutorVersion: null,
      missing: [],
      reason: tail || `依赖探测没有输出（退出码 ${result.code}）`,
    };
  }
  let parsed = null;
  try {
    parsed = JSON.parse(match[1]);
  } catch (error) {
    return {
      installed: false,
      deeptutorVersion: null,
      missing: [],
      reason: `依赖探测输出无法解析：${errText(error)}`,
    };
  }
  return {
    installed: parsed?.ok === true,
    deeptutorVersion: typeof parsed?.deeptutorVersion === 'string' ? parsed.deeptutorVersion : null,
    missing: Array.isArray(parsed?.missing) ? parsed.missing.map(String) : [],
    reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
  };
}

// ── NDJSON 读取器 ───────────────────────────────────────────────────────────

/**
 * 把字节流/字符串流读成「一行一个 JSON 对象」的异步迭代器。
 *
 * 坏了就抛 `E_PROTOCOL` 并带上原文前 200 字 —— 协议错误必须能定位到是哪一行，
 * 否则日志里只剩「桥挂了」，等于没有信息。
 *
 * @param {AsyncIterable<Uint8Array|string>} stream
 */
export async function* ndjsonReader(stream) {
  let buffer = '';
  const take = function* take() {
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) return;
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim()) yield line;
    }
  };
  const parse = (line) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new DeepTutorError('E_PROTOCOL', `Python 桥输出了不合规的 NDJSON：${errText(error)}`, {
        sample: line.slice(0, 200),
      });
    }
  };
  for await (const chunk of stream) {
    buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    for (const line of take()) yield parse(line);
  }
  // 收尾：最后一行没有换行时也不能丢。
  if (buffer.trim()) yield parse(buffer);
}

// ── 传输层 ──────────────────────────────────────────────────────────────────

/** 追加一行到文件。用同步写保证行序：并发请求下异步 append 可能交错，而 NDJSON 依赖行序。 */
function appendLineSync(path, line) {
  let fd = null;
  try {
    fd = openSync(path, 'a');
    const buffer = Buffer.from(`${line}\n`, 'utf8');
    let written = 0;
    while (written < buffer.length) {
      written += writeSync(fd, buffer, written, buffer.length - written);
    }
  } catch {
    // 写失败由「子进程无输入 → 请求超时 / 进程退出」兜底，不在这里抛：
    // 抛出去也修不好，只会把一次可诊断的超时变成一次没有上下文的异常。
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // 忽略
      }
    }
  }
}

/**
 * 管道传输：生产路径。stdin/stdout 走 NDJSON，stderr 单独收尾部。
 *
 * 受限环境里 `spawn` 会抛 EPERM，由 `PythonBridge.start()` 捕获后降级到文件传输。
 */
async function createPipeTransport({ spawnImpl, command, args, cwd, env, onLine, onExit, onStderr }) {
  // 刻意**不**在这里包 DeepTutorError：`PythonBridge.start()` 要靠原始错误的
  // `code === 'EPERM'` 判断「这个环境不能开管道」，包一层就把判据洗掉了。
  const child = spawnProcess(spawnImpl, command, args, {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const stderrTail = [];
  let closed = false;
  const done = new Promise((resolveDone) => {
    const finish = (payload) => {
      if (closed) return;
      closed = true;
      resolveDone(payload);
      onExit?.(payload);
    };
    child.once('error', (error) => finish({ code: null, signal: null, error: errText(error), stderrTail: stderrTail.slice(-40).join('') }));
    child.once('exit', (code, signal) => finish({ code, signal, error: null, stderrTail: stderrTail.slice(-40).join('') }));
  });

  child.stderr?.setEncoding?.('utf8');
  child.stderr?.on?.('data', (chunk) => {
    const text = String(chunk);
    stderrTail.push(text);
    if (stderrTail.length > STDERR_TAIL_LIMIT) stderrTail.shift();
    onStderr?.(text);
  });

  let buffer = '';
  child.stdout?.setEncoding?.('utf8');
  child.stdout?.on?.('data', (chunk) => {
    buffer += String(chunk);
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  });

  return {
    kind: 'pipe',
    pid: typeof child.pid === 'number' ? child.pid : null,
    send(line) {
      if (!child.stdin?.writable) throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', 'Python 桥的 stdin 已关闭');
      child.stdin.write(`${line}\n`);
    },
    async stop() {
      try {
        child.stdin?.end?.();
      } catch {
        // 忽略
      }
      try {
        child.kill?.();
      } catch {
        // 忽略
      }
      return done;
    },
    onExit: done,
  };
}

/**
 * 文件传输：受限环境下的调试通道。
 *
 * 输入追加到 `<dir>/bridge-in.ndjson`，输出从 `<dir>/bridge-out.ndjson` 轮询。
 * 子进程 stdio 全部 `'ignore'` —— 这正是绕开「不能开命名管道」的关键，
 * 但**它只是调试/自检通道**，生产一律走管道（文件轮询有延迟，也不该当生产用）。
 */
async function createFilesTransport({ spawnImpl, command, args, cwd, env, onLine, onExit, workDir }) {
  const dir = workDir ?? (await createWorkDir());
  const inPath = join(dir, 'bridge-in.ndjson');
  const outPath = join(dir, 'bridge-out.ndjson');
  await mkdir(dir, { recursive: true });
  await writeFile(inPath, '', 'utf8');
  await writeFile(outPath, '', 'utf8');

  let child;
  try {
    child = spawnProcess(spawnImpl, command, [...args, '--transport', 'files', '--in', inPath, '--out', outPath], {
      cwd,
      env,
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch (error) {
    throw toDeepTutorError(error, 'E_BRIDGE_UNAVAILABLE');
  }

  let offset = 0;
  let buffer = '';
  let polling = true;
  let closed = false;

  const done = new Promise((resolveDone) => {
    const finish = (payload) => {
      if (closed) return;
      closed = true;
      resolveDone(payload);
      onExit?.(payload);
    };
    child.once('error', (error) => finish({ code: null, signal: null, error: errText(error), stderrTail: '' }));
    child.once('exit', (code, signal) => finish({ code, signal, error: null, stderrTail: '' }));
  });

  async function pollOnce() {
    let size = 0;
    try {
      size = (await stat(outPath)).size;
    } catch {
      return;
    }
    if (size <= offset) return;
    const handle = await open(outPath, 'r');
    try {
      const length = size - offset;
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, offset);
      offset = size;
      buffer += buf.toString('utf8');
    } finally {
      await handle.close().catch(() => {});
    }
    for (;;) {
      const index = buffer.indexOf('\n');
      if (index < 0) break;
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  }

  const loop = (async () => {
    while (polling) {
      try {
        await pollOnce();
      } catch {
        // 单次轮询失败不打死桥：下一轮继续，真出事由进程 exit 兜底。
      }
      await new Promise((r) => setTimeout(r, TRANSPORT_POLL_MS));
    }
  })();

  return {
    kind: 'files',
    workDir: dir,
    pid: typeof child.pid === 'number' ? child.pid : null,
    send(line) {
      appendLineSync(inPath, line);
    },
    async stop() {
      polling = false;
      try {
        child.kill?.();
      } catch {
        // 忽略
      }
      await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
      await loop.catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return done;
    },
    onExit: done,
  };
}

// ── PythonBridge ────────────────────────────────────────────────────────────

/**
 * Python 子进程桥。
 *
 * 与契约 §13 的两处刻意差异（都是为了让 `src/service.js` 的实现要求成立）：
 * - `state` / `info` 是**方法**而非 getter —— service.js 的 `readBridgeState()`
 *   先试 `typeof bridge.state === 'function'`，方法形态能同时满足两种读取方式。
 * - 构造函数额外接受 `rootDir` / `profileDir`，因为 `resolvePython()` 要靠它们
 *   定位受管 venv 与 recorded 记录；不接受就得让调用方先解析再传，把选择权外移。
 *
 * 事件：`notification`(method, params)、`exit`(payload)。
 */
export class PythonBridge extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} [options.pythonPath] - 已解析的解释器（不给则 `start()` 时解析）
   * @param {string[]} [options.pythonArgs] - 例：`py` 启动器的 `['-3.11']`
   * @param {string} [options.vendorPath] - 含 `deeptutor/` 的上游源码根
   * @param {string} [options.homeDir] - `DEEPTUTOR_HOME`
   * @param {string} [options.rootDir] - 包根（定位桥脚本与 `.runtime`）
   * @param {string} [options.repoRoot] - 仓库根（受管 venv 所在）
   * @param {string} [options.profileDir] - profile 目录（读 python.json）
   * @param {string} [options.scriptPath] - 桥脚本绝对路径（默认 `<rootDir>/python/deeptutor_bridge.py`）
   * @param {object} [options.env] - 子进程环境（默认 `process.env`）
   * @param {object} [options.logger]
   * @param {number} [options.requestTimeoutMs]
   * @param {number} [options.startTimeoutMs]
   * @param {'pipe'|'files'|'auto'|object} [options.transport] - 传输层；对象形态为注入桩
   * @param {Function} [options.spawnImpl] - 注入的 spawn（测试用）
   * @param {number} [options.maxRestarts] - 崩溃重启上限（契约 §2）
   */
  constructor({
    pythonPath = null,
    pythonArgs = [],
    vendorPath = null,
    homeDir = null,
    rootDir = null,
    repoRoot = null,
    profileDir = null,
    scriptPath = null,
    env = null,
    logger = null,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    startTimeoutMs = DEFAULT_START_TIMEOUT_MS,
    transport = 'auto',
    spawnImpl = nodeSpawn,
    maxRestarts = DEFAULT_MAX_RESTARTS,
  } = {}) {
    super();
    this.rootDir = rootDir;
    this.repoRoot = inferRepoRoot({ rootDir, repoRoot });
    this.vendorPath = vendorPath;
    this.homeDir = homeDir;
    this.profileDir = profileDir;
    this.scriptPath = scriptPath ?? (rootDir ? join(rootDir, BRIDGE_SCRIPT_REL) : null);
    this.env = env ?? null;
    this.logger = makeLogger(logger);
    this.requestTimeoutMs = Number(requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
    this.startTimeoutMs = Number(startTimeoutMs) || DEFAULT_START_TIMEOUT_MS;
    this.maxRestarts = Math.max(0, Number(maxRestarts) || 0);
    this.spawnImpl = spawnImpl;
    this.transportOption = transport;

    this._pythonPath = pythonPath;
    this._pythonArgs = Array.isArray(pythonArgs) ? [...pythonArgs] : [];
    this._pythonSource = pythonPath ? 'provided' : 'unresolved';
    this._pythonVersion = null;

    this._state = 'stopped';
    this._transport = null;
    this._startPromise = null;
    this._stopPromise = null;
    this._intentionalStop = false;

    this.pid = null;
    this.startedAt = null;
    this.restartCount = 0;

    this.pythonVersion = null;
    this.deeptutorVersion = null;
    this.protocolVersion = null;
    this.transportKind = null;

    this._seq = 0;
    this._pending = new Map();
    this._notificationHandlers = new Set();
    this._requestHandlers = new Set();
    this._exitHandlers = new Set();
    this._stderrTail = [];
  }

  // -- 状态 ---------------------------------------------------------------

  /** 契约 §7 / §13：`'stopped' | 'starting' | 'idle' | 'ready' | 'crashed'`。 */
  state() {
    return this._state;
  }

  /** 契约 §13：`{ pid, startedAt, pythonVersion, deeptutorVersion }` + 传输与解释器事实。 */
  info() {
    return {
      pid: this.pid,
      startedAt: this.startedAt,
      pythonVersion: this.pythonVersion,
      deeptutorVersion: this.deeptutorVersion,
      protocolVersion: this.protocolVersion,
      transport: this.transportKind,
      state: this._state,
      restartCount: this.restartCount,
      // 解释器来源也如实报出：用户复核「为什么用了这个 Python」时只能靠这条。
      python: { path: this._pythonPath, version: this._pythonVersion, source: this._pythonSource },
      vendorPath: this.vendorPath,
      homeDir: this.homeDir,
      stderrTail: this._stderrTail.slice(-20).join(''),
    };
  }

  /**
   * 回填已经解析过的解释器结果，避免 `start()` 再 `resolvePython()` 一遍。
   *
   * 为什么需要它：`index.js` 在 apply 阶段就起了一次后台探测，用来给
   * `status()` 报事实。如果 `start()` 再解析一次，两次结果可能不同（用户正好
   * 在这中间装了 venv），于是「状态页显示的 Python」与「实际启动用的 Python」
   * 会不是同一个 —— 这种不一致最难排查，所以探测结果必须能回填。
   *
   * 探测失败（`ok !== true`）时**直接返回、不抛**：那是一次后台探测的结论，
   * 不是启动失败；真正的失败要在 `start()` 里按契约 §9 报成可解释的错误。
   *
   * @param {{ ok?: boolean, path?: string|null, args?: string[], version?: string|null, source?: string }} resolved
   * @returns {boolean} 是否回填成功
   */
  useResolvedPython(resolved) {
    if (!isRecord(resolved) || resolved.ok !== true || typeof resolved.path !== 'string' || !resolved.path) {
      return false;
    }
    // 已经启动过就别改：解释器换了之后在飞子进程仍跑在旧解释器上，改字段只会
    // 让 info() 说假话。要换解释器就 stop() 之后再回填。
    if (this._transport || this._state === 'starting' || this._state === 'ready') return false;
    this._pythonPath = resolved.path;
    this._pythonArgs = Array.isArray(resolved.args) ? [...resolved.args] : [];
    this._pythonSource = typeof resolved.source === 'string' && resolved.source ? resolved.source : 'resolved';
    this._pythonVersion = resolved.version ?? null;
    this.pythonVersion = resolved.version ?? null;
    return true;
  }

  // -- 订阅 ---------------------------------------------------------------

  /** 订阅 Python→Node 通知，`handler(method, params)`。返回幂等退订函数。 */
  onNotification(handler) {
    if (typeof handler !== 'function') return () => {};
    this._notificationHandlers.add(handler);
    return () => this._notificationHandlers.delete(handler);
  }

  /**
   * 订阅 Python→Node 反向请求，`handler(method, params) -> Promise<result>`。
   * 返回 `undefined` 表示「我不处理」，交给下一个 handler；全都不处理则回 error。
   */
  onRequest(handler) {
    if (typeof handler !== 'function') return () => {};
    this._requestHandlers.add(handler);
    return () => this._requestHandlers.delete(handler);
  }

  /** 订阅子进程退出，`handler({ code, signal, stderrTail, error })`。 */
  onExit(handler) {
    if (typeof handler !== 'function') return () => {};
    this._exitHandlers.add(handler);
    return () => this._exitHandlers.delete(handler);
  }

  // -- 启动 / 停止 --------------------------------------------------------

  /** 启动子进程并完成 ping 握手。失败抛 `DeepTutorError`。幂等。 */
  async start() {
    if (this._state === 'ready' && this._transport) return this;
    if (this._startPromise) return this._startPromise;
    this._startPromise = this._doStart().finally(() => {
      this._startPromise = null;
    });
    return this._startPromise;
  }

  async _doStart() {
    this._intentionalStop = false;
    this._setState('starting');

    if (!this._pythonPath) {
      const resolved = await resolvePython({
        profileDir: this.profileDir,
        rootDir: this.rootDir,
        repoRoot: this.repoRoot,
        env: this.env ?? process.env,
        logger: this.logger,
        spawnImpl: this.spawnImpl,
      });
      if (!resolved.ok) {
        this._setState('stopped');
        // 版本不合规与完全没装是两件事，错误 kind 也不同（契约 §9）。
        const kind = resolved.version ? 'E_PYTHON_VERSION' : 'E_PYTHON_MISSING';
        throw new DeepTutorError(kind, `未找到可用的 Python 解释器：${resolved.reason}`, {
          source: resolved.source,
          version: resolved.version,
        });
      }
      this._pythonPath = resolved.path;
      this._pythonArgs = resolved.args ?? [];
      this._pythonSource = resolved.source;
      this._pythonVersion = resolved.version;
      this.pythonVersion = resolved.version;
    } else if (!this._pythonVersion) {
      const probed = await probePythonVersion({
        spawnImpl: this.spawnImpl,
        command: this._pythonPath,
        baseArgs: this._pythonArgs,
        env: this.env ?? process.env,
      });
      if (probed.ok) {
        this._pythonVersion = probed.version;
        this.pythonVersion = probed.version;
      }
    }

    if (!this.scriptPath) {
      this._setState('stopped');
      throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', '未提供桥脚本路径（构造时缺 rootDir 与 scriptPath）');
    }

    const mode = this.transportOption;
    try {
      // 注入的传输桩是**对象**：必须原样交给 _launch，不能在这里被归一化成 'pipe'。
      // 早期版本只判断 `typeof mode === 'string'`，结果注入的传输被静默丢弃、
      // 桥照样去派生真进程 —— 受限环境里表现为 EPERM，排查时完全看不出是这里丢的。
      const target = typeof mode === 'object' && mode !== null ? mode : typeof mode === 'string' && mode !== 'auto' ? mode : 'pipe';
      await this._launch(target);
    } catch (error) {
      if (typeof mode === 'string' && mode === 'auto' && isPipeUnavailable(error)) {
        // 降级是事实，必须让它可见：否则「为什么这么慢」「为什么有临时目录」无从解释。
        this.logger.warn('管道传输不可用（受限环境禁止命名管道），降级为 ndjson-over-files 调试传输', errText(error));
        try {
          await this._launch('files');
        } catch (retryError) {
          this._setState('stopped');
          throw toDeepTutorError(retryError);
        }
      } else {
        this._setState('stopped');
        throw toDeepTutorError(error);
      }
    }

    await this._handshake();
    this._setState('ready');
    return this;
  }

  async _launch(transportOption) {
    const env = { ...(this.env ?? process.env) };
    if (this.homeDir) env.DEEPTUTOR_HOME = this.homeDir;
    if (this.vendorPath) env.ZHIYUN_DEEPTUTOR_VENDOR = this.vendorPath;
    // 中文输出/路径在 GBK 默认终端下会炸；统一钉 UTF-8 且不缓冲，
    // 否则 NDJSON 会攒在 Python 侧直到缓冲区满，表现为「桥没反应」。
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUNBUFFERED = '1';

    const args = ['-u', this.scriptPath];
    if (this.vendorPath) args.push('--vendor', this.vendorPath);
    if (this.homeDir) args.push('--home', this.homeDir);
    const fullArgs = [...this._pythonArgs, ...args];

    // 注入的传输桩：只要实现 send/stop，并且构造函数里已经拿到 onLine 回调即可。
    if (typeof transportOption === 'object' && transportOption) {
      this._transport = transportOption;
      this.transportKind = transportOption.kind ?? 'injected';
      this.pid = typeof transportOption.pid === 'number' ? transportOption.pid : null;
      this.startedAt = Date.now();
      return;
    }

    const common = {
      spawnImpl: this.spawnImpl,
      command: this._pythonPath,
      args: fullArgs,
      cwd: this.rootDir ?? undefined,
      env,
      onLine: (line) => this._acceptLine(line),
      onExit: (payload) => this._handleExit(payload),
    };

    if (transportOption === 'files') {
      this._transport = await createFilesTransport({ ...common, workDir: null });
      this.transportKind = 'files';
    } else {
      this._transport = await createPipeTransport({
        ...common,
        onStderr: (text) => {
          this._stderrTail.push(text);
          if (this._stderrTail.length > STDERR_TAIL_LIMIT) this._stderrTail.shift();
        },
      });
      this.transportKind = 'pipe';
    }
    this.pid = this._transport.pid ?? null;
    this.startedAt = Date.now();
  }

  /** ping 握手：确认对端是我们的桥、协议版本一致，并拿到上游版本事实。 */
  async _handshake() {
    let pong;
    try {
      pong = await this.request(METHODS.ping, {}, { timeoutMs: this.startTimeoutMs });
    } catch (error) {
      await this._abortStart();
      throw toDeepTutorError(error, 'E_BRIDGE_UNAVAILABLE');
    }
    this.protocolVersion = Number(pong?.protocolVersion ?? 0) || null;
    this.pythonVersion = pong?.pythonVersion ?? this.pythonVersion;
    this.deeptutorVersion = pong?.deeptutorVersion ?? null;
    this.transportKind = normalizeTransportKind(pong?.transport) ?? this.transportKind;
    if (typeof pong?.pid === 'number') this.pid = pong.pid;

    if (this.protocolVersion !== null && this.protocolVersion !== PROTOCOL_VERSION) {
      await this._abortStart();
      throw new DeepTutorError(
        'E_PROTOCOL',
        `Python 桥协议版本不一致：需要 ${PROTOCOL_VERSION}，桥回报 ${this.protocolVersion}`,
        { expected: PROTOCOL_VERSION, actual: this.protocolVersion },
      );
    }
    if (pong?.ok === false) {
      await this._abortStart();
      throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', 'Python 桥 ping 握手返回 ok=false', { pong });
    }
    return pong;
  }

  async _abortStart() {
    const transport = this._transport;
    this._transport = null;
    this.pid = null;
    if (transport) {
      try {
        await transport.stop?.();
      } catch {
        // 忽略：启动失败路径上已经在收尾了。
      }
    }
    this._setState('stopped');
  }

  /**
   * 停止桥。`drain: true` 时先发 `shutdown` 让 Python 收尾在飞 turn。
   * 幂等：并发调用共享同一个 Promise。
   */
  async stop({ drain = true } = {}) {
    if (this._stopPromise) return this._stopPromise;
    this._stopPromise = this._doStop({ drain }).finally(() => {
      this._stopPromise = null;
    });
    return this._stopPromise;
  }

  async _doStop({ drain }) {
    this._intentionalStop = true;
    if (drain && this._state === 'ready' && this._transport) {
      try {
        await this.request(METHODS.shutdown, { drain: true }, { timeoutMs: 5000 });
      } catch {
        // 桥已经不响应了就直收音进程 —— 关不掉的进程才是问题，超时不是。
      }
    }
    const transport = this._transport;
    this._transport = null;
    this.pid = null;
    this.startedAt = null;
    this._rejectPending(new DeepTutorError('E_BRIDGE_UNAVAILABLE', 'Python 桥已关闭'));
    if (transport) {
      try {
        await transport.stop?.();
      } catch (error) {
        this.logger.warn('关闭 Python 桥时出错（已忽略）', errText(error));
      }
    }
    this._setState('stopped');
  }

  /** `stop()` 的别名：服务面按惯例调 dispose。 */
  async dispose() {
    return this.stop({ drain: false });
  }

  // -- 报文收发 -----------------------------------------------------------

  _setState(next) {
    if (BRIDGE_STATES.includes(next)) this._state = next;
  }

  /** 收到一行文本 → 分流为响应 / 反向请求 / 通知（契约 §3.1）。 */
  _acceptLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.logger.warn('Python 桥输出了不合规的 NDJSON（已忽略该行）', {
        error: errText(error),
        sample: String(line).slice(0, 200),
      });
      return;
    }
    if (!isRecord(message)) {
      this.logger.warn('Python 桥输出了非对象报文（已忽略）', { sample: String(line).slice(0, 200) });
      return;
    }
    const id = message.id ?? null;
    const method = typeof message.method === 'string' ? message.method : null;

    if (method && id !== null && id !== undefined) {
      void this._handleReverseRequest(String(id), method, isRecord(message.params) ? message.params : {});
      return;
    }
    if (method) {
      this._dispatchNotification(method, isRecord(message.params) ? message.params : {});
      return;
    }
    if (id !== null && id !== undefined) {
      this._resolvePending(String(id), message);
      return;
    }
    this.logger.warn('Python 桥发来既无 id 也无 method 的报文（已忽略）', {});
  }

  _resolvePending(id, message) {
    const entry = this._pending.get(id);
    if (!entry) {
      // 迟到的响应（我们已超时放弃）：记一条就好，不是错误。
      this.logger.warn('收到未知请求 id 的响应（已忽略）', { id });
      return;
    }
    this._pending.delete(id);
    clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener?.('abort', entry.onAbort);
    if (isRecord(message.error)) {
      const data = isRecord(message.error.data) ? message.error.data : {};
      const kind = typeof data.kind === 'string' ? data.kind : 'E_UPSTREAM_ERROR';
      entry.reject(new DeepTutorError(kind, String(message.error.message ?? '桥调用失败'), data.detail ?? null));
      return;
    }
    entry.resolve(message.result);
  }

  _dispatchNotification(method, params) {
    for (const handler of this._notificationHandlers) {
      try {
        handler(method, params);
      } catch (error) {
        // 订阅者自己的 bug 不能打死消息泵，否则一条通知能拖挂整轮。
        this.logger.warn('处理桥通知时出错（已忽略）', { method, error: errText(error) });
      }
    }
    this.emit('notification', method, params);
  }

  /** Python→Node 反向请求：**未知方法一律回 error**，绝不挂死（契约 §3.2）。 */
  async _handleReverseRequest(id, method, params) {
    let result;
    let handled = false;
    for (const handler of this._requestHandlers) {
      try {
        const produced = await handler(method, params);
        if (produced !== undefined) {
          result = produced;
          handled = true;
          break;
        }
      } catch (error) {
        this._sendMessage({
          id,
          error: {
            code: -32000,
            message: errText(error) || `反向请求 ${method} 处理失败`,
            data: {
              kind: typeof error?.kind === 'string' ? error.kind : 'E_UPSTREAM_ERROR',
              detail: error?.detail ?? null,
            },
          },
        });
        return;
      }
    }
    if (!handled) {
      this._sendMessage({
        id,
        error: {
          code: -32601,
          message: `Node 侧未实现反向方法：${method}`,
          data: { kind: 'E_PROTOCOL', detail: { method } },
        },
      });
      return;
    }
    this._sendMessage({ id, result: result ?? {} });
  }

  _sendMessage(payload) {
    if (!this._transport) throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', 'Python 桥尚未启动，无法发送报文');
    this._transport.send(JSON.stringify({ jsonrpc: '2.0', ...payload }));
  }

  /**
   * 发起一次 Node→Python 请求。
   *
   * @param {string} method - 必须取自 `src/protocol.js` 的 METHODS（拼错要立刻炸，
   *   而不是等 Python 侧回一个 -32601 再排查）
   * @param {object} [params]
   * @param {{ timeoutMs?: number, signal?: AbortSignal }} [options]
   */
  async request(method, params = {}, { timeoutMs, signal } = {}) {
    if (typeof method !== 'string' || !METHOD_VALUES.has(method)) {
      throw new DeepTutorError('E_PROTOCOL', `未登记的桥方法：${String(method)}`, { method: String(method) });
    }
    if (!this._transport && (this._state === 'idle' || this._state === 'stopped' || this._state === 'starting')) {
      await this.start();
    }
    if (!this._transport) throw new DeepTutorError('E_BRIDGE_UNAVAILABLE', 'Python 桥不可用（子进程未启动）');
    if (signal?.aborted) throw new DeepTutorError('E_CANCELLED', '请求已被取消', { method });

    const limit = Number(timeoutMs ?? this.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS;
    this._seq += 1;
    const id = `${REQUEST_ID_PREFIX}${this._seq}`;
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        rejectPromise(
          new DeepTutorError('E_TIMEOUT', `Python 桥在 ${limit}ms 内没有回应 ${method}`, { method, timeoutMs: limit }),
        );
      }, limit);
      const entry = { resolve: resolvePromise, reject: rejectPromise, timer, signal, method, onAbort: null };
      if (signal) {
        entry.onAbort = () => {
          this._pending.delete(id);
          clearTimeout(timer);
          rejectPromise(new DeepTutorError('E_CANCELLED', '请求已被取消', { method }));
        };
        signal.addEventListener?.('abort', entry.onAbort, { once: true });
      }
      this._pending.set(id, entry);
      try {
        this._sendMessage({ id, method, params: params ?? {} });
      } catch (error) {
        this._pending.delete(id);
        clearTimeout(timer);
        rejectPromise(toDeepTutorError(error));
      }
    });
  }

  /** 进程退出：拒绝所有在飞请求；非主动停止时标记 crashed 并累计重启次数。 */
  _handleExit(payload) {
    const wasIntentional = this._intentionalStop;
    this._transport = null;
    this.pid = null;
    this.startedAt = null;
    this._rejectPending(
      new DeepTutorError(
        'E_BRIDGE_UNAVAILABLE',
        `Python 桥进程已退出（code=${payload?.code ?? 'null'} signal=${payload?.signal ?? 'null'}）`,
        {
          code: payload?.code ?? null,
          signal: payload?.signal ?? null,
          stderrTail: String(payload?.stderrTail ?? '').slice(-2000),
        },
      ),
    );
    if (!wasIntentional) {
      this.restartCount += 1;
      this._setState('crashed');
      this.logger.warn('Python 桥意外退出', {
        code: payload?.code ?? null,
        signal: payload?.signal ?? null,
        restartCount: this.restartCount,
        maxRestarts: this.maxRestarts,
        stderrTail: String(payload?.stderrTail ?? '').slice(-500),
      });
    }
    for (const handler of this._exitHandlers) {
      try {
        handler(payload);
      } catch (error) {
        this.logger.warn('处理桥退出回调时出错（已忽略）', errText(error));
      }
    }
    this.emit('exit', payload);
  }

  _rejectPending(error) {
    for (const [id, entry] of this._pending) {
      this._pending.delete(id);
      clearTimeout(entry.timer);
      if (entry.signal && entry.onAbort) entry.signal.removeEventListener?.('abort', entry.onAbort);
      entry.reject(error);
    }
  }
}

export default { PythonBridge, resolvePython, probeVendorDeps, ndjsonReader, runCapture, createWorkDir };
