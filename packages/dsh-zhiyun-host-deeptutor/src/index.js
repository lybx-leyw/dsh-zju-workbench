import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { PythonBridge, resolvePython, probeVendorDeps } from './runtime.js';
import { createLlmBridge } from './models.js';
import { createCapabilityCatalog } from './capabilities.js';
import { createResourceRegistry } from './resources.js';
import { createService } from './service.js';
import { createRunStore } from './run-store.js';
import { DeepTutorError } from './protocol.js';

export const name = 'zhiyun-deeptutor';

// profileContext 必需（拿 profile 目录）；llm / attachments 只是可选增强，
// 因此不进 inject —— 写进 inject 会让插件在上游未配置时一直 pending。
export const inject = ['profileContext'];

export const PACKAGE_DIR = new URL('..', import.meta.url);
export const VENDOR_PATH = new URL('../vendor/deeptutor', import.meta.url);

/**
 * DeepTutor 上游服务宿主。
 *
 * 设计原则（照 host-paper 的可选宿主约定）：
 * - apply() 永不因上游缺失而抛错，否则整个 profile 的 bundle 会一起挂掉；
 * - 所有“上游还在不在”的判断都推迟到服务方法被调用时；
 * - 业务包只调 ctx.zhiyunDeepTutor，不 import vendor 下的任何东西。
 */
export function apply(ctx, config = {}) {
  const dataDir = config.dataDir ?? join(ctx.profileContext.dir, 'data/zhiyun-deeptutor');
  const homeDir = config.homeDir ?? join(dataDir, 'home');
  const runsDir = join(dataDir, 'runs');
  const resourcesDir = join(dataDir, 'resources');
  const stateFile = join(dataDir, 'capabilities-state.json');

  const logger = config.logger ?? {
    debug: (...args) => ctx.logger?.debug?.('[zhiyun-deeptutor]', ...args),
    info: (...args) => ctx.logger?.info?.('[zhiyun-deeptutor]', ...args),
    warn: (...args) => ctx.logger?.warn?.('[zhiyun-deeptutor]', ...args),
    error: (...args) => ctx.logger?.error?.('[zhiyun-deeptutor]', ...args),
  };

  // 目录创建失败不抛：盘满/权限问题应该表现为 status().state，而不是启动失败。
  const ready = mkdir(dataDir, { recursive: true })
    .then(() => mkdir(runsDir, { recursive: true }))
    .then(() => mkdir(resourcesDir, { recursive: true }))
    .then(() => mkdir(homeDir, { recursive: true }))
    .catch((error) => {
      logger.warn('无法创建 DeepTutor 数据目录，服务将以 degraded 状态启动', error?.message ?? error);
    });

  const bridge = new PythonBridge({
    rootDir: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    vendorPath: fileUrlToPathSafe(VENDOR_PATH),
    homeDir,
    profileDir: ctx.profileContext.dir,
    logger,
    requestTimeoutMs: config.requestTimeoutMs,
  });

  const llmBridge = createLlmBridge({
    // 惰性取：llm / attachments 是可选增强，缺了也不该阻止其它能力可用。
    llm: () => ctx.get('llm') ?? ctx.llm,
    attachments: () => ctx.get('attachments') ?? ctx.attachments,
    getSelection: () => config.selection ?? null,
    logger,
  });

  // Python 侧发来的 `llm.stream` / `llm.complete` 反向请求挂到桥上。
  //
  // 这一步不能漏：漏了 Python 会收到 `-32601 未处理的方法`，出题流水线在
  // 第一次调模型时就死。反之宿主 `ctx.llm` 缺失时它返回 `E_DISABLED` 错误，
  // 表现是「能力已配置但模型不可用」—— 与 `configured` 那一层语义一致。
  const detachLlm = typeof llmBridge.attachTo === 'function'
    ? llmBridge.attachTo(bridge)
    : () => {};

  const catalog = createCapabilityCatalog({
    bridge,
    expose: config.expose ?? {},
    configured: config.configured ?? {},
    stateFile,
    logger,
  });

  // 资源校验器与内容哈希由 dsh-zhiyun-core-learning-resource 提供。
  //
  // ⚠️ 这里刻意**不 import** 那个包：宿主包不该反向依赖业务包（`package.json` 里
  // 也没有这条依赖）。缺了它就让 attach 明确失败，而不是退化成「没校验就落盘」——
  // 后者最坏：快照看起来合法，其实从没校验过。
  //
  // ⚠️ 也刻意**惰性取**：profile 里 core-learning-resource 可能在 host-deeptutor
  // 之后加载（bundle 顺序），apply 时 `ctx.get` 还拿不到它。
  const learningResource = () => {
    const service = ctx.get?.('zhiyunLearningResource') ?? ctx.zhiyunLearningResource;
    if (!service) {
      throw new DeepTutorError('E_INTERNAL',
        '标准学习资源服务（ctx.zhiyunLearningResource）不可用：dsh-zhiyun-core-learning-resource '
        + '未安装或尚未加载。资源快照需要它的校验器与内容哈希，不能跳过');
    }
    return service;
  };

  const resources = createResourceRegistry({
    dataDir: resourcesDir,
    logger,
    validate: (bundle) => learningResource().validate(bundle),
    contentHash: (value) => learningResource().contentHash(value),
  });
  const runStore = createRunStore({ runsDir, logger });

  // ── 解释器与依赖探测 ──────────────────────────────────────────────────────
  //
  // 探测要起子进程（`python -c ...`、`pip` 环境的 import 试探），**不能阻塞
  // apply**：apply 慢或抛错会拖垮整个 profile。但它也不能不做 —— 不做的话
  // `status().state` 永远是 `ready`，用户机器上没装 Python 时设置页显示正常、
  // 每次调用才炸，`deeptutorVersion` 永远是 null。
  //
  // 折中：apply 里起一个后台探测（不 await），结果回填到 `facts`；`status()`
  // 首次调用时等它一小会儿（有上限，绝不长挂）。等不到就如实报「尚未探测」，
  // 而不是编一个 `ok:true`。
  const facts = {
    python: config.python ?? {},
    deps: config.deps ?? {},
  };
  let probePromise = null;
  let probeDone = false;

  const probeRuntimeFacts = () => {
    if (probePromise) return probePromise;
    if (config.probe === false) {
      probeDone = true;
      return Promise.resolve(facts);
    }
    probePromise = (async () => {
      const rootDir = fileUrlToPathSafe(PACKAGE_DIR);
      const vendorPath = fileUrlToPathSafe(VENDOR_PATH);
      if (!isProvided(config.python)) {
        try {
          const resolved = await resolvePython({
            profileDir: ctx.profileContext.dir,
            rootDir,
            env: process.env,
            logger,
          });
          facts.python = resolved;
          // 已经解析过一次就别让 bridge.start() 再解析一遍：两次探测结果可能不同
          // （用户正好在这中间装了 venv），那会让 status() 说的和实际用的不是一个。
          if (typeof bridge.useResolvedPython === 'function') bridge.useResolvedPython(resolved);
        } catch (error) {
          facts.python = { ok: false, path: null, version: null, source: 'none', reason: `探测解释器时出错：${error?.message ?? error}` };
        }
      }
      if (!isProvided(config.deps)) {
        try {
          const python = facts.python ?? {};
          facts.deps = await probeVendorDeps({
            pythonPath: python.ok === true ? python.path : null,
            pythonArgs: Array.isArray(python.args) ? python.args : [],
            vendorPath,
            env: process.env,
            logger,
          });
        } catch (error) {
          facts.deps = { installed: false, deeptutorVersion: null, missing: [], reason: `探测依赖时出错：${error?.message ?? error}` };
        }
      }
      probeDone = true;
      return facts;
    })().catch((error) => {
      // 探测本身失败不是服务失败：状态会退化成「未探测」而不是「不可用」。
      logger.warn('探测 Python 环境与上游依赖失败（已忽略，状态将报未探测）', error?.message ?? error);
      probeDone = true;
      return facts;
    });
    return probePromise;
  };

  const readiness = async () => {
    if (probeDone || !probePromise) return facts;
    // 首次 status 等一小会儿：快机器上通常这段时间够拿全事实；慢机器也不能挂住，
    // 超时就按「尚未探测」如实上报，后台探测继续跑完回填。
    await Promise.race([probePromise, delay(PROBE_STATUS_GRACE_MS)]);
    return facts;
  };

  const service = createService({
    bridge,
    llmBridge,
    catalog,
    resources,
    runStore,
    logger,
    ready,
    // status() 需要的路径与探测事实**显式传入**，不让 service 从 runsDir 之类的
    // 目录布局反推 —— 反推是隐式猜测，布局一改就静默给出看似合理的错值。
    //
    // `python` / `deps` 用 getter：探测是异步的，取值时才读最新事实。
    config: withProbeFacts({
      ...config,
      dataDir,
      homeDir,
      runsDir,
      resourcesDir,
      stateFile,
      vendorPath: fileUrlToPathSafe(VENDOR_PATH),
    }, facts),
  });

  // 首次 status() 先把探测推进到「已结束或到点」，别让用户看到假 ready。
  const statusOf = service.status;
  service.status = async (...args) => {
    await readiness().catch(() => facts);
    return statusOf.apply(service, args);
  };

  // 不 await：apply 必须立刻返回。探测失败也只 warn。
  void probeRuntimeFacts();

  const removeService = ctx.provide('zhiyunDeepTutor', service);

  // 进程退出/插件卸载都要收干净，否则会残留 Python 子进程。
  ctx.on?.('dispose', () => {
    service.dispose().catch((error) => logger.warn('DeepTutor 服务卸载时出错', error?.message ?? error));
  });

  return async () => {
    removeService();
    try {
      detachLlm();
    } catch {
      // 忽略：卸载路径上退订失败不该挡住后面的收尾。
    }
    await service.dispose().catch(() => {});
    await bridge.stop?.({ drain: false }).catch(() => {});
  };
}

/** file:// URL → 原生路径；Windows 下要剥掉前导斜杠。 */
function fileUrlToPathSafe(url) {
  const raw = url instanceof URL ? url.pathname : String(url);
  const decoded = decodeURIComponent(raw);
  return /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded;
}

/**
 * 首次 `status()` 最多等这么久拿探测结果。
 *
 * 实测（本机 3.11.9 venv、vendored 上游依赖齐）：
 *   resolvePython   ≈ 130 ms
 *   probeVendorDeps ≈ 3020 ms   ← 要起 Python 并 import 上游，慢在这里
 * 合计约 3.2 秒。原来给 3 秒，正好卡在临界点上：`status()` 在探测完成前返回，
 * 于是报出「state=ready 但 deeptutorVersion=null」——同一份报告里自相矛盾，
 * 而 ready 的含义正是「事实已知、可用」。
 *
 * 所以上限要盖过正常探测耗时，只在病态情况（无解释器、逐个候选全 miss）才超时。
 * 超时仍按「尚未探测」如实上报（带 warning），后台探测继续跑完回填。
 */
const PROBE_STATUS_GRACE_MS = 15000;

/** `config.python` / `config.deps` 是否由调用方显式给死了（给死了就不许探测覆盖）。 */
function isProvided(value) {
  return value !== undefined && value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 让 `python` / `deps` 变成读 `facts` 的 getter。
 *
 * 为什么不用展开后的普通属性：探测是异步回填的，`createService()` 只拿一次
 * config 对象；用普通属性就会把「探测还没完成」那一刻的空对象永久钉死，
 * 后面探测出事实也读不到。
 */
function withProbeFacts(config, facts) {
  const base = { ...config };
  delete base.python;
  delete base.deps;
  return Object.defineProperties(base, {
    python: { get: () => facts.python, enumerable: true, configurable: true },
    deps: { get: () => facts.deps, enumerable: true, configurable: true },
  });
}

export { DeepTutorError, resolvePython, probeVendorDeps };
