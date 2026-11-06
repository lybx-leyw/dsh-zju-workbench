// Legacy App codec remains available for old artifacts. v2 below reorganizes
// handout structure while retaining input-unit coverage and final-source refs.
import { parseBlockKind } from './polish.js';
import { judgeWritten, REGISTER } from './register.js';
import { withDerivation } from './derivation.js';

const line = value => String(value ?? '').replace(/[\r\n|]/g, ' ').trim();
const fail = message => Object.assign(new Error(message), { code: 'FORMAT' });
export function blockText(block) {
  const kind = block.kind?.wire ?? block.kind;
  return kind === 'example' ? [block.stem, block.solution].filter(Boolean).join('\n\n') : String(block.text ?? block.displayText ?? '');
}
export function effectiveBlocks(topic) {
  return topic.blocks?.length ? topic.blocks : (topic.passages ?? []).map(p => ({ kind: parseBlockKind(p.label) ?? parseBlockKind('讲解'), text: p.text, title: '' }));
}
/**
 * 终审改了正文之后，成稿状态必须**重新判**。
 *
 * 合回成功只说明文本能对上来源，不等于已经把口述写成书面语：模型可能原样返回，
 * 也可能只是在口述稿上加了个逗号。早先这里直接把每个知识点写成
 * `register: 'written'`，于是课堂称呼（「各位同学」）和说半截的句子被终审
 * 一路放行，阅读界面全部显示成成稿 —— 验收结论被合回这一步悄悄覆盖掉了。
 *
 * `alreadyWritten` 沿用原知识点的判断：输入本来就是成稿时，原样返回是正确行为。
 */
function judgeMergedTopic(original, body) {
  const source = original?.draft ?? (original?.passages ?? []).map(p => p.text).join('\n\n');
  const verdict = withDerivation(judgeWritten({ source, rewritten: body, alreadyWritten: original?.register === REGISTER.written }), body);
  return { register: verdict.register, notes: verdict.notes };
}

function subtitle(raw, kind, body = '') {
  const title = String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/^[，、；：\s]+|[。！？；：，、\s]+$/g, '');
  const norm = s => s.replace(/[\s。！？；：，、]/g, '');
  return !title || [...title].length > 20 || /[。！？]/.test(title) || parseBlockKind(title)?.wire === kind.wire
    || (body && [body, body.split(/[。！？]/)[0]].some(s => norm(s) === norm(title))) ? '' : title;
}
export function exportLectureForAgent(lecture, sectionId) {
  const lines = [`#!section ${line(sectionId)} ${line(lecture.title)}`,
    '#!section #! 与 ##! 开头的行一个字都不许改。',
    '#!section >>> BLOCK 可以补小标题，长的讲解可以拆成几块。',
    '#!section 块类型只能是：讲解 / 定义 / 步骤 / 例题 / 说明。', ''];
  for (const [ci, chapter] of lecture.chapters.entries()) {
    for (const [ti, topic] of chapter.topics.entries()) {
      lines.push(`##!topic ${chapter.no ?? ci + 1} ${ti + 1} | ${line(topic.title) || '（无名）'} | P${topic.fromPage ?? topic.anchor?.page ?? 0}-${topic.toPage ?? topic.anchor?.page ?? 0} | src=${(topic.sourceBlockIndexes ?? topic.blockIndexes ?? []).join(',')} | 章=${line(chapter.title)}`);
      for (const block of effectiveBlocks(topic)) {
        const kind = parseBlockKind(block.kind?.wire ?? block.kind) ?? parseBlockKind('讲解');
        const sub = subtitle(block.title, kind);
        lines.push(`>>> BLOCK ${kind.label}${sub ? ` | ${line(sub)}` : ''}`, blockText(block).trim());
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
export function parseAgentLectureText(text) {
  const topics = []; let topic, block;
  const flushBlock = () => { if (block && topic) { block.text = block.lines.join('\n').trim(); delete block.lines; topic.blocks.push(block); } block = null; };
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith('#!section ')) { flushBlock(); topic = null; continue; }
    if (raw.startsWith('##!topic ')) {
      flushBlock(); const match = raw.match(/^##!topic (\d+)\s+(\d+)(?:\s|\||$)/);
      if (!match) throw fail('讲义终审的知识点标记无法读取。');
      topic = { chapterNo: +match[1], topicNo: +match[2], blocks: [] }; topics.push(topic); continue;
    }
    if (raw.startsWith('>>> BLOCK ')) {
      flushBlock(); const name = raw.slice(10).trim(), pipe = name.indexOf('|');
      const kind = parseBlockKind(pipe < 0 ? name : name.slice(0, pipe)) ?? parseBlockKind('讲解');
      block = { kind, title: pipe >= 0 ? name.slice(pipe + 1) : parseBlockKind(name) ? '' : name, lines: [] }; continue;
    }
    // Match App's reader: Markdown heading lines aren't body blocks.
    if (!raw.startsWith('#') && block) block.lines.push(raw);
  }
  flushBlock();
  if (!topics.length) throw fail('终审结果缺少可读取的知识点，已保留上一版讲义。');
  return topics;
}
export function mergeAgentLectureText(lecture, text) {
  const topics = parseAgentLectureText(text);
  const byKey = new Map(topics.map(t => [`${t.chapterNo}:${t.topicNo}`, t]));
  let updated = 0;
  const chapters = lecture.chapters.map((chapter, ci) => ({ ...chapter, topics: chapter.topics.map((topic, ti) => {
    const hit = byKey.get(`${chapter.no ?? ci + 1}:${ti + 1}`);
    const blocks = (hit?.blocks ?? []).filter(b => b.text.trim()).map(b => ({
      kind: b.kind, title: subtitle(b.title, b.kind, b.text), text: b.kind.wire === 'example' ? '' : b.text,
      stem: b.kind.wire === 'example' ? b.text : '', solution: '', map: '',
    }));
    if (!blocks.length) return topic;
    updated++;
    const body = blocks.map(blockText).join('\n\n');
    return { ...topic, blocks, passages: blocks.map(b => ({ text: blockText(b), label: b.kind.label })), ...judgeMergedTopic(topic, body) };
  }) }));
  // No content-quality gates: preserve absent topics and ignore unknown topics,
  // exactly as the App merge does. Anchors, ranges, titles and sources stay put.
  return { lecture: { ...lecture, chapters }, updated, returnedTopics: topics.length };
}

// v2: reading structure may change; immutable input-unit refs track coverage.
export function reviewUnits(lecture) {
  return lecture.chapters.flatMap((c, ci) => c.topics.flatMap((t, ti) => effectiveBlocks(t)
    .filter(b => blockText(b).trim()).map((b, bi) => ({ id: `c${ci + 1}t${ti + 1}b${bi + 1}`, block: b, topic: t }))));
}
const sourcesOf = value => value.sourceBlockIndexes ?? value.blockIndexes ?? [];
export function exportReorganization(lecture, sectionId, record) {
  const units = reviewUnits(lecture);
  const required = new Set(units.flatMap(u => sourcesOf(u.block).length ? sourcesOf(u.block) : sourcesOf(u.topic)));
  const lines = [`#!section ${line(sectionId)} ${line(lecture.title)}`, '#!protocol 2',
    '#!instruction 可重写章、知识点和块标题，拆分、合并、调整层级。每个原稿 ref 必须由正文承接，src 必须引用下方终稿。',
    '#!outline ' + JSON.stringify(record.outline ?? [])];
  for (const b of record.blocks.filter(b => (b.lectureEligible ?? b.tag?.role === '主线') && required.has(b.index))) {
    lines.push(`#!source ${b.index} | P${b.page ?? 0} | ${line(b.tag?.summary ?? '')}`);
    lines.push(`#!transcript ${b.index} ${JSON.stringify({evidenceKind:b.evidenceKind ?? 'legacy',
      cleanStatus:b.cleanStatus ?? 'unknown', text:b.sourceText ?? b.sentences?.map(s=>s.text).join('') ?? b.text ?? '',
      raw:b.sentences?.map(s=>s.rawText ?? s.text).join('') ?? '',rejectedCorrections:b.correctionIssues??[]})}`);
  }
  const evidence = new Map(record.blocks.filter(b => required.has(b.index))
    .flatMap(b => b.slideEvidence ?? []).map(p => [p.page, p]));
  for (const page of evidence.values()) lines.push(`#!evidence P${page.page} ${JSON.stringify(page.text)}`);
  for (const [ci, c] of lecture.chapters.entries()) {
    for (const [ti, t] of c.topics.entries()) {
      lines.push(`##!topic ${ci + 1} ${ti + 1} | ${line(t.title) || '未命名知识点'} | 章=${line(c.title) || '未命名章'}`);
      const items = units.filter(u => u.topic === t);
      for (const u of items) {
        const kind = parseBlockKind(u.block.kind?.wire ?? u.block.kind) ?? parseBlockKind('讲解');
        lines.push(`>>> BLOCK ${kind.label} | ${line(u.block.title)} | ref=${u.id} | src=${sourcesOf(u.block).length ? sourcesOf(u.block).join(',') : sourcesOf(t).join(',')}`);
        lines.push(kind.wire === 'example' ? `${u.block.stem ?? ''}\n>>> SOLUTION\n${u.block.solution ?? ''}` : blockText(u.block));
      }
    }
  }
  return lines.join('\n');
}

export function mergeReorganization(lecture, text, record, sectionId) {
  const reject = message => { throw fail(`讲义重组未保存：${message}`); };
  if (!String(text).split(/\r?\n/).some(l => l.startsWith(`#!section ${sectionId} `))) reject('课节标识改变');
  const units = reviewUnits(lecture), unitById = new Map(units.map(u => [u.id, u]));
  const sourceById = new Map(record.blocks.filter(b => b.lectureEligible ?? (b.tag?.role === '主线' && b.cleanStatus !== 'incomplete')).map(b => [b.index, b]));
  const seenUnits = new Set(), seenSources = new Set(), seenTopics = new Set(), chapters = [];
  let current, currentBlock;
  const locate = ids => {
    const sources = ids.map(i => sourceById.get(i));
    const pages = sources.map(s => s.page).filter(Number.isFinite);
    const times = sources.map(s => s.startMs ?? s.sentences?.[0]?.startMs).filter(Number.isFinite);
    const first = [...sources].sort((a,b) => a.index-b.index)[0];
    return { fromPage: pages.length ? Math.min(...pages) : null, toPage: pages.length ? Math.max(...pages) : null,
      anchor: { page: first?.page ?? null, startMs: times.length ? Math.min(...times) : null, blockIndex: first?.index ?? null } };
  };
  const flushBlock = () => {
    if (!currentBlock) return;
    const { lines, solutionLines, refs, sourceBlockIndexes, kind, title } = currentBlock;
    const body = lines.join('\n').trim(), solution = solutionLines.join('\n').trim();
    /* 例题的题干可以为空（有的例题整段只有解答），正文块不行。
     * 早先这里对一切块都要求 body 非空，于是「题干空、解答有内容」的例题
     * 导出后必然被自己的合回拒掉 —— 导出与合回对同一份数据给出相反结论，
     * 终审就会在完全没改坏任何东西的情况下报「有空正文块」。
     * 判据因此改成「整块一个字都没有才算空」。 */
    if (!body && !(kind.wire === 'example' && solution)) reject('有空正文块');
    if (!refs.length || refs.some(id => !unitById.has(id))) reject('原稿 ref 缺失或不存在');
    if (!sourceBlockIndexes.length || sourceBlockIndexes.some(id => !sourceById.has(id))) reject('终稿 src 缺失或不存在');
    const allowed = new Set(refs.flatMap(id => {const u=unitById.get(id);return sourcesOf(u.block).length ? sourcesOf(u.block) : sourcesOf(u.topic);}));
    if (sourceBlockIndexes.some(id => !allowed.has(id))) reject('来源超出对应原稿范围');
    refs.forEach(id => seenUnits.add(id)); sourceBlockIndexes.forEach(id => seenSources.add(id));
    current.blocks.push({ kind, title: subtitle(title, kind, body), text: kind.wire === 'example' ? '' : body,
      stem: kind.wire === 'example' ? body : '', solution: kind.wire === 'example' ? solution : '',
      sourceUnitRefs: refs, sourceBlockIndexes, ...locate(sourceBlockIndexes), map: '' });
    currentBlock = null;
  };
  for (const raw of String(text).split(/\r?\n/)) {
    if (raw.startsWith('##!topic ')) {
      flushBlock(); const match=raw.match(/^##!topic (\d+) (\d+)\s*\|\s*([^|]+)\s*\|\s*章=(.+)$/);
      if (!match) reject('知识点标记格式错误');
      const [,cn,tn,title,chapterTitle]=match, key=`${cn}:${tn}`;
      if (seenTopics.has(key)) reject('知识点编号重复'); seenTopics.add(key);
      let chapter=chapters.find(c=>c.no===+cn);
      if (!chapter) { chapter={no:+cn,title:chapterTitle.trim(),topics:[]}; chapters.push(chapter); }
      if (chapters.at(-1)!==chapter || chapter.title!==chapterTitle.trim()) reject('章编号或标题不一致');
      current={no:+tn,title:title.trim(),blocks:[],register:REGISTER.draft};chapter.topics.push(current);
      continue;
    }
    if (raw.startsWith('>>> BLOCK ')) {
      flushBlock(); if (!current) reject('正文块没有所属知识点');
      const parts=raw.slice(10).split('|').map(p=>p.trim()); const kind=parseBlockKind(parts[0]);
      if (!kind) reject('无法识别块类型');
      const ref=parts.find(p=>p.startsWith('ref=')), src=parts.find(p=>p.startsWith('src='));
      const refs=ref?.slice(4).split(',').map(s=>s.trim()).filter(Boolean) ?? [];
      const sourceStrings=src?.slice(4).split(',').map(s=>s.trim()) ?? [];
      if (sourceStrings.some(s=>!/^\d+$/.test(s))) reject('src 必须是终稿块号');
      currentBlock={kind,title:parts[1]&&!/^(ref|src)=/.test(parts[1])?parts[1]:'',refs,sourceBlockIndexes:[...new Set(sourceStrings.map(Number))],lines:[],solutionLines:[],inSolution:false};
      continue;
    }
    if (raw==='>>> SOLUTION') { if (!currentBlock || currentBlock.kind.wire!=='example') reject('解答标记位置错误'); currentBlock.inSolution=true;continue; }
    if (raw.startsWith('#!')) continue;
    if (currentBlock) (currentBlock.inSolution?currentBlock.solutionLines:currentBlock.lines).push(raw);
  }
  flushBlock();
  if (!chapters.length || chapters.some(c=>c.topics.some(t=>!t.blocks.length))) reject('存在空章或知识点');
  const missing=units.filter(u=>!seenUnits.has(u.id));if(missing.length) reject(`遗漏 ${missing.length} 个原稿块`);
  const requiredSources=new Set(units.flatMap(u=>sourcesOf(u.block).length?sourcesOf(u.block):sourcesOf(u.topic)));
  if ([...requiredSources].some(id=>!seenSources.has(id))) reject('有原稿来源块未覆盖');
  for (const u of units.filter(u=>(u.block.kind?.wire??u.block.kind)==='example')) {
    const targets=chapters.flatMap(c=>c.topics).flatMap(t=>t.blocks).filter(b=>b.sourceUnitRefs.includes(u.id));
    if (!targets.some(b=>b.kind.wire==='example') || (u.block.solution?.trim()&&!targets.some(b=>b.solution.trim()))) reject('例题题干或解答结构丢失');
  }
  for (const [ci,c] of chapters.entries()) {
    c.no=ci+1;
    for (const [ti,t] of c.topics.entries()) {
      t.no=ti+1;t.sourceBlockIndexes=[...new Set(t.blocks.flatMap(b=>b.sourceBlockIndexes))].sort((a,b)=>a-b);
      t.blockIndexes=t.sourceBlockIndexes;Object.assign(t,locate(t.sourceBlockIndexes));
      t.passages=t.blocks.map(b=>({text:blockText(b),label:b.kind.label}));
      Object.assign(t, judgeMergedTopic(lecture.chapters[ci]?.topics[ti], t.blocks.map(blockText).join('\n\n')));
    }
  }
  return {lecture:{...lecture,structureSchema:2,chapters},updated:chapters.flatMap(c=>c.topics).length,
    coverage:{unitsBefore:units.length,unitsCovered:seenUnits.size,sourcesBefore:requiredSources.size,sourcesCovered:seenSources.size}};
}
