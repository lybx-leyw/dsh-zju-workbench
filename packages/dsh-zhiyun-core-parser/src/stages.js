/**
 * **解析阶段的名字与顺序**（一份，只有一份）。
 *
 * # 为什么单独成文件
 *
 * 这些名字会同时出现在三个地方：进度事件（`onProgress`）、缓存键、以及
 * 上层界面上的步骤条。三处各写一遍的结果是「界面说 mix、日志说 tag、
 * 缓存说 annotation」—— 排查时最费时间的正是这种**同一个东西三个名字**。
 *
 * # 与 `docs/show/zhiyun-pipeline.html` 的对应
 *
 * 那个演示就是本流水线的**可执行规格**：阶段名、顺序、每一阶段产出什么，
 * 一律以它为准。这里只是把演示里的七段落成常量。
 */

/** 阶段标识（进进度事件与缓存键，**不要改**：改了等于让旧缓存全部失效）。 */
export const STAGE = Object.freeze({
  /** ① vision：4 页拼一张图 → 出块 + 出**知识树初稿**（标题与缩进） */
  VISION: 'vision',
  /** ② mix：从共享队列取块，只出**标记**（role + facet），并给出清洗稿 */
  MIX: 'mix',
  /** ③ 建树：筛支线 → 挂账 → 正交审查 → 并发合并 */
  BUILD: 'build',
  /** ④ 重构：拆叶 → 重聚知识点叶 → 分级聚合 */
  REBUILD: 'rebuild',
});

/** 阶段的中文名（人可读的进度文本用它）。 */
export const STAGE_NAME = Object.freeze({
  [STAGE.VISION]: '识别',
  [STAGE.MIX]: '标记',
  [STAGE.BUILD]: '建树',
  [STAGE.REBUILD]: '重构',
});

/**
 * 阶段顺序 —— 进度条按它画，**任务完成度也按它算**。
 *
 * ⚠️ vision 与 mix 在**执行上**是并行的（一个产、一个消费同一个队列），
 *    但它们在**汇报上**有先后：用户看到的是"识别 → 标记 → 建树 → 重构"。
 *    这里给的是**汇报顺序**，不是执行顺序。
 */
export const STAGE_ORDER = Object.freeze([STAGE.VISION, STAGE.MIX, STAGE.BUILD, STAGE.REBUILD]);

/** 阶段序号（1 起）。 */
export const stageNo = (stage) => STAGE_ORDER.indexOf(stage) + 1;
