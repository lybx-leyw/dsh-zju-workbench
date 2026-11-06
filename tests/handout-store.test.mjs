/**
 * 讲义导出到笔记库的契约测试。
 *
 * 这一层连接的是「路径推导」与「真实的笔记服务」。测试用一个**内存假服务**
 * 把笔记库的行为如实模拟出来（补 `.md`、扁平条目表、读不到给 null），
 * 而不是 mock 掉方法调用 —— mock 只能证明「调用过」，证明不了「写对地方了」。
 *
 * 新架构的三条契约，每条都有对应的 test：
 *   1. 每次导出都新写一份，**从不覆盖**（重名加「（2）」后缀）；
 *   2. 空讲义拒绝导出，不在用户笔记库里留空文件；
 *   3. 导出只管 `.md`，不碰基线、不建归档目录。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createHandoutService } from '../packages/dsh-zhiyun-core-handout/src/store.js';
import { availableNotePath, currentNotePath, existingNoteKeys } from '../packages/dsh-zhiyun-core-handout/src/version.js';
import { baselineToMarkdown } from '../packages/dsh-zhiyun-core-handout/src/codec.js';

const COURSE = '数据结构';
const LESSON = '第三讲 树与二叉树';
const session = { courseTitle: COURSE, lessonTitle: LESSON };

/** 一节的章节树；`label` 用来让不同版本的内容可区分。 */
function chaptersOf(label) {
  return [{
    title: `${label} 章`,
    topics: [{
      title: `${label} 知识点`,
      blocks: [
        { kind: { wire: 'elaboration', label: '讲解' }, title: '', text: `${label} 的讲解正文` },
        { kind: { wire: 'example', label: '例题' }, title: '小题', stem: `${label} 题干`, solution: `${label} 解答` },
      ],
    }],
  }];
}

/**
 * 内存假笔记服务。
 *
 * 与笔记页一致：`write`/`read` 只碰 `.md` 且键**不带扩展名**；
 * `tree()` 给出的笔记条目同样不带扩展名。
 */
function fakeNotes(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    async tree() {
      const out = [];
      for (const path of files.keys()) {
        out.push(path.endsWith('.md')
          ? { path: path.slice(0, -3), type: 'note' }
          : { path, type: 'attachment' });
      }
      const dirs = new Set();
      for (const path of files.keys()) {
        const parts = path.split('/');
        for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join('/'));
      }
      for (const dir of dirs) out.push({ path: dir, type: 'folder' });
      return out;
    },
    async read(name) {
      const key = `${name}.md`;
      return files.has(key) ? { name, markdown: files.get(key) } : null;
    },
    async write(name, markdown) {
      files.set(`${name}.md`, markdown);
      return { name, chars: markdown.length };
    },
  };
}

const service = (notes) => createHandoutService({ notes });

test('exportLecture：首次导出写下 md，内容与编码结果一致', async () => {
  const notes = fakeNotes();
  const result = await service(notes).exportLecture({ ...session, chapters: chaptersOf('v1'), title: '第三讲' });

  assert.equal(result.path, currentNotePath({ courseTitle: COURSE, lessonTitle: LESSON }));
  assert.equal(result.deduped, false);
  const md = notes.files.get(`${currentNotePath({ courseTitle: COURSE, lessonTitle: LESSON })}.md`);
  assert.equal(md, baselineToMarkdown(chaptersOf('v1'), '第三讲'), 'md 与编码器的输出逐字一致');
  assert.ok(md.includes('v1 的讲解正文'));
  assert.ok(md.includes('##### 解答'), '例题的解答分隔在 md 里');
});

test('exportLecture：重名不覆盖，加「（2）」后缀，两份内容都在', async () => {
  const notes = fakeNotes();
  const svc = service(notes);
  await svc.exportLecture({ ...session, chapters: chaptersOf('v1'), title: 'T' });
  // 用户在上次导出那份上改了东西
  await notes.write(currentNotePath({ courseTitle: COURSE, lessonTitle: LESSON }), '# 我自己改的\n\n手写了很久。');

  const second = await svc.exportLecture({ ...session, chapters: chaptersOf('v2'), title: 'T' });
  assert.equal(second.path, `${currentNotePath({ courseTitle: COURSE, lessonTitle: LESSON })}（2）`);
  assert.equal(second.deduped, true);

  assert.equal(notes.files.get(`${currentNotePath({ courseTitle: COURSE, lessonTitle: LESSON })}.md`), '# 我自己改的\n\n手写了很久。',
    '原来那份一个字都没被改');
  assert.ok(notes.files.get(`${currentNotePath({ courseTitle: COURSE, lessonTitle: LESSON })}（2）.md`).includes('v2 的讲解正文'));
});

test('exportLecture：连导三次得到（2）（3），序号不复用', async () => {
  const notes = fakeNotes();
  const svc = service(notes);
  await svc.exportLecture({ ...session, chapters: chaptersOf('a'), title: 'T' });
  await svc.exportLecture({ ...session, chapters: chaptersOf('b'), title: 'T' });
  const third = await svc.exportLecture({ ...session, chapters: chaptersOf('c'), title: 'T' });
  assert.equal(third.path, `${currentNotePath({ courseTitle: COURSE, lessonTitle: LESSON })}（3）`);
  assert.equal(notes.files.size, 3);
});

test('exportLecture：空讲义拒绝导出，不污染笔记库', async () => {
  const notes = fakeNotes();
  await assert.rejects(() => service(notes).exportLecture({ ...session, chapters: [] }), /没有章节/);
  assert.equal(notes.files.size, 0, '拒绝之后笔记库里不该多出任何东西');
});

test('exportLecture：不建归档目录、不写任何非 md 文件', async () => {
  const notes = fakeNotes();
  await service(notes).exportLecture({ ...session, chapters: chaptersOf('v1'), title: 'T' });
  for (const path of notes.files.keys()) {
    assert.ok(path.endsWith('.md'), `只该有 md，却出现了 ${path}`);
    assert.ok(!path.includes('讲义归档'), '新架构不产生归档目录');
  }
});

test('exportLecture：缺少课程名或节次名当场失败', async () => {
  const notes = fakeNotes();
  await assert.rejects(() => service(notes).exportLecture({ courseTitle: '', lessonTitle: 'x', chapters: chaptersOf('v1') }), /缺少课程名/);
  await assert.rejects(() => service(notes).exportLecture({ courseTitle: 'x', lessonTitle: '', chapters: chaptersOf('v1') }), /缺少节次名/);
});

test('服务构造：缺方法当场失败，而不是等用户点了导出才炸', () => {
  assert.throws(() => createHandoutService({ notes: { tree: () => [] } }), /缺少方法/);
  assert.throws(() => createHandoutService({}), /需要一个笔记服务/);
});

// ── 纯函数：重名规避本身 ────────────────────────────────────

test('availableNotePath：基准可用时原样返回，不画蛇添足加后缀', () => {
  assert.equal(availableNotePath('a/b', new Set()), 'a/b');
  assert.equal(availableNotePath('a/b', new Set(['a/c'])), 'a/b');
});

test('availableNotePath：占用时从 2 开始编号', () => {
  assert.equal(availableNotePath('a/b', new Set(['a/b'])), 'a/b（2）');
  assert.equal(availableNotePath('a/b', new Set(['a/b', 'a/b（2）'])), 'a/b（3）');
});

test('existingNoteKeys：只收笔记，文件夹与附件不算重名', () => {
  const entries = [
    { path: '课程/节次', type: 'note' },
    { path: '课程', type: 'folder' },
    { path: '课程/图.png', type: 'attachment' },
  ];
  const keys = existingNoteKeys(entries);
  assert.deepEqual([...keys], ['课程/节次']);
});

test('existingNoteKeys：反斜杠路径归一成斜杠（Windows 后端）', () => {
  const keys = existingNoteKeys([{ path: '课程\\节次', type: 'note' }]);
  assert.ok(keys.has('课程/节次'));
});

// ── 笔记库按真实课程结构组织 ──────────────────────────────

test('有学期时路径是「学期/课程/节次」三层', async () => {
  const notes = fakeNotes();
  const result = await service(notes).exportLecture({
    ...session, termName: '2025-2026 秋冬', chapters: chaptersOf('v1'), title: 'T',
  });
  assert.equal(result.path, '2025-2026 秋冬/数据结构/第三讲 树与二叉树');
  assert.equal(result.folder, '2025-2026 秋冬/数据结构');
  assert.equal(result.name, '第三讲 树与二叉树');
  assert.ok(notes.files.has(`${result.path}.md`), '按三层路径真实落盘');
});

test('没有学期时退化成两层，不编造「未分学期」的假目录', async () => {
  const notes = fakeNotes();
  for (const termName of [undefined, null, '', '   ']) {
    notes.files.clear();
    const result = await service(notes).exportLecture({ ...session, termName, chapters: chaptersOf('v1'), title: 'T' });
    assert.equal(result.path, '数据结构/第三讲 树与二叉树', `termName=${JSON.stringify(termName)} 时应当只有两层`);
    assert.ok(!result.path.includes('未分学期'), '不编造假目录');
  }
});

test('同一课程不同学期落在不同文件夹，重名各自独立计数', async () => {
  const notes = fakeNotes();
  const svc = service(notes);
  const autumn = await svc.exportLecture({ ...session, termName: '2025 秋冬', chapters: chaptersOf('a'), title: 'T' });
  const spring = await svc.exportLecture({ ...session, termName: '2026 春夏', chapters: chaptersOf('b'), title: 'T' });
  assert.equal(autumn.path, '2025 秋冬/数据结构/第三讲 树与二叉树');
  assert.equal(spring.path, '2026 春夏/数据结构/第三讲 树与二叉树');
  assert.equal(autumn.deduped, false, '不同学期之间不该互相算重名');
  assert.equal(spring.deduped, false);
  assert.equal(notes.files.size, 2);
});
