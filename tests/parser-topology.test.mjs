/**
 * **拓扑前置 + 全败即中止 + 断点接续**的契约测试。
 *
 * 这三条是同一件事的三面：
 *   ① 每一步都严格依赖上一步 —— 没有转述稿就没有"纠正的依据"；
 *   ② 某一步**整体失败**就中止，而不是带着空结果一路跑到底；
 *   ③ 已经成功的部分留在缓存里，环境恢复后重跑**只补失败的那部分**。
 *
 * 为什么不做熔断：重试后仍失败的只有两种可能 ——
 *   用户环境问题（重跑即可接上）或我们自己的代码漏洞（会一直失败，该修代码）。
 * 加"连续失败 N 次就放弃"只会让第二种更难被发现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mountHost, lesson, answer, png } from './fixtures/parser/host.mjs';
import { lock } from '../scripts/profile.mjs';

/** 造一份多页的课：每页一张合法图 + 各自一句字幕。
 *
 * ⚠️ 句子文本用 `旧事史`（而不是随便编的一句）：共享 fixture 的 mix 回包是
 *    `正文：旧四史`，它只有在"原句与改动差异很小"时才会被纠错护栏接受。
 *    换成无关句子会被纠错护栏退回原文，测的就不是“纠正已被采纳”。
 */
function multiPageLesson(pages = 3) {
  return {
    sourceId: 'fixture:topo', context: 'context',
    slides: Array.from({ length: pages }, (_, i) => ({ page: i + 1, createdSec: i * 10, imageBytes: png, mediaType: 'image/png' })),
    subtitles: Array.from({ length: pages }, (_, i) => ({ startMs: i * 10000, endMs: i * 10000 + 5000, text: '旧事史' })),
  };
}

/** 从请求里认出「哪个阶段 / 第几页」（messages 而不是 {stage}，中间隔着适配层）。 */
function classify(options) {
  const texts = [];
  for (const msg of options?.messages ?? []) {
    for (const block of msg.content ?? []) {
      if (block.type === 'text') texts.push(block.text);
      else if (block.type === 'image') texts.push('[image]');
    }
  }
  const joined = texts.join('\n');
  const page = Number(joined.match(/这是第 (\d+) 页/)?.[1] ?? 0) || null;
  if (texts.includes('[image]')) return { stage: 'faithful', page, joined };
  if (joined.includes('逐块语音稿清洗器')) return { stage: 'mix', page, joined };
  if (joined.includes('维度标注')) return { stage: 'tags', page, joined };
  return { stage: 'outline', page, joined };
}

test('① vision失败仅移除视觉依据，字幕仍走无图mix，来源不丢且保留视觉失败', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'topo-mix-'));
  let host;
  try {
    const calls = [];
    host = await mountHost(lock.hostVersions[0], dir, (options) => {
      const { stage, page } = classify(options);
      calls.push({ stage, page });
      // 第 2 页 vision 故意失败
      if (stage === 'faithful' && page === 2) throw Object.assign(new Error('404'), { code: 'LLM_FAILED' });
      return answer(options);
    });
    const output = await host.parser.parse(multiPageLesson(3));

    const mixPages = calls.filter((c) => c.stage === 'mix').map((c) => c.page);
    assert.ok(!mixPages.includes(2), `第 2 页不该使用有图mix，实际 mix 落在页 [${mixPages.join(',')}]`);
    assert.ok(mixPages.includes(null), '字幕使用明确无图依据的mix请求');
    const recovered=output.blocks.find(b=>b.page===2);
    assert.equal(recovered.evidenceKind,'transcript-only');
    assert.equal(recovered.cleanStatus,'reviewed');
    assert.deepEqual(recovered.slideEvidence,[]);
    assert.equal(output.status, 'partial');
    assert.ok(output.failedPages.includes(2));
    assert.ok(output.sentences.length >= 3, '句子层一条不丢');
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('② 所有页都读不出 → 抛 VISION_ALL_FAILED，而不是返回一件空产物', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'topo-allfail-'));
  let host;
  try {
    host = await mountHost(lock.hostVersions[0], dir, () => {
      throw Object.assign(new Error('401 unauthorized'), { code: 'LLM_FAILED' });
    });
    await assert.rejects(host.parser.parse(multiPageLesson(3)), (error) => {
      assert.equal(error.code, 'VISION_ALL_FAILED');
      assert.match(error.message, /整体失败/);
      // 必须告诉用户「重跑不会重打」
      assert.match(error.message, /重跑/);
      /* ⚠️ 断言**不要**绑定具体排查建议。
       *
       * 早先这里写的是 `/接口地址|API Key|视觉模型/`，而那句建议是硬编码的猜测
       *（"检查视觉模型是否支持图片"）。实跑证明它会把排查方向带偏 —— 真实原因
       * 可能完全是别的。现在要求：错误里必须带出**来自上游/宿主的具体原因**，
       * 而不是一句凭空猜的处置建议。
       *
       * 这里 fixture 的桩在适配层直接抛，产品据此报的是「宿主模型未完整完成解析」；
       * 真实 HTTP 场景则会带上服务端原文（见 `.verify-scratch/verify-cause-msg.mjs`）。
       */
      assert.match(error.message, /服务端原文/, '要带出具体原因，而不是只给建议');
      assert.doesNotMatch(error.message, /检查接口地址|视觉模型是否支持/,
        '不该再出现硬编码的猜测式建议');
      return true;
    });
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('②b 有块但一条都没打上标 → 抛 TAG_ALL_FAILED（树必然是空的）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'topo-tagfail-'));
  let host;
  try {
    host = await mountHost(lock.hostVersions[0], dir, (options) => {
      const { stage } = classify(options);
      if (stage === 'mix') return '## 逐块标注\n块 1-2\n## 块标记\n{"tags":[]}';
      return answer(options);
    });
    await assert.rejects(host.parser.parse(lesson()), (error) => {
      assert.equal(error.code, 'TAG_ALL_FAILED');
      assert.match(error.message, /答题卡/);
      return true;
    });
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('③ 断点接续：重跑只补失败的那页，已成功的页命中缓存不重打', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'topo-resume-'));
  let host;
  try {
    let round = 1;
    const visionRounds = [];
    host = await mountHost(lock.hostVersions[0], dir, (options) => {
      const { stage, page } = classify(options);
      if (stage !== 'faithful') return answer(options);
      visionRounds.push({ round, page });
      // 第一轮第 2 页失败；第二轮全部成功
      if (round === 1 && page === 2) throw Object.assign(new Error('临时故障'), { code: 'LLM_FAILED' });
      return answer(options);
    });

    const input = multiPageLesson(3);
    const first = await host.parser.parse(input);
    assert.equal(first.status, 'partial');

    const round1Pages = visionRounds.filter((r) => r.round === 1).map((r) => r.page);

    // 第二轮：环境恢复
    round = 2;
    const before = visionRounds.length;
    const second = await host.parser.parse(input);
    const round2Pages = visionRounds.slice(before).filter((r) => r.round === 2).map((r) => r.page);

    // 第一轮成功的页，第二轮**不该**再出现
    const succeeded = round1Pages.filter((p) => p !== 2);
    const replayed = succeeded.filter((p) => round2Pages.includes(p));
    assert.deepEqual(replayed, [], `已成功的页不该重打，重打了 [${replayed.join(',')}]`);
    // 失败的页第二轮必须重试，且这次成功
    assert.ok(round2Pages.includes(2), '失败页应当在第二轮重试');
    assert.equal(second.status, 'ready', '补齐后应当是 ready');
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('④ 没有熔断器：连续失败不会"自动放弃"，只会如实报错', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'topo-nobreaker-'));
  let host;
  try {
    let calls = 0;
    host = await mountHost(lock.hostVersions[0], dir, () => {
      calls++;
      throw Object.assign(new Error('401'), { code: 'LLM_FAILED' });
    });
    // 连续跑 3 次，每次都必须抛（而不是第 N 次开始静默"跳过"）
    for (let i = 0; i < 3; i++) {
      await assert.rejects(host.parser.parse(lesson()), { code: 'VISION_ALL_FAILED' });
    }
    // 每次失败都是"一次拼图 + 兜底单图"的量级，不该无限放大
    assert.ok(calls <= 12, `调用数不该爆炸，实际 ${calls} 次`);
  } finally { await host?.dispose(); await rm(dir, { recursive: true, force: true }); }
});
