/**
 * dsh-radar-cc98-ubb-ast —— **候选骨架，未评审、未接入 profile、不可直接使用。**
 *
 * 目标（见 README）：把 `dsh-zhiyun-source-cc98` 正文读侧从
 * 「UBB → 纯文本字符串」升级为「UBB → **带标签语义的 AST**」，
 * 使 `[size] [color] [user] [img=1] [mp3] [audio] [video] [quote] ...`
 * 这些 CC98 方言标签不再在第一步就被压成内容本身。
 *
 * # 这里为什么一行实现都没有
 *
 * 骨架的用途是**给评审一个可讨论的形状**，不是先做一半。本文件只做三件事：
 *
 *   1. `apply()` 直接抛错 —— 任何人把它挂进 profile 都会立刻失败，**不会静默降级**；
 *   2. 把「评审要先拍板」的四件事写成 TODO-0 ~ TODO-3，每条都带**为什么不能默认决定**；
 *   3. 声明注入面（`inject`）：只取 `slots`，不取任何数据源，也不碰网络。
 *
 * 真正的实现应当是**纯函数**（`ubbToAst(text)`），据此表把标签映射到语义节点；
 * 标签表取自 `CoolSpring8/griseous` 的 `src/utils/Ubb.ts`（MIT，213 行），
 * 移植时必须保留版权声明与来源提交，见 README「上游」与 `ATTRIBUTION.md`。
 */

/** 只声明注入面：不取任何数据源、不碰网络。 */
export const inject = ["slots"];

/**
 * 评审时必须先回答的问题。做成常量而非注释，是为了让 `apply()` 抛出的错误
 * 能直接指向「还没决定的那件事」，而不是一句笼统的 "not implemented"。
 */
export const OPEN_QUESTIONS = Object.freeze([
  "TODO-0 中间表示：AST 节点形状自定，还是复用 `dsh-radar-bbob` 的 @bbob/core 节点？" +
    "（两个骨架重叠会变成第二套解析器 —— 判据②的关键）",
  "TODO-1 调用契约：`source-cc98/src/reads.js` 的 4 处出口目前返回 `{text}`，换 AST 是否**破坏**下游快照？",
  "TODO-2 安全面：上游 `url` 标签处自带 `// TODO: XSS?` 注释，本仓渲染前必须做 href 白名单（`http/https`），" +
    "`[img=1]` 隐藏图的点击展开是否需要额外确认",
  "TODO-3 标签覆盖：上游 25+ 标签里，本仓真实帖子正文实际出现几个？未覆盖的标签回退纯文本还是丢弃？",
]);

/**
 * 候选的标签表形状（**仅为评审示意，不含实现，也不含上游源码**）。
 *
 * 键 = CC98 UBB 标签名，值 = 语义节点类型。评审时用它对照 `reads.js` 的真实正文，
 * 统计「实际出现率」，再决定哪些标签值得进第一版。
 */
export const PROPOSED_TAG_MAP = Object.freeze({
  // 行内强调
  b: "strong",
  i: "em",
  u: "underline",
  del: "strike",
  // 样式
  size: "fontSize", // 上游：夹到 7，换算 n/3 + 0.5 rem
  color: "textColor",
  cursor: "cursor",
  english: "fontFamily",
  // 结构
  quote: "blockquote",
  code: "code",
  noubb: "verbatimCode", // 不解析内部标签
  // 链接与实体
  url: "link",
  user: "userMention", // 上游：/user/name/<encoded>
  img: "image", // [img=1] → 隐藏图
  // 媒体
  audio: "audio",
  mp3: "audio",
  video: "video",
  // 表情
  em: "sticker", // 上游走 stickers 表
});

/**
 * 骨架不提供任何实现。挂载即失败，避免被误接进真实环境。
 */
export function apply() {
  throw new Error(
    "dsh-radar-cc98-ubb-ast 是候选骨架（未评审），不可挂载。评审先回答：" +
      OPEN_QUESTIONS.join(" | ")
  );
}

export default { inject, apply };
