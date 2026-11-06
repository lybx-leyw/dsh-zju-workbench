// classroom-parity 的闸门自测。
//
// 规范 §1 的三条判据里，第 1、2 条（场景序列 + DOM 文本）在本文件里被逐条钉死；
// 第 3 条（PPTX 结构）用 zip 读端与页级比对覆盖。
//
// 覆盖：
//   1. 同一目录自比 → identical，退出码 0；
//   2. 删掉一个场景 → divergent，且指出是第几个场景；
//   3. 破坏 pptx 字节 → broken，退出码 1；
//   4. 场景换序 → equivalent（不是 divergent），退出码 0；
//   5. 只改换行/段落边界 → equivalent；改词 → divergent；
//   6. zip 读端：stored 与 deflate 都能读，CRC/长度不符报错；
//   7. CLI：--json 输出可解析、退出码与分级一致、用法错误 2；
//   8. golden 语料本身：4 个场景、PPTX 4 页，且能被工具读全。
//
// 跑法：`node --test tests/classroom-golden-parity.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, cp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

import {
  main,
  readZipEntries,
  readPptxStructure,
  readArtifacts,
  compareDirectories,
  compareScenes,
  compareText,
  normalizeText,
  htmlToTextLines,
  sceneTextLines,
} from '../scripts/classroom-golden-parity.mjs';
import { buildStoredZip } from '../packages/dsh-zhiyun-core-classroom-export/src/zip/stored-zip.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const GOLDEN = path.join(ROOT, 'fixtures', 'classroom-golden');
const SCRIPT = path.join(ROOT, 'scripts', 'classroom-golden-parity.mjs');
const MANIFEST_RE = /(<script[^>]*id="openmaic-classroom"[^>]*>)([\s\S]*?)(<\/script>)/;

// ── 装置 ────────────────────────────────────────────────────────────────────

async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'classroom-parity-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** 复制一份 golden 产物目录（不含 classroom.json / generate.mjs）。 */
async function copyGolden(t) {
  const dir = await tempDir(t);
  for (const name of ['classroom.html', 'classroom.pptx']) {
    await cp(path.join(GOLDEN, name), path.join(dir, name));
  }
  return dir;
}

function escapeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/** 读 golden html 的清单，改完再写回（保持 `</script>` 不会提前结束元素）。 */
async function rewriteManifest(dir, mutate) {
  const file = path.join(dir, 'classroom.html');
  const html = await readFile(file, 'utf8');
  const match = html.match(MANIFEST_RE);
  assert.ok(match, 'golden html 里应该有清单');
  const manifest = JSON.parse(match[2]);
  mutate(manifest);
  await writeFile(file, html.slice(0, match.index) + match[1] + escapeForScript(manifest) + match[3] + html.slice(match.index + match[0].length));
}

function cli(...args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

async function report(dirA, dirB) {
  return compareDirectories(dirA, dirB);
}

// ── 1. identical ────────────────────────────────────────────────────────────

test('同一目录自比 → identical，退出码 0', async () => {
  const result = await report(GOLDEN, GOLDEN);
  assert.equal(result.status, 'identical');
  assert.equal(result.dimensions.scenes.status, 'identical');
  assert.equal(result.dimensions.text.status, 'identical');
  assert.equal(result.dimensions.pptx.status, 'identical');

  // 走 CLI：默认文本报告 + 退出码。
  const run = cli('--a', GOLDEN, '--b', GOLDEN);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /结论: identical/);

  const json = cli('--a', GOLDEN, '--b', GOLDEN, '--json');
  assert.equal(json.code, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.status, 'identical');
  assert.deepEqual(parsed.dimensions.scenes.a, ['slide', 'interactive', 'quiz', 'pbl']);
});

// ── 2. divergent：删场景 ────────────────────────────────────────────────────

test('删掉一个场景 → divergent，并指出是第几个场景', async (t) => {
  const dir = await copyGolden(t);
  await rewriteManifest(dir, (manifest) => {
    manifest.scenes = manifest.scenes.filter((scene) => scene.type !== 'quiz');
  });

  const result = await report(GOLDEN, dir);
  assert.equal(result.status, 'divergent');
  assert.equal(result.dimensions.scenes.status, 'divergent');
  // golden 的顺序是 slide→interactive→quiz→pbl，删掉 quiz 后第一个分歧在第 3 个场景。
  const sequence = result.dimensions.scenes.differences.find((entry) => entry.kind === 'sequence');
  assert.ok(sequence, '应给出序列分歧');
  assert.equal(sequence.index, 2);
  assert.equal(sequence.a, 'quiz');
  assert.equal(sequence.b, 'pbl');

  // 文本维度也要点名缺失的那一场。
  const missing = result.dimensions.text.differences.find((entry) => entry.kind === 'missing-scene');
  assert.ok(missing);
  assert.equal(missing.index, 2);
  assert.equal(missing.type, 'quiz');

  const run = cli('--a', GOLDEN, '--b', dir);
  assert.equal(run.code, 1);
  assert.match(run.stdout, /@场景3\(quiz\) 在 b 侧缺失/);
});

test('多出一个场景 → divergent', async (t) => {
  const dir = await copyGolden(t);
  await rewriteManifest(dir, (manifest) => {
    const extra = structuredClone(manifest.scenes.find((scene) => scene.type === 'slide'));
    extra.id = 'scene-slide-2';
    extra.title = 'Recap';
    extra.order = 4;
    manifest.scenes.push(extra);
  });
  const result = await report(GOLDEN, dir);
  assert.equal(result.dimensions.scenes.status, 'divergent');
  assert.equal(result.dimensions.scenes.a.length, 4);
  assert.equal(result.dimensions.scenes.b.length, 5);
});

// ── 3. broken：坏 zip ───────────────────────────────────────────────────────

test('故意破坏 pptx → broken，退出码 1', async (t) => {
  const dir = await copyGolden(t);
  const file = path.join(dir, 'classroom.pptx');
  const bytes = await readFile(file);
  bytes.write('XXXX', 0, 'ascii'); // 打掉第一个本地头签名
  await writeFile(file, bytes);

  const result = await report(GOLDEN, dir);
  assert.equal(result.status, 'broken');
  assert.equal(result.dimensions.pptx.status, 'broken');
  assert.match(result.dimensions.pptx.error, /zip|本地头/);

  const run = cli('--a', GOLDEN, '--b', dir);
  assert.equal(run.code, 1);
  assert.match(run.stdout, /结论: broken/);
});

test('截断的 pptx → broken；空目录 → broken', async (t) => {
  const dir = await copyGolden(t);
  const bytes = await readFile(path.join(dir, 'classroom.pptx'));
  await writeFile(path.join(dir, 'classroom.pptx'), bytes.subarray(0, Math.floor(bytes.length / 3)));
  assert.equal((await report(GOLDEN, dir)).dimensions.pptx.status, 'broken');

  const empty = await tempDir(t);
  const result = await report(GOLDEN, empty);
  assert.equal(result.status, 'broken');
  assert.equal(result.dimensions.read.status, 'broken');
});

// ── 4. equivalent：顺序 / 空白 ──────────────────────────────────────────────

test('场景换序 → equivalent（不是 divergent），退出码 0', async (t) => {
  const dir = await copyGolden(t);
  await rewriteManifest(dir, (manifest) => {
    manifest.scenes = [manifest.scenes[1], manifest.scenes[0], manifest.scenes[3], manifest.scenes[2]];
  });

  const result = await report(GOLDEN, dir);
  assert.equal(result.dimensions.scenes.status, 'equivalent');
  // 配对按「类型 + 序号」，换序不该制造文本分歧。
  assert.equal(result.dimensions.text.status, 'identical');
  assert.equal(result.status, 'equivalent');

  const run = cli('--a', GOLDEN, '--b', dir);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /结论: equivalent/);
});

test('只改换行/段落边界 → equivalent；改词 → divergent', async (t) => {
  const reflowed = await copyGolden(t);
  await rewriteManifest(reflowed, (manifest) => {
    const body = manifest.scenes
      .find((scene) => scene.type === 'slide')
      .content.canvas.elements.find((element) => element.id === 'body');
    body.content = body.content.replace(
      '<li><p>Inputs: carbon dioxide and water.</p></li>',
      '<li><p>Inputs: carbon dioxide<br>and water.</p></li>',
    );
  });
  const reflow = await report(GOLDEN, reflowed);
  assert.equal(reflow.dimensions.text.status, 'equivalent');
  assert.equal(reflow.status, 'equivalent');

  const reworded = await copyGolden(t);
  await rewriteManifest(reworded, (manifest) => {
    const body = manifest.scenes
      .find((scene) => scene.type === 'slide')
      .content.canvas.elements.find((element) => element.id === 'body');
    body.content = body.content.replace('glucose and oxygen', 'glucose and water');
  });
  const rewrite = await report(GOLDEN, reworded);
  assert.equal(rewrite.dimensions.text.status, 'divergent');
  assert.equal(rewrite.status, 'divergent');
  const diff = rewrite.dimensions.text.scenes.find((scene) => scene.status === 'divergent');
  assert.equal(diff.index, 0, '应该是第 1 个场景（slide）');
  assert.match(diff.firstDifference.contextB, /glucose and water/);
  assert.equal(cli('--a', GOLDEN, '--b', reworded).code, 1);
});

test('文本里的零宽字符与多余空白不制造差异', () => {
  assert.equal(normalizeText('  E=\u200bmc^2 \n'), 'E=mc^2');
  assert.equal(normalizeText('a\t\tb   c'), 'a b c');
  assert.equal(normalizeText('a  b', { loose: true }), 'ab');
  assert.deepEqual(htmlToTextLines('<p>A&amp;B</p><script>var x = 1;</script><p>C</p>'), ['A&B', 'C']);
});

// ── 5. PPTX 页级 ────────────────────────────────────────────────────────────

/** 重新打包一份 pptx（测试里改页用）。目录条目（`xxx/`）跳过：本仓的写端不要空路径段。 */
function repack(entries) {
  return buildStoredZip(
    entries.filter(([name]) => !name.endsWith('/')).map(([name, data]) => ({ path: name, data })),
  );
}

test('PPTX：删掉一页 → divergent 且报页数', async (t) => {
  const dir = await copyGolden(t);
  const original = await readFile(path.join(dir, 'classroom.pptx'));
  const entries = readZipEntries(original);
  const kept = [...entries.entries()].filter(([name]) => name !== 'ppt/slides/slide4.xml');
  await writeFile(path.join(dir, 'classroom.pptx'), repack(kept));

  const result = await report(GOLDEN, dir);
  assert.equal(result.dimensions.pptx.status, 'divergent');
  const difference = result.dimensions.pptx.differences.find((entry) => entry.kind === 'page-count');
  assert.deepEqual([difference.a, difference.b], [4, 3]);
});

test('PPTX：改一页文本 → divergent；公式数变化 → divergent', async (t) => {
  const dir = await copyGolden(t);
  const entries = readZipEntries(await readFile(path.join(dir, 'classroom.pptx')));
  const xml = entries.get('ppt/slides/slide1.xml').toString('utf8');
  entries.set('ppt/slides/slide1.xml', Buffer.from(xml.replace('What is photosynthesis?', 'Photosynthesis?'), 'utf8'));
  await writeFile(path.join(dir, 'classroom.pptx'), repack([...entries]));

  const result = await report(GOLDEN, dir);
  assert.equal(result.dimensions.pptx.status, 'divergent');
  const page = result.dimensions.pptx.differences.find((entry) => entry.kind === 'page');
  assert.equal(page.page, 1);
  assert.match(page.firstDifference.contextB, /Photosynthesis\?/);
});

// ── 6. zip 读端 ─────────────────────────────────────────────────────────────

test('zip 读端：stored 与 deflate 都能读', () => {
  const stored = buildStoredZip([
    { path: 'a.txt', data: 'hello' },
    { path: 'dir/b.bin', data: Buffer.from([0, 1, 2, 3]) },
  ]);
  const read = readZipEntries(stored);
  assert.equal(read.get('a.txt').toString(), 'hello');
  assert.deepEqual([...read.get('dir/b.bin')], [0, 1, 2, 3]);

  const deflated = deflateZip([{ path: 'x.xml', data: Buffer.from('<a>hi</a>') }]);
  assert.equal(readZipEntries(deflated).get('x.xml').toString(), '<a>hi</a>');

  assert.throws(() => readZipEntries(Buffer.from('not a zip at all, just bytes')), /zip/);
});

/** 手搓一个 method=8（deflate）的最小 zip：pptxgenjs 换压缩输出时读端不能塌。 */
function deflateZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.path, 'utf8');
    const compressed = deflateRawSync(file.data);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const header = Buffer.alloc(46 + name.length);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(8, 10);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(file.data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    name.copy(header, 46);
    parts.push(local, compressed);
    central.push(header);
    offset += local.length + compressed.length;
  }
  const centralSize = central.reduce((sum, header) => sum + header.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

// ── 7. 只有课堂文档（没有 html）的目录 ──────────────────────────────────────

test('只有 classroom.json 的目录：从文档取场景，文本维度照常比', async (t) => {
  const dir = await tempDir(t);
  await writeFile(path.join(dir, 'classroom.json'), await readFile(path.join(GOLDEN, 'classroom.json')));
  const result = await report(GOLDEN, dir);
  // golden 有 html+pptx，对侧只有文档：缺 pptx → divergent，但场景/文本仍可比。
  // 文档里场景是「乱序存放」的，序列维度天然是 equivalent（顺序不同），文本按类型配对后一致。
  assert.equal(result.dimensions.scenes.status, 'equivalent');
  assert.equal(result.dimensions.scenes.source[1], 'document');
  assert.equal(result.dimensions.text.status, 'identical');
  assert.equal(result.dimensions.pptx.status, 'divergent');
  assert.deepEqual(result.dimensions.pptx.differences[0], { kind: 'missing-artifact', missingIn: 'b' });
});

// ── 8. 用法 ─────────────────────────────────────────────────────────────────

test('用法错误 → 退出码 2，不产出报告', async () => {
  assert.equal(cli().code, 2);
  assert.equal(cli('--a', GOLDEN).code, 2);
  assert.equal(cli('--a', GOLDEN, '--b', GOLDEN, '--nope').code, 2);
  assert.equal(cli('--help').code, 0);
});

test('main() 可被直接调用（不靠进程退出码）', async () => {
  const sink = { text: '', write(chunk) { this.text += chunk; } };
  const code = await main(['--a', GOLDEN, '--b', GOLDEN, '--json'], { stdout: sink, stderr: sink });
  assert.equal(code, 0);
  assert.equal(JSON.parse(sink.text).status, 'identical');
});

// ── 9. golden 语料自身 ──────────────────────────────────────────────────────

test('golden 语料：4 个场景、PPTX 4 页、文本非空', async () => {
  const artifacts = await readArtifacts(GOLDEN);
  assert.equal(artifacts.scenesSource, 'html-manifest');
  assert.deepEqual(artifacts.scenes.map((scene) => scene.type), ['slide', 'interactive', 'quiz', 'pbl']);
  for (const scene of artifacts.scenes) {
    assert.ok(sceneTextLines(scene).length > 0, `${scene.type} 场景没有抽出文本`);
  }
  assert.equal(artifacts.pptx.pageCount, 4);
  assert.ok(artifacts.pptx.math >= 1, '公式页应该有 m:oMath');

  // 文档（输入）与 html（产物）必须对得上，golden 才是"一份"语料。
  const doc = JSON.parse(await readFile(path.join(GOLDEN, 'classroom.json'), 'utf8'));
  assert.equal(doc.scenes.length, 4);
  assert.deepEqual(
    doc.scenes.map((scene) => scene.type).sort(),
    artifacts.scenes.map((scene) => scene.type).sort(),
  );
});

// ── 10. 单元：序列与文本分级 ────────────────────────────────────────────────

test('compareScenes / compareText 的分级边界', () => {
  const scene = (type, title) => ({ type, title, content: { type } });
  assert.equal(compareScenes([scene('slide')], [scene('slide')]).status, 'identical');
  assert.equal(compareScenes([scene('slide'), scene('quiz')], [scene('quiz'), scene('slide')]).status, 'equivalent');
  assert.equal(compareScenes([scene('slide')], [scene('slide'), scene('quiz')]).status, 'divergent');

  const text = compareText([scene('slide', 'A')], [scene('slide', 'B')]);
  assert.equal(text.status, 'divergent');
  assert.equal(text.differences[0].firstDifference.a, 'A');
  assert.equal(text.differences[0].firstDifference.b, 'B');
});

test('readPptxStructure 拒绝非 pptx', () => {
  assert.throws(() => readPptxStructure(Buffer.from('PK\u0003\u0004 not really')), /zip|pptx/);
  const notPresentation = buildStoredZip([{ path: 'hello.txt', data: 'hi' }]);
  assert.throws(() => readPptxStructure(notPresentation), /presentation\.xml/);
});
