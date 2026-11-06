import { templates, formatMs } from './core.js';
import { correctionPrompt } from './correction-policy.js';
import { SEMANTIC_PLAN_PROMPT } from './semantic-plan.js';
export function faithfulRequest(context, page) {
  return { constant: templates.faithful, variable: `这张图来自课件：${context}\n这是第 ${page} 页。\n\n请**只根据这张图本身**完成上面要求的完整转述。\n图片之外的信息（老师说了什么、前后页讲了什么）一律**不在你手上**，也不许推测。` };
}
export function mixRequest({ page, lines, fromMs, toMs, faithfulText = '', terms = [], context = 'context' }) {
  const v = [`这张图来自课件：${context}`];
  if (page != null) v.push(`这是第 ${page} 页。`);
  if (fromMs != null) v.push(`这一页对应老师从 ${formatMs(fromMs)}${toMs == null ? '' : ` 到 ${formatMs(toMs)}`} 的讲解。`);
  if (faithfulText.trim()) v.push('', '──────────────────────────────────────────────', '【这一页的如实转述稿（图上写了什么，逐字抄录 —— "正确写法"的唯一来源）】', faithfulText.trim());
  if (terms.length) v.push('', '──────────────────────────────────────────────', '【术语表（这一页图上抄下的专名。只许用表里的写法改正对应的错字；不许改句子、不许润色、不许把表外的词改成表里的词）】', ...terms.filter(t => t.trim()).map(t => `- ${t.trim()}`));
  v.push('', '──────────────────────────────────────────────', '【老师这段的语音转录（逐条编号；原样，可能有错字）】');
  if (lines.length) v.push(...lines.map((l,i) => `${i+1}. [${formatMs(l.startMs)}]${l.text}`));
  else v.push('（这段没有语音转录：翻页太快，或这一段是静音）');
  return { constant: correctionPrompt(templates.mix), variable: v.join('\n') };
}

export function legacyTranscriptMixRequest({ lines, fromMs, toMs, context }) {
  const input = mixRequest({ lines, fromMs, toMs, context });
  input.constant = `你是一个"逐块语音稿清洗器"。输入为连续时间段的语音转录，没有课件或图片依据。
逐句检查明显错别字与确定的同音误听；不能从常识猜测具体人名、日期、数值、公式。无充分依据的词保留原文，并在「## 识别可能有误」记录，不得虚构已核实的课件写法。
清洗保持句号编号一一对应，不改句序、句式和口语，不摘要、不扩写。只列有把握的修改；未列条目保持原文。正式语言由后续merge组织。
按语义划分块，区间必须按顺序、不重叠、完整覆盖输入1..总句数；课程事务与学科讲授分开分块。时间段是请求边界，不是知识点边界。
输出「## 逐块标注」：修改用“N. 正文：修改后的整句”，分块用“块 起-止”，可附“衔接：有转录依据的上下文”。无修改也必须输出完整块区间。不要描述不存在的图片或补写无依据内容。
另输出「## 识别可能有误」记录具体不确定项（没有则省略）。`;
  input.variable = `【依据类型】仅语音转录，无课件。\n${input.variable}`;
  return input;
}
export function transcriptMixRequest(input) {
  const request = legacyTranscriptMixRequest(input);
  request.constant = `你是一个"逐块语音稿清洗器"。输入是连续时间段的语音转录，没有图片或课件依据。
检查明显错别字和确定的同音误听；人名、日期、数值和公式无充分依据时保留原词，不据常识猜测。逐句编号一一对应，不改句序、句式和口语，不总结扩写。只列确定修改；未列条目原样保留。正式语言由后续merge组织。
输出「## 逐块标注」时，只写有修改的“N. 正文：修改后的整句”，不要抄回未改内容。另在「## 识别可能有误」记录具体疑点，无则省略。
同一次请求必须输出「## 块标记」JSON，块边界与标记使用同一条记录：{"tags":[{"index":1,"from":1,"to":10,"role":"主线","facets":["概念"],"summary":"本块具体内容概述"}]}。
index从1起依次编号，from/to为输入句号而非时间或页号；区间按原顺序、不重叠、恰好覆盖1..总句数。不要再另写“块 起-止”这份重复的边界清单。
role仅主线或支线，纯事务为支线；学科内容和事务分块，不能因为提到当前年份就把学科制度或历史事件当成教学安排。summary只写具体语义，不要泛称本段内容。JSON字符串合法转义。
词表由后续同一请求的说明给出。`;
  return request;
}

export function renderBlock(block) {
  let head = `### 块 ${block.index}`;
  if (block.page != null) head += `（第 ${block.page} 页`;
  if (block.startMs != null) head += `${head.endsWith('页') ? '｜' : '（'}老师时间 ${formatMs(block.startMs)}${block.endMs == null ? '' : `–${formatMs(block.endMs)}`}`;
  if (block.page != null || block.startMs != null) head += '）';
  const lines = [head]; if (block.bridge.trim()) lines.push(`（这一块已补写的衔接：${block.bridge.trim()}）`);
  lines.push(block.sentences.map(s => s.text).join('\n').trim()); return lines;
}
export function chunkBlocks(blocks, size = 24, maxChars = 50000) {
  const chunks = []; let chunk = [], chars = 0;
  for (const block of blocks) {
    const n = renderBlock(block).join('\n').length;
    if (chunk.length && (chunk.length >= size || chars + n > maxChars)) { chunks.push(chunk); chunk = []; chars = 0; }
    chunk.push(block); chars += n;
  }
  if (chunk.length) chunks.push(chunk); return chunks;
}
export function tagRequest(blocks, vocabulary, context, total) {
  return { constant: templates.chunk.replace('@@VOCAB@@', vocabulary.map(t => t.name).join('、')),
    variable: [`【这节课的课件】${context}`, `（整节课共 ${total} 块；这里是其中 ${blocks.length} 块。）`, `【这一卷的块（共 ${blocks.length} 块）】`, ...blocks.flatMap(b => ['', ...renderBlock(b)])].join('\n') };
}
export function outlineRequest(blocks, context) {
  return { constant: templates.outline.slice(0, templates.outline.indexOf('【输出格式】')) + '\n\n' + SEMANTIC_PLAN_PROMPT + '\n【唯一输出格式】只输出一个合法JSON对象：{"spine":"整节主线","outline":[{"title":"主线分段","from":1,"to":5}],"knowledge":[{"title":"章名","topics":[{"title":"知识点名","from":1,"to":5}]}]}。三个字段缺一不可。' , variable: [`【这节课】${context}`, `【每块的概述（共 ${blocks.length} 块，按时间顺序）】`, ...blocks.map(b => `${b.index}. [${b.tag.role} ${(b.tag.facets ?? []).join('/')}] ${b.tag.summary?.trim() || '（这一块没有概述）'}`)].join('\n') };
}
