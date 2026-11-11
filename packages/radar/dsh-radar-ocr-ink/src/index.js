/**
 * `dsh-radar-ocr-ink` —— 候选骨架（**未评审 · 未接入 profile · 不可直接使用**）。
 *
 * 这里**不是**可运行的插件：`apply()` 只打一行日志，全部能力都在 TODO 里。
 * 骨架存在的唯一目的，是把「接进来要做哪几件事、每件事的验收口径是什么」
 * 写成可评审的形状，而不是留一段散文。
 *
 * 评审通过后的落地顺序见 README §落地顺序（共 4 步，任何一步不成立都应回退本目录）。
 */

/** 骨架的阶段标记：`skeleton` → 评审通过前不得改动此值。 */
export const STAGE = 'skeleton';

/**
 * 上游**可以借**的契约（只借这三条，不搬实现）。
 *
 * 上游 `jritzi/ocr-extractor` 是 MIT，可以摘码；但本骨架**刻意不搬源码**，
 * 原因是它的实现和 Obsidian 的 vault / callout / 桌面端路径绑死（见 README §不搬源码的理由），
 * 搬过来只会得到一份改不动的死代码。可迁移的是**下面三条决策**：
 */
export const BORROWED_CONTRACTS = Object.freeze([
  {
    id: 'C-1',
    name: '引擎可切换 + 默认本地',
    // 上游在设置里给出「Tesseract（默认，本地）/ 其他云 OCR」的切换，
    // 默认值是本地引擎。「默认本地」是本仓该照做的部分：笔记可能含个人信息。
    why: '默认云 OCR = 用户第一次点就外联。默认本地，把外联变成显式选择。',
  },
  {
    id: 'C-2',
    name: '「优先用 PDF 自带文本层」',
    // 上游有 `Prefer embedded PDF text`：能用文本层就不跑 OCR。
    // 这一条对本仓**尤其**重要 —— 论文页已经把文本层解出来了，再跑一遍 OCR 是双重成本 + 双重误差。
    why: 'OCR 是文本层的兜底，不是替代。先查文本层，空/乱码才 OCR。',
  },
  {
    id: 'C-3',
    name: '结果落成「可折叠、可搜索」的附属块',
    // 上游把识别文本塞进附件下方的 callout，于是它能被 Obsidian 自带搜索命中，
    // 也能被系统级文件搜索命中 —— **不另建索引**。本仓笔记页的全文检索同理：
    // 写进 markdown 正文，索引器自然就能收到，不需要第二条索引链路。
    why: '一份数据一条索引。旁挂 JSON 索引会与笔记正文的索引互相漂移。',
  },
]);

/**
 * 插件入口。**空实现** —— 见 README 顶部的「不可直接使用」声明。
 *
 * @param {object} ctx 宿主上下文（cordis 风格）。骨架阶段不使用。
 */
export function apply(ctx) {
  // TODO(1) 注册 `ocr.capability` 服务：探测本机可用引擎，返回能力表（不在此处加载模型）。
  // TODO(2) 注册 `ocr.extract(filePath, { engine })`：走 C-2「文本层优先」再落到引擎。
  // TODO(3) 与笔记页对接：把提取结果作为可折叠块追加到附件下方（C-3），复用笔记的写入通道。
  // TODO(4) 引擎缺失时的降级路径：**明确报错，不静默下载**（与 `core/classroom-media` 的 MinerU 三不口径一致）。
  ctx?.logger?.info?.('[dsh-radar-ocr-ink] 候选骨架，未实现；apply() 故意为空');
}

export default { apply, STAGE, BORROWED_CONTRACTS };
