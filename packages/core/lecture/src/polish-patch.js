// Apply edits to immutable input bodies, then let the existing codec validate coverage.
export const PATCH_INSTRUCTION = `#!source是概述索引，不能因概述未提及便认定事实不存在。#!transcript提供对应的clean正文与raw转录、依据类型和处理状态；#!evidence才是原始课件。无课件的内容可以按转录组织，但未确认的专名、日期和公式不能借常识擅自确认。
输出协议改为局部补丁：只返回 JSON {"edits":[{"ref":"c1t1b1","before":"原文的精确连续片段","after":"修改后的片段","reason":"修改依据"}],"warnings":["无法消除的具体矛盾及所在ref"]}，无需修改返回 {"edits":[],"warnings":[]}。不要重发全文。每项只改一个 ref 的正文，before 必须在该正文中唯一出现；不得修改任何协议行。
#!evidence 是原始课件依据，优先于加工正文。请先核对每道题的题设，再逐步检查代入、正负号、变量定义、单位与因果；不能只检查最终公式正确而容忍中间错误。逐句推导有确定代数矛盾时可由已给出的定义式纠正，reason 写清推导；新增来源外的事实不允许。不同题设可以使用不同符号，禁止以全文多数写法合并q/Q等不同物理量；无课件依据且不能由明确公式唯一推得时，不改变电荷分配、公式、数值或适用条件，改在warnings中指出。例题题干和解答的位置已由程序确定：不得新增题问，不得把解答移入题干或把题干移入解答；不得跨正文块搬运内容。JSON 内反斜杠必须合法转义。`;

export function polishPatchWarnings(response) {
  try {
    const raw = String(response).trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
    const warnings = JSON.parse(raw).warnings;
    return Array.isArray(warnings) ? warnings.filter(w => typeof w === 'string' && w.trim()) : [];
  } catch { return []; }
}

/** Each local review sees only its own source pages and immutable unit refs. */
export function polishContexts(text) {
  const topics = [...text.matchAll(/^##!topic [\s\S]*?(?=^##!topic |$(?![\s\S]))/gm)].map(m => m[0]);
  if (topics.length < 2) return [{text}];
  const header = text.split('\n').filter(l => /^#!(?:section |protocol )/.test(l));
  const sources = text.split('\n').filter(l => l.startsWith('#!source '));
  const transcripts = text.split('\n').filter(l => l.startsWith('#!transcript '));
  const evidence = text.split('\n').filter(l => l.startsWith('#!evidence '));
  return topics.map(topic => {
    const indexes = new Set([...topic.matchAll(/\bsrc=([\d,]+)/g)].flatMap(m => m[1].split(',').map(Number)));
    const selected = sources.filter(l => indexes.has(Number(l.match(/^#!source (\d+)/)?.[1])));
    const pages = selected.map(l => Number(l.match(/\| P(\d+)/)?.[1])).filter(Number.isFinite);
    const clues = evidence.filter(l => pages.some(p => Math.abs(p-Number(l.match(/^#!evidence P(\d+)/)?.[1])) <= 1));
    const spoken = transcripts.filter(l => indexes.has(Number(l.match(/^#!transcript (\d+)/)?.[1])));
    return {text:[...header,...selected,...spoken,...clues,topic].join('\n')};
  });
}

export function decodePolishPatch(raw) {
  const s=String(raw).trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
  try {const patch=JSON.parse(s);if(Array.isArray(patch.edits))return patch;}catch{}
  throw Object.assign(new Error('分知识点终审必须返回局部补丁JSON，不能重发全文'),{code:'FORMAT'});
}

export function applyPolishPatch(original, response) {
  const raw = String(response).trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
  // Keep accepting the old protocol for hosts which still return complete text.
  if (!raw.startsWith('{')) return response;
  const fail = message => Object.assign(new Error(message), { code: 'FORMAT' });
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw fail('局部补丁不是合法 JSON'); }
  if (!Array.isArray(parsed.edits)) throw fail('局部补丁缺少 edits 数组');
  const pattern = /^>>> BLOCK [^\n]*\bref=([^\s|]+)[^\n]*\n([\s\S]*?)(?=^>>> BLOCK |^##!topic |^#!|$(?![\s\S]))/gm;
  const bodies = new Map();
  for (const hit of original.matchAll(pattern)) {
    if (bodies.has(hit[1])) throw fail('原稿 ref 重复');
    bodies.set(hit[1], { start: hit.index + hit[0].length - hit[2].length, text: hit[2], edits: [] });
  }
  for (const edit of parsed.edits) {
    // Models sometimes include an empty placeholder or an unchanged quotation.
    // It carries no operation; do not spend another review call on it.
    if (typeof edit?.before === 'string' && edit.before === edit.after) continue;
    const body = bodies.get(edit?.ref);
    if (!body || typeof edit.before !== 'string' || !edit.before || typeof edit.after !== 'string') throw fail('补丁 ref 或正文无效');
    if (/^(?:#!|##!|>>>)/m.test(edit.before) || /^(?:#!|##!|>>>)/m.test(edit.after)) throw fail('补丁不得改写协议行');
    const at = body.text.indexOf(edit.before);
    if (at < 0 || body.text.indexOf(edit.before, at + 1) >= 0) throw fail(`补丁 ${edit.ref} 的 before 未唯一匹配`);
    if (body.edits.some(e => at < e.at + e.before.length && e.at < at + edit.before.length)) throw fail('补丁片段重叠');
    body.edits.push({ ...edit, at });
  }
  let result = original;
  for (const body of [...bodies.values()].sort((a, b) => b.start - a.start)) {
    let revised = body.text;
    for (const edit of body.edits.sort((a, b) => b.at - a.at)) {
      revised = revised.slice(0, edit.at) + edit.after + revised.slice(edit.at + edit.before.length);
    }
    /* 「不许清空」要判的是**补丁把原本有字的段落删光**，不是「每一段现在都得有字」。
     * 例题的题干本来就允许为空（有的例题整段只有解答），按「每段非空」判会把这种
     * 例题判成被清空 —— 而模型其实一个字都没删，只是改了另一段。 */
    const split = value => value.split(/^>>> SOLUTION\s*$/m).map(part => part.trim());
    const before = split(body.text), now = split(revised);
    const emptied = before.some((part, index) => part && !(now[index] ?? '').trim());
    if (!revised.trim() || emptied) throw fail('补丁不得清空正文、题干或解答');
    result = result.slice(0, body.start) + revised + result.slice(body.start + body.text.length);
  }
  return result;
}
