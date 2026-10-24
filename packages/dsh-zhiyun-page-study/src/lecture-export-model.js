export const EXPORT_ROOT_ID='zs-lecture-export';
export function pdfFilename(course,lesson) {
  const name=[course,lesson].filter(Boolean).join(' - ').normalize('NFKC').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/g,'').slice(0,140).trim();
  return `${name||'课堂讲义'} - 讲义与知识图谱.pdf`;
}
/** A large map is continued at readable scale instead of shrunk onto one page;
 *  small chapters share a page instead of each taking an almost empty one.
 *  Heights are millimetres of the printable text column (A4, 261mm tall). */
export function graphSheets(chapters,size=8) {
  const sheets=[];
  for(const [ci,chapter] of chapters.entries()){
    const topics=chapter.topics??[],parts=Math.max(1,Math.ceil(topics.length/size));
    for(let part=1;part<=parts;part++){
      const slice=topics.slice((part-1)*size,part*size);
      const entry={chapterIndex:ci,title:chapter.title,part,total:parts,offset:(part-1)*size,topics:slice};
      const last=sheets.at(-1),height=22+slice.length*20;
      // Only an unsplit chapter may share a page; a continuation always starts fresh.
      if(parts===1&&last&&last.height+height<=223){last.chapters.push(entry);last.height+=height;}
      else sheets.push({chapters:[entry],height});
    }
  }
  return sheets;
}
