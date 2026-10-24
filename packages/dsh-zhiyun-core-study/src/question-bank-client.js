/** Long-lived client state and polling; neither depends on the visible page. */
export function createQuestionBankController(request,navigation) {
  const initial=()=>({loading:false,loaded:false,busy:false,points:[],questions:[],sessions:[],picked:[],error:null,notice:null,plan:null,practice:null,answers:{},run:null,runs:[]});
  let state=initial(),epoch=0,loading=null,disposed=false,timer=null,polling=false;
  const listeners=new Set();
  const update=patch=>{if(disposed)return;state={...state,...patch};for(const listener of listeners)listener();};
  const schedule=()=>{clearTimeout(timer);if(!disposed)timer=setTimeout(poll,650);};
  async function poll(){
    if(disposed||!state.run||state.run.state!=='running')return;
    if(polling){schedule();return;}
    const ticket=epoch,runId=state.run.id;polling=true;
    try{
      const status=await request('bank-progress',{runId});
      if(ticket!==epoch||disposed)return;
      update(status);
      if(status.run?.state==='running')schedule();
      else{
        const bank=await request('bank-load');
        if(ticket===epoch&&!disposed)update({...bank,run:state.run?.id===runId?status.run:state.run,notice:status.run?.state==='completed'?`已完成，${status.run.done} 道题已存入题库。`:status.run?.state==='paused'?'已暂停，题目与断点已保存。':'部分题目尚未完成，可从断点重试。'});
      }
    }catch(error){if(ticket===epoch&&!disposed){update({error:error.message});schedule();}}
    finally{polling=false;}
  }
  const controller={
    getSnapshot:()=>state,
    subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
    reset(){epoch++;clearTimeout(timer);loading=null;state=initial();for(const listener of listeners)listener();},
    async load(force=false){
      if(loading)return loading;if(state.busy || state.loaded && !force)return;
      const ticket=epoch;update({loading:true,error:null});
      loading=(async()=>{
        try{
          const [catalog,bank]=await Promise.all([request('bank-catalog'),request('bank-load')]);
          if(ticket===epoch){
            const run=bank.run?.state==='running'?bank.run:bank.runs?.find(run=>run.id===state.run?.id)??bank.run;
            update({points:catalog.points,...bank,run,picked:state.picked.filter(id=>catalog.points.some(p=>p.id===id)),loaded:true});
            if(run?.state==='running')schedule();
          }
        }catch(error){if(ticket===epoch)update({error:error.message});}
        finally{if(ticket===epoch){loading=null;update({loading:false});}}
      })();return loading;
    },
    pick(ids){update({picked:[...new Set(ids)],error:null});},
    async action(method,payload,onSuccess){
      if(state.busy)return null;
      const ticket=epoch;update({busy:true,error:null,notice:null});
      try{const data=await request(method,payload);if(ticket===epoch){await onSuccess(data,ticket);return data;}}
      catch(error){if(ticket===epoch)update({error:error.message});}
      finally{if(ticket===epoch)update({busy:false});}
      return null;
    },
    generate(settings){return controller.action('bank-generate',settings,data=>{update({run:data.run,plan:data.plan,runs:[...state.runs.filter(run=>run.id!==data.run.id),data.run]});schedule();});},
    resume(runId=state.run?.id){return controller.action('bank-resume',{runId},data=>{update({run:data.run,plan:data.plan,runs:state.runs.map(run=>run.id===data.run.id?data.run:run)});schedule();});},
    pause(){return controller.action('bank-pause',{runId:state.run?.id},async(data,ticket)=>{
      clearTimeout(timer);update(data);
      const bank=await request('bank-load');if(ticket===epoch)update({...bank,run:data.run,notice:data.run?.state==='completed'?`已完成，${data.run.done} 道题已存入题库。`:'已暂停，题目与断点已保存。'});
    });},
    selectRun(runId){const run=state.runs.find(run=>run.id===runId);if(run && state.run?.state!=='running'){update({run,notice:null,error:null});if(run.state==='running')schedule();}},
    practice(settings){return controller.action('bank-practice',settings,data=>update({practice:data,answers:{},notice:data.available<data.requested?`可用题目 ${data.available} 道，已全部加入本次练习。`:null}));},
    answer(questionId,response,selfVerdict){return controller.action('bank-answer',{sessionId:state.practice?.session.id,questionId,response,selfVerdict},data=>{
      const questions=state.questions.map(q=>q.id===questionId?{...q,attempts:[...(q.attempts??[]),data.attempt]}:q);
      update({answers:{...state.answers,[questionId]:data},questions});
    });},
    discard(questionId){return controller.action('bank-discard',{questionId},data=>update({questions:data.questions,sessions:data.sessions}));},
    finish(){update({practice:null,answers:{}});},
    async open(scope){
      await controller.load(true);
      if(scope)controller.pick(state.points.filter(p=>String(p.courseId)===String(scope.courseId)&&String(p.subId)===String(scope.subId)
        &&(scope.pointId?p.id===scope.pointId:(!scope.pointTitle||p.title===scope.pointTitle)&&(!scope.blockIndexes?.length||p.blockIndexes.some(id=>scope.blockIndexes.includes(id))))).map(p=>p.id));
      navigation?.navigate?.('quiz');
    },
    dispose(){disposed=true;epoch++;clearTimeout(timer);listeners.clear();},
  };return controller;
}
