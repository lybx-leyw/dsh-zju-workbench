// 把 electron.exe 拉起来之前要做的事。必须写在这个进程里，不能写在 main.js：
// 崩溃发生在应用代码开始执行之前，写在那边来不及。
//
// 仓库根目录带有显式的 Low 完整性标签，并且 (OI)(CI) 往下继承，electron.exe 也是 Low。
// Windows 上新进程的完整性 = min(父进程, exe 文件上的标签）。父进程是 Medium 的 node，
// exe 却是 Low，于是浏览器进程以 Low 启动。Chromium 的沙箱在这个级别上初始化会直接
// CHECK 失败，进程退出码 0x80000003，主进程还没跑到第一行应用代码。窗口不会出现，
// launcher.log 也不会写出来。事件查看器里同一阶段的失败还会记成 electron.exe 自身的
// 访问违规 0xC0000005，偏移落在它自己的映像里。
//
// `--no-sandbox` 能绕开这个检查，但渲染进程就没有操作系统沙箱了。这里只把 Electron
// 的发行目录调到 Medium，源码树保持原样。npm 重装会让 dist 重新继承 Low，所以每次
// 启动都看一眼；已经是 Medium 就不做任何事。
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');

const LOW_INTEGRITY = /Low Mandatory Level/i;

export function electronExecutable() {
  return require('electron');
}

function readAcl(target) {
  const listed = spawnSync('icacls', [target], { encoding: 'utf8', windowsHide: true });
  return {
    status: listed.status,
    text: `${listed.stdout ?? ''}\n${listed.stderr ?? ''}`,
    error: listed.error,
  };
}

/**
 * 若 `exe` 是 Low 完整性，把其所在的发行目录调到 Medium。
 *
 * @returns {{ repaired: boolean, sandbox: boolean, detail?: string }}
 *   `sandbox: false` 表示没能升上去，调用方应退回 `--no-sandbox`，否则进程还是会崩。
 */
export function ensureMediumIntegrity(exe = electronExecutable()) {
  if (process.platform !== 'win32') return { repaired: false, sandbox: true };
  const listed = readAcl(exe);
  if (listed.error || listed.status !== 0) return { repaired: false, sandbox: true };
  if (!LOW_INTEGRITY.test(listed.text)) return { repaired: false, sandbox: true };

  const dist = path.dirname(exe);
  const fixed = spawnSync(
    'icacls',
    [dist, '/setintegritylevel', '(OI)(CI)M', '/T', '/C', '/Q'],
    { encoding: 'utf8', windowsHide: true },
  );
  const after = readAcl(exe);
  if (fixed.status !== 0 || LOW_INTEGRITY.test(after.text)) {
    return {
      repaired: false,
      sandbox: false,
      detail: `${fixed.stdout ?? ''}${fixed.stderr ?? ''}${after.text}`.trim(),
    };
  }
  return { repaired: true, sandbox: true };
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  const exe = electronExecutable();
  const result = ensureMediumIntegrity(exe);
  if (result.repaired) {
    console.error('Electron 发行目录原先是 Low 完整性，已调整为 Medium。否则 Chromium 沙箱会在应用代码运行前崩溃。');
  }
  const args = [];
  if (!result.sandbox) {
    console.error('无法把 Electron 发行目录调到 Medium 完整性，退回 --no-sandbox 启动。渲染进程将没有操作系统沙箱。');
    if (result.detail) console.error(result.detail);
    args.push('--no-sandbox');
  }
  args.push(appRoot, ...process.argv.slice(2));
  // 壳里的宿主必须用这个 node，不能用 Electron 自带的那个。见 boot.js 的 hostLaunch。
  const child = spawn(exe, args, {
    cwd: appRoot,
    stdio: 'inherit',
    windowsHide: false,
    env: { ...process.env, ZHIYUN_NODE: process.execPath },
  });
  child.on('error', (error) => {
    console.error(`启动 Electron 失败：${error.message}`);
    process.exit(1);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) child.kill(signal);
    });
  }
  child.on('close', (code, signal) => {
    process.exit(signal ? 1 : code ?? 1);
  });
}
