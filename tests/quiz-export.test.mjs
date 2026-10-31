/**
 * 题目导出到笔记库。
 *
 * # 需求要点
 *
 *   1. 在题库页操作
 *   2. 导出**用户选中的**题目（不是整个题库）
 *   3. 尊重界面上的筛选（按知识点等）
 *
 * # 为什么导出只认 id 列表
 *
 * 筛选在界面上做完了。如果服务端再自己筛一遍，就会出现「界面勾了 5 道、
 * 导出给了 47 道」的不一致 —— 用户没法预测自己导出了什么。
 * 所以接口只收 id，顺序也照传入顺序（等于用户在列表里看到的顺序）。
 *
 * # 为什么答案要折叠
 *
 * 导出的主要用途是**再练一遍**。答案直接铺在题干下面，翻到题的同时就看到了答案，
 * 这份笔记就只剩阅读价值。收进 <details>，在 Obsidian / Typora 里默认折叠。
 *
 * 用法：node tests/quiz-export.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { questionsToMarkdown } from '../packages/dsh-zhiyun-core-study/src/quiz-export.js';

const read = p => fs.readFileSync(path.resolve(p), 'utf8');

const Q = (over = {}) => ({
  id: `q-${Math.random().toString(36).slice(2, 8)}`,
  type: 'mcq',
  stem: '题干内容',
  answer: 'B',
  explanation: '解析内容',
  choices: [{ label: 'A', text: '选项甲' }, { label: 'B', text: '选项乙' }],
  pointTitle: '知识点一',
  courseTitle: '概率论',
  strategy: 'understand',
  status: 'accepted',
  ...over,
});

// ── Markdown 编码 ───────────────────────────────────────────────────

test('按知识点分组，组内编号从 1 开始', () => {
  const md = questionsToMarkdown({
    questions: [
      Q({ pointTitle: '知识点一' }),
      Q({ pointTitle: '知识点一' }),
      Q({ pointTitle: '知识点二' }),
    ],
  }).markdown;

  assert.match(md, /^## 知识点一$/m, '一级分组用 h2');
  assert.match(md, /^## 知识点二$/m);
  // 每个组内独立编号
  const group1 = md.split('## 知识点二')[0];
  assert.match(group1, /^### 1\. /m);
  assert.match(group1, /^### 2\. /m);
  const group2 = md.split('## 知识点二')[1];
  assert.match(group2, /^### 1\. /m, '第二个组重新从 1 开始');
});

test('组顺序按首次出现排（等于用户看到的顺序）', () => {
  const md = questionsToMarkdown({
    questions: [Q({ pointTitle: '乙' }), Q({ pointTitle: '甲' }), Q({ pointTitle: '乙' })],
  }).markdown;
  assert.ok(md.indexOf('## 乙') < md.indexOf('## 甲'), '乙先出现，就该排在前面');
});

test('挖空标记换成下划线，不把 {{c1::}} 漏给读者', () => {
  const md = questionsToMarkdown({
    questions: [Q({ type: 'cloze', stem: '数据库事务要求{{c1::原子性}}和{{c2::一致性}}', answer: '原子性;一致性' })],
  }).markdown;
  assert.ok(!md.includes('{{c1::'), '标记不能出现在导出结果里');
  assert.match(md, /____/, '要换成固定宽度的横线');
});

test('选择题选项逐行列出并带字母', () => {
  const md = questionsToMarkdown({ questions: [Q()] }).markdown;
  assert.match(md, /- \*\*A\.\*\* 选项甲/);
  assert.match(md, /- \*\*B\.\*\* 选项乙/);
});

test('答案与解析收进 details，默认不展开', () => {
  const md = questionsToMarkdown({ questions: [Q()] }).markdown;
  assert.match(md, /<details><summary>答案与解析<\/summary>/, '要有折叠块');
  assert.ok(!/<details[^>]*\sopen/.test(md), '不能默认展开');
  assert.match(md, /\*\*答案：\*\* B/);
  assert.match(md, /解析内容/);
});

test('没有解析也能导出（只给答案）', () => {
  const md = questionsToMarkdown({ questions: [Q({ explanation: '' })] }).markdown;
  assert.match(md, /\*\*答案：\*\*/);
  assert.ok(!md.includes('undefined'), '不能把 undefined 写进文件');
});

test('标题层级：h1 文档标题 / h2 知识点 / h3 题目', () => {
  const md = questionsToMarkdown({ questions: [Q()], courseTitle: '概率论' }).markdown;
  const lines = md.split('\n');
  assert.ok(lines[0].startsWith('# '), '首行是一级标题');
  assert.ok(lines.some(l => l.startsWith('## ')), '有二级标题');
  assert.ok(lines.some(l => l.startsWith('### ')), '有三级标题');
});

test('元信息行给出题数与知识点数', () => {
  const md = questionsToMarkdown({
    questions: [Q({ pointTitle: '甲' }), Q({ pointTitle: '乙' })],
  }).markdown;
  assert.match(md, /2 道题/);
  assert.match(md, /2 个知识点/);
});

test('空输入返回空串与零计数，不产生半截文档', () => {
  const r = questionsToMarkdown({ questions: [] });
  assert.equal(r.markdown, '');
  assert.equal(r.count, 0);
  assert.equal(r.groups, 0);
});

test('题型与策略用中文名，导出后不出现内部代号', () => {
  const md = questionsToMarkdown({
    questions: [Q({ type: 'trueFalse', strategy: 'recall' })],
  }).markdown;
  assert.match(md, /判断题/, 'trueFalse 应译成判断题');
  assert.match(md, /基础巩固/, 'recall 应译成基础巩固');
  assert.ok(!/### 1\. trueFalse/.test(md), '不该漏内部代号');
});

// ── 后端接线 ────────────────────────────────────────────────────────

test('bank-export 只认 id 列表，不自己再筛一遍', () => {
  const src = read('packages/dsh-zhiyun-core-study/src/question-bank.js');
  const start = src.indexOf("if (method==='bank-export')");
  assert.ok(start > 0, '找不到 bank-export');
  const body = src.slice(start, src.indexOf("if (method==='bank-", start + 10));
  assert.match(body, /payload\.questionIds/, '必须按调用方给的 id 取题');
  assert.match(body, /ids\.map\(id => byId\.get\(id\)\)/, '顺序照传入顺序');
  assert.ok(!/\.filter\(match|includes\(payload\.query/.test(body), '服务端不该重复做界面筛选');
});

test('已弃用的题不导出', () => {
  const src = read('packages/dsh-zhiyun-core-study/src/question-bank.js');
  const start = src.indexOf("if (method==='bank-export')");
  const body = src.slice(start, src.indexOf("if (method==='bank-", start + 10));
  assert.match(body, /status !== 'rejected'/, '用户刚弃用的题不该再导到笔记里');
  assert.match(body, /都已弃用/, '全被弃用时要给出可读的错');
});

test('落盘复用 core-handout 的 exportMarkdown，不另写一套', () => {
  const src = read('packages/dsh-zhiyun-core-study/src/question-bank.js');
  const start = src.indexOf("if (method==='bank-export')");
  const body = src.slice(start, src.indexOf("if (method==='bank-", start + 10));
  assert.match(body, /service\.exportMarkdown/, '重名后缀 / 目录层级都由它负责');
  assert.ok(!/store\.write|writeFile/.test(body), '不要在题库侧直接写文件');
});

test('bank-export 在宿主 RPC 白名单里', () => {
  const host = read('packages/dsh-zhiyun-core-study/src/host.js');
  assert.match(host, /"bank-export"/, '不在白名单会被挡成「输入信息无效」');
});

test('前端导出按钮受选中数量约束', () => {
  const page = read('packages/dsh-zhiyun-page-quiz/src/question-history.jsx');
  assert.match(page, /exportPicked/, '要有导出处理函数');
  assert.match(page, /disabled=\{!selected\.length\|\|exporting\}/, '没选中或正在导出时禁用');
  assert.match(page, /导出到笔记库/, '按钮文案');
});

test('导出结果如实显示落到哪个路径，重名要说出来', () => {
  const page = read('packages/dsh-zhiyun-page-quiz/src/question-history.jsx');
  assert.match(page, /data\.folder/, '要显示目录');
  assert.match(page, /deduped/, '重名加后缀要告知用户');
});

// ── 按来源节次拆分 ──────────────────────────────────────────────────

import { splitByLesson } from '../packages/dsh-zhiyun-core-study/src/quiz-export.js';

const L = (lesson, course = '概率论', over = {}) => Q({ lessonTitle: lesson, courseTitle: course, ...over });

test('多个节次时拆成多份文档', () => {
  const docs = splitByLesson({
    questions: [L('第一节'), L('第一节'), L('第二节')],
  });
  assert.equal(docs.length, 2, '两个节次 → 两份文档');
  const first = docs.find(d => d.lessonTitle === 'quiz-第一节');
  assert.equal(first.count, 2, '第一节有 2 道');
  assert.equal(docs.find(d => d.lessonTitle === 'quiz-第二节').count, 1);
});

test('只有一个节次时不拆（拆出来与自己那份一样，只多一层跳转）', () => {
  const docs = splitByLesson({ questions: [L('第一节'), L('第一节')] });
  assert.equal(docs.length, 1);
});

test('同名节次在不同课程下是两份，不能合并', () => {
  const docs = splitByLesson({
    questions: [L('第3-5节', '概率论'), L('第3-5节', '大学物理')],
  });
  assert.equal(docs.length, 2, '课程不同必须分开');
  assert.ok(docs.every(d => d.courseTitle), '每份都要有课程名');
});

test('文档标题带课程名（单看「第3-5节」不知道是哪门课）', () => {
  const docs = splitByLesson({
    questions: [L('第3-5节', '概率论'), L('第6-8节', '概率论')],
  });
  for (const d of docs) {
    const firstLine = d.markdown.split(String.fromCharCode(10))[0];
    assert.match(firstLine, /概率论/, '标题要含课名');
  }
});

test('节次缺失时归到「未标注节次」，不让题静默消失', () => {
  const docs = splitByLesson({ questions: [Q({ lessonTitle: '' }), L('第一节')] });
  assert.equal(docs.length, 2);
  assert.ok(docs.some(d => d.lessonTitle === 'quiz-未标注节次'), '缺失要有可读的兜底名（带前缀）');
  const total = docs.reduce((n, d) => n + d.count, 0);
  assert.equal(total, 2, '题目总数不能少');
});

test('份内仍按知识点分组（拆分不破坏原有结构）', () => {
  const docs = splitByLesson({
    questions: [L('第一节', '概率论', { pointTitle: '甲' }), L('第一节', '概率论', { pointTitle: '乙' })],
  });
  assert.equal(docs.length, 1);
  assert.match(docs[0].markdown, /^## 甲$/m);
  assert.match(docs[0].markdown, /^## 乙$/m);
});

test('顺序按首次出现（等于用户看到的顺序）', () => {
  const docs = splitByLesson({ questions: [L('乙节'), L('甲节'), L('乙节')] });
  assert.equal(docs[0].lessonTitle, 'quiz-乙节', '乙先出现就该在前');
});

test('空输入返回空数组', () => {
  assert.deepEqual(splitByLesson({ questions: [] }), []);
  assert.deepEqual(splitByLesson({}), []);
});

test('termName 透传给每一份', () => {
  const docs = splitByLesson({ questions: [L('甲节'), L('乙节')], termName: '2026 秋' });
  assert.ok(docs.every(d => d.termName === '2026 秋'), '学期是笔记库第一层目录');
});

// ── 与讲义区分：quiz- 前缀 ──────────────────────────────────────────

test('笔记文件名带 quiz- 前缀，与讲义区分开', () => {
  const docs = splitByLesson({ questions: [L('2026-09-17第3-5节')] });
  assert.equal(docs[0].lessonTitle, 'quiz-2026-09-17第3-5节',
    '落盘名要带前缀，否则与讲义同名，只会被加「（2）」后缀越导越乱');
});

test('前缀只加在节次层，学期与课程层保持一致', () => {
  const docs = splitByLesson({
    questions: [L('第一节', '概率论', { termName: '2026 秋' })],
  });
  const d = docs[0];
  assert.equal(d.termName, '2026 秋', '学期层不加前缀 —— 两者仍属同一门课');
  assert.equal(d.courseTitle, '概率论', '课程层不加前缀');
  assert.equal(d.lessonTitle, 'quiz-第一节', '只给节次层加');
});

test('节次缺失时的兜底名也带前缀', () => {
  const docs = splitByLesson({ questions: [Q({ lessonTitle: '' })] });
  assert.equal(docs[0].lessonTitle, 'quiz-未标注节次');
});

test('文档标题标明「练习题」，不只靠路径区分', () => {
  const docs = splitByLesson({ questions: [L('第一节')] });
  const firstLine = docs[0].markdown.split(String.fromCharCode(10))[0];
  assert.match(firstLine, /练习题/, `标题要写清是题目，实际：${firstLine}`);
});

test('多份导出时每份标题都带「练习题」', () => {
  const docs = splitByLesson({ questions: [L('甲节'), L('乙节')] });
  assert.equal(docs.length, 2);
  for (const d of docs) {
    const firstLine = d.markdown.split(String.fromCharCode(10))[0];
    assert.match(firstLine, /练习题/, `${d.lessonTitle} 的标题缺少标记`);
  }
});
