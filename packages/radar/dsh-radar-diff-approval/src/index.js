/**
 * dsh-radar-diff-approval —— 候选骨架，**未评审、未接入 profile、不可直接使用**。
 *
 * 本文件是**占位**，只标注适配点与 TODO，不写业务逻辑。
 * 待人工评审通过后，再把 TODO 逐条落实；评审驳回则整个包删除。
 *
 * ── 这个包想做什么 ───────────────────────────────────────────────
 *
 * 锁版挂载 `dsh-diff-approval@0.36.1`（9087，MIT，★15，2026-08-16 建仓、2026-10-28 仍在推），
 * 它是**原生 DSH 插件**：`dsh.bundle.patch: ./cordis.patch.yml` + `dsh.client.platform: web`，
 * npm 上可解析（`dist-tags.latest = 0.36.1`）。能力：把 Agent 的每一次文件编辑变成
 * **待审变更**——整文件 diff 展示、按文件/按块 Keep 与 Revert、撤销/重做。
 *
 * ── 与现有功能的关系 ──────────────────────────────────────────
 *
 * **强化式集成（重复且可强化）**。本仓 `dsh-zhiyun-paper` / `dsh-zhiyun-page-paper`
 * 的「外围承载 + 接管控件」模式里，论文正文与页面草稿的写入是**整稿替换**：
 * 用户看到的只是「内容变了」，看不到「哪一句被改了」，也无法只保留其中一段。
 * 审批面板本来就是同一个面板（论文编辑区 / 页面预览区旁边的确认动作），
 * 只是底层换成了逐块 diff 引擎 —— 三条判据在 README 里逐条核对。
 *
 * 若评审认为「论文/页面写入路径并不经过本插件」，则本包降级为**全新功能**
 * （Agent 全局编辑审批），而非强化。这个判断必须由评审给出，本骨架不预设结论。
 */

/**
 * 占位：尚未实现。评审通过前调用一律抛错，避免被误当成可用插件。
 */
export function apply() {
  throw new Error(
    'dsh-radar-diff-approval: 候选骨架未实现（未评审、不可直接使用）',
  )
}

/**
 * TODO（评审通过后逐条落实）
 *
 * [ ] 1. 双重挂载：上游本身是 bundle layer，本包再包一层 = 同一个插件挂两次。
 *        正式接入时二选一（只挂上游 + 外围层 / 只挂本包）。见 cordis.patch.yml 注释。
 * [ ] 2. 体积：npm tarball 解包后约 **20 MB**（`unpackedSize = 20056964`），
 *        主要来自 `shiki` 与 `@shikijs/langs`（全语言语法高亮）。本仓若要瘦身，
 *        需确认能否只保留常用语言子集 —— **但不得改上游源码**，只能靠 `shiki` 的
 *        动态语言加载在外围层做裁剪；做不到就接受体积。
 * [ ] 3. 依赖面：上游 `dependencies` 有 6 个运行时依赖（`diff@^9`、`shiki@^4.4.3`、
 *        `marked@^18`、`dompurify@^3.4.15`、`@shikijs/langs@^4.4.3`、
 *        `@deepseek-ai/dsh-home-paths@^0.1.0-rc.5`），peer 为 `@deepseek-ai/cordis >=4.0.1`
 *        与 `react ^18.2.0`。与 `runtime.lock.json` 的 dsh 版本需核对是否相容。
 * [ ] 4. 接缝：上游在 `dsh.client.inject` 里声明了
 *        `dsh-client-runtime` / `dsh-client-connection` / `dsh-client-locale` /
 *        `dsh-client-ui-settings` / `dsh-client-ui-sidebar`。
 *        强化层只能接在**写盘前的待审变更队列**这一段，先确认它是否暴露稳定接口
 *        （是否只走 RPC、是否有可订阅的 pending 事件）。
 *        找不到干净注入点 → **放弃强化，只做全局编辑审批接入**（不要 fork 上游改源码）。
 * [ ] 5. 落盘与回滚：`@deepseek-ai/dsh-home-paths` 意味着它会往 `$DSH_HOME` 写待审快照。
 *        本仓有「CLI + App 并行」「多档案」用法，需确认快照目录是否按档案隔离、
 *        以及撤销/重做在进程重启后是否仍然可用。
 * [ ] 6. 与学生场景的实际契合度：论文正文（LaTeX/Markdown）逐块审批是**高价值**，
 *        页面草稿（HTML）的块级粒度是否为「同一段」需实测。
 * [ ] 7. 界面文案：确认是否只有英文（`dsh-client-locale` 已注入，可能已带 zh）。
 */
export function todo() {
  return 'see src/index.js TODO'
}
