import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { noteAnchor } from '../packages/dsh-zhiyun-page-paper/src/cornell-notes.js';

test('Cornell anchors retain relative page position at different zoom levels', () => {
  assert.equal(noteAnchor(300, { top: 100, height: 800 }), 0.25);
  assert.equal(noteAnchor(500, { top: 100, height: 1600 }), 0.25);
  assert.equal(noteAnchor(-20, { top: 0, height: 800 }), 0);
});

const browserPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
test('Cornell notes scroll with pages, restore anchors after reconstruction, wrap and persist', {
  skip: !existsSync(browserPath) && 'Set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run browser verification',
}, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', (error) => console.error('Browser error:', error.message));
    const source = readFileSync(new URL('../packages/dsh-zhiyun-page-paper/src/cornell-notes.js', import.meta.url), 'utf8');
    await page.route('http://cornell.test/**', (route) => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `<meta charset="utf-8"><style>
        #pane {height:700px;overflow:auto} #pdf-pages{display:flex;flex-direction:column;align-items:safe center;gap:14px}
        .page{position:relative;width:600px;height:900px;flex-shrink:0;background:white}
        :root{--zp-frame-surface:#fafafa;--zp-frame-text:#222;--zp-frame-line:#ddd;--zp-frame-accent:blue}
      </style><div id="pane"><div id="pdf-pages"><div class="page" data-page="1"><canvas></canvas></div>
      <div class="page" data-page="2"><canvas></canvas></div></div></div>
      <script type="module">${source}
      window.mount = (name='paper') => { window.detach?.(); window.detach=attachCornellNotes(document,{topic:'topic',name});document.documentElement.classList.add('zp-cornell-visible'); };
      window.mount();</script>`,
    }));
    await page.goto('http://cornell.test/');
    const aside = page.locator('.zp-page-notes').first();
    await aside.click({ position: { x: 80, y: 225 } });
    const field = page.getByRole('textbox', { name: '第 1 页位置笔记' });
    const text = '段落旁的笔记自动换行'.repeat(20);
    await field.fill(text);
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'TEXTAREA');
    const geometry = () => field.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const p = el.closest('.page').getBoundingClientRect();
      return { y: rect.top, relative: (rect.top - p.top) / p.height, width: el.clientWidth,
        scrollWidth: el.scrollWidth, height: el.clientHeight };
    });
    const before = await geometry();
    assert.ok(before.height > 32);
    assert.ok(before.scrollWidth <= before.width);
    await page.locator('#pane').evaluate((el) => { el.scrollTop = 100; });
    assert.ok(Math.abs((await geometry()).y - before.y + 100) < 2);
    await page.evaluate(() => {
      const node = document.querySelector('.page');
      const next = document.createElement('div'); next.className='page'; next.dataset.page='1';
      next.style.height='1800px'; next.style.width='900px'; next.append(document.createElement('canvas'));
      node.replaceWith(next);
    });
    await field.waitFor();
    assert.equal(await field.inputValue(), text);
    assert.ok(Math.abs((await geometry()).relative - before.relative) < 0.002);
    await page.evaluate(() => document.documentElement.classList.remove('zp-cornell-visible'));
    await page.evaluate(() => document.documentElement.classList.add('zp-cornell-visible'));
    assert.equal(await field.inputValue(), text);
    await page.reload(); await field.waitFor();
    assert.equal(await field.inputValue(), text);
    assert.ok(Math.abs((await geometry()).relative - before.relative) < 0.002);
    await page.evaluate(() => window.mount('other-paper'));
    assert.equal(await page.locator('textarea').count(), 0);
    await page.evaluate(() => window.mount());
    assert.equal(await field.inputValue(), text);
    // Page-mode navigation discards page DOM. Returning must reconstruct the same note.
    await page.evaluate(() => { document.querySelector('[data-page="1"]').remove(); });
    await page.locator('.zp-page-notes').click({ position: { x: 80, y: 200 } });
    await page.getByRole('textbox', { name: '第 2 页位置笔记' }).fill('第二页独立笔记');
    await page.evaluate(() => {
      const node = document.createElement('div'); node.className='page'; node.dataset.page='1';
      node.append(document.createElement('canvas')); document.querySelector('#pdf-pages').prepend(node);
    });
    await field.waitFor();
    assert.equal(await field.inputValue(), text);
    assert.equal(await page.getByRole('textbox', { name: '第 2 页位置笔记' }).inputValue(), '第二页独立笔记');
    // Quota failures keep the current draft across page reconstruction and clearly show failure.
    await page.evaluate(() => {
      window.originalSetItem=Storage.prototype.setItem;
      Storage.prototype.setItem=()=>{ throw new Error('quota'); };
    });
    await field.fill('未保存草稿');
    assert.match(await page.locator('.zp-page-notes-label').first().textContent(), /保存失败/);
    await page.evaluate(() => {
      const node=document.querySelector('[data-page="1"]');
      const next=node.cloneNode(false); next.append(document.createElement('canvas')); node.replaceWith(next);
    });
    await field.waitFor();
    assert.equal(await field.inputValue(), '未保存草稿');
    await page.evaluate(() => { Storage.prototype.setItem=window.originalSetItem; });
    await field.fill(text);
    // Removing a note by clearing it must survive a later page reconstruction.
    await field.fill(''); await field.blur();
    await page.reload();
    assert.equal(await page.getByRole('textbox', { name: '第 1 页位置笔记' }).count(), 0);
    assert.equal(await page.getByRole('textbox', { name: '第 2 页位置笔记' }).inputValue(), '第二页独立笔记');
  } finally { await browser.close(); }
});
