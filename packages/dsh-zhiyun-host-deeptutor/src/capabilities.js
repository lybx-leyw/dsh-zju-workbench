import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DeepTutorError } from './protocol.js';

/**
 * 能力五态目录（契约 §7 / §13）。
 *
 * 五态分别是：`upstream` / `depsAvailable` / `configured` / `verified` / `exposed`，
 * 它们回答的是五个**互相独立**的问题：
 *
 * 1. `upstream`      —— 上游注册表里到底有没有这个能力？（静态表 + bridge 上报合并）
 * 2. `depsAvailable` —— 本机 Python 环境能不能把它跑起来？（math_animator 需要 manim）
 * 3. `configured`    —— 模型 / 搜索等必需配置是否就位？（由 index.js 的 config.configured 给出）
 * 4. `verified`      —— 本机**真的成功跑通过**至少一次？（唯一来源是 capabilities-state.json）
 * 5. `exposed`       —— 产品是否已经开放给用户？（由 config.expose 给出）
 *
 * ⚠️ 关于 `verified`：它**只能**由真实成功的 run 触发写入，通过 `markVerified(name, runId)`。
 * 这里刻意不提供任何 `setVerified` / `setState` 之类的旁路 —— 一旦能手工置真，
 * 「已验证」就退化成一句没人验过的口号，而这个字段存在的全部意义就是防止这种事。
 *
 * ⚠️ 关于静态表：上游 `capabilities/registry.py` 里的注册表名与 capability manifest 里的
 * `name` **并不一致**（例如 `mastery` → `mastery_path`、`solve` → `deep_solve`），
 * 所以不能只信 bridge 的上报。内置 11 条静态表兜底，bridge 上报只用来覆盖/追加。
 */

/** 五态的字段名，顺序即契约 §7 的「五态」叙述顺序。 */
export const FIVE_STATES = Object.freeze(['upstream', 'depsAvailable', 'configured', 'verified', 'exposed']);

/**
 * 上游在 `upstream.lock.json` 里声明为 **deferred 的 extras**：
 * 默认安装（`extrasInstalled: ["server"]`）不包含它们，因此依赖这些 extras 的能力
 * 默认 `depsAvailable = false`。想变真必须由依赖探针给出证据。
 */
export const DEFERRED_EXTRAS = Object.freeze([
  'math-animator',
  'partners',
  'matrix',
  'rag-rerank',
  'video-learning',
  'parse',
]);

/**
 * 上游 11 个内置能力的静态描述（逐条核实自 `vendor/deeptutor/` 下的 capability 文件，
 * 行号见各条注释）。字段对应上游 `CapabilityManifest` 的
 * `name / description / stages / cli_aliases`。
 *
 * 顺序按 `upstream.lock.json` 的优先级：P0 → P1 → P2，与产品面一致。
 */
export const BUILTIN_CAPABILITIES = Object.freeze([
  {
    // 上游 agents/question/capability.py:31
    name: 'deep_question',
    description: 'Fast question generation (Template batches -> Generate).',
    stages: Object.freeze(['ideation', 'generation']),
    cliAliases: Object.freeze(['quiz']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 agents/chat/capability.py:14
    name: 'chat',
    description: 'Agentic chat: an exploring agent loop with tools, followed by a respond stage that streams the answer.',
    stages: Object.freeze(['exploring', 'responding']),
    cliAliases: Object.freeze(['chat']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 capabilities/ask_questions/capability.py:22
    name: 'ask_questions',
    description: 'Ask the user high-value questions to fill in missing context, then complete the original request with their answers.',
    stages: Object.freeze(['responding']),
    cliAliases: Object.freeze(['ask']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 capabilities/solve/capability.py:66
    name: 'deep_solve',
    description: 'Multi-step problem solving driven by the chat agent loop.',
    stages: Object.freeze(['responding']),
    cliAliases: Object.freeze(['solve']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 agents/visualize/capability.py:59 _VISUALIZE_STAGES + :91 manifest
    name: 'visualize',
    description: 'Generate a validated visualization with any installed visualizer type, or render a Manim animation/storyboard artifact.',
    stages: Object.freeze([
      'analyzing',
      'generating',
      'reviewing',
      'concept_analysis',
      'concept_design',
      'code_generation',
      'code_retry',
      'summary',
      'render_output',
    ]),
    cliAliases: Object.freeze(['visualize', 'viz']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 capabilities/reading/capability.py:115 —— 注意这是 LoopExtension，
    // 没有 CapabilityManifest，因此 stages / cli_aliases 都为空。
    name: 'immersive_reading',
    description: 'Immersive reading loop over a knowledge-base material, with anchored tool access.',
    stages: Object.freeze([]),
    cliAliases: Object.freeze([]),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 capabilities/course_study/capability.py:38 COURSE_STUDY_NAME / :383
    // 同样是 LoopExtension，无 CapabilityManifest。
    name: 'course_study',
    description: 'Course study loop that keeps a persistent course plan and drives study sessions from it.',
    stages: Object.freeze([]),
    cliAliases: Object.freeze([]),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 agents/research/capability.py:39
    name: 'deep_research',
    description: 'Multi-stage deep research: rephrase, decompose, research, then report.',
    stages: Object.freeze(['rephrasing', 'decomposing', 'researching', 'reporting']),
    cliAliases: Object.freeze(['research']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 agents/math_animator/capability.py:21 —— 需要 Manim 渲染，
    // 属于 upstream.lock.json 里 extrasDeferred 的 `math-animator`，默认没装。
    name: 'math_animator',
    description: 'Generate math animations or storyboard images with Manim.',
    stages: Object.freeze([
      'concept_analysis',
      'concept_design',
      'code_generation',
      'code_retry',
      'summary',
      'render_output',
    ]),
    cliAliases: Object.freeze(['animate']),
    requiresExtras: Object.freeze(['math-animator']),
    installHint: '需要额外安装 Manim 渲染依赖：pnpm run zhiyun:deeptutor:install -- --extras math-animator',
  },
  {
    // 上游 capabilities/audio_overview/capability.py:23
    name: 'audio_overview',
    description: 'Create a grounded two-voice audio overview and transcript from a knowledge base.',
    stages: Object.freeze(['retrieving', 'script_writing', 'voice_generation', 'publishing']),
    cliAliases: Object.freeze(['audio-overview', 'overview']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
  {
    // 上游 capabilities/mastery/capability.py:59 —— 注册表名是 mastery，manifest 名是 mastery_path。
    name: 'mastery_path',
    description: 'Mastery-based tutoring: a dedicated agent loop drives an adaptive mastery path with a hard, per-type mastery gate and spaced review.',
    stages: Object.freeze(['responding']),
    cliAliases: Object.freeze(['mastery']),
    requiresExtras: Object.freeze([]),
    installHint: '',
  },
]);

const BUILTIN_BY_NAME = new Map(BUILTIN_CAPABILITIES.map((entry) => [entry.name, entry]));

/**
 * 把「五态」拼成契约 §7 的 CapabilityEntry。
 *
 * 单独抽出来的原因：五态的计算（依赖探针、配置文件、stateFile、config）
 * 与展示字段（description/stages/aliases）来源不同，
 * 测试需要能只验五态推导而不启动任何东西。
 */
export function decorate(five, { name, description = '', stages = [], cliAliases = [] } = {}) {
  const state = {
    upstream: Boolean(five?.upstream),
    depsAvailable: Boolean(five?.depsAvailable),
    configured: Boolean(five?.configured),
    verified: Boolean(five?.verified),
    exposed: Boolean(five?.exposed),
  };
  const installHint = five?.installHint ?? '';
  return {
    name,
    description,
    stages: [...stages],
    cliAliases: [...cliAliases],
    ...state,
    installHint,
    reason: five?.reason ?? explain(state, { installHint }),
  };
}

/**
 * 能力不可用的**可解释原因**（契约 §7 的 `reason` 字段）。
 * 按「用户下一步该做什么」排序：先看上游有没有，再看依赖，再看配置，最后看是否开放。
 *
 * 注意 `verified` **不参与**这里：未验证不是不可用，只是还没有本机成功证据，
 * 该信号由 `verified` 布尔字段本身表达。把未验证写进 reason 会让设置页把
 * 十个能用的能力全标成异常。
 */
export function explain(state, { installHint = '' } = {}) {
  if (!state.upstream) return '上游注册表里没有该能力，可能是 vendor 快照与版本不匹配';
  if (!state.depsAvailable) {
    return installHint
      ? `运行依赖未就绪。${installHint}`
      : 'Python 运行依赖未就绪，请先安装 deeptutor 及其 extras';
  }
  if (!state.configured) return '缺少必需配置（模型行或搜索供应商），请先在设置里补齐';
  if (!state.exposed) return '该能力尚未对用户开放';
  return '';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readBooleanMap(source) {
  return isRecord(source) ? source : {};
}

/**
 * 能力目录。
 *
 * 入参同时支持两种形状，因为它们在不同调用点都真实存在：
 * - `{ bridge, expose, configured, stateFile, logger }` —— `src/index.js` 的实际调用（§13 现行签名）；
 * - `{ bridge, config, logger }` —— 早期契约草案形状，`expose/configured` 从 `config` 里取。
 *
 * @param {object} options
 * @param {object} [options.bridge] PythonBridge（可选；缺省时目录退化为纯静态表）
 * @param {Record<string, boolean>} [options.expose] 产品开放开关
 * @param {Record<string, boolean>} [options.configured] 配置就位开关
 * @param {string} [options.stateFile] capabilities-state.json 绝对路径（verified 唯一来源）
 * @param {object} [options.deps] 依赖探针结果 `{ installed, missing, installedExtras, missingExtras }`
 * @param {Record<string, boolean>} [options.depsByCapability] 逐能力依赖覆盖（测试与灰度用）
 * @param {object} [options.logger]
 */
export function createCapabilityCatalog(options = {}) {
  const { bridge, stateFile, logger = {} } = options;
  // 兼容早期形状：expose/configured 可能塞在 config 里。
  const legacyConfig = isRecord(options.config) ? options.config : {};
  const expose = readBooleanMap(options.expose ?? legacyConfig.expose);
  const configured = readBooleanMap(options.configured ?? legacyConfig.configured);
  const deps = isRecord(options.deps) ? options.deps : null;
  const depsByCapability = readBooleanMap(options.depsByCapability);

  /** capabilities-state.json 的内存镜像；null 表示还没读过。 */
  let verifiedState = null;
  /** 上次落盘失败的错误（只用于日志，不阻塞调用）。 */
  let lastStateError = null;
  let disposed = false;

  function warn(message, detail) {
    logger.warn?.(message, detail);
  }

  async function loadVerifiedState() {
    if (verifiedState) return verifiedState;
    verifiedState = {};
    if (!stateFile) return verifiedState;
    try {
      const raw = await readFile(stateFile, 'utf8');
      const parsed = JSON.parse(raw);
      // 只接受 `{ [capability]: { verifiedAt, runId } }`；其它形状一律当成空，
      // 避免一份手写的 `{"deep_question": true}` 意外把能力置真。
      if (isRecord(parsed)) {
        for (const [name, value] of Object.entries(parsed)) {
          if (isRecord(value) && typeof value.runId === 'string' && value.runId.trim() !== '') {
            verifiedState[name] = { verifiedAt: value.verifiedAt ?? null, runId: value.runId };
          }
        }
      }
    } catch (error) {
      // 文件不存在是正常状态（首次运行）；坏文件也退回空状态并留痕。
      if (error?.code !== 'ENOENT') warn('读取能力状态文件失败，本次按“未验证”处理', error?.message ?? String(error));
    }
    return verifiedState;
  }

  /** 依赖推导：显式探针 > extras 默认值。返回 { available, reason }。 */
  function resolveDeps(entry) {
    if (Object.hasOwn(depsByCapability, entry.name)) {
      const available = Boolean(depsByCapability[entry.name]);
      return {
        available,
        reason: available ? '' : '依赖探针报告该能力在本机不可用',
      };
    }
    // 整个 Python 环境都没装好时，所有能力都不可用。
    if (deps && deps.installed === false) {
      return { available: false, reason: 'Python 运行依赖未安装（deeptutor 无法 import）' };
    }
    const requiresExtras = entry.requiresExtras ?? [];
    if (!requiresExtras.length) return { available: true, reason: '' };

    const installedExtras = Array.isArray(deps?.installedExtras) ? deps.installedExtras : [];
    const missingExtras = Array.isArray(deps?.missingExtras) ? deps.missingExtras : [];
    const satisfied = requiresExtras.every(
      (extra) => installedExtras.includes(extra) && !missingExtras.includes(extra),
    );
    // 没有探针证据时按 upstream.lock 的事实取默认：deferred extras 默认没装。
    return {
      available: satisfied,
      reason: satisfied ? '' : `缺少上游 extras：${requiresExtras.join(', ')}（默认安装不含）`,
    };
  }

  /** 把上游上报的一条 capability 归一成静态表同构的形状。 */
  function normalizeUpstreamEntry(raw) {
    if (!isRecord(raw)) return null;
    const name = typeof raw.name === 'string' && raw.name.trim() !== '' ? raw.name.trim() : null;
    if (!name) return null;
    const availability = isRecord(raw.availability) ? raw.availability : null;
    return {
      name,
      description: typeof raw.description === 'string' ? raw.description : '',
      stages: Array.isArray(raw.stages) ? raw.stages.map(String) : [],
      cliAliases: Array.isArray(raw.cli_aliases)
        ? raw.cli_aliases.map(String)
        : Array.isArray(raw.cliAliases)
          ? raw.cliAliases.map(String)
          : [],
      requiresExtras: Array.isArray(raw.requiresExtras) ? raw.requiresExtras.map(String) : undefined,
      installHint: typeof raw.install_hint === 'string' ? raw.install_hint : typeof availability?.install_hint === 'string' ? availability.install_hint : '',
      /** 上游自带的可达标记（`availability.available`）；undefined 表示上游没说。 */
      upstreamAvailable: typeof availability?.available === 'boolean' ? availability.available : undefined,
    };
  }

  /**
   * 探测上游注册表。
   * 失败不是错误 —— 服务不可用时目录必须仍能返回静态表，否则设置页会一片空白。
   */
  async function probeUpstream() {
    if (typeof bridge?.request !== 'function' || disposed) return { entries: [], warning: null };
    try {
      const result = await bridge.request(METHODS.capabilities, {});
      const list = Array.isArray(result?.capabilities)
        ? result.capabilities
        : Array.isArray(result)
          ? result
          : [];
      return { entries: list.map(normalizeUpstreamEntry).filter(Boolean), warning: null };
    } catch (error) {
      return {
        entries: [],
        warning: `无法从上游读取能力注册表，已退回内置清单：${error?.message ?? String(error)}`,
      };
    }
  }

  function buildEntry(entry, upstreamEntry, verified) {
    const requiresExtras = upstreamEntry?.requiresExtras ?? entry?.requiresExtras ?? [];
    const base = {
      name: entry?.name ?? upstreamEntry?.name,
      description: entry?.description ?? upstreamEntry?.description ?? '',
      stages: entry?.stages ?? upstreamEntry?.stages ?? [],
      cliAliases: entry?.cliAliases ?? upstreamEntry?.cliAliases ?? [],
      requiresExtras,
      installHint: entry?.installHint ?? upstreamEntry?.installHint ?? '',
    };
    const depsResolution = resolveDeps(base);
    const upstreamAvailableFlag = upstreamEntry?.upstreamAvailable;
    const five = {
      // 静态表命中即视为上游存在；若上游明确说不存在，以上游为准。
      upstream: upstreamAvailableFlag === undefined ? Boolean(entry) || Boolean(upstreamEntry) : upstreamAvailableFlag,
      depsAvailable: depsResolution.available,
      // 缺省视为已配置：配置文件的默认值不该让所有能力一起变灰。
      configured: Object.hasOwn(configured, base.name) ? Boolean(configured[base.name]) : true,
      verified: Boolean(verified),
      exposed: Object.hasOwn(expose, base.name) ? Boolean(expose[base.name]) : true,
    };
    if (!depsResolution.available && base.installHint) five.installHint = base.installHint;
    // reason 由 explain() 统一推导，保证「哪一层挡住了」只有一个实现。
    const reason = explain(five, { installHint: base.installHint });
    if (reason) five.reason = reason;
    return decorate(five, base);
  }

  async function listEntries() {
    const verified = await loadVerifiedState();
    const { entries: upstreamEntries, warning } = await probeUpstream();
    const upstreamByName = new Map(upstreamEntries.map((entry) => [entry.name, entry]));

    // 内置 11 条：静态表提供展示字段，上游上报只做覆盖。
    const out = BUILTIN_CAPABILITIES.map((entry) => {
      const upstreamEntry = upstreamByName.get(entry.name) ?? null;
      upstreamByName.delete(entry.name);
      return buildEntry(entry, upstreamEntry, verified[entry.name]);
    });
    // 上游有、静态表没有的能力也要露出来（不能因为没登记就假装不存在）。
    for (const upstreamEntry of upstreamByName.values()) {
      out.push(buildEntry(null, upstreamEntry, verified[upstreamEntry.name]));
    }
    if (warning) logger.warn?.(warning);
    return out;
  }

  async function getEntry(name) {
    const verified = await loadVerifiedState();
    if (typeof name !== 'string' || name.trim() === '') return null;
    const key = name.trim();
    const staticEntry = BUILTIN_BY_NAME.get(key) ?? null;
    const { entries: upstreamEntries } = await probeUpstream();
    const upstreamEntry = upstreamEntries.find((entry) => entry.name === key) ?? null;
    if (!staticEntry && !upstreamEntry) return null;
    return buildEntry(staticEntry, upstreamEntry, verified[key]);
  }

  return {
    /** 全部能力条目（契约 §7 CapabilityEntry[]）。 */
    async list() {
      return listEntries();
    },

    /** 单条查询；不存在返回 null（调用方负责翻译成 E_CAPABILITY_UNAVAILABLE）。 */
    async get(name) {
      return getEntry(name);
    },

    /**
     * 标记「已验证」。**唯一**的置真入口，只能由真实成功的 run 调用（service 在 run
     * 终态为 succeeded 时调用）。传入非法 runId 直接抛错，避免出现“没有 run 也算验证过”。
     */
    async markVerified(name, runId) {
      if (typeof name !== 'string' || name.trim() === '') {
        throw new DeepTutorError('E_CAPABILITY_UNAVAILABLE', '能力名不能为空，无法标记为已验证');
      }
      if (typeof runId !== 'string' || runId.trim() === '') {
        throw new DeepTutorError(
          'E_PROTOCOL',
          '标记能力为已验证必须提供真实运行 ID（verified 只能由成功 run 触发）',
          { name },
        );
      }
      if (!BUILTIN_BY_NAME.has(name) && !(await getEntry(name))) {
        throw new DeepTutorError('E_CAPABILITY_UNAVAILABLE', `未知能力：${name}，无法标记为已验证`, { name });
      }
      const state = await loadVerifiedState();
      state[name] = { verifiedAt: new Date().toISOString(), runId };
      if (!stateFile) {
        // 没有 stateFile 就无法持久化 verified —— 这是配置错误，但不该把 run 弄挂。
        warn('未配置 capabilities-state.json 路径，已验证状态只存在于内存');
        return;
      }
      try {
        await mkdir(dirname(stateFile), { recursive: true });
        await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        lastStateError = null;
      } catch (error) {
        lastStateError = error;
        warn('写入能力状态文件失败，已验证状态仅在本次进程内有效', error?.message ?? String(error));
      }
    },

    isExposed(name) {
      return Object.hasOwn(expose, name) ? Boolean(expose[name]) : true;
    },

    /** 上次状态文件写入错误（可观测用，不抛）。 */
    getStateError() {
      return lastStateError;
    },

    async dispose() {
      disposed = true;
      verifiedState = null;
    },
  };
}
