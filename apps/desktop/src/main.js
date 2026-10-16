// 智云 Pro 桌面壳 —— **只是快捷入口**。
//
// 它只做两件事：起一个 DSH 实例、把它开在窗口里。
//   · 不打包、不安装 dsh、不生成 .exe；
//   · 不管理 profile 的内容（宿主在哪、profile 长什么样，**只读地复用**
//     `scripts/profile.mjs`，也就是 `npm start` 走的那条路）。
// 于是壳里打开的与命令行起的是**同一份数据、同一个 profile**，不是一个平行世界。
//
// 本文件刻意只剩 GUI 那一层：起实例的逻辑（真正会坏的地方）在 `boot.js`，那里
// 不依赖 electron，因此能在普通 node 下被测试。Electron 进程本身由 `launch.mjs`
// 拉起 —— 发行目录若是 Low 完整性，崩溃发生在本文件执行之前，修在这里来不及。
//
// 宿主不用 Electron 自带的 node。那份运行时能跑 `dsh --version`，但原生模块会拒绝
// 它的指纹（见 `boot.js` 的 `hostLaunch`）。`launch.mjs` 把启动器自己的 node 传进来，
// 也就是 `npm start` 用的那一个，不需要另外装一份。
//
// ⚠️ 在 ESM 主进程里拿 Electron API 只有一条可靠的路：`createRequire` + `require`。
//    试过、都**不行**的两种写法（都会让主进程在跑第一行代码前就死掉，且没有输出）：
//      · `import { app } from 'electron'` —— electron 是 CJS 包，ESM 下没有具名导出；
//      · `import electron from 'electron'` —— 拿到的 default **不是**那个 API 对象，
//        解构出来全是 undefined，第一次用 `app.xxx` 就抛 "Cannot read properties of undefined"。
//    本包是 `"type": "module"`，所以用 createRequire 而不是把文件改成 .cjs。
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from './boot.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * 冒烟模式：走**完整的**启动路径，页面画完之后退出并写结论。
 *
 * 给 `scripts/test-desktop.mjs` 用 —— 见那个脚本的说明。需要图形会话才能真正开窗。
 * 进程得由 `launch.mjs` 拉起（或发行目录已经是 Medium 完整性），否则到不了这里。
 */
const SMOKE = process.env.ZHIYUN_DESKTOP_SMOKE === '1';

/**
 * 日志文件。
 *
 * ⚠️ 为什么不直接 `console.log`：Windows 上 `electron.exe` 是 **GUI 子系统**程序，
 *    stdout 不会回传给父进程（管道里收不到任何东西，实测过）。于是"壳为什么没起来"
 *    在命令行里完全看不见 —— 而一个启动失败却说不清原因的启动器没有用。
 *    写成文件两边都成立：用户能找到它，脚本与测试也能读它。
 *
 * 位置优先用 `ZHIYUN_DESKTOP_LOG`（测试要一个确定的路径），否则落在 Electron 的
 * userData 目录里（每个用户自己的 AppData，不污染仓库）。
 */
let logFile = process.env.ZHIYUN_DESKTOP_LOG ?? '';
function log(line) {
  try {
    if (!logFile) {
      mkdirSync(app.getPath('userData'), { recursive: true });
      logFile = path.join(app.getPath('userData'), 'launcher.log');
    }
    appendFileSync(logFile, `[${new Date().toISOString()}] ${line}\n`, 'utf8');
  } catch { /* 写不进去就算了：日志失败不该影响启动 */ }
}

let win = null;
let host = null;
let quitting = false;
/** 给渲染进程看的启动状态。`phase`: starting | error（ready 时直接跳走，不渲染）。 */
let state = { phase: 'starting', detail: '正在准备…', log: [], hint: '' };

function publish(patch = {}) {
  state = { ...state, ...patch };
  if (patch.detail) log(`${patch.phase ?? state.phase}: ${patch.detail}`);
  if (win && !win.isDestroyed()) win.webContents.send('launcher:state', state);
}

/** 记一行宿主输出，同时更新给加载页看的那份尾巴。 */
function noteHostLine(line) {
  const lines = [...(state.log ?? []), line].slice(-40);
  publish({ log: lines });
}

function stopHost() {
  const running = host;
  host = null;
  running?.stop();
}

async function boot() {
  stopHost();
  publish({ phase: 'starting', detail: '正在准备…', log: [], hint: '' });
  try {
    host = await startHost({ log: noteHostLine, onState: publish });
  } catch (error) {
    return publish({
      phase: 'error',
      detail: error.message,
      hint: '先在仓库里跑一次 npm start 确认命令行能起来；宿主与 profile 由 scripts/profile.mjs 负责。',
    });
  }
  // token 是短时凭据：日志里抹掉，别把可用地址留在磁盘上。
  log(`实例地址 ${host.url.replace(/token=[^\s&]+/, 'token=***')}`);
  publish({ phase: 'ready', hint: `宿主 ${host.runtime.app}` });
  win.loadURL(host.url).catch((error) => publish({ phase: 'error', detail: `打不开实例地址：${error.message}`, hint: '' }));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: '智云 Pro',
    backgroundColor: '#f7f7f5',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // 产品页是本地实例，但**仍然按不可信内容对待**：壳不给它任何 node 能力，
      // 它自己需要什么都走 HTTP。sandbox 打开。
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { win = null; });
  if (SMOKE) {
    win.webContents.once('did-finish-load', async () => {
      const url = win.webContents.getURL().replace(/token=[^\s&]+/, 'token=***');
      const title = await win.webContents.executeJavaScript('document.title').catch(() => '');
      // 落到 file: 说明还停在我们自己的加载页 —— 那是"没进去"，不是成功。
      const landed = !win.webContents.getURL().startsWith('file:');
      log(`smoke ${landed ? 'OK' : 'FAIL'} url=${url} title=${title}`);
      quitting = true;
      stopHost();
      app.exit(landed ? 0 : 1);
    });
  }
  // 页面里的外链交给系统浏览器，不要在窗口里开新窗。
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // 没有菜单栏（这是快捷入口，不是 IDE），但留两个开发时常用的键。
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') { win.webContents.toggleDevTools(); event.preventDefault(); }
    if (input.key.toLowerCase() === 'r' && (input.control || input.meta)) { win.webContents.reload(); event.preventDefault(); }
  });
  void win.loadFile(path.join(here, 'launcher.html'));
}

// 只允许一个实例：第二次启动应该把已有窗口叫到前面，而不是再起一个宿主
// （两个实例抢同一份 profile 与数据目录是要出问题的）。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  Menu.setApplicationMenu(null);
  app.whenReady().then(() => {
    createWindow();
    ipcMain.on('launcher:retry', () => { void boot(); });
    ipcMain.handle('launcher:snapshot', () => state);
    void boot();
  });

  app.on('window-all-closed', () => app.quit());
  // 退出时一定要收掉宿主，别留一个后台实例占着端口与数据目录。
  app.on('before-quit', () => { quitting = true; stopHost(); });
}
