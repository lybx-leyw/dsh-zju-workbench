/**
 * dsh-radar-cc98-ubb-bridge —— **候选骨架，未评审、未接入 profile、不可直接使用。**
 *
 * 目标（见 README）：把 `obsidian-cc98-publish` 的 `markdownToUbb`（Markdown → CC98 UBB 方言）
 * 以**能力提取**的方式移植进本仓，接到「笔记」页（`dsh-zhiyun-page-notes`）**已有的正文区**，
 * 补上「CC98 读得回来、写不出去」这条单向边。
 *
 * # 这里为什么一行实现都没有
 *
 * 骨架的用途是**给评审一个可讨论的形状**，不是先做一半。所以本文件只做三件事：
 *
 *   1. `apply()` 直接抛错 —— 任何人把它挂进 profile 都会立刻失败，**不会静默降级**；
 *   2. 把「评审要先拍板」的七件事写成 TODO-0 ~ TODO-6，每条都带**为什么不能默认决定**；
 *   3. 声明注入面（`inject`）：只取 `slots`，不取任何数据源，也不碰网络。
 *
 * 真正的实现应当是**纯函数**（`markdownToUbb(text, options)`），移植自上游
 * `src/md-to-ubb.ts` + `src/links.ts` + `src/convert.ts` 里的纯逻辑部分。
 * 上游 `LICENSE` 为 MIT；移植时必须保留版权声明与来源提交，见 README「上游」与
 * 仓库根 `ATTRIBUTION.md`。
 */

export const name = 'radar-cc98-ubb-bridge';

/** 只拿插槽：本包不需要学分、不需要登录、不需要任何数据源。 */
export const inject = ['slots'];

/**
 * 候选骨架的 `apply` —— **故意抛错**。
 *
 * @param _ctx - 宿主上下文（骨架阶段不使用）。
 * @throws 永远抛出，提示这是未实现的候选骨架。
 */
export function apply(_ctx) {
  throw new Error(
    'dsh-radar-cc98-ubb-bridge 是候选骨架：未评审、未接入 profile、不可直接使用。' +
      '评审通过后再实现 src/index.js（见 README 的 TODO-0 ~ TODO-6）。',
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * TODO-0（阻塞）· 钉住上游提交
 *
 * 上游**未发布 npm**（`package.json` 里没有 `name` 之外的发布痕迹，仓库也未走 npm 流程），
 * 所以没法像 A 类骨架那样在 `dependencies` 里写死版本。
 * 移植前必须 `git ls-remote https://github.com/stevenstg/obsidian-cc98-publish HEAD`
 * 拿到 SHA，写进 README 与 ATTRIBUTION，并在骨架里留一个常量存它。
 * **没有 SHA 的移植不可追溯** —— 日后分不清「搬的是哪一版」。
 *
 * TODO-1（阻塞）· 入口只有一个按钮
 * 落点定在 `packages/dsh-zhiyun-page-notes/src/client.jsx` 的状态栏/工具栏一带，
 * 动作 = 「复制为 CC98 UBB」（写剪贴板）。**不要**新注册插槽、**不要**新建页面：
 * 加插槽就变成「笔记页之外的第二个出口」，与本仓「一个概念一个入口」冲突。
 *
 * TODO-2 · 标题映射是 CC98 方言，不是 GitHub 惯例
 * 上游：`#`→`[size=7]`、`##`→6、`###`→5、`####`→4、`#####`→3、`######`→2。
 * CC98 的 7 是**最大**、2 是**最小**；GitHub 的 h1 是最大、h6 最小 —— 数值方向相反。
 * 逐条照搬，别「按常识改成 1..6」。
 *
 * TODO-3 · 表格未处理，须产品拍板
 * 实测（r59 · M4）：`| a | b |` 原样进 UBB。CC98 支持不支持表格，决定三种处置之一：
 * 保留源码 / 转成等宽对齐文本 / 直接拒绝并提示。**不能默认静默保留**。
 *
 * TODO-4 · 图片：只转换，不上传
 * 上游 `images.ts` 依赖 `obsidian` 的 `App` / `TFile`，**不可移植**；可移植的只有
 * `convert.ts` 里的纯函数（`collectLocalImageRefs` / `formatImageTag` / `applyImageUrlMap`）。
 * 而「上传到 `file.cc98.org`」是**写操作** —— 本仓 CC98 是只读源（`dsh-zhiyun-source-cc98`
 * 自述「只读」），是否允许上传**须产品拍板**。建议先做纯转换版。
 *
 * TODO-5 · 硬换行先实测再定
 * 实测 `"第一行\n第二行"` 往返后仍是两行；但 CC98 端是否按 `\n` 断行未验证。
 * 若不断行，用户看到的是两句话糊成一段 —— 需在站点上实贴一次再决定是否转 `[br]`。
 *
 * TODO-6 · 读/写必须互为逆运算（守卫测试）
 * 实测 `用 \`[b]x[/b]\` 表示粗体` → UBB `"[b]x[/b]"` → 用本仓 `ubbToText` 回读成 `用 "x" 表示粗体`
 * （方括号被当标签剥掉）。接入前须补「往返不改变可见文本」的测试；
 * 修法之一是内联代码改写成 CC98 的 `[code]…[/code]`，但**必须先确认站点渲染**。
 * ──────────────────────────────────────────────────────────────────────────── */
