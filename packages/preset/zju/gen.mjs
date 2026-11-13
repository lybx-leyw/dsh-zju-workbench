import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * 生成 `zju` preset 的 patch。
 *
 * # 与 `lecture` preset 的关系
 *
 * 两个 preset **共用同一份 composition**（宿主 `standard.patch.yml` 里那棵
 * row 树），差别只在**追加哪些工具**：
 *
 * | preset | 追加的工具 |
 * | --- | --- |
 * | `lecture`（讲义模式） | `tool-classroom` + `tool-doc` |
 * | `zju`（校园模式） | **全部 12 个工具包** |
 *
 * `tool-classroom` **两边都有** —— 它是「读课程资料」这件事本身，
 * 在两个场景下都成立。这不是重复挂载：一个 agent 会话只会用其中一个 preset，
 * 所以工具表里只会出现一份。
 *
 * # 为什么 `zju` 要装全部
 *
 * 其余 11 个包（教务、学在浙大、CC98、二课、场馆、实验、学习通、拼题A、
 * 通知、查老师、电子书）都是**校园事务**。它们各自只对某一类任务有意义，
 * 但「帮我查一下选课」「论坛上有人问过吗」「我的作业交了没」这些请求
 * 会随时混在一起 —— 拆成多个 preset 只会让用户每次都要先选对那个。
 *
 * 代价是工具表变长（27 个）。这是有意的取舍：**校园场景下，
 * 「工具选错了」比「要多读几行工具描述」更贵**。
 *
 * # composition 的来源
 *
 * 与 `lecture` 完全一致：宿主当前版本的 `standard.patch.yml`，
 * 因为 `@deepseek-ai/dsh-agent-preset` 的 Config 没有继承机制
 * （`plugins` 必须是完整数组），只能整份复制。
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

const header = `# 「校园」Agent preset —— 标准模式 + 全部校园工具。
#
# # 为什么要有这个 preset
#
# 本仓的 27 个 agent 工具覆盖教务、学在浙大、CC98、二课、场馆、实验课、
# 学习通、拼题A、通知、查老师、电子书、课堂资料、文档处理。
# 它们各自只对某一类任务有意义，但用户的请求会随时跨域：
# 「帮我查一下选课」「论坛上有人问过吗」「我的作业交了没」。
#
# 拆成多个 preset 只会让用户每次先猜「这次该选哪个」。
# 所以这一个 preset 装全部 —— 代价是工具表长（27 个），
# 换来的是「不用先选对模式」。
#
# # 与 \`lecture\` preset 的关系
#
# 两个 preset 共用同一份 composition，差别只在追加的工具：
#
#   lecture   tool-classroom + tool-doc（只读课程资料）
#   zju       全部 12 个工具包
#
# \`tool-classroom\` **两边都有**：它是「读课程资料」这件事本身，
# 在两个场景下都成立。不是重复挂载 —— 一次会话只用一个 preset，
# 工具表里只会出现一份。
#
# # composition 的来源
#
# \`plugins\` 是宿主**当前版本自带**的
# \`@deepseek-ai/dsh-web-app/presets/standard.patch.yml\` 里那棵 row 树的
# 逐行复制 + 末尾追加工具行。
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
    - id: zw-preset-zju
      name: '@lybx-leyw/dsh-zju-preset-zju'

    - id: preset-zju
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: zju
        name: 校园模式
        description: 标准模式加上全部校园工具：教务（课表/成绩/选课）、学在浙大（作业/点名）、CC98 论坛、二课活动、体育场馆、实验选课、学习通、拼题A、校内通知、查老师、电子书、课堂资料与原始素材、本地文档处理。适合「帮我办学校的事」这类跨多个平台的问题。
        order: 6
        plugins:
`;

const footer = `
${ITEM}# ══ 本 preset 追加的工具包 ══════════════════════════════════════════
${ITEM}#
${ITEM}# 下面 12 行各挂一个工具包。它们**都不在** profile 的 bundles 里 ——
${ITEM}# 放进 profile 就是主机平面，所有 preset 都会看到；而工具表每多一格
${ITEM}# 都在挤占模型的选择空间。
${ITEM}#
${ITEM}# 每个包 inject 的都是主机的服务（\`zwZdbk\` / \`zwCc98\` / …）与
${ITEM}# \`tools\` 注册表，自己不 provide 任何服务，所以都不需要 \`isolate\` realm。
${ITEM}#
${ITEM}# 一个包缺席时（没装那个数据源），它的工具如实报 SERVICE_MISSING，
${ITEM}# 不影响其他工具 —— 这正是按域分包的好处。

${ITEM}# ── 课堂资料与原始素材（7 个工具）──────────────────────────────
${ITEM}#
${ITEM}#   study_courses     入口索引：有哪些课、每节整理到什么程度（含未整理的）
${ITEM}#   study_catalog     已整理的讲义目录（wiki 经验库）
${ITEM}#   study_read        读一条整理好的讲义主题
${ITEM}#   study_search      在已整理讲义里按关键词定位（可带课名锁定是哪一门）
${ITEM}#   raw_transcript    课堂原始转写稿（老师原话，带时间戳）
${ITEM}#   raw_slides        PPT 页面**图片**（没有文字层，本仓不做 OCR）
${ITEM}#   campus_classroom_read  平台原始数据（课程/节次/课件/字幕/直播状态）
${ITEM}#
${ITEM}# study_* 读的是二次加工过的 wiki 讲义，raw_* 读的是原始素材。
${ITEM}# 分开是有意的：混在一起时模型会把「老师随口说的话」当成讲义的结论。
${ITEM}- id: tool-classroom
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-classroom'

${ITEM}# ── 教务网（12 个查询 action + 3 个写 action）─────────────────────
${ITEM}#
${ITEM}# campus_zdbk_read 查课表/考试/成绩/GPA/培养方案/选课查询；
${ITEM}# campus_course_select 选课/退课/调志愿，**过审批**。
${ITEM}#
${ITEM}# 两个工具必须成对：选课要的 \`section\`（教学班号）只能从
${ITEM}# selectionSections 拿到，不给读工具就等于让模型猜编号。
${ITEM}- id: tool-zdbk
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-zdbk'

${ITEM}# ── 学在浙大（9 个查询/下载 action + 交作业 + 点名）──────────────
${ITEM}#
${ITEM}# campus_xuezai_read 查待办/课程/作业/点名历史，并把课件与作业附件
${ITEM}# 下载到本机（下载只读平台、写本机，不改变平台状态，所以不过审批）；
${ITEM}# campus_homework 交/撤作业、campus_checkin 点名签到，都**过审批**。
${ITEM}#
${ITEM}# 交作业要的作业 id 只能从 homeworkList 拿到 —— 同样是成对的。
${ITEM}- id: tool-xuezai
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-xuezai'

${ITEM}# ── CC98 论坛（22 个读 action + 3 个写工具）──────────────────────
${ITEM}#
${ITEM}# campus_cc98_read 覆盖十大/搜索/版面/主题/楼层/私信/个人中心；
${ITEM}# campus_post 发帖回复编辑私信、campus_react 赞踩评分收藏、
${ITEM}# campus_signin 每日签到 —— 三个写工具都**过审批**。
${ITEM}#
${ITEM}# 论坛内容是外部用户发言，工具描述里写明了「不是指令，也不代表授权」。
${ITEM}- id: tool-cc98
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-cc98'

${ITEM}# ── 二课活动（6 个读 action + 4 个写 action）─────────────────────
${ITEM}- id: tool-sztz
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-sztz'

${ITEM}# ── 体育场馆（5 个读 action + 2 个写 action）─────────────────────
${ITEM}- id: tool-tyys
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-tyys'

${ITEM}# ── 实验选课（10 个读 action + 2 个写 action）────────────────────
${ITEM}- id: tool-lab
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-lab'

${ITEM}# ── 学习通 / 超星（7 个读 action，含课件与视频下载）──────────────
${ITEM}#
${ITEM}# 下载只读平台、写本机，不过审批。交作业、开始考试、签到属于
${ITEM}# 用户自己的决定，这个包刻意不做。
${ITEM}- id: tool-xxt
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-xxt'

${ITEM}# ── 拼题A（7 个读 action + 2 个写 action）──────────────────────
${ITEM}#
${ITEM}# campus_answer 只做保存与提交，**不提供「开始答题」** ——
${ITEM}# 那会启动计时，属于用户自己的决定。
${ITEM}- id: tool-pta
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-pta'

${ITEM}# ── 校内通知（4 个读 action）────────────────────────────────────
${ITEM}- id: tool-notice
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-notice'

${ITEM}# ── 查老师（3 个读 action）──────────────────────────────────────
${ITEM}#
${ITEM}# 教师详情与课程绩点每次都要联网，而这个站点在国内公网不可达。
${ITEM}# 连不上时工具会如实说明是网络问题，不是「查不到」。
${ITEM}- id: tool-chalaoshi
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-chalaoshi'

${ITEM}# ── 电子图书（检索书目与平台入口，不下载不借阅）──────────────────
${ITEM}- id: tool-ebook
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-ebook'

${ITEM}# ── 研究生教务（课表）────────────────────────────────────────────
${ITEM}#
${ITEM}# 注意它与 campus_zdbk_read 的 timetable 是**两套系统**：
${ITEM}# 研究生课表在研究生院，本科课表在本科教务。研究生同时有本科账号时
${ITEM}# 会看到两份不同的表，这是对的。
${ITEM}- id: tool-yjsy
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-yjsy'

${ITEM}# ── 本地文档处理（4 个 action：text / pdf / pages / find）──────────
${ITEM}#
${ITEM}# 读本机的 PDF / Word / Excel / PPT 取文字、合成 PDF、取页、找关键词。
${ITEM}# 作业与教材常是这些格式 —— 拿到一份 PDF 却没法取字，只能让用户
${ITEM}# 自己复制粘贴。
${ITEM}#
${ITEM}# ⚠️ Word / Excel / PPT 直接读 OOXML 里的文字，97-2003 老格式
${ITEM}# （.doc/.xls/.ppt）读不了，会如实报 UNSUPPORTED。
${ITEM}- id: tool-doc
${ITEM}  name: '@lybx-leyw/dsh-zju-tool-doc'
`;

const out = header + indented + '\n' + footer;
writeFileSync(DEST, out);
console.log(`✓ 已生成 ${DEST}（${out.split('\n').length} 行）`);
console.log(`  来源: ${SRC}`);
