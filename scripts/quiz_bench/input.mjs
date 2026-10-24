import fs from 'node:fs/promises';
import path from 'node:path';
import { knowledgePoints } from '../../packages/dsh-zhiyun-core-quiz/src/knowledge-points.js';
import { parseAgentLectureText } from '../../packages/dsh-zhiyun-core-lecture/src/agent-text.js';

/** A finished bench work directory and a product record use the same projection. */
export function datasetFrom(value,{id='import',title='导入讲义'}={}) {
  if(Array.isArray(value?.points))return validateDataset({...value,id:value.id??id,title:value.title??title});
  const record=value.record??(value.generationVersion==='architecture-v4'&&value.chapters?{lecture:value}:value);
  const records=Array.isArray(value.records)?value.records:[record];
  const points=records.flatMap((row,index)=>knowledgePoints({courseId:String(row.courseId??'bench'),subId:String(row.subId??index),sourceVersion:row.sourceVersion??'bench-source',...row}));
  if(!points.length)throw new Error('没有可出题的 v4 知识点；请导入产品记录或 bench 的 record.json + lecture-final.json');
  return validateDataset({id,title,points,gold:value.gold??null});
}
export function validateDataset(value) {
  const points=value.points;
  if(!Array.isArray(points)||!points.length||points.length>1000||new Set(points.map(p=>p.id)).size!==points.length)throw new Error('知识点须为 1–1000 个且标识不重复');
  for(const point of points)if(!point||typeof point.id!=='string'||typeof point.text!=='string'||!point.text.trim()||typeof point.title!=='string')throw new Error('知识点缺少 id、title 或完整正文');
  return {...value,points:points.map(point=>({courseId:'bench',subId:'lesson',courseTitle:value.title??'基准资料',lessonTitle:'基准节次',blockIndexes:[],...point}))};
}
export async function loadDataset(file) {
  const stat=await fs.stat(file);
  if(!stat.isDirectory()){
    if(file.endsWith('.jsonl'))return fromLectureLog((await fs.readFile(file,'utf8')).trim().split(/\r?\n/).map(line=>JSON.parse(line)),path.basename(file,'.jsonl'));
    return datasetFrom(JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,'')));
  }
  const record=JSON.parse(await fs.readFile(path.join(file,'parsed.json'),'utf8'));
  const lecture=JSON.parse(await fs.readFile(path.join(file,'lecture-final.json'),'utf8'));
  return datasetFrom({...record,lecture},{id:path.basename(file),title:lecture.title??path.basename(file)});
}

/** No local paths or credentials are included in the returned manifest. */
export function fromLectureLog(records,id='lecture-log') {
  const starts=records.filter(r=>r.kind==='meta'&&r.what==='start'),start=starts.at(-1);
  const lectures=records.filter(r=>r.kind==='event'&&r.act==='lecture');
  const final=records.filter(r=>r.kind==='event'&&r.act==='polish'&&r.data?.text&&!r.data.failed).at(-1);
  if(!final)throw new Error('日志没有终稿全文，讲义事件可能截断；请导入 parsed.json + lecture-final.json 工作目录');
  const bodies=parseAgentLectureText(final.data.text),headers=String(final.data.text).split(/\r?\n/).filter(line=>line.startsWith('##!topic '));
  const chapters=new Map();
  for(const [index,topic] of bodies.entries()){
    const fields=(headers[index]??'').split('|').map(s=>s.trim()),fallback=lectures[index]?.data??{};
    if(!chapters.has(topic.chapterNo))chapters.set(topic.chapterNo,{title:fields.find(s=>s.startsWith('章='))?.slice(2)??fallback.chapter??`第 ${topic.chapterNo} 章`,topics:[]});
    chapters.get(topic.chapterNo).topics.push({title:fields[1]??fallback.title??`知识点 ${index+1}`,blocks:topic.blocks,sourceBlockIndexes:(fields.find(s=>s.startsWith('src='))?.slice(4)??'').split(',').filter(Boolean).map(Number)});
  }
  return datasetFrom({courseId:'bench',subId:id,lecture:{generationVersion:'architecture-v4',revision:id,chapters:[...chapters.values()]}},{id,title:start?.title??start?.section??id});
}
