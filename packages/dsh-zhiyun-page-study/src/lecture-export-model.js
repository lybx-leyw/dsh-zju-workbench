export const EXPORT_ROOT_ID='zs-lecture-export';
export function pdfFilename(course,lesson) {
  const name=[course,lesson].filter(Boolean).join(' - ').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,140).trim();
  return `${name||'课堂讲义'} - 讲义与知识图谱.pdf`;
}
/** One landscape overview; long chapters continue in balanced columns.
 * Keep every topic and its original numbering. Final fitting uses actual DOM sizes. */
export function graphSheets(chapters) {
  if(!chapters.length)return [];
  const count=chapters.reduce((n,c)=>n+(c.topics?.length??0),0);
  const columnCount=Math.min(4,Math.max(2,Math.ceil(count/16)));
  const columns=Array.from({length:columnCount},()=>[]),weights=columns.map(()=>0),entries=[];
  const size=Math.max(6,Math.ceil(count/(columnCount*2)));
  for(const [ci,chapter] of chapters.entries()){
    const topics=chapter.topics??[],parts=Math.max(1,Math.ceil(topics.length/size));
    for(let part=1;part<=parts;part++){
      const slice=topics.slice((part-1)*size,part*size);
      const entry={chapterIndex:ci,title:chapter.title,part,total:parts,offset:(part-1)*size,topics:slice};
      const target=weights.indexOf(Math.min(...weights));
      columns[target].push(entry);entries.push(entry);
      weights[target]+=3+slice.reduce((n,t)=>n+Math.max(1,Math.ceil(String(t.title??'').length/(columnCount>2?18:28))),0);
    }
  }
  return [{chapters:entries,columns}];
}
