/**
 * 出题引擎注册表：内建引擎仍是 `QUIZ_ENGINES` 常量，注册项只做**追加**。
 *
 * # 为什么要有这一层
 *
 * 从 r4 起，实验引擎不再演进入产品内核，而是留在 `dsh-zhiyun-quiz-lab`。
 * 但「有哪些引擎」这件事原本硬编码在三处：本文件的 `QUIZ_ENGINES`、`versions` 查表、
 * `question-bank.js` 的 `engine === 'r3-v9'` 链式分支。加一个引擎要改三个包，
 * 这不是挂载，是改产品。
 *
 * # 为什么状态住在模块级而不是 Cordis 服务上
 *
 * `planEngineQuestions` / `canResumeEngine` / `engineComplete` 都是**同步纯函数**，
 * 而 Cordis 服务是异步注入的。注册表若只活在 `ctx` 上，这三个函数就查不到它。
 * 所以真相在模块级，`index.js` 交出的服务只是把注册/注销动作暴露给插件
 * （见 `ctx.provide('zhiyunQuizEngines', …)`）。
 *
 * 副作用边界：模块级状态只会被 `register` 改动，而 `register` 只有经过 Cordis
 * 服务才拿得到。**未安装任何 lab 包时，本表恒为空，所有纯函数行为与改动前逐字一致。**
 *
 * # 未登记引擎为什么必须返回 `null` 而不是 `undefined`
 *
 * 旧实现是 `versions[engine]`，未登记时取值 `undefined`；而 `canResumeEngine` 写的是
 * `job.checkpoint.version === versions[engine]`，未知引擎两侧都是 `undefined`，
 * `undefined === undefined` 为真 —— **任意断点都会被判成可恢复**。
 * 这是一次「查表失败被读成了通过」。`engineVersionOf` 对未知引擎返回 `null`，
 * 使任何真实版本号都不可能与它相等（null 只等于 null，而版本号永远不会是 null）。
 */

/**
 * 注册项的形状。
 *
 * @typedef {object} QuizEngineRegistration
 * @property {string} id 稳定标识，写入题目的 provenance.engine
 * @property {string} label 目录中的显示名
 * @property {string} description 目录中的说明
 * @property {string} checkpointVersion 该引擎断点的版本号（恢复判定的唯一依据）
 * @property {boolean} [native] 是否使用 engineState.kernel 参与恢复判定
 * @property {'course'|'web'} [source] 允许的资料来源；缺省按 native 推导
 * @property {(hosts: object) => {generatePoints: Function, dispose?: Function}} createRun
 */

const registry = new Map();

const text = value => typeof value === 'string' && value.trim().length > 0;

/** 内建引擎的版本号。与改动前逐字相同——r1 / r3 v9 的断点格式一个字节都不变。 */
const BUILTIN_VERSIONS = {
  'r1': 'point-quiz-r1-batch-v2',
  'r3-v9': 'point-quiz-r3-v9-batch-v2',
  'deeptutor-native': 'point-quiz-deeptutor-native-batch-v2',
};
/** r1 的版本号来自内核常量，不能在这里重复写死。延迟到调用时才取，避免循环依赖。 */
const resolveBuiltinVersion = engine => engine === 'r1' ? r1Version() : BUILTIN_VERSIONS[engine] ?? null;

let r1VersionImpl = null;
/** `index.js` 在加载内核后注入，避免本文件反向 import 内核造成循环。 */
export function _bindR1Version(read) { r1VersionImpl = read; }
const r1Version = () => r1VersionImpl?.() ?? null;

/** 内建名单。注册项**不能**覆盖它们——内建引擎的断点格式归产品管。 */
const BUILTIN_IDS = Object.freeze(['r1', 'r3-v9', 'deeptutor-native']);
export const isBuiltinEngine = engine => BUILTIN_IDS.includes(engine);

/**
 * 注册一个外部引擎。
 * @param {QuizEngineRegistration} entry
 * @returns {() => void} 注销函数（幂等）
 */
export function registerEngine(entry) {
  if (!entry || typeof entry !== 'object') throw Object.assign(Error('引擎注册项必须为对象'), { code: 'INPUT' });
  if (!text(entry.id)) throw Object.assign(Error('引擎注册项缺少 id'), { code: 'INPUT' });
  if (isBuiltinEngine(entry.id)) throw Object.assign(Error(`内建引擎 ${entry.id} 不能被注册项覆盖：它的断点格式归产品管`), { code: 'INPUT' });
  if (registry.has(entry.id)) throw Object.assign(Error(`出题引擎 ${entry.id} 已注册`), { code: 'INPUT' });
  if (!text(entry.label) || !text(entry.description)) throw Object.assign(Error(`引擎 ${entry.id} 缺少 label 或 description`), { code: 'INPUT' });
  if (!text(entry.checkpointVersion)) throw Object.assign(Error(`引擎 ${entry.id} 缺少 checkpointVersion：没有它就无法判断断点能否恢复`), { code: 'INPUT' });
  if (typeof entry.createRun !== 'function') throw Object.assign(Error(`引擎 ${entry.id} 缺少 createRun：只登记目录而不提供工厂的引擎无法出题`), { code: 'INPUT' });
  const stored = Object.freeze({ ...entry });
  registry.set(entry.id, stored);
  return () => {
    if (registry.get(entry.id) === stored) registry.delete(entry.id);
  };
}

/** 已注册的外部引擎（不含内建）。 */
export const registeredEngines = () => [...registry.values()];

/**
 * 引擎断点版本号。
 *
 * 未知引擎返回 **null**，使 `checkpoint.version === engineVersionOf(engine)`
 * 在断点缺失版本时恒为假 —— 不能把「查不到」读成「匹配」。
 */
export function engineVersionOf(engine) {
  if (typeof engine !== 'string' || !engine) return null;
  // local / deeptutor 是历史引擎（见 engines.js 的 `versions` 原表），版本号同样来自内核常量。
  if (engine === 'local' || engine === 'deeptutor') return resolveLocalVersion();
  if (isBuiltinEngine(engine)) return resolveBuiltinVersion(engine);
  return registry.get(engine)?.checkpointVersion ?? null;
}

/** 另两条历史引擎（local / deeptutor）的版本号同样来自内核常量。 */
let localVersionImpl = null;
export function _bindLocalVersion(read) { localVersionImpl = read; }
const resolveLocalVersion = () => localVersionImpl?.() ?? null;

/**
 * 全部引擎目录：内建在前，注册项按注册顺序追加。未装 lab 时恒等于三条。
 *
 * ⚠️ 这是**能力目录**，不是**可选项**。已经收起来的引擎仍然要在这里，
 * 否则老断点会连版本号都查不到（`engineVersionOf` 返回 null ⇒ 一律不可恢复），
 * 用户手上没跑完的批次就永久废了。要问「界面上能选哪些」请用 `selectableEngines`。
 */
export function engineEntries() {
  return [...BUILTIN_CATALOG_READER(), ...registeredEngines().map(({ createRun, ...row }) => row)];
}

/**
 * 产品当前**允许发起新批次**的引擎。
 *
 * 与 `engineEntries` 分开是有意的：收起来的引擎（r1 / r3 v9 / 各实验引擎）
 * 依然登记在册，老断点照常可读、可续跑、可查看，只是不再出现在新建下拉里。
 * 一个引擎「不该再被选」和「从没存在过」是两件事，混成一个会让存量数据变成孤儿。
 */
const SELECTABLE = Object.freeze(['deeptutor-native', 'r1']);
export const isSelectableEngine = engine => SELECTABLE.includes(engine);
export function selectableEngines() {
  return engineEntries().filter(row => isSelectableEngine(row.id));
}
/**
 * 新建批次的默认引擎。
 *
 * 保留 r1 不是怀旧：它是唯一一条**不依赖 DeepTutor 上游**的本地引擎。
 * 若把可选集合收窄成 DeepTutor 一条，上游没装、依赖缺失或子进程崩掉时，
 * 用户就连一道题都出不了 —— 把可用性押在单一外部依赖上不是收敛，是单点。
 */
export const DEFAULT_ENGINE = 'deeptutor-native';

/**
 * `QUIZ_ENGINES` 的读取器由 `engines.js` 注入。
 *
 * 不直接 import 是为了让本文件保持零依赖：`engines.js` 已经 import 了 r1 内核，
 * 反过来再 import 它会形成环。
 */
let BUILTIN_CATALOG_READER = () => [];
export function _bindBuiltinCatalog(read) { BUILTIN_CATALOG_READER = read; }

/** 引擎是否使用 engineState.kernel 参与恢复判定。 */
export function isNativeRegistered(engine) {
  if (isBuiltinEngine(engine)) return engine === 'r3-v9' || engine === 'deeptutor-native';
  return registry.get(engine)?.native === true;
}

/** 允许的资料来源：注册项可显式声明，缺省按 native 推导。 */
export function sourceOf(engine) {
  const declared = registry.get(engine)?.source;
  if (declared) return declared;
  return isNativeRegistered(engine) ? 'course' : null;
}

/** 仅供测试：清空注册表，避免用例之间互相污染。 */
export function _resetEngineRegistry() { registry.clear(); }
