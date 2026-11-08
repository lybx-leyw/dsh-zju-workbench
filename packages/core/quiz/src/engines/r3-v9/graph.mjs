import {knowledgePoints} from '../../knowledge-points.js';
// Finalized structured blocks are authoritative; a topic's aggregate text is a mirror.
const finalText=value=>{
 if(typeof value==='string')return value;
 if(Array.isArray(value))return value.map(finalText).filter(Boolean).join('\n');
 if(!value||typeof value!=='object')return '';
 if(value.blocks?.length)return finalText(value.blocks);
 if(value.passages?.length)return finalText(value.passages);
 if(typeof value.text==='string'&&value.text.trim())return value.text;
 return ['stem','solution','content','explanation','definition','formula','statement'].map(k=>finalText(value[k])).filter(Boolean).join('\n');
};
export function inspectGraph(graph){
 const nodes=new Map(),leaves=new Map();
 const visit=(node,depth=0)=>{
  if(depth>64||nodes.size>=2000||!node||typeof node.id!=='string'||!node.id||nodes.has(node.id)||typeof node.title!=='string')throw Error('图谱必须是ID唯一、深度有限的树');
  nodes.set(node.id,node);if(!Array.isArray(node.children))throw Error('图谱节点缺少children');
  if(node.pages!==undefined&&(!Array.isArray(node.pages)||new Set(node.pages.map(p=>p.page)).size!==node.pages.length||node.pages.some(p=>p.page==null||p.text!==undefined&&typeof p.text!=='string'||p.visual!==undefined&&typeof p.visual!=='string')))throw Error('图谱页面详情需要唯一页码及文本内容');
  for(const child of node.children)visit(child,depth+1);
  if(!node.children.length){if(typeof node.text!=='string'||!node.text.trim())throw Error('叶节点必须绑定定稿正文');leaves.set(node.id,node);}
 };
 visit(graph.root);return {nodes,leaves};
}
/** Use the parser's existing title/semantic-topic hierarchy, not paragraph segmentation. */
export function graphFromRecord(record,lecture=record.lecture){
 if(!record.tree)throw Error('需要已有的重建知识图谱树');
 if(!lecture?.chapters)throw Error('需要讲义定稿正文');
 const points=knowledgePoints({...record,semanticPlan:[],lecture:{...lecture,generationVersion:'architecture-v4'}}),used=new Set();
 const blocks=n=>n.kind==='leaf'?(n.blocks??[]).map(b=>b.index):(n.children??[]).flatMap(blocks);
 const convert=(node,path)=>{
  const id=JSON.stringify([record.courseId??'course',record.subId??'lesson',...path]);
  if(node.semanticTopic||node.kind==='leaf'){
   const ids=new Set(blocks(node)),exact=points.filter(p=>p.blockIndexes.length===ids.size&&p.blockIndexes.every(i=>ids.has(i))&&ids.size),named=points.filter(p=>p.title===(node.semanticTitle??node.title));
   const candidates=exact.length?exact:named;if(candidates.length!==1||used.has(candidates[0]?.id))throw Error('图谱节点无法唯一绑定讲义定稿：'+(node.title??node.id));
   const base=candidates[0],text=finalText(lecture.chapters[base.chapterIndex]?.topics?.[base.topicIndex]);
   if(!text.trim())throw Error('图谱节点缺少定稿正文：'+base.title);
   const p={...base,text},pageIds=new Set((record.blocks??[]).filter(b=>p.blockIndexes.includes(b.index)).map(b=>b.page).filter(p=>p!=null));
   const pages=(record.pages??[]).filter(p=>pageIds.has(p.page)).map(p=>({page:p.page,text:p.transcription?.pageText??p.pageText??'',visual:p.transcription?.pageVisual??p.pageVisual??''}));
   used.add(p.id);return {id,title:p.title,text,children:[],point:p,pages};
  }
  return {id,title:node.title??'',children:(node.children??[]).map((c,i)=>convert(c,[...path,i]))};
 };
 const graph={id:JSON.stringify([record.courseId,record.subId]),revision:lecture.revision??record.sourceVersion??null,source:'reconstructed-tree',root:convert(record.tree,[])};
 inspectGraph(graph);if(used.size!==points.length)throw Error('部分定稿知识点未绑定图谱，不能静默遗漏');return graph;
}
/** A flat benchmark may retain declared course/chapter grouping, never inferred relationships. */
export function graphFromDataset(dataset){
 const courses=new Map();for(const p of dataset.points){
  const courseKey=JSON.stringify([p.courseId,p.subId]);if(!courses.has(courseKey))courses.set(courseKey,{id:'course:'+courseKey,title:p.courseTitle??dataset.title,children:[]});
  const course=courses.get(courseKey),chapterId=JSON.stringify([courseKey,p.chapterIndex??p.chapterTitle??0]);let chapter=course.children.find(n=>n.id===chapterId);
  if(!chapter){chapter={id:chapterId,title:p.chapterTitle??'知识点',children:[]};course.children.push(chapter);}
  chapter.children.push({id:p.id,title:p.title,text:p.text,pages:p.pages??[],point:p,children:[]});
 }
 const graph={id:dataset.id,source:'declared-chapters',root:{id:'collection:'+dataset.id,title:dataset.title,kind:'collection',children:[...courses.values()]}};inspectGraph(graph);return graph;
}
