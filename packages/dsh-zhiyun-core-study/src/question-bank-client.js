/** Long-lived client state and polling; neither depends on the visible page. */
export function createQuestionBankController(request,navigation) {
  const initial=()=>({loading:false,loaded:false,busy:false,points:[],questions:[],sessions:[],picked:[],error:null,notice:null,plan:null,practice:null,answers:{},run:null,runs:[]});
  let state=initial(),epoch=0,loading=null,disposed=false,timer=null,polling=false,discardQueue=Promise.resolve();
  const discardOverlay=new Map();
  const listeners=new Set();
  const update=patch=>{if(disposed)return;if(patch.questions){const questions=patch.questions.map(q=>discardOverlay.has(q.id)?{...q,status:'rejected',discardReason:'user'}:q),active=questions.filter(q=>q.status!=='rejected');patch={...patch,questions,coverage:{...(patch.coverage??state.coverage),questions:active.length,points:new Set(active.map(q=>q.pointKey??q.pointId)).size,concepts:new Set(active.map(q=>q.conceptId).filter(Boolean)).size,angles:new Set(active.filter(q=>q.angle).map(q=>JSON.stringify([q.pointKey??q.pointId,q.angle]))).size,families:new Set(active.map(q=>q.familyId).filter(Boolean)).size}};}state={...state,...patch};for(const listener of listeners)listener();};
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
    reset(){epoch++;discardOverlay.clear();discardQueue=Promise.resolve();clearTimeout(timer);loading=null;state=initial();for(const listener of listeners)listener();},
    async load(force=false){
      if(loading)return loading;if(state.busy || state.loaded && !force)return;
      const ticket=epoch;update({loading:true,error:null});
      loading=(async()=>{
        try{
          const [catalog,bank]=await Promise.all([request('bank-catalog'),request('bank-load')]);
          if(ticket===epoch){
            const run=bank.run?.state==='running'?bank.run:bank.runs?.find(run=>run.id===state.run?.id)??bank.run;
            update({points:catalog.points,engines:catalog.engines??[],...bank,run,picked:state.picked.filter(id=>catalog.points.some(p=>p.id===id)),loaded:true});
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
    discard(questionId){return controller.discardMany([questionId]);},
    discardMany(questionIds){
      const ticket=epoch,ids=[...new Set(questionIds)].filter(id=>state.questions.some(q=>q.id===id&&q.status!=='rejected'));
      if(!ids.length)return Promise.resolve(null);
      const before=new Map(state.questions.filter(q=>ids.includes(q.id)).map(q=>[q.id,{status:q.status,discardReason:q.discardReason}]));
      ids.forEach(id=>discardOverlay.set(id,{pending:true}));
      update({questions:state.questions,discardRevision:(state.discardRevision??0)+1,error:null,notice:`已移至已弃用 · ${ids.length} 道，正在保存…`});
      const work=discardQueue.then(async()=>{
        if(ticket!==epoch||disposed)return null;
        try{const data=await request('bank-discard',{questionIds:ids});if(ticket!==epoch||disposed)return null;
          ids.forEach(id=>discardOverlay.set(id,{pending:false}));update({questions:data.questions,sessions:data.sessions,notice:`已弃用 ${ids.length} 道题`});return data;
        }catch(error){if(ticket===epoch&&!disposed){ids.forEach(id=>discardOverlay.delete(id));update({questions:state.questions.map(q=>before.has(q.id)?{...q,...before.get(q.id)}:q),notice:null,error:'弃用未保存，已恢复：'+error.message});}return null;}
      });discardQueue=work.catch(()=>{});return work;
    },
    blockPosition(question){return controller.action('bank-curate',{materialKey:question.materialKey,type:'block-position',conceptId:question.conceptId,blankId:question.blankId},()=>update({notice:'已停用此挖空位置，后续出题将跳过；历史题目保留。'}));},
    /**
     * 把选中的题目导出到笔记库。
     *
     * 与 `discardMany` 的差别：导出**不**做乐观更新 —— 它不改本地题目状态，
     * 只产生一个外部副作用（往笔记库写文件）。失败时没有可回滚的东西，
     * 所以这里直接抛给调用方，由界面如实显示。
     *
     * @param {string[]} questionIds 用户勾选的题目
     * @returns {Promise<{path:string,name:string,folder:string,deduped:boolean,count:number,groups:number}|null>}
     */
    async exportQuestions(questionIds){
      const ids=[...new Set(Array.isArray(questionIds)?questionIds:[])].filter(id=>typeof id==='string');
      if(!ids.length)return null;
      try{
        const data=await request('bank-export',{questionIds:ids});
        return data;
      }catch(error){
        // 导出失败不写进 state.error：那个位置是给「题库加载失败」用的，
        // 混在一起会让用户以为整个题库不可用。由调用方在局部提示。
        throw error;
      }
    },
    finish(){update({practice:null,answers:{}});},
    async openSource(question){
      try{await controller.load(true);const point=state.points.find(p=>p.id===question.pointId);if(!point)throw new Error('讲义已换版或不可用，请查看题目中保存的原文依据。');await navigation?.openSource?.(question,point);}
      catch(error){update({error:error.message});}
    },
    async open(scope){
      await controller.load(true);
      if(scope)controller.pick(state.points.filter(p=>String(p.courseId)===String(scope.courseId)&&String(p.subId)===String(scope.subId)
        &&(scope.pointId?p.id===scope.pointId:(!scope.pointTitle||p.title===scope.pointTitle)&&(!scope.blockIndexes?.length||p.blockIndexes.some(id=>scope.blockIndexes.includes(id))))).map(p=>p.id));
      navigation?.navigate?.('quiz');
    },
    dispose(){disposed=true;epoch++;clearTimeout(timer);listeners.clear();},
  };return controller;
}
