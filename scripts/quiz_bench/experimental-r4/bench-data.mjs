/**
 * 把产品的**已完成讲义记录**转成 quiz_bench 可用的标准图谱。
 *
 * 输入：App 数据目录下的一门课（`knowledge/<courseId>_<subId>/`）
 *   必需文件：slides.json（含 outline）、blocks.json、subtitles.json
 * 输出：`artifacts/bench-data/<id>/graph.json`，结构直接喂给 r4 / compare.mjs
 *
 * 为什么不重跑解析：这些记录 `meta.status === 'ready'`，讲义已定稿
 * （`lecture.state === 'ready'`、知识点与主线块都已整理好）。重跑一遍
 * 解析既慢又必花冤枉钱，而且产物不会比已有的更准。
 *
 * 知识点怎么切：用 slides.json 里的 `outline`（块范围 → 标题），
 * 正文由 blocks.json 的 sentenceFrom/To 到 subtitles.json 取原句拼接。
 * 这就是讲义人读版 `lecture.md` 里「主线分段」那张表的机器版。
 *
 * 用法：node bench-data.mjs [--all] [<courseId_subId> ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const KNOWLEDGE = path.join(process.env.APPDATA, 'com.zhiyun/zhiyun_pro/zhiyun/knowledge');
const OUT_ROOT = path.resolve('scripts/quiz_bench/experimental-r4/bench-data');

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const all = process.argv.includes('--all');

const ids = all
  ? (await fs.readdir(KNOWLEDGE)).filter(n => /^\d+_\d+$/.test(n))
  : args;
if (!ids.length) throw Error('用法：bench-data.mjs [--all] <courseId_subId> [...]');

const readJson = async (dir, name) => JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));

const results = [];

for (const id of ids) {
  const dir = path.join(KNOWLEDGE, id);
  let meta, slides, blocks, subs;
  try {
    [meta, slides, blocks, subs] = await Promise.all([
      readJson(dir, 'meta.json'), readJson(dir, 'slides.json'),
      readJson(dir, 'blocks.json'), readJson(dir, 'subtitles.json'),
    ]);
  } catch (error) {
    results.push({id, error: '缺少必要文件：' + error.message.slice(0, 80)});
    continue;
  }

  // 判定「可用」看**产物**而不是元数据字段：
  // 有些记录 status=ready、lecture.md 也写了，但 meta.lecture 字段没落（历史遗留）。
  // 反过来 meta 说 ready 而正文缺失的，也不能信。所以以「有非空 lecture.md + 有 outline」为准。
  const mdPath = path.join(dir, 'lecture.md');
  const mdSize = await fs.stat(mdPath).then(st => st.size, () => 0);
  const outline = slides.outline ?? [];
  if (mdSize < 1000 || !outline.length) {
    results.push({id, skipped: `讲义未完成（lecture.md=${mdSize}B, outline=${outline.length}）`});
    continue;
  }

  const sentences = subs.items ?? [];
  const blockByIndex = new Map((blocks.blocks ?? []).map(b => [b.index, b]));

  // 正文按句子号取：块只记范围，句子在 subtitles 里。
  // 句级清洗：课堂录音里有大量「嗯/啊/这个」和极短碎片，直接拼进去会让正文变成
  // 「快去20。不是是的嗯。」这种噪声（实测第 1 个知识点的开头就是这样）。
  // 这里丢掉过短或几乎全是语气词的句子，保留有实际内容的。
  const filler = /^[\s，。、！？?.,]*(?:嗯|啊|呃|哦|唉|诶|呀|吧|呢|对|好|行|是|那个|这个|就是|然后)[\s，。、！？?.,]*$/;
  const cleanSentence = raw => {
    const t = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < 6) return '';          // 极短碎片
    if (filler.test(t)) return '';        // 纯语气词
    // 汉字占比过低（乱码/纯符号）也丢掉
    const han = (t.match(/[一-鿿]/g) ?? []).length;
    if (han / t.length < 0.3) return '';
    return t;
  };
  // 一句「像在讲课」的判据。
  // 实测 ASR 在每段开头会混进设备调试噪声（「快去20。」「qq。」「天开始这个定福苑。」），
  // 这些句子长度和汉字占比都不低，靠「像不像中文」区分不出来。
  // 更可靠的信号是**讲授惯用语**：真在讲课的句子会带这些词。
  const teachingCue = /(那么|我们说|大家|同学|这节课|本节|我们看|注意|首先|其次|定义|概念|性质|定理|公式|举例|比如|也就是说|换句话说)/;
  const textOfBlock = b => {
    const from = b.sentenceFrom ?? 0, to = b.sentenceTo ?? from;
    const rows = sentences.slice(from, to + 1).map(s => cleanSentence(s.text)).filter(Boolean);
    // 找第一句带讲授信号的句子当起点。只在前 8 句里找，找不到就原样全留
    // —— 宁可留着噪声，也不能把整块正文裁没。
    const idx = rows.findIndex(r => teachingCue.test(r));
    return (idx > 0 && idx <= 8 ? rows.slice(idx) : rows).join('');
  };

  const leaves = [];
  for (const [i, topic] of outline.entries()) {
    // 跳过明显不是知识点的段落（休息、通知、杂音）。
    if (/课间休息|课程通知|现场杂音|闲聊/.test(topic.title)) continue;

    const parts = [];
    for (let bi = topic.from; bi <= topic.to; bi++) {
      const b = blockByIndex.get(bi);
      if (!b || b.role !== '主线') continue;          // 只取主线，支线是闲聊
      const t = textOfBlock(b);
      if (t) parts.push(t);
    }
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text.length < 120) continue;                   // 太短的段落不够出题

    const pointId = `${id}:${i}`;
    leaves.push({
      id: `kp-${id}-${i}`,
      title: topic.title,
      text,
      pages: [],
      point: {
        id: pointId,
        title: topic.title,
        text,
        courseId: String(meta.courseId ?? id.split('_')[0]),
        subId: String(meta.subId ?? id.split('_')[1]),
        courseTitle: meta.courseTitle ?? id,
        lessonTitle: meta.sectionTitle ?? topic.title,
        blockIndexes: Array.from({length: topic.to - topic.from + 1}, (_, k) => topic.from + k),
      },
      children: [],
    });
  }

  if (!leaves.length) { results.push({id, skipped: '没有可用知识点'}); continue; }

  const graph = {
    id: `bench-${id}`,
    source: 'reconstructed-tree',
    root: {
      id: `bench-${id}-root`,
      title: `${meta.courseTitle ?? id} · ${meta.sectionTitle ?? ''}`.trim(),
      kind: 'collection',
      children: leaves,
    },
  };

  const outDir = path.join(OUT_ROOT, id);
  await fs.mkdir(outDir, {recursive: true});
  await fs.writeFile(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));

  results.push({
    id, course: meta.courseTitle, section: meta.sectionTitle,
    points: leaves.length, chars: leaves.reduce((n, l) => n + l.text.length, 0),
  });
  console.log(`✓ ${id} ${meta.courseTitle ?? ''} → ${leaves.length} 点, ${leaves.reduce((n, l) => n + l.text.length, 0)} 字`);
}

await fs.mkdir(OUT_ROOT, {recursive: true});
await fs.writeFile(path.join(OUT_ROOT, 'summary.json'), JSON.stringify(results, null, 2));
const ok = results.filter(r => r.points);
console.log(`\n完成 ${ok.length}/${results.length} 门；总知识点 ${ok.reduce((n, r) => n + r.points, 0)}`);
