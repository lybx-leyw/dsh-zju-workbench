import path from 'node:path';
import {writeFile} from 'node:fs/promises';

export const lecturePdfOptions={pageSize:'A4',printBackground:true,preferCSSPageSize:true,generateTaggedPDF:true,generateDocumentOutline:true,displayHeaderFooter:true,
  headerTemplate:'<span></span>',footerTemplate:'<div style="font-size:8px;color:#66756d;text-align:center;width:100%"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  margins:{top:.71,bottom:.71,left:.63,right:.63}};

/** Narrow capability: only the current app main frame, with a user-selected save path. */
export function createLecturePdfHandler({getWindow,getHostUrl,dialog,downloads,write=writeFile}) {
  let busy=false;
  return async(event,filename)=>{
    const win=getWindow(),sender=event.sender;
    let expected;
    try{expected=new URL(getHostUrl()).origin;}catch{return {error:'课堂页面尚未就绪'};}
    const trusted=()=>{
      try{return win&&!win.isDestroyed()&&sender===win.webContents&&event.senderFrame===sender.mainFrame&&new URL(sender.getURL()).origin===expected;}catch{return false;}
    };
    if(!trusted())return {error:'仅允许从当前课堂页面导出'};
    if(busy)return {error:'已有 PDF 正在导出'};
    if(typeof filename!=='string'||filename.length>220)return {error:'导出文件名无效'};
    const safe=filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').replace(/\.pdf$/i,'').slice(0,180)+'.pdf';
    busy=true;
    try{
      const selection=await dialog.showSaveDialog(win,{title:'导出讲义与知识图谱',defaultPath:path.join(downloads(),safe),filters:[{name:'PDF 文档',extensions:['pdf']}],properties:['showOverwriteConfirmation']});
      if(selection.canceled||!selection.filePath)return {canceled:true};
      if(!trusted())return {error:'页面已变化，请重新导出'};
      // Do not print the application if the prepared document disappeared while the dialog was open.
      const ready=await sender.executeJavaScript('!!document.querySelector("#zs-lecture-export .zs-pdf-lecture")');
      if(!ready)return {error:'导出文档已关闭，请重新导出'};
      const bytes=await sender.printToPDF(lecturePdfOptions);
      await write(selection.filePath,bytes);return {canceled:false};
    }catch{return {error:'PDF 未能保存，请检查保存位置后重试'};}
    finally{busy=false;}
  };
}
