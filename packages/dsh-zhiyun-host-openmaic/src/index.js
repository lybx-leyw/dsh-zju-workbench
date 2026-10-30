/**
 * OpenMAIC 上游服务宿主。
 *
 * # 为什么是「托管一个进程」而不是「移植一份代码」
 *
 * 上游（https://github.com/THU-MAIC/OpenMAIC）从 1.2.0 起是 **server-first** 的：
 * 课堂生成跑在服务端进程里，关掉标签页也继续跑；播放引擎、多智能体对话、
 * PPTX / MP4 导出全部挂在它自己的 `/api/*` 路由与 SSE 上。
 *
 * 这意味着「功能无损」与「把组件搬进我们的前端」是互斥的。任何把 UI 拆进本仓
 * React 插件的做法都只保住了外观：界面能画出来，点下去每个按钮都 404。
 * 因此这里的选择是**原样托管**：源码逐字节 vendor 进来（见 upstream.lock.json），
 * 起它自己的 Next.js 服务，页面用同源 iframe 嵌。
 *
 * 这与 dsh-zhiyun-host-deeptutor 是同一套取舍：业务包只调 `ctx.zhiyunOpenMAIC`，
 * 不 import vendor 下的任何东西；上游换版只改锁文件。
 *
 * # ⚠️ 它**不是**一个可选的锦上添花组件
 *
 * 没有 Postgres 时上游会打印修复方式并以退出码 1 直接退出（不会降级）。所以
 * `status()` 必须如实报出「数据库没起来」，而不是给一个看起来健康的 ready ——
 * 否则用户看到页面白屏，却不知道是数据库没起。
 *
 * # 生命周期
 *
 * `apply()` 永不抛错：上游没装、依赖没装、端口被占，都只体现为 status 里的
 * 状态与原因。抛错会让整个 profile 的 bundle 一起挂掉，那是拿一个可选页面
 * 换掉整个工作台。
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createHandler, ROUTE_PREFIX } from './routes.js';

export const name = 'zhiyun-openmaic';
export const inject = ['profileContext'];

const VENDOR_PATH = fileURLToPath(new URL('../vendor/openmaic', import.meta.url));
const LOCK_PATH = fileURLToPath(new URL('../upstream.lock.json', import.meta.url));

/** 上游默认端口；被占时由 `pickPort()` 找一个空闲的。 */
const DEFAULT_PORT = 3000;

/**
 * 托管状态机。
 *
 * `not-vendored` 与 `missing-deps` 是**安装问题**，`no-database` 是**配置问题**，
 * 三者要分开报：修法完全不同（跑 vendor:fetch / 跑 pnpm install / 起数据库）。
 */
const STATE = Object.freeze({
  NOT_VENDORED: 'not-vendored',
  MISSING_DEPS: 'missing-deps',
  NO_DATABASE: 'no-database',
  STOPPED: 'stopped',
  STARTING: 'starting',
  RUNNING: 'running',
  FAILED: 'failed',
});

export function apply(ctx, config = {}) {
  // 配置来源有三处（profile 的 cordis.patch.yml 覆盖、环境变量、包内默认）。
  // 前两处都为空时状态会报 `no-database`，而「为什么没读到」只有在日志里看得见 ——
  // 所以这里把**读到的键名**打出来（不打印值：连接串可能带口令）。
  ctx.logger?.info?.(`[zhiyun-openmaic] 配置键：${Object.keys(config ?? {}).join(', ') || '(空)'}`);
  console.log(`[zhiyun-openmaic] apply 收到配置键：${Object.keys(config ?? {}).join(', ') || '(空)'}`);
  const dataDir = config.dataDir ?? join(ctx.profileContext.dir, 'data/zhiyun-openmaic');
  const logger = config.logger ?? {
    debug: (...args) => ctx.logger?.debug?.('[zhiyun-openmaic]', ...args),
    info: (...args) => ctx.logger?.info?.('[zhiyun-openmaic]', ...args),
    warn: (...args) => ctx.logger?.warn?.('[zhiyun-openmaic]', ...args),
    error: (...args) => ctx.logger?.error?.('[zhiyun-openmaic]', ...args),
  };

  /** 运行时事实；`status()` 从这里读，探测失败也只落成状态，不抛。 */
  const facts = {
    state: STATE.STOPPED,
    reason: null,
    port: config.port ?? DEFAULT_PORT,
    pid: null,
    databaseUrl: null,
    version: null,
    startedAt: null,
    lastError: null,
  };

  let child = null;
  let disposed = false;

  // 目录创建失败不抛：盘满/权限问题应该表现为 status，而不是启动失败。
  const ready = mkdir(dataDir, { recursive: true }).catch((error) => {
    logger.warn('无法创建 OpenMAIC 数据目录', error?.message ?? error);
  });

  /** 读锁文件里的上游版本与仓库地址；读不到不算错误（status 会如实报 unknown）。 */
  const readLock = async () => {
    try {
      const lock = JSON.parse(await readFile(LOCK_PATH, 'utf8'));
      facts.version = lock?.upstream?.version ?? null;
      return lock;
    } catch {
      return null;
    }
  };

  /** 上游源码在不在、依赖装没装 —— 只看文件系统，不起进程。 */
  const inspectInstall = () => {
    if (!existsSync(join(VENDOR_PATH, 'package.json'))) {
      return { ok: false, state: STATE.NOT_VENDORED, reason: '上游源码快照缺失：运行 `npm run vendor:fetch -- --only openmaic`' };
    }
    if (!existsSync(join(VENDOR_PATH, 'node_modules'))) {
      return { ok: false, state: STATE.MISSING_DEPS, reason: '上游依赖未安装：在 vendor/openmaic 下运行 `pnpm install --frozen-lockfile`' };
    }
    return { ok: true };
  };

  /**
   * 探测端口是否空闲。
   *
   * 上游被占端口时不会自动换端口（它会直接报 EADDRINUSE 然后退出），所以
   * 「谁可以先占」这件事必须在**我们**这边决定，而不是起完之后再去猜。
   */
  const isPortFree = (port) => new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });

  const pickPort = async (preferred) => {
    if (await isPortFree(preferred)) return preferred;
    for (let port = preferred + 1; port < preferred + 40; port += 1) {
      if (await isPortFree(port)) {
        logger.warn(`端口 ${preferred} 被占用，OpenMAIC 改用 ${port}`);
        return port;
      }
    }
    throw new Error(`端口 ${preferred}–${preferred + 39} 全被占用，无法启动 OpenMAIC`);
  };

  /**
   * 解析数据库连接串。
   *
   * 优先级：显式配置 > 由本包托管的便携库 > 环境变量。
   * 都拿不到就返回 null，由调用方报 `no-database` —— **绝不**编一个默认值，
   * 那样只会换来一个「连上去但库里没有表」的更费解的故障。
   */
  const resolveDatabaseUrl = () => {
    if (config.databaseUrl) return config.databaseUrl;
    if (process.env.OPENMAIC_DATABASE_URL) return process.env.OPENMAIC_DATABASE_URL;
    return null;
  };

  const setState = (state, reason = null, error = null) => {
    facts.state = state;
    facts.reason = reason;
    if (error) facts.lastError = String(error?.message ?? error);
  };

  /**
   * 启动托管进程。
   *
   * 只在 `service.start()` 被显式调用时才起 —— `apply()` 里不自动起，因为
   * Next.js 冷启动要几十秒、还要连库，自动起会让「打开工作台」这个动作莫名其妙
   * 变慢好几倍。页面打开时由页面侧显式触发（见 dsh-zhiyun-page-classroom）。
   */
  const start = async () => {
    if (disposed) throw new Error('OpenMAIC 宿主已卸载');
    if (child && !child.killed) return status();

    await ready;
    const install = inspectInstall();
    if (!install.ok) {
      setState(install.state, install.reason);
      return status();
    }

    const databaseUrl = resolveDatabaseUrl();
    if (!databaseUrl) {
      setState(STATE.NO_DATABASE,
        '没有可用的 PostgreSQL 连接串：设置 OPENMAIC_DATABASE_URL，或在 config.databaseUrl 里指定。'
        + '上游没有数据库会直接退出，不会降级。');
      return status();
    }

    const port = await pickPort(facts.port ?? DEFAULT_PORT);
    facts.port = port;
    facts.databaseUrl = databaseUrl;
    setState(STATE.STARTING, null);

    // 上游是 `next start`：它需要先 build 过。没 build 时错误很费解
    // （"Could not find a production build"），所以提前判一次并给出人话。
    if (!existsSync(join(VENDOR_PATH, '.next'))) {
      setState(STATE.FAILED,
        '上游尚未构建：在 vendor/openmaic 下运行 `pnpm build`（首次约数分钟），或用 config.allowDev=true 走 `pnpm dev`。');
      return status();
    }

    const command = config.allowDev === true ? 'dev' : 'start';

    /**
     * 允许嵌入上游的父级来源。
     *
     * 上游只认 `ALLOWED_FRAME_ANCESTORS` 这一个口子，而我们的页面与它**不同端口**
     * （工作台 3091 / 上游 3000+），跨源一定会被拦。
     *
     * ⚠️ CSP 的源表达式**不支持端口通配**：`http://127.0.0.1:*` 是非法语法，
     *    写了会被浏览器整条忽略（等于没配）。所以这里必须逐个列出精确来源。
     *    工作台默认 3091，可用 `ZHIYUN_PORT` / `--port` 改，因此两个常见端口都列上；
     *    换到别的端口时用 `config.frameAncestors` 显式指定。
     *
     * 端口不是安全边界 —— 上游自己绑在 127.0.0.1 上，局域网本来就够不到它。
     */
    const frameAncestors = config.frameAncestors
      ?? 'http://127.0.0.1:3091 http://localhost:3091 http://127.0.0.1:3081 http://localhost:3081';

    // ⚠️ 这里**直呼 `next` 二进制**，不走 `pnpm run start -- --port N`。
    //    实测后者在 Windows 上会把 `--` 本身当成位置参数传进 next，
    //    报 `Invalid project directory provided ... \--port` —— 服务根本起不来。
    //    next 自己的 `-p` 才是权威写法。
    const nextBin = join(VENDOR_PATH, 'node_modules', '.bin', process.platform === 'win32' ? 'next.cmd' : 'next');
    const args = command === 'dev' ? ['dev', '-p', String(port)] : ['start', '-p', String(port)];

    child = spawn(nextBin, args, {
      cwd: VENDOR_PATH,
      env: {
        ...process.env,
        PORT: String(port),
        DATABASE_URL: databaseUrl,
        NODE_ENV: command === 'start' ? 'production' : 'development',
        // 上游默认发 `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`，
        // 于是它**拒绝被任何别的源嵌入**（实测报 "Framing … violates the following
        // Content Security Policy directive: frame-ancestors 'self'"）。
        // 我们的页面与它不同端口，属于跨源，必须把它自己的域名加进白名单。
        //
        // ⚠️⚠️ 这个变量**必须在 `next build` 时就设好**，运行时再设是无效的：
        //    上游在 `next.config.ts` 的 `headers()` 里读它，而 `headers()` 是在构建期
        //    求值、把结果写死进 `.next/routes-manifest.json` 的。启动时给一个漂亮的值，
        //    返回的仍然是构建那一刻的 `'self'` —— 真机上就是这样反复白屏、查了很久。
        //    所以 `pnpm build` 也必须在带这个变量的环境里跑（见 README 的构建一节）。
        //
        // ⚠️ 配了白名单后上游会**去掉** `X-Frame-Options`（该头只支持 SAMEORIGIN，
        //    无法表达白名单），所以这里不能只改一半。
        ALLOWED_FRAME_ANCESTORS: frameAncestors,
        // 上游默认要求 ACCESS_CODE 才能防越权；本机回环绑定下不强制，
        // 但显式把「只监听回环」这件事写进配置，避免被误改成对外暴露。
        HOSTNAME: '127.0.0.1',
      },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    facts.pid = child.pid ?? null;
    facts.startedAt = Date.now();

    child.stdout?.on('data', (chunk) => logger.debug(`[upstream] ${String(chunk).trimEnd()}`));
    child.stderr?.on('data', (chunk) => logger.warn(`[upstream] ${String(chunk).trimEnd()}`));
    child.once('error', (error) => {
      setState(STATE.FAILED, '上游进程启动失败', error);
      logger.error('OpenMAIC 上游进程启动失败', error?.message ?? error);
    });
    child.once('exit', (code, signal) => {
      child = null;
      facts.pid = null;
      if (disposed) return;
      setState(STATE.FAILED, `上游进程退出（code=${code ?? 'null'}, signal=${signal ?? 'null'}）`);
      logger.warn(`OpenMAIC 上游进程退出：code=${code} signal=${signal}`);
    });

    // 等它就绪：健康检查通过之前不报 running，否则页面会先拿到一个打不开的地址。
    const ok = await waitForHealthy(port, config.startupTimeoutMs ?? 120_000);
    if (!ok) {
      setState(STATE.FAILED, `上游在超时内未就绪（端口 ${port}）`);
      return status();
    }
    setState(STATE.RUNNING, null);
    logger.info(`OpenMAIC 已就绪：http://127.0.0.1:${port}`);
    return status();
  };

  /** 轮询上游；失败一次不代表没起来（Next.js 预热期会连不上）。 */
  const waitForHealthy = async (port, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (disposed) return false;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) });
        if (response.ok) return true;
      } catch {
        // 还在起，继续等。
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return false;
  };

  const stop = async () => {
    if (!child) return;
    const pid = child.pid;
    child.kill('SIGTERM');
    // Windows 上 SIGTERM 对 shell 包着的进程未必生效，超时后强杀。
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (child && !child.killed) child.kill('SIGKILL');
    logger.info(`OpenMAIC 上游进程已停止（pid=${pid}）`);
    setState(STATE.STOPPED, null);
  };

  function status() {
    return {
      ...facts,
      url: facts.state === STATE.RUNNING ? `http://127.0.0.1:${facts.port}` : null,
      vendorPath: VENDOR_PATH,
    };
  }

  const service = {
    /** 启动（幂等：已就绪时直接返回当前状态）。 */
    start,
    stop,
    status,
    /** 上游就绪地址；未就绪返回 null，供页面侧决定是嵌 iframe 还是显示安装指引。 */
    url: () => (facts.state === STATE.RUNNING ? `http://127.0.0.1:${facts.port}` : null),
    /** 上游版本（来自锁文件），用于页面上「你正在跑哪一版」。 */
    version: () => facts.version,
  };

  void readLock();
  const removeService = ctx.provide('zhiyunOpenMAIC', service);

  // 页面在浏览器里，够不到宿主服务 —— 状态与起停都必须走同源 HTTP 路由。
  // 路由注册放在 `ctx.inject(['webServer'])` 里：webServer 未必先于本包加载，
  // 直接读会抛。缺它时只是没有路由，页面会显示「宿主服务不可达」，不影响其它页。
  ctx.inject(['webServer'], (scope) => {
    scope.effect(() => {
      const handler = createHandler(service);
      const dispose = scope.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });
      logger.info(`OpenMAIC 路由已注册：${ROUTE_PREFIX}`);
      return dispose;
    }, 'zhiyun: openmaic routes');
  });

  ctx.on?.('dispose', () => {
    disposed = true;
    stop().catch((error) => logger.warn('OpenMAIC 服务卸载时出错', error?.message ?? error));
  });

  return async () => {
    disposed = true;
    removeService();
    await stop().catch(() => {});
  };
}

export { STATE };
