// 【候选骨架 · 未评审 · 未接入 profile · 不可直接使用】
//
// 上游封装占位。
// B 类（其他 JS 项目）只做「能力提取 + 封装」，因此这里做三件事：
//   1. 把锁版凭据收在一处（单一真源）；
//   2. 把「注册哪些语言」写成有限白名单；
//   3. 把「本仓现状 vs 上游」写成可被逐条反驳的表。
// **不实现**任何高亮逻辑（实现留到评审通过之后）。

export const LOCK = Object.freeze({
  // 与 package.json 的 dependencies 必须逐字一致（不用 ^）。
  'highlight.js': '11.12.0',
});

/** 上游许可证（GitHub metadata + npm `license` 两源一致）。 */
export const LICENSES = Object.freeze({
  'highlight.js': 'BSD-3-Clause',
});

/**
 * 允许注册的语言白名单。
 *
 * 判据不是「多」，而是「**这门课的作业真的会贴什么代码**」：
 *   · `c` / `cpp` —— 程设、数据结构、OS、编译原理
 *   · `python` —— 机器学习、数值计算、脚本作业
 *   · `java` —— 部分课程 / 算法课工程题
 *   · `bash` / `sql` —— 实验报告里的命令段、数据库作业
 *   · `matlab` / `r` —— 工科课程、统计课
 *   · `javascript` / `typescript` / `html` / `css` —— Web 类课程、本仓自身插件开发
 *
 * ⚠ 白名单外的语言 → **不注册、不猜**（`highlightAuto()` 禁用）。
 *   宁可显示纯文本，也不要为了「猜对」把 190 个语言包打进首屏。
 */
export const LANGUAGE_WHITELIST = Object.freeze([
  'c', 'cpp', 'python', 'java', 'bash', 'sql',
  'matlab', 'r', 'javascript', 'typescript', 'html', 'css',
]);

/** 超过这个字符数就不高亮（讲义里贴了一整份源码的情形）。 */
export const MAX_CHARS = 20000;

/**
 * 本仓现状清单 —— 本候选存在的全部理由。
 *
 * 每一条都可在源码里指到位置；`missing: true` 的就是换底层能补上的。
 * 评审若认为某条「其实不痛」，直接反驳这一项即可，比讨论抽象优劣快。
 */
export const BASELINE = Object.freeze({
  // ✅ 渲染由宿主负责：`dsh-zhiyun-page-notes/src/client.jsx` L23-26 明写
  //    「正文用宿主的 MarkdownText，论文页与讲义阅读器都在用」→ 围栏代码块**能显示**。
  fencedRenderedByHost: { present: true, where: 'dsh-zhiyun-page-notes/src/client.jsx#MarkdownText' },
  // ❌ 但**没有着色层**：全仓 `grep -r 'hljs|shiki|highlight'` 只命中
  //    `packages/dsh-radar-better-markdown/src/index.js` 的一句 TODO 评论（见下）。
  tokenHighlight: { present: false, where: null },
  // ❌ 也没有「语言标签」到「着色器」的归一表：`js` / `jsx` / `mjs` / `node` 是四种写法。
  languageAliasing: { present: false, where: null },
  // ⚠ 已有相关 TODO 但**未落地**：`packages/dsh-radar-better-markdown/src/index.js` L37
  //    「评估 mermaid + katex + shiki 的体积与首屏影响」—— 说明团队已意识到这块，
  //    且当时的顾虑就是体积。本骨架用「core + 白名单懒加载」正面回应这条顾虑。
  priorTodo: { present: true, where: 'packages/dsh-radar-better-markdown/src/index.js#L37' },
});

/**
 * 「体积 vs 能力」的关键事实（沙箱实测，2026-10-19）。
 *
 * 这些数字就是本候选**能不能过评审**的门槛；任何一条被推翻，结论都可能反转。
 */
export const MEASURED = Object.freeze({
  tarballBytes: 5503982,          // npm `dist.unpackedSize` = 5.50 MB（全量包）
  esDirBytes: 2700000,            // `es/` 目录 ≈ 2.7 MB（含 190+ 语言）
  coreOnly: '二选一：`lib/core.esm.js` 只含引擎，语言逐个 import —— 首屏应为数十 KB 量级',
  registrationIsLazy: true,       // 实测：未 register 的语言调用会抛 `Unknown language`
  autoDetectNeedsFullBundle: true, // 实测：`highlightAuto('def f(x):…')` 返回 python，
                                   //       但那是**全量包**下；core-only 下 auto 只认已注册语言
  buildStep: null,                 // 无构建步骤：`es/` `lib/` 均为可直接 import 的源码
});

/** 名称归一表（**有限枚举**，未知落 null）。 */
export const ALIASES = Object.freeze({
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', node: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', python3: 'python',
  'c++': 'cpp', cc: 'cpp', cxx: 'cpp', h: 'cpp',
  sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
  mysql: 'sql', pgsql: 'sql', psql: 'sql',
  // 注意：不做 `makefile` / `dockerfile` / `json` 之类的映射 —— 它们不在白名单，
  // 统一落 null（显示纯文本）。白名单只服务「课程作业会贴的那几种」。
});

/**
 * 归一：围栏语言标识 → 白名单内的语言，否则 null。
 * 纯函数，可单测；**不调用任何上游 API**。
 */
export function normalizeLanguage(raw) {
  if (typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  const mapped = ALIASES[key] ?? key;
  return LANGUAGE_WHITELIST.includes(mapped) ? mapped : null;
}
