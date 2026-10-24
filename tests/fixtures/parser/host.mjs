import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from '../../../scripts/profile.mjs';
import * as parserPlugin from '../../../packages/dsh-zhiyun-core-parser/src/index.js';

// A deterministic adapter inside the actual DSH runtime; never a provider HTTP client.
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4//8/AAX+Av5Y8msOAAAAAElFTkSuQmCC', 'base64');
export const lesson = () => ({ sourceId: 'fixture:lesson', context: 'context',
  slides: [{ page: 1, createdSec: 1, imageBytes: png, mediaType: 'image/png' }],
  subtitles: [{ startMs: 1234, endMs: 2000, text: '旧事史' }, { startMs: 2200, endMs: 3100, text: '概率密度函数' }] });
export function answer(options) {
  const constant = options.messages[0].content[0].text;
  const variable = options.messages[0].content[1].text;
  // ⚠️ 判据要用**模板里的真实首句**（「整页课件转写器」）。
  //    这里曾经写的是「完整转述」，而模板里根本没有这四个字 —— 于是 vision
  //    一直掉进最后的兜底分支、返回一段 outline JSON，被解析成"空转述"。
  //    旧代码对空转述很宽容（只记 partial），所以这个桩的错一直没暴露；
  //    现在识别阶段全败会抛 VISION_ALL_FAILED，它才浮出来。
  //    两个词都认：老模板用「完整转述」，现在的模板用「整页课件转写器」。
  if ((constant.includes('整页课件转写器') || constant.includes('完整转述'))
      && options.messages[0].content.some(b => b.type === 'image')) {
    return '## 页面文字\n旧四史，概率密度函数\n## 页面画面\n一张曲线图\n## 术语\n旧四史\n概率密度函数';
  }
  if (constant.includes('逐块语音稿清洗器')) {
    /* mix 回包的块范围要**与这一页的句子数一致**。
     *
     * 这里曾经固定写死 `块 1-2`：fixture 的 `lesson()` 恰好 2 句时看不出来，
     * 换成"每页 1 句"的多页样例就全是"块覆盖失败 → 回退整页一块"，
     * 于是 status 永远是 partial。块边界是产品会**逐句核对**的硬约束，
     * 桩必须跟着输入的句子数走。
     *
     * ⚠️ 只数「语音转录」那一节里的编号行：变量里还包含提示词自己的示例
     *    （`1. …` `2. …`），拿整段去数会把示例也算成句子。
     */
    const tail = variable.slice(variable.indexOf('【老师这段的语音转录'));
    const numbered = [...tail.matchAll(/^(\d+)\. \[[^\]]*\]\s*(.*)$/gm)].map((m) => Number(m[1]));
    const sentences = numbered.length || 1;
    /* 回包要**按这一页的句子数**给块边界，并且带 `正文：旧四史`。
     *
     * 两件事都是别的测试依赖的：
     *   · 块边界写死会导致"块覆盖失败 → 回退整页一块"，status 永远到不了 ready；
     *   · `正文：旧四史` 是这个 fixture 的核心用途 —— 验证"把听错的『旧事史』
     *     纠正成『旧四史』"。去掉它，纠错那条链就没有被测到。
     *
     * ⚠️ 只数「语音转录」那一节里的编号行：变量里还包含提示词自己的示例
     *    （`1. …` `2. …`），拿整段去数会把示例也算成句子。
     */
    return `## 逐块标注\n1. 正文：旧四史\n块 1-${sentences}\n\n## 块标记\n${JSON.stringify({ tags: [{ index: 1, role: '主线', facets: ['概念'], summary: '概率密度函数' }] })}`;
  }
  if (constant.includes('建树阶段的merge')) {
    const input = JSON.parse(variable);
    return JSON.stringify({ blocks: input.blocks.map(b => ({ index: b.index, text: b.text })) });
  }
  if (constant.includes('维度标注')) {
    const indices = [...variable.matchAll(/^### 块 (\d+)/gm)].map(m => +m[1]);
    return JSON.stringify({ tags: indices.map(index => ({ index, role: '主线', facets: ['概念'], summary: '概率密度函数' })) });
  }
  const count = +variable.match(/共 (\d+) 块/)?.[1];
  return JSON.stringify({ spine: '概率密度函数的概念', outline: [{ title: '概念', from: 1, to: count }] });
}
export async function mountHost(version, directory, respond = answer, { modalities = ['text', 'image'], parserConfig = {} } = {}) {
  const modules = path.join(root, '.runtime', `dsh-${version}`, 'node_modules', '@deepseek-ai');
  const load = name => import(pathToFileURL(path.join(modules, name, 'lib/index.js')).href);
  const [{ Context }, { default: LlmRuntime, LlmAdapter }, { default: Attachments }] = await Promise.all([load('cordis'), load('dsh-llm'), load('dsh-attachment-local')]);
  const ctx = new Context(), requests = [];
  try {
    await ctx.plugin(LlmRuntime);
    await ctx.plugin(Attachments, { dshHome: directory });
    class Adapter extends LlmAdapter {
      async resolveModel(provider, id) { return { provider, id, name: id, inputModalities: modalities }; }
      async *stream(options) {
        requests.push(options); options.signal?.throwIfAborted();
        const result = await respond(options, requests.length);
        if (result?.chunks) { yield* result.chunks; return; }
        yield { type: 'text-delta', index: 0, text: result };
        yield { type: 'block-end', index: 0, block: { type: 'text', text: result } };
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } };
        yield { type: 'finish', reason: { kind: 'stop' } };
      }
    }
    ctx.llm.registerAdapter(['fixture-provider'], new Adapter());
    ctx.provide('profileContext', { dir: directory });
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture-provider', model: 'fixture-model', reasoningEffort: 'high' }) });
    ctx.provide('zhiyunClassroom', {});
    const fiber = await ctx.plugin(parserPlugin, parserConfig);
    return { ctx, parser: ctx.get('zhiyunParser'), requests, fiber, dispose: () => ctx.fiber.dispose() };
  } catch (error) { await ctx.fiber.dispose(); throw error; }
}
