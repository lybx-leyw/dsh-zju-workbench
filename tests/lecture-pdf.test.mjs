import test from 'node:test';
import assert from 'node:assert/strict';
import {createLecturePdfHandler,lecturePdfOptions} from '../apps/desktop/src/lecture-pdf.js';
import {graphSheets,pdfFilename} from '../packages/dsh-zhiyun-page-study/src/lecture-export-model.js';

function fixture({canceled=false,ready=true}={}){
  const calls=[],frame={},sender={mainFrame:frame,getURL:()=> 'http://127.0.0.1:8000/',executeJavaScript:async()=>ready,printToPDF:async options=>{calls.push(['pdf',options]);return Buffer.from('%PDF-fixture');}},win={webContents:sender,isDestroyed:()=>false};
  const dialog={showSaveDialog:async(_win,options)=>{calls.push(['dialog',options]);return {canceled,filePath:'chosen.pdf'};}};
  return {calls,win,dialog,event:{sender,senderFrame:frame},handler:createLecturePdfHandler({getWindow:()=>win,getHostUrl:()=> 'http://127.0.0.1:8000/?token=fixture',dialog,downloads:()=>'.',write:async(file,bytes)=>calls.push(['write',file,bytes.toString()])})};
}
test('large graph exports every node in ordered readable continuation sheets',()=>{
  const topics=Array.from({length:25},(_,i)=>({title:`点 ${i}`})),sheets=graphSheets([{title:'章',topics}]),parts=sheets.flatMap(s=>s.chapters);
  assert.deepEqual(parts.map(p=>p.topics.length),[8,8,8,1]);assert.deepEqual(parts.flatMap(p=>p.topics),topics);
  assert.deepEqual(parts.map(p=>[p.part,p.total]),[[1,4],[2,4],[3,4],[4,4]]);assert.deepEqual(parts.map(p=>p.offset),[0,8,16,24]);
  assert.ok(!/[<>:"/\\|?*]/.test(pdfFilename('A/B','C:D')));assert.ok(pdfFilename('','').endsWith('.pdf'));
});
test('small chapters share a graph page instead of each taking an almost empty one',()=>{
  const sheets=graphSheets([{title:'甲',topics:[{title:'a'},{title:'b'}]},{title:'乙',topics:[{title:'c'}]}]);
  assert.equal(sheets.length,1);assert.deepEqual(sheets[0].chapters.map(c=>c.title),['甲','乙']);
  assert.deepEqual(sheets[0].chapters.map(c=>c.topics.length),[2,1]);
  const many=Array.from({length:6},(_,i)=>({title:`章 ${i}`,topics:Array.from({length:3},(_,j)=>({title:`点 ${j}`}))}));
  assert.equal(graphSheets(many).length,3,'three chapter roots do not fit on one A4 text column');
});
test('native PDF export requires same app origin and main frame before opening a dialog',async()=>{
  const f=fixture();assert.ok((await f.handler({...f.event,senderFrame:{}},'讲义.pdf')).error);assert.equal(f.calls.length,0);
  f.event.sender.getURL=()=> 'https://example.org';assert.ok((await f.handler(f.event,'讲义.pdf')).error);assert.equal(f.calls.length,0);
});
test('cancel and disappeared print document never write or print the application',async()=>{
  const canceled=fixture({canceled:true});assert.equal((await canceled.handler(canceled.event,'讲义.pdf')).canceled,true);assert.equal(canceled.calls.length,1);
  const changed=fixture({ready:false});assert.ok((await changed.handler(changed.event,'讲义.pdf')).error);assert.equal(changed.calls.length,1);
});
test('PDF save includes page numbers and waits for one explicit file selection',async()=>{
  const f=fixture();assert.equal((await f.handler(f.event,'讲义与图谱.pdf')).canceled,false);
  assert.deepEqual(f.calls.map(c=>c[0]),['dialog','pdf','write']);assert.equal(f.calls[2][1],'chosen.pdf');assert.match(lecturePdfOptions.footerTemplate,/pageNumber/);assert.equal(lecturePdfOptions.generateDocumentOutline,true);
});
test('native export serializes dialogs and unlocks after a failed save',async()=>{
  const f=fixture();let release;f.dialog.showSaveDialog=()=>new Promise(resolve=>{release=resolve;});
  const first=f.handler(f.event,'讲义.pdf');assert.ok((await f.handler(f.event,'第二份.pdf')).error);release({canceled:true});await first;
  f.dialog.showSaveDialog=async()=>{throw Error('filesystem unavailable');};assert.ok((await f.handler(f.event,'讲义.pdf')).error);
  f.dialog.showSaveDialog=async()=>({canceled:true});assert.equal((await f.handler(f.event,'讲义.pdf')).canceled,true);
});
