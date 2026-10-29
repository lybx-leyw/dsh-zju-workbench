/**
 * 候选骨架 · 占位。**没有可用实现**，不要接入 profile。
 *
 * 本文件只声明包的形状与意图，让人工评审时能一眼看出处：
 *   - 落在**已有的「插件」页**（`dsh-zhiyun-page-plugins`），不新开导航项；
 *   - 上游 `dsh-research` 提供的是「科研插件目录 + 一键装」这一半能力；
 *   - 「我手上这几个包谁依赖谁、能不能安全关掉」这一半仍由现有实现负责，不替换。
 *
 * TODO（人工评审通过后才做）：
 *   1. 与 `dsh-radar-market` 联合裁定：两套市场落在同一页时谁读 catalog、
 *      是否只保留一个 `allowInstall` 开关（见报告「本轮的核心结论」）。
 *   2. 把 `ctx.shell` 之外的写入路径确认清楚（上游 README 已说明 `ctx.shell` 写不进 profile）。
 *   3. 目录只保留「论文 / 文献 / 写作」相关条目，其余在页面侧过滤，不改上游源码。
 */

export const name = 'dsh-radar-research-market';

/** 落点：已有的「插件」页，不新增侧栏项。 */
export const placement = 'plugins-page';
