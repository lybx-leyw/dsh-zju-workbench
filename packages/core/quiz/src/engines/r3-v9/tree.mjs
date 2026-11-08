/** Child indexes are relative paths, never model-generated host IDs. */
export function atPath(root,path){
 if(!Array.isArray(path)||path.some(i=>!Number.isInteger(i)||i<0))throw Error('来源 path 必须为从当前节点出发的子节点下标数组');
 let node=root;for(const i of path){node=node.children?.[i];if(!node)throw Error('来源 path 超出当前子树：'+JSON.stringify(path));}return node;
}
export function *walkTree(root,path=[],ancestors=[]){
 yield {node:root,path,ancestors};for(const [i,child]of root.children.entries())yield*walkTree(child,[...path,i],[...ancestors,root]);
}
/** Stable addresses in existing content; this does not create new knowledge-tree nodes. */
export const sourceParts=text=>String(text??'').split('\n').map((text,part)=>({part,text})).filter(p=>p.text.trim());
const pageView=pages=>(pages??[]).map(p=>({page:p.page,text:sourceParts(p.text),visual:sourceParts(p.visual)}));
/** Parents see actual nested descendants, including content not selected in child ideas. */
export function reasoningTree(node,path=[]){
 return {path,title:node.title,lecture:sourceParts(node.text),pages:pageView(node.pages),
  ideas:node.ideas.map(({focus,target,operation,strategy,types,conditions,basis,answerPoints,relation})=>({focus,target,operation,strategy,types,conditions,basis:basis.map(({path:relative,source,page,field,part})=>({path:[...path,...relative],source,page,field,part})),answerPoints,relation:relation?{kind:relation.kind,explanation:relation.explanation,needs:relation.needs}:null})),
  coverage:node.coverage,children:node.children.map((child,i)=>reasoningTree(child,[...path,i]))};
}
/** Verify each quote in its owning node; code supplies the final provenance. */
export function bindBasis(owner,raw){
 if(!Array.isArray(raw)||!raw.length)throw Error('考法缺少 basis 引文');
 const seen=new Set();return raw.map((b,index)=>{
  const path=b.path??(owner.children.length?null:[]),node=atPath(owner,path),source=b.source??'lecture';let text,field;
  if(source==='lecture')text=node.text;
  else if(source==='page'){
   field=b.field??'text';if(!['text','visual'].includes(field))throw Error('页来源 field 只能为 text 或 visual');
   text=node.pages?.find(p=>p.page===b.page)?.[field];
  }else throw Error('basis.source 只能为 lecture 或 page');
  const fragment=sourceParts(text).find(p=>p.part===b.part);
  if(!Number.isInteger(b.part)||!fragment)throw Error(`basis[${index}] 在 ${JSON.stringify(path)} 的 ${source} 中没有 part=${b.part}；请使用该节点已列出的片段编号`);
  const identity=JSON.stringify([path,source,b.page,field,b.part]);if(seen.has(identity))throw Error('basis 不应重复同一位置的同一片段');seen.add(identity);
  return {path:[...path],nodeId:node.nodeId??node.id,source,...(source==='page'?{page:b.page,field}:{}),part:b.part,quote:fragment.text};
 });
}
export function locateIdea(library,nodePath,ideaId){
 const node=atPath(library.root,nodePath),idea=node.ideas.find(i=>i.id===ideaId);if(!idea)throw Error('任务的节点或考法已不存在');return {node,idea};
}
export function materialTree(node,path=[]){return {path,title:node.title,lecture:sourceParts(node.text),pages:pageView(node.pages),children:node.children.map((child,i)=>materialTree(child,[...path,i]))};}
/** Only the selected node's subtree enters a question worker. */
export function taskContext(library,ticket){
 const {node,idea}=locateIdea(library,ticket.nodePath,ticket.ideaId),titles=[library.root.title];let cursor=library.root;
 for(const i of ticket.nodePath){cursor=cursor.children[i];titles.push(cursor.title);}
 return {node,idea,model:{path:titles,subtree:materialTree(node)}};
}
