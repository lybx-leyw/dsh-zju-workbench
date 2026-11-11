// 「题库」页独立成包（`dsh-zhiyun-page-quiz`）之后的自证测试。
//
// 这个包是从 `dsh-zhiyun-page-study` 里拆出来的：拆的时候最容易坏的不是渲染，
// 而是那些**手写清单** —— 少一处不会立刻报错，而是「真机上那一页空白」。
// 所以这里按 docs-page.test.mjs 的形状把四处清单全部钉一遍。

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..', '..');
const pkg = join(root, 'packages', 'client', 'page-quiz');

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
  // ⚠️ 正则里 scope 的 `/` 只需**一层**转义（`\/`）。写成 `\\/` 时
  // `\\` 表示「字面反斜杠」、紧跟的 `/` 提前闭合正则 → 整个文件
  // `Invalid regular expression flags`。批量改包名时踩过。
  // patch 里的 name 值带单引号（YAML 里 `@` 开头必须加引号，否则解析失败）。
  assert.match(patch, /name: '@lybx-leyw\/dsh-zju-page-quiz'/);

  // 4. 进构建清单与 profile 装载清单。
  const build = await readFile(join(root, 'scripts', 'build.mjs'), 'utf8');
  assert.ok(build.includes("'page-quiz'"),
    'scripts/build.mjs 的 CLIENT_PACKAGES 里没有本包 —— 那条注释说的就是这件事：漏了不会报错，只会白屏');

  const profile = JSON.parse(await readFile(
    join(root, 'profiles', 'zju-workbench', 'package.json'), 'utf8'));
  assert.ok(profile.dsh.profile.bundles.includes('@lybx-leyw/dsh-zju-page-quiz'),
    'profiles/zju-workbench/package.json 的 bundles 里没有本包');
});

test('client.jsx 注册的页面 id 与 NAV 里的 id 一致', async () => {
  const client = await readFile(join(pkg, 'src', 'client.jsx'), 'utf8');
  // 迁移后页面自己注册 `page.content`，key 就是页面 id（不再有 `zhiyun.<id>.content`）。
  assert.match(client, /id: '([a-z]+)'/);
  const id = /id: '([a-z]+)'/.exec(client)[1];
  assert.equal(id, 'quiz');

  // NAV 的唯一真相在 ui-shared。归档包里的 model.js 只是一句转发注释，读它拿不到 NAV。
  const model = await readFile(
    join(root, 'packages', 'client', 'ui-shared', 'src', 'pages-model.js'), 'utf8');
  assert.ok(model.includes(`id: '${id}'`), `model.js 的 NAV 里没有 id: '${id}'`);
  // 静态清单 `FULL_BLEED_PAGES` 只有 notes / docs —— 题库不进去。
  const fullBleed = /FULL_BLEED_PAGES = Object\.freeze\(\[([^\]]*)\]/.exec(model);
  assert.ok(fullBleed, 'model.js 里找不到 FULL_BLEED_PAGES');
  assert.ok(!fullBleed[1].includes("'quiz'"), '题库页不该进 FULL_BLEED_PAGES');
  // 但页面**自己**要声明 `fullBleed: true`。
  //
  // 这条与上一行不矛盾，两者管的是不同的事：
  //   - `FULL_BLEED_PAGES` 是旧外壳的静态清单（已无运行时消费者）；
  //   - `registerPageContent({ fullBleed })` 是 `PageFrame` 的实际入参。
  //
  // 题库是应用型页面（CSS 里有 15 处 `height:100%` / `overflow` 布局信号），
  // 必须走 `contentFlush` 才能自己管高度；不声明的话外壳会强塞 720px 内联
  // 版心，把它压成窄栏。它**内部**仍用 `max-width: 900px; margin: 0 auto`
  // 保持阅读宽度 —— 版心由页面自己给，不再靠外壳。
  assert.ok(/fullBleed: true/.test(client), '题库页应声明 fullBleed（应用型页面，自己管布局与高度）');
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
  assert.ok(
    !quizManifest.dsh.client.external.some((d) => d === 'dsh-zhiyun-page-study' || d === '@lybx-leyw/dsh-zju-page-study'),
    '题库包不该把学习页声明成 external 依赖');

  // 学习页这一侧**不再**把题库包声明成 external —— 它已改成按契约名取组件
  // （`usePublishedComponent('quiz.generationModels')`），两边不再互相 import。
  // 反过来钉住：不能又偷偷 import 回去，那会把两页重新焊在一起。
  const studyManifest = JSON.parse(await readFile(
    join(root, 'packages', 'client', 'page-study', 'package.json'), 'utf8'));
  assert.ok(
    !studyManifest.dsh.client.external.some((d) => d === 'dsh-zhiyun-page-quiz' || d === '@lybx-leyw/dsh-zju-page-quiz'),
    '学习页不该再把题库包声明成 external —— 页面之间靠契约名，不靠 import');
  for (const file of ['client.jsx', 'knowledge-board.jsx', 'teaching-generate.jsx']) {
    const source = await readFile(join(root, 'packages', 'client', 'page-study', 'src', file), 'utf8');
    assert.ok(!/from\s+['"](dsh-zhiyun-page-quiz|@lybx-leyw\/dsh-zju-page-quiz)['"]/.test(source),
      `${file} 又直接 import 了题库页 —— 页面之间不许互相认识`);
  }
});

test('学习页不再自己注册题库内容槽', async () => {
  // 迁移到 dsh-pages 后，每个页面包各自把内容注册到页面壳的 `page.content`
  // （key 是自己的页面 id），不再有 `zhiyun.<id>.content` 这层子槽。
  // 这条守卫的**本意**仍在：题库只能有一个注册者。
  const studyClient = await readFile(
    join(root, 'packages', 'client', 'page-study', 'src', 'client.jsx'), 'utf8');
  assert.ok(!studyClient.includes("id: 'quiz'"),
    '学习页也在注册 quiz 页内容，会和题库包抢同一个 key');

  const quizClient = await readFile(join(pkg, 'src', 'client.jsx'), 'utf8');
  assert.ok(quizClient.includes("id: 'quiz'"));
});
