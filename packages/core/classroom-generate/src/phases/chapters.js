import { cancelled, ClassroomGenerateError, describeError } from '../errors.js';
import { produceOutline } from './outline.js';
import { produceScenes } from './scenes.js';

/** Bounded chapter workers; completed chapters are the durable retry unit. */
export async function produceChapters({ record, ports, llm, checkpoint, emit }) {
  const { brief, stageId, runId } = record;
  const signal = record.controller.signal;
  const chapters = brief.chapters;
  let next = 0;
  const failures = [];
  const check = () => { if (signal.aborted) throw cancelled('chapters', runId); };
  const worker = async () => {
    while (next < chapters.length) {
      check();
      const index = next++;
      const chapter = chapters[index];
      const key = `chapter-${index + 1}`;
      if (record.outputs.has(key)) continue;
      const chapterBrief = { ...brief, chapters: undefined, scenes: undefined, topic: chapter.title,
        requirement: `仅讲解第 ${index + 1}/${chapters.length} 章「${chapter.title}」，忠实覆盖本章讲义全部知识点；不要重复生成其他章节。`,
        description: `整课主题：${brief.topic}。本任务只生成当前章，按本章知识树组织讲解。`,
        goals: [],
        sourceText: chapter.sourceText, knowledgeTree: chapter.knowledgeTree ?? brief.knowledgeTree, strictChapter: true };
      const chapterEmit = (phase, kind, payload, sceneId) => {
        if (!signal.aborted) emit(phase, kind, { ...payload, chapterId: chapter.id, chapterIndex: index }, sceneId);
      };
      try {
        chapterEmit('outline', 'phase-progress', { step: 'chapter-start', title: chapter.title });
        const outline = await produceOutline({ brief: chapterBrief, llm, agent: ports.agent, emit: chapterEmit, signal });
        check();
        const scenes = await produceScenes({ outlines: outline.outlines, brief: chapterBrief, llm,
          pbl: ports.pbl, stageId, emit: chapterEmit, signal, now: ports.now });
        check();
        if (scenes.skipped.length || scenes.scenes.length !== outline.outlines.length) {
          throw new Error(scenes.skipped[0]?.message || '章节场景未完整生成');
        }
        const output = { chapterId: chapter.id, chapterIndex: index, outline, scenes };
        check();
        await checkpoint(key, output);
        check();
        record.outputs.set(key, output);
        chapterEmit('scenes', 'phase-progress', { step: 'chapter-done', scenes: scenes.scenes.length });
      } catch (error) {
        check();
        failures.push({ chapterId: chapter.id, chapterIndex: index, title: chapter.title, ...describeError(error) });
        chapterEmit('scenes', 'phase-progress', { step: 'chapter-failed', message: describeError(error).message });
      }
    }
  };
  // 并发只受章节数约束，不设人为上限（理由见 brief.js 的 chapterConcurrencyOf）。
  const concurrency = Math.max(1, Math.floor(Number(brief.chapterConcurrency) || 3));
  await Promise.all(Array.from({ length: Math.min(concurrency, chapters.length) }, worker));
  check();
  if (failures.length) throw new ClassroomGenerateError('E_CHAPTER_FAILED',
    `章节生成失败：${failures.map((f) => `${f.title}（${f.message}）`).join('；')}`, { failures });
  const outlines = [], scenes = [];
  for (let index = 0; index < chapters.length; index++) {
    const output = record.outputs.get(`chapter-${index + 1}`);
    output.outline.outlines.forEach((outline, local) => {
      const order = outlines.length + 1;
      const chapterId = chapters[index].id;
      outlines.push({ ...outline, id: `outline-${order}`, order, chapterId });
      const scene = output.scenes.scenes[local];
      scenes.push({ ...scene, id: `scene-${order}`, outlineId: `outline-${order}`, order, chapterId,
        actions: (scene.actions ?? []).map((action, actionIndex) => ({ ...action, id: `scene-${order}-action-${actionIndex + 1}` })),
        content: scene.content?.canvas ? { ...scene.content, canvas: { ...scene.content.canvas, id: `canvas-${order}` } } : scene.content,
      });
    });
  }
  record.readyScenes = scenes.length;
  return { outline: { outlines, source: 'chapters', courseTitle: brief.topic, languageDirective: brief.languageDirective ?? '' },
    scenes: { scenes, skipped: [] } };
}
