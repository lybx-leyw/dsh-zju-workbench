import React from 'react';
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives';

const labels={code:{copyLabel:'复制',copiedLabel:'已复制'},footnotes:'注释'};
export const kinds={elaboration:['讲解','explain'],definition:['定义','definition'],procedure:['步骤','procedure'],example:['例题','example'],note:['说明','note']};
export const blocksOf=topic=>topic.blocks?.length?topic.blocks:(topic.passages??[]).map(p=>({text:p.text,kind:Object.keys(kinds).find(k=>kinds[k][0]===p.label)??'elaboration'}));
export const kindOf=block=>block.kind?.wire??block.kind??'elaboration';

/** Reading and PDF output share the exact markdown and formula renderer. */
export function LectureBlockBody({block,expanded=false}) {
  if(kindOf(block)!=='example')return <MarkdownText text={block.text??block.displayText??''} labels={labels}/>;
  return <><div className="zs-example-label">题干</div><MarkdownText text={block.stem??''} labels={labels}/>{block.solution?.trim()
    ?expanded?<><div className="zs-example-label">解答</div><MarkdownText text={block.solution} labels={labels}/></>
      :<details className="zs-example-solution"><summary>查看解答</summary><MarkdownText text={block.solution} labels={labels}/></details>
    :<small className="zs-muted">课堂未提供解答</small>}</>;
}
