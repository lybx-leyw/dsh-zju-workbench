import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPolishPatch } from '../packages/dsh-zhiyun-core-lecture/src/polish-patch.js';
import { createLectureAssembler } from '../packages/dsh-zhiyun-core-lecture/src/polish.js';
const text = '#!section s 课\n##!topic 1 1 | 标题\n>>> BLOCK 讲解 | ref=c1t1b1 | src=1\n甲乙丙。\n>>> BLOCK 例题 | ref=c1t1b2 | src=2\n甲乙丙。\n>>> SOLUTION\n解答。';
const patch = edits => JSON.stringify({ edits });

test('允许删除冗余片段，拒绝清空来源块、题干或解答', () => {
  assert.equal(applyPolishPatch(text, patch([{ref:'placeholder',before:'',after:''},{ref:'c1t1b1',before:'乙',after:'丁'}])), text.replace('甲乙丙。','甲丁丙。'));
  assert.equal(applyPolishPatch(text, patch([{ref:'c1t1b1',before:'乙',after:''}])), text.replace('甲乙丙。','甲丙。'));
  for (const [ref,before] of [['c1t1b1','甲乙丙。'],['c1t1b2','甲乙丙。'],['c1t1b2','解答。']]) {
    assert.throws(() => applyPolishPatch(text, patch([{ref,before,after:''}])), {code:'FORMAT'});
  }
});
test('局部终审保留所有协议和未改正文，匹配限定于 ref', () => {
  assert.equal(applyPolishPatch(text, patch([{ref:'c1t1b1', before:'乙', after:'丁'}])), text.replace('甲乙丙。', '甲丁丙。'));
  assert.equal(applyPolishPatch(text, patch([])), text);
});
test('产品终审只请求补丁，应用后仍调用原有全文校验', async () => {
  let calls = 0, merges = 0;
  const assembler = createLectureAssembler({llm:{async call(request){
    calls++; assert.match(request.constant,/不要重发全文/);
    return {text:patch([{ref:'c1t1b1',before:'乙',after:'丁'}])};
  }}});
  try {
    const out = await assembler.polish({lecture:{chapters:[{}]},text,merge:result=>{
      merges++; assert.equal(result,text.replace('甲乙丙。','甲丁丙。'));return {coverage:{unitsCovered:2}};
    }});
    assert.equal(calls,1); assert.equal(merges,1); assert.equal(out.coverage.unitsCovered,2);
  } finally {assembler.dispose();}
});
test('无修改补丁仍验证原稿覆盖，不请求第二次', async () => {
  let calls=0, merges=0;
  const assembler=createLectureAssembler({llm:{async call(){calls++;return {text:patch([])};}}});
  try {
    const out=await assembler.polish({lecture:{chapters:[{}]},text,merge:t=>{merges++;assert.equal(t,text);return {};}});
    assert.equal(out.unchanged,true);assert.equal(calls,1);assert.equal(merges,1);
  }finally{assembler.dispose();}
});
test('拒绝未知来源、协议改写、重复匹配和重叠，原稿不会部分应用', () => {
  for (const edits of [
    [{ref:'unknown',before:'乙',after:'丁'}],
    [{ref:'c1t1b1',before:'乙',after:'>>> BLOCK 新块'}],
    [{ref:'c1t1b1',before:'不存在',after:'丁'}],
    [{ref:'c1t1b1',before:'甲乙',after:'丁'}, {ref:'c1t1b1',before:'乙丙',after:'戊'}],
  ]) assert.throws(() => applyPolishPatch(text,patch(edits)), {code:'FORMAT'});
  assert.throws(() => applyPolishPatch(text.replace('甲乙丙。','乙乙'),patch([{ref:'c1t1b1',before:'乙',after:'丁'}])), {code:'FORMAT'});
});

test('题干本来就空的例题不算“被清空”，但把它唯一的解答删掉仍要拒', () => {
  const bare = '#!section s 课\n##!topic 1 1 | 标题\n>>> BLOCK 例题 | ref=c1t1b2 | src=2\n>>> SOLUTION\n解答。';
  assert.equal(applyPolishPatch(bare, patch([{ref:'c1t1b2',before:'解答',after:'答案'}])), bare.replace('解答。','答案。'));
  assert.throws(() => applyPolishPatch(bare, patch([{ref:'c1t1b2',before:'解答。',after:''}])), {code:'FORMAT'});
});
