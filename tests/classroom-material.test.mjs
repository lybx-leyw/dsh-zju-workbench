// 第 0 段（讲义 → 文本）与「页面 brief → 生成入参」的契约测试。
//
// 覆盖四类断言：
//   1. 没有 materialIds 时：零事件、零读盘（回归：四段管线的行为一字未变）；
//   2. 有讲义时：真实 PDF 经 unpdf 抽成文本，文件名与字数如实回报；
//   3. 坏材料：部分失败继续、全失败以 `E_MATERIAL_UNAVAILABLE` 失败；
//   4. 页面的 `toGeneratePayload`：`requirement` 必填、`materialIds` 只在附件就绪时出现。
//
// 跑法：`node --test tests/classroom-material.test.mjs`
//
// 刻意**不**覆盖：MinerU 云 / 阿里 DocMind —— 那要凭证，属人工验证。

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Windows 上 URL.pathname 是 "/C:/Users/..."，带前导斜杠 + 盘符，
// 直接拼进 fs 路径会变成重复盘符。fileURLToPath 会正确处理。
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const src = (packageName, file) =>
  pathToFileURL(join(REPO_ROOT, 'packages', packageName, 'src', file)).href;

const {
  produceMaterialAnalysis,
  MATERIAL_PHASE,
  MAX_MATERIALS,
} = await import(src('dsh-zhiyun-core-classroom-generate', 'phases/material-analysis.js'));
const { buildOutlinePrompt } = await import(src('dsh-zhiyun-core-classroom-generate', 'prompts.js'));
const { parsePDF } = await import(src('dsh-zhiyun-core-classroom-media', 'pdf/parse.js'));
const page = await import(src('dsh-zhiyun-page-classroom-build', 'progress.js'));

const LECTURE_PATH = join(REPO_ROOT, 'fixtures', 'classroom-material', 'lecture-fourier.pdf');

// ── 装置 ───────────────────────────────────────────────────────────────────

/** 真 unpdf 的薄包装：返回 media 服务那套 `{ ok, ... }` 形状。 */
const realMedia = {
  async parsePdf(buffer, options = {}) {
    try {
      const result = await parsePDF({}, { providerId: 'unpdf', textOnly: true }, buffer, options);
      return { ok: true, provider: 'unpdf', ...result };
    } catch (error) {
      return { ok: false, code: error.code ?? 'E_INTERNAL', message: error.message };
    }
  },
};

/** 假 vault：`assets` 只认 `material-<id>` 这一个键，与 host 的 `assetStage` 同口径。 */
function makeVault(files = {}) {
  return {
    assets: {
      async get(stageId, assetId) {
        const hit = files[assetId];
        if (!hit) return null;
        return { stageId, id: assetId, mime: hit.mime ?? 'application/pdf', meta: hit.meta ?? {} };
      },
      async bytes(stageId, assetId) {
        const hit = files[assetId];
        if (!hit) throw new Error(`资产不存在：${assetId}`);
        return hit.data;
      },
    },
  };
}

function collect() {
  const events = [];
  return {
    events,
    emit: (phase, kind, payload) => events.push({ phase, kind, payload }),
  };
}

// ── 1. 没有讲义：什么都不发生 ───────────────────────────────────────────────

test('没有 materialIds 时返回空结果、不 emit、不读盘', async () => {
  const { events, emit } = collect();
  // vault / media 故意传 null：没有讲义就不该碰它们（碰了这里会抛）。
  const result = await produceMaterialAnalysis({
    brief: { materialIds: [] },
    vault: null,
    media: null,
    emit,
  });

  assert.deepEqual(result, { materials: [], failures: [], text: '', chars: 0, truncated: false });
  assert.equal(events.length, 0);
});

test('没有讲义时大纲 prompt 里没有「讲义」一节（字节不变）', () => {
  const brief = {
    requirement: '讲一下二叉树',
    topic: '二叉树',
    goals: [],
    interactive: false,
    assess: true,
    project: false,
  };
  const withoutKey = buildOutlinePrompt(brief).prompt;
  const withEmpty = buildOutlinePrompt(brief, { materialText: '' }).prompt;

  assert.equal(withEmpty, withoutKey);
  assert.equal(withoutKey.includes('## 讲义'), false);
});

// ── 2. 真实 PDF ────────────────────────────────────────────────────────────

test('真实 PDF：抽出正文，文件名与字数如实回报', async () => {
  const buffer = await readFile(LECTURE_PATH);
  const { events, emit } = collect();

  const result = await produceMaterialAnalysis({
    brief: { materialIds: ['mat-1'] },
    vault: makeVault({ 'material-mat-1': { data: buffer, meta: { name: 'lecture-fourier.pdf' } } }),
    media: realMedia,
    emit,
  });

  assert.equal(result.materials.length, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.materials[0].name, 'lecture-fourier.pdf');
  assert.equal(result.materials[0].chars > 100, true);
  assert.equal(result.truncated, false);
  assert.match(result.text, /Fourier Transform: A Visual Introduction/);

  // 事件：reading → ok（页面靠这两条显示「正在读讲义」）
  assert.deepEqual(events.map((event) => event.payload.status), ['reading', 'ok']);
  assert.equal(events.every((event) => event.phase === MATERIAL_PHASE), true);
});

test('讲义正文进大纲 prompt，且与「硬性要求」之间有分隔', async () => {
  const buffer = await readFile(LECTURE_PATH);
  const result = await produceMaterialAnalysis({
    brief: { materialIds: ['mat-1'] },
    vault: makeVault({ 'material-mat-1': { data: buffer, meta: { name: 'lecture.pdf' } } }),
    media: realMedia,
    emit: () => {},
  });

  const { prompt } = buildOutlinePrompt(
    {
      requirement: '照着讲义讲傅里叶变换',
      topic: '傅里叶变换',
      goals: [],
      interactive: false,
      assess: true,
      project: false,
    },
    { materialText: result.text },
  );

  assert.match(prompt, /## 讲义（用户上传，按它备课）/);
  assert.match(prompt, /### 讲义 1：lecture\.pdf/);
  assert.match(prompt, /Convolution in time equals multiplication in frequency/);
  // 讲义末行与下一节之间必须是空行（否则模型会把要求当成讲义的一部分）
  assert.match(prompt, /multiplication in frequency\.?\n\n## 硬性要求/);
});

// ── 3. 坏材料 ──────────────────────────────────────────────────────────────

test('一份坏一份好：继续用好的，并报出坏的', async () => {
  const buffer = await readFile(LECTURE_PATH);
  const { events, emit } = collect();

  const result = await produceMaterialAnalysis({
    brief: { materialIds: ['mat-good', 'mat-missing'] },
    vault: makeVault({ 'material-mat-good': { data: buffer, meta: { name: 'good.pdf' } } }),
    media: realMedia,
    emit,
  });

  assert.equal(result.materials.length, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].materialId, 'mat-missing');
  assert.equal(result.failures[0].code, 'E_MATERIAL_UNAVAILABLE');
  assert.equal(events.some((event) => event.payload.status === 'failed'), true);
});

test('全部读不出来：抛 E_MATERIAL_UNAVAILABLE（不静默让模型凭空讲）', async () => {
  await assert.rejects(
    () => produceMaterialAnalysis({
      brief: { materialIds: ['mat-missing'] },
      vault: makeVault({}),
      media: realMedia,
      emit: () => {},
    }),
    (error) => {
      assert.equal(error.code, 'E_MATERIAL_UNAVAILABLE');
      assert.match(error.message, /无法读取/);
      return true;
    },
  );
});

test('超过上限的 materialIds 只取前 N 份，并说明被丢弃的数量', async () => {
  const buffer = await readFile(LECTURE_PATH);
  const files = {};
  const ids = [];
  for (let index = 0; index < MAX_MATERIALS + 2; index += 1) {
    const id = `mat-${index}`;
    ids.push(id);
    files[`material-${id}`] = { data: buffer, meta: { name: `${id}.pdf` } };
  }

  const { events, emit } = collect();
  const result = await produceMaterialAnalysis({
    brief: { materialIds: ids },
    vault: makeVault(files),
    media: realMedia,
    emit,
  });

  assert.equal(result.materials.length, MAX_MATERIALS);
  assert.equal(events[0].payload.status, 'skipped');
  assert.equal(events[0].payload.reason, 'too_many');
  assert.equal(events[0].payload.total, ids.length);
});

// ── 4. 页面 brief → 生成入参 ────────────────────────────────────────────────

test('toGeneratePayload：requirement 取主题，受众与深度进 description', () => {
  const payload = page.toGeneratePayload({
    topic: '傅里叶变换',
    audience: '大二本科生',
    depth: 'deep',
  });

  assert.equal(payload.requirement, '傅里叶变换');
  assert.equal(payload.topic, '傅里叶变换');
  assert.match(payload.description, /受众：大二本科生/);
  assert.match(payload.description, /深度：深入/);
  assert.deepEqual(payload.scenes, []);
  assert.equal('materialIds' in payload, false, '没附件时不该出现 materialIds 字段');
});

test('toGeneratePayload：附件就绪才带 materialIds', () => {
  const uploading = page.toGeneratePayload({
    topic: 'x',
    attachment: { name: 'a.pdf', size: 1, status: 'uploading' },
  });
  assert.equal('materialIds' in uploading, false);

  const ready = page.toGeneratePayload({
    topic: 'x',
    attachment: { name: 'a.pdf', size: 1, status: 'ready', materialId: 'mat-9' },
  });
  assert.deepEqual(ready.materialIds, ['mat-9']);
});

test('briefReady：附件上传中/失败时不能进下一步', () => {
  assert.equal(page.briefReady({ topic: 'x', attachment: null }), true);
  assert.equal(page.briefReady({ topic: 'x', attachment: { status: 'ready', materialId: 'm' } }), true);
  assert.equal(page.briefReady({ topic: 'x', attachment: { status: 'uploading' } }), false);
  assert.equal(page.briefReady({ topic: 'x', attachment: { status: 'failed' } }), false);
  assert.equal(page.briefReady({ topic: '' }), false);
});

test('run-done 把 stageId 记进页面状态（播放页按它取文档）', () => {
  const done = page.reduce(page.initialState(), {
    type: 'run-done',
    payload: { stageId: 'classroom-20261031', sceneCount: 4 },
  });
  assert.equal(done.phase, page.PHASE.done);
  assert.equal(done.stageId, 'classroom-20261031');

  // 没有 stageId 时不写这个键（快照比较不会因为多了个 undefined 就抖）
  const bare = page.reduce(page.initialState(), { type: 'done' });
  assert.equal('stageId' in bare, false);
});
