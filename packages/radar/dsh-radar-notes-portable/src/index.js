// 候选骨架：未评审、未接入 profile、不可直接使用。
//
// 本文件只声明「接哪、换什么、凭什么不坏」三件事，不实现。
// 真正的判定核心在 ./upstream.js —— markdown → 可离线单文件 HTML 的渲染缝合层。
//
// 挂载点：`packages/dsh-zhiyun-core-notes/src/store.js:447` 的 `exportMarkdown()`。
// 该方法**已经**产出「导出用的 markdown + 附件映射」，但调用方只能把它写成 `.md`；
// 本包在它后面再接一段「md → 单文件 HTML」，面板仍是「笔记」，不新增页面。

/** @typedef {import('./upstream.js').PortableDoc} PortableDoc */

/**
 * 面板契约（由 core-notes 提供，此处只作形状声明）。
 *
 * @typedef {object} NotesExportPort
 * @property {(input: {courseId: string, sectionId: string}) => Promise<{markdown: string, files: Record<string,string>}>} exportMarkdown
 *   宿主已有能力，**不改**。本包只在它之后加一步渲染。
 * @property {(file: string) => Promise<Uint8Array>} readAsset
 *   读附件字节；宿主的 `files` 只给「附件 id → 路径」，字节由调用方读。骨架未接。
 */

/**
 * 编排入口：markdown → 单文件 HTML。
 *
 * @param {{markdown: string, files?: Record<string,string>, title?: string, assets?: Map<string, Uint8Array>}} input
 * @returns {Promise<PortableDoc>}
 */
export function renderPortable(input) {
  void input;
  throw new Error('dsh-radar-notes-portable: 候选骨架未实现（未评审、未接入 profile）');
}

/**
 * 计算导出体积，供「导出前提示」用（体积是本包最大的可用性风险，见 README §四）。
 *
 * @param {PortableDoc} doc
 * @returns {{bytes: number, fontsInlined: boolean}}
 */
export function measure(doc) {
  void doc;
  throw new Error('dsh-radar-notes-portable: 候选骨架未实现（未评审、未接入 profile）');
}

/**
 * Cordis 插件入口。**故意不注册任何插槽/路由** —— 骨架阶段接入即等于上线。
 *
 * @param {any} ctx
 */
export function apply(ctx) {
  void ctx;
  throw new Error('dsh-radar-notes-portable: 候选骨架未实现（未评审、未接入 profile）');
}

export const name = 'dsh-radar-notes-portable';
export const inject = [];
