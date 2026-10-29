// 「题库」页独立成包（`dsh-zhiyun-page-quiz`）之后的自证测试。
//
// 这个包是从 `dsh-zhiyun-page-study` 里拆出来的：拆的时候最容易坏的不是渲染，
// 而是那些**手写清单** —— 少一处不会立刻报错，而是「真机上那一页空白」。
// 所以这里按 docs-page.test.mjs 的形状把四处清单全部钉一遍。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pkg = join(root, 'packages', 'dsh-zhiyun-page-quiz');

test('包声明与接线清单四处对齐', async () => {
  const manifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));

  // 1. 有浏览器半边就必须有 exports["./client"]，否则宿主组装客户端模块表时
  //    直接抛「declares dsh.client but exports no "./client" bundle」并拒启整个工作台。
  assert.ok(manifest.dsh?.client, 'package.json 缺少 dsh.client 声明');
  assert.equal(manifest.exports['./client'], './lib/client.js');
  assert.equal(manifest.main, './src/index.js');

  // 2. 宿主半边入口存在（纯页面是空壳，但 Loader 要能扫到它）。
  assert.ok((await readFile(join(pkg, 'src', 'index.js'), 'utf8')).includes("'zhiyun-page-quiz'"));

  // 3. cordis.patch.yml 指向正确的 id。
  const patch = await readFile(join(pkg, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /id: zhiyun-page-quiz/);
  assert.match(patch, /name: dsh-zhiyun-page-quiz/);

  // 4. 进构建清单与 profile 装载清单。
  const build = await readFile(join(root, 'scripts', 'build.mjs'), 'utf8');
  assert.ok(build.includes("'dsh-zhiyun-page-quiz'"),
    'scripts/build.mjs 的 CLIENT_PACKAGES 里没有本包 —— 那条注释说的就是这件事：漏了不会报错，只会白屏');

  const profile = JSON.parse(await readFile(
    join(root, 'profiles', 'zhiyun-bench', 'package.json'), 'utf8'));
  assert.ok(profile.dsh.profile.bundles.includes('dsh-zhiyun-page-quiz'),
    'profiles/zhiyun-bench/package.json 的 bundles 里没有本包');
});

test('client.jsx 用的插槽名与 NAV 里的 id 一致', async () => {
  const client = await readFile(join(pkg, 'src', 'client.jsx'), 'utf8');
  // plugins-page.test.mjs 用 /'zhiyun\.([a-z]+)\.content'/ 扫这个字面量，只认小写字母。
  assert.match(client, /'zhiyun\.([a-z]+)\.content'/);
  const id = /'zhiyun\.([a-z]+)\.content'/.exec(client)[1];
  assert.equal(id, 'quiz');

  const model = await readFile(
    join(root, 'packages', 'dsh-zhiyun-shell-workbench', 'src', 'model.js'), 'utf8');
  assert.ok(model.includes(`id: '${id}'`), `model.js 的 NAV 里没有 id: '${id}'`);
  // 题库页是正常版心，不是整幅铺开 —— 反过来写进 FULL_BLEED_PAGES 会让它失去居中版心。
  const fullBleed = /FULL_BLEED_PAGES = Object\.freeze\(\[([^\]]*)\]/.exec(model);
  assert.ok(fullBleed, 'model.js 里找不到 FULL_BLEED_PAGES');
  assert.ok(!fullBleed[1].includes("'quiz'"), '题库页不该进 FULL_BLEED_PAGES');
});

test('两个页面包之间只有一条单向依赖：study → quiz', async () => {
  // 拆分时把 `quiz-panel.jsx` 与 `generation-models.jsx` 留在学习页，但它俩
  // 现在只作为「题库包的再导出」存在，学习页从题库包 import 它们。
  // 如果哪天题库包反过来 import 学习页，客户端模块加载图就会成环
  // （`client-modules: module arrival cycle`），真机上是整页不渲染。
  // 只看真的 import/require，不看注释 —— 注释里提到「原本住在 page-study」是好事，
  // 那种历史说明不该被这条测试判成环。
  const quizFiles = ['client.jsx', 'question-bank.jsx', 'question-history.jsx',
    'question-generation-progress.jsx', 'quiz-panel.jsx', 'generation-models.jsx'];
  const importsStudy = /(?:from|require\()\s*['"]dsh-zhiyun-page-study/;
  for (const file of quizFiles) {
    const source = await readFile(join(pkg, 'src', file), 'utf8');
    assert.ok(!importsStudy.test(source),
      `${file} 反向 import 了 dsh-zhiyun-page-study，客户端加载图会成环`);
  }

  const quizManifest = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
  assert.ok(!quizManifest.dsh.client.external.includes('dsh-zhiyun-page-study'),
    '题库包不该把学习页声明成 external 依赖');

  // 学习页这一侧要真的用上题库包（否则 external 声明过期，build-seeds 也会红）。
  const studyManifest = JSON.parse(await readFile(
    join(root, 'packages', 'dsh-zhiyun-page-study', 'package.json'), 'utf8'));
  assert.ok(studyManifest.dsh.client.external.includes('dsh-zhiyun-page-quiz'),
    '学习页没有把题库包声明成 external —— 它 import 了 quiz-panel.jsx / generation-models.jsx');
});

test('学习页不再自己注册题库内容槽', async () => {
  // 拆分前 `zhiyun.quiz.content` 由 page-study 注册；现在由题库包注册。
  // 两边都注册的话 `kind:'single'` 的槽会被抢占，表现是「点进去看运气」。
  const studyClient = await readFile(
    join(root, 'packages', 'dsh-zhiyun-page-study', 'src', 'client.jsx'), 'utf8');
  assert.ok(!studyClient.includes("'zhiyun.quiz.content'"),
    '学习页还在注册 zhiyun.quiz.content，会和题库包抢同一个 single 槽');

  const quizClient = await readFile(join(pkg, 'src', 'client.jsx'), 'utf8');
  assert.ok(quizClient.includes("'zhiyun.quiz.content'"));
});
