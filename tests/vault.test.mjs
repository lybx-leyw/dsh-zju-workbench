/**
 * Obsidian 式库模型的契约测试。
 *
 * 这个包是**自主实现**（源模型是 Obsidian 的双链/标签/图谱语义，不是移植 ——
 * 参照项目 `zhiyun-pro` 也没有这套东西）。所以测试的重点是**语法语义的边界**：
 * 那些"朴素正则会错、用户却天天在用"的地方。每一条都对应一个真实的错误形态。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseNoteLinks, splitWikilink, normalizeTarget, basenameOf, excludedRanges,
} from '../packages/dsh-zhiyun-vault/src/parse/links.js';
import {
  buildIndex, createResolver, titleOf, renameLinks, targetCandidates,
} from '../packages/dsh-zhiyun-vault/src/index/vault-index.js';

test('`[[目标|别名]]`：别名不属于目标', () => {
  const { wikilinks } = parseNoteLinks('见 [[真实笔记|显示成这个]]。');
  assert.equal(wikilinks.length, 1);
  assert.equal(wikilinks[0].target, '真实笔记');
  assert.equal(wikilinks[0].alias, '显示成这个');
});

test('`[[目标#小节]]`：锚点不属于目标', () => {
  const { wikilinks } = parseNoteLinks('见 [[笔记#某个小节]]');
  assert.equal(wikilinks[0].target, '笔记');
  assert.equal(wikilinks[0].heading, '某个小节');
  assert.equal(wikilinks[0].blockId, null);
});

test('`[[目标#^块id]]`：块引用与标题锚点要区分开', () => {
  const block = parseNoteLinks('[[笔记#^abc123]]').wikilinks[0];
  assert.equal(block.target, '笔记');
  assert.equal(block.blockId, 'abc123');
  assert.equal(block.heading, null, '块引用不该被当成标题');

  const heading = parseNoteLinks('[[笔记#标题]]').wikilinks[0];
  assert.equal(heading.heading, '标题');
  assert.equal(heading.blockId, null);
});

test('`[[#小节]]`：空目标是本文内跳转，合法且不算未解析', () => {
  const { wikilinks } = parseNoteLinks('跳到 [[#本文小节]]');
  assert.equal(wikilinks.length, 1);
  assert.equal(wikilinks[0].target, '', '空目标是合法的');
  assert.equal(wikilinks[0].heading, '本文小节');

  // 索引里它不该被报成"未解析"（那是用户自己文内跳转，不是断链）
  const index = buildIndex([{ path: 'a.md', markdown: '跳到 [[#小节]]' }]);
  assert.equal(index.unresolved.length, 0, '本文内跳转不是未解析链接');
});

test('锚点与别名同时出现：`[[目标#小节|别名]]`', () => {
  const link = parseNoteLinks('[[笔记#小节|看图]]').wikilinks[0];
  assert.equal(link.target, '笔记');
  assert.equal(link.heading, '小节');
  assert.equal(link.alias, '看图');
});

test('别名里允许再有 `|`（只按第一个切）', () => {
  const link = splitWikilink('笔记|a|b');
  assert.equal(link.target, '笔记');
  assert.equal(link.alias, 'a|b');
});

test('`![[图片.png]]` 是嵌入，不与普通链接混在一起', () => {
  const { wikilinks, embeds } = parseNoteLinks('![[图.png]] 和 [[笔记]]');
  assert.equal(embeds.length, 1, '嵌入单独收集');
  assert.equal(embeds[0].embed, true);
  assert.equal(embeds[0].target, '图.png');
  assert.equal(wikilinks.length, 1);
  assert.equal(wikilinks[0].embed, false);
});

test('代码块与行内代码里的 `[[x]]` 不是链接', () => {
  const md = [
    '正常 [[真链接]]',
    '',
    '```',
    '这是示例：[[假链接]] 不该被解析',
    '```',
    '',
    '行内：`[[也是假的]]`',
  ].join('\n');
  const { wikilinks } = parseNoteLinks(md);
  const targets = wikilinks.map((l) => l.target);
  assert.deepEqual(targets, ['真链接'], `只应解析出真链接，实际 ${JSON.stringify(targets)}`);
});

test('代码块未闭合时，其后内容仍在代码块内', () => {
  // 用户写到一半保存，围栏没闭合 —— 那时后面全是代码，不该抽链接
  const md = '前言\n```\n[[不该被解析]]\n后面还有\n';
  const { wikilinks } = parseNoteLinks(md);
  assert.equal(wikilinks.length, 0, '未闭合围栏之后仍是代码区');
});

test('URL 里的 `#` 不产生假标签', () => {
  const { tags } = parseNoteLinks('见 https://example.com/page#section 这段');
  assert.deepEqual(tags.map((t) => t.tag), [], 'URL 锚点不是标签');

  // 但真标签仍要抽出来
  const mixed = parseNoteLinks('https://x.com/a#b 与 #真标签');
  assert.deepEqual(mixed.tags.map((t) => t.tag), ['真标签']);
});

test('Markdown 标题行不是标签', () => {
  const md = '# 这是标题\n## 二级标题\n\n正文里有 #真标签';
  const { tags } = parseNoteLinks(md);
  assert.deepEqual(tags.map((t) => t.tag), ['真标签'], 'ATX 标题不该被当标签');
});

test('标签要求 `#` 前有分隔符（中文紧贴不算标签）', () => {
  // ⚠️ 这条钉的是**故意**的行为：`#` 前必须有空白/标点/行首。
  // 否则「第#3章」「与#紧贴的」这类中文里正常出现的 `#` 会被抽成假标签，
  // 标签面板里就会多出一堆用户从没打过的标签。Obsidian 同样要求分隔符。
  const { tags } = parseNoteLinks('#学习方法 #父/子 #a-b_c 与#紧贴的');
  assert.deepEqual(
    tags.map((t) => t.tag).sort(),
    ['a-b_c', '学习方法', '父/子'].sort(),
    '紧贴中文的 #紧贴的 不该算标签',
  );

  // 但前面有标点/空格时就算
  const spaced = parseNoteLinks('见 #标签 与（#括号后）');
  assert.ok(spaced.tags.some((t) => t.tag === '标签'), '空格后算');
  assert.ok(spaced.tags.some((t) => t.tag === '括号后'), '中文括号后算');
});

test('标签位置指向 `#` 本身（编辑器高亮要用）', () => {
  const md = '前面 #标签 后面';
  const { tags } = parseNoteLinks(md);
  assert.equal(md.slice(tags[0].start, tags[0].end), '#标签');
});

test('链接位置能精确切回原文', () => {
  const md = '前面 [[目标|别名]] 后面';
  const { wikilinks } = parseNoteLinks(md);
  assert.equal(md.slice(wikilinks[0].start, wikilinks[0].end), '[[目标|别名]]');
  assert.equal(wikilinks[0].raw, '[[目标|别名]]');
});

test('目标规范化：大小写不敏感、去 .md、反斜杠归一', () => {
  assert.equal(normalizeTarget('  MyNote  '), 'mynote');
  assert.equal(normalizeTarget('笔记.md'), '笔记');
  assert.equal(normalizeTarget('a\\b\\c'), 'a/b/c');
  assert.equal(basenameOf('a/b/Note.md'), 'note');
  assert.equal(basenameOf('Note'), 'note');
  assert.equal(normalizeTarget(''), '');
});

test('解析器：同目录优先于全库 basename', () => {
  const notes = [
    { path: 'a/target.md', markdown: '' },
    { path: 'b/target.md', markdown: '' },
    { path: 'a/source.md', markdown: '[[target]]' },
  ];
  const resolver = createResolver(notes);
  // a/source.md 里的 [[target]] 应当命中同目录的 a/target.md
  assert.equal(resolver.resolve('target', 'a/source.md'), 'a/target.md');
  assert.equal(resolver.isAmbiguous('target'), true, '同名两篇应报歧义');
});

test('解析器：全库 basename 唯一命中才认，多个同名报未解析', () => {
  const unique = createResolver([{ path: 'x/only.md' }, { path: 'y.md' }]);
  assert.equal(unique.resolve('only', 'y.md'), 'x/only.md', '唯一命中应解析');

  const ambiguous = createResolver([{ path: 'x/dup.md' }, { path: 'y/dup.md' }]);
  assert.equal(ambiguous.resolve('dup', 'z.md'), null, '多个同名 → 不猜，报未解析');
  assert.equal(ambiguous.isAmbiguous('dup'), true);
});

test('解析器：精确路径优先', () => {
  const notes = [{ path: 'a/b.md' }, { path: 'b.md' }];
  const resolver = createResolver(notes);
  assert.equal(resolver.resolve('a/b', 'other.md'), 'a/b.md');
  assert.equal(resolver.resolve('b', 'other.md'), 'b.md');
});

test('索引：反向链接是双向能力的来源', () => {
  const index = buildIndex([
    { path: 'a.md', markdown: '连到 [[b]] 和 [[c]]' },
    { path: 'b.md', markdown: '' },
    { path: 'c.md', markdown: '' },
  ]);
  // 注意：没有"c.md 连到 a"这句话，但 a 出链到 c —— b/c 的反链里应有 a。
  // 反链的键是**完整 path**（`b.md`）而不是 basename：同一库可以有
  // `x/b.md` 与 `y/b.md`，用 basename 当键会把两篇的反链混在一起。
  const backToB = index.backlinks.get('b.md');
  const backToC = index.backlinks.get('c.md');
  assert.equal(backToB.length, 1);
  assert.equal(backToB[0].from, 'a.md');
  assert.equal(backToB[0].fromTitle, 'a');
  assert.equal(backToC.length, 1);
  assert.equal(backToC[0].from, 'a.md');
  // a 自己没有入链
  assert.equal(index.backlinks.get('a.md'), undefined);
});

test('索引：未解析链接如实上报，并区分 missing 与 ambiguous', () => {
  const index = buildIndex([
    { path: 'a.md', markdown: '断链 [[不存在的笔记]]' },
    { path: 'x/dup.md', markdown: '' },
    { path: 'y/dup.md', markdown: '' },
    { path: 'b.md', markdown: '歧义 [[dup]]' },
  ]);
  const missing = index.unresolved.find((u) => u.target === '不存在的笔记');
  const ambiguous = index.unresolved.find((u) => u.target === 'dup');
  assert.equal(missing.reason, 'missing');
  assert.equal(missing.from, 'a.md');
  assert.equal(ambiguous.reason, 'ambiguous', '同名多篇要单独报歧义，便于解释');
});

test('索引：孤立节点 = 既无入链也无出链', () => {
  const index = buildIndex([
    { path: 'a.md', markdown: '[[b]]' },
    { path: 'b.md', markdown: '' },
    { path: 'lonely.md', markdown: '这里没有任何链接' },
  ]);
  assert.deepEqual(index.orphans, ['lonely.md'], '只有 lonely 是孤立的');
});

test('索引：标签反查带出去重后的笔记列表', () => {
  const index = buildIndex([
    { path: 'a.md', markdown: '#学习方法 与 #学习方法' },
    { path: 'b.md', markdown: '#学习方法' },
    { path: 'c.md', markdown: '#其他' },
  ]);
  assert.deepEqual(index.tags.get('学习方法').sort(), ['a.md', 'b.md'], '同一篇里重复标签只记一次');
  assert.deepEqual(index.tags.get('其他'), ['c.md']);
});

test('索引：图谱节点带出入度，边分 link 与 embed', () => {
  const index = buildIndex([
    { path: 'a.md', markdown: '[[b]] 和 ![[c.png]]' },
    { path: 'b.md', markdown: '[[a]]' },
    { path: 'c.png', markdown: '' },
  ]);
  const nodeA = index.graph.nodes.find((n) => n.id === 'a.md');
  assert.equal(nodeA.outDegree, 1, '出度只算链接，不算嵌入');
  assert.equal(nodeA.inDegree, 1, 'b 连回 a');
  const kinds = index.graph.edges.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ['embed', 'link', 'link']);
});

test('索引是纯函数：同样输入给同样输出，且不改动入参', () => {
  const notes = [
    { path: 'a.md', markdown: '[[b]] #标签' },
    { path: 'b.md', markdown: '[[a]]' },
  ];
  const snapshot = JSON.stringify(notes);
  const first = buildIndex(notes);
  const second = buildIndex(notes);
  assert.deepEqual(first.graph.edges, second.graph.edges);
  assert.deepEqual([...first.backlinks.keys()], [...second.backlinks.keys()]);
  assert.equal(JSON.stringify(notes), snapshot, '入参不得被改动');
});

test('索引：坏记录不使整份索失败', () => {
  const index = buildIndex([
    null,
    undefined,
    { markdown: '没有 path' },
    { path: 'ok.md', markdown: '[[ok]]' },
    42,
  ]);
  assert.equal(index.notes.size, 1, '只认有 path 的记录');
  assert.ok(index.notes.has('ok.md'));
});

test('索引：空输入不抛异常', () => {
  const index = buildIndex([]);
  assert.equal(index.notes.size, 0);
  assert.deepEqual(index.orphans, []);
  assert.deepEqual(index.graph.nodes, []);
  assert.equal(buildIndex(null).notes.size, 0);
  assert.equal(buildIndex(undefined).notes.size, 0);
});

test('重命名改写：三种形态都改，且别名与锚点原样保留', () => {
  const notes = [
    { path: 'old.md', markdown: '自己' },
    { path: 'src.md', markdown: '[[old]] 与 [[old|别名]] 与 [[old#小节]] 与 ![[old]]' },
  ];
  const changed = renameLinks(notes, 'old.md', 'new.md');
  assert.equal(changed.length, 1);
  const after = changed[0].markdown;
  assert.ok(after.includes('[[new]]'), '裸链接');
  assert.ok(after.includes('[[new|别名]]'), '别名必须保留');
  assert.ok(after.includes('[[new#小节]]'), '锚点必须保留');
  assert.ok(after.includes('![[new]]'), '嵌入也要改');
  assert.ok(!after.includes('[[old'), '不该残留旧名');
});

test('重命名改写：不误改指向别处的同名链接', () => {
  const notes = [
    { path: 'x/note.md', markdown: '甲' },
    { path: 'y/note.md', markdown: '乙' },
    // 从 y/ 里写的 [[note]] 指的是 y/note.md，不该因为重命名 x/note.md 被改
    { path: 'y/src.md', markdown: '[[note]]' },
  ];
  const changed = renameLinks(notes, 'x/note.md', 'x/renamed.md');
  assert.equal(changed.length, 0, '指向另一篇的同名链接不该被改');
});

test('重命名改写：一次多处的下标倒序替换，位置不错乱', () => {
  const notes = [
    { path: 'a.md', markdown: '' },
    { path: 'b.md', markdown: '[[a]][[a]][[a]]' },
  ];
  const changed = renameLinks(notes, 'a.md', 'zzz.md');
  assert.equal(changed[0].changed, 3);
  assert.equal(changed[0].markdown, '[[zzz]][[zzz]][[zzz]]');
});

test('titleOf：取文件名当标题，去目录与扩展名', () => {
  assert.equal(titleOf('a/b/MyNote.md'), 'MyNote');
  assert.equal(titleOf('MyNote.md'), 'MyNote');
  assert.equal(titleOf('a\\b\\Win.md'), 'Win');
  assert.equal(titleOf(''), '');
});

test('targetCandidates：给出补全用的多种写法', () => {
  const c = targetCandidates({ path: 'folder/My Note.md' });
  assert.ok(c.includes('folder/My Note'), '应含去扩展名的全路径');
  assert.ok(c.includes('my note'), '应含 basename');
  assert.ok(c.includes('My Note'), '应含标题原样');
});

test('excludedRanges：区间合并且不与正文错位', () => {
  const md = 'a `code` b $math$ c';
  const ranges = excludedRanges(md);
  // 两个区间：`code` 与 $math$
  assert.equal(ranges.length, 2);
  for (const [s, e] of ranges) {
    assert.ok(s >= 0 && e <= md.length, '区间必须落在正文内');
    assert.ok(s < e, '区间不能为空');
  }
  // 区间内容确实是代码/数学
  const texts = ranges.map(([s, e]) => md.slice(s, e));
  assert.deepEqual(texts.sort(), ['$math$', '`code`'].sort());
});
