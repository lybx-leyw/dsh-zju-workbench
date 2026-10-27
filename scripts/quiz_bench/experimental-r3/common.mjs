import {contentHash} from '../../../packages/dsh-zhiyun-core-quiz/src/concepts.js';
export {contentHash};
export function poolLimit(limit){
 if(!Number.isInteger(limit)||limit<1||limit>512)throw Error('worker数无效');
 let active=0;const queue=[];return work=>new Promise((resolve,reject)=>{
  const run=()=>{active++;Promise.resolve().then(work).then(resolve,reject).finally(()=>{active--;queue.shift()?.();});};
  if(active<limit)run();else queue.push(run);
 });
}
export function serial(){let queue=Promise.resolve();return work=>{const next=queue.then(work);queue=next.catch(()=>{});return next;};}
export const checkStrings=value=>Array.isArray(value)&&value.every(v=>typeof v==='string'&&v.trim());
