/**
 * `raw_transcript` 与 `raw_slides` 的测试。
 *
 * # 这份测试守的是什么
 *
 * 用户的抱怨里有一半是「原始素材也应该给 AI」。但原始素材有两种形态，
 * 混淆它们的后果很具体：
 *
 * | 混淆 | 后果 |
 * | --- | --- |
 * | 把 PPT 图片当成「页面上的文字」引用 | 编造 PPT 内容（图里根本没有文字层） |
 * | 把转写稿当成整理过的讲义 | 引用老师随口说的话当结论 |
 * | 没字幕时假装转写成功 | 返回空文本，模型以为「这节课没讲」 |
 *
 * 所以三件事都要钉住：形态如实、失败如实、来源可辨。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createRawMaterialTools } from '../../../packages/tool/classroom/src/raw-materials.js';

/** 造一个假课堂服务。 */
function classroom({ subtitles, slides, transcribe } = {}) {
  return {
    zhiyunClassroom: {
      getSubtitles: async () => {
        if (subtitles instanceof Error) throw subtitles;
        return { items: subtitles ?? [] };
      },
      getSlides: async () => ({ items: slides ?? [] }),
      transcribeAudio: async () => {
        if (transcribe instanceof Error) throw transcribe;
        return transcribe ?? { segments: [] };
      },
    },
  };
}

const tool = (services, name) => createRawMaterialTools(services).find((item) => item.name === name);
const call = (services, name, args) => tool(services, name).run(args, {});

/* ────────────────────────── raw_transcript ────────────────────────── */

test('转写稿：按时间给出原话，标明来源是平台字幕', async () => {
  const services = classroom({
    subtitles: [
      { start: 0, text: '今天我们讲牛顿第二定律' },
      { start: 12.5, text: 'F 等于 ma' },
    ],
  });
  const result = await call(services, 'raw_transcript', { courseId: 'c1', subId: 's1' });
  assert.equal(result.via, 'platform', '要标明这一份来自平台字幕，不是本地转写');
  assert.equal(result.total, 2);
  assert.equal(result.items[0].text, '今天我们讲牛顿第二定律');
  assert.equal(result.items[0].at, 0);
  assert.equal(result.items[1].at, 12.5);
});

test('keyword 按字面过滤，不区分大小写', async () => {
  const services = classroom({
    subtitles: [
      { start: 0, text: 'Newton 第二定律' },
      { start: 5, text: '欧姆定律' },
    ],
  });
  const result = await call(services, 'raw_transcript', { courseId: 'c1', subId: 's1', keyword: 'newton' });
  assert.equal(result.matched, 1);
  assert.equal(result.total, 2, 'total 是过滤前的总数 —— 用户要知道这一节共多少句');
  assert.match(result.items[0].text, /Newton/);
});

test('分页：offset / limit 生效，nextOffset 指向下一页', async () => {
  const subtitles = Array.from({ length: 10 }, (_, i) => ({ start: i, text: `第 ${i} 句` }));
  const services = classroom({ subtitles });
  const result = await call(services, 'raw_transcript', { courseId: 'c1', subId: 's1', offset: 2, limit: 3 });
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].text, '第 2 句');
  assert.equal(result.nextOffset, 5);
});

test('没有字幕且没要求转写：如实返回空，不假装有内容', async () => {
  const services = classroom({ subtitles: [] });
  const result = await call(services, 'raw_transcript', { courseId: 'c1', subId: 's1' });
  assert.equal(result.total, 0);
  assert.equal(result.items.length, 0);
  // 空就是空。模型据此应该说「这节没有转写稿」，而不是编。
});

test('transcribe=true 时走本地转写，并标明引擎', async () => {
  const services = classroom({
    subtitles: [],
    transcribe: { engine: 'sensevoice', segments: [{ start: 0, text: '本地转出来的第一句' }] },
  });
  const result = await call(services, 'raw_transcript', { courseId: 'c1', subId: 's1', transcribe: true });
  assert.match(result.via, /local/);
  assert.match(result.via, /sensevoice/, '要说清用了哪个引擎 —— 不同引擎的结果可信度不同');
  assert.equal(result.items[0].text, '本地转出来的第一句');
});

test('本地转写没装内核：错误原样透传，不返回假文本', async () => {
  // 这是最要紧的一条：装没装是用户要照做的下一步，不能被包装成通用错误，
  // 更不能返回空数组让模型以为「这节课没讲」。
  const err = Object.assign(new Error('需要 ASR 内核'), { code: 'DEPENDENCY_MISSING' });
  const services = classroom({ subtitles: [], transcribe: err });
  await assert.rejects(
    () => call(services, 'raw_transcript', { courseId: 'c1', subId: 's1', transcribe: true }),
    (error) => {
      assert.equal(error.code, 'DEPENDENCY_MISSING');
      return true;
    },
  );
});

test('参数白名单：拒绝账号与路径', async () => {
  const services = classroom({ subtitles: [] });
  for (const bad of [{ accountId: 'x' }, { path: '/etc/passwd' }, { dir: 'D:\\x' }]) {
    await assert.rejects(
      () => call(services, 'raw_transcript', { courseId: 'c1', subId: 's1', ...bad }),
      (error) => error.code === 'INPUT',
    );
  }
});

test('courseId / subId 必填，缺了就报', async () => {
  const services = classroom({ subtitles: [] });
  await assert.rejects(() => call(services, 'raw_transcript', {}), (error) => error.code === 'INPUT');
  await assert.rejects(() => call(services, 'raw_transcript', { courseId: 'c1' }), (error) => error.code === 'INPUT');
});

test('guidance 说清这是原始素材，引用方式不同', async () => {
  const services = classroom({ subtitles: [{ start: 0, text: 'x' }] });
  const result = await call(services, 'raw_transcript', { courseId: 'c1', subId: 's1' });
  assert.match(result.guidance, /原始素材|原话/);
  assert.match(result.guidance, /录音|课堂/, '要提示注明出处');
});

/* ────────────────────────── raw_slides ────────────────────────── */

test('PPT 是图片不是文字 —— 结果里必须标明这一点', async () => {
  const services = classroom({
    slides: [{ imageUrl: 'https://x/p1.jpg' }, { imageUrl: 'https://x/p2.jpg' }],
  });
  const result = await call(services, 'raw_slides', { courseId: 'c1', subId: 's1' });
  assert.equal(result.kind, 'images-not-text', '这是给模型的硬信号：别把图当文字引用');
  assert.equal(result.total, 2);
  assert.equal(result.items[0].page, 1);
  assert.equal(result.items[0].imageUrl, 'https://x/p1.jpg');
  assert.match(result.guidance, /没有文字|不是文字/);
  assert.match(result.guidance, /raw_transcript/, '要指向能读文字的那个工具');
});

test('命中本地缓存时带上 localUrl', async () => {
  const services = classroom({
    slides: [{ imageUrl: 'https://x/p1.jpg', cacheUrl: '/zhiyun-slides/abc' }],
  });
  const result = await call(services, 'raw_slides', { courseId: 'c1', subId: 's1' });
  assert.equal(result.items[0].localUrl, '/zhiyun-slides/abc');
});

test('分页：从 0 算的 offset，页码从 1 报', async () => {
  const slides = Array.from({ length: 5 }, (_, i) => ({ imageUrl: `https://x/p${i}.jpg` }));
  const services = classroom({ slides });
  const result = await call(services, 'raw_slides', { courseId: 'c1', subId: 's1', offset: 1, limit: 2 });
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].page, 2, '给人看的页码从 1 起');
  assert.equal(result.nextOffset, 3);
});

test('没有课件：空数组，不抛', async () => {
  const services = classroom({ slides: [] });
  const result = await call(services, 'raw_slides', { courseId: 'c1', subId: 's1' });
  assert.equal(result.total, 0);
  assert.deepEqual(result.items, []);
});

/* ────────────────────────── 结构 ────────────────────────── */

test('两个工具都注册在同一个工厂里，且描述互相指引', async () => {
  const tools = createRawMaterialTools(classroom({}));
  assert.deepEqual(tools.map((item) => item.name).sort(), ['raw_slides', 'raw_transcript']);
  const transcript = tools.find((item) => item.name === 'raw_transcript');
  assert.match(transcript.description, /study_read|整理/, '要说清与 wiki 讲义的区别');
  assert.match(transcript.description, /没整理过的课也能读/, '这是本次改动的核心目的，必须写进描述');
});
