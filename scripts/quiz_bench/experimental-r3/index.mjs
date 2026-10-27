export {graphFromRecord,graphFromDataset,inspectGraph} from './graph.mjs';
export {compileIdeas,VERSION} from './compiler.mjs';
export {createScheduler} from './scheduler.mjs';
export {reserveWithExpansion} from './expansion.mjs';
export {createCapsuleStore,projectTeachingBooks} from './capsules.mjs';
export {createQuestionGenerator,validateBranchReview,validateCriticalAudit} from './generator.mjs';
export {atPath,walkTree,reasoningTree,materialTree,sourceParts,taskContext} from './tree.mjs';
export {TOOLS,toolRequest,toolArguments,nodeToolRequest,nodeArguments,failedTool,createToolTransport} from './tools.mjs';

import fs from 'node:fs/promises';
import path from 'node:path';
import {serial} from './common.mjs';
import {writeFileAtomic} from '@deepseek-ai/dsh-atomic-write';
/** Separate experiment state. Never reads or writes the product bank/settings. */
export async function openState(directory){
 const dir=path.resolve(directory);await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'r3-state.json');let current;
 try{current=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;current={};}
 const commit=serial();return {get snapshot(){return structuredClone(current);},update:work=>commit(async()=>{
  const next=await work(structuredClone(current));
  await writeFileAtomic(file,JSON.stringify(next,null,2),{mode:0o600});current=next;
 })};
}
