import { ParserError } from './errors.js';

/**
 * 知识点粒度的下界与章宽上界。
 *
 * 为什么需要硬下界：整节梳理的模型倾向"一段一个标题"——实测一节 128 个主线块
 * 被切成 41 个知识点（平均 3 块 / 500 字），"读书无用论"一章被拆成 6 个平行
 * 标题（背景、抗战、改革开放、辨析、就业压力、理性看待）。那样建出来的树只剩
 * 一层同级标题，读者看不到主题归属。
 *
 * 阈值不是审美偏好：3 块以下、450 字以下的内容装不满一个知识点该有的展开；
 * 一章超过 6 个点说明章本身没收住，应该先在章内归并。
 */
export const kTopicMinBlocks = 4;
export const kTopicMinChars = 600;
export const kChapterMaxTopics = 6;
/** 整节主线块少于这个数就不做粒度体检：短课本来就没几个点，判不出"碎"。 */
export const kPlanCheckMinBlocks = 8;

export const SEMANTIC_PLAN_PROMPT = `同一次整节梳理还要返回 knowledge 数组：[{"title":"章标题","topics":[{"title":"简短知识点名","from":起始块号,"to":结束块号}]}]。
knowledge 用于实际建树，不能按页数、字数或固定数量机械分组。同一概念的定义、推导和应用放在相同知识点下，跨页延续仍属于同一点；出现新定义或新问题时再分点。例题必须与题设和解答一起保留，不把下一主题并入前一标题。
【知识点粒度】知识点是"一个主题单元"，不是一段话、一张幻灯片。同一主题的展开——背景、表现、原因、辨析、评价、结论——必须收在同一个知识点里，用正文分段表达层次，不要拆成多个平行知识点。
每个知识点至少覆盖 ${kTopicMinBlocks} 个主线块或约 ${kTopicMinChars} 字正文；只有出现新的定义、新的对象或新的问题才开新点。每章知识点不超过 ${kChapterMaxTopics} 个；某章内容确实横跨多个主题时，先按主题归并成更少的点，再给章起名，不要用一串平行小标题代替层次。
from/to 是原始块号而不是页号；知识点区间严格递增且互不重叠，覆盖全部主线学科块，支线和教学安排可略过。章与知识点标题用简短名词短语，不能复制整句摘要。原有 spine 和 outline 字段仍照常返回。`;

export function parseSemanticPlan(raw, mainBlocks, lastBlockIndex = Math.max(0, ...mainBlocks.map(b => b.index))) {
  const s = String(raw);
  let root;
  try { root = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); } catch { return null; }
  if (root.knowledge === undefined) return null; // Legacy hosts remain readable.
  const fail = message => { throw new ParserError('SEMANTIC_PLAN', message); };
  if (!Array.isArray(root.knowledge) || !root.knowledge.length) fail('语义知识树缺少章');
  const chapters = []; let lastTo = 0;
  for (const chapter of root.knowledge) {
    if (typeof chapter?.title !== 'string' || !chapter.title.trim() || !Array.isArray(chapter.topics) || !chapter.topics.length) fail('语义章标题或知识点无效');
    const topics = [];
    for (const topic of chapter.topics) {
      if (typeof topic?.title !== 'string' || !topic.title.trim() || !Number.isInteger(topic.from) || !Number.isInteger(topic.to)
        || topic.from <= lastTo || topic.to < topic.from || topic.to > lastBlockIndex) fail('语义知识点区间越界、重叠或逆序');
      // A proposed section may contain only excluded side/meta blocks. It has
      // no handout content; drop the empty projection without another API call.
      if (mainBlocks.some(b => b.index >= topic.from && b.index <= topic.to)) {
        topics.push({title: topic.title.trim(), from: topic.from, to: topic.to});
      }
      lastTo = topic.to;
    }
    if (topics.length) chapters.push({title: chapter.title.trim(), topics});
  }
  const topics = chapters.flatMap(c => c.topics);
  const missing = mainBlocks.filter(b => !topics.some(t => t.from <= b.index && b.index <= t.to));
  if (missing.length) fail(`语义知识点未覆盖来源块：${missing.map(b => b.index).join(',')}`);
  return chapters;
}

export function topicOfBlock(plan, index) {
  for (const [ci, chapter] of plan.entries()) for (const [ti, topic] of chapter.topics.entries()) {
    if (topic.from <= index && index <= topic.to) return { ...topic, chapter: chapter.title, key: `${ci}:${ti}` };
  }
  return null;
}

/** 分组发生在正式语言之前，块上还没有 text。字数按字幕计，没有字幕时才用 text。 */
function sourceChars(block) {
  const spoken = (block?.sentences ?? []).reduce((n, s) => n + String(s?.text ?? '').length, 0);
  return spoken || String(block?.text ?? '').length;
}
/** 每个知识点实际吃了多少块、多少字（按来源块正文统计，不看标题）。 */
export function planSizes(plan, blocks) {
  const byIndex = new Map(blocks.map(b => [b.index, b]));
  return plan.flatMap(chapter => chapter.topics.map(topic => {
    const owned = [];
    for (let i = topic.from; i <= topic.to; i += 1) if (byIndex.has(i)) owned.push(byIndex.get(i));
    return {
      chapter: chapter.title, title: topic.title, from: topic.from, to: topic.to,
      blocks: owned.length,
      chars: owned.reduce((n, b) => n + sourceChars(b), 0),
    };
  }));
}

/**
 * 粒度体检：返回具体哪一条不合规，好让修复请求点名，而不是笼统说"太碎"。
 *
 * 只报告，不改树。是否修复、修复几次由调用方决定（解析器只修一次，
 * 修不好就如实留在 warnings 里，不静默接受也不无限重试）。
 */
export function findPlanIssues(plan, blocks, limits = null) {
  const blockCount = blocks.length;
  const { minBlocks, minChars, maxTopicsPerChapter } = limits ?? planThresholds(blockCount) ?? {};
  if (blockCount < kPlanCheckMinBlocks) return [];
  const issues = [];
  for (const [ci, chapter] of plan.entries()) {
    if (chapter.topics.length > maxTopicsPerChapter) {
      issues.push({ code: 'CHAPTER_TOO_WIDE', chapter: chapter.title, topicCount: chapter.topics.length,
        limit: maxTopicsPerChapter,
        message: `第 ${ci + 1} 章「${chapter.title}」有 ${chapter.topics.length} 个知识点，超过 ${maxTopicsPerChapter} 个上限` });
    }
  }
  for (const size of planSizes(plan, blocks)) {
    if (size.blocks >= minBlocks || size.chars >= minChars) continue;
    issues.push({ code: 'TOPIC_TOO_SMALL', chapter: size.chapter, title: size.title,
      from: size.from, to: size.to, blocks: size.blocks, chars: size.chars,
      message: `「${size.chapter} · ${size.title}」（块 ${size.from}–${size.to}）只有 ${size.blocks} 块 / ${size.chars} 字` });
  }
  return issues;
}

/** 粒度下限随整节规模走：短节 3 块/400 字，长节 4 块/600 字。 */
export function planThresholds(blockCount) {
  if (blockCount < kPlanCheckMinBlocks) return null;
  return blockCount >= 80 ? { minBlocks: 4, minChars: 600, maxTopicsPerChapter: 6 }
    : { minBlocks: 3, minChars: 400, maxTopicsPerChapter: 8 };
}

/** 把体检结果写成给模型的修复说明（点名到章、点、块号，便于它只改分组）。 */
export function describePlanIssues(issues) {
  if (!issues.length) return '';
  const small = issues.filter(i => i.code === 'TOPIC_TOO_SMALL');
  const wide = issues.filter(i => i.code === 'CHAPTER_TOO_WIDE');
  const lines = [];
  if (small.length) lines.push(`知识点过碎（每个至少 ${kTopicMinBlocks} 块或 ${kTopicMinChars} 字）：${small.map(i => i.message).join('；')}。请把它们并入同一主题的相邻知识点，用正文分段表达层次，不要保留成平行小标题。`);
  if (wide.length) lines.push(`章内知识点过多：${wide.map(i => i.message).join('；')}。请在章内按主题归并。`);
  return lines.join('\n');
}
