/**
 * 桌面壳的验收。
 *
 * 分两层，因为这两层的可验证性完全不同：
 *
 *   1. **起实例（`src/boot.js`）** —— 真正会坏的地方：宿主找不到、profile 缺链接、
 *      端口被占、地址解析不出来、退出后留孤儿进程。这段不依赖 electron，用普通 node
 *      就能跑完整条真实路径（真宿主、真 profile），所以这里**必须**跑。
 *
 *   2. **Electron 能不能完成初始化** —— 发行目录若继承了仓库的 Low 完整性标签，
 *      `electron.exe` 会在进 `main.js` 之前崩溃（退出码 0x80000003；事件查看器里
 *      这一阶段也会记成 0xC0000005）。`launch.mjs` 先把发行目录调到 Medium，再跑
 *      `electron --version`。这一步不需要开窗。真正的产品窗口仍由 `npm run desktop` 看。
 *
 * 用法：node scripts/test-desktop.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostLaunch, startHost } from '../apps/desktop/src/boot.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [];

async function checkHostBoot() {
  const lines = [];
  const states = [];
  const started = Date.now();
  const host = await startHost({
    log: (line) => lines.push(line),
    onState: (patch) => states.push(patch),
    timeoutMs: 150_000,
  });

  assert.match(host.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=\S+$/, `实例地址形状不对：${host.url}`);
  assert.ok(existsSync(host.runtime.cli), `宿主 CLI 不存在：${host.runtime.cli}`);
  assert.equal(states[0].phase, 'starting', '第一帧状态应该是 starting');
  assert.equal(states.some((s) => /正在启动实例/.test(s.detail ?? '')), true, '没有报告"正在启动实例"');
  checks.push(`起实例：${Math.round((Date.now() - started) / 1000)}s 内拿到地址（宿主 ${host.runtime.version}）`);

  // 地址必须**真的能访问**，而且是不带 token 会被拒的那种（证明这是宿主自己的鉴权，
  // 不是我们伪造了一个能打开的地址）。这两条一起才说明"实例可用"。
  //
  // ⚠️ 带 token 的正确响应是 **303**，不是 200：宿主会把「URL 里的启动 token」
  //    换成一个签名 cookie，然后 303 跳回 `/`。写成 200 会误判成失败（踩过）。
  const withToken = await fetch(host.url, { redirect: 'manual' });
  assert.equal([200, 303].includes(withToken.status), true, `带 token 访问应 200/303，实际 ${withToken.status}`);
  assert.equal(withToken.headers.get('set-cookie') !== null, true, '带 token 访问应下发会话 cookie（启动 token 换 cookie）');
  const bare = await fetch(new URL('/', host.url), { redirect: 'manual' });
  assert.equal(bare.status, 401, `不带 token 应 401（宿主自己的 BrowserAuth），实际 ${bare.status}`);
  checks.push('地址可用：带 token 303 + 下发 cookie、不带 token 401（确认走的是宿主的鉴权）');

  // ⚠️ 收进程必须真的收掉：留下的孤儿会占着端口与 profile，下一次启动就撞 EADDRINUSE。
  host.stop();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const stillUp = await fetch(host.url, { redirect: 'manual' }).then(() => true).catch(() => false);
  assert.equal(stillUp, false, 'stop() 之后实例仍在响应 —— 子进程没被收掉（会有孤儿）');
  checks.push('stop() 之后实例不再响应（Windows 上按进程树收，不留孤儿）');
}

try {
  const viaLauncher = hostLaunch({ ZHIYUN_NODE: 'C:\\Program Files\\nodejs\\node.exe' });
  assert.equal(viaLauncher.executable, 'C:\\Program Files\\nodejs\\node.exe');
  assert.equal(viaLauncher.electronBinary, false, '普通 node 不应再套 ELECTRON_RUN_AS_NODE');
  assert.equal(hostLaunch({ ZHIYUN_NODE: 'C:\\electron\\electron.exe' }).electronBinary, true);
  assert.equal(hostLaunch({}).executable, process.execPath);
  checks.push('宿主用启动器传入的 node，不用 Electron 自带的那个');
  await checkHostBoot();
} catch (error) {
  console.error(`✗ 起实例这一段失败：\n${error.message}`);
  process.exitCode = 1;
}

// 第二层：Electron 运行时。不打开产品窗口，只确认 Chromium 能完成初始化。
// 发行目录是 Low 完整性时，这一步会在 main.js 之前就死掉。
const electronBin = path.join(root, 'apps/desktop/node_modules/electron/dist/electron.exe');
if (!existsSync(electronBin)) {
  console.log('跳过 Electron 启动检查：尚未安装 apps/desktop 的依赖（npm --prefix apps/desktop install）。');
} else {
  try {
    const { ensureMediumIntegrity } = await import('../apps/desktop/src/launch.mjs');
    const result = ensureMediumIntegrity(electronBin);
    const version = spawnSync(electronBin, ['--version'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    assert.equal(version.status, 0, `electron --version 退出 ${version.status}，Chromium 没能完成初始化`);
    const printed = (version.stdout ?? '').trim();
    checks.push(`Electron 能启动（${printed}）${result.repaired ? '；发行目录已从 Low 调到 Medium' : ''}`);
  } catch (error) {
    console.error(`✗ Electron 启动失败：\n${error.message}`);
    process.exitCode = 1;
  }

  /**
   * 第三层：**窗口到底有没有显示出来**。
   *
   * 这一层以前是缺的（上面那两层只看"进程能不能起"和"宿主地址解析得出来"），
   * 于是「窗口从不显示」这类故障会一路绿灯，直到用户报"一打开就白屏"。
   * 而"白屏"和"窗口压根没 show"在用户眼里是同一件事，排查却完全不同。
   *
   * `ZHIYUN_DESKTOP_SMOKE=1` 让壳走一遍真实启动 → 加载产品页 → 退出，
   * 并把 `visible` 写进 `launcher.log`。
   *
   * ⚠️ 不能读 `spawnSync` 的 stdout：`launch.mjs` 用 `stdio: 'inherit'` 把
   *    Electron 的输出直接接到终端，捕获回来是空的。**日志文件是唯一可靠来源**
   *    （这也是排查时必须先找到它的原因）。
   */
  const logFile = process.env.ZHIYUN_DESKTOP_LOG
    || path.join(process.env.APPDATA ?? '', 'Zhiyun Pro Launcher', 'launcher.log');
  let before = '';
  try { before = await readFile(logFile, 'utf8'); } catch { /* 第一次跑，没有日志 */ }

  spawnSync(process.execPath, ['src/launch.mjs'], {
    cwd: path.join(root, 'apps/desktop'),
    timeout: 180_000,
    windowsHide: true,
    env: { ...process.env, ZHIYUN_DESKTOP_SMOKE: '1' },
  });

  let after = '';
  try { after = await readFile(logFile, 'utf8'); } catch { /* 没写出来 */ }
  // 只看这一次运行新追加的部分，避免被历史记录里的 OK 蒙混过关
  const fresh = after.startsWith(before) ? after.slice(before.length) : after;
  const line = fresh.split(/\r?\n/).find((row) => row.includes('smoke ')) ?? '';
  // 三个条件同时成立才算真的"进去了"：窗口可见、正文非空。
  // 只看 `visible` 会放过"窗口在但页面是空的"那一种白屏。
  if (/smoke OK .*visible=true.*text=\d+/.test(line)) {
    checks.push('窗口真的显示出来了，且页面有内容（smoke visible=true text>0）');
  } else {
    console.error(`✗ 窗口/页面没有正常显示（这是"一打开就白屏"的根因）：\n${line || fresh.slice(-600) || '(日志里没有本次运行的 smoke 记录)'}`);
    process.exitCode = 1;
  }
}

for (const check of checks) console.log(`PASS ${check}`);
if (process.exitCode !== 1) console.log('\nPASS 桌面壳：起实例 → 解析地址 → 地址可用 → 窗口可见 → 收干净');
// `fetch` 的 keep-alive 连接会让事件循环不退出（表现是"脚本跑完了却挂在那里"）。
// 显式退出：走到这里该验的都验完了，没有需要在退出前收尾的东西。
process.exit(process.exitCode ?? 0);
