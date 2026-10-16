// 启动宿主的逻辑。**刻意不 import electron** —— 于是它能在普通 node 下被测试。
//
// 拆出来的原因很实际：开窗口依赖 Electron 运行时，而那个运行时自己会在进 main.js
// 之前就崩（发行目录若是 Low 完整性，见 `launch.mjs`）。「壳到底能不能把实例
// 起起来」才是真正会坏的地方 —— 宿主找不到、profile 缺链接、端口被占、地址解析
// 不出来。把这些留在 main.js 里，就等于**整段逻辑只能靠肉眼看窗口**来验证。
// 分开之后 `scripts/test-desktop.mjs` 能用真宿主跑完整条启动路径。
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { hostArgs, initialize, missingClientBundles, lock } from '../../../scripts/profile.mjs';

/** 宿主启动最长等多久。头一次跑要建 profile、链目录，给宽一点。 */
export const BOOT_TIMEOUT_MS = 120_000;
/** 日志尾巴留多少行 —— 出错时它比"启动失败"四个字有用得多。 */
export const LOG_TAIL = 40;

/**
 * 收掉子进程。Windows 上必须杀**进程树**：dsh 自己还会拉子进程，只杀父会留孤儿
 * （孤儿会继续占着端口与 profile，下一次启动就撞 EADDRINUSE）。
 *
 * ⚠️ 杀完还要**拆掉管道并 unref**：否则那三个 stdio 句柄会让宿主进程的事件循环
 *    一直活着 —— 表现是"脚本跑完了却不退出"（踩过：冒烟测试挂在那里不动，
 *    但没有任何报错，因为逻辑其实已经跑完了）。
 */
export function killTree(child) {
  if (!child) return;
  const { pid } = child;
  if (pid) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else { try { process.kill(pid, 'SIGTERM'); } catch { /* 已经没了 */ } }
  }
  for (const stream of [child.stdout, child.stderr, child.stdin]) {
    try { stream?.destroy(); } catch { /* 已经关了 */ }
  }
  try { child.unref(); } catch { /* 已经没了 */ }
}

/**
 * 找一个空闲端口。
 *
 * 不写死 3091：那个端口常被「命令行起的那个实例」占着，撞上会 EADDRINUSE，
 * 而 `profile.mjs` 的注释记过这个后果 —— 宿主起不来还会把一串依赖它的插件拖垮。
 * `ZHIYUN_PORT` 显式给了就听它的（与命令行行为一致）。
 */
export async function freePort(requested = process.env.ZHIYUN_PORT) {
  if (requested) return Number(requested);
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * 用哪个可执行文件拉起宿主。
 *
 * 必须是普通 node，不能是 Electron 自带的那个。`dsh --version` 在
 * `ELECTRON_RUN_AS_NODE=1` 下能过，但宿主的原生模块会核对运行时指纹：
 * Electron 44.8.0 报的是 Node 24.22.0、V8 `…-electron.0`，不在它认的
 * 43.0.0 / 44.0.0 / 45.0.0-alpha.6 里，于是 profile 直接退出码 1
 * （`Unsupported/no-context`）。`npm start` 用的是系统 node，所以能起来。
 *
 * `launch.mjs` 把那个 node 的路径放进 `ZHIYUN_NODE`。测试直接在 node 下跑时
 * 没有这个变量，`process.execPath` 已经是 node。
 *
 * @param env - 默认 `process.env`。测试传入一份假环境。
 * @returns `{ executable, electronBinary }`。只有可执行文件本身是 electron 时才需要 `ELECTRON_RUN_AS_NODE`。
 */
export function hostLaunch(env = process.env) {
  const executable = env.ZHIYUN_NODE || process.execPath;
  const base = path.basename(executable).toLowerCase();
  return { executable, electronBinary: base === 'electron.exe' || base === 'electron' };
}

/**
 * 起一个 DSH 实例，等它打印出地址。
 *
 * @param options.log - 收日志行的回调（壳写文件，测试写内存）。
 * @param options.onState - 状态回调：`{ phase, detail, hint }`。
 * @param options.timeoutMs - 覆盖等待上限（测试用）。
 * @returns `{ url, runtime, stop }`；失败时抛错，错误信息面向用户可读。
 */
export async function startHost({ log = () => {}, onState = () => {}, timeoutMs = BOOT_TIMEOUT_MS } = {}) {
  onState({ phase: 'starting', detail: '正在定位宿主与 profile…', hint: '' });
  // 只读复用产品脚本：它负责「宿主在哪、版本对不对、profile 该有哪些链接」。
  // 这一步是幂等的 —— 已有配置原样保留，缺的补上，用户自己放的实体目录绝不覆盖。
  const runtime = await initialize({ home: process.env.ZHIYUN_DSH_HOME });

  // 缺客户端产物时宿主**能起来**，但页面是空白的 —— 那种失败最难判断
  // （窗口开了、地址也有了、就是没内容）。所以起进程之前先说清楚。
  const missing = await missingClientBundles();
  if (missing.length > 0) {
    throw new Error(`这些包的客户端产物还没构建：${missing.join('、')}。先在仓库里跑 npm run build。`);
  }

  const port = await freePort();
  onState({ phase: 'starting', detail: `正在启动实例（端口 ${port}）…`, hint: `宿主 ${runtime.app}` });
  log(`宿主 ${runtime.app}`);
  log(`profile ${runtime.profile}`);

  const args = ['--profile', lock.profile, ...hostArgs(['--port', String(port)])];
  const launch = hostLaunch();
  const env = { ...process.env, DSH_HOME: runtime.home };
  // 只有真的在用 electron.exe 当 node 时才加这个变量。加在普通 node 上没有意义，
  // 而且会让宿主环境和 `npm start`（`scripts/profile.mjs` 的 `runHost`）不一致。
  if (launch.electronBinary) env.ELECTRON_RUN_AS_NODE = '1';
  else delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(launch.executable, [runtime.cli, ...args], {
    cwd: path.join(runtime.home, 'workspace'),
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return await new Promise((resolve, reject) => {
    let tail = '';
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish(reject, new Error(`等了 ${Math.round(timeoutMs / 1000)} 秒还没看到实例地址。`));
    }, timeoutMs);

    const consume = (chunk) => {
      const text = chunk.toString();
      tail = (tail + text).split(/\r?\n/).slice(-LOG_TAIL).join('\n');
      for (const line of text.split(/\r?\n/)) if (line.trim()) log(line.trim());
      const match = (tail + text).match(/dsh web: (http:\/\/\S+)/);
      // URL 自带一次性 token，直接访问就会完成换 cookie 的握手（宿主自己的 BrowserAuth）。
      if (match) finish(resolve, { url: match[1], runtime, stop: () => killTree(child) });
    };
    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', (error) => finish(reject, new Error(`启动宿主失败：${error.message}`)));
    child.on('exit', (code, signal) => {
      finish(reject, new Error(`实例退出了（${signal ? `信号 ${signal}` : `退出码 ${code}`}）。${
        tail.trim() ? `\n${tail.trim()}` : ''}`));
    });
  });
}
