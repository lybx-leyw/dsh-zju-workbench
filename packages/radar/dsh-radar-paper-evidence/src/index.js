/**
 * dsh-radar-paper-evidence —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**：只标注适配点与 TODO，不写业务逻辑。`apply()` 直接抛错 ——
 * 目的与 `dsh-radar-paper-union` / `dsh-radar-kb-rag` 相同：万一有人误挂，
 * **立刻响**，而不是静默转成一个什么都不做的包。
 *
 * ═══ 这个包想做什么（强化式集成，不是新建功能）═══════════════════════
 *
 * 「论文阅读」页（`dsh-zhiyun-page-paper`）现在能做的：翻页、选文本、悬停翻译、
 * 整篇翻译、右侧 AI 助手抽屉、SSE 流式回答、点「第 N 页」跳转。
 * AI 回答里的页码是**可点的**，但它是**页级**的 —— 点过去落在页首，用户还得自己找那句话。
 *
 * 缺的是**页与句之间那一级**：一个稳定的、可寻址的**原文区块 id**。
 *
 *   | 问法 | 现有回答 | 粒度 | 谁在做 |
 *   | --- | --- | --- | --- |
 *   | 「这篇讲了什么」 | 右侧抽屉整段回答 | 篇 | 锁版上游 `/paper-reader/api/session/follow` |
 *   | 「这句英文什么意思」 | 悬停译文浮层 | 选区 | `ReaderFrame.jsx`（`selection-text.js` 判定） |
 *   | 「这个结论在第几页」 | 页码 chip，可点跳转 | **页** | `AssistantDrawer.jsx` |
 *   | 「这个结论原话是**哪一句**、支持什么**不**支持什么」 | **无** | **句/块** | **缺 ← 本包** |
 *
 * 第四行不是「再做一个 AI 问答」。问的还是同一个问题，界面还是同一个页面，
 * 只是答案的落点从「第 7 页」变成「第 7 页的 p007-b014」。这就是 skill 定义的
 * **强化式集成**：同一个面板 + 功能相似正交（同一支问答的落点精度） + 底层多调了更优质实现。
 *
 * ═══ 三条判据核对 ═══════════════════════════════════════════════════
 *
 *   ① 仍是同一个面板 —— 本包**不注册新页面、不注册 slot**。锚点层画在
 *      `dsh-zhiyun-page-paper` 已有的 `ReaderFrame` iframe **内部**，与主题注入
 *      （`frame-theme.js`）走同一条注入通道。用户看到的是同一页，只是多了可点的框。
 *
 *   ② 功能仍相似正交 —— 正交在**粒度**：页 → 块/句。不是把「选文本翻译」重做一遍，
 *      也不是再挂一个聊天框。
 *
 *   ③ 底层多调了更优质实现 —— 见下节。**但注意：这部分要打折扣，见「已知风险」。**
 *
 * ═══ 底层到底「更优」在哪 ══════════════════════════════════════════
 *
 * 候选源头 `piggymon907/codex-paper-reader-skill`（MIT，release 2.7.1）给的是一套
 * **已经跑通过的坐标与证据契约**，不是一堆 UI：
 *
 *   - 坐标：**PDF point，左上原点**，页面尺寸留在 `paper_index.json`，**只在浏览器里换百分比**。
 *     （`assets/reader/reader.js` 把 `bbox` 换成百分比交给 `markerLayer`）
 *   - 断裂行：一个标记挂**多个** `bboxes`；图/表/公式另给一个 `visual_bbox` 供裁切放大。
 *   - 每个标记强制三类字段：`supports` / `does_not_support` / `limitations`。
 *     这是**本仓目前完全没有的**东西 —— 现在的回答只有「说了什么」，没有「没说什么」。
 *   - 同一份证据对象同时喂侧栏摘要与全屏讲解，**禁止**生成两套解释
 *     （上游 `SKILL.md` 原文：「Do not generate a short sidebar explanation and a second
 *     independent long explanation」）。
 *   - 构建身份不可变：`run_manifest.json` 写入 `generator.skill_version` + 四项文本质量
 *     计数（`long_alpha_runs` / `cid_artifacts` / `suspicious_glue_boundaries` /
 *     `damaged_formula_references`），**身份不符按校验失败处理**，不静默套用新规则。
 *
 * 第四条尤其值钱：本仓论文页的文本来自上游转录，而 PDF 抽取的三大老毛病
 * （连写字母串、CID 乱码、公式贴边）**恰好就是**这四个计数要抓的。现在页面上只有
 * 「转录状态」一个布尔量，用户不知道转录是「凑合能用」还是「干净」。
 *
 * ═══ 已知风险（评审必须先看，别只看上面那段）════════════════════════
 *
 *   R1【最重要】上游**不是 JS 依赖**，不能 `npm install`。它是 Python 脚本 + 静态
 *      HTML 的 Agent Skill（`requirements.txt` 仅 24 B）。**「更优的底层」只存在于
 *      `assets/reader/reader.js`（52.7 KB，前端渲染）与 `references/data-contract.md`
 *      （契约）。后端抽取（`extract_paper.py` 25.7 KB、`build_reader.py` 16.5 KB）是
 *      Python，**与本仓 Node 宿主不能共用**。
 *      ⇒ 现实可选项只有两个，评审须二选一：
 *        (a) **只取契约**（坐标约定 + 三类字段 + 构建身份），抽取仍用上游转录，自己算 bbox；
 *        (b) 连 Python 抽取一起引，作为**旁路进程**在服务端跑 —— 这一条要新增 Python
 *            运行时，属于架构级决定，**远超雷达候选骨架的裁决权**。
 *      本骨架**默认按 (a) 写**，但**不预判** (a) 一定可行 —— 见 R2。
 *
 *   R2 上游 reader 是**整页渲染**形态（`#pageImage` + `#pageCanvas` + `#markerLayer`），
 *      它要有**页面位图**和**文字块坐标**才能画锚点。本仓 `/paper-reader/` 路由是否已经
 *      给出「每页位图 URL」与「每块 bbox」**尚未核实**（`page-paper` 的 `library.js`
 *      只封装了 24 条路由的调用面，没暴露字段）。若上游的 PDF 渲染是**纯 pdf.js 客户端
 *      逐层画**，那么 bbox 得在浏览器里从 pdf.js 的 text layer **现算** —— 成本与精度
 *      都完全不同。**这是本候选能否落地的第一道闸门**，未过则整包作废。
 *
 *   R3 位置之外还有一层：本仓 iframe 是**同源**的（`page-paper` README 明说），
 *      所以子页面里能挂事件、能读 DOM —— 这一点**已验证可行**（`frame-theme.js` 就是
 *      这么注入的）。但 `markerLayer` 的 z-index 与上游浮层（`#cfg-pop` / `#ask-pop`）
 *      的遮挡关系**没测过**，上游把控件搬走后留下的空档会不会吞点击，**未知**。
 *
 *   R4 许可证：上游 **MIT** ✅（`LICENSE` 1070 B 实文已核）。但若走 (a) 只取契约，
 *      本包**不摘代码**，只作契约出处登记 —— 依 skill「不搬运上游源码」硬边界，
 *      契约里的**字段名**（`supports` / `bboxes` / `visual_bbox`）属于接口，不属于实现，
 *      可以照用；**任何函数体都不抄**。
 *
 *   R5 与 `dsh-radar-paper-union` 的边界：那个包补的是**检索半径**（全网），
 *      本包补的是**定位粒度**（块/句）。两者都改论文页，但**不改同一行代码**
 *      （一个是检索抽屉的来源，一个是 iframe 内的锚点层）。并行不冲突，但
 *      **评审前请先合并看**，避免两个骨架同时改 `ReaderFrame`。
 *
 * ═══ TODO 一览（每一项都是评审要拍板的，不是「怎么写代码」）════════════
 *
 *   TODO-0【阻塞】R2：上游 `/paper-reader/` 有没有「每页位图 + 每块 bbox」？
 *               → 有：本包按 (a) 直推；没有：先评估 pdf.js text layer 现算 bbox 的精度，
 *                 精度不达标则**整包驳回**，改登记为「能力提取（坐标契约）」。
 *   TODO-1【阻塞】R1 二选一：(a) 只取契约 / (b) 引 Python 旁路。**默认 (a)**。
 *   TODO-2 锚点数据存哪：新增一张副表（`paper_anchor`），还是落在现有转录产物的旁边？
 *              倾向副表 —— 锚点与转录是**不同生命周期**（换模型不必重算锚点）。
 *   TODO-3 `supports` / `does_not_support` / `limitations` 三字段谁来填？
 *              上游是 LLM 填 + `teaching_audit.py` 审计 + `validate_reader.py` 质检。
 *              本仓若只有 LLM 填、没有质检，「说没说什么」会变成**编造**，
 *              比不显示更糟。**没有质检就不上线这三个字段**。
 *   TODO-4 构建身份四项文本质量计数：本仓转录是上游给的，计数要先能算出来
 *              （`long_alpha_runs` 好算；`cid_artifacts` 要看转录是否保留 CID 痕迹）。
 *              算不出来就**只显示可得的那几项**，不要显示 0 —— 0 会被读成「很干净」。
 *   TODO-5 与 `AssistantDrawer` 的页码 chip 合并：新 chip 应显示「p7 · p007-b014」还是
 *              只显示块号？**不要**在同一行塞两个可点目标。
 *   TODO-6 若最终只保留 R5 里「构建身份 + 文本质量计数」这一小块（它不依赖 bbox），
 *              可以单独成为一个极小包，**不必**拖整个锚点层 —— 评审可考虑拆包。
 */

/** @type {import('cordis').Plugin} */
export const name = 'dsh-radar-paper-evidence';

/**
 * 占位：**刻意抛错**。候选骨架不可直接挂载。
 *
 * 空 `apply()` 是最危险的形态：能挂上、能启动、看上去一切正常，而 TODO-0 那类
 * 「上游路由里没有 bbox」的问题**不会报错**——它只会让锚点层永远空着，
 * 用户以为「这篇论文没有可锚定的段落」。宁可响，不许静默。
 */
export function apply() {
  throw new Error(
    'dsh-radar-paper-evidence 是候选骨架（未评审、未接入 profile、不可直接使用）。' +
      '见本包 README 的 TODO-0 / TODO-1：先确认上游 /paper-reader/ 是否提供每页位图与块级 bbox。',
  );
}
