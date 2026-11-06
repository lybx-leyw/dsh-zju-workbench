/**
 * 骨架入口 —— **占位 + TODO**，不含业务逻辑。
 *
 * ⚠ 候选骨架：未评审、未接入 profile、不可直接使用。
 *
 * `apply()` **故意抛错**：本包不是插件。若有人把它接进 profile，
 * 在挂载那一刻就应该失败并看到这行提示，而不是「装上了但什么都没发生」。
 * （先例：`packages/dsh-radar-knowledge-fold` 同一策略。）
 *
 * ## 本轮的接缝在哪儿
 *
 * 「讲义」页走到终审时，模型返回的是一段**自定义标记文本**（`#!section` / `##!topic` /
 * `>>> BLOCK`），由 `dsh-zhiyun-lecture/src/agent-text.js::parseAgentLectureText` 解析。
 * 「出题」页走到生成时，模型返回的是 JSON，由 `dsh-zhiyun-quiz/src/generate.js` 解析。
 * 两条链路的第一件事都是**脱围栏**，而它们读的是**两份不同实现**（见 `src/fence.js` 表）。
 *
 * 本轮实测的两条差异（`node -e` 直跑真实实现，见 README「实证」节）：
 * - 讲义版对 ` ```…```\n谢谢` 返回**原串**（围栏没剥）→ 下游 `parseAgentLectureText`
 *   会把 ```json 那一行当成正文，静默产出空知识点或抛「终审结果缺少可读取的知识点」，
 *   **错误信息指向错的地方**（看起来像模型没给知识点，其实只是多了一句道谢）。
 * - 出题版对同一输入返回正确的 JSON → 同一种模型行为，两个页面一个坏一个好。
 *
 * ## TODO（评审裁决前不写业务逻辑）
 *
 * TODO 0 —— **评审第一问：这个包该不该存在**
 *   最省的改法**不是**新包，而是把 `polish.js:538` 的整串锚定正则改成
 *   `quiz` 那种「从首行起、找尾部闭合行」。若裁决是这个，**本包废弃**。
 *   只有裁决为「四处口径应当统一成一份、且要能单独测」时，本包才有意义。
 *
 * TODO 1 —— **口径来源：抄语义，不 import 内部文件**
 *   四处实现分属 `dsh-zhiyun-lecture` / `dsh-zhiyun-quiz` / `dsh-zhiyun-parser` 三个包，
 *   没有共享的 shared 包。跨包深路径 import（`../../dsh-zhiyun-quiz/src/generate.js`）
 *   会锁死对方的内部布局，**不得**这样做。合法路径只有两条：
 *     a) 抽到 shared 包并改三处 import（改 3 个包 + 1 个新包）；
 *     b) 本包自持实现，调用方显式依赖本包（改 3 处 import，不加 shared 层）。
 *
 * TODO 2 —— **闭合围栏的判据要跟模型实际行为对齐**
 *   本骨架取「最后一条非空行必须是整行 ```」，理由是**代码块内容里出现整行 ``` 是合法的**
 *   （嵌套代码 / 含模板串的 JS）。但这条判据**未在真实模型输出上统计过**：
 *   如果实测发现「模型把说明写在围栏内」（而不是围栏外），判据就要反过来。
 *   → 评审前需要 20+ 条真实响应样本，本轮**没有**采集（见 README「未做的事」）。
 *
 * TODO 3 —— **错误信息要分开**
 *   `quiz` 现在把「没有围栏」「围栏内不是 JSON」「JSON 缺字段」都报成 `QuizParseError`。
 *   `hasFence()` 拆出来就是为了让调用方能分别说：「模型返回了 ```json 包裹的非 JSON」。
 *   这条是否值得改，取决于真实错误分布 —— 同样缺样本。
 */

export { stripFences, hasFence } from './fence.js';

/**
 * 挂载即失败 —— 本包是能力提取稿，不是插件。
 *
 * @throws {Error} 总是抛出，提示「这是候选骨架」。
 */
export function apply() {
  throw new Error(
    'dsh-radar-fence-normalize 是 radar 候选骨架（未评审、未接入 profile），'
    + '不应被挂载。评审结论见 docs/ecosystem-radar/2026-10-21-r46.md §四。',
  );
}

export default { apply };
