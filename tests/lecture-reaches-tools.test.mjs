/**
 * 讲义必须真的传进工具与流水线，否则模型会编造内容。
 *
 * # 锁住的事故（2026-10-31 真机）
 *
 * 适配层写的是 `createLectureTools({ lecture: resource.lecture })`。
 * 但 `resource` 是 `resources.fromLecture()` 的产物（bundle），它的顶层就有
 * `chapters`，**没有 `lecture` 字段** —— 于是取到 undefined。
 *
 * 后果比报错严重得多：模型拿不到讲义时不报错，而是编造。真机输出是
 *
 *   「本轮「讲义」知识库为空（0 篇文档），讲义原文尚未到位，
 *     下面这道题是按模板定型的占位原型…」
 *
 * 然后给出一道和课程毫无关系的占位题。用户会以为「出题成功了」，
 * 实际上拿到的是幻觉。宁可失败，也不能交付这个。
 *
 * 用法：node tests/lecture-reaches-tools.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve('.');
const load = rel => import(pathToFileURL(path.join(ROOT, rel)).href);

const BACKEND = 'packages/dsh-zhiyun-core-study/src/core-question-backend.js';
const source = fs.readFileSync(path.resolve(BACKEND), 'utf8');

const SAMPLE = {
  resourceId: 'r1',
  accountScope: { accountId: 'a' },
  courseId: 'c1',
  subId: 's1',
  title: '测试讲义',
  lecture: {
    chapters: [{
      title: '第一章',
      topics: [{
        title: '知识点一',
        blocks: [{ kind: 'paragraph', text: '这是讲义正文，模型必须能读到这段话才能出真题。' }],
      }],
    }],
  },
};

test('bundle 顶层有 chapters，且没有 lecture 字段', async () => {
  const { fromLecture } = await load('packages/dsh-zhiyun-core-learning-resource/src/sources.js');
  const bundle = fromLecture(SAMPLE);
  assert.ok(Array.isArray(bundle.chapters), 'bundle 顶层必须有 chapters');
  assert.ok(bundle.chapters.length > 0);
  assert.equal('lecture' in bundle, false, 'bundle 没有 lecture 字段 —— 取它只会得到 undefined');
});

test('把 bundle 传给 buildLectureIndex 能建出块；传 bundle.lecture 建不出', async () => {
  const { fromLecture } = await load('packages/dsh-zhiyun-core-learning-resource/src/sources.js');
  const { buildLectureIndex } = await load('packages/dsh-zhiyun-core-lecture-tools/src/lecture-index.js');
  const bundle = fromLecture(SAMPLE);

  const good = buildLectureIndex(bundle);
  assert.ok(good.blocks.length > 0, '传 bundle 必须能建出块，否则 rag/read_source 读到空');
  assert.ok(good.sources.size > 0, '必须能建出来源索引');

  const bad = buildLectureIndex(bundle.lecture);
  assert.equal(bad.blocks.length, 0, '传 bundle.lecture 会得到空索引（这就是曾经的 bug）');
});

test('适配层传给 createLectureTools 的是 bundle 实例，不是 bundle.lecture', () => {
  const idx = source.indexOf('createLectureTools(');
  assert.ok(idx > 0, '找不到 createLectureTools 调用');
  const call = source.slice(idx, idx + 240);
  // 关键：不能出现 `.lecture` 后缀 —— bundle 没有这个字段
  assert.ok(
    !/lecture:\s*resource\.lecture/.test(call),
    '不能传 resource.lecture —— bundle 没有这个字段，工具会读到空讲义',
  );
  // 变量名在适配层里叫 resource，它持有的就是 bundle 实例
  assert.match(call, /lecture:\s*resource\b/, '应直接传 bundle 实例');
});

test('适配层传给 runDeepQuestion 的 lecture 同样是 bundle 实例', () => {
  const idx = source.indexOf('await runDeepQuestion(');
  assert.ok(idx > 0, '找不到 runDeepQuestion 调用');
  const call = source.slice(idx, idx + 400);
  assert.ok(
    !/lecture:\s*resource\.lecture/.test(call),
    'runDeepQuestion 的 lecture 不能取 resource.lecture',
  );
  assert.match(call, /lecture:\s*resource\b/, '应直接传 bundle 实例');
});

test('源码里不再出现 resource.lecture（该字段不存在）', () => {
  assert.equal(
    /resource\.lecture/.test(source),
    false,
    'bundle 没有 lecture 字段；任何 resource.lecture 都是空值来源',
  );
});

test('rag 必须能检索到讲义（kbName 缺省值要给它）', async () => {
  const { fromLecture } = await load('packages/dsh-zhiyun-core-learning-resource/src/sources.js');
  const { createLectureTools } = await load('packages/dsh-zhiyun-core-lecture-tools/src/index.js');
  const bundle = fromLecture(SAMPLE);

  // 不给 kbName：rag 报 "RAG requires an explicit kb_name"
  const withoutName = createLectureTools({ lecture: bundle });
  const rag1 = withoutName.find(t => t.name === 'rag');
  const bad = await rag1.handler({ query: '讲义正文' });
  assert.equal(bad.ok, false, '不给 kbName 时 rag 会失败');

  // 给了 kbName：能命中
  const withName = createLectureTools({ lecture: bundle, knowledge: { kbName: 'lecture' } });
  const rag2 = withName.find(t => t.name === 'rag');
  const good = await rag2.handler({ query: '讲义正文' });
  assert.equal(good.ok, true, '给了 kbName 后 rag 必须能检索');
  assert.match(String(good.result?.content ?? ''), /讲义正文/, '检索结果里要有讲义原文');
});

test('适配层给 createLectureTools 传了 kbName', () => {
  const idx = source.indexOf('createLectureTools(');
  const call = source.slice(idx, idx + 260);
  assert.match(call, /kbName/, '不传 kbName 时 rag 永远拿不到检索结果，模型只能编');
});
