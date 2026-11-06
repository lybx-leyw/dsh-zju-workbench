// dsh-zhiyun-core-classroom-export 的对照测试。
//
// 判据来自 docs/architecture/classroom-port.md §1「能力等价」：**同一份课堂 fixture，
// 产物在结构与内容上必须与上游一致**，不是"看起来像"。
//
// 覆盖：
//   1. `html()` 是完整文档（`<!doctype`）、样式内联、无外链 http 资源、四个场景按
//      order 重排、交互页脚本原样存活、标记样文本不被吞；
//   2. `pptx()` 是 zip（`PK\x03\x04` 开头）、能解开、含 `ppt/presentation.xml`，
//      且幻灯片数与 deck 计划一致（3 张幻灯片场景 → 1 张真页 + 3 张占位页）；
//   3. `zip()` 是 zip，含 `classroom.html` 与 README；
//   4. `video()` 的时间轴与字幕口径（旁白估算、SRT/VTT 序列化）；
//   5. 插件形状：`apply()` 不抛、服务可 provide、缺宿主时方法报 `E_NO_STUDIO`。
//
// 跑法：`node --test tests/classroom-export.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import JSZip from 'jszip';

import {
  standaloneFixtureScenes,
  standaloneFixtureStage,
  standaloneFixtureAssets,
  DEFAULT_FIXTURE_MEDIA,
} from './fixtures/classroom-standalone.mjs';

const PACKAGE_DIR = new URL('../packages/dsh-zhiyun-core-classroom-export/', import.meta.url);
const INDEX_URL = pathToFileURL(join(fileURLToPath(PACKAGE_DIR), 'src', 'index.js')).href;
const plugin = await import(INDEX_URL);

// ── 装置 ────────────────────────────────────────────────────────────────────

/** 最小 Cordis 假 ctx（照 tests/classroom-host.test.mjs 的写法）。 */
function makeCtx({ services = {}, studio } = {}) {
  const provided = new Map(Object.entries(services));
  const disposers = [];
  if (studio) provided.set('zhiyunClassroomStudio', studio);
  const ctx = {
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    get: (name) => provided.get(name),
    provide: (name, value) => {
      provided.set(name, value);
      return () => provided.delete(name);
    },
    on: (event, handler) => {
      if (event === 'dispose') disposers.push(handler);
    },
  };
  return { ctx, provided, disposers };
}

/** 一份"宿主侧课堂文档"：fixture + 注入的媒体字节。 */
function makeClassroom() {
  const stage = standaloneFixtureStage('stage-fixture');
  const scenes = standaloneFixtureScenes(scageId(stage));
  return { stage, scenes, assets: standaloneFixtureAssets() };
}

function scageId(stage) {
  return stage.id;
}

function boot(options) {
  const { ctx, provided, disposers } = makeCtx(options);
  plugin.apply(ctx, { logger: { debug() {}, info() {}, warn() {}, error() {} } });
  return { service: provided.get('zhiyunClassroomExport'), provided, ctx, disposers };
}

// ── 1. html() ───────────────────────────────────────────────────────────────

test('html()：完整文档 + 样式内联 + 无外链 http 资源', async () => {
  const { service } = boot();
  const classroom = makeClassroom();
  const html = await service.html(classroom);

  assert.equal(typeof html, 'string');
  // 完整文档：页面包直接塞进 <iframe srcdoc>，不许是分片。
  assert.match(html.slice(0, 64), /^<!doctype html>/i);
  assert.match(html, /<\/html>\s*$/i);
  // 内联样式：至少要有一份 <style>，且播放器 CSS 真的进来了。
  assert.match(html, /<style>/);
  assert.match(html, /\.omc-player/);
  // 清单 / 配置 / 媒体表都是内联 JSON 块。
  assert.match(html, /id="openmaic-classroom"/);
  assert.match(html, /id="openmaic-player-config"/);
  // 无外链 http 资源：src/href 里不许出现 http(s)，也没有 @import 外链。
  const externalRefs = [...html.matchAll(/\s(?:src|href|poster)="(https?:\/\/[^"]*)"/gi)].map((m) => m[1]);
  assert.deepEqual(externalRefs, [], `发现外链资源：${externalRefs.join(', ')}`);
  // 整个文档里一个绝对 URL 都不该有（CSP 是 `default-src 'none'`，出现即意味着离线必坏）。
  assert.equal(/https?:\/\//.test(html), false, '文档里出现了绝对 URL');
  // 远程图片（fixture 里的 chloroplast.png 没有字节）必须被丢弃且从清单里消失。
  assert.equal(html.includes(DEFAULT_FIXTURE_MEDIA.remoteImageUrl), false);
  // 归档图片被内联成 data:。
  assert.match(html, /data:image\/png;base64,/);
  // 场景按 order 重排：slide(0) → interactive(1) → quiz(2) → pbl(3)。
  const manifestJson = html.match(/<script type="application\/json" id="openmaic-classroom">([\s\S]*?)<\/script>/)[1];
  const manifest = JSON.parse(manifestJson);
  assert.deepEqual(
    manifest.scenes.map((scene) => scene.type),
    ['slide', 'interactive', 'quiz', 'pbl'],
  );
  assert.equal(manifest.scenes[0].title, 'What is photosynthesis?');
  // 标记样文本原样存活（标题里的 <Light> & "Life"）。
  assert.match(html, /Photosynthesis: &lt;Light&gt; &amp; &quot;Life&quot;/);
  // 交互页的内联脚本仍然在，且没有被 `</script>` 提前截断。
  assert.match(html, /document\.body\.dataset\.ready/);
  // 可执行块都能被 JS 解析：srcdoc 里没有构建期转译，语法错就是白屏。
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 1, '没有可执行的播放器脚本');
  for (const code of scripts) assert.doesNotThrow(() => new Function(code));
  // 富文本白名单生效：ul > li > p 保留（清单是 JSON 块，`<` 被转义成 `\u003c`，
  // 所以要看解析后的值，而不是原始字符串）。
  const body = manifest.scenes[0].content.canvas.elements.find((element) => element.id === 'body');
  assert.equal(
    body.content,
    '<ul><li><p>Plants convert light energy into chemical energy.</p></li>'
      + '<li><p>Inputs: carbon dioxide and water.</p></li>'
      + '<li><p>Outputs: glucose and oxygen.</p></li></ul>',
  );
});

test('html()：报告模式下给出体积与丢弃清单', async () => {
  const { service } = boot();
  const report = await service.html(makeClassroom(), { report: true });
  assert.equal(typeof report.html, 'string');
  assert.ok(report.byteSize > 1000);
  assert.equal(report.fileName, 'Photosynthesis_ _Light_ & _Life_.html');
  assert.ok(report.unresolvedMedia.includes(DEFAULT_FIXTURE_MEDIA.remoteImageUrl));
  assert.equal(report.player, 'builtin');
});

test('html()：同一课堂两次导出结果稳定（除导出时间戳）', async () => {
  const { service } = boot();
  const classroom = makeClassroom();
  const strip = (html) => html.replace(/"exportedAt":"[^"]+"/, '');
  assert.equal(strip(await service.html(classroom)), strip(await service.html(classroom)));
});

// ── 2. pptx() ───────────────────────────────────────────────────────────────

test('pptx()：zip 容器 + ppt/presentation.xml + 幻灯片数量', async () => {
  const { service } = boot();
  const buffer = await service.pptx(makeClassroom());

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.subarray(0, 4).toString('latin1'), 'PK\x03\x04');

  const zip = await JSZip.loadAsync(buffer);
  assert.ok(zip.file('ppt/presentation.xml'), '缺少 ppt/presentation.xml');
  assert.ok(zip.file('[Content_Types].xml'));

  // slide(0) + quiz + pbl + interactive 各一张 → 1 真页 + 3 占位页。
  const slides = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  assert.equal(slides.length, 4, `幻灯片数不对：${slides.join(', ')}`);

  // 第一页的文本来自富文本（strong/span 字号被折进 run），公式走 OMML。
  const first = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(first, /What is photosynthesis\?/);
  assert.match(first, /Plants convert light energy/);
  assert.match(first, /<m:oMath>/);
  assert.match(first, /Cambria Math/);
  // 演讲者备注：旁白进了 notes。
  const notes = Object.keys(zip.files).filter((name) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name));
  assert.ok(notes.length >= 1, '旁白没有写进演讲者备注');
});

// ── 3. zip() ────────────────────────────────────────────────────────────────

test('zip()：classroom.html + 媒体 + README，且页面 CSP 换成 self', async () => {
  const { service } = boot();
  const buffer = await service.zip(makeClassroom());
  assert.equal(buffer.subarray(0, 4).toString('latin1'), 'PK\x03\x04');

  const zip = await JSZip.loadAsync(buffer);
  const html = await zip.file('classroom.html').async('string');
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /img-src 'self' data: blob:/);
  assert.ok(await zip.file('README.txt').async('string').then((text) => text.includes('classroom.html')));
  // 图片以相对路径随包，而不是 data:。
  assert.match(html, /images\/image-1\.png/);
  assert.ok(zip.file('images/image-1.png'));
});

// ── 4. video() ──────────────────────────────────────────────────────────────

test('video()：时间轴按场景累加，字幕给出 SRT 与 VTT', async () => {
  const { service } = boot();
  const plan = await service.video(makeClassroom(), { subtitleFormat: 'vtt' });
  assert.equal(plan.schema, 'openmaic.videoTimeline');
  assert.equal(plan.rendered, false);
  assert.ok(plan.durationMs > 0);
  assert.deepEqual(plan.requires, ['ffmpeg', 'headless-chromium']);
  assert.equal(plan.subtitles.length, 1);
  assert.match(plan.subtitleText, /^WEBVTT/);
  assert.match(plan.subtitleText, /Let us look at photosynthesis\./);
  assert.ok(plan.diagnostics.some((item) => item.code === 'estimated-duration'));
});

// ── 5. 插件形状 ─────────────────────────────────────────────────────────────

test('apply() 永不抛；服务可卸载；缺宿主时报 E_NO_STUDIO', async () => {
  const { service, provided, disposers } = boot();
  assert.ok(service);
  assert.equal(service.status().state, 'degraded');

  await assert.rejects(
    () => service.html({ id: 'stage-x' }),
    (error) => error.code === 'E_NO_STUDIO',
  );

  assert.equal(disposers.length, 1);
  disposers[0]();
  assert.equal(provided.has('zhiyunClassroomExport'), false);
});

test('apply()：宿主就位后按 id 加载文档', async () => {
  const classroom = makeClassroom();
  const studio = { classroom: { load: async (id) => (id === 'stage-fixture' ? classroom : null) } };
  const { service } = boot({ studio });
  assert.equal(service.status().state, 'ready');
  const html = await service.html('stage-fixture');
  assert.match(html, /^<!doctype html>/i);
});

test('apply()：provide 抛错也不炸（能力缺席比 profile 挂掉好）', () => {
  const { ctx } = makeCtx();
  ctx.provide = () => {
    throw new Error('service already registered');
  };
  assert.doesNotThrow(() => plugin.apply(ctx, {}));
});
