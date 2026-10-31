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
const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHost } from './boot.js';
import { createLecturePdfHandler, createPdfExportHandler } from './pdf-export.js';

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
  await purgeStaleAuthCookies();
  win.loadURL(host.url).catch((error) => publish({ phase: 'error', detail: `打不开实例地址：${error.message}`, hint: '' }));
}

/**
 * 清掉**上一次启动**留下的鉴权 cookie。
 *
 * # 为什么必须清
 *
 * 宿主的鉴权方式是「一次性 token → 换一个 `dsh-auth-<随机串>` cookie」。
 * 那个 cookie **没有过期时间、也从不被回收**，而桌面壳每次启动都会生成
 * 一个**新 token**（端口也是随机的）。于是每启动一次就多一个 cookie，
 * 全部堆在同一个 origin（`127.0.0.1`）下。
 *
 * 实测：攒到 70 个时，请求头超过 16KB，宿主直接回 **431
 * Request Header Fields Too Large** —— 而且返回的是**空 body**
 * （`<html><head></head><body></body></html>`），前端一个 script 都加载不了。
 * 在用户眼里就是"一打开就白屏"，但进程、端口、日志全都正常。
 *
 * # 为什么在 `loadURL` 之前清
 *
 * cookie 是随请求发的。必须在新 token 换 cookie **之前**把旧的清掉，
 * 否则这一次请求就已经带着超长的头了。
 *
 * 只清 `dsh-auth-` 前缀的：那是宿主专用的鉴权 cookie，清掉不影响任何
 * 用户态数据（规划、笔记都存在 profile 目录里，与 cookie 无关）。
 */
async function purgeStaleAuthCookies() {
  try {
    const cookies = await win.webContents.session.cookies.get({});
    const stale = cookies.filter((item) => item.name.startsWith('dsh-auth-'));
    if (stale.length === 0) return;
    // 逐个删除：`remove` 要完整的 URL + 名字。
    // 单个删不掉不要紧（可能已被别处删了），但要**数一下**，别声称清了却没清。
    const results = await Promise.all(stale.map((item) => win.webContents.session.cookies.remove(
      `http://${item.domain.replace(/^\./, '')}${item.path ?? '/'}`,
      item.name,
    ).then(() => true).catch(() => false)));
    const done = results.filter(Boolean).length;
    if (done === stale.length) {
      log(`已清理 ${done} 个上次启动留下的鉴权 cookie`);
    } else {
      log(`清理旧鉴权 cookie：${done}/${stale.length} 成功（其余可能已失效，不影响启动）`);
    }
  } catch (error) {
    // 清不掉不该拦住启动：431 是"头太大"，不是"不能工作"的致命错误
    log(`清理旧鉴权 cookie 失败（不影响启动）：${error?.message ?? error}`);
  }
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
  /**
   * 兜底：加载页一加载完就把它显示出来。
   *
   * # 为什么不能只等 `ready-to-show`
   *
   * `ready-to-show` 只保证在**首次渲染**时触发一次，而这个窗口会导航两次：
   * 先 `loadFile(launcher.html)`（我们自己的"正在启动"页），拿到宿主地址后再
   * `loadURL(host.url)` 换成真实页面。两次导航夹在一起，那个事件可能落在尴尬
   * 的位置上，甚至不再触发。
   *
   * 实测后果：窗口保持 `show: false` 的初始状态 —— 位置 (-16000, -16000)、
   * 尺寸 157×25、`IsWindowVisible` 为 false。用户看到的是"一打开就白屏"，
   * 而实际上窗口**从来没有被显示过**。
   *
   * 加载页本身就是内容，让它一加载完就可见，用户至少能看到"正在启动…"，
   * 而不是一个不存在的窗口。之后的 `loadURL` 是在已可见的窗口里换内容，
   * 不再依赖任何事件。
   */
  win.webContents.once('did-finish-load', () => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  });
  win.on('closed', () => { win = null; });
  if (SMOKE) {
    /**
     * ⚠️ 三条都要满足，少一条就会误判：
     *
     * 1. **用 `on` 而不是 `once`** —— 这个窗口会加载两次：先 `launcher.html`
     *    （file:），再换成宿主地址（http:）。早先用 `once` 会在加载页那次就触发，
     *    smoke 永远看到 `file:` 并报 FAIL。
     * 2. **不能要求 URL 里带 token** —— 宿主的鉴权握手会 `302` 到**不带 token**
     *    的干净地址（实测最终停在 `http://127.0.0.1:<port>/`）。早先按
     *    `/token=/` 过滤，结果把真正加载成功的那一次**全过滤掉了**，
     *    日志里连 smoke 行都不出现，比报 FAIL 更难查。
     * 3. **等正文真的出现** —— 这才是"进去了"的证据。只看 `did-finish-load`
     *    不够：它可能在首屏渲染前触发，那一刻 `visible` 还是 false、
     *    `document.title` 也还是宿主的默认标题。
     */
    let settled = false;
    win.webContents.on('did-finish-load', async () => {
      if (settled) return;
      const current = win.webContents.getURL();
      // 加载页（file:）不算，只认 http(s) 的产品页
      if (!/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(current)) return;

      // 轮询等正文出现（最多 15 秒），而不是盲等一拍
      let textLength = 0;
      for (let i = 0; i < 30; i += 1) {
        textLength = await win.webContents
          .executeJavaScript('(document.body && document.body.innerText ? document.body.innerText : "").length')
          .catch(() => 0);
        if (textLength > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (settled) return;
      settled = true;

      const url = current.replace(/token=[^\s&]+/, 'token=***');
      const title = await win.webContents.executeJavaScript('document.title').catch(() => '');
      /**
       * 窗口到底有没有显示出来。
       *
       * ⚠️ 这一条以前**没被检查**，于是「窗口从不显示」被当成了"白屏"报上来，
       *    排查绕了一大圈才在窗口位置上发现问题。smoke 的意义就是**一次运行
       *    就能看出坏没坏**，所以它必须同时回答"进去了没有"和"看得见没有"。
       */
      const visible = win.isVisible();
      const ok = visible && textLength > 0;
      log(`smoke ${ok ? 'OK' : 'FAIL'} url=${url} title=${title} visible=${visible} text=${textLength}`);
      quitting = true;
      stopHost();
      app.exit(ok ? 0 : 1);
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
    // 讲义与题库共用同一个处理器：同源、主框架、忙碌互斥、路径净化只维护一份。
    // 旧的 `lecture:pdf-save` 保留给已发布的壳与旧前端（它固定 kind=lecture）。
    const pdfExport = createPdfExportHandler({getWindow:()=>win,getHostUrl:()=>host?.url,dialog,downloads:()=>app.getPath('downloads')});
    ipcMain.handle('zhiyun:pdf-save', pdfExport);
    ipcMain.handle('lecture:pdf-save', createLecturePdfHandler({getWindow:()=>win,getHostUrl:()=>host?.url,dialog,downloads:()=>app.getPath('downloads')}));
    void boot();
  });

  app.on('window-all-closed', () => app.quit());
  // 退出时一定要收掉宿主，别留一个后台实例占着端口与数据目录。
  app.on('before-quit', () => { quitting = true; stopHost(); });
}
