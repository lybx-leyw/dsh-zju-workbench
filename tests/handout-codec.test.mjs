/**
 * 讲义 md 的编解码契约测试。
 *
 * 这层最容易出的错不是抛异常，而是**静默丢内容**：某个块类型没映射上、
 * 例题的解答被吞、正文里以 `#` 开头的一行把结构打乱。所以每一条都拿
 * 「往返后的实际值」与「输入的基线」逐项比，而不是只断言不报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BLOCK_KIND_LABELS,
  SOLUTION_MARKER,
  baselineToMarkdown,
  blockParts,
  effectiveBlocks,
  kindOf,
  markdownToChapters,
  resolveBlockKind,
  roundtrip,
} from '../packages/dsh-zhiyun-core-handout/src/codec.js';

const kind = (label) => resolveBlockKind(label);

/** 一份覆盖五种块、两章三知识点的基线。 */
function baseline() {
  return [
    {
      title: '第一章 绪论',
      topics: [
        {
          title: '1.1 什么是算法',
          blocks: [
            { kind: kind('讲解'), title: '', text: '算法是求解问题的有限步骤。' },
            { kind: kind('定义'), title: '算法的五个特性', text: '有穷性、确定性、可行性、输入、输出。' },
          ],
        },
        {
          title: '1.2 复杂度',
          blocks: [
            { kind: kind('步骤'), title: '分析步骤', text: '1. 数循环\n2. 取最高阶' },
            { kind: kind('例题'), title: '二分查找', stem: '给定有序数组，求目标下标。', solution: 'O(log n)，每次折半。' },
          ],
        },
      ],
    },
    {
      title: '第二章 树',
      topics: [
        {
          title: '2.1 二叉树',
          blocks: [{ kind: kind('说明'), title: '', text: '本节只讲二叉，多叉留到下一节。' }],
        },
      ],
    },
  ];
}

test('导出面：五个块类型标签与 App 一致', () => {
  assert.deepEqual([...BLOCK_KIND_LABELS], ['讲解', '定义', '步骤', '例题', '说明']);
});

test('往返：章/知识点/块三层与 kind、title、正文逐项相等', () => {
  const source = baseline();
  const { chapters, warnings } = roundtrip(source, '数据结构 第三讲');
  assert.deepEqual(warnings, [], '正常基线不该产生 warning');

  assert.equal(chapters.length, source.length, '章数必须一致');
  for (const [ci, chapter] of source.entries()) {
    assert.equal(chapters[ci].title, chapter.title, `第 ${ci + 1} 章标题`);
    assert.equal(chapters[ci].topics.length, chapter.topics.length, `第 ${ci + 1} 章的知识点数`);
    for (const [ti, topic] of chapter.topics.entries()) {
      const actual = chapters[ci].topics[ti];
      assert.equal(actual.title, topic.title, `第 ${ci + 1} 章第 ${ti + 1} 个知识点标题`);
      const want = effectiveBlocks(topic);
      assert.equal(actual.blocks.length, want.length, `${topic.title} 的块数`);
      for (const [bi, block] of want.entries()) {
        const got = actual.blocks[bi];
        assert.equal(got.kind.wire, kindOf(block).wire, `${topic.title} 第 ${bi + 1} 块的类型`);
        assert.equal(got.title, String(block.title ?? '').trim(), `${topic.title} 第 ${bi + 1} 块的小标题`);
        if (kindOf(block).wire === 'example') {
          assert.equal(got.stem, block.stem, '例题题干');
          assert.equal(got.solution, block.solution, '例题解答');
        } else {
          assert.equal(got.text, block.text, `${topic.title} 第 ${bi + 1} 块的正文`);
        }
      }
    }
  }
});

test('例题：题干与解答分隔成两段，而不是挤成一段', () => {
  const md = baselineToMarkdown(baseline(), 'T');
  assert.ok(md.includes(SOLUTION_MARKER), 'md 里必须有解答分隔行');
  const { chapters } = markdownToChapters(md);
  const example = chapters[0].topics[1].blocks[1];
  assert.equal(example.kind.wire, 'example');
  assert.equal(example.stem, '给定有序数组，求目标下标。');
  assert.equal(example.solution, 'O(log n)，每次折半。');
});

test('正文里以 # 开头的行不会被当成结构', () => {
  const chapters = [{
    title: '章',
    topics: [{
      title: '知识点',
      blocks: [{ kind: kind('讲解'), title: '', text: '## 这不是章标题\n#### 这不是块标题\n正文照旧' }],
    }],
  }];
  const md = baselineToMarkdown(chapters, 'T');
  const { chapters: back, warnings } = markdownToChapters(md);
  assert.deepEqual(warnings, []);
  assert.equal(back.length, 1);
  assert.equal(back[0].topics.length, 1);
  assert.equal(back[0].topics[0].blocks.length, 1, '不该多出块');
  assert.equal(back[0].topics[0].blocks[0].text, '## 这不是章标题\n#### 这不是块标题\n正文照旧');
});

test('未知块类型：降级成讲解并留 warning，正文一个字不丢', () => {
  const md = ['# T', '', '## 章', '', '### 知识点', '', '#### 补充 · 一点补充', '', '这段要留下。'].join('\n');
  const { chapters, warnings } = markdownToChapters(md);
  const block = chapters[0].topics[0].blocks[0];
  assert.equal(block.kind.wire, 'elaboration', '认不出的类型降级成讲解');
  assert.equal(block.title, '补充 · 一点补充', '整行保留成小标题（含原文）');
  assert.equal(block.text, '这段要留下。');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /补充/);
});

test('结构错乱：块出现在没有知识点的地方只丢那一块，并说出来', () => {
  const md = ['# T', '', '#### 讲解 · 孤块', '', '正文'].join('\n');
  const { chapters, warnings } = markdownToChapters(md);
  assert.deepEqual(chapters, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /孤块/);
});

test('空章与空知识点不炸，且位置编号按序补上', () => {
  const chapters = [{ title: '空章', topics: [] }, { title: '有内容', topics: [{ title: 'p', blocks: [{ kind: kind('讲解'), title: '', text: 'x' }] }] }];
  const { chapters: back } = roundtrip(chapters, 'T');
  assert.equal(back.length, 2);
  assert.deepEqual(back.map((c) => c.no), [1, 2]);
  assert.equal(back[1].topics[0].no, 1);
  assert.equal(back[0].topics.length, 0);
});

test('只有 passages 的旧数据按同一套退化规则编码', () => {
  const chapters = [{ title: '章', topics: [{ title: '知识点', passages: [{ label: '定义', text: '旧数据的正文' }] }] }];
  const { chapters: back } = roundtrip(chapters, 'T');
  const block = back[0].topics[0].blocks[0];
  assert.equal(block.kind.wire, 'definition');
  assert.equal(block.text, '旧数据的正文');
});

test('块标题为空时 md 只写类型，不写孤零零的分隔符', () => {
  const md = baselineToMarkdown([{ title: '章', topics: [{ title: 'p', blocks: [{ kind: kind('讲解'), title: '', text: 'x' }] }] }], 'T');
  assert.ok(md.includes('#### 讲解\n'), '空小标题时标题行应止于类型');
  assert.ok(!md.includes('#### 讲解 · \n'));
});

test('blockParts：例题取 stem/solution，其余取 text', () => {
  assert.deepEqual(blockParts({ kind: kind('例题'), stem: 'a', solution: 'b', text: '忽略' }), { stem: 'a', solution: 'b' });
  assert.deepEqual(blockParts({ kind: kind('讲解'), text: '正文' }), { text: '正文' });
});
