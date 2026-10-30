/**
 * 把真实讲义日志转成 r4 对照用的图谱 JSON。
 *
 * compare.mjs 要求 `c.source` 是一个**已经建好的图谱文件**（它只做
 * `JSON.parse` + `inspectGraph`），不接受原始讲义日志。所以这一步必须在开跑前
 * 做完 —— 否则会在付费跑的第一分钟才因为「图谱没有 children」炸掉。
 *
 * 用法：node scripts/quiz_bench/experimental-r4/prepare-real.mjs <日志.jsonl> <输出.json>
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadDataset} from '../input.mjs';
import {inspectGraph} from 'dsh-zhiyun-core-quiz/engines';

const [source, target] = process.argv.slice(2);
if (!source || !target) throw Error('Usage: prepare-real.mjs <lecture.jsonl> <graph.json>');

const dataset = await loadDataset(source);
// 每个知识点做成一个叶节点；父层用 collection，避免伪造出并不存在的章节关系。
const leaves = dataset.points.map(point => ({
  id: `leaf:${point.id}`,
  title: point.title,
  text: point.text,
  pages: point.pages ?? [],
  point: {...point},
  children: [],
}));
const graph = {
  id: 'quiz-real',
  source: 'reconstructed-tree',
  root: {id: 'quiz-real-root', title: dataset.title ?? '真实讲义', kind: 'collection', children: leaves},
};
// 先自检：inspectGraph 会拒绝「叶节点没有正文」「id 重复」「深度超限」等，
// 让它在不花钱的地方就失败。
const {leaves: checked} = inspectGraph(graph);
if (checked.size !== leaves.length) throw Error('图谱叶节点数与知识点数不一致');

await fs.mkdir(path.dirname(path.resolve(target)), {recursive: true});
await fs.writeFile(target, JSON.stringify(graph, null, 2));
console.log(JSON.stringify({points: dataset.points.length, leaves: checked.size, target}, null, 2));
