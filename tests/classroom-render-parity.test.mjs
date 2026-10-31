// classroom-render-parity 的闸门自测。
//
// 这个文件钉的是「真凭据」的三件事：
//   1. render —— 上游 renderer 与 vendor renderer 对同一张幻灯片抽出的文本多重集相等；
//   2. html   —— 导出产物覆盖文档里每个场景的标题与正文（缺场景/缺字要红）；
//   3. pptx   —— 页数 = 可导出场景数，每页文本覆盖该场景，OMML 数 = LaTeX 数。
//
// 分级语义：
//   identical  —— 三件事全中；
//   divergent  —— 产物与文档对不上（删场景、改字），必须指出第几个/哪一段；
//   broken     —— 输入坏了、渲不出来、zip 解不开。
//
// 跑法：`node --test tests/classroom-render-parity.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { main, runParity, formatReport } from '../scripts/classroom-render-parity.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FIXTURE = path.join(ROOT, 'fixtures', 'classroom-render-parity', 'classroom.json');
const SCRIPT = path.join(ROOT, 'scripts', 'classroom-render-parity.mjs');

// ── 装置 ────────────────────────────────────────────────────────────────────

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'classroom-render-parity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE, 'utf8'));
}

/** 把改过的文档落盘，返回路径（判分仍以 fixture 为基准）。 */
async function writeDoc(t, mutate) {
  const dir = await tempDir(t);
  const doc = await loadFixture();
  mutate(doc);
  const file = path.join(dir, 'classroom.json');
  await writeFile(file, JSON.stringify(doc, null, 2));
  return file;
}

function cli(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function slideScene(doc, index = 0) {
  return doc.scenes.filter((scene) => scene.type === 'slide')[index];
}

// ── 1. 基线：三件事全中 ─────────────────────────────────────────────────────

test('fixture 自比 → identical，三件事都过（render / html / pptx）', async () => {
  const report = await runParity();

  assert.equal(report.status, 'identical');
  assert.equal(report.dimensions.render.status, 'identical');
  assert.equal(report.dimensions.html.status, 'identical');
  assert.equal(report.dimensions.pptx.status, 'identical');

  // 真实数字：5 个场景（2 张幻灯片 + quiz + interactive + pbl），5 页，1 个 OMML。
  assert.equal(report.numbers.scenes, 5);
  assert.equal(report.numbers.slideScenes, 2);
  assert.equal(report.numbers.pages, 5);
  assert.equal(report.numbers.omml, 1);
  assert.ok(report.numbers.renderTextNodes > 0, '双渲染应该抽出文本节点');
  assert.ok(report.numbers.htmlBytes > 10_000, 'html 应该是完整单文件产物');
  assert.ok(report.numbers.pptxBytes > 10_000, 'pptx 应该是非空容器');

  // render 维度逐张幻灯片都逐字节相同，且确实用了两套实现（不是自比）。
  for (const scene of report.dimensions.render.scenes) {
    assert.equal(scene.markupIdentical, true, `${scene.title} 的 markup 不一致`);
    assert.deepEqual(scene.markupBytes[0], scene.markupBytes[1]);
  }
  const react = report.environment.react;
  assert.equal(react.aliased, true, '上游 React 与仓库根不是同一份，应报告 alias');
  assert.match(react.upstream, /ref\/OpenMAIC/);
  assert.match(react.loader, /module\.register/);

  const run = cli();
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /结论: identical/);
  assert.match(run.stdout, /5 页 = 5 个可导出场景/);
  assert.match(run.stdout, /1 个 OMML/);

  const json = cli('--json');
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.status, 'identical');
  assert.equal(parsed.numbers.pages, 5);
  assert.equal(parsed.dimensions.html.manifest.scenes, 5);
});

// ── 2. 删一个场景 → divergent，并指出第几个 ─────────────────────────────────

test('删掉一个场景 → divergent，并指出是第几个场景', async (t) => {
  const docPath = await writeDoc(t, (doc) => {
    doc.scenes = doc.scenes.filter((scene) => scene.type !== 'pbl');
  });

  const report = await runParity({ docPath });
  assert.equal(report.status, 'divergent');
  // 幻灯片没动：两套 renderer 仍然一致（维度 1 是「实现比」，不是「内容比」）。
  assert.equal(report.dimensions.render.status, 'identical');

  assert.equal(report.dimensions.html.status, 'divergent');
  const missing = report.dimensions.html.differences.find((entry) => entry.kind === 'missing-scene');
  assert.ok(missing, `应报缺场景，实际：${JSON.stringify(report.dimensions.html.differences)}`);
  assert.equal(missing.index, 3, 'pbl 在 fixture 里是第 4 个场景（0 基 3）');
  assert.equal(missing.type, 'pbl');

  assert.equal(report.dimensions.pptx.status, 'divergent');
  const pages = report.dimensions.pptx.differences.find((entry) => entry.kind === 'page-count');
  assert.deepEqual([pages.pages, pages.expected], [4, 5]);

  const run = cli('--doc', docPath);
  assert.equal(run.code, 1);
  assert.match(run.stdout, /@场景4\(pbl\) 产物里缺失/);
  assert.match(run.stdout, /页数 4 期望 5/);
});

// ── 3. 改一个字 → divergent，给出差异片段 ───────────────────────────────────

test('改一个字 → divergent，并给出差异片段', async (t) => {
  const docPath = await writeDoc(t, (doc) => {
    const body = slideScene(doc).content.canvas.elements.find((element) => element.id === 'body');
    body.content = body.content.replace('把光能转成化学能。', '把光能转成电能。');
  });

  const report = await runParity({ docPath });
  assert.equal(report.status, 'divergent');
  assert.equal(report.dimensions.render.status, 'identical', '两套 renderer 对改后的文本仍应一致');

  const html = report.dimensions.html;
  assert.equal(html.status, 'divergent');
  const first = html.differences.find((entry) => entry.firstDifference);
  assert.ok(first, 'html 维度应给出首个差异');
  assert.equal(first.index, 0, '第 1 个场景（slide）');
  assert.equal(first.firstDifference.a, '把光能转成化学能。');
  assert.equal(first.firstDifference.b, '把光能转成电能。');
  assert.match(first.firstDifference.contextA, /把光能转成化学能。/);
  assert.equal(html.coveredLines, html.expectedLines - 1, '只丢一行');

  const pptx = report.dimensions.pptx;
  assert.equal(pptx.status, 'divergent');
  assert.equal(pptx.differences[0].page, 1);
  assert.match(pptx.differences[0].missingLines[0], /把光能转成化学能。/);

  const run = cli('--doc', docPath);
  assert.equal(run.code, 1);
  assert.match(run.stdout, /文档=把光能转成化学能。/);
  assert.match(run.stdout, /产物=把光能转成电能。/);
});

// ── 4. 换序 → equivalent（不是 divergent）─────────────────────────────────

test('场景换序 → equivalent，退出码 0', async (t) => {
  const docPath = await writeDoc(t, (doc) => {
    const orders = [2, 0, 4, 1, 3];
    doc.scenes.forEach((scene, index) => { scene.order = orders[index]; });
  });

  const report = await runParity({ docPath });
  assert.equal(report.status, 'equivalent', JSON.stringify(report.dimensions, null, 2).slice(0, 800));
  assert.equal(report.dimensions.html.status, 'equivalent');
  assert.equal(report.dimensions.pptx.status, 'equivalent');
  // 内容没变，行覆盖仍然是满分。
  assert.equal(report.dimensions.html.coveredLines, report.dimensions.html.expectedLines);

  const run = cli('--doc', docPath);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /结论: equivalent/);
});

// ── 5. 坏输入 → broken ─────────────────────────────────────────────────────

test('坏输入 → broken：JSON 坏了 / 幻灯片没有 canvas', async (t) => {
  const dir = await tempDir(t);
  const broken = path.join(dir, 'broken.json');
  await writeFile(broken, '{ "stage": {}, "scenes": [');

  const report = await runParity({ docPath: broken });
  assert.equal(report.status, 'broken');
  assert.equal(report.dimensions.read.status, 'broken');
  assert.match(report.dimensions.read.error, /doc:/);

  const run = cli('--doc', broken);
  assert.equal(run.code, 1);
  assert.match(run.stdout, /结论: broken/);

  const noCanvas = await writeDoc(t, (doc) => {
    doc.scenes[0].content.canvas = null;
  });
  const second = await runParity({ docPath: noCanvas });
  assert.equal(second.status, 'broken');
  assert.equal(second.dimensions.render.status, 'broken');
  assert.match(second.dimensions.render.error, /没有 content\.canvas/);

  // 缺 scenes 数组也是坏输入，而不是「零场景」的假 identical。
  const empty = await writeDoc(t, (doc) => { delete doc.scenes; });
  assert.equal((await runParity({ docPath: empty })).status, 'broken');
});

test('用法错误 → 退出码 2；--json 与文本报告状态一致', async () => {
  assert.equal(cli('--nope').code, 2);
  assert.equal(cli('--doc').code, 2);
  assert.equal(cli('--help').code, 0);

  const report = await runParity({ docPath: path.join(ROOT, 'fixtures', 'classroom-render-parity', 'classroom.json') });
  const text = formatReport(report);
  assert.match(text, /render\s+identical/);
  assert.match(text, /html\s+identical/);
  assert.match(text, /pptx\s+identical/);
  assert.match(text, /结论: identical/);

  const sink = { text: '', write(chunk) { this.text += chunk; } };
  const code = await main(['--json'], { stdout: sink, stderr: sink });
  assert.equal(code, 0);
  assert.equal(JSON.parse(sink.text).status, 'identical');
});

// ── 5. 双渲染确实跑了两套实现 ───────────────────────────────────────────────

test('render 维度来自两套独立的 dist，且 React 收敛到同一实例', async () => {
  const report = await runParity();
  const render = report.dimensions.render;

  assert.equal(render.scenes.length, 2, 'fixture 有 2 张幻灯片');
  assert.deepEqual(render.textNodes, render.scenes.reduce((sum, scene) => sum + scene.textNodes, 0));

  const react = report.environment.react;
  assert.notEqual(react.ours, react.upstream, '两侧 dist 解析到的 React 路径本来就不同');
  assert.match(react.aliases['react/jsx-runtime'], /node_modules\/react\/jsx-runtime\.js$/);
  assert.match(react.reactVersion, /^18\./, 'alias 之后上游也用仓库根的 React 18');
});
