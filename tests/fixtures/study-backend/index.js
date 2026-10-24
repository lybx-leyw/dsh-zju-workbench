// Test-only upstream and deterministic model. Never part of the product profile.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {png,answer} from '../parser/host.mjs';
export const inject=['zhiyunStudy','zhiyunParser','llm','connection','profileContext'];
export async function apply(ctx){
  const require=createRequire(path.join(ctx.profileContext.dir,'package.json'));
  const {LlmAdapter}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href);
  let quizSequence=0;
  class Adapter extends LlmAdapter {
    async listModels(provider){return [{provider,id:'vision',name:'Fixture Vision',inputModalities:['text','image']},{provider,id:'text',name:'Fixture Text',inputModalities:['text']}];}
    async resolveModel(provider,id){return {provider,id,name:id,inputModalities:id==='vision'?['text','image']:['text']};}
    async *stream(options){await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{options.signal.removeEventListener('abort',abort);resolve();},500);const abort=()=>{clearTimeout(timer);reject(options.signal.reason);};options.signal.addEventListener('abort',abort,{once:true});});
      const variable=options.messages[0].content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
      let quizInput;try{quizInput=JSON.parse(options.messages[0].content.filter(b=>b.type==='text').at(-1).text);}catch{}
      if(quizInput?.source&&quizInput?.title&&!quizInput.type){const statement=quizInput.source.split("\n")[0];const blanks=['概率密度函数','概率','函数'].filter(text=>statement.includes(text)&&text.length<=statement.length/2).map(text=>({text,start:statement.indexOf(text)}));yield {type:'text-delta',index:0,text:JSON.stringify({concepts:[{statement,blanks}]})};yield {type:'finish',reason:{kind:'stop'}};return;}
      if(quizInput?.items&&quizInput?.history){yield {type:'text-delta',index:0,text:JSON.stringify({verdicts:quizInput.items.map((_,index)=>({index,valid:true,novel:true}))})};yield {type:'finish',reason:{kind:'stop'}};return;}
      if(quizInput?.source&&quizInput?.count&&['mcq','cloze','trueFalse','shortAnswer'].includes(quizInput.type)){
        const items=Array.from({length:quizInput.count},(_,i)=>({conceptId:quizInput.concepts[0].id,blankId:quizInput.concepts[0].blanks[i%quizInput.concepts[0].blanks.length].id,angle:`记忆：${quizInput.concepts[0].blanks[i%quizInput.concepts[0].blanks.length].text}`,stem:quizInput.type==='mcq'?`哪一项在材料中被明确提及？变式 ${quizSequence++}`:`材料中的函数称为{{c1::概率密度函数}}。变式 ${quizSequence++}`,answer:quizInput.type==='mcq'?'A':'概率密度函数',basis:quizInput.source.slice(0,12),explanation:'请对照所列原文依据。',choices:quizInput.type==='mcq'?[{label:'A',text:'概率密度函数'},{label:'B',text:'线性变换'},{label:'C',text:'特征值'},{label:'D',text:'矩阵秩'}]:[]}));
        for(const item of items){
          if(quizInput.strategy!=='recall')item.angle=`${quizInput.strategy} 的独立分析方向 ${quizSequence++}`;
          if(quizInput.type==='trueFalse'){item.stem=`材料提及了概率密度函数，对吗？${quizSequence++}`;item.answer='正确';item.choices=[];}
          if(quizInput.type==='shortAnswer'){item.stem=quizInput.strategy==='explore'?`设计检验概率分布的实验，说明对照、观测量及评价标准。${quizSequence++}`:`在给定情景中按定义计算，并列出完整步骤。${quizSequence++}`;item.answer='依据材料描述概率密度函数。';item.rubric=['指出研究对象','说明材料依据'];item.choices=[];}
          if(['apply','explore'].includes(quizInput.strategy)){item.solutionPath='从定义建立分析步骤';const parent=quizInput.history.examples.find(q=>q.solutionPath);if(parent&&quizInput.strategy==='apply'){item.parentId=parent.id;item.variantChange='调整事件情景';}}
        }
        yield {type:'text-delta',index:0,text:JSON.stringify({items})};yield {type:'finish',reason:{kind:'stop'}};return;
      }
      const topics=[...variable.matchAll(/^--- c(\d+) t(\d+) ---$/gm)];
      const text=variable.includes('#!section') && variable.includes('##!topic') ? JSON.stringify({edits:[],warnings:[]})
        : topics.length ? JSON.stringify({chapters:topics.map(m=>({c:+m[1],topics:[{t:+m[2],slots:[{kind:'elaboration',text:'旧四史与概率密度函数。'}]}]}))}) : answer(options);yield {type:'text-delta',index:0,text};yield {type:'finish',reason:{kind:'stop'}};
    }
  }
  const unregister=ctx.llm.registerAdapter(['study-fixture','study-second'],new Adapter());
  let user=null;
  const meta={complete:true,version:'fixture'};
  const source={
    getCurrentUser:async()=>user,login:async()=>{user={id:'777',name:'测试同学'};return{user};},logout:async()=>{user=null;},
    listCourses:async()=>({items:[{id:'10',title:'概率论与数理统计',teacher:'测试教师',termName:'2026 秋冬',totalCount:3}],meta}),
    listLessons:async()=>({items:[{id:'10_20',courseId:'10',subId:'20',sourceId:'zhiyun:112:10:20',title:'第一节 · 概率密度函数',isPlayable:true},{id:'10_21',courseId:'10',subId:'21',title:'第二节 · 尚未解析',isPlayable:true},{id:'10_22',courseId:'10',subId:'22',title:'第三节 · 尚未发布',isPlayable:false,status:'2'}],meta}),
    getLessonContent:async(_c,subId)=>({sourceId:`zhiyun:112:10:${subId}`,slides:{items:[{page:1,createdSec:1,startMs:1000,imageBytes:png,mediaType:'image/png',imageUrl:'/api/zhiyun-study-slide'}],meta},subtitles:{items:[{startMs:1234,endMs:2000,text:'旧事史'},{startMs:2200,endMs:3100,text:'概率密度函数'}],meta},slidesProcessingSuspected:false})
  };
  const oldSource=ctx.zhiyunStudy.classroom,oldParserSource=ctx.zhiyunParser.classroom,oldRoutes=ctx.zhiyunParser.llm.routes;
  ctx.zhiyunStudy.classroom=source;ctx.zhiyunParser.classroom=source;
  ctx.zhiyunParser.llm.routes={vision:{provider:'study-fixture',model:'vision'},text:{provider:'study-fixture',model:'text'}};
  const remove=ctx.connection.fetch.register({path:'/api/zhiyun-study-slide',methods:['GET'],requestBody:'buffered',fetch:async()=>new Response(png,{headers:{'content-type':'image/png'}})});
  return async()=>{await remove();unregister();ctx.zhiyunStudy.classroom=oldSource;ctx.zhiyunParser.classroom=oldParserSource;ctx.zhiyunParser.llm.routes=oldRoutes;};
}
