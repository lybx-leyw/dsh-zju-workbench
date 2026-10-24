import { ParserError } from './errors.js';

export const ORGANIZE_PROMPT = `你是大学讲义正文编辑，正在执行建树阶段的merge（正式语言组织），不是生成摘要。
产物为可以直接进入教材的正文，使用规范陈述句组织对象、定义、条件、推导、例题和结论。清洗稿只是忠实转录，不是合格讲义；仅修正标点或删除语气词不算完成正式语言组织。
把课堂提问、面向听众的叙述和逐句讲解改为直接论述。例如“那么我们怎么比较这两个长度呢？大家要先统一单位对吧”，应组织为“比较两个长度前，应先将测量结果换算为相同单位，再比较数值。”示例只说明书面组织方式，不得借用其中事实到输入正文。
保留来源中每个知识结论、推导步骤、条件和例题题设及解答，不压缩为概述。对重复语义合并表达，课堂休息、签到等事务不作为学科结论；若与知识内容混在同块，正文只组织知识部分，事务来源仍由原始转录保留。
slides是可选课件依据。没有slides表示仅有语音转录，不得假称课件已经核实，也不能据常识猜测具体人名、日期、数值和公式。专名或关键关系无法确认时明确保留具体待核实项，不能把含混转录写成确定事实。
核对符号定义、适用条件、单位及每一步推导：等式与上界必须区分，中间量的变化与代入后的总量不是同一个数学量。仅凭前后明确公式可唯一确定的代数错误允许纠正；不能只保留正确的结论而继续写矛盾的中间步骤。不同例题的同形符号不得混同；无充分依据时明确指出矛盾，不能任取一种解释。
每个输入块单独返回：块内可以重组，不能把一块的知识挪到另一块而丢失或重复来源。输入编号完整保留，每个编号恰好一次。
仅返回合法JSON：{"blocks":[{"index":输入块号,"text":"完整正式正文"}]}。公式采用美元定界符，JSON中的反斜杠必须双写。`;

function organizedEntries(raw) {
  let parsed;
  try { const s = String(raw).trim().replace(/^```(?:json)?\s*|\s*```$/g, ''); parsed = JSON.parse(s); }
  catch { throw new ParserError('MERGE_FORMAT', '正式语言组织未返回有效JSON'); }
  return Array.isArray(parsed?.blocks) ? parsed.blocks : [];
}
/** 编号不齐时保留已经写好的块。重复编号或空正文不算写好。 */
export function collectOrganized(raw, blocks) {
  const wanted = new Set(blocks.map(b => b.index));
  const kept = new Map(); const duplicated = new Set();
  for (const item of organizedEntries(raw)) {
    const index = item?.index;
    if (!wanted.has(index) || typeof item.text !== 'string' || !item.text.trim()) continue;
    if (kept.has(index)) { kept.delete(index); duplicated.add(index); continue; }
    if (!duplicated.has(index)) kept.set(index, item.text.trim());
  }
  return { kept, missing: blocks.map(b => b.index).filter(index => !kept.has(index)) };
}
export function parseOrganized(raw, blocks) {
  const { kept, missing } = collectOrganized(raw, blocks);
  if (missing.length) throw new ParserError('MERGE_COVERAGE', '正式语言组织的来源块缺失、重复或正文为空');
  return kept;
}

export async function organizeLeaf(leaf, { llm, route, cache, limiter, pages, signal, events, onProgress = () => {} }) {
  const source = [...new Map([...(leaf.blocks ?? []), ...(leaf.attach ?? []).map(a => a.block)].map(b => [b.index, b])).values()];
  const chunks = []; let chunk = [], chars = 0;
  for (const block of source) {
    const text = (block.sentences ?? []).map(s => s.text ?? '').join('');
    if (chunk.length && (chunk.length >= 8 || chars + text.length > 6500)) { chunks.push(chunk); chunk = []; chars = 0; }
    chunk.push({ index: block.index, text, summary: block.tag?.summary ?? '', page:block.page ?? null,
      evidenceKind:block.evidenceKind ?? 'legacy', ...(block.correctionIssues?.length?{rejectedCorrections:block.correctionIssues}:{} ) }); chars += text.length;
  }
  if (chunk.length) chunks.push(chunk);
  const failures = [];
  for (const group of chunks) {
    signal?.throwIfAborted();
    const pageNumbers = new Set(source.filter(b => group.some(g => g.index === b.index)).map(b => b.page));
    const slides = pages.filter(p => [...pageNumbers].some(n => Number.isFinite(n) && Math.abs(n - p.page) <= 1))
      .map(p => ({ page: p.page, text: p.transcription?.pageText ?? '' }));
    const variable = JSON.stringify({ topic: leaf.semanticTitle ?? '', slides, blocks: group });
    for (const input of group) {
      const block = source.find(b => b.index === input.index);
      block.slideEvidence = Number.isFinite(block.page) && block.evidenceKind !== 'transcript-only'
        ? slides.filter(p => Math.abs(p.page - block.page) <= 1) : [];
    }
    const key = cache.key('merge-written-v1', [route, ORGANIZE_PROMPT, variable]);
    const adopt = raw => {
      try { return { output: parseOrganized(raw, group), missing: [] }; }
      catch (error) {
        if (error.code !== 'MERGE_COVERAGE') throw error;
        const partial = collectOrganized(raw, group);
        if (!partial.kept.size) throw error;
        return { output: partial.kept, missing: partial.missing };
      }
    };
    try {
      const saved = await cache.get(key); let raw = saved?.raw; let parsed; let cached = false;
      if (raw) { try { parsed = adopt(raw); } catch { raw = null; } }
      if (!parsed) {
        const response = await limiter.run(() => llm.call({ stage: 'merge', route, constant: ORGANIZE_PROMPT, variable, signal }), signal);
        events.push({ stage: 'merge', cached: false, usage: response.usage ?? null });
        raw = response.text;
        try { parsed = adopt(raw); }
        catch (error) {
          if (!['MERGE_FORMAT', 'MERGE_COVERAGE'].includes(error.code)) throw error;
          const repair = await limiter.run(() => llm.call({ stage: 'merge', route, constant: ORGANIZE_PROMPT,
            variable: `${variable}\n\n上次回包未通过${error.code}。仅修复输出协议，完整返回这些编号：${group.map(b => b.index).join(',')}。公式使用美元定界符；JSON字符串内每个反斜杠必须写成两个反斜杠，不可出现非法转义。\n上次回包：\n${raw}`, signal }), signal);
          events.push({ stage: 'merge', cached: false, retry: 1, usage: repair.usage ?? null });
          raw = repair.text; parsed = adopt(raw);
        }
        await cache.put(key, raw);
      } else { cached = true; events.push({ stage: 'merge', cached: true }); }
      for (const input of group) {
        const block = source.find(b => b.index === input.index);
        block.sourceText = input.text;
        const text = parsed.output.get(input.index);
        if (text) { block.text = text; block.register = 'written'; }
        else { block.text = undefined; block.register = 'draft'; }
      }
      if (parsed.missing.length) failures.push({ stage: 'merge', page: leaf.page, blockIndexes: parsed.missing, code: 'MERGE_COVERAGE' });
      onProgress({ leaf: leaf.id, blockIndexes: group.map(b => b.index), before: group.map(b => b.text).join('\n\n'),
        after: group.map(b => parsed.output.get(b.index) ?? '').join('\n\n'), cached });
    } catch (error) {
      if (signal?.aborted || error.code === 'CANCELLED') throw error;
      for (const input of group) {
        const block = source.find(b => b.index === input.index);
        block.text = undefined; block.register = 'draft';
      }
      failures.push({ stage: 'merge', page: leaf.page, blockIndexes: group.map(b => b.index), code: error.code ?? 'MERGE_FAILED' });
    }
  }
  return failures;
}
