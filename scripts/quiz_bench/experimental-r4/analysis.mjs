/** Blind review packaging and post-seal scoring. Never print author keys in prepare. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const hash=x=>createHash('sha256').update(x).digest('hex');
const read=async file=>JSON.parse(await fs.readFile(file,'utf8'));
const write=(file,x)=>fs.writeFile(file,JSON.stringify(x,null,2));
const within=dir=>{const resolved=path.resolve(dir);if(!resolved.startsWith(path.resolve('artifacts')+path.sep))throw Error('Review outputs must stay under artifacts');return resolved;};
export async function prepareBlind(directory){
 const dir=within(directory),out=path.join(dir,'blind-review');await fs.mkdir(out,{recursive:true});if((await fs.readdir(out)).length)throw Error('Blind review already exists');
 const questions=await read(path.join(dir,'questions.json')),manifest=await read(path.join(dir,'manifest.json'));
 const shuffled=questions.map((q,index)=>({q,index,key:hash(q.bench.id+':'+q.id+':'+index)})).sort((a,b)=>a.key.localeCompare(b.key));
 const packet=shuffled.map(({q},i)=>({id:'Q'+String(i+1).padStart(3,'0'),corpus:q.bench.caseId,type:q.type,stem:q.stem,choices:q.choices}));
 await write(path.join(out,'questions.json'),packet);await write(path.join(out,'private-map.json'),shuffled.map(({q,index},i)=>({id:packet[i].id,index,bench:q.bench,questionId:q.id})));
 const materials={};for(const c of manifest.cases){const source=await read(path.join(dir,c.id+'-source.json'));materials[c.id]=source.points.map(p=>({title:p.title,text:p.text}));}await write(path.join(out,'learned-material.json'),materials);
 await write(path.join(out,'protocol.json'),{createdAt:new Date().toISOString(),questions:packet.length,questionHash:hash(JSON.stringify(packet)),hidden:['algorithm','workers','batch','answer','explanation','rubric','previousAudits'],rule:'Solve using visible stem and options plus learned knowledge only. Do not borrow temporary example numbers or premises. Explicit selfContained and learningValue required. Commit answers and seal before unblinding.'});
 return {questions:packet.length,packet:path.relative(process.cwd(),path.join(out,'questions.json'))};
}
export async function sealReview(directory){
 const dir=within(directory),out=path.join(dir,'blind-review'),packet=await read(path.join(out,'questions.json')),reviews=await read(path.join(out,'codex-answers.json'));
 if(new Set(reviews.map(r=>r.id)).size!==reviews.length||reviews.length!==packet.length||packet.some(q=>!reviews.some(r=>r.id===q.id)))throw Error('Review must cover every opaque question once');
 for(const r of reviews)if(typeof r.solvedAnswer!=='string'||typeof r.reason!=='string'||!r.reason.trim()||!Number.isFinite(r.score)||r.score<0||r.score>5||['selfContained','learningValue','uniqueAnswer'].some(k=>r[k]!==null&&typeof r[k]!=='boolean'))throw Error('Incomplete explicit blind-review record');
 const seal={sealedAt:new Date().toISOString(),answersSha256:hash(await fs.readFile(path.join(out,'codex-answers.json'))),questionsSha256:hash(await fs.readFile(path.join(out,'questions.json'))),reviewer:'Codex, visible question and learned knowledge only'};
 await write(path.join(out,'seal.json'),seal);return seal;
}
export async function scoreReview(directory){
 const dir=within(directory),out=path.join(dir,'blind-review'),seal=await read(path.join(out,'seal.json'));
 if(seal.answersSha256!==hash(await fs.readFile(path.join(out,'codex-answers.json')))||seal.questionsSha256!==hash(await fs.readFile(path.join(out,'questions.json'))))throw Error('Sealed review changed');
 const questions=await read(path.join(dir,'questions.json')),mapping=await read(path.join(out,'private-map.json')),reviews=await read(path.join(out,'codex-answers.json'));
 const rows=reviews.map(r=>{const map=mapping.find(m=>m.id===r.id),q=questions[map.index],answerMatches=r.solvedAnswer.trim().toUpperCase()===String(q.answer).trim().toUpperCase();return {...r,bench:map.bench,questionId:map.questionId,authorAnswer:q.answer,answerMatches,pass:r.selfContained===true&&r.learningValue===true&&r.uniqueAnswer===true&&answerMatches};});
 await write(path.join(out,'scored.json'),rows);return {reviewed:rows.length,passed:rows.filter(r=>r.pass).length};
}
export async function externalSample(directory){
 const dir=within(directory),manifest=await read(path.join(dir,'manifest.json')),questions=await read(path.join(dir,'questions.json')),sample=[],selection=[];
 for(const [ci,c]of manifest.cases.entries())for(const [ai,arm]of manifest.arms.entries()){
  const worker=manifest.concurrencies[(ci+ai)%manifest.concurrencies.length],pool=questions.filter(q=>q.type==='mcq'&&q.bench.caseId===c.id&&q.bench.arm===arm);
  const ranked=pool.map(q=>({q,rank:(q.bench.workers===worker?0:2)+(q.bench.batch==='cold'?0:1),key:hash(q.id+':'+q.stem)})).sort((a,b)=>a.rank-b.rank||a.key.localeCompare(b.key));
  if(ranked.length){const q=ranked[0].q;sample.push({...q,id:'external-'+(sample.length+1)});selection.push({id:sample.at(-1).id,bench:q.bench,questionId:q.id,preferredWorkers:worker});}else selection.push({caseId:c.id,arm,missing:true});
 }
 await write(path.join(dir,'external-questions.json'),sample);await write(path.join(dir,'external-selection.json'),selection);return {selected:sample.length,missing:selection.filter(s=>s.missing).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const [action,dir]=process.argv.slice(2),actions={prepare:prepareBlind,seal:sealReview,score:scoreReview,external:externalSample};if(!actions[action])throw Error('Expected prepare|seal|score|external and a comparison directory');console.log(JSON.stringify(await actions[action](dir)));}
