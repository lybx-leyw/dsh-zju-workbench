/**
 * 笔记页的**存储半边**契约测试。
 *
 * 这一页的宿主半边做两件有真实风险的事，所以值得单测：
 *
 *   1. **把用户给的标题变成文件路径**。不校验就等于把文件系统交给调用方
 *      （`../../.ssh/id_rsa`）。这是安全边界，不是格式检查。
 *   2. **写入用原子替换**。写一半崩了留下截断的笔记，比写失败更糟。
 *
 * 页面本体（React）没有单测 —— 本仓客户端包靠真实宿主验证（见包内 README）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { safeName, safePath, NOTES_DIR } from '../packages/dsh-zhiyun-page-notes/src/index.js';

/** 存在性判断（测试里的断言读起来比 `stat().catch()` 顺）。 */
async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

test('safeName：路径穿越一律被剥掉（这是安全边界）', () => {
  // 目标是「结果里绝不含路径分隔符，也不含 ..」——不是"看起来还行"。
  const attacks = [
    '../../.ssh/id_rsa',
    '..\\..\\windows\\system32\\config',
    '/etc/passwd',
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    'a/b/c',
    '....//....//x',
    '../',
    '..',
  ];
  for (const attack of attacks) {
    const out = safeName(attack);
    if (out === null) continue; // 全部剥光也算安全
    assert.ok(!out.includes('/'), `${attack} → ${out} 仍含 /`);
    assert.ok(!out.includes('\\'), `${attack} → ${out} 仍含 \\`);
    assert.ok(!out.includes('..'), `${attack} → ${out} 仍含 ..`);
    assert.ok(!path.isAbsolute(out), `${attack} → ${out} 是绝对路径`);
  }
});

test('safeName：Windows 非法字符被去掉', () => {
  // 这些字符在 Windows 上会让 writeFile 直接失败；跨平台用同一套规则，
  // 免得"在 mac 上能建、到 Windows 打不开"。
  const out = safeName('a<b>c:d"e|f?g*h');
  assert.equal(out, 'abcdefgh');
  assert.ok(!/[<>:"|?*]/.test(out));
});

test('safeName：控制字符被去掉', () => {
  const out = safeName('a\u0000b\u001fc\nd');
  assert.ok(!/[\u0000-\u001f]/.test(out), `实际 ${JSON.stringify(out)}`);
});

test('safeName：空白压缩、首尾去空、限长', () => {
  assert.equal(safeName('  很多   空格  '), '很多 空格');
  assert.equal(safeName('a'.repeat(200)).length, 80, '限长 80');
  assert.equal(safeName('  x  '), 'x');
});

test('safeName：剥光后给 null，而不是猜一个默认名', () => {
  // ⚠️ 猜默认名的后果：两篇笔记都叫「无标题」，第二篇覆盖第一篇。
  // 如实返回 null，由调用方报错。
  for (const empty of ['', '   ', '...', '///', '\\\\', '..\\..', '\u0000']) {
    assert.equal(safeName(empty), null, `${JSON.stringify(empty)} 应给 null`);
  }
  assert.equal(safeName(null), null);
  assert.equal(safeName(undefined), null);
});

test('safeName：正常中文标题原样保留', () => {
  assert.equal(safeName('概率论笔记'), '概率论笔记');
  assert.equal(safeName('大数定律 #数学'), '大数定律 #数学', '标签语法是正文的一部分，不该动');
  assert.equal(safeName('My Note'), 'My Note');
});

test('宿主半边：写读往返 + 列表 + 删除（真落盘到临时目录）', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-notes-test-'));
  try {
    // 直接构造一个最小 ctx，避免起整个 Cordis。
    const mod = await import('../packages/dsh-zhiyun-page-notes/src/index.js');
    const provided = {};
    const routes = [];
    const ctx = {
      profileContext: { dir: path.join(dir, 'profile') },
      logger: { info: () => {}, warn: () => {} },
      inject: (deps, cb) => { cb({ connection: { fetch: { register: (route) => { routes.push(route); return () => {}; } } }, effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; } }); },
      provide: (n, v) => { provided[n] = v; return () => {}; },
      get: () => undefined, // vault 索引器不在场 —— 页面只是没有反链
    };
    await mod.apply(ctx, { dir: path.join(dir, 'notes') });
    const svc = provided.zhiyunVaultNotes;
    assert.ok(svc, '应提供 zhiyunVaultNotes 服务');
    assert.deepEqual(await svc.list(), [], '初始为空');

    // 新建 → 写 → 读回
    const made = await svc.create('概率论笔记');
    assert.equal(made.name, '概率论笔记');
    await svc.write('概率论笔记', '# 大数定律\n\n见 [[中心极限定理]] 与 #数学');
    const read = await svc.read('概率论笔记');
    assert.equal(read.markdown, '# 大数定律\n\n见 [[中心极限定理]] 与 #数学');

    // 列表带预览与字数（正文不整个塞进列表）
    const list = await svc.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].title, '概率论笔记');
    assert.ok(list[0].chars > 0);
    assert.ok(list[0].preview.includes('大数定律'));

    // 同名新建会加序号，不覆盖已有笔记
    const second = await svc.create('概率论笔记');
    assert.equal(second.name, '概率论笔记 2');
    assert.equal((await svc.list()).length, 2);

    // 磁盘上确实是普通的 .md 文件（这才是"用户自己的文件"）
    const files = (await readdir(path.join(dir, 'notes'))).filter((f) => f.endsWith('.md'));
    assert.deepEqual(files.sort(), ['概率论笔记 2.md', '概率论笔记.md']);
    assert.equal(await readFile(path.join(dir, 'notes', '概率论笔记.md'), 'utf8'), '# 大数定律\n\n见 [[中心极限定理]] 与 #数学');

    // 路径穿越在服务层被**中和**，不是报错。
    //
    // ⚠️ 我最初这里写的是 `assert.rejects(..., /不合法/)`，以为穿越会当错误拒掉 ——
    //    实际行为是 `safeName` 把 `../../etc/passwd` 剥成 `etcpasswd`（一个合法的
    //    普通名字），于是读它只是"没有这篇笔记"。这个行为**更好**：穿越被降级成
    //    一次查不到的普通读，而不是给调用方一个可区分的错误信号。
    //    真正要断言的是「它绝不会碰到 notes/ 之外的任何文件」。
    assert.equal(await svc.read('../../etc/passwd'), null, '穿越被中和成普通名字，读不到');
    await svc.write('../../escape', 'x');
    const afterEscape = (await readdir(path.join(dir, 'notes'))).filter((f) => f.endsWith('.md'));
    assert.ok(afterEscape.every((f) => !f.includes('..') && !f.includes('/')), `落盘名单异常：${afterEscape}`);
    // 且确实在 notes/ 目录里（没有跑到上一层去）
    const parentFiles = await readdir(dir);
    assert.ok(!parentFiles.includes('escape.md'), '不得写到 notes/ 之外');

    // 删除（笔记：`kind` 用来让界面区分"删了篇笔记"与"删了个附件"）
    assert.deepEqual(await svc.remove('概率论笔记'), { removed: true, kind: 'note' });
    assert.equal(await svc.read('概率论笔记'), null, '读不到已删除的笔记');
    // 删掉「概率论笔记」后还剩两篇：序号版「概率论笔记 2」与穿越被中和出的「escape」。
    // （写这条时先写成 1 —— 忘了上面那次 `write('../../escape')` 也真落了一篇。
    //   这正是"测试里的每个动作都会留下状态"的一个具体例子。）
    const rest = await svc.list();
    assert.equal(rest.length, 2, `实际：${rest.map((n) => n.title).join(', ')}`);
    assert.ok(rest.some((n) => n.title === 'escape'), '穿越输入被中和成一个普通名字');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('宿主半边：重命名会改写别的笔记里指向它的链接', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-notes-rename-'));
  try {
    const mod = await import('../packages/dsh-zhiyun-page-notes/src/index.js');
    const provided = {};
    // 用一个**真的**索引器（dsh-zhiyun-core-vault），验两者协作。
    const vaultMod = await import('../packages/dsh-zhiyun-core-vault/src/host.js');
    const services = {};
    const makeCtx = (target) => ({
      profileContext: { dir: path.join(dir, 'profile') },
      logger: { info: () => {}, warn: () => {} },
      inject: (deps, cb) => cb({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; } }),
      provide: (n, v) => { target[n] = v; return () => {}; },
      get: (n) => services[n],
    });
    await vaultMod.apply(makeCtx(services), {});
    // 索引器要先拿到笔记才能算改写；页面写盘后会推给它，这里手动同步一次。
    await mod.apply(makeCtx(provided), { dir: path.join(dir, 'notes') });
    const svc = provided.zhiyunVaultNotes;

    await svc.create('甲');
    await svc.create('乙');
    await svc.write('甲', '见 [[乙]] 与 [[乙|别名]]');
    await svc.write('乙', '乙的正文');
    await services.zhiyunVault.setNotes(await svc.list().then(async (items) => {
      const out = [];
      for (const item of items) out.push({ path: `${item.title}.md`, markdown: (await svc.read(item.title)).markdown });
      return out;
    }));

    const result = await svc.rename('乙', '丙');
    assert.equal(result.renamed, true);
    assert.equal(result.rewrote, 1, '甲这一篇被改写了');
    // 甲里的两种链接形态都要改成新名，别名原样保留
    const after = await svc.read('甲');
    assert.ok(after.markdown.includes('[[丙]]'), `裸链接未改写：${after.markdown}`);
    assert.ok(after.markdown.includes('[[丙|别名]]'), `带别名的未改写：${after.markdown}`);
    assert.ok(!after.markdown.includes('[[乙'), '不该残留旧名');
    // 文件真的改名了
    assert.equal(await svc.read('乙'), null);
    assert.equal((await svc.read('丙')).markdown, '乙的正文');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('NOTES_DIR 常量与 README 里写的一致', () => {
  assert.equal(NOTES_DIR, 'zhiyun-vault-notes');
});

/* ────────────────────────── 子目录（vault 就是一棵树） ────────────────────────── */

test('safePath：允许子目录，但 `..` 一律被中和（不是报错）', () => {
  // 与 safeName 同一条取舍：`..` 被**丢掉**而不是拒掉。于是 `../../x` 变成一次
  // 普通读取（查不到），而不是给调用方一个能用来探测文件系统的错误信号。
  assert.equal(safePath('理学/概率论'), '理学/概率论');
  assert.equal(safePath('a/b/c'), 'a/b/c');
  assert.equal(safePath('../../escape'), 'escape');
  assert.equal(safePath('理学/../../概率论'), '理学/概率论');
  assert.equal(safePath('/etc/passwd'), 'etc/passwd', '前导斜杠被剥掉，落成库内相对路径');
  assert.equal(safePath('a\\b'), 'a/b', 'Windows 反斜杠按分隔符处理');
  assert.equal(safePath('a//b'), 'a/b');
  // 剥光 / 只剩非法段 → null，由调用方报错
  for (const bad of ['', '   ', '..', '../..', '/', '.', '...']) {
    assert.equal(safePath(bad), null, `${JSON.stringify(bad)} 应给 null`);
  }
});

test('宿主半边：文件夹的建 / 列 / 移 / 删，以及嵌套路径下的双链解析', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-folders-'));
  try {
    const mod = await import('../packages/dsh-zhiyun-page-notes/src/index.js');
    const vaultMod = await import('../packages/dsh-zhiyun-core-vault/src/host.js');
    const provided = {};
    const services = {};
    // 两个半边一起上：验的是"文件夹 + 双链"这组协作，不是各自孤立的行为。
    await vaultMod.apply({
      profileContext: { dir: path.join(dir, 'profile') },
      logger: { info: () => {}, warn: () => {} },
      inject: (deps, cb) => cb({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; } }),
      provide: (n, v) => { services[n] = v; return () => {}; },
      get: (n) => services[n],
    }, {});
    await mod.apply({
      profileContext: { dir: path.join(dir, 'profile') },
      logger: { info: () => {}, warn: () => {} },
      inject: (deps, cb) => cb({ connection: { fetch: { register: () => () => {} } }, effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; } }),
      provide: (n, v) => { provided[n] = v; return () => {}; },
      get: (n) => services[n],
    }, { dir: path.join(dir, 'notes') });
    const svc = provided.zhiyunVaultNotes;

    // 建两个文件夹；同名会自动加序号，不覆盖
    assert.equal((await svc.mkdir('理学')).path, '理学');
    assert.equal((await svc.mkdir('理学')).path, '理学 2');
    assert.equal((await svc.mkdir('学业', '理学')).path, '理学/学业', '可以建在别的文件夹里');

    // 笔记建在文件夹里：返回的是**带目录的相对路径**
    const gailv = await svc.create('概率论', '理学');
    assert.equal(gailv.name, '理学/概率论');
    const dashi = await svc.create('大数定律', '理学');
    assert.equal(dashi.name, '理学/大数定律');
    await svc.write('理学/概率论', '见 [[大数定律]] 与 #数学');
    await svc.write('理学/大数定律', '正文');

    // 磁盘上真的是一棵目录树（`学业` 是上面在 `理学` 里建的子文件夹）。
    // 两侧都 `.sort()`：默认排序是按码位，手写顺序容易记反（这一条就先写反过）。
    assert.deepEqual(
      (await readdir(path.join(dir, 'notes', '理学'))).sort(),
      ['学业', '大数定律.md', '概率论.md'].sort(),
    );
    assert.equal(await readFile(path.join(dir, 'notes', '理学', '概率论.md'), 'utf8'), '见 [[大数定律]] 与 #数学');

    // tree()：文件树要的三样都在，且**笔记的 path 不带 .md**（那是它在 [[链接]] 里的写法）
    const tree = await svc.tree();
    const notesOnly = tree.filter((e) => e.type === 'note');
    assert.equal(notesOnly.length, 2);
    assert.deepEqual(notesOnly.map((e) => e.path).sort(), ['理学/大数定律', '理学/概率论']);
    assert.equal(notesOnly.find((e) => e.path === '理学/概率论').title, '概率论');
    assert.equal(notesOnly.find((e) => e.path === '理学/概率论').folder, '理学');
    assert.deepEqual(tree.filter((e) => e.type === 'folder').map((e) => e.path).sort(), ['理学', '理学 2', '理学/学业']);

    // 附件（非 .md）也要出现在树里，带类型角标用的扩展名
    await writeFile(path.join(dir, 'notes', '理学', '截图.png'), 'not really a png');
    const withAttachment = await svc.tree();
    const attachment = withAttachment.find((e) => e.type === 'attachment');
    assert.equal(attachment.path, '理学/截图.png');
    assert.equal(attachment.ext, 'png');

    // ── 附件必须能被删掉 ──────────────────────────────────────────────
    // ⚠️ 这条钉的是一个真实漏洞：`remove` 只会试 `<path>.md`，而 `tree` 给附件的
    //    `path` 是**带扩展名的完整路径**（`理学/截图.png`），于是补成
    //    `理学/截图.png.md` 一定不存在 → 返回 `removed:false`。用户在树里选中
    //    附件按删除，界面上什么都不会发生。
    //    附件在文件树里是一等公民（可选中、可拖动），删不掉是硬缺陷。
    assert.deepEqual(await svc.remove('理学/截图.png'), { removed: true, kind: 'attachment' });
    assert.equal(await exists(path.join(dir, 'notes', '理学', '截图.png')), false, '附件字节要真从磁盘消失');
    assert.equal((await svc.tree()).some((e) => e.type === 'attachment'), false, '树里也不该再有它');
    // 删一个本来就不存在的东西：如实返回 false，不谎报成功
    assert.deepEqual(await svc.remove('理学/从来没有过.png'), { removed: false });

    // ── 嵌套路径下的双链：索引器要能按「同目录优先」解析 ──
    const pushIndex = async () => {
      const all = await svc.tree();
      const payload = [];
      for (const entry of all.filter((e) => e.type === 'note')) {
        payload.push({ path: `${entry.path}.md`, markdown: (await svc.read(entry.path)).markdown });
      }
      await services.zhiyunVault.setNotes(payload);
    };
    await pushIndex();
    // 直接读索引（`zhiyunVault.index()` 是宿主侧的索引面，不必绕 HTTP 信封）。
    const index = services.zhiyunVault.index();
    const backlinks = index.backlinks.get('理学/大数定律.md') ?? [];
    assert.equal(backlinks.length, 1, `同目录的 [[大数定律]] 应解析到 理学/大数定律.md，实际 ${JSON.stringify(backlinks)}`);
    assert.equal(backlinks[0].from, '理学/概率论.md');

    // 移到根目录：只换目录、不改名 → 不需要改写链接（basename 仍然解析得到）
    const moved = await svc.move('理学/大数定律', '大数定律');
    assert.equal(moved.moved, true);
    assert.equal(moved.rewrote, 0, '只换目录时链接不该被改');
    assert.equal(await svc.read('理学/大数定律'), null);
    assert.equal((await svc.read('大数定律')).markdown, '正文');

    // 改名（换 basename）→ 改写全库指向它的链接
    const renamed = await svc.move('大数定律', '中心极限定理');
    assert.equal(renamed.rewrote, 1, '概率论那篇里的 [[大数定律]] 要被改写');
    assert.equal((await svc.read('理学/概率论')).markdown, '见 [[中心极限定理]] 与 #数学');

    // ⚠️ 不能把文件夹移进它自己里面（内容会消失在一个不可达路径）
    await assert.rejects(svc.move('理学', '理学/学业/理学'), /移进它自己/);
    // 目标已存在要说清楚，而不是覆盖
    await svc.mkdir('已存在');
    await svc.create('占位', '已存在');
    await assert.rejects(svc.move('中心极限定理', '理学/概率论'), /已经有/);

    // 删文件夹 = 连同里面的东西。
    // 返回值带 `kind` 与 `contained`：文件夹删除会**连带**删掉别的文件，调用方
    // （笔记页的删除确认条）要能如实说出"含几个文件"，不能只是报一个 true。
    // `contained` 只数文件（笔记 + 附件），不含子文件夹本身 —— 此刻 `理学` 里
    // 剩 `大数定律.md`（`概率论.md` 与截图已在上面两段各自删掉/移走）。
    assert.deepEqual(await svc.remove('理学'), { removed: true, kind: 'folder', contained: 1 });
    assert.equal(await svc.read('理学/概率论'), null);
    assert.equal(await exists(path.join(dir, 'notes', '理学')), false, '目录本身也要没了');

    // 路径穿越在**带目录**的形状下同样被中和，且绝不越出库目录
    await svc.write('../../escape2', 'x');
    const inVault = await svc.tree();
    assert.ok(inVault.every((e) => !e.path.split('/').includes('..')), '树里不该出现 ..');
    assert.ok(!(await readdir(dir)).includes('escape2.md'), '不得写到 notes/ 之外');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
