/**
 * 从仓库既有的讲义结构造标准学习资源（schema v1）。
 *
 * # 为什么需要这一层
 *
 * `core-lecture` 的讲义是为**阅读界面**长的：它关心的是「这一段该用什么语气呈现」，
 * 因此有 `passages` / `register` / `draft` 这些写作态字段，块的类型闭集也是
 * 讲解/定义/步骤/例题/说明。DeepTutor 要的是另一种东西：**可引用、可回溯**的
 * 内容单元 —— 它要知道「这段话在第几页、第几秒、对应哪个锚点」，因为它的产出
 * （题目、追问、讲解）必须能跳回来源。
 *
 * 这一层就是那份适配：把写作态字段**丢掉**（它们不该进缓存键，否则同一份内容
 * 因为语气判定不同就会换 revision），把阅读态需要的锚点**补上**。
 *
 * # 三条取舍
 *
 * 1. **只投影正文，不投影写作态**。`passages` / `register` / `draft` / `notes` 不进 bundle：
 *    `revision` 是派生资源的缓存键，语气判定抖动一次就重算全部题目是不可接受的。
 * 2. **id 由结构位置派生，且只依赖顺序**。`ch1/t1-2/b3` 这种形式保证同一份讲义
 *    两次投影得到同一批 id —— 否则同一内容会算出不同 revision。
 * 3. **锚点按块建，一条块一条锚点**。答案要能定位到「哪一块」，只有知识点级的
 *    锚点会让题目只能跳到整节开头，等于没定位。页码/时间缺了就留 null，
 *    不用 0 兜底（0 是合法页码与合法时间，兜底会把「不知道」伪装成「在第 0 页」）。
 */

import { hashOf } from './hash.js';

/** core-lecture 的块类型 → schema v1 的块类型闭集（八值）。 */
export const LECTURE_BLOCK_TYPE_MAP = Object.freeze({
  elaboration: 'paragraph',
  definition: 'callout',
  procedure: 'list',
  example: 'question',
  note: 'callout',
});

/** 上游块的默认类型：认不出的块类型当正文处理，而不是丢掉（丢内容比错类型严重）。 */
const DEFAULT_BLOCK_TYPE = 'paragraph';

/** 把讲义里的块类型（可能是 wire、中文名或对象）折算成 wire 名。 */
function blockWire(kind) {
  if (!kind) return null;
  if (typeof kind === 'string') return kind;
  if (typeof kind === 'object' && typeof kind.wire === 'string') return kind.wire;
  return null;
}

/** 讲义块 → 纯文本。例题用 stem + solution（与 `agent-text.js` 的 `blockText` 同口径）。 */
export function lectureBlockText(block) {
  if (!block || typeof block !== 'object') return '';
  const wire = blockWire(block.kind);
  if (wire === 'example') {
    return [block.stem, block.solution]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter((part) => part !== '')
      .join('\n\n');
  }
  const raw = block.text ?? block.displayText ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

/** 讲义块 → schema v1 块类型。 */
export function lectureBlockType(block) {
  const wire = blockWire(block?.kind);
  return LECTURE_BLOCK_TYPE_MAP[wire] ?? DEFAULT_BLOCK_TYPE;
}

/**
 * 由课程与节次派生稳定的 resourceId。
 *
 * 用 `sha256` 前 16 位而不是把 id 拼进去：`courseId` 可能是很长的编码，
 * 拼出来的 id 会超 `maxLength: 200`，而且带 `/`、空格之类需要转义的字符。
 * 同一对 (courseId, subId) 必须永远得到同一个 resourceId —— 它是账号库里的外键。
 */
export function resourceIdFor({ courseId, subId = null } = {}) {
  const digest = hashOf({ kind: 'learning-resource', courseId: courseId ?? null, subId: subId ?? null });
  return `res_${digest.slice('sha256:'.length, 'sha256:'.length + 16)}`;
}

/** 页码：只接受非负整数，其它一律 null（不兜底成 0）。 */
function pageOf(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/** 毫秒时间：只接受非负有限数，其它一律 null。 */
function msOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * 从 topic 的 anchor（`{page, tSec}`）与 sourceBlockIndexes 派生出时间/页码信息。
 *
 * `topic.anchor.tSec` 是**秒**，而 schema 的 timeRange 是**毫秒**；这里转一次，
 * 并且只给一个「瞬时点」（startMs === endMs）—— 知识点没有确定的结束时刻，
 * 编一个 endMs 会让 UI 高亮一段本不属于它的录像。
 */
function timeRangeOf(options = {}, fallbackMs = null) {
  const startMs = msOf(options.startMs) ?? msOf(fallbackMs);
  if (startMs === null) return null;
  const endMs = msOf(options.endMs) ?? startMs;
  return { startMs, endMs: Math.max(startMs, endMs) };
}

/**
 * 讲义 → 标准学习资源。
 *
 * @param input.lecture      core-lecture 的成稿讲义（`{title, chapters:[{no,title,topics:[...]}]}`）
 * @param input.courseId     课程 id（必填，派生 resourceId 用）
 * @param input.subId        节次 id（可空：整门课的资源）
 * @param input.accountScope `{accountId, workspaceId}`（必填 accountId）
 * @param input.resourceId   覆盖派生出来的 id（迁移/回放历史资源时用）
 * @param input.reviewStatus draft | reviewed | approved
 * @param input.generatedAt  生成时刻；缺省由 `stamp()` 补当前时刻
 * @param input.warnings     额外告警（讲义流水线自己的告警会以 LECTURE_WARNING 前缀并入）
 * @returns 未签章的标准学习资源（`revision`/`contentHash` 由 `stamp()` 补）
 */
export function fromLecture(input = {}) {
  const lecture = input.lecture ?? {};
  const courseId = String(input.courseId ?? '');
  const subId = input.subId === undefined || input.subId === null ? null : String(input.subId);
  const warnings = [];
  /** @type {Array<object>} */
  const sourceAnchors = [];
  /** @type {Array<object>} */
  const chapters = [];

  const rawChapters = Array.isArray(lecture.chapters) ? lecture.chapters : [];
  for (let ci = 0; ci < rawChapters.length; ci++) {
    const rawChapter = rawChapters[ci] ?? {};
    const chapterId = `ch${ci + 1}`;
    /** @type {Array<object>} */
    const topics = [];
    const rawTopics = Array.isArray(rawChapter.topics) ? rawChapter.topics : [];
    for (let ti = 0; ti < rawTopics.length; ti++) {
      const rawTopic = rawTopics[ti] ?? {};
      const topicId = `t${ci + 1}-${ti + 1}`;
      const rawBlocks = Array.isArray(rawTopic.blocks) && rawTopic.blocks.length > 0
        ? rawTopic.blocks
        : Array.isArray(rawTopic.passages)
          // 旧讲义只有 passages（填充失败时逐字等于 draft）：它仍然是正文，
          // 丢掉会让「讲义生成失败」变成「这个知识点是空的」——两者后果完全不同。
          ? rawTopic.passages.map((passage) => ({ kind: 'elaboration', text: passage?.text ?? '' }))
          : [];
      /** @type {Array<object>} */
      const blocks = [];
      for (let bi = 0; bi < rawBlocks.length; bi++) {
        const rawBlock = rawBlocks[bi] ?? {};
        const blockId = `b${ci + 1}-${ti + 1}-${bi + 1}`;
        const text = lectureBlockText(rawBlock);
        if (text === '') {
          // 空块不投影：schema 允许 text 为空，但空块进了 bundle 只会让上游
          // 生成一堆「这段话没内容」的困惑。记为告警，不静默。
          warnings.push({
            code: 'EMPTY_BLOCK',
            message: `知识点 ${topicId} 的第 ${bi + 1} 块正文为空，已跳过`,
            anchorId: null,
          });
          continue;
        }
        const anchorId = `a${ci + 1}-${ti + 1}-${bi + 1}`;
        const page = pageOf(rawBlock.page) ?? pageOf(rawTopic.anchor?.page) ?? pageOf(rawTopic.fromPage);
        const startMs = msOf(rawBlock.startMs)
          ?? msOf(rawTopic.anchor?.startMs)
          ?? (Number.isFinite(rawTopic.anchor?.tSec) ? Math.round(rawTopic.anchor.tSec * 1000) : null);
        sourceAnchors.push({
          anchorId,
          topicId,
          blockId,
          page,
          timeRange: timeRangeOf(rawBlock, startMs),
          assetRef: null,
          confidence: null,
          origin: 'transcript',
        });
        const entry = {
          id: blockId,
          type: lectureBlockType(rawBlock),
          text,
          assetRef: null,
          anchorIds: [anchorId],
          meta: {
            // 保留讲义原类型与标题：上游要按语义挑块（例如只挑「例题」做成练习），
            // 而 schema 的八值闭集是把语义压平之后的形状，两者都要在。
            lectureKind: blockWire(rawBlock.kind) ?? null,
            title: typeof rawBlock.title === 'string' ? rawBlock.title : '',
            sourceBlockIndexes: Array.isArray(rawBlock.sourceBlockIndexes)
              ? [...rawBlock.sourceBlockIndexes]
              : Array.isArray(rawTopic.sourceBlockIndexes) ? [...rawTopic.sourceBlockIndexes] : [],
          },
        };
        blocks.push(entry);
      }
      topics.push({
        id: topicId,
        title: typeof rawTopic.title === 'string' ? rawTopic.title : '',
        blocks,
      });
    }
    chapters.push({
      id: chapterId,
      title: typeof rawChapter.title === 'string' ? rawChapter.title : '',
      topics,
    });
  }

  for (const message of Array.isArray(lecture.warnings) ? lecture.warnings : []) {
    if (typeof message === 'string' && message !== '') {
      warnings.push({ code: 'LECTURE_WARNING', message, anchorId: null });
    }
  }

  const bundle = {
    schemaVersion: 1,
    resourceId: input.resourceId ?? resourceIdFor({ courseId, subId }),
    accountScope: {
      accountId: String(input.accountScope?.accountId ?? ''),
      workspaceId: input.accountScope?.workspaceId ?? null,
    },
    courseId,
    subId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    title: String(input.title ?? lecture.title ?? '').trim() || `课程 ${courseId || '（未命名）'}`,
    language: String(input.language ?? 'zh'),
    contentType: String(input.contentType ?? 'lecture-v4'),
    chapters,
    selectedTopicIds: Array.isArray(input.selectedTopicIds) ? [...input.selectedTopicIds] : [],
    selectedRanges: Array.isArray(input.selectedRanges) ? input.selectedRanges.map((row) => ({ ...row })) : [],
    sourceAnchors,
    warnings: [...warnings, ...(Array.isArray(input.warnings) ? input.warnings : [])],
    sourceConfidence: typeof input.sourceConfidence === 'number' ? input.sourceConfidence : null,
    reviewStatus: input.reviewStatus ?? 'draft',
  };
  // `selectedTopicIds` / `selectedRanges` 为空即全量，照抄 schema 的语义；
  // 但空数组仍然要写出来 —— 缺字段与「空数组」在契约里是同一件事，
  // 显式写出来读代码的人不用去翻 schema 才知道「没选 = 全量」。
  return bundle;
}

/**
 * 把一份 bundle 的「身份标签」抽出来（日志 / 账本 / UI 列表用）。
 *
 * 单独一个函数是因为这五个字段在宿主侧到处要用，而它们必须来自**同一处取值规则**
 * （`subId` 的 null 与字符串 "" 不能一处当空、一处当有值）。
 */
export function describeResource(bundle) {
  if (!bundle || typeof bundle !== 'object') return null;
  return {
    resourceId: bundle.resourceId ?? null,
    revision: bundle.revision ?? null,
    courseId: bundle.courseId ?? null,
    subId: bundle.subId ?? null,
    title: bundle.title ?? '',
    chapterCount: Array.isArray(bundle.chapters) ? bundle.chapters.length : 0,
    topicCount: Array.isArray(bundle.chapters)
      ? bundle.chapters.reduce((sum, chapter) => sum + (Array.isArray(chapter?.topics) ? chapter.topics.length : 0), 0)
      : 0,
    blockCount: Array.isArray(bundle.chapters)
      ? bundle.chapters.reduce((sum, chapter) => sum + (Array.isArray(chapter?.topics)
        ? chapter.topics.reduce((inner, topic) => inner + (Array.isArray(topic?.blocks) ? topic.blocks.length : 0), 0)
        : 0), 0)
      : 0,
    anchorCount: Array.isArray(bundle.sourceAnchors) ? bundle.sourceAnchors.length : 0,
    reviewStatus: bundle.reviewStatus ?? null,
  };
}
