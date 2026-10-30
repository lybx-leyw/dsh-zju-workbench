/**
 * 把**笔记库里的讲义 md**转成 quiz_bench 可用的标准图谱。
 *
 * 来源：`npm run desktop` 起的 App，学习页「导出讲义到笔记库」写出的文件。
 *   根目录 = `{profileContext.dir}/data/zhiyun-vault-notes`
 *           即 `.runtime/home/profiles/zhiyun-bench/data/zhiyun-vault-notes`
 *   路径规则（core-handout `currentNotePath`）= `{学期}/{课程名}/{节次名}.md`
 *
 * 为什么用它、而不是 `com.zhiyun/zhiyun_pro`：那是 App 的**手写笔记本**
 * （`.ink` 笔迹），不是这条链路；也不是 `knowledge/`（讲义原始记录）。
 * 笔记库 md 是**已定稿的产品产物**：`## 章 / ### 知识点 / #### 讲解|定义|例题`。
 *
 * 用法：node vault-data.mjs [--all] [<课程名/文件名> ...]
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const VAULT = path.resolve('.runtime/home/profiles/zhiyun-bench/data/zhiyun-vault-notes');
const OUT_ROOT = path.resolve('scripts/quiz_bench/experimental-r4/bench-data');

/** 递归列出所有 .md（跳过 PDF 之类的附件）。 */
async function collect(dir, base = dir) {
  const out = [];
  for (const row of await fs.readdir(dir, {withFileTypes: true})) {
    const full = path.join(dir, row.name);
    if (row.isDirectory()) out.push(...await collect(full, base));
    else if (row.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * 解析讲义 md。
 *
 * 层级：`## 章` → `### 知识点` → `#### 分块类型` → 正文段落。
 * 一个知识点 = 一个叶节点；正文把该 `###` 下所有分块的文字拼起来。
 * 章作为中间层保留（图谱有层级，r4 才能做跨知识点综合题）。
 */
function parseLecture(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const chapters = [];
  let chapter = null, topic = null, kind = '讲解', buffer = [];

  const flushBody = () => {
    if (topic && buffer.length) {
      const text = buffer.join('\n').trim();
      if (text) topic.parts.push({kind, text});
    }
    buffer = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('# ') && !line.startsWith('## ')) continue;          // 文件大标题
    if (line.startsWith('## ') && !line.startsWith('### ')) {
      flushBody();
      chapter = {title: line.slice(3).trim(), topics: []};
      chapters.push(chapter); topic = null; continue;
    }
    if (line.startsWith('### ') && !line.startsWith('#### ')) {
      flushBody();
      topic = {title: line.slice(4).trim(), parts: []};
      if (!chapter) { chapter = {title: '未分章', topics: []}; chapters.push(chapter); }
      chapter.topics.push(topic); continue;
    }
    if (line.startsWith('#### ')) { flushBody(); kind = line.slice(5).trim(); continue; }
    if (!topic) continue;
    buffer.push(line);
  }
  flushBody();
  return chapters.filter(c => c.topics.length);
}

const isAll = process.argv.includes('--all');
const picks = process.argv.slice(2).filter(a => !a.startsWith('--'));
const files = (await collect(VAULT))
  .filter(f => !isAll ? picks.some(p => f.includes(p)) : true);

if (!files.length) throw Error('没有匹配的 md；用 --all 或给出课程名片段');

const results = [];
for (const file of files) {
  const markdown = await fs.readFile(file, 'utf8');
  const chapters = parseLecture(markdown);
  const rel = path.relative(VAULT, file).split(path.sep);
  // 路径 = 学期/课程/文件.md
  const courseTitle = rel.length >= 3 ? rel[rel.length - 2] : (rel[0] ?? 'unknown');
  const lessonTitle = path.basename(file, '.md');
  const term = rel.length >= 3 ? rel[0] : '';
  const id = `${courseTitle}__${lessonTitle}`.replace(/[\\/:*?"<>|\s]/g, '_');

  const children = [];
  let n = 0;
  for (const chapter of chapters) {
    const topicLeaves = [];
    for (const topic of chapter.topics) {
      const text = topic.parts.map(p => p.text).join('\n\n').replace(/\s+/g, ' ').trim();
      if (text.length < 120) continue;                        // 太短不够出题
      const pid = `${id}:${n++}`;
      topicLeaves.push({
        id: `kp-${pid}`, title: topic.title, text, pages: [],
        point: {id: pid, title: topic.title, text, courseId: courseTitle,
          subId: lessonTitle, courseTitle, lessonTitle,
          blockIndexes: [], kinds: [...new Set(topic.parts.map(p => p.kind))]},
        children: [],
      });
    }
    if (!topicLeaves.length) continue;
    // 章用 title 节点保留层级；单知识点的章直接提成叶，避免无意义的单子节点。
    children.push(topicLeaves.length === 1 ? topicLeaves[0] : {
      id: `ch-${id}-${children.length}`, title: chapter.title, kind: 'title',
      text: '', pages: [], point: null, children: topicLeaves,
    });
  }
  if (!children.length) { results.push({file, skipped: '没有可用知识点'}); continue; }

  const graph = {id: `bench-${id}`, source: 'reconstructed-tree',
    root: {id: `bench-${id}-root`, title: `${courseTitle} · ${lessonTitle}`, kind: 'collection', children}};

  const outDir = path.join(OUT_ROOT, id);
  await fs.mkdir(outDir, {recursive: true});
  await fs.writeFile(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
  // 留一份来源指纹，便于以后核对「这份 bench data 由哪个 md 生成」。
  await fs.writeFile(path.join(outDir, 'source.json'), JSON.stringify({
    term, courseTitle, lessonTitle, file: path.relative(process.cwd(), file),
    bytes: markdown.length, chapters: chapters.length, points: n,
  }, null, 2));

  results.push({id, courseTitle, lessonTitle, chapters: chapters.length, points: n,
    chars: children.reduce((s, c) => s + (c.children?.length ?? 0) + 0, 0) || n});
  console.log(`✓ ${courseTitle} / ${lessonTitle} → ${chapters.length} 章, ${n} 个知识点`);
}

await fs.writeFile(path.join(OUT_ROOT, 'vault-summary.json'), JSON.stringify(results, null, 2));
const ok = results.filter(r => r.points);
console.log(`\n完成 ${ok.length}/${results.length} 份；合计 ${ok.reduce((s, r) => s + r.points, 0)} 个知识点`);
