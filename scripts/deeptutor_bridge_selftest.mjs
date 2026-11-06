#!/usr/bin/env node
/**
 * DeepTutor 桥的端到端自检。
 *
 * 目的是给「这台机器现在能不能真的跑一次出题」一个**可解释的答案**，
 * 而不是让用户点一个按钮等半天再看到一句「失败」。
 *
 * 检查顺序刻意从便宜到昂贵：
 *   1. 包内文件是否齐全（不启任何进程）
 *   2. 分发清单与上游锁是否自洽（不启进程）
 *   3. 锁定的版本与 vendor 实际版本是否一致（不启进程）
 *   4. Python 解释器能否找到、版本是否满足上游要求
 *   5. bridge 的 `--selftest`（只跑协议，不 import 上游）
 *   6. 上游模块能否 import（依赖装没装全）
 *
 * 每一档失败都给出人话原因和下一步该做什么。退出码 1 表示有档位失败。
 *
 * 用法：
 *   node scripts/deeptutor_bridge_selftest.mjs              # 全部检查
 *   node scripts/deeptutor_bridge_selftest.mjs --quick      # 跳过最后一档（不 import 上游）
 *   node scripts/deeptutor_bridge_selftest.mjs --json       # 机器可读
 */
import { spawn } from 'node:child_process';
import { access, readFile, mkdir } from 'node:fs/promises';
import { closeSync, constants, openSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const pkgDir = join(root, 'packages', 'dsh-zhiyun-host-deeptutor');
const args = new Set(process.argv.slice(2));
const quick = args.has('--quick');
const asJson = args.has('--json');

/** @type {{name: string, ok: boolean, detail: string, hint?: string}[]} */
const results = [];

function record(name, ok, detail, hint) {
  results.push({ name, ok, detail, ...(hint ? { hint } : {}) });
  if (!asJson) {
    const mark = ok ? '通过' : '未通过';
    console.log(`[${mark}] ${name}`);
    console.log(`       ${detail}`);
    if (!ok && hint) console.log(`       下一步：${hint}`);
  }
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function run(command, argv, { timeoutMs = 20000, cwd = root } = {}) {
  const piped = await spawnPiped(command, argv, { timeoutMs, cwd });
  // 受限环境（例如不能开命名管道的沙箱）里 spawn 会 EPERM。这不代表被调用的
  // 解释器有问题，所以降级成「把输出重定向到临时文件再读回来」—— 这是**不捕获
  // 管道**的合法替代，而不是绕过限制去 shell 拼接。
  if (!piped.denied) return piped;
  return spawnViaFiles(command, argv, { timeoutMs, cwd });
}

function spawnPiped(command, argv, { timeoutMs, cwd }) {
  return new Promise((done) => {
    let child;
    try {
      child = spawn(command, argv, { cwd, windowsHide: true });
    } catch (error) {
      done({
        code: -1,
        stdout: '',
        stderr: `${error?.code ?? ''} ${error?.message ?? error}`.trim(),
        denied: /EPERM/.test(String(error?.code ?? '') + String(error?.message ?? '')),
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      done({
        code: -1,
        stdout,
        stderr: `${error?.code ?? ''} ${error?.message ?? error}`.trim(),
        denied: /EPERM/.test(String(error?.code ?? '') + String(error?.message ?? '')),
      });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ code, stdout, stderr, denied: false });
    });
  });
}

let fileRunSeq = 0;
async function spawnViaFiles(command, argv, { timeoutMs, cwd }) {
  const dir = join(root, '.runtime', 'selftest-tmp');
  await mkdir(dir, { recursive: true });
  const seq = fileRunSeq++;
  const outPath = join(dir, `run-${process.pid}-${seq}.out`);
  const errPath = join(dir, `run-${process.pid}-${seq}.err`);
  const outFd = openSync(outPath, 'w');
  const errFd = openSync(errPath, 'w');
  try {
    const result = await new Promise((done) => {
      let child;
      try {
        child = spawn(command, argv, {
          cwd,
          windowsHide: true,
          stdio: ['ignore', outFd, errFd],
        });
      } catch (error) {
        done({ code: -1, stderr: String(error?.message ?? error) });
        return;
      }
      const timer = setTimeout(() => child.kill(), timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        done({ code: -1, stderr: String(error?.message ?? error) });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        done({ code });
      });
    });
    return {
      code: result.code,
      stdout: await readFile(outPath, 'utf8').catch(() => ''),
      stderr: (await readFile(errPath, 'utf8').catch(() => '')) + (result.stderr ?? ''),
      denied: false,
      viaFiles: true,
    };
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
}

// ── 1. 包内文件 ────────────────────────────────────────────────────────────────
async function checkFiles() {
  const required = [
    'package.json',
    'cordis.patch.yml',
    'upstream.lock.json',
    'distribution.json',
    'src/index.js',
    'src/protocol.js',
    'python/deeptutor_bridge.py',
    'vendor/deeptutor/LICENSE',
    'vendor/deeptutor/pyproject.toml',
    'vendor/deeptutor/deeptutor/app/facade.py',
    'vendor/deeptutor/deeptutor/agents/question/pipeline.py',
  ];
  const missing = [];
  for (const rel of required) {
    if (!(await exists(join(pkgDir, rel)))) missing.push(rel);
  }
  record(
    '包内文件齐全',
    missing.length === 0,
    missing.length === 0 ? `${required.length} 个关键文件都在` : `缺：${missing.join('、')}`,
    '当前检出可能不完整，重新拉取仓库或检查 vendor 目录是否被部分忽略',
  );
}

// ── 2. 锁文件与分发清单 ────────────────────────────────────────────────────────
async function checkLock() {
  let lock;
  let dist;
  try {
    lock = JSON.parse(await readFile(join(pkgDir, 'upstream.lock.json'), 'utf8'));
    dist = JSON.parse(await readFile(join(pkgDir, 'distribution.json'), 'utf8'));
  } catch (error) {
    record('锁文件与分发清单自洽', false, `读取失败：${error?.message ?? error}`, '确认两个 JSON 文件存在且语法正确');
    return;
  }
  const problems = [];
  if (!lock?.upstream?.commit) problems.push('upstream.commit 缺失');
  if (!lock?.upstream?.version) problems.push('upstream.version 缺失');
  if (!lock?.upstream?.archive?.sha256) problems.push('upstream.archive.sha256 缺失');
  if (!lock?.python?.requires) problems.push('python.requires 缺失');
  if (lock?.upstream?.version && dist?.upstreamVersion && lock.upstream.version !== dist.upstreamVersion) {
    problems.push(`版本不一致（lock=${lock.upstream.version} distribution=${dist.upstreamVersion}）`);
  }
  if (!Array.isArray(dist?.alwaysShip) || dist.alwaysShip.length === 0) problems.push('distribution.alwaysShip 为空');
  record(
    '锁文件与分发清单自洽',
    problems.length === 0,
    problems.length === 0
      ? `提交 ${lock.upstream.commit.slice(0, 12)}、版本 ${lock.upstream.version}、Python ${lock.python.requires}`
      : problems.join('；'),
    '改 upstream.lock.json 与 distribution.json 时两边要一起改',
  );
}

// ── 3. 锁定版本 vs vendor 实际版本 ────────────────────────────────────────────
async function checkVendorVersion() {
  let lock;
  try {
    lock = JSON.parse(await readFile(join(pkgDir, 'upstream.lock.json'), 'utf8'));
  } catch {
    record('锁定的版本与 vendor 实际版本一致', false, '读不到 upstream.lock.json', '先修上一条');
    return;
  }
  let actual = null;
  try {
    const versionSource = await readFile(join(pkgDir, 'vendor/deeptutor/deeptutor/__version__.py'), 'utf8');
    const match = versionSource.match(/__version__\s*=\s*["']([^"']+)["']/);
    actual = match?.[1] ?? null;
  } catch (error) {
    record('锁定的版本与 vendor 实际版本一致', false, `读不到 vendor 版本：${error?.message ?? error}`, 'vendor 目录可能不完整');
    return;
  }
  const ok = actual !== null && actual === lock?.upstream?.version;
  record(
    '锁定的版本与 vendor 实际版本一致',
    ok,
    `lock=${lock?.upstream?.version} vendor=${actual}`,
    ok ? undefined : '改 upstream.lock.json 的 version，或确认 vendor 换对了没有',
  );
}

// ── 4. 找可用的 Python ────────────────────────────────────────────────────────
async function findPython() {
  const candidates = [];
  if (process.env.ZHIYUN_DEEPTUTOR_PYTHON) candidates.push(process.env.ZHIYUN_DEEPTUTOR_PYTHON);
  // 仓库自带的受管环境优先于系统解释器：它才是按 upstream.lock.json 装出来的那个
  const managed = join(root, '.runtime', 'deeptutor-py311', 'Scripts', 'python.exe');
  candidates.push(managed);
  candidates.push('python');
  candidates.push('py');
  candidates.push(join(root, '.runtime', 'deeptutor-py311', 'bin', 'python3'));

  const failures = [];
  for (const candidate of candidates) {
    const argv = candidate === 'py'
      ? ['-3.11', '-c', 'import sys;print(sys.version_info[:3])']
      : ['-c', 'import sys;print(sys.version_info[:3])'];
    const out = await run(candidate, argv, { timeoutMs: 15000 });
    if (out.code !== 0) {
      failures.push(`${candidate}：${out.stderr.split('\n')[0] || `退出码 ${out.code}`}`);
      continue;
    }
    const match = out.stdout.match(/\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) {
      failures.push(`${candidate}：输出无法解析`);
      continue;
    }
    const [, major, minor, patch] = match.map(Number);
    // 上游 pyproject.toml: requires-python = ">=3.11,<3.15"
    const ok = major === 3 && minor >= 11 && minor < 15;
    record(
      '找到可用的 Python',
      ok,
      `${candidate} → ${major}.${minor}.${patch}` + (ok ? '' : '（不满足上游要求的 >=3.11,<3.15）'),
      ok
        ? undefined
        : '用 py -3.11 -m venv .runtime/deeptutor-py311 建环境。注意本机默认 python 可能是 3.10，装不上上游。',
    );
    return ok ? candidate : null;
  }
  // 全部候选都起不来。要分清「没装 Python」和「装了但起不来」——
  // 受限环境里 spawn 会 EPERM，那不是环境缺东西，而是这里的进程策略不允许。
  const denied = failures.some((line) => /EPERM/.test(line));
  record(
    '找到可用的 Python',
    false,
    denied
      ? '候选解释器都无法启动（EPERM：当前受限环境不允许派生带管道的子进程）'
      : `候选解释器都不可用：${failures.join('；').slice(0, 200)}`,
    denied
      ? '这是运行环境限制而不是缺依赖：在正常终端里重跑本脚本，或直接用该解释器执行 python/deeptutor_bridge.py --selftest'
      : '先确认 Python 3.11–3.14 已安装：`py -0` 可以列出机器上的版本',
  );
  return null;
}

// ── 5. bridge 协议自检 ────────────────────────────────────────────────────────
async function checkBridgeSelfTest(pythonPath) {
  if (!pythonPath) {
    record('bridge 协议自检', false, '没有可用 Python，跳过', '先解决上一条');
    return;
  }
  const script = join(pkgDir, 'python', 'deeptutor_bridge.py');
  if (!(await exists(script))) {
    record('bridge 协议自检', false, `找不到 ${script}`, 'python/ 目录缺失');
    return;
  }
  const out = await run(pythonPath, [script, '--selftest'], { timeoutMs: 60000 });
  const ok = out.code === 0;
  const tail = (out.stdout + out.stderr).trim().split('\n').slice(-4).join(' | ');
  record(
    'bridge 协议自检',
    ok,
    ok ? tail || '退出码 0' : `退出码 ${out.code}：${tail}`,
    ok ? undefined : '这一步不依赖上游 import，失败说明桥自身有问题（语法/协议常量/stdio 处理）',
  );
}

// ── 6. 上游可 import ──────────────────────────────────────────────────────────
async function checkUpstreamImport(pythonPath) {
  if (quick) {
    record('上游模块可导入', true, '（--quick 跳过）');
    return;
  }
  if (!pythonPath) {
    record('上游模块可导入', false, '没有可用 Python，跳过', '先解决前面几条');
    return;
  }
  const vendorPath = join(pkgDir, 'vendor', 'deeptutor');
  const code = [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(vendorPath)})`,
    'info = {}',
    'try:',
    '    from deeptutor.__version__ import __version__',
    '    info["version"] = __version__',
    'except Exception as exc:',
    '    info["version_error"] = repr(exc)',
    'try:',
    '    import deeptutor.app.facade as f',
    '    info["facade"] = "ok"',
    'except Exception as exc:',
    '    info["facade_error"] = repr(exc)',
    'print(json.dumps(info, ensure_ascii=False))',
  ].join('\n');
  const out = await run(pythonPath, ['-c', code], { timeoutMs: 180000, cwd: vendorPath });
  let info = {};
  try {
    info = JSON.parse(out.stdout.trim().split('\n').pop() ?? '{}');
  } catch {
    info = {};
  }
  const ok = out.code === 0 && info.facade === 'ok';
  record(
    '上游模块可导入',
    ok,
    ok
      ? `deeptutor ${info.version}，门面可加载`
      : `版本=${info.version ?? info.version_error ?? '?'}；门面=${info.facade ?? info.facade_error ?? (out.stderr.trim().slice(-160) || '失败')}`,
    ok
      ? undefined
      : `按 requirements/server.txt 装依赖：${pythonPath} -m pip install -r packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/requirements/server.txt`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
await checkFiles();
await checkLock();
await checkVendorVersion();
const pythonPath = await findPython();
await checkBridgeSelfTest(pythonPath);
await checkUpstreamImport(pythonPath);

const failed = results.filter((r) => !r.ok);
if (asJson) {
  console.log(JSON.stringify({ ok: failed.length === 0, pythonPath, results }, null, 2));
} else {
  console.log('');
  if (failed.length === 0) {
    console.log(`全部 ${results.length} 项通过。`);
  } else {
    console.log(`有 ${failed.length} / ${results.length} 项未通过。`);
  }
}
process.exit(failed.length === 0 ? 0 : 1);
