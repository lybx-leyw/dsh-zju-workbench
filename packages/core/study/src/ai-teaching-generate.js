import { renderSlideChapter } from '@lybx-leyw/dsh-zju-core-classroom-generate/html-shell';

/**
 * 「AI 教学」：默认将讲义送入 HTML 理解讲解分支，不生成 TTS 或图片。
 * 每章依次做理解障碍预判、视觉分镜、HTML；章节间有界并发。
 * 下文 canvas 说明保留用于兼容历史课件存档。
 *
 * # 为什么不是自己拼 prompt
 *
 * 第一版我写了一版「讲义 → 一次模型调用 → 页面列表」。用户指出那只是把长文
 * 切页，不是备课。真正的备课要三件事，而重构版里**已经全有了**：
 *
 *   outline  — 决定讲什么、什么顺序、每节讲多久（`phases/outline.js`）
 *   scenes   — 逐页产出 canvas 元素（标题/要点/图形）+ 口播稿（`phases/scenes.js`）
 *   media    — 配图（`phases/media.js`）
 *
 * 这套东西就是 `zhiyunClassroomGenerate` 服务（`core-classroom-generate`）。
 * 自己再写一套 prompt，等于把已经调好、有 schema 约束、有失败降级的管线
 * 重造一遍 —— 而且必然更差：会漏掉「按顺序规划」「每页元素布局」
 * 「承接上下文」这些它已经处理过的事。
 *
 * 所以这一层只做**适配**：
 *
 *   学习页的讲义（chapters/topics/blocks）
 *     → brief（requirement/topic/goals）
 *     → generate.start(brief) → runId
 *     → generate.stream(runId) 收集 run-done 的 scenes
 *     → 把 scenes[].content.canvas 交给渲染层
 *
 * # 为什么服务是「惰性取」而不是写进 inject
 *
 * 与 `lectureOf` 同一条理由：`inject` 是硬依赖，任一被停用都会让整个学习面板
 * pending（连课程树都打不开）。课堂生成是可选的加工步骤 —— 缺了应当只让
 * 「AI 教学」如实报未接入，而不是拖死学习页。
 */

/**
 * 讲义 → 课堂生成的 brief。
 *
 * brief 的形状由 `normalizeBrief` 定（requirement 必填，其余可选）。
 * 从讲义提炼而不是让用户再填一遍：他已经有终稿了。
 *
 * @param {object} lecture 讲义终稿
 * @param {object|null} [knowledgeTree] 知识树
 * @param {{ chapterConcurrency?: number }} [options] 章节并发（界面可选；不传用默认 3）
 */
export function briefFromLecture(lecture, knowledgeTree = null, options = {}) {
  const chapters = Array.isArray(lecture?.chapters) ? lecture.chapters : [];
  const topicTitles = [];
  const goals = [];

  for (const chapter of chapters) {
    for (const topic of (chapter?.topics ?? [])) {
      const title = String(topic?.title ?? '').trim();
      if (title) topicTitles.push(title);
      const first = textOf((topic?.blocks ?? [])[0]);
      if (first) goals.push(first.slice(0, 60));
    }
  }

  const topic = topicTitles[0] ?? '本节内容';
  return {
    requirement: `按讲义顺序讲清楚这一节，覆盖：${topicTitles.slice(0, 10).join('、') || topic}`,
    topic,
    outputFormat: 'html',
    description: `共 ${chapters.length} 章、${topicTitles.length} 个知识点`,
    goals: goals.slice(0, 8),
    // 摘要只负责描述任务；完整终稿和树是生成依据，不能拿摘要替代正文。
    sourceText: sourceFromLecture(lecture, Infinity),
    knowledgeTree,
    // 章节并发：界面可调；不传时写默认 3。这里显式给出而不是留 undefined ——
    // brief 自身要能说明它打算并发几章，读代码/看日志时不必再翻 normalizeBrief。
    chapterConcurrency: options.chapterConcurrency ?? 3,
    chapters: chapters.map((chapter, index) => ({
      id: `chapter-${index + 1}`,
      title: String(chapter?.title ?? '').trim() || `第 ${index + 1} 章`,
      sourceText: sourceFromLecture({ chapters: [chapter] }, Infinity),
      knowledgeTree: chapterTree(knowledgeTree, chapter, index),
    })),
    // 讲义本身就是素材：这一节的目标是「讲一遍」，不额外要求互动与测验
    interactive: false,
    assess: false,
  };
}

/** 优先按章节标题匹配原树，避免单纯依赖数组位置误配；缺树时保留终稿槽位。 */
function chapterTree(tree, chapter, index) {
  const branches = Array.isArray(tree?.chapters) ? tree.chapters
    : tree?.kind === 'title' ? ((tree.children ?? []).some((n) => n.kind === 'title') ? tree.children : [tree])
    : [];
  const title = String(chapter?.title ?? '').trim();
  const matched = title ? branches.find((node) => String(node?.title ?? '').trim() === title) : null;
  if (matched) return matched;
  // 只有无标题章节才允许按位置兜底。标题不一致不把别章的原始正文混进来。
  if (!title && branches[index]) return branches[index];
  return {
    title: title || `第 ${index + 1} 章`,
    topics: (chapter?.topics ?? []).map((topic) => ({ title: topic?.title ?? '', sourceLeafId: topic?.sourceLeafId })),
  };
}

/**
 * 讲义 → 送给 outline 阶段的素材文本。
 *
 * 保留 `##/###` 结构：outline prompt 靠它理解章节层次，
 * 从而决定「哪几节合成一页、哪一节拆两页」。
 */
export function sourceFromLecture(lecture, limit = 12000) {
  const chapters = Array.isArray(lecture?.chapters) ? lecture.chapters : [];
  const sections = [];

  for (const [ci, chapter] of chapters.entries()) {
    const title = String(chapter?.title ?? '').trim() || `第 ${ci + 1} 章`;
    const lines = [`## ${title}`];
    for (const [ti, topic] of (chapter?.topics ?? []).entries()) {
      const topicTitle = String(topic?.title ?? '').trim() || `知识点 ${ti + 1}`;
      lines.push(`### ${topicTitle}`);
      const body = (topic?.blocks ?? []).map(textOf).filter(Boolean).join('\n');
      if (body) lines.push(body);
    }
    sections.push(lines.join('\n'));
  }

  const full = sections.join('\n\n');
  if (full.length <= limit) return full;

  // 超长按章均分：每章都保留开头，避免模型以为这堂课只有前几章
  const per = Math.floor(limit / Math.max(1, sections.length));
  return sections
    .map((s) => (s.length <= per ? s : s.slice(0, per) + '\n…（以下略）'))
    .join('\n\n');
}

/**
 * 从 scene 里取出可渲染的页。
 *
 * scene 形状（`core-classroom-generate/src/scene.js`）：
 *   { id, type, title, order, content: { type, canvas? }, actions: [{type:'speech', text}] }
 *
 * 只取 slide 类：`canvas` 就是渲染层的输入（`elements` + `viewportSize` + `theme`）。
 * quiz / pbl 这类暂不展示 —— 这一节的目标是把课讲完，练习不是必需。
 */
/**
 * 章节数据 → 可在学习页展示的文档。
 *
 * # 为什么优先用 `slides` 重新渲染，而不是直接用存下来的 `html`
 *
 * `chapter.html` 是**生成当时**那份外壳的产物，会随排版一起被冻结在 vault 里。
 * 版式改进之后（例如从「上下」改成「左右」两栏），已经跑完的课如果直接回放
 * 旧 `html`，用户看到的仍是旧排版 —— 而他并不会为此重新跑一遍模型。
 *
 * 所以有 `slides` 就**现场重渲染**：数据结构没变，只是换了一层外壳。
 * 拿不到 `slides`（更早的存档）时才退回 `chapter.html`，保证老数据仍能打开。
 */
export function pagesFromHtmlChapters(chapters) {
  const list = Array.isArray(chapters) ? chapters : [];
  return list
    .filter(chapter => (typeof chapter?.html === 'string' && chapter.html.trim()) || Array.isArray(chapter?.slides))
    .map((chapter, index) => {
      const title = chapter.title || `第 ${index + 1} 章`;
      const html = renderChapterHtml(chapter, title);
      return html ? { id: chapter.chapterId ?? `chapter-${index + 1}`, title, html,
        analysis: chapter.analysis, storyboard: chapter.storyboard, points: [] } : null;
    })
    .filter(Boolean);
}

/**
 * 用当前的排版外壳重渲染一章；没有 `slides` 时退回存档里的 `html`。
 *
 * `strictFontSize: false` 是必须的：字号下限是**生成期**质量门，
 * 历史数据里有 22/23px 的标签，用新门卡旧数据只会让课程打不开。
 *
 * 渲染失败（数据被手工改坏等）时同样退回旧 `html` —— 宁可显示旧排版，
 * 也不要因为一次重渲染异常让整节课打不开。
 */
function renderChapterHtml(chapter, title) {
  if (Array.isArray(chapter?.slides) && chapter.slides.length) {
    try {
      return renderSlideChapter({ title, topic: chapter.topic ?? '', slides: chapter.slides, strictFontSize: false });
    } catch { /* 退回存档 html */ }
  }
  return typeof chapter?.html === 'string' && chapter.html.trim() ? chapter.html : null;
}
export function pagesFromScenes(scenes) {
  const list = Array.isArray(scenes) ? scenes : [];
  return list
    .filter((scene) => scene?.content?.type === 'slide' && scene.content.canvas)
    .map((scene, index) => {
      const speech = (scene.actions ?? [])
        .filter((action) => action?.type === 'speech')
        .map((action) => String(action.text ?? '').trim())
        .filter(Boolean)
        .join('\n\n');
      return {
        id: scene.id ?? `p-${index + 1}`,
        title: String(scene.title ?? '').trim() || `第 ${index + 1} 页`,
        canvas: scene.content.canvas,
        speech,
        points: [],
      };
    });
}

/**
 * 跑一次生成：start → stream → 收 scenes。
 *
 * `scene-ready` 只带元信息（id/title/order），完整 canvas 在 `run-done` 的
 * outputs 里。所以这里只认 run-done / run-error 两种终止事件。
 *
 * @param {object} deps
 * @param {object} deps.generate    zhiyunClassroomGenerate 服务
 * @param {object} deps.brief       `briefFromLecture` 的产出
 * @param {string} [deps.stageId]   课堂所属的舞台 id
 * @returns {Promise<{runId: string, pages: object[], skipped: object[]}>}
 */
export async function runGeneration({ generate, brief, stageId, provider, model }) {
  if (!generate?.start || !generate?.stream) {
    throw Object.assign(new Error('课堂生成服务未接入'), { code: 'NOT_WIRED' });
  }

  // provider/model 必须显式传：不传的话生成服务会去问上游服务端要清单
  // （依赖课堂登录态），或者把 undefined 当 provider 传给宿主 llm，
  // 报 `no adapter registered for provider "undefined"`。
  const opts = {};
  if (stageId) opts.stageId = stageId;
  if (provider) opts.provider = provider;
  if (model) opts.model = model;

  const started = await generate.start(brief, opts);
  const runId = started?.runId;
  if (!runId) throw Object.assign(new Error('生成没有返回 runId'), { code: 'LLM' });

  let completed = null;
  let failure = null;

  for await (const event of generate.stream(runId)) {
    const kind = event?.kind ?? event?.type;
    if (kind === 'run-done') completed = event;
    else if (kind === 'run-error') failure = event;
  }

  if (failure) {
    // 事件形状是 `{ runId, phase, kind, type, payload, ts }` —— 错误在 payload 里。
    // 曾经按 `event.error.message` / `event.message` 读，两处都取不到东西，
    // 于是永远落到兜底文案「生成失败」，把真实原因（哪个阶段、什么错）全丢了。
    const detail = failure?.payload ?? {};
    const message = detail?.error?.message
      ?? detail?.message
      ?? (detail?.error?.code ? `生成失败（${detail.error.code}）` : null)
      ?? (detail?.phase ? `生成在「${detail.phase}」阶段失败` : null)
      ?? '生成失败（宿主未给出原因）';
    throw Object.assign(new Error(message), { code: 'LLM', detail });
  }
  if (!completed) {
    throw Object.assign(new Error('生成没有正常结束'), { code: 'LLM' });
  }

  // scenes 从 `get(runId)` 取，不从事件取。
  //
  // ⚠️ `run-done` 的 payload 只有摘要（`sceneCount` / `skipped` / `phases`），
  //    **不含 scenes 本体** —— 早先以为它在 `event.outputs` 里，于是永远
  //    拿到空数组，报「这一节没有生成出可讲的课件页」（EMPTY）。
  //    真正的产物在 run 快照的 `scenes` 字段上（见 generate 包的 snapshot）。
  const run = typeof generate.get === 'function' ? await generate.get(runId) : null;
  if (run?.outputFormat === 'html') {
    const pages = pagesFromHtmlChapters(run.htmlChapters);
    if (!pages.length) throw Object.assign(new Error('没有完整生成的 HTML 章节'), { code: 'EMPTY' });
    return { runId, pages, skipped: [] };
  }
  const scenes = Array.isArray(run?.scenes) ? run.scenes : [];
  const skipped = Array.isArray(run?.skipped) ? run.skipped : [];

  // 一页都没产出时，把「为什么」尽量说清楚：跳过几个、run 什么状态
  if (!scenes.length) {
    const count = completed?.payload?.sceneCount ?? 0;
    const skipCount = completed?.payload?.skipped ?? skipped.length;
    // 把第一个跳过原因带到错误里 —— 「9 个全跳过」这种全线失败，
    // 只说「产出为空」等于把可执行的信息全丢了。
    const first = skipped[0];
    const cause = first?.message ? `：${first.message}` : '';
    throw Object.assign(
      new Error(
        count === 0
          ? `这一节没有生成出课件页（模型产出为空${skipCount ? `，${skipCount} 个场景被跳过${cause}` : ''}）`
          : `生成了 ${count} 个场景，但都不是可渲染的幻灯片`,
      ),
      { code: 'EMPTY', detail: { count, skipCount, skipped: skipped.slice(0, 3), status: run?.status } },
    );
  }

  const pages = pagesFromScenes(scenes);

  if (!pages.length) {
    throw Object.assign(
      new Error(`${scenes.length} 个场景里没有 slide 类（只有测验/互动/项目）`),
      { code: 'EMPTY' },
    );
  }
  return { runId, pages, skipped };
}

/** 取块的纯文本。与前端分页逻辑保持一致。 */
function textOf(block) {
  if (!block) return '';
  if (typeof block === 'string') return block.trim();
  if (typeof block.text === 'string') return block.text.trim();
  if (Array.isArray(block.paragraphs)) {
    return block.paragraphs.map((p) => String(p ?? '').trim()).filter(Boolean).join('');
  }
  return '';
}

/**
 * 启动一次生成，立刻返回 runId（不等模型）。
 *
 * # 为什么要拆成 start + poll
 *
 * 一次备课要跑 9 个场景、每个场景一次模型调用，实测 3-5 分钟。
 * RPC 是「一次请求一次响应」，同步等会让用户对着按钮干等，
 * 中途还可能被浏览器/网关的超时切断（实测 Chrome 直接 crash）。
 *
 * 所以拆两半：
 *   start → 立刻拿到 runId，界面进入「正在备课」
 *   poll  → 每 1.5 秒问一次进度，界面显示「已备好 N / 共 M 页」
 *
 * 这不改管线的执行方式（它本来就是异步跑、事件流可回放），
 * 只是把「等」从一次长请求摊成多次短请求。
 */
export async function startGeneration({ generate, brief, stageId, provider, model, llmPool }) {
  if (!generate?.start) {
    throw Object.assign(new Error('课堂生成服务未接入'), { code: 'NOT_WIRED' });
  }
  const opts = {};
  if (stageId) opts.stageId = stageId;
  if (provider) opts.provider = provider;
  if (model) opts.model = model;
  // 池子（{ execute, concurrency }）：有它时章节并发 = 总并发，由池子决定。
  if (llmPool) opts.llmPool = llmPool;

  const started = await generate.start(brief, opts);
  const runId = started?.runId;
  if (!runId) throw Object.assign(new Error('生成没有返回 runId'), { code: 'LLM' });
  return { runId };
}

/**
 * 查一次进度。
 *
 * 返回三种状态：
 *   running  还在跑，带 progress（已备好几页 / 共几页）与 phase
 *   done     跑完了，带 pages
 *   failed   失败了，带 error
 *
 * `get(runId)` 拿到的是 run 快照 —— 已让它带上 scenes（见 generate 包的 snapshot），
 * 所以进度与成品走同一个调用，不需要额外接口。
 */
export async function pollGeneration({ generate, runId }) {
  if (!generate?.get) {
    throw Object.assign(new Error('课堂生成服务未接入'), { code: 'NOT_WIRED' });
  }
  const run = await generate.get(runId);
  if (!run) throw Object.assign(new Error('找不到这次生成'), { code: 'NOT_FOUND' });

  const status = run.status;
  const scenes = Array.isArray(run.scenes) ? run.scenes : [];
  const skipped = Array.isArray(run.skipped) ? run.skipped : [];

  // run 结束但一页没有：把原因说清楚（与 runGeneration 同一套话术）
  if (status === 'failed' || status === 'cancelled') {
    const detail = run.error ?? {};
    throw Object.assign(
      new Error(detail.message ?? (status === 'cancelled' ? '已取消' : '生成失败')),
      { code: status === 'cancelled' ? 'CANCELLED' : 'LLM' },
    );
  }

  if (status === 'done') {
    const pages = run.outputFormat === 'html'
      ? pagesFromHtmlChapters(run.htmlChapters) : pagesFromScenes(scenes);
    if (!pages.length) {
      const first = skipped[0];
      const cause = first?.message ? `：${first.message}` : '';
      throw Object.assign(
        new Error(
          scenes.length
            ? `${scenes.length} 个场景里没有可渲染的幻灯片`
            : `这一节没有生成出课件页${skipped.length ? `（${skipped.length} 个场景被跳过${cause}）` : ''}`,
        ),
        { code: 'EMPTY', detail: { skipped: skipped.slice(0, 3) } },
      );
    }
    return { status: 'done', pages, skipped };
  }

  // 还在跑：从已完成的场景里数进度
  const donePhases = (run.phases ?? []).filter((p) => p.done).map((p) => p.phase);
  return {
    status: 'running',
    // scenes 在跑的过程中也会逐步出现，所以「已备好」可以直接报真实页数
    ready: run.readyScenes ?? scenes.length,
    total: run.totalScenes ?? null,
    chapterTotal: run.chapterTotal ?? 0,
    chaptersDone: run.chaptersDone ?? 0,
    // HTML 分支：章内是串行的多页生成，必须把「这一章做到第几页、哪一步」透出来，
    // 否则轮询只能看到「已完成 N 章」，整段时间界面没有变化。
    ...(run.outputFormat === 'html' ? {
      outputFormat: 'html',
      slidesDone: run.slidesDone ?? 0,
      chapterProgress: Array.isArray(run.chapterProgress) ? run.chapterProgress : [],
      startedAt: run.startedAt ?? null,
    } : {}),
    phase: run.phase ?? donePhases.at(-1) ?? 'outline',
    phasesDone: donePhases,
  };
}
