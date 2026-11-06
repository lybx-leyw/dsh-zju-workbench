/**
 * PDF 导入与阅读：宿主侧的行为（真落盘，临时目录）。
 *
 * 这些是本功能的**地基**：字节有没有原样落盘、能不能原样读回、路径安不安全。
 * 阅读器 UI 的端到端验证在 `pdf-viewer.test.mjs`（要真浏览器）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { minimalPdf } from './fixtures/minimal-pdf.mjs';
import { makeVault } from './fixtures/vault-harness.mjs';

/**
 * 造一份最小但**合法**的 PDF（两页、一张 Helvetica 字体）。
 *
 * 不引 pdf-lib：只为这个测试多一个依赖不值当，而 PDF 的对象表本身就够简单。
 * @returns Buffer
 */


test('PDF 导入：字节原样落盘，标题即文件名', async () => {
  const vault = await makeVault();
  try {
    const pdf = minimalPdf();
    const made = await vault.svc.importAsset({
      title: '线性代数讲义',
      folder: '',
      ext: 'pdf',
      base64: pdf.toString('base64'),
    });
    assert.equal(made.path, '线性代数讲义.pdf');
    assert.equal(made.title, '线性代数讲义');
    assert.equal(made.ext, 'pdf');

    // 磁盘上的字节必须**完全一致**：base64 往返不能有损。
    const onDisk = await readFile(path.join(vault.dir, '线性代数讲义.pdf'));
    assert.deepEqual(onDisk, pdf, '落盘字节应与导入前一致');
    assert.equal(onDisk.subarray(0, 5).toString('latin1'), '%PDF-');

    // 出现在树里，且类型是 attachment
    const tree = await vault.svc.tree();
    const row = tree.find((e) => e.path === '线性代数讲义.pdf');
    assert.equal(row?.type, 'attachment');
    assert.equal(row?.ext, 'pdf');
  } finally {
    await vault.cleanup();
  }
});

test('PDF 导入：同名自动加序号，不覆盖已有文件', async () => {
  const vault = await makeVault();
  try {
    const pdf = minimalPdf().toString('base64');
    const first = await vault.svc.importAsset({ title: '讲义', ext: 'pdf', base64: pdf });
    const second = await vault.svc.importAsset({ title: '讲义', ext: 'pdf', base64: pdf });
    assert.equal(first.path, '讲义.pdf');
    assert.equal(second.path, '讲义 2.pdf', '同名应加序号，而不是覆盖');
    const files = (await readdir(vault.dir)).filter((f) => f.endsWith('.pdf')).sort();
    assert.deepEqual(files, ['讲义 2.pdf', '讲义.pdf']);
  } finally {
    await vault.cleanup();
  }
});

test('PDF 导入：可以放进子文件夹', async () => {
  const vault = await makeVault();
  try {
    await vault.svc.mkdir('理学');
    const made = await vault.svc.importAsset({
      title: '力学', folder: '理学', ext: 'pdf', base64: minimalPdf().toString('base64'),
    });
    assert.equal(made.path, '理学/力学.pdf');
    assert.ok((await readdir(path.join(vault.dir, '理学'))).includes('力学.pdf'));
  } finally {
    await vault.cleanup();
  }
});

test('PDF 导入：拒绝伪装的扩展名（内容不是 PDF）', async () => {
  const vault = await makeVault();
  try {
    // 扩展名说是 pdf，内容却是一段 HTML —— 这种文件交给 pdf.js 只会在阅读时炸，
    // 所以在导入时就该拒绝，并说清原因。
    await assert.rejects(
      () => vault.svc.importAsset({ title: '假的', ext: 'pdf', base64: Buffer.from('<html>not a pdf</html>').toString('base64') }),
      /不是 PDF/,
    );
  } finally {
    await vault.cleanup();
  }
});

test('PDF 导入：拒绝非白名单扩展名与空内容', async () => {
  const vault = await makeVault();
  try {
    await assert.rejects(
      () => vault.svc.importAsset({ title: 'x', ext: 'exe', base64: 'AAAA' }),
      /不支持导入/,
    );
    await assert.rejects(
      () => vault.svc.importAsset({ title: 'x', ext: 'pdf', base64: '' }),
      /为空/,
    );
  } finally {
    await vault.cleanup();
  }
});

test('PDF 导入：路径穿越被中和（不会写到库外）', async () => {
  const vault = await makeVault();
  try {
    const made = await vault.svc.importAsset({
      title: '../../escape', ext: 'pdf', base64: minimalPdf().toString('base64'),
    });
    // `safeName` 把斜杠与点剥掉 → 变成一个普通名字，仍落在库内。
    assert.ok(!made.path.includes('..'), `实际：${made.path}`);
    assert.ok(!made.path.includes('/'), `实际：${made.path}`);
    const tree = await vault.svc.tree();
    assert.ok(tree.some((e) => e.type === 'attachment' && e.ext === 'pdf'));
  } finally {
    await vault.cleanup();
  }
});

test('PDF 删除走同一条 remove（附件路径带扩展名）', async () => {
  const vault = await makeVault();
  try {
    const made = await vault.svc.importAsset({ title: '待删', ext: 'pdf', base64: minimalPdf().toString('base64') });
    assert.deepEqual(await vault.svc.remove(made.path), { removed: true, kind: 'attachment' });
    assert.equal((await vault.svc.tree()).some((e) => e.path === made.path), false);
  } finally {
    await vault.cleanup();
  }
});

test('PDF 路由：路径穿越与非法资源被挡', async () => {
  const mod = await import('../packages/dsh-zhiyun-page-notes/src/pdf-viewer.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'pdf-route-'));
  try {
    await writeFile(path.join(dir, 'a.pdf'), minimalPdf());

    /** 跑一次路由，收集响应。 */
    const call = async (url) => {
      const headers = {};
      let status = 200;
      let body = null;
      const res = {
        writeHead(code, hdrs) { status = code; Object.assign(headers, hdrs ?? {}); },
        end(chunk) { body = chunk ?? null; },
        get headersSent() { return body !== null; },
      };
      await mod.servePdfRoute({ url }, res, {
        resolveFile: (raw) => {
          // 与生产同构：库内相对路径 → 绝对路径，越界给 null。
          if (typeof raw !== 'string' || raw === '' || raw.includes('..')) return null;
          return path.join(dir, raw);
        },
      });
      return { status, headers, body };
    };

    // 阅读器页面
    const pageRes = await call('/zhiyun-vault-pdf/');
    assert.equal(pageRes.status, 200);
    assert.match(String(pageRes.body), /pdf\.min\.mjs/);

    // pdf.js 静态资源
    const jsRes = await call('/zhiyun-vault-pdf/pdfjs/build/pdf.min.mjs');
    assert.equal(jsRes.status, 200);
    assert.ok(Number(jsRes.body.length) > 10000);

    // 穿越：`new URL()` 会把 `..` 规范化掉（`/pdfjs/../../.env` → `/.env`），
    // 于是它落到「未知路径」或阅读器页面 —— 无论哪个，**都读不到库外文件**。
    // 所以断言的是"没拿到 .env 的内容"，而不是某个具体状态码。
    const trav = await call('/zhiyun-vault-pdf/pdfjs/../../.env');
    const travBody = String(trav.body ?? '');
    assert.ok(!travBody.includes('APIkey'), '绝不能读出库外的 .env');
    assert.ok(!travBody.includes('BaseURL'), '绝不能读出库外的 .env');

    // 白名单之外的子目录（package.json）必须 404
    assert.equal((await call('/zhiyun-vault-pdf/pdfjs/package.json')).status, 404);
    // 编码后的穿越同样不能得手
    const encoded = await call('/zhiyun-vault-pdf/pdfjs/%2e%2e%2f%2e%2e%2f.env');
    assert.ok(!String(encoded.body ?? '').includes('APIkey'), '编码穿越也不得读出 .env');

    // 库内文件
    const fileRes = await call('/zhiyun-vault-pdf/file?path=a.pdf');
    assert.equal(fileRes.status, 200);
    assert.equal(fileRes.headers['content-type'], 'application/pdf');
    assert.equal(fileRes.body.subarray(0, 5).toString('latin1'), '%PDF-');

    // 越界与不存在
    assert.equal((await call('/zhiyun-vault-pdf/file?path=../../etc/passwd')).status, 400);
    assert.equal((await call('/zhiyun-vault-pdf/file?path=nope.pdf')).status, 404);
    // 未知路径
    assert.equal((await call('/zhiyun-vault-pdf/whatever')).status, 404);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
