/**
 * `ctx.zhiyunClassroomStudio` 的形状。
 *
 * # 这份文件在做什么
 *
 * 规范第 4 节定义了宿主包对外唯一的东西：**服务形状**。本文件把它**完整声明**出来
 * —— 不是"声明一部分，剩下的等以后加"，因为 L2/L3 是照这份声明并行开工的：
 *
 * ```
 * ctx.zhiyunClassroomStudio.status()                  // { state, version, detail }
 * ctx.zhiyunClassroomStudio.generate(brief, opts)     // { runId, events: AsyncIterable<event> }
 * ctx.zhiyunClassroomStudio.runs.get(runId)
 * ctx.zhiyunClassroomStudio.runs.cancel(runId)
 * ctx.zhiyunClassroomStudio.classroom.load(id)        // { scenes, meta, assets }
 * ctx.zhiyunClassroomStudio.classroom.save(id, doc)
 * ctx.zhiyunClassroomStudio.export.pptx(id) / .html(id)
 * ctx.zhiyunClassroomStudio.providers.list() / .set(key, cfg)
 * ```
 *
 * # 两种"还没有"
 *
 * 声明了但没搬的方法不能返回 `undefined` —— 那让调用方写 `if (result?.foo)`
 * 才能不炸，等于把契约的洞留给下游。所以：
 *
 * - 已经搬完的（`status` / `providers.list`）返回真实结果；
 * - 其余一律**抛** `ClassroomError('E_NOT_IMPLEMENTED')`，`detail.source` 指到
 *   上游那个还没搬的 handler 的具体行号。
 *
 * 为什么抛而不是返回 `{ state: 'not-implemented' }`：
 * - `generate` 的输出是 `AsyncIterable`，返回一个"空壳对象"会让 `for await` 静默迭代零次，
 *   表现为"生成了 0 个场景"——这比报错坏得多（判据 1 会判它失败，但没人知道为什么）；
 * - 抛错是**可捕获、可显示**的，页面的 `try/catch` 一定会走到。
 *
 * 例外是 `runs.get`：它是查询，返回 `not-implemented` 状态对页面更有用（列表页照常渲染）。
 * 但为了让"还没搬"这件事只有一个表达方式，这里统一采用抛错，页面统一按 `kind` 分支。
 */

import { ClassroomError, notImplemented } from './errors.js';
import { createHealthHandler } from './upstream/health.js';
import { createServerProvidersHandler } from './upstream/server-providers.js';

/**
 * @param {object} options
 * @param {string} options.version 本包版本（`status().version`）
 * @param {object} options.providerConfig 见 `upstream/provider-config.js`
 * @param {() => Promise<object>} options.resolveCapabilities
 * @param {{ error: Function, warn: Function, info: Function, debug: Function }} options.log
 * @param {boolean} options.conflict 组合层冲突（`zhiyunClassroomStudio` 已被别的包占用）
 */
export function createClassroomService({
  version = '0.0.0',
  providerConfig,
  resolveCapabilities,
  log,
  conflict = null,
  ports = {},
  mounts = [],
  dataDir = null,
} = {}) {
  // ── 已搬完的两个 route ────────────────────────────────────────────────
  //
  // 两个 handler 都是工厂产出的，工厂只注入依赖、不改 body；
  // 这里持有的是**同一个实例**，所以 `npm_package_version` 之类只在构造时读一次
  // （上游是模块级常量，行为一致）。
  const health = createHealthHandler({
    resolveServerGenerationCapabilities: resolveCapabilities,
    getParallelSceneConcurrency: providerConfig.getParallelSceneConcurrency,
  });
  const serverProviders = createServerProvidersHandler(providerConfig, { log });

  /**
   * 哪些子能力是真的。`status().detail.implemented` 用它，
   * 页面据此决定是渲染还是显示占位 —— 不靠"试着调一下看看抛不抛"。
   */
  const implemented = Object.freeze({
    status: true,
    providersList: true,
    generate: false,
    runsGet: false,
    runsCancel: false,
    classroomLoad: false,
    classroomSave: false,
    exportPptx: false,
    exportHtml: false,
    providersSet: false,
  });

  const service = {
    /**
     * 宿主自检（= 上游 `GET /api/health`，源文件:app/api/health/route.ts:7-16）。
     *
     * `state` 的三种取值在本包里各有所指：
     * - `ready`：health 探针跑通（**不等于**课堂链路可用，链路可用性看 `detail.implemented`）；
     * - `partial`：组合层冲突（`zhiyunClassroomStudio` 被别的包占了），服务仍可用但不是全量；
     * - `degraded`：health 探针本身抛了；`detail.error` 带原因。
     *
     * 这个方法**永不抛**：它是页面第一个调的东西，抛了页面就白屏。
     */
    async status() {
      try {
        const { body } = await health();
        return {
          state: conflict ? 'partial' : 'ready',
          version,
          detail: {
            ...body,
            implemented,
            providerConfig: providerConfig.configured ? 'injected' : 'placeholder',
            ...(conflict ? { conflict } : {}),
          },
        };
      } catch (error) {
        return {
          state: 'degraded',
          version,
          detail: {
            implemented,
            error: error instanceof Error ? error.message : String(error),
            ...(conflict ? { conflict } : {}),
          },
        };
      }
    },

    // ── 以下为规范第 4 节的声明，尚未搬 ──────────────────────────────────

    /**
     * 流式生成。返回 `{ runId, events: AsyncIterable<event> }`，事件流用
     * `AsyncIterable` 而不是回调注册表（规范 §4 末条：避免卸载泄漏）。
     *
     * 源文件:app/api/generation-runs/route.ts:43-81（POST）
     * 源文件:app/api/generate-classroom/route.ts:30-83（POST，课堂专用）
     */
    async generate(brief, opts) {
      void brief;
      void opts;
      throw notImplemented('zhiyunClassroomStudio.generate', 'app/api/generation-runs/route.ts:43-81');
    },

    runs: {
      /** 源文件:app/api/generation-runs/[id]/route.ts（GET） */
      async get(runId) {
        void runId;
        throw notImplemented('zhiyunClassroomStudio.runs.get', 'app/api/generation-runs/[id]/route.ts');
      },
      /** 源文件:app/api/generation-runs/[id]/route.ts（DELETE） */
      async cancel(runId) {
        void runId;
        throw notImplemented(
          'zhiyunClassroomStudio.runs.cancel',
          'app/api/generation-runs/[id]/route.ts',
        );
      },
    },

    classroom: {
      /** 源文件:app/api/stages/[id]/route.ts（GET，含 scenes/manifest） */
      async load(id) {
        void id;
        throw notImplemented('zhiyunClassroomStudio.classroom.load', 'app/api/stages/[id]/route.ts');
      },
      /** 源文件:app/api/stages/[id]/route.ts（PUT/PATCH） */
      async save(id, doc) {
        void id;
        void doc;
        throw notImplemented('zhiyunClassroomStudio.classroom.save', 'app/api/stages/[id]/route.ts');
      },
    },

    export: {
      /** 源文件:app/api/export-video/render/route.ts + lib/export/（PPTX 导出） */
      async pptx(id) {
        void id;
        throw notImplemented('zhiyunClassroomStudio.export.pptx', 'lib/export/（无对应 route）');
      },
      /** 源文件:lib/export/（HTML 导出，无对应 route） */
      async html(id) {
        void id;
        throw notImplemented('zhiyunClassroomStudio.export.html', 'lib/export/（无对应 route）');
      },
    },

    providers: {
      /**
       * 服务端已配置的 provider 清单
       * （= 上游 `GET /api/server-providers`，源文件:app/api/server-providers/route.ts:16-38）。
       *
       * 与 `status()` 的差别：那个是自检（含版本/能力位），这个是**给设置页渲染用的清单**。
       * 两者都读 provider-config，但上游就是两个接口，不合并。
       *
       * 返回的是上游的**响应信封** `{ httpStatus, body }`（见 `upstream/api-response.js`），
       * 不是裸 body —— 因为这条 route 的失败分支带 500（`apiError`），
       * 而 `status()` 的形状是规范 §4 定死的 `{ state, version, detail }`，所以那边剥掉了信封。
       * 调用方一律读 `body`；HTTP 桥直接拿 `httpStatus` 用。
       */
      async list() {
        return serverProviders();
      },
      /**
       * 写单个 provider 配置。
       *
       * 源文件:app/api/model-config/route.ts:82-141（PUT，owner 作用域，进 pg）；
       * 源文件:app/api/model-config/import/route.ts（POST，批量导入）。
       * 两条都会改持久层，先抛。
       */
      async set(key, cfg) {
        void key;
        void cfg;
        throw notImplemented('zhiyunClassroomStudio.providers.set', 'app/api/model-config/route.ts:82-141');
      },
    },
  };

  // ── 逐域挂载（批次并行开发的接缝）────────────────────────────────────
  //
  // 每条上游 route 的搬运落在 `src/services/<域>.js` 里，用一个 `mountXxx(service, deps)`
  // 把自己挂到对应命名空间上。为什么不在本文件里逐个写：
  // 4 个批次要并行搬 80 条 route，同一个文件轮流改必然冲突；而"域"边界是稳定的
  // （生成 / 素材 / 智能体 / 平台），一个域一个文件就能互不越界。
  //
  // 挂载失败**只 warn 不抛**：某一域搬坏了，其它域与 `status()` 还得能用。
  const deps = { ports, log, dataDir, providerConfig };
  for (const mount of mounts) {
    try {
      mount(service, deps);
    } catch (error) {
      log?.error?.(`课堂服务挂载失败：${mount?.name ?? '(匿名)'}`, error?.message ?? error);
    }
  }

  // ── 旧契约兼容层 ─────────────────────────────────────────────────────
  //
  // 规范 §4 最初写的是 `classroom.load/save`，后来批 1 按上游 route 落了
  // `stages.get/put`（上游确实叫 stages）。两套名字指同一份存储，不能留一个桩：
  // L2/L3 里已经有按 `classroom.*` 写好的调用方，断了就是运行期 500。
  //
  // **形状差异必须抹平**：`stages.get` 返回的是 HTTP 信封 `{ httpStatus, body }`
  // （因为它就是 `GET /api/stages/[id]` 的 body），而 §4 的 `classroom.load(id)`
  // 返回的是**课堂文档本身**。`core-classroom-export` 的 `loadById` 直接读
  // `document.scenes`，拿到信封会判 `E_NOT_FOUND` —— 这条在端到端测试里真的踩到了。
  if (typeof service.stages?.get === 'function') {
    service.classroom = Object.assign(service.classroom ?? {}, {
      load: async (id, opts) => unwrapDocument(await service.stages.get(id, opts), id),
      save: (id, doc) => service.stages.put(id, doc),
    });
  }

  // ── §4 的 export.* 转发到真正的导出端口 ───────────────────────────────
  //
  // 规范 §4 写的是 `export.pptx(id)` / `export.html(id)`（收 id），而
  // `core-classroom-export` 的方法是 `pptx(classroom)`（收文档）。两边都合理，
  // 所以这里做适配：收 id 就先 `classroom.load`，收对象就直接用。
  if (ports.export && typeof ports.export.pptx === 'function') {
    const doc = async (idOrDoc, opts) => {
      if (idOrDoc && typeof idOrDoc === 'object' && Array.isArray(idOrDoc.scenes)) return idOrDoc;
      return service.classroom.load(idOrDoc, opts);
    };
    service.export = Object.assign(service.export ?? {}, {
      pptx: async (idOrDoc, opts) => ports.export.pptx(await doc(idOrDoc, opts), opts ?? {}),
      html: async (idOrDoc, opts) => ports.export.html(await doc(idOrDoc, opts), opts ?? {}),
      zip: typeof ports.export.zip === 'function'
        ? async (idOrDoc, opts) => ports.export.zip(await doc(idOrDoc, opts), opts ?? {})
        : undefined,
    });
  }

  return service;
}

/**
 * 把 `{ httpStatus, body }` 信封剥成课堂文档；4xx/5xx 转成领域错误。
 *
 * 为什么不直接返回 `body`：`export` 与页面都按「拿到就是文档」写的，
 * 一个 404 被当成文档会让它们渲染出一张空白页而不是报错。
 */
function unwrapDocument(response, id) {
  const isEnvelope = response && typeof response === 'object' && 'httpStatus' in response;
  if (!isEnvelope) {
    if (!response || typeof response !== 'object') {
      throw new ClassroomError('E_NOT_FOUND', `课堂不存在：${id}`, { id });
    }
    return response;
  }
  if (Number(response.httpStatus) >= 400) {
    throw new ClassroomError('E_NOT_FOUND', `课堂不存在：${id}`, {
      id,
      httpStatus: response.httpStatus,
      body: response.body,
    });
  }
  return response.body;
}

/**
 * 形状自检：`apply()` 在 provide 之前跑一次。
 *
 * 为什么要有：`createClassroomService` 的返回是手写的对象字面量，
 * 重构时漏一个 `runs:` 不会报错，只会在页面第一次点"取消"时才炸。
 * 这里把规范第 4 节的清单写成数据，对着它查一遍 —— 成本 10 行，省一次线上事故。
 *
 * @param {object} service
 * @returns {string[]} 缺失的方法路径（空数组 = 形状合格）
 */
export function inspectShape(service) {
  const expected = [
    ['status'],
    ['generate'],
    ['runs', 'get'],
    ['runs', 'cancel'],
    ['classroom', 'load'],
    ['classroom', 'save'],
    ['export', 'pptx'],
    ['export', 'html'],
    ['providers', 'list'],
    ['providers', 'set'],
  ];
  const missing = [];
  for (const path of expected) {
    // 前 n-1 段必须是对象（命名空间），最后一段必须是函数。
    // 不能拿"能不能顺着取到函数"当判据 —— 命名空间本身就是对象，
    // 用 typeof === 'function' 去查中间段会把 `runs.get` 误判成缺失。
    let cursor = service;
    let reachable = true;
    for (const key of path.slice(0, -1)) {
      cursor = cursor?.[key];
      if (cursor === null || typeof cursor !== 'object') {
        reachable = false;
        break;
      }
    }
    if (!reachable || typeof cursor?.[path[path.length - 1]] !== 'function') {
      missing.push(path.join('.'));
    }
  }
  return missing;
}

export { ClassroomError };
