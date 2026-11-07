/**
 * dsh-radar-cc98-material-search —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ══════════════════════════════════════════════════════════════════
 *  类型：B · 其他 JS 项目（**不是**原生 DSH 插件包）
 * ══════════════════════════════════════════════════════════════════
 *
 * 上游 `gvvg5272-code/cc98-material-search@v0.1.0`（MIT）是一个 Chrome MV3 扩展，
 * 没有 `dsh.bundle.patch` / `cordis.patch.yml`，也**未发布 npm 包**。因此本包：
 *   • ❌ **不锁版引入任何上游依赖**（无可锁的上游）；
 *   • ❌ **不含 `src/upstream.js`**（A 类专用）；
 *   • ✅ 走「**能力提取 + 本仓自建规则模块**」路线，**不搬运上游源码**。
 *
 * ══════════════════════════════════════════════════════════════════
 *  这个包想做什么（强化式集成）
 * ══════════════════════════════════════════════════════════════════
 *
 * 现状：`dsh-zhiyun-source-cc98` 的 `cc98.search` 直通 `GET /topic/search`，
 * 只要标题命中关键词就返回 —— 上游实测「10 条结果里只有 1 条真有附件」，
 * 且真正的资源楼标题往往不含课程名，关键词搜不到。
 *
 * 强化点（仍是同一个搜索面板，只多一层底层处理）：
 *
 *   1. **分拣** classify(title, content) → '卖书' | '求资料' | '资源' | '讨论'
 *      纯本地正则规则，零 token；先判「卖书」（它的标题里也带"资料"二字，顺序不能反）。
 *   2. **多楼层取附件** —— 资源楼的资料常在 2、3 楼，只看楼主层会漏。
 *      成本设计（必须保留）：一级只取 floor 1 判「有没有附件」；
 *      只有判定有附件的才进二级抓全文与作者资料 ⇒ 20 条通常仅 2~5 条打第二轮。
 *   3. **附件直链抽取** —— CC98 v4 正文是 **Markdown**，附件写成
 *      `[显示名](https://file.cc98.org/v4-upload/.../x.pdf)`；
 *      用 Markdown 链接结构切，别用裸 URL 正则（会把结尾 `)` 吃进去）。
 *      上游实测：`[upload=…]` UBB 占位符在 24 帖 / 105 楼里**一次都没出现**。
 *   4. **本地打分**（可选）—— 按附件数 / 收藏 / 回复 / 作者风评值排序，不依赖 AI。
 *
 * ══════════════════════════════════════════════════════════════════
 *  TODO（采用前必须完成）
 * ══════════════════════════════════════════════════════════════════
 *
 *   [ ] 评审决定落点：(a) 在 `source-cc98` 新增只读方法 `cc98.materialSearch`；
 *       (b) 新建独立 `dsh-zhiyun-source-cc98-material`。**倾向 (a)** ——
 *       同一个入口、同一个面板，避免"重复集成"。
 *   [ ] 只提取纯函数，**不引入任何 `chrome.*` 调用**（上游是扩展，与工作台形态不兼容）。
 *   [ ] 二级抓取：串行 + 退避 + **失败不缓存**（与 `source-cc98` 既有边界一致）。
 *   [ ] AI 总结走宿主既有 LLM 代理，不新增密钥。
 *   [ ] 按 CONTRIBUTING 3.3 写 `ATTRIBUTION.md`，注明上游 `v0.1.0` 与改写范围。
 */

export const name = 'dsh-radar-cc98-material-search';

/** 上游坐标，供评审与 ATTRIBUTION 引用。 */
export const UPSTREAM = Object.freeze({
  repo: 'gvvg5272-code/cc98-material-search',
  version: 'v0.1.0',
  license: 'MIT',
});

/**
 * 占位：帖子分拣。上游对应 `lib/triage.js` 的 `classifyPostType`。
 *
 * @param {{title?: string, content?: string}} _input
 * @returns {'卖书'|'求资料'|'资源'|'讨论'}
 */
export function classifyPostType(_input) {
  throw new Error('skeleton: classifyPostType 未实现（候选骨架，未评审）');
}

/**
 * 占位：从正文抽取附件直链。上游对应 `lib/attachment.js`。
 *
 * @param {string} _content
 * @returns {Array<{name: string, url: string, kind: string}>}
 */
export function extractAttachments(_content) {
  throw new Error('skeleton: extractAttachments 未实现（候选骨架，未评审）');
}
