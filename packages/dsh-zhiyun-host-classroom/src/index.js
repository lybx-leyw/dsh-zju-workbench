/**
 * 智云 Pro「互动课堂」的宿主半边（L1）。
 *
 * 把 OpenMAIC 的 21 个 `app/api/*` route（实测 20 个，见 `ROUTES.md` 开头的
 * 「口径差异」）搬成 `ctx.zhiyunClassroomStudio` 上的服务方法。本包只做**宿主层**：
 * 路由形状 → 服务方法、Next 的请求/响应对象 → 普通参数与普通返回值。
 *
 * # 三条硬约定（与 `host-deeptutor` / `host-paper` 完全一致）
 *
 * 1. **`apply()` 永不因上游缺失而抛错**。任何一个 bundle 条目抛错，挂掉的是整个
 *    profile 的启动（见 CONTRIBUTING 3.1）；"课堂还没搬完"应该表现为
 *    `status().state` 与 `status().detail.implemented`，不是白屏。
 *    本文件里**每一处**可能抛的地方都有边界：目录、provide、时钟、形状自检。
 * 2. **判断都推迟到方法被调用时**。`apply()` 里不做任何 IO、不探测、不 import 上游。
 * 3. **业务包只调 `ctx.zhiyunClassroomStudio`**，不 import 本包 `src/` 下的任何文件
 *    （`exports` 里给的子路径只供测试与 HTTP 桥用）。
 *
 * # 命名：为什么不叫 `zhiyunClassroom`
 *
 * `zhiyunClassroom` 已被 `dsh-zhiyun-source-classroom` 占用
 * （`packages/dsh-zhiyun-source-classroom/src/index.js:101`），那边是浙大教务的
 * 课堂数据源（`getCurrentUser` / `acquireSso` / `transport`），
 * 而 `dsh-zhiyun-core-parser`、`dsh-zhiyun-core-study` 都 `inject: ['zhiyunClassroom']`。
 * 若本包也叫这名，那两个包会拿到本包的服务，在 `acquireSso` 上崩。
 *
 * 同理 `cordis.patch.yml` 的 bundle 行 id 是「包名去 `dsh-` 前缀」
 * （`scripts/test-host.mjs:90-93` 有这条规则的实现），`zhiyun-classroom` 会与源包
 * 逐字相同、两行撞 id。因此本包统一用 `zhiyun-classroom-studio` /
 * `zhiyunClassroomStudio`（规范 §4 已同步改名）。
 *
 * 即便如此，`apply()` 仍会**探测**同名服务：撞上了就大声 warn、写进
 * `status().detail.conflict`，并且仍然 provide —— 不 provide 会让契约凭空少一个服务，
 * 比冲突更难查。
 */

import { join } from 'node:path';
import { ClassroomError } from './errors.js';
import { ADAPTER_METHODS, createVaultAdapter } from './adapter.js';
import { createClassroomService, inspectShape } from './service.js';
import { createDegradedProviderConfig, mergeProviderConfig } from './upstream/provider-config.js';
import { degradedGenerationCapabilities } from './upstream/health.js';
// 逐域挂载：80 条 route 按域落在这四个文件里（见 docs/architecture/route-batches.md）。
// 这里只做「登记」，任何一域的构造失败都由 createClassroomService 兜住（warn 不抛）。
import { mountGeneration } from './services/generation.js';
import { mountMedia } from './services/media.js';
import { mountAgentRuntime } from './services/agent-runtime.js';
import { mountPlatform } from './services/platform.js';

/** 内置的四个域，顺序无依赖（各自只往自己的命名空间写）。 */
const DOMAIN_MOUNTS = Object.freeze([mountGeneration, mountMedia, mountAgentRuntime, mountPlatform]);

export const name = 'zhiyun-classroom';

/**
 * 只硬依赖 `profileContext`（拿 profile 目录做数据根）。
 *
 * `vault` / `llm` / `attachments` 全部**不进** `inject`：它们是可选增强，
 * 写进 inject 会让本插件在上游未配置时一直 pending —— 这条规矩在
 * `host-deeptutor/src/index.js:13-15` 与 `host-paper/src/index.js` 都有原话。
 */
export const inject = ['profileContext'];

/** 本包版本。`status().version` 用它；搬进来的 health 用 `npm_package_version`（上游行为）。 */
export const PACKAGE_VERSION = '0.1.0';

/**
 * @param {object} ctx Cordis 上下文
 * @param {object} [config]
 * @param {string} [config.dataDir] 数据根，默认 `<profile>/data/zhiyun-classroom`
 * @param {object} [config.providerConfig] 注入 provider 装载器（见 `upstream/provider-config.js`）
 * @param {() => Promise<object>} [config.resolveCapabilities] 注入能力位解析器
 * @param {object} [config.adapter] 注入存储适配器（见 `adapter.js`）
 * @param {object} [config.logger]
 * @returns {() => void} disposer（Cordis 的 apply 返回值约定）
 */
export function apply(ctx, config = {}) {
  // 兜底 logger：`ctx.logger` 在测试桩里常常只有一部分方法，
  // 缺哪个就退到 console —— 不能在打日志这一行上抛。
  const log = config.logger ?? {
    debug: (...args) => ctx.logger?.debug?.('[zhiyun-classroom]', ...args),
    info: (...args) => ctx.logger?.info?.('[zhiyun-classroom]', ...args),
    warn: (...args) => ctx.logger?.warn?.('[zhiyun-classroom]', ...args),
    error: (...args) => ctx.logger?.error?.('[zhiyun-classroom]', ...args),
  };

  // ── 数据根 ────────────────────────────────────────────────────────────
  //
  // 取不到 `profileContext` 也算"能起来"：数据根为 null，服务照常 provide，
  // 只是任何需要落盘的方法会在自己的错误里说明原因。绝不在这里抛。
  let dataDir = null;
  try {
    const profileDir = ctx?.profileContext?.dir;
    dataDir = config.dataDir ?? (profileDir ? join(profileDir, 'data/zhiyun-classroom') : null);
  } catch (error) {
    log.warn('解析数据目录失败，课堂服务将以无数据根状态启动', error?.message ?? error);
  }

  // ── 组合层冲突探测（**只探测，不改名**，理由见文件头）────────────────
  let conflict = null;
  try {
    const existing = ctx.get?.('zhiyunClassroomStudio');
    if (existing) {
      // 源包的形状（`transport` / `acquireSso`）与本服务的形状（`runs` / `classroom`）
      // 完全不重叠，所以"像不像源包"可以直接看特征方法，而不是猜。
      const looksLikeSource = typeof existing.acquireSso === 'function'
        || typeof existing.getCurrentUser === 'function'
        || existing.transport !== undefined;
      conflict = {
        service: 'zhiyunClassroomStudio',
        occupiedBy: looksLikeSource ? 'dsh-zhiyun-source-classroom' : 'unknown-provider',
        detail: looksLikeSource
          ? '服务名与浙大教务课堂数据源重复；两者只能有一个生效，需要规范层面定名'
          : '服务名已被另一个包占用',
      };
      log.error(
        `zhiyunClassroomStudio 已被 ${conflict.occupiedBy} 占用，本包将覆盖它。`
        + 'inject zhiyunClassroomStudio 的既有包（core-parser / core-study）会拿到错误的服务',
      );
    }
  } catch (error) {
    log.warn('探测 zhiyunClassroomStudio 占用情况失败（已忽略）', error?.message ?? error);
  }

  // ── 依赖装配 ──────────────────────────────────────────────────────────
  //
  // 全部**惰性 + 降级**：
  // - provider 装载器没注入 → 降级集合（等价于"没有任何 provider 被配置"，见
  //   upstream/provider-config.js 头注）；
  // - 能力位解析器没注入 → 四个 false（同上）；
  // - 存储适配器没注入 → 空壳（每个方法抛 E_NOT_IMPLEMENTED）。
  let providerConfig;
  try {
    providerConfig = mergeProviderConfig(config.providerConfig);
  } catch (error) {
    log.warn('provider 装载器注入失败，退回降级实现', error?.message ?? error);
    providerConfig = createDegradedProviderConfig();
  }

  let adapter;
  try {
    adapter = config.adapter ?? createVaultAdapter();
  } catch (error) {
    log.warn('存储适配器构造失败，退回空壳', error?.message ?? error);
    adapter = createVaultAdapter();
  }
  const adapterMissing = (() => {
    try {
      return ADAPTER_METHODS.filter((method) => typeof adapter[method] !== 'function');
    } catch {
      return [...ADAPTER_METHODS];
    }
  })();

  const resolveCapabilities = typeof config.resolveCapabilities === 'function'
    ? config.resolveCapabilities
    : degradedGenerationCapabilities;

  // ── 服务 ──────────────────────────────────────────────────────────────
  //
  // `ports` 是「下游服务」的惰性视图：值每次现取，因为 inject 的服务可能在
  // 本包 apply 之后才 provide（Cordis 的加载顺序不保证）。取不到就是 null，
  // 各域的 route 自己决定降级分支 —— 这里不做任何"假装有"的兜底。
  const ports = {
    get vault() { return safeService(ctx, 'zhiyunClassroomVault'); },
    get media() { return safeService(ctx, 'zhiyunClassroomMedia'); },
    get generate() { return safeService(ctx, 'zhiyunClassroomGenerate'); },
    get agent() { return safeService(ctx, 'zhiyunClassroomAgent'); },
    get pbl() { return safeService(ctx, 'zhiyunClassroomPbl'); },
    get export() { return safeService(ctx, 'zhiyunClassroomExport'); },
    get stage() { return safeService(ctx, 'zhiyunClassroomStage'); },
    get studio() { return safeService(ctx, 'zhiyunClassroomStudio'); },
  };

  const service = createClassroomService({
    version: PACKAGE_VERSION,
    providerConfig,
    resolveCapabilities,
    log,
    conflict,
    ports,
    mounts: [...DOMAIN_MOUNTS, ...(config.mounts ?? [])],
    dataDir,
  });

  // 形状自检：缺了就 warn 并把缺失清单挂到 status 上，**不抛**。
  // 这是给未来的自己留的保险 —— 手写对象字面量漏一个命名空间不会在 apply 时报错。
  let missing = [];
  try {
    missing = inspectShape(service);
    if (missing.length > 0) {
      log.error(`zhiyunClassroomStudio 形状与规范 §4 不符，缺少：${missing.join(', ')}`);
    }
  } catch (error) {
    log.warn('形状自检失败（已忽略）', error?.message ?? error);
  }

  if (missing.length > 0) {
    // 不改原方法的返回值（那样会让"缺方法"与"未实现"混在一起），
    // 只把事实挂到 status 的 detail 上，页面照样能显示。
    const originalStatus = service.status;
    service.status = async (...args) => {
      const result = await originalStatus.apply(service, args);
      return { ...result, detail: { ...result.detail, missing, adapterMissing } };
    };
  }

  // ── 对外提供 ──────────────────────────────────────────────────────────
  let removeService = () => {};
  try {
    // `ctx.provide` 在真 Cordis 里遇到同名服务可能抛（取决于宿主版本）。
    // 抛了就降级：服务没了，但工作台还活着 —— 这正是本仓的取舍。
    removeService = ctx.provide('zhiyunClassroomStudio', service) ?? (() => {});
  } catch (error) {
    log.error(
      'zhiyunClassroomStudio 注册失败（服务名可能已被占用），课堂能力本次不可用',
      error?.message ?? error,
    );
  }

  // 卸载路径上任何一步失败都不该挡住后面的收尾。
  try {
    ctx.on?.('dispose', () => {
      try {
        removeService();
      } catch (error) {
        log.warn('卸载时注销 zhiyunClassroomStudio 失败', error?.message ?? error);
      }
    });
  } catch (error) {
    log.warn('注册 dispose 钩子失败（已忽略）', error?.message ?? error);
  }

  log.info(
    `课堂宿主就绪：dataDir=${dataDir ?? '(无)'}，provider=${providerConfig.configured ? 'injected' : 'placeholder'}，`
    + `adapter=${adapterMissing.length === 0 ? 'injected' : 'placeholder'}`,
  );

  return () => {
    try {
      removeService();
    } catch (error) {
      log.warn('卸载课堂宿主时出错', error?.message ?? error);
    }
  };
}

export { ClassroomError };

/**
 * 取一个下游服务；取不到（未 provide / 属性 getter 抛）一律回 null。
 *
 * 为什么吞异常：Cordis 的 `ctx.xxx` 在服务缺失时可能直接抛（取决于宿主版本），
 * 而"端口缺失"在本包里是一个**正常状态**（route 走降级分支），不是错误。
 */
function safeService(ctx, name) {
  try {
    return ctx?.[name] ?? ctx?.get?.(name) ?? null;
  } catch {
    return null;
  }
}
export { ERROR_KINDS, STATUS_STATES, notImplemented } from './errors.js';
export { ADAPTER_METHODS, createVaultAdapter, inspectAdapter } from './adapter.js';
export { inspectShape } from './service.js';
