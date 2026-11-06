/**
 * dsh-radar-credit-audit —— **候选骨架，未评审、未接入 profile、不可直接使用。**
 *
 * 目标（见 README）：把「已获学分」从一个**总数**，变成**按培养方案模块拆开、逐条可溯源**的
 * 达成度报告。落点是**已有的**学分/GPA 看板（`dsh-zhiyun-source-zdbk/src/reads.js` 的
 * `gpaOf()` 与 `earned_credits`），不新建页面。
 *
 * # 这里为什么一行实现都没有
 *
 * 骨架的用途是**给评审一个可讨论的形状**，不是先做一半。所以本文件只做三件事：
 *
 *   1. `apply()` 直接抛错 —— 任何人把它挂进 profile 都会立刻失败，**不会静默降级**；
 *   2. 把「评审要先拍板」的六件事写成 TODO-0 ~ TODO-5，每条都带**为什么不能默认决定**；
 *   3. 声明注入面（`inject`）：不取 slots、不取数据源、不直接碰网络。
 *
 * # 它和「再来一套成绩页」的区别
 *
 * 本包**不提供任何 UI**。它面向的是宿主已有的学分看板：调用方把 `record`（已修 + 在修 + 计划）
 * 和一个 `plan`（培养方案，来自 `pyfagl` 或本地 golden）交给本包的 `audit()`，
 * 拿到一份 `AuditReport`，再渲染进**原来那个面板**。三条强化判据在 README §「三条判据」逐条给出。
 *
 * # 为什么是「锁版 vendor」而不是普通 npm 依赖
 *
 * 上游不是 DSH 插件，也没有 npm 包（2026-10-25 实查 `registry.npmjs.org/zju-kezhou` → Not found）。
 * 它的可复用资产是 `engine/`（纯 stdlib Python）与 `schema/*.schema.json`（JSON Schema 契约）。
 * 所以 TODO-0 要求先把 `engine/` **原样**发布到内部 scope（`dsh-radar-credit-audit-vendor@1.7.0`），
 * 本包只依赖那个**精确版本**，**绝不**复制引擎源码进本仓。
 */

export const name = 'dsh-radar-credit-audit';

/**
 * 本骨架不注入任何东西。
 *
 * 真实实现是一个**纯函数式服务**：`audit(record, plan) -> report`，由宿主在渲染学分看板前调用。
 * 它不需要 `slots`、不需要 `tools`、不需要 `timer` —— 这也是它比 A 类插件更容易评审的原因：
 * **注入面为零**，不存在「挂上后全局 prompt 被污染」的风险。
 */
export const inject = [];

export function apply() {
  throw new Error(
    'dsh-radar-credit-audit 是候选骨架（未评审、未接入 profile）：apply() 故意抛错，请勿挂载。'
    + ' 评审通过后请按 README 的 TODO-0 ~ TODO-5 逐条落地并删除本抛错；'
    + ' 其中 TODO-0（vendor 包不存在）与 TODO-1（学期口径换算）为阻塞项。',
  );
}

/* ─────────────────────────── 评审待拍板清单 ─────────────────────────── */

/**
 * TODO-0（**阻塞**）· 上游怎么进来
 *
 * 事实（2026-10-25 实查）：
 *   - `Kepler16f/zju-kezhou` 是 **Flutter App + Python 引擎**，没有 `package.json`、
 *     没有 `cordis.patch.yml` → **不是 A 类原生 DSH 插件**，也不在 npm 上。
 *   - 可复用资产只有两块：`engine/`（`audit.py` 54 KB + `common.py` 3 KB，纯 stdlib）
 *     与 `schema/{plan,record,report}.schema.json`（JSON Schema 2020-12）。
 *   - 上游**双实现**（`audit.py` 与 `engine/audit.dart`）并用 `eval/cross_engine_parity.py`
 *     在 CI 里逐字段比对 —— 这是它最值得借的工程方法（见 README「可白拿的三条」）。
 *
 * 三个可选路线，**评审必须先选一条**，否则本包写不了：
 *
 *   (a) **vendor（推荐）**：把 `engine/` 原样发到内部 scope 的 `dsh-radar-credit-audit-vendor@1.7.0`，
 *       `package.json` 里写死该版本；引擎作为 **subprocess / worker** 运行，本包只做 I/O 适配。
 *       代价：多一个进程；收益：将来上游升级只需改版本号，**本仓零代码复制**。
 *   (b) **移植**：把 `audit.py` 的逻辑用 JS 重写。❌ 与「不搬运上游源码」相邻，且 54 KB 规则
 *       （选课组折算、外语 L1/L2/L3 封顶、并列选项组、在修证据降级……）重写必走样 → **不建议**。
 *   (c) **只借 schema**：只用三个 `.schema.json` 定义契约，规则引擎本仓自写。规则少的模块可用，
 *       但「选课组 / 外语封顶」这类口径会各写一套 → **这正是 README §「风险 R-2」要避免的**。
 *
 * ⚠ 无论选哪条，**上游 DSH 依赖不适用**：本包是 B 类（能力提取 + 封装），
 * `dependencies` 里那个 `dsh-radar-credit-audit-vendor` 是**(a) 路线的占位**，发版前它不存在，
 * `npm i` 会 404 —— 这是刻意的：**未评审判不清的依赖，就不该能装上**。
 */

/**
 * TODO-1（**阻塞**）· 学期口径换算：两套制式必须先对齐
 *
 * 本轮实测（见报告 §3）：
 *   - 本仓 `dsh-zhiyun-source-zdbk/src/parse.js:101` 的 `semesterOfCourseKey` 用
 *     `/^\((\d{4}-\d{4})-(\d)\)/`，**只认 `-1` / `-2`**；`-3` / `-4` 会原样变成 `semester: 3/4`，
 *     与「第 3/4 学期」在下游（`reads.js:159` 的 `key = ${academic_year}-${semester}`、GPA 学期走势）**无法区分**。
 *   - 同文件 `parse.js:15` 自述「浙大按秋/冬/春/夏分」，`TERMS = ['秋','冬','春','夏']` —— 注释与实现不一致。
 *   - 引擎 `engine/common.py` 用 `'YYYY-A'`（秋）/ `'YYYY-B'`（春）**两段制**，`idx = YYYY*2 + (0|1)`。
 *     四段制在映射中**丢失**，且 `2024-B` 不可逆地分不清是「冬」还是「夏」。
 *
 * 所以适配层必须先定义一份**单一真源的学期序号**（建议：`(学年, 段)` → 单调整数，四段制保留 4 个值），
 * 再分别给出到本仓 `semester:1..4` 与引擎 `'YYYY-A/B'` 的双向映射，**两个方向都要有测试**。
 * ⚠ 不能「按 -1 → A、-2 → B」直接映射：浙大的「春夏」跨了 `-2/-3/-4` 三段，一映射就会把
 *   春季课与夏季课压进同一个桶（详见报告 §3.2 的对照表）。
 */

/**
 * TODO-2 · 落点：接到**已有的**学分看板，而不是新开页
 *
 * `reads.js` 的 `gpaOf()` 已经算了 `earned_credits`（单个数）与 `gpa_credits`（GPA 口径学分）。
 * 本包的 `audit()` 输出的是**同一口径下的按模块拆分**，渲染进原面板的同一个数字旁边
 * （建议形态：`已获 87.5 / 160 学分`，点开逐模块展开），**不新增路由、不新增侧栏**。
 *
 * 待确认：`page-today` 的 `readDue()`（`page-today/src/index.js:27`）是否需要显示「距离毕业还差多少学分」。
 * 若需要，应复用同一份 report，而不是在「今天」页再算一遍。
 */

/**
 * TODO-3 · 输入契约：`record` 从哪来
 *
 * 引擎要求的 `record.courses[]` 字段是 `{name, credits, semester('YYYY-A/B'), grade, passed}`，
 * 而本仓 `parseGrade()` 产出的是 `{course_code, name, credit, score(原文), grade_point, …}`。差异：
 *
 *   | 引擎要 | 本仓有 | 适配要点 |
 *   | --- | --- | --- |
 *   | `credits`（number） | `credit`（number） | 改名 |
 *   | `grade`（0–100 number） | `score`（**原文**，可能是「合格」「优秀」「A」） | 必须用 `hundredOf()` 折等级分，**不能 `Number()`** |
 *   | `passed`（bool） | `counted_in_credits`（bool） | **不等价**：`合格/不合格` 计学分但 `passed` 应为 true；弃修/待录/缓考/无效 计 false。需单独映射并写用例 |
 *   | `semester`（`YYYY-A/B`） | `semester`（1..4） | TODO-1 |
 *
 * 「计划选课」则来自课表/选课模块，且要带 `time_slots` 才能跑时间冲突检测 —— 本仓目前**没有**
 * 「计划」这一层数据结构（`page-planning` 是待办，不是选课计划），这是 TODO-4 的前置。
 */

/**
 * TODO-4 · 培养方案数据源：三条路，各有代价
 *
 * 上游的做法（`docs/培养方案接入说明.md`，真机实测）值得直接照抄**接口事实**（这是公开的 HTTP 行为，
 * 不是代码）：
 *   - 方案列表：`POST /jwglxt/pyfagl/pyfaxxcx_cxPyfaxscxIndex.html`，body **只能**含
 *     `queryModel.showCount=5000&queryModel.currentPage=1&_search=false`（多带 `zymc`/`njdm_id` 会返回 HTML 错误页）；
 *   - 主键是 `pyfaxx_id` / `jxjhh`（**不是** `pyfa_id`）；
 *   - 年级来自行政班末四位的前两位（取后两位会差 100 年）；
 *   - 学生账号访问「课程明细/打印页」多回 **HTTP 910**（教师菜单）→ 只能 best-effort。
 *
 * 但**本仓不一定要走网络**：评审需在三条里选一条，并写进本包 README：
 *   (i) 直接接 `pyfagl`（实时、但与上游踩同样的坑，需自己实现匹配 + 歧义处理）；
 *   (ii) 本地 golden JSON（离线、可测试、但每届要更新）；
 *   (iii) 用户上传官方 PDF 由本仓解析（工作量最大，但**不依赖未公开接口**）。
 *
 * ⚠ 不论哪条：**匹配有歧义时必须列候选让用户点选**（上游 `PlanMatchResult.ambiguous` 的做法），
 * 不允许「挑第一个」—— 选错方案会让整张达成度报告全错，且用户很难发现。
 */

/**
 * TODO-5 · 输出与免责声明
 *
 * 引擎的 `report.schema.json` 里 `disclaimer` 是 **required** 字段。本仓渲染时必须把它显示出来
 * （不能只放在 tooltip 里），因为这份报告会被用来做「要不要退课 / 要不要选这门」的决定。
 * 同时 `trace` 字段要能回溯到**方案页码** —— 没有页码的结论不要渲染。
 */

/* ─────────────────────────── 不具备的能力（防止误读） ─────────────────────────── */

/**
 * 本骨架**不做**：
 *   - 不提供选课建议 / 不自动选课（上游 `eval/check_readonly.py` 在 CI 里机械拦截写接口，
 *     本包连写接口的代码都没有）；
 *   - 不重复计算 GPA（GPA 仍由 `reads.js` 的 `gpaOf()` 负责，本包只消费 `earned_credits`）；
 *   - 不做「培养方案 PDF OCR」（那是 TODO-4 (iii) 的独立工作）；
 *   - 不引入任何 LLM 调用：上游的分工原则是「LLM 读和说，代码算对错」，本包只负责「算对错」那一半。
 */
