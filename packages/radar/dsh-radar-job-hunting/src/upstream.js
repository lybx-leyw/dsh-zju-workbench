/**
 * 上游封装占位 —— **A 类骨架的「兼容层」位置，本轮不实现**。
 *
 * 上游 `dsh-plugin-job-hunting@1.2.2`（MIT）是原生 DSH 插件包，本身可直接挂载。
 * 本文件存在的唯一理由：本包对上游有**四处**改造（隐私、可读首行、在校生档位、隐藏字符），
 * 这些改造必须**在外面**做，不能改上游源码 —— 于是需要一个显式的兼容层。
 *
 * 本文件**不含任何上游实现**，只记录**契约**（函数名、参数、返回、约束），
 * 全部读自上游 `index.js` / `resume.js` / `careers.js` / `docx.js` 的**公开形状**。
 *
 * ⚠ 评审通过前，本文件所有导出一律抛错。
 * ⚠ 若评审认为「直接挂上游 + 一条 prompt 即可」，正确处置是**整目录删除**，不要留着空壳。
 */

/** 上游模块的形状（仅供评审对照，**未 import**）。 */
export const UPSTREAM_SHAPE = Object.freeze({
  /** `index.js` —— 三个面向模型的工具 + `inject = ['tools', 'web']` */
  tools: {
    job_search: {
      required: '(keyword | resumePath) 至少一个',
      optional: ['city', 'experience', 'resumePath', 'maxResults', 'freshnessDays', 'verifiedOnly'],
    },
    career_plan: { required: 'background', optional: ['city', 'targetRole', 'expectedSalary', 'education', 'years', 'market', 'maxRecommendations'] },
    career_interview: { required: '无', optional: ['background', 'answered'] },
  },

  /**
   * `resume.js` 的公开函数（**零依赖**：`node:zlib` 的 `inflateRawSync` + 手写 ZIP 中央目录）。
   *
   * 实跑验证（本轮沙箱，最小 docx）：
   *   zip entries: ['word/document.xml']
   *   docx text -> "张三 · 浙江大学\n熟悉 TypeScript 与 Python\n"
   */
  resume: ['readZip', 'docxToText', 'readCMap', 'pdfToText', 'loadResume', 'resumeProfileFromText'],

  /**
   * `careers.js` 的纯函数（文件头自陈 "Pure data + pure functions: no network, no Cordis APIs"）。
   *
   * 打分口径（读自 `scoreCareer`）：
   *   技能命中×34（最多算 4 项）+ 经验相通×24（销售/PM 兜底 8，其他 4）
   *   + 学历×14 + 年限×12 + 技能广度(≥4)×6
   *   − 学历级差≥2 扣 12；年限差×6；samePath 且非目标岗扣 8
   *   + 桥接岗（同时用上现有经验与目标方向）+6
   *   分档：≥62 稳妥可投 / ≥45 可转型（需补齐）/ ≥28 长期目标 / <28 暂不推荐
   */
  careers: ['buildProfile', 'scoreCareer', 'recommendCareers', 'assessTarget', 'careerQuestions', 'buildReport'],
});

/**
 * TODO-A（阻塞：需要评审先定「挂法」）
 *
 * 加载上游。
 *
 * 两种挂法，**都必须人工定**，不能由本包自行选择：
 *   ① `github:GOOGUO2333/dsh-job-hunting#1.2.2`（lockfile 锁 tag）
 *   ② vendor 到 `vendor/dsh-plugin-job-hunting/` 后按目录锁（与 `dsh-zhiyun-paper` 同法）
 *
 * 为什么不能 `^1.2.2`：上游是 ★0、建仓仅 2 天的新包，`^` 会让下一次 `pnpm i`
 * 静默升到未知版本，而它的 `job_search` 涉及**外发简历事实**，升级必须是人看过 diff 的。
 *
 * @returns {Promise<never>}
 */
export async function loadUpstream() {
  throw new Error('dsh-radar-job-hunting: 候选骨架，未实现（TODO-A：挂法未定）');
}

/**
 * TODO-B（依赖 TODO-1）
 *
 * 把上游 `resume.js` 的画像结果，收敛成**只有可外发字段**的形状。
 *
 * 上游画像含：`skills` / `years` / `education` / `cities` / job 线索。
 * 外发白名单：**`cities` + `skills`（仅标签名）**。
 * 明确**不外发**：学校、专业、姓名、公司、项目描述、任何原文片段。
 *
 * @param {unknown} rawProfile - 上游 `resumeProfileFromText()` 的返回。
 * @returns {{ cities: string[], skillTags: string[] }}
 */
export function toSearchSafeProfile(rawProfile) {
  void rawProfile;
  throw new Error('dsh-radar-job-hunting: 候选骨架，未实现（TODO-B）');
}

/**
 * TODO-C（借 `Gsync/jobsync` 的 `stripThinking` 思路，非复制其代码）
 *
 * 上游 `career_plan` 的返回是自由 Markdown。若模型先吐思维链，
 * `SCORES:` 首行就**不在第一行**了 —— 解析会整体失败。
 *
 * 本函数先剥掉思维链（`<thinking>…</thinking>` 一类），再交给 `parseMatchResult`。
 *
 * @param {string} raw - 模型原始输出。
 * @returns {string} 剥掉思维链后的正文。
 */
export function stripThinking(raw) {
  void raw;
  throw new Error('dsh-radar-job-hunting: 候选骨架，未实现（TODO-C）');
}
