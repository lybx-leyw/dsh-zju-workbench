/**
 * 题库页「导出选中题目为单个 PDF」。
 *
 * # 需求
 *
 *   1. 在题库页（历史题库 Tab）操作
 *   2. 只导出**用户勾选**的题目，顺序 = 列表顺序
 *   3. 产物是**一个** PDF：卷面在前、答案与解析在卷末
 *
 * # 这里守的是什么
 *
 * 排版结果只能眼看，所以把能静态/纯函数判定的部分全钉住：
 *
 *   - 编号连续：卷面与卷末附录共用同一批题号。分别从 1 编号是这类导出最常见的
 *     错位来源，读者会对不上「第 7 题的答案」。
 *   - 弃用剔除：与 `bank-export` 服务端口径一致，勾了 8 道却只有 6 道必须有解释。
 *   - 题干挖空标记：`{{c1::答案}}` 不能漏到纸面上（那等于直接给答案）。
 *   - 文件名：跨课程退化成「题库练习卷」；非法字符必须净化（Windows 直接拒绝保存）。
 *   - 桌面桥接：`kind` 决定「文档还在不在」的判据选择器 —— 选错等于把整个应用界面
 *     打印进 PDF。
 *
 * 用法：node tests/quiz-pdf-export.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  QUIZ_EXPORT_ROOT_ID,
  buildQuizPdfOutline,
  quizPdfFilename,
  safeFilenamePart,
  stemForPrint,
  typeBreakdown,
} from '../packages/dsh-zhiyun-page-quiz/src/question-export-model.js';
import { PDF_DOCUMENTS, createLecturePdfHandler, createPdfExportHandler } from '../apps/desktop/src/pdf-export.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const Q = (over = {}) => ({
  id: `q-${Math.random().toString(36).slice(2, 8)}`,
  type: 'mcq',
  stem: '题干内容',
  answer: 'B',
  explanation: '解析内容',
  choices: [{label: 'A', text: '选项甲'}, {label: 'B', text: '选项乙'}],
  courseTitle: '概率论与数理统计',
  lessonTitle: '第 3 节 条件概率',
  pointTitle: '条件概率的定义',
  status: 'accepted',
  ...over,
});

/* ── 排版模型 ─────────────────────────────────────────────────────────── */

test('按 课程/节次 → 知识点 分组，题号在整份文档上连续', () => {
  const outline = buildQuizPdfOutline([
    Q({pointTitle: '定义'}),
    Q({pointTitle: '定义'}),
    Q({pointTitle: '全概率公式'}),
    Q({lessonTitle: '第 4 节 贝叶斯', pointTitle: '贝叶斯公式'}),
  ]);

  assert.equal(outline.total, 4);
  assert.equal(outline.sections.length, 2, '两个节次应该分成两段');
  assert.deepEqual(outline.sections.map(s => s.lessonTitle), ['第 3 节 条件概率', '第 4 节 贝叶斯']);
  assert.deepEqual(outline.sections[0].points.map(p => p.title), ['定义', '全概率公式']);
  // 关键：第二段的第一题是第 4 题，不是第 1 题
  assert.deepEqual(outline.items.map(i => i.number), [1, 2, 3, 4]);
  assert.equal(outline.sections[1].points[0].items[0].number, 4);
});

test('卷末附录与卷面共用同一批题号（不复用另一个编号序列）', () => {
  const outline = buildQuizPdfOutline([Q(), Q(), Q()]);
  const fromPaper = outline.sections.flatMap(s => s.points.flatMap(p => p.items)).map(e => e.number);
  const fromAnswers = outline.sections.flatMap(s => s.points.flatMap(p => p.items)).map(e => e.number);
  assert.deepEqual(fromPaper, [1, 2, 3]);
  assert.deepEqual(fromAnswers, fromPaper);
  // 同一批对象：改一处不会让两段各说各话
  assert.equal(outline.sections[0].points[0].items[0], outline.items[0]);
});

test('已弃用的题不进卷子；全是弃用题时得到空文档', () => {
  const outline = buildQuizPdfOutline([Q({status: 'rejected'}), Q({pointTitle: '保留'})]);
  assert.equal(outline.total, 1);
  assert.equal(outline.items[0].question.pointTitle, '保留');
  assert.deepEqual(buildQuizPdfOutline([Q({status: 'rejected'})]), {sections: [], items: [], total: 0});
  assert.equal(buildQuizPdfOutline(null).total, 0);
});

test('缺课程/节次时归到「未标注」，题不会静默消失', () => {
  const outline = buildQuizPdfOutline([Q({courseTitle: '', lessonTitle: '', pointTitle: ''})]);
  assert.equal(outline.total, 1);
  assert.equal(outline.sections.length, 1);
  assert.equal(outline.sections[0].courseTitle, '');
  assert.equal(outline.sections[0].points[0].title, '未标注知识点');
});

test('题干里的挖空标记换成横线，公式原样保留', () => {
  assert.equal(stemForPrint('事务要求{{c1::原子性}}与{{c2::一致性}}。'), '事务要求____与____。');
  assert.equal(stemForPrint('求 $\\int_0^1 x^2 dx$ 的值'), '求 $\\int_0^1 x^2 dx$ 的值');
  assert.equal(stemForPrint(undefined), '');
});

test('题型分布写进封面元信息', () => {
  const {items} = buildQuizPdfOutline([Q({type: 'mcq'}), Q({type: 'mcq'}), Q({type: 'cloze'})]);
  assert.deepEqual(typeBreakdown(items), [{type: 'mcq', count: 2}, {type: 'cloze', count: 1}]);
});

/* ── 文件名 ───────────────────────────────────────────────────────────── */

test('单课程带课程名，跨课程退化成入库名，都带日期', () => {
  const day = new Date(2026, 9, 31);
  assert.equal(quizPdfFilename([Q()], day), '概率论与数理统计 - 练习卷 - 2026-10-31.pdf');
  assert.equal(
    quizPdfFilename([Q(), Q({courseTitle: '数据结构'})], day),
    '题库练习卷 - 2 门课 - 2026-10-31.pdf',
  );
  assert.equal(quizPdfFilename([], day), '题库练习卷 - 2026-10-31.pdf');
  // 已弃用的题不参与命名：否则「只导出一道」的卷子会叫「2 门课」
  assert.equal(quizPdfFilename([Q({status: 'rejected'})], day), '题库练习卷 - 2026-10-31.pdf');
});

test('文件名净化：非法字符、尾部点空格、超长截断', () => {
  assert.equal(safeFilenamePart('A/B:C*D?'), 'A_B_C_D_');
  assert.equal(safeFilenamePart('  名字...  '), '名字');
  assert.equal(safeFilenamePart(''), '');
  assert.equal(safeFilenamePart('', '兜底'), '兜底');
  assert.equal(safeFilenamePart('长'.repeat(200)).length, 80);
  // 净化后的名字不能带分隔符 —— 否则 path.join 会把它当成子目录
  const name = quizPdfFilename([Q({courseTitle: '../../etc/passwd'})], new Date(2026, 0, 2));
  assert.ok(!name.includes('/') && !name.includes('\\'), `文件名里仍有路径分隔符：${name}`);
});

/* ── 前端契约 ─────────────────────────────────────────────────────────── */

test('历史题库的批量工具栏里有「导出 PDF」，且导出的是勾选题目对象', () => {
  const history = read('packages/dsh-zhiyun-page-quiz/src/question-history.jsx');
  assert.match(history, /import\s*\{\s*ExportPdfButton\s*\}\s*from\s*'\.\/question-export\.jsx'/, '没有引入 PDF 按钮');
  assert.match(history, /<ExportPdfButton/, '批量工具栏里没有按钮');
  // 必须是题目对象数组，不是 id 数组：排版要题干、选项、解析
  assert.match(history, /selectedQuestions\s*=\s*active\.filter\(q\s*=>\s*picked\.has\(q\.id\)\)/, '传给 PDF 按钮的不是题目对象');
  assert.match(history, /questions=\{selectedQuestions\}/);
});

test('导出文档用宿主 MarkdownText 渲染，公式在纸面上也是排好的', () => {
  const source = read('packages/dsh-zhiyun-page-quiz/src/question-export.jsx');
  assert.match(source, /from\s*'@deepseek-ai\/dsh-client-ui-primitives'/, '没有用宿主渲染器');
  assert.match(source, /<MarkdownText/, '题干没有走 MarkdownText：$...$ 会以原始 TeX 出现在 PDF 里');
  // labels 必须是模块级常量（MarkdownText 按身份缓存，内联字面量会反复重建组件表）
  assert.match(source, /const MARKDOWN_LABELS = \{/);
});

test('导出流程：离屏挂载 → 等排版 → 桌面桥接优先 → 浏览器回落打印', () => {
  const source = read('packages/dsh-zhiyun-page-quiz/src/question-export.jsx');
  assert.match(source, new RegExp(`QUIZ_EXPORT_ROOT_ID|'${QUIZ_EXPORT_ROOT_ID}'`), '没有用统一的挂载点 id');
  assert.match(source, /createRoot\(element\)/);
  assert.match(source, /document\.body\.append\(element\)/);
  assert.match(source, /window\.zhiyunPdf/, '没有优先走桌面壳的保存对话框');
  assert.match(source, /window\.print\(\)/, '浏览器里没有回落');
  assert.match(source, /root\.unmount\(\)/, '导出后没有卸载文档');
  assert.match(source, /element\.remove\(\)/, '导出后没有移除挂载点');
  assert.match(source, /exporting\s*=\s*false/, '失败路径没有释放互斥锁');
});

test('纸面样式只锚定 #zs-quiz-export，打印时隐藏应用界面', () => {
  const css = read('packages/dsh-zhiyun-page-quiz/src/question-export.css');
  assert.match(css, new RegExp(`#${QUIZ_EXPORT_ROOT_ID}\\b`), '样式没有以挂载点 id 作用域化');
  assert.match(css, /@media print/, '缺少打印样式');
  assert.match(css, /@page\s*\{\s*size:\s*A4/, '缺 A4 页面设置');
  assert.match(css, /body\s*>\s*\*:not\(#zs-quiz-export\)\s*\{\s*display:\s*none/, '打印时没有隐藏应用界面');
  // 题号与答案段必须分页：卷末附录不该跟最后一道题挤在同一页
  assert.match(css, /\.zs-pdf-answers\s*\{[^}]*break-before:\s*page/, '答案附录没有另起一页');
});

/* ── 桌面桥接 ─────────────────────────────────────────────────────────── */

test('preload 暴露 zhiyunPdf 并保留旧键', () => {
  const preload = read('apps/desktop/src/preload.cjs');
  assert.match(preload, /exposeInMainWorld\(\s*'zhiyunPdf'/, '没有暴露新的 PDF 桥');
  assert.match(preload, /invoke\(\s*'zhiyun:pdf-save'\s*,\s*filename\s*,\s*kind\s*\)/, '没有把文档类型传给主进程');
  assert.match(preload, /exposeInMainWorld\(\s*'lecturePdf'/, '旧键被删掉会让已发布的讲义导出失效');
});

test('主进程注册 zhiyun:pdf-save，并保留旧通道', () => {
  const main = read('apps/desktop/src/main.js');
  assert.match(main, /ipcMain\.handle\(\s*'zhiyun:pdf-save'/, '没有注册新通道');
  assert.match(main, /ipcMain\.handle\(\s*'lecture:pdf-save'/, '旧通道被删掉了');
  assert.match(main, /createPdfExportHandler/, '没有用共享处理器');
});

function fixture({canceled = false, ready = true, selectorSeen} = {}) {
  const calls = [];
  const frame = {};
  const sender = {
    mainFrame: frame,
    getURL: () => 'http://127.0.0.1:8000/',
    executeJavaScript: async script => { selectorSeen?.push(script); return ready; },
    printToPDF: async options => { calls.push(['pdf', options]); return Buffer.from('%PDF-fixture'); },
  };
  const win = {webContents: sender, isDestroyed: () => false};
  const dialog = {
    showSaveDialog: async (_win, options) => { calls.push(['dialog', options]); return {canceled, filePath: 'chosen.pdf'}; },
  };
  const handler = createPdfExportHandler({
    getWindow: () => win,
    getHostUrl: () => 'http://127.0.0.1:8000/?token=fixture',
    dialog,
    downloads: () => '.',
    write: async (file, bytes) => calls.push(['write', file, bytes.toString()]),
  });
  return {calls, win, dialog, event: {sender, senderFrame: frame}, handler};
}

test('题库导出的「文档还在吗」判据是题库文档，不是讲义', async () => {
  const seen = [];
  const f = fixture({selectorSeen: seen});
  await f.handler(f.event, '练习卷.pdf', 'quiz');
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes(PDF_DOCUMENTS.quiz.readySelector), `判据选择器不对：${seen[0]}`);
  assert.ok(!seen[0].includes(PDF_DOCUMENTS.lecture.readySelector));
  assert.deepEqual(f.calls.map(c => c[0]), ['dialog', 'pdf', 'write']);
  assert.equal(f.calls[0][1].title, PDF_DOCUMENTS.quiz.dialogTitle);
});

test('未知 kind 回落成讲义（不打印整个应用），讲义判据保持不变', async () => {
  const seen = [];
  const f = fixture({selectorSeen: seen});
  await f.handler(f.event, '讲义.pdf', '不认识');
  assert.ok(seen[0].includes('#zs-lecture-export .zs-pdf-lecture'));
});

test('题库文档已卸载时拒绝打印（否则打出的是整个应用界面）', async () => {
  const f = fixture({ready: false});
  const result = await f.handler(f.event, '练习卷.pdf', 'quiz');
  assert.ok(result.error, '应该报错');
  assert.equal(f.calls.filter(c => c[0] === 'pdf').length, 0, '不该调用 printToPDF');
});

test('文件名净化后再落盘，取消时不写文件', async () => {
  const f = fixture();
  await f.handler(f.event, '概率论/第3节?:坏名.pdf', 'quiz');
  assert.deepEqual(f.calls.map(c => c[0]), ['dialog', 'pdf', 'write']);
  const written = f.calls.find(c => c[0] === 'write');
  // 落盘路径由保存对话框决定，导出层不自己拼路径
  assert.equal(written[1], 'chosen.pdf');
  assert.equal(f.calls[0][1].title, PDF_DOCUMENTS.quiz.dialogTitle);
  const defaultBase = path.basename(f.calls[0][1].defaultPath);
  assert.ok(!/[:?*"<>|]/.test(defaultBase), `默认文件名没净化：${defaultBase}`);
  assert.ok(defaultBase.endsWith('.pdf'), `默认文件名丢了后缀：${defaultBase}`);

  const canceled = fixture({canceled: true});
  const result = await canceled.handler(canceled.event, '练习卷.pdf', 'quiz');
  assert.equal(result.canceled, true);
  assert.equal(canceled.calls.filter(c => c[0] === 'write').length, 0);
});

test('两种文档共用一个忙碌锁', async () => {
  const f = fixture();
  let release;
  f.dialog.showSaveDialog = () => new Promise(resolve => { release = resolve; });
  const first = f.handler(f.event, '练习卷.pdf', 'quiz');
  const second = await f.handler(f.event, '讲义.pdf', 'lecture');
  assert.ok(second.error, '同一时刻不应允许第二份导出');
  release({canceled: true});
  await first;
});

test('旧入口 createLecturePdfHandler 仍固定讲义判据', async () => {
  const seen = [];
  const mainFrame = {};
  const sender = {
    mainFrame,
    getURL: () => 'http://127.0.0.1:8000/',
    executeJavaScript: async script => { seen.push(script); return true; },
    printToPDF: async () => Buffer.from('%PDF'),
  };
  const win = {webContents: sender, isDestroyed: () => false};
  const handler = createLecturePdfHandler({
    getWindow: () => win,
    getHostUrl: () => 'http://127.0.0.1:8000/',
    // 判据检查发生在保存对话框**之后**：取消掉的对话框根本走不到 executeJavaScript，
    // 所以这里必须真的选一个路径，才能验证判据选择器。
    dialog: {showSaveDialog: async () => ({canceled: false, filePath: 'chosen.pdf'})},
    downloads: () => '.',
    write: async () => {},
  });
  await handler({sender, senderFrame: mainFrame}, '讲义.pdf');
  assert.equal(seen.length, 1);
  assert.ok(seen[0].includes('#zs-lecture-export'), `旧入口的判据被换掉了：${seen[0]}`);
});
