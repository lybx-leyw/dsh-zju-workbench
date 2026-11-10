import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareCase,runComparison} from '../scripts/quiz_bench/experimental-r3/compare.mjs';

/**
 * 冻结清单（`CANDIDATE.json`）与磁盘内容必须一致。
 *
 * # 为什么这条测试必须存在
 *
 * 这三个 manifest 是**实验可复现性的唯一凭据**：它们说「这批评测跑的就是这些字节」。
 * 而在此之前，r1 有 `tests/quiz-lab-r2.test.mjs` 守着、r2 完全没有、r3 只靠
 * `compare.mjs` 里 `spec.kind==='formal'` 分支内的一段检查 —— **没有任何单元测试
 * 能走到那里**（唯一碰 formal 的用例在更早的「空目录」守卫就抛了）。
 *
 * 代价是真实发生过的：r3 的 13 条摘要有 11 条在 2026-11-08 的目录重构后对不上，
 * 而形式评测路径因此**在所有平台都永久失败**，却没有任何测试变红。
 *
 * # 口径
 *
 * 摘要按**仓库 blob（LF）**测，不按磁盘原始字节：Windows 上 `core.autocrlf=true`
 * 会把工作区检出成 CRLF，直接哈希原始字节会让同一份代码在本地假失败。
 * 与 `tests/quiz-app-engines.test.mjs`、`tests/quiz-lab.test.mjs`、
 * `tests/quiz-lab-r2.test.mjs` 用的是同一个口径。
 */
const hashOf = async (p) => createHash('sha256')
  .update(Buffer.from((await fs.readFile(p, 'utf8')).replace(/\r\n/g, '\n')))
  .digest('hex');

const MANIFESTS = [
  ['r1', 'scripts/quiz_bench/experimental/CANDIDATE.json', 'scripts/quiz_bench/experimental/'],
  ['r2', 'scripts/quiz_bench/experimental-r2/CANDIDATE.json', ''],   // 键里已含完整相对路径
  ['r3', 'scripts/quiz_bench/experimental-r3/CANDIDATE.json', 'scripts/quiz_bench/experimental-r3/'],
];

for (const [label, manifestPath, prefix] of MANIFESTS) {
  test(`${label} 的冻结摘要与磁盘内容逐一对得上`, async () => {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.ok(manifest.files && Object.keys(manifest.files).length > 0, `${label} 的 files 为空`);
    const bad = [];
    for (const [file, expected] of Object.entries(manifest.files)) {
      // r2 的键本身就是仓库相对路径；其余两类是相对各自目录的文件名
      const full = prefix === '' ? file : prefix + file;
      const actual = await hashOf(full);
      if (actual !== expected) bad.push(`${file}: 期望 ${expected.slice(0, 12)}… 实际 ${actual.slice(0, 12)}…`);
    }
    assert.deepEqual(bad, [],
      `${label} 的冻结清单与磁盘不一致（重定基线时请记录 rebasedFrom/rebasedReason）：\n${bad.join('\n')}`);
  });
}

test('重定基线必须留下可追溯的记录', async () => {
  // 只改摘要、不写原因，等于把「意外副作用」洗成「刻意冻结」。
  // 三个 manifest 都是因 a96e5e94 的目录重构而重定，必须能看出这一点。
  for (const [label, manifestPath] of MANIFESTS) {
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    assert.equal(typeof manifest.rebasedFrom, 'string',
      `${label} 缺少 rebasedFrom —— 重定基线必须写明从哪个提交重定的`);
    assert.match(manifest.rebasedReason ?? '', /a96e5e94|LF|regroup/,
      `${label} 的 rebasedReason 没有说明原因`);
  }
});

test('three-way input bridge preserves r3 hierarchy and gives both legacy arms the same page information',async()=>{
 const root=path.resolve('artifacts'),directory=await fs.mkdtemp(path.join(root,'quiz-compare-test-'));
 try{
  const graph={id:'fixture',root:{id:'root',title:'课程',children:[{id:'chapter',title:'章',children:[{id:'a',title:'甲',text:'甲节点自己的完整定稿正文。',pages:[{page:3,text:'相关页面的完整文字。',visual:'相关页的图形细节。'}],children:[]},{id:'b',title:'乙',text:'乙节点自己的完整定稿正文。',children:[]}]}]}};
  const source=path.join(directory,'graph.json');await fs.writeFile(source,JSON.stringify(graph));
  const c=await prepareCase({id:'case',source,select:[0],firstChildren:2});
  assert.equal(c.graph.root.id,'chapter');assert.equal(c.graph.root.children[0].text,graph.root.children[0].children[0].text);
  assert.equal(c.graph.root.children[0].pages[0].visual,'相关页的图形细节。');
  assert.match(c.dataset.points[0].text,/甲节点自己的完整定稿正文/);assert.match(c.dataset.points[0].text,/相关页面的完整文字/);assert.match(c.dataset.points[0].text,/相关页的图形细节/);
  assert.equal(c.dataset.points[0].id,c.leaves[0].id);assert.match(c.materialHash,/^[a-f0-9]{64}$/);
 }finally{assert.equal(path.dirname(directory),root);await fs.rm(directory,{recursive:true,force:true});}
});

test('formal comparison refuses a pre-populated output before any model request',async()=>{
 const root=path.resolve('artifacts'),directory=await fs.mkdtemp(path.join(root,'quiz-formal-guard-'));
 try{
  await fs.writeFile(path.join(directory,'prior-cache.json'),'{}');
  await assert.rejects(runComparison({spec:{kind:'formal'},out:directory,credentials:{}}),/空目录与冷缓存/);
  assert.equal(await fs.readFile(path.join(directory,'prior-cache.json'),'utf8'),'{}');
 }finally{assert.equal(path.dirname(directory),root);await fs.rm(directory,{recursive:true,force:true});}
});

test('comparison cannot write experiment data outside the ignored artifact root',async()=>{
 await assert.rejects(runComparison({spec:{},out:'docs/show',credentials:{}}),/artifacts 下的独立目录/);
});
