/**
 * 论文库的**多级文件树**：编码规则 + 树读取 + 页面侧解码一致性。
 *
 * # 这条测试守的是什么
 *
 * 上游只做**一层**遍历（`dist/library.js:42-53`：`join(dataDir, topic)` 下直接读文件）。
 * 所以磁盘布局必须是 `dataDir/<单段 topic>/<name>.pdf`，多级路径编码进 topic。
 * 一旦有人"顺手"把磁盘改成真实多级目录（`dataDir/理学/力学/x.pdf`），
 * 上游就再也看不见这篇文献 —— 整篇翻译、伴读会话、search_paper 全静默失效，
 * 而**界面上树还是好好显示着**（因为树自己读盘）。这是最难查的一类不一致。
 *
 * 所以这里同时钉住三件事：
 *   1. 编码可逆且**无撞名**（朴素 `join('__')` 会撞）；
 *   2. 树是从**编码后的目录**解码出来的，不是直接读多级目录；
 *   3. **页面侧也有一份 decodeTopic**（客户端不能 import 宿主的 node 模块），
 *      两份规则必须一致 —— 漂移的后果是高亮错位，不报错。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { decodeTopic, encodeTopic, readPaperTree, upstreamRefFor } from '../packages/dsh-zhiyun-host-paper/src/paper-tree.js';

test('编码可逆：任意层级往返后不变', () => {
  const cases = ['理学', '理学/力学', 'a/b/c', 'a+b', 'a%2Fb', '100% 完成', 'a__b', '混合/中文 mixed'];
  for (const rel of cases) {
    assert.equal(decodeTopic(encodeTopic(rel)), rel, `往返失败：${rel}`);
  }
  assert.equal(encodeTopic(''), '', '库根编码成空串');
  assert.equal(encodeTopic('a//b'), 'a+b', '空段被丢掉');
});

test('编码无撞名：真名带分隔符的目录不会与深层路径混淆', () => {
  // 朴素方案 `join('__')` 下这两个都会变成 `a__b`，两篇文献会抢同一个目录。
  assert.notEqual(encodeTopic('a__b'), encodeTopic('a/b'));
  assert.notEqual(encodeTopic('a+b'), encodeTopic('a/b'), '+ 本身必须被转义');
  assert.notEqual(encodeTopic('a%2Bb'), encodeTopic('a+b'), '% 本身必须被转义');
  assert.equal(decodeTopic(encodeTopic('a+b')), 'a+b');
  assert.equal(decodeTopic(encodeTopic('a/b')), 'a/b');
});

test('upstreamRefFor：深层路径 → 上游坐标', () => {
  assert.deepEqual(upstreamRefFor('理学/力学/讲义.pdf'), { topic: '理学+力学', name: '讲义' });
  assert.deepEqual(upstreamRefFor('理学/讲义.pdf'), { topic: '理学', name: '讲义' });
  // 库根下的文件：topic 是空串（上游用 join(dataDir, '') 也落到 dataDir）
  assert.deepEqual(upstreamRefFor('讲义.pdf'), { topic: '', name: '讲义' });
  assert.deepEqual(upstreamRefFor('a/b.PDF'), { topic: 'a', name: 'b' });
});

test('readPaperTree：从编码目录解码出多级树', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'paper-tree-'));
  try {
    // 按**编码后**的磁盘布局预置（这是上游唯一看得懂的形状）
    await mkdir(path.join(dir, '理学+力学'), { recursive: true });
    await mkdir(path.join(dir, '心理学'), { recursive: true });
    await writeFile(path.join(dir, '理学+力学', '讲义.pdf'), 'x');
    await writeFile(path.join(dir, '心理学', '总论.pdf'), 'x');
    await writeFile(path.join(dir, '心理学', '总论-zh.pdf'), 'x');
    await writeFile(path.join(dir, '心理学', '总论-dual.pdf'), 'x');
    await writeFile(path.join(dir, '心理学', '总论.txt'), 'x');
    await mkdir(path.join(dir, '.pdf2zh-tmp'), { recursive: true });

    const rows = await readPaperTree(dir);
    const paths = rows.map((r) => `${r.type}:${r.path}`);

    assert.ok(paths.includes('folder:理学'), '应解码出顶层文件夹 理学');
    assert.ok(paths.includes('folder:理学/力学'), '应解码出二级文件夹 理学/力学');
    assert.ok(paths.includes('paper:理学/力学/讲义.pdf'), '深层文献应带完整解码路径');
    assert.ok(paths.includes('paper:心理学/总论.pdf'));
    assert.ok(!paths.some((p) => /-zh\.pdf$|-dual\.pdf$/.test(p)), '译文产物不该单独成行');
    assert.ok(!paths.some((p) => p.endsWith('.txt')), '非 PDF 不列');
    assert.ok(!paths.some((p) => p.includes('.pdf2zh-tmp')), '临时目录不列');

    const deep = rows.find((r) => r.path === '理学/力学/讲义.pdf');
    assert.equal(deep.topic, '理学+力学', 'topic 必须是编码后的目录名（上游就用它）');
    assert.equal(deep.name, '讲义');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('readPaperTree：目录不存在时返回空表，不抛错', async () => {
  const rows = await readPaperTree(path.join(tmpdir(), `definitely-not-there-${Date.now()}`));
  assert.deepEqual(rows, []);
});

test('页面侧的 decodeTopic 与宿主侧规则一致', async () => {
  // ⚠️ 这守的是一处**静默不一致**：客户端 bundle 不能 import 宿主的 node 模块
  //    （`paper-tree.js` 用了 node:fs/promises），所以 `Paper.jsx` 里有一份手写的
  //    `decodeTopic`。两份规则漂移不会报错、不会崩溃，只会让"当前打开的那篇不高亮"。
  //
  // 用 indexOf 切片取函数体，不在正则里写换行转义 —— 那样很容易在多轮编辑中被
  // 转成真实换行，反而把整个文件弄成语法错误。
  const url = new URL('../packages/dsh-zhiyun-page-paper/src/Paper.jsx', import.meta.url);
  const source = await readFile(url, 'utf8');
  const signature = 'function decodeTopic(topic) {';
  const at = source.indexOf(signature);
  assert.ok(at !== -1, 'Paper.jsx 里应有一份 decodeTopic（客户端不能 import 宿主的实现）');
  const rest = source.slice(at);
  const closeAt = rest.indexOf('\n}\n');
  assert.ok(closeAt !== -1, 'decodeTopic 应是一个完整函数体');
  const body = rest.slice(0, closeAt);

  // 规则要点 1：按 `+` 切段
  assert.ok(body.includes("split('+')"), '应先按 + 切段');
  // 规则要点 2：`%2B` 必须**先于** `%25` 还原。顺序反了时，
  // `%252B` 会先被还原成 `%2B` 再被当成 `+`，段结构就错了。
  const plusAt = body.indexOf('%2B');
  const pctAt = body.indexOf('%25');
  assert.ok(plusAt !== -1 && pctAt !== -1, '两个转义都要还原');
  assert.ok(plusAt < pctAt, '%2B 必须先于 %25 还原（顺序反了会得到错误的 +）');
  // 规则要点 3：还原后按 `/` 连成路径
  assert.ok(body.includes("join('/')"), '段应用 / 连成多级路径');
});
