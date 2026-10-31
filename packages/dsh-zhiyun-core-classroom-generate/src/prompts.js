// 源：ref/OpenMAIC/packages/@openmaic/generation/src/outline-generator.ts:82-117（大纲 prompt 的变量集）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/scene-prompts.ts:28-54（场景 prompt 的画布常量与系统提示）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/prompt-formatters.ts:1-120（课程上下文与语言指令文本）
// 源：ref/OpenMAIC/packages/@openmaic/generation/src/prompts/*.md（模板结构的等价重写）

/**
 * 提示词。
 *
 * # 为什么是「重写」而不是「搬模板」
 *
 * 上游模板在 `templates/` 里由 `buildPrompt` 做变量插值 + 片段拼接（`prompts/loader.ts`，
 * 含条件块与 snippet 展开）。本仓不引 `@openmaic/generation`（不加依赖、也不跨包
 * import src/），所以这里把**变量集合与输出契约**照抄，文本按中文重写。
 *
 * 输出契约是硬约束：`parseOutlineResponse` / `parseSceneResponse` 只认这里写明的
 * 字段名。改这两处必须同时改解析器与测试。
 *
 * 画布常量与上游一致：1000 × 562.5（viewportSize=1000、viewportRatio=0.5625）。
 */

export const SLIDE_CANVAS_WIDTH = 1000;
export const SLIDE_CANVAS_HEIGHT = 562.5;

const OUTLINE_SYSTEM = `你是课程设计者。把用户需求拆成一节互动课堂的「场景大纲」。

只输出一个 JSON 对象，不要任何解释、Markdown 或代码围栏：
{
  "languageDirective": "用哪种语言讲课（一句话）",
  "courseTitle": "课程标题（不超过 30 字）",
  "outlines": [
    {
      "id": "outline-1",
      "type": "slide | quiz | interactive | pbl",
      "title": "场景标题",
      "description": "这一页要讲什么（1-3 句）",
      "keyPoints": ["要点 1", "要点 2"],
      "teachingObjective": "教学目标（可选）",
      "estimatedDuration": 120,
      "quizConfig": { "questionCount": 3, "difficulty": "easy|medium|hard", "questionTypes": ["single"] },
      "mediaGenerations": [{ "type": "image", "elementId": "el-1", "prompt": "配图描述", "aspectRatio": "16:9" }]
    }
  ]
}

规则：
1. 顺序即讲课顺序：先讲（slide）、再练（quiz/interactive）、最后综合（pbl）。
2. 至少一节 slide；keyPoints 每节 2-5 条，每条一句话。
3. quiz 场景必须给 quizConfig；只有确实需要配图时才给 mediaGenerations。
4. 用户没要求互动/项目就不要造 interactive / pbl。`;

const SCENE_SYSTEM = {
  slide: `你是一页课件的作者。画布 ${SLIDE_CANVAS_WIDTH} × ${SLIDE_CANVAS_HEIGHT}（左上原点，单位 px）。

只输出一个 JSON 对象：
{
  "elements": [
    { "id": "el-1", "type": "text", "left": 80, "top": 80, "width": 840, "height": 120,
      "content": "<p>标题</p>", "fontSize": 36, "fontWeight": "bold", "textAlign": "left" }
  ],
  "background": { "type": "solid", "color": "#ffffff" },
  "speech": "老师这一页要讲的话（口语，2-4 句）"
}

规则：
1. 元素必须落在画布内；正文不小于 18px；一页不超过 8 个元素。
2. 只用 text / shape / image / latex 四类；没有配图就用 text。
3. speech 是**口播稿**，不要复述整页文字，要讲清楚为什么。`,
  quiz: `你是出题人。根据大纲出一组随堂题。

只输出一个 JSON 对象：
{
  "questions": [
    { "id": "q-1", "type": "single", "question": "题干", "options": [
        { "id": "a", "text": "选项 A" }, { "id": "b", "text": "选项 B" } ],
      "answer": "a", "explanation": "为什么是 a" }
  ],
  "speech": "发卷前的一句话（口语）"
}

规则：
1. 题量按 quizConfig.questionCount；没有就给 3 题。
2. type 只用 single / multiple / text；single 恰好一个正确项，multiple 至少两个。
3. 每题必须有 explanation。`,
  interactive: `你是一个互动组件的作者。产出**单文件 HTML**（内联 CSS/JS，不引外部资源）。

只输出一个 JSON 对象：
{ "html": "<!doctype html><html>…</html>", "widgetType": "diagram", "speech": "引入这个互动的一句话" }

规则：
1. 页面自包含、无网络请求；根节点 id 固定为 root。
2. 交互必须直接服务于大纲里的 keyPoints。`,
  pbl: `你负责项目的开题说明。

只输出一个 JSON 对象：
{ "speech": "把项目交代给学生的话（口语，3-5 句）" }`,
};

/**
 * 大纲的两条 prompt。
 *
 * `context.materialText` 是第 0 段（`phases/material-analysis.js`）从用户上传的
 * 讲义里抽出来的正文。上游把它作为独立的 `pdfText` 变量喂进 prompt
 * （`outline-generator.ts` 的 `pdfContent` 段），这里落成「讲义」一节；
 * 空串时整节不出现 —— 这样「没有讲义」与「讲义为空」的 prompt 逐字节相同。
 *
 * @param {object} brief 归一化后的 brief（见 `brief.js`）
 * @param {{languageDirective?: string, teacherContext?: string, materialText?: string}} [context]
 */
export function buildOutlinePrompt(brief, context = {}) {
  const goals = brief.goals.length > 0 ? brief.goals.map((goal, i) => `${i + 1}. ${goal}`).join('\n') : '（未给出）';
  const scenes = brief.scenes?.length
    ? `用户已给出 ${brief.scenes.length} 个场景，必须原样保留它们的 type 与 title。`
    : '场景由你设计。';
  const materialText = typeof context.materialText === 'string' ? context.materialText.trim() : '';

  const user = [
    `## 课程需求`,
    brief.requirement,
    '',
    `## 课程主题`,
    brief.topic,
    brief.description ? `\n## 补充说明\n${brief.description}` : '',
    '',
    `## 学习目标`,
    goals,
    '',
    materialText
      // 前后各留一个换行：`.filter` 只去掉空串，段落之间要靠元素自带的换行分隔，
      // 否则「## 硬性要求」会紧贴讲义最后一行，模型容易把要求读成讲义的一部分。
      ? `\n## 讲义（用户上传，按它备课）\n章节顺序、关键点与术语以讲义为准；讲义没写的可以补充，但不要改动它的结构与名词。\n\n${materialText}\n`
      : '',
    '',
    `## 硬性要求`,
    scenes,
    `- 需要互动页：${brief.interactive ? '是' : '否'}`,
    `- 需要随堂检测：${brief.assess ? '是' : '否'}`,
    `- 需要项目式收尾：${brief.project ? '是' : '否'}`,
    brief.languageDirective ?? context.languageDirective
      ? `- 语言：${brief.languageDirective ?? context.languageDirective}`
      : '',
    context.teacherContext ? `\n## 教师设定\n${context.teacherContext}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { system: OUTLINE_SYSTEM, prompt: user };
}

/**
 * 单场景的两条 prompt。
 *
 * `context` 里的 `previousSpeeches` 对应上游 `SceneGenerationContext.previousSpeeches`
 * （只带上一页的口播，保证跨页连贯又不把上下文撑爆）。
 */
export function buildScenePrompt(outline, context = {}) {
  const system = SCENE_SYSTEM[outline.type] ?? SCENE_SYSTEM.slide;
  const keyPoints = (outline.keyPoints ?? []).map((point) => `- ${point}`).join('\n') || '（无）';

  const user = [
    `## 场景`,
    `- 类型：${outline.type}`,
    `- 标题：${outline.title}`,
    `- 位置：第 ${context.index + 1} / ${context.total} 页`,
    outline.description ? `- 说明：${outline.description}` : '',
    outline.teachingObjective ? `- 教学目标：${outline.teachingObjective}` : '',
    '',
    `## 要点`,
    keyPoints,
    '',
    context.courseTitle ? `## 课程\n${context.courseTitle}` : '',
    context.allTitles?.length ? `## 全部场景\n${context.allTitles.join(' → ')}` : '',
    context.previousSpeeches?.length
      ? `## 上一页的口播（衔接用，不要重复）\n${context.previousSpeeches.join('\n')}`
      : '',
    context.languageDirective ? `## 语言\n${context.languageDirective}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { system, prompt: user };
}
