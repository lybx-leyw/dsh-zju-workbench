/**
 * dsh-radar-refs-import —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑；**不 import 上游本身**，
 * 只从 `./upstream.js` 取锁版凭据（那一个文件负责「上游长什么样」）。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 锁版引入 `@citation-js/*@0.9.0`（citation-js/citation-js，MIT，★213），
 * 给「论文」页的**文献库**补一个**「粘贴参考文献一次导入多条」**的入口：
 * 用户从 Zotero / EndNote / 知网 / Google Scholar 复制一段 BibTeX 或 RIS，
 * 解析成 N 条候选，逐条（或批量）走**已有的**上传路径进库。
 *
 * ── 为什么是「强化式集成」而不是简单集成（三条同时成立）──────────
 *
 *   1. **仍是同一个面板** —— 不新增导航项、不新增页面。落点是
 *      `dsh-zhiyun-page-paper` 的**既有**文献库面板
 *      （`LibraryPanel.jsx`，已有「新建专题 / 选择文件上传」两个动作），
 *      在同一个抽屉里加第三种入口「粘贴引用」。面板、数据、路由全都不变。
 *   2. **仍是相似正交的功能** —— 现有面板回答「**我有哪些 PDF、点开哪一篇**」；
 *      新增回答「**我手上一串文献条目，怎么变成库里的 PDF**」。
 *      前者是**库内导航**，后者是**库的填充**，同一域（文献库）、不同问题，不重叠。
 *      —— 注意：这不是「再做一个文献管理器」。Zotero 式的分类 / 标签 / 引文样式
 *      一概不做（那才是「新功能页」，也是 2026-10-18 判 🟡 的理由）。
 *   3. **底层多调了更优质实现** —— 本仓**完全没有** BibTeX / RIS 解析能力
 *      （见下方「已核实的缺口」）。手写这两个解析器不是「多写几行」：
 *      BibTeX 有递归花括号、`@string` 宏、`#` 拼接、`crossref` 继承、
 *      LaTeX 重音符（`{\"{o}}`）等一整套语法；RIS 有 `TY/ER` 成对边界与
 *      `AU` / `A1` / `A2` 的多义性。上游已经把它们折算成同一个 CSL-JSON，
 *      并且**中文条目实测可解析**。
 *
 * ── 已核实的缺口（本轮读码，不是猜）────────────────────────────
 *
 *   ```bash
 *   grep -rniE "\bbib\b|\.bib|ris|doi" packages/dsh-zhiyun-page-paper/src \
 *                                      packages/dsh-zhiyun-host-paper/src
 *   # → 唯一命中：AssistantDrawer.jsx:292 的一行注释（"论文 DOI、arXiv"），不是能力
 *   ```
 *
 *   再看导入路径本身：`LibraryPanel.jsx` 的导入只有
 *   `uploadPaper({ topic, name, bytes })` 一条（`<input type="file">` 选 PDF）。
 *   **没有一个「从条目起手」的入口** —— 用户想收一篇论文，必须自己去别处
 *   下载 PDF，再回到这里上传。这一段是断的。
 *
 *   与 r53（iCalendar）、r54（专注计时）同一形状：**「有下游、没上游」**。
 *
 * ── 边界（写在这里，免得实现时越界）────────────────────────────
 *
 *   - **不做文献管理器**。不做标签、不做引文样式、不做 `.bib` 的写回与同步。
 *     只做「文本 → 条目列表 → 走既有上传」这一条单向通道。
 *   - **不联网**。刻意不引 `@citation-js/plugin-doi`（它会静态带进
 *     `sync-fetch-undici` 并自行请求 Crossref）。DOI / arXiv 的取全文留给上游阅读器
 *     自己的检索链路，本包不开第二个网络出口。
 *   - **不自动新建专题**。专题是用户的组织意志，本包只往**用户已选**的专题里放。
 *   - **不静默截断**。超过 `MAX_IMPORT_ENTRIES`（50）时明示总数。
 *   - **不吞解析错的条目**。一条坏条目不等于整段坏：**先整体解析**，整体失败才报错；
 *     整体成功后就按条数展示，不逐条重试、不猜测修补。
 *   - **不改上游源码**（本包只锁版调用）；**不碰上游数据模型**（不造「元数据条目」，
 *     库里仍然只有 `{ topic, name }`，见 `upstream.js` TODO-C）。
 *
 * ── 四条已实测的硬约束 ─────────────────────────────────────────
 *
 *   R1. **三个包必须同版本**。`core@0.9.0` + `plugin-bibtex@0.8.4` → npm `ETARGET`；
 *       混版本装不上（或要 `--legacy-peer-deps`）。见 `upstream.js` 的 `UPSTREAM_VERSION`。
 *   R2. **插件是副作用导入，漏写不报错**。少一行 `import '@citation-js/plugin-ris'`，
 *       代码照样编译，直到用户粘 RIS 才抛 `This format is not supported or recognized`。
 *   R3. **格式靠内容嗅探，不靠扩展名**。所以「粘错格式」与「粘了一段散文」
 *       是同一种失败信号，UI 文案必须写成「没认出这段文本的格式」而不是
 *       「BibTeX 解析失败」。实测中文散文落在这条。
 *   R4. **体积 682 KB（unpacked，含传递依赖）**。这是本包唯一真正的成本，
 *       评审若认为不划算应改判 🔵；在打包验证（`upstream.js` TODO-A-1）出数之前
 *       不得从 🟢 升为已采纳。
 */

// 锁版凭据只从 `./upstream.js` 取 —— 骨架不在别处再写一遍版本号（否则会漂移）。
import {
  MAX_IMPORT_ENTRIES,
  UPSTREAM_LICENSE,
  UPSTREAM_PACKAGES,
  UPSTREAM_REPOSITORY,
  UPSTREAM_SHAPE,
  UPSTREAM_VERSION,
} from './upstream.js';

/** 插件名。与目录名 / `package.json.name` 一致。 */
export const name = 'dsh-radar-refs-import';

/** 让凭据在本模块可见（测试钉住三者与 `package.json` 一致）。 */
export const upstream = Object.freeze({
  core: UPSTREAM_PACKAGES.core,
  version: UPSTREAM_VERSION,
  license: UPSTREAM_LICENSE,
  repository: UPSTREAM_REPOSITORY,
  shape: UPSTREAM_SHAPE,
});

/**
 * 本包从 CSL-JSON 里**只读**这些字段（其余一律丢弃）。
 *
 * 刻意不含：`abstract`（正文，长且常夹带上游版权声明）、`URL`（可能带个人 token）、
 * `note` / `annote`（用户私有批注）、`keyword`（可能是用户的检索历史）。
 * 文献库面板只展示「标题 / 作者 / 年份」，多读一个字段就多一分泄露面。
 */
export const HINT_FIELDS = Object.freeze(['title', 'author', 'issued', 'DOI', 'page', 'container-title']);

/** 导入方式 —— 两档分开做，先做离线的那档。 */
export const IMPORT_MODES = Object.freeze({
  /** 粘贴文本（BibTeX / RIS）。**本骨架只覆盖这一档。** */
  paste: 'paste',
  /** 导入 `.bib` 文件。**不在本骨架范围**：它只是在 ① 外面套一层 `File.text()`。 */
  file: 'file',
});

/**
 * 解析一段粘贴文本，交回「可直接渲染的候选列表」。
 *
 * TODO-1 · 实现时按这个顺序落：
 *   1. **入参归一**：`String(text ?? '').trim()`；空串**不要**交给上游
 *      （上游会抛「不支持」，但空粘贴应该是「没什么可导入的」而不是错误）。
 *   2. **整体解析**：`parseReferences(text)`（见 `upstream.js` TODO-B）。
 *      抛错 → 返回 `{ ok: false, reason: 'unrecognized' }`，**不重试、不修补**。
 *   3. **裁剪**：逐条 `toLibraryHint()`，只保留 `HINT_FIELDS`。
 *   4. **截断但要明示**：`entries.length > MAX_IMPORT_ENTRIES` 时取前 50 条，
 *      并把**原始总数**一并返回（`total`），UI 必须显示「共 N 条，本次只列前 50 条」。
 *      实测：500 条 `.bib` 是本包的真实场景（Zotero 全库导出），不是极端情况。
 *   5. **不做去重**。同一条文献用户可能故意导入两次（不同 PDF 版本）；去重需要
 *      先定义「同一篇」（DOI？标题？），那是独立议题。UI 上靠用户眼看。
 *
 * @param {{ text: string, topic: string }} input
 * @returns {Promise<{ ok: boolean, reason?: 'empty'|'unrecognized', entries?: object[],
 *                     total?: number, truncated?: boolean }>}
 */
export async function previewImport(input) {
  // 占位：评审通过后实现。
  throw new Error('候选骨架：previewImport() 未实现（见 README，未评审）');
}

/**
 * 把用户确认过的候选，逐条交给**已有的**上传路径。
 *
 * TODO-2 · 关键约束：**本函数不发任何 HTTP 请求**。
 *   上传的既有实现是 `dsh-zhiyun-page-paper/src/library.js` 的 `uploadPaper()`，
 *   它已经在页面包里、已有专题下拉、已有错误提示与 `notice` 文案。
 *   本包只负责「按条产出 `{ topic, name }` 意图」，上传由页面包调用既有函数完成。
 *   → 若在这里自己 fetch，就等于把 `library/upload` 的契约复制了第二份，
 *     上游一改（如 `x-dpr-*` 头改名），两处会不一致。**不许**。
 *
 * TODO-3 · PDF 从哪来 —— **本骨架最大的未决点，必须由产品拍板**。
 *   三种可能，`topic/name` 之外的代价完全不同：
 *
 *   | 方案 | 做法 | 代价 |
 *   | --- | --- | --- |
 *   | A. 只填名字，PDF 用户自己放 | 本包只给 `name` 建议，用户把 PDF 拖进对应位置 | 零改动，但「导入」只完成了命名，价值有限 |
 *   | B. 解析出 DOI/arXiv id，交给上游取 | 上游 `typesafe` 检索链路若支持按 id 取 PDF，本包只传 id | **须先核实上游 24 条路由里有没有这条**（本轮未核） |
 *   | C. 本包自己下载 | 并发下载 + 落盘 | ⛔ **否决**：开第二个网络出口、版权风险（多数期刊 PDF 需订阅）、与 R2 边界冲突 |
 *
 *   → 在 A/B 之间拍板之前，本函数只有 `name` 建议值可用，**不得实现自动下载**。
 *
 * @param {{ topic: string, entries: object[] }} input
 * @returns {Promise<{ topic: string, name: string, entry: object }[]>} 逐条上传意图
 */
export function planUploads(input) {
  throw new Error('候选骨架：planUploads() 未实现（见 README，未评审）');
}

export async function apply(ctx, config = {}) {
  // 占位：**不要**在这里注册路由、也不要在这里改任何页面包。
  // 评审通过后的正确落点是：
  //   ① 本包只导出纯函数（`previewImport` / `planUploads`），无副作用、无 IO；
  //   ② `dsh-zhiyun-page-paper` 的 `LibraryPanel.jsx` 加第三种入口「粘贴引用」，
  //      调用 ①，再对每条调用既有的 `uploadPaper()`；
  //   ③ 依赖锁版写在 `dsh-zhiyun-page-paper/package.json`（与 `host-paper` 锁
  //      `@ggboy123/dsh-paper-reader@1.3.1` 同一套做法），**本骨架的 patch 文件评审后删除**。
  // 三条都是改别的包，不属于本骨架；本骨架只负责把上游封装成窄接口。
  throw new Error('候选骨架：apply() 未实现（见 README，未评审）');
}
