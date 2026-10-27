import React, {useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {knowledgeChapters} from 'dsh-zhiyun-core-quiz';
import {blocksOf,kindOf,kinds,LectureBlockBody} from './lecture-content.jsx';
import {EXPORT_ROOT_ID,pdfFilename,graphSheets} from './lecture-export-model.js';
import printCss from './lecture-export.css';

let exporting=false;
export function LecturePdfDocument({snapshot,onReady}) {
  useEffect(()=>{onReady?.();},[]);
  const {lecture,graph,course,lesson}=snapshot,chapters=lecture.chapters??[],sheets=graphSheets(graph);
  return <div className="zs-pdf"><style>{printCss}</style><header className="zs-pdf-title"><span>课堂讲义 · 知识图谱</span><h1>{lesson||lecture.title||'课堂讲义'}</h1>{course&&<p>{course}</p>}<small>{chapters.length} 章 · {chapters.reduce((sum,c)=>sum+(c.topics?.length??0),0)} 个知识点</small>
    {lecture.polish?.complete===false&&<p className="zs-pdf-warning">部分终审未完成，请结合课堂资料核对。</p>}</header>
    <nav className="zs-pdf-contents" aria-label="PDF 目录"><h2>目录</h2><ol>{chapters.map((chapter,ci)=><li key={ci}><a href={`#pdf-chapter-${ci}`}>{chapter.title}</a><ol>{(chapter.topics??[]).map((topic,ti)=><li key={ti}><a href={`#pdf-topic-${ci}-${ti}`}>{topic.title}</a></li>)}</ol></li>)}<li><a href="#pdf-graph">知识图谱</a></li></ol></nav>
    <main className="zs-pdf-lecture">{chapters.map((chapter,ci)=><section key={ci} className="zs-pdf-chapter" id={`pdf-chapter-${ci}`}><h2><small>第 {ci+1} 章</small>{chapter.title}</h2>{(chapter.topics??[]).map((topic,ti)=><article key={ti} id={`pdf-topic-${ci}-${ti}`}><h3>{topic.title}</h3>
      {(topic.fromPage??topic.anchor?.page)!=null&&<p className="zs-pdf-source">课堂课件 P{topic.fromPage??topic.anchor.page}{topic.toPage>topic.fromPage?`–${topic.toPage}`:''}</p>}
      {topic.register!=='written'&&<p className="zs-pdf-warning">本知识点保留课堂原话，尚未写成书面稿。</p>}
      {blocksOf(topic).map((block,bi)=><section className="zs-pdf-block" key={bi}><h4>{kinds[kindOf(block)]?.[0]??'讲解'}{block.title?` · ${block.title}`:''}</h4><LectureBlockBody block={block} expanded/></section>)}
    </article>)}</section>)}</main>
    {!!lecture.polish?.warnings?.length&&<section className="zs-pdf-review"><h2>待复核提示</h2>{lecture.polish.warnings.map((warning,i)=><p key={i}>{warning}</p>)}</section>}
    {sheets.map((sheet,index)=><section className="zs-pdf-map-sheet" id="pdf-graph" key={index}><header><span>知识图谱</span><h2>{course||lesson||'课堂知识'}</h2><p>章节 → 知识点 · 沿用应用中的层级关系</p></header>
      <div className="zs-pdf-map-viewport"><div className="zs-pdf-map-grid" style={{gridTemplateColumns:`repeat(${sheet.columns.length},minmax(0,1fr))`}}>
        {sheet.columns.map((column,col)=><div className="zs-pdf-map-column" key={col}>{column.map((part,pi)=><div className="zs-pdf-map-chapter" key={pi}><div className="zs-pdf-map-root">{part.chapterIndex+1}. {part.title}{part.total>1?` · ${part.part}/${part.total}`:''}</div><ol className="zs-pdf-map-branches">{part.topics.map((topic,ti)=><li key={ti}><span>{String(part.offset+ti+1).padStart(2,'0')}</span><strong>{topic.title}</strong></li>)}</ol></div>)}</div>)}
      </div></div>
    </section>)}
  </div>;
}

async function waitForContent(element) {
  // Markdown math is rendered asynchronously. Wait for a quiet DOM and loaded fonts/images.
  await new Promise((resolve,reject)=>{
    let quiet;
    const finish=()=>{clearTimeout(quiet);clearTimeout(limit);observer.disconnect();resolve();};
    const observer=new MutationObserver(()=>{clearTimeout(quiet);quiet=setTimeout(finish,500);});
    const limit=setTimeout(()=>{clearTimeout(quiet);observer.disconnect();reject(new Error('正文仍在排版，请稍后重试'));},20000);
    observer.observe(element,{childList:true,subtree:true,characterData:true,attributes:true});quiet=setTimeout(finish,500);
  });
  await Promise.race([Promise.all([document.fonts?.ready,...[...element.querySelectorAll('img')].map(image=>image.decode())]),new Promise((_,reject)=>setTimeout(()=>reject(new Error('字体或图片未能加载，请稍后重试')),15000))]);
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  // Measure at the landscape page width after fonts settle; fit all nodes without clipping.
  for(const viewport of element.querySelectorAll('.zs-pdf-map-viewport')){
    const grid=viewport.firstElementChild;
    let scale=1;
    if(grid.scrollHeight>viewport.clientHeight){
      // Reflow at a wider logical width while shrinking, so the map still uses
      // the full landscape sheet instead of becoming a tiny strip in its centre.
      let low=0,high=1;
      for(let i=0;i<12;i++){
        const candidate=(low+high)/2;
        grid.style.width=`${100/candidate}%`;
        if(grid.scrollHeight*candidate<=viewport.clientHeight-1)low=candidate;else high=candidate;
      }
      scale=low||high;
    }
    grid.style.width=`${100/scale}%`;
    grid.style.transform=`scale(${scale})`;
  }
}

export async function exportLecturePdf(state) {
  if(exporting)throw new Error('已有 PDF 正在导出，请先完成或取消');
  if(!state.lecture?.chapters?.some(c=>c.topics?.length))throw new Error('请先生成讲义');
  exporting=true;
  const title=document.title,element=document.createElement('div');element.id=EXPORT_ROOT_ID;element.setAttribute('aria-hidden','true');document.body.append(element);
  const root=createRoot(element);
  const snapshot=structuredClone({lecture:state.lecture,graph:knowledgeChapters(state.result),course:state.course?.title??'',lesson:state.lesson?.title??''});
  if(!snapshot.graph.length)snapshot.graph=snapshot.lecture.chapters;
  let afterPrint;
  try{
    await new Promise(resolve=>root.render(<LecturePdfDocument snapshot={snapshot} onReady={resolve}/>));
    await waitForContent(element);
    if(!element.textContent?.trim())throw new Error('导出正文为空，请重试');
    const filename=pdfFilename(snapshot.course,snapshot.lesson);document.title=filename.replace(/\.pdf$/,'');
    if(window.lecturePdf?.save){
      const result=await window.lecturePdf.save(filename);
      if(result.error)throw new Error(result.error);
      return result.canceled?'已取消导出':'PDF 已保存，包含整节讲义与知识图谱';
    }
    const finished=new Promise(resolve=>{afterPrint=resolve;window.addEventListener('afterprint',afterPrint,{once:true});});
    window.print();
    // A blocked or silent print must not leave the button stuck on "正在导出…".
    await Promise.race([finished,new Promise(resolve=>setTimeout(resolve,30000))]);
    return '打印预览已关闭；选择“另存为 PDF”可保存讲义与图谱';
  }finally{
    if(afterPrint)window.removeEventListener('afterprint',afterPrint);
    document.title=title;root.unmount();element.remove();exporting=false;
  }
}

export function LectureExportButton({state}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),live=useRef(true);
  useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  const start=async()=>{setBusy(true);setMessage('正在排版讲义与知识图谱…');setError('');try{const result=await exportLecturePdf(state);if(live.current)setMessage(result);}catch(error){if(live.current){setError(error.message);setMessage('');}}finally{if(live.current)setBusy(false);}};
  return <div className="zs-handout-export"><button type="button" className="zs-button" disabled={busy} onClick={start} title="将整节讲义与完整知识图谱导出为一个 PDF"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/></svg>{busy?'正在导出…':'导出 PDF'}</button>{message&&<small role="status">{message}</small>}{error&&<small role="alert">{error}</small>}</div>;
}
