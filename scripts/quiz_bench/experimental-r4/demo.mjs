import {mkdir,writeFile} from 'node:fs/promises';
import {runR4} from './run.mjs';
import {graph,model} from './fixture.mjs';
import {compileIdeas} from '../../../packages/dsh-zhiyun-core-quiz/src/engines/r3-v9/compiler.mjs';

const out=new URL('../../../artifacts/quiz-r4-demo/',import.meta.url);await mkdir(out,{recursive:true});
const input=graph(),selected={...input,root:{...input.root,children:input.root.children.slice(0,2)}};
const baseline=model({legacy:true});await compileIdeas({graph:selected,call:baseline.call});
const candidate=model(),result=await runR4({graph:input,pointIds:['a','b'],count:1,compositeCount:1,requestId:'synthetic-cross',call:candidate.call,onCheckpoint:state=>writeFile(new URL('checkpoint.json',out),JSON.stringify(state,null,2))});
const report={synthetic:true,qualityEvaluated:false,requested:result.requested,produced:result.produced,treeComplete:result.treeComplete,v9PreparationCalls:baseline.calls.length,r4PreparationCalls:candidate.calls.filter(c=>c.stage.endsWith('-ideas')).length,r4TotalCalls:candidate.calls.length,unselectedMaterialRead:JSON.stringify(candidate.calls).includes('知识点c'),childIdeasSeenByParent:candidate.calls[0].input.subtree.children.map(c=>c.ideas.length)};
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
