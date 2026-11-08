import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * 生成 `lecture` preset 的 composition。
 *
 * # 为什么是整份复制
 *
 * `@deepseek-ai/dsh-agent-preset` 的 Config schema 没有 `extends` / `base`：
 *
 *     z.object({ id, name, description, order, plugins: z.array(z.any()).required() })
 *
 * `plugins` 是完整数组，没有继承机制。所以想让 lecture 等于「standard + 多一个
 * 工具行」，只能把 standard 的 composition 整份搬过来。
 *
 * # 缩进层级（踩过一次）
 *
 *     - insert:                ← 0 格
 *         - id: preset-x       ← 4 格
 *           config:            ← 6 格
 *             plugins:         ← 8 格
 *             - id: persona    ← 8 格（数组项与 plugins 键同级）
 *               name: ...
 *
 * 数组项写成 6 格会得到 `YAMLException: bad indentation of a sequence entry`。
 */
const SRC = process.argv[2];
if (!SRC || !existsSync(SRC)) {
  console.error('用法: node gen.mjs <standard/agent.cordis.yml 路径>');
  process.exit(1);
}

const DEST = 'cordis.patch.yml';

/** 数组项的缩进：与 `plugins:` 键同级（8 格）。 */
const ITEM = ' '.repeat(8);

const standard = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

/** standard 的每一行整体缩进到数组项深度；空行保持空。 */
const indented = standard
  .split('\n')
  .map((line) => (line.trim() === '' ? '' : `${ITEM}${line}`))
  .join('\n');

const header = `# 「讲义」Agent preset —— 标准模式 + 课程资料检索工具。
#
# # 为什么要有这个 preset
#
# 课程资料检索（\`study_catalog\` / \`study_read\` / \`study_search\`）只对
# 「读课程讲义」这类任务有意义。挂在主机平面会让**每个** preset 的 agent
# 都看到这三个工具，占工具表、增加误选概率，也让 standard 的职责变模糊。
# 所以它只在本 preset 暴露。
#
# # composition 的来源
#
# \`plugins\` 是对官方 \`standard\` preset 的**整份复制** + 末尾追加一行
# \`tool-study\`。原因是 \`@deepseek-ai/dsh-agent-preset\` 的 Config 没有继承
# 机制（\`plugins\` 必须是完整数组），无法写「standard + 一行」。
#
# ⚠️ 这份文件由 \`gen.mjs\` 从运行时安装的 standard 生成，不要手改 ——
#    改完重跑脚本会用上游覆盖你的改动。要改行为请在 gen.mjs 的追加段里加。
#
# dsh 0.2.x 的声明式 preset：随 bundle 安装并在 profile 启动时注册。
- insert:
    # 本包自己。**这一行不能省** —— 它才是让 Loader 去 import 本包、跑
    # \`apply()\` 的入口。少了它，下面的 preset row 照样会被解析并注册进 roster，
    # 但本包里任何代码都不会执行（踩过：apply 里的探针一行都没打）。
    # \`vendor/paper-reader/cordis.patch.yml\` 同构：它的第一行也是加载自己。
    - id: zhiyun-preset-lecture
      name: '@lybx-leyw/dsh-zju-preset-lecture'

    - id: preset-lecture
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: lecture
        name: 讲义模式
        description: 标准模式加上课程资料检索：能查你已整理的讲义目录、按主题读取全文、按关键词定位出处。适合「帮我看看这周的课讲了什么」「这个知识点在我哪节课里出现过」这类问题。
        order: 5
        plugins:
`;

const footer = `
${ITEM}# ── 本 preset 独有：课程资料检索 ─────────────────────────────────────
${ITEM}#
${ITEM}# 这三个工具由 \`@lybx-leyw/dsh-zju-tool-study\` 注册（study_catalog /
${ITEM}# study_read / study_search）。它 inject 的是主机的 \`zhiyunStudy\` 服务
${ITEM}# （\`core/study\` provide）和 \`tools\` 注册表，自己不 provide 任何服务，
${ITEM}# 所以不需要 \`isolate\` realm —— realm 只用于隔离 preset 自己对外发布的
${ITEM}# 服务名，不隔离对主机服务的读取。
${ITEM}#
${ITEM}# 该包**不在** profile 的 bundles 里，正是为了让它只出现在这个 preset：
${ITEM}# 放进 profile 就是主机平面，所有 preset 都会看到。
${ITEM}- id: tool-study
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-study'
`;

const out = header + indented + '\n' + footer;
writeFileSync(DEST, out);
console.log(`✓ 已生成 ${DEST}（${out.split('\n').length} 行）`);
