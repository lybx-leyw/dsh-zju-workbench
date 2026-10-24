import React, { useSyncExternalStore } from 'react';
import { PointQuizComposer, QuestionHistory } from './question-bank.jsx';

/** Point-level entry uses exactly the same planner and durable bank as the global page. */
export function QuizPanel({state,controller,onlyBlocks=null,pointTitle=null,pointId=null}) {
  const bank=controller.questionBank, snapshot=useSyncExternalStore(bank.subscribe,bank.getSnapshot,bank.getSnapshot);
  const scope=onlyBlocks?{courseId:state.course?.id,subId:state.lesson?.subId,blockIndexes:onlyBlocks,pointTitle,pointId}:null;
  const pointIds=snapshot.points.filter(p=>String(p.courseId)===String(state.course?.id)&&String(p.subId)===String(state.lesson?.subId)
    &&(pointId?p.id===pointId:(!pointTitle||p.title===pointTitle)&&(!onlyBlocks?.length||p.blockIndexes.some(id=>onlyBlocks.includes(id))))).map(p=>p.id);
  return <div className="zs-quiz"><div className="zs-bank-section-title"><p className="zs-muted">以知识点出题，题目与作答记录统一保存在题库。</p><button type="button" className="zs-button" onClick={()=>bank.open(scope??{courseId:state.course?.id,subId:state.lesson?.subId})}>打开全局题库</button></div>
    <PointQuizComposer controller={controller} scope={scope??{courseId:state.course?.id,subId:state.lesson?.subId}}/>
    <QuestionHistory bank={bank} questions={snapshot.questions.filter(q=>pointIds.includes(q.pointId))}/>
  </div>;
}
