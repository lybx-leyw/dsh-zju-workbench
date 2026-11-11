/**
 * 求职 / 去向 —— **候选骨架，占位不实现**。
 *
 * 本文件只写「要接在哪、要变成什么形状」，**不写任何业务逻辑**，所有入口一律抛错。
 * 评审通过后才可继续实现；驳回则整目录删除。
 *
 * 落点（**既有**面板，本包不注册任何插槽、不新建页）：
 *
 *   ① 「规划」页既有条目行（`dsh-zhiyun-page-planning`）
 *      → 在**既有行**上加一栏「去向：投什么 / 差什么」，点击时才拉取。
 *   ② 简历解析 → 画像
 *      → 复用上游 `dsh-plugin-job-hunting@1.2.2` 的 `resume.js`（零依赖 docx/pdf），
 *        **但只在本机跑**，见 TODO-1。
 *   ③ 匹配打分
 *      → 复用上游 `careers.js` 的纯函数部分（`scoreCareer` / `recommendCareers`），
 *        **但 `CAREERS` 知识库要换**，见 TODO-4。
 *
 * ⚠ 本包定位是 **A 类（锁版挂载 + 外围兼容层）**：`dependencies` 写死上游 `1.2.2`。
 *   不改上游源码、不搬上游代码；本包里只出现「契约」与「口径」，不出现上游实现。
 */

/** 上游包名与锁版版本（**版本写死，不用 `^`**）。 */
export const UPSTREAM = Object.freeze({
  name: 'dsh-plugin-job-hunting',
  version: '1.2.2',
  license: 'MIT',
  repo: 'GOOGUO2333/dsh-job-hunting',
});

/** 面板落点：本包只加「一栏」，不新建页。评审若要求独立页 → 判据①不成立，应驳回。 */
export const HOST_PAGE = 'dsh-zhiyun-page-planning';

/**
 * 上游三个工具里，本包**只用两个**。
 *
 * `job_search` 在 TODO-1 未决前**禁用**：它会把简历事实拼进 `ctx.web` 检索词。
 * `career_plan` 依赖 `CAREERS` 知识库（社招口径），TODO-4 未决前同样禁用。
 */
export const ALLOWED_TOOLS = Object.freeze(['resume_profile_local']);

/**
 * TODO-1（阻塞 · 隐私红线）
 *
 * 只在本机把简历文件变成画像，**不触发任何网络**。
 *
 * 上游 `job_search({ resumePath })` 的语义是：解析简历 → 提取技能/城市/年限
 * → **把技能并入检索词** → 走 `ctx.web` 检索。也就是说简历内容会离开本机。
 * 本包要求：解析与打分留在本机，**只有 `city` 与技能标签**可以进检索词。
 *
 * @param {{ path: string }} input - 简历文件绝对路径（`.docx` / `.pdf` / `.txt` / `.md`）。
 * @returns {Promise<{ skills: string[], years: number|null, education: string, cities: string[] }>}
 */
export async function resumeProfileLocal(input) {
  void input;
  throw new Error('dsh-radar-job-hunting: 候选骨架，未实现（TODO-1）');
}

/**
 * TODO-2（阻塞 · 需要产品拍板「只读还是要写」）
 *
 * 是否允许发起投递。
 *
 * 本包主张 **false（只读）**：只回答「投什么、差什么」，投递动作仍由人点。
 * 参考 `1bailan/dsh-plugin-boss-zhipin`（MIT）在「安全与边界」里自设的红线：
 * 不绕验证码/风控/每日上限、不批量、不留常驻进程。
 * 若要开放写，必须先过该红线，且**不能**放宽 DSH 沙箱到 `danger-full-access`。
 *
 * @returns {false} 候选骨架阶段恒为 false。
 */
export function allowApply() {
  return false;
}

/**
 * TODO-3（借 `Gsync/jobsync` 的口径，非复制其代码）
 *
 * 匹配结果的**机器可读首行**：
 *
 *     SCORES: match=<0-100> recommendation=<strong|good|partial|weak>
 *
 * 后面空一行，再接 GitHub 风格 Markdown 正文。评分带：
 * 80-100 strong / 65-79 good / 50-64 partial / 35-49 weak / <35 poor。
 *
 * 两个必须照做的细节（否则流式渲染会闪或整行丢分）：
 *   ① 数字贪婪匹配 `(\d+)` 再 `clamp(0,100)` —— 别用 `\d{1,3}`，否则 1000 会让**整行解析失败**；
 *   ② 首行还没流完时，把半截 `^\s*SCORES:[^\n]*` 也遮住，否则用户会看到它闪一下。
 *
 * @param {unknown} payload - 上游返回的匹配结果。
 * @returns {{ scores: { match: number, recommendation: string }|undefined, body: string }}
 */
export function parseMatchResult(payload) {
  void payload;
  throw new Error('dsh-radar-job-hunting: 候选骨架，未实现（TODO-3）');
}

/**
 * TODO-4（阻塞 · 知识库不通用）
 *
 * 上游 `careers.js` 的 `CAREERS` 是**中国大陆社招**口径（城市分级、薪资带、
 * 「稳妥可投 / 可转型 / 长期目标」四档、桥接岗加权）。
 * 本仓的目标人群是**浙大在读 → 暑期实习 / 秋招**，"可转型"这一档对他们是噪声。
 *
 * 本函数要产出**面向在校生**的档位：`现在就能投` / `补一项技能就能投` / `明年再投`。
 *
 * @param {unknown} profile - 本机画像。
 * @returns {Promise<unknown>} 待定（评审后定形状）。
 */
export async function assessForStudent(profile) {
  void profile;
  throw new Error('dsh-radar-job-hunting: 候选骨架，未实现（TODO-4）');
}

/**
 * TODO-5（借 `resume-llm/resume-ai` 的检测口径，非复制其代码）
 *
 * 隐藏字符 / 异常空白检测，**JD 与简历两侧都做**。
 *
 * 三条检测（本轮已在沙箱实跑验证）：
 *   - 零宽字符：`U+200B/200C/200D/2060/FEFF/00AD`
 *   - 异常空白：`/[ \t]{15,}/`
 *   - 非打印字符：`category(c).startsWith('C')` 且不是 `\n\r\t `
 *
 * ⚠ 参考实现有个小毛病要修：零宽字符**本身**也是非打印字符，会**同时报两条**。
 *   本包要求先判零宽、命中就不再计入「非打印」计数（或并入同一条警告）。
 *
 * @param {string} text - 待检文本。
 * @param {'jd'|'resume'} side - 文本来源（简历侧要额外提示「你的简历被塞了隐藏词」）。
 * @returns {{ code: 'zero-width'|'long-space'|'non-printable', count: number, message: string }[]}
 */
export function detectHiddenContent(text, side) {
  void text; void side;
  throw new Error('dsh-radar-job-hunting: 候选骨架，未实现（TODO-5）');
}

/**
 * Cordis 插件入口 —— **必须保持抛错**。
 *
 * 本包任何一行都不该在真实环境里生效；`apply()` 抛错在 Cordis 里是整束起不来，
 * 这正是「不可直接使用」该有的表现（与 `dsh-radar-pta-progress` 同一约定）。
 */
export function apply() {
  throw new Error('dsh-radar-job-hunting: 候选骨架，未接入 profile，请勿挂载');
}
