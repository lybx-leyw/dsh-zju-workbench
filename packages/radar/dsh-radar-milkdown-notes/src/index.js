// 候选骨架：未评审、未接入 profile、不可直接使用。
//
// 本文件只声明「接哪、换什么、凭什么不坏」三件事，不实现。
// 真正的判定核心在 ./upstream.js —— 那里是 markdown ⇄ 文档的双斜杠缝合层。
//
// 挂载点：packages/dsh-zhiyun-page-notes/src/client.jsx:1423 的编辑态 `<textarea>`。
// 阅读态（同文件 :1415 `<MarkdownText text={draft} />`）**不动**：它是宿主渲染器，
// 换成 WYSIWYG 反而会与聊天/论文页的 Markdown 表现分叉。

/**
 * 面板契约（由 page-notes 提供，此处只作形状声明）。
 *
 * @typedef {object} NotesEditorPort
 * @property {() => string}            getText   取当前草稿（Markdown 字符串）
 * @property {(md: string) => void}    setText   写回草稿；**必须走原有的 edit()**，
 *                                               以复用 800ms 防抖自动保存、脏标记与失败回滚
 */

/**
 * 接线须知（评审时必须逐条核对，任一不成立则本骨架作废）：
 *
 * 1. **仍是同一个面板**：只替换编辑态那一个 `<textarea>`，不新增标签页/导航/侧栏。
 * 2. **只保留一个按钮**：「编辑 / 阅读」两态切换保留原义 —— 编辑态 = WYSIWYG，
 *    阅读态 = 宿主 `MarkdownText`。不要引入第三态「源码视图」。
 * 3. **保存链不变**：所有写盘仍由 `edit()` → 防抖 → `save` 完成；
 *    本包**不得**自行 `fetch`/写文件，也不得持有第二份正文（见 client.jsx 顶部
 *    「⚠️ 每个打开过的文件都要有人回收」那段注释 —— 草稿是内存里的第二份正文）。
 * 4. **焦点语义不变**：client.jsx 的 PageUp/PageDown 接管依赖
 *    `target.closest('input, textarea, ...')` 命中即放行（:1000 / :1128）。
 *    ProseMirror 的编辑区是 `contenteditable`，**同样命中该选择器**，
 *    所以翻页键会自动继续让给编辑器 —— 这一条已被现有实现覆盖，无需改 page-notes。
 *
 * @param {NotesEditorPort} port
 * @returns {{ mount(host: HTMLElement): Promise<void>, unmount(): Promise<void> }}
 */
export function createNotesEditor(port) {
  void port;
  throw new Error('候选骨架：未实现。先解决 README「三个保真度缺口」，再接 IPC。');
}

export const name = 'dsh-radar-milkdown-notes';
export const VERSION = '0.0.0';

// TODO(阶段 2)：真正的接入点。
//   - 在 page-notes 里把 <textarea> 换成本包 <NotesEditor markdown={draft} onChange={edit} />；
//   - 两端都走 ./upstream.js 的 toDoc()/fromDoc()，不直接调 getMarkdown()；
//   - 卸载时 editor.destroy()（Milkdown 不 destroy 会留下 MutationObserver 与计时器）。
