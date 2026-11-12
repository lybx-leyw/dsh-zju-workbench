import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * 生成 `lecture` preset 的 patch。
 *
 * # 来源必须是宿主**当前版本自带**的那份
 *
 * 踩过大坑：一开始从 pnpm 存储里的 `@deepseek-ai/dsh-agent-presets@0.1.5-rc.3`
 * 取 `presets/standard/agent.cordis.yml`（255 行）。那是**旧版遗留**，
 * 它的 persona 写着：
 *
 *     suffix: Your working directory is {{cwd}}.
 *
 * 而 0.2.2 的变量表只有 `provider` / `model`，没有 `cwd` —— 于是切到该 preset
 * 直接失败：
 *
 *     unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix";
 *     registered variables: provider, model
 *
 * 0.2.2 真正的 preset 在 `dsh-web-app/presets/*.patch.yml`，persona 只有
 * `prefix`、没有 suffix，也没有 `list-agents` / `workflow-worker-thread` /
 * `tool-ralph` 那批旧 row。
 *
 * # 为什么不按 row 增删
 *
 * 中途试过「删掉报错的 row」「给报错的 row 加 disabled」—— 两者都是在跟旧版
 * 的差异打补丁。正确做法是**换对来源**：结构差异从源头就没了。
 */
const SRC = process.argv[2];
if (!SRC || !existsSync(SRC)) {
  console.error('用法: node gen.mjs <dsh-web-app/presets/standard.patch.yml 路径>');
  process.exit(1);
}

const DEST = 'cordis.patch.yml';

/** 数组项的缩进：与 `plugins:` 键同级（10 格，见 standard.patch.yml）。 */
const ITEM = ' '.repeat(10);

const standard = readFileSync(SRC, 'utf8').replace(/\r\n/g, '\n');

/**
 * 取出 `config.plugins:` 之后的内容（即那棵 row 树的正文）。
 *
 * 不直接整文件搬运：源文件是**完整的 patch 文件**（带 `- insert:` 头、
 * 带 `id: preset-standard`），我们要的是它 `plugins` 的子树。
 */
function extractPlugins(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^\s*plugins:\s*$/.test(line));
  if (start < 0) throw new Error('源文件里找不到 `plugins:` 行');

  const body = lines.slice(start + 1);
  const out = [];
  for (const line of body) {
    if (line.trim() === '') { out.push(''); continue; }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // 回到顶层，plugins 段结束
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
  return out;
}

const bodyLines = extractPlugins(standard);
const minIndent = Math.min(
  ...bodyLines.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length),
);

/** 归一化到 ITEM 深度。 */
const indented = bodyLines
  .map((line) => (line.trim() === '' ? '' : `${ITEM}${line.slice(minIndent)}`))
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
# \`plugins\` 是宿主**当前版本自带**的
# \`@deepseek-ai/dsh-web-app/presets/standard.patch.yml\` 里那棵 row 树的
# 逐行复制 + 末尾追加一行 \`tool-classroom\`。
#
# 为什么必须用这一份：从 pnpm 存储里翻到的
# \`@deepseek-ai/dsh-agent-presets@0.1.5-rc.3\` 是**旧版遗留**，它的 persona 写
# \`suffix: ... {{cwd}}\`，而 0.2.2 只注册了 \`provider\` / \`model\` 两个变量 ——
# 切到该 preset 会直接抛
# \`unknown prompt variable "{{cwd}}" in section "deployment:persona-suffix"\`。
#
# \`@deepseek-ai/dsh-agent-preset\` 的 Config 没有继承机制
# （\`plugins\` 必须是完整数组），所以只能整份复制。
#
# ⚠️ 这份文件由 \`gen.mjs\` 生成，不要手改 ——
#    改行为请改 gen.mjs 的追加段，或重跑脚本对齐上游。
#
# dsh 0.2.x 的声明式 preset：随 bundle 安装并在 profile 启动时注册。
- insert:
    # 本包自己。**这一行不能省** —— 它才是让 Loader 去 import 本包、跑
    # \`apply()\` 的入口。少了它，下面的 preset row 照样会被解析并注册进 roster，
    # 但本包里任何代码都不会执行。
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
${ITEM}# ── 本 preset 独有：课程资料与课堂原始素材 ──────────────────────────
${ITEM}#
${ITEM}# 这一行挂上 7 个工具，由 \`@lybx-leyw/dsh-zju-tool-classroom\` 注册：
${ITEM}#
${ITEM}#   study_courses     入口索引：有哪些课、每节整理到什么程度（**含未整理的**）
${ITEM}#   study_catalog     已整理的讲义目录（wiki 经验库）
${ITEM}#   study_read        读一条整理好的讲义主题
${ITEM}#   study_search      在已整理讲义里按关键词定位（可带课名锁定是哪一门）
${ITEM}#   raw_transcript    课堂原始转写稿（老师原话，带时间戳）
${ITEM}#   raw_slides        PPT 页面**图片**（没有文字层，本仓不做 OCR）
${ITEM}#   campus_classroom_read  平台原始数据（课程/节次/课件/字幕/直播状态）
${ITEM}#
${ITEM}# 前六个分成两组是有意的：study_* 读的是**二次加工过的 wiki 讲义**，
${ITEM}# raw_* 读的是**原始素材**。混在一起时模型会把「老师随口说的话」当成
${ITEM}# 讲义的结论，也会把 PPT 的图片当成页面上的文字去引用。
${ITEM}#
${ITEM}# 它 inject 的是主机的 \`zhiyunStudy\`（\`core/study\` provide）与 \`tools\`
${ITEM}# 注册表，自己不 provide 任何服务，所以不需要 \`isolate\` realm ——
${ITEM}# realm 只用于隔离 preset 自己对外发布的服务名，不隔离对主机服务的读取。
${ITEM}#
${ITEM}# 该包**不在** profile 的 bundles 里，正是为了让它只出现在这个 preset：
${ITEM}# 放进 profile 就是主机平面，所有 preset 都会看到。
${ITEM}# 而工具表每多一格都在挤占模型的选择空间 —— 7 个已经不少了。
${ITEM}- id: tool-classroom
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-classroom'

${ITEM}# ── 本 preset 独有：本地文档处理 ─────────────────────────────────────
${ITEM}#
${ITEM}# \`campus_doc\`（text / pdf / pages / find）由 \`@lybx-leyw/dsh-zju-tool-doc\`
${ITEM}# 注册，读的是主机 \`zhiyunDoc\` 服务（\`core/doc\` provide）。
${ITEM}#
${ITEM}# 与 \`tool-classroom\` 同一条理由放在 preset 而不是 profile：它不是每个
${ITEM}# 会话都要用的东西，而工具表每多一格都在挤占模型的选择空间。
${ITEM}#
${ITEM}# 为什么这个 preset 是它的落点：本 preset 的场景就是「读课程资料」，
${ITEM}# 而作业、讲义、教材常常是 PDF / Word —— 拿到一份 PDF 却没法取字，
${ITEM}# 只能让用户自己复制粘贴。
${ITEM}- id: tool-doc
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-doc'
`;

const out = header + indented + '\n' + footer;
writeFileSync(DEST, out);
console.log(`✓ 已生成 ${DEST}（${out.split('\n').length} 行）`);
console.log(`  来源: ${SRC}`);
