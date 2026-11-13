import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../..', import.meta.url));

async function launch() {
  const bundled = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || chromium.executablePath();
  for (const options of [existsSync(bundled) ? { executablePath: bundled } : null, { channel: 'msedge' }, {}])
    if (options) { try { return await chromium.launch({ headless: true, ...options }); } catch { /* next */ } }
  return null;
}

/**
 * 用户实测：拖抽屉时中间阅读器连续漂移、整页卡顿。
 *
 * 根因不是宽度算错，而是**拖动每一帧都在 setState**：整页重排、PDF iframe 跟着重排。
 * 这里在真实浏览器里拖动一次，统计 iframe 被重排的次数与 React 提交次数。
 */
test('拖动抽屉时不触发整页重渲染，阅读器也不跟着漂移', { timeout: 120000 }, async (t) => {
  const browser = await launch();
  if (!browser) { t.skip('没有可启动的浏览器'); return; }
  try {
    const { build } = await import('esbuild');
    const result = await build({ stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      const Frame = () => {
        const ref = React.useRef(null);
        // 记录 iframe 尺寸被重设的次数：每帧 setState 时它会被反复 reflow。
        React.useEffect(() => {
          const el = ref.current; if (!el) return undefined;
          const ro = new ResizeObserver(() => { window.__frameResizes = (window.__frameResizes ?? 0) + 1; });
          ro.observe(el); return () => ro.disconnect();
        }, []);
        return React.createElement('iframe', { ref, className: 'zwp-frame', style: { width: '100%', height: '100%', border: 0 } });
      };
      let commits = 0;
      function App() {
        const [width, setWidth] = React.useState(392);
        commits += 1;
        const startRef = React.useRef(null);
        const onPointerDown = (event) => {
          event.preventDefault();
          const startX = event.clientX, startWidth = width;
          const root = startRef.current;
          const pointer = event.currentTarget;
          try { pointer.setPointerCapture?.(event.pointerId); } catch {}
          let frame = 0, pending = startWidth;
          const paint = () => { frame = 0; root.style.setProperty('--zwp-drawer-width', pending + 'px'); };
          const move = (e) => { pending = Math.min(Math.max(300, startWidth + (startX - e.clientX)), 900);
            if (frame === 0) frame = requestAnimationFrame(paint); };
          const finish = () => {
            if (frame !== 0) cancelAnimationFrame(frame);
            frame = 0;
            try { pointer.releasePointerCapture?.(event.pointerId); } catch {}
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', finish);
            document.body.classList.remove('zwp-resizing');
            root.style.removeProperty('--zwp-drawer-width');
            if (pending !== startWidth) setWidth(pending);
          };
          document.body.classList.add('zwp-resizing');
          document.addEventListener('pointermove', move);
          document.addEventListener('pointerup', finish);
        };
        window.__commits = () => commits;
        return React.createElement('div', { style: { display: 'flex', width: '900px', height: '600px' } },
          React.createElement('div', { className: 'zwp-reader', style: { flex: 1, minWidth: 0 } }, React.createElement(Frame)),
          React.createElement('aside', { ref: startRef, className: 'zwp-drawer is-open',
            style: { '--zwp-drawer-width': width + 'px', flexShrink: 0, borderLeft: '1px solid #ccc', width: 'var(--zwp-drawer-width)' } },
            React.createElement('div', { className: 'zwp-drawer-resize', style: { width: 6, cursor: 'col-resize', height: '100%' }, onPointerDown })));
      }
      createRoot(document.getElementById('root')).render(React.createElement(App));
    `, resolveDir: root, loader: 'jsx' }, bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } });
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.setContent('<html><body><div id="root" style="width:900px"></div></body></html>');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.waitForFunction(() => typeof window.__commits === 'function');
    const before = await page.evaluate(() => window.__commits());
    const box = await page.locator('.zwp-drawer-resize').boundingBox();
    await page.mouse.move(box.x + 3, box.y + 200);
    await page.mouse.down();
    for (let i = 0; i < 40; i += 1) await page.mouse.move(box.x + 3 - i * 6, box.y + 200);
    await page.mouse.up();
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ commits: window.__commits(), resizes: window.__frameResizes ?? 0 }));
    // 拖动 40 步只应提交一次（松手时），而不是每一步一次。
    assert.ok(after.commits - before <= 2, `拖动期间 React 提交次数应靠近 1，实际 ${after.commits - before}`);
    const width = await page.evaluate(() => document.querySelector('.zwp-drawer').getBoundingClientRect().width);
    assert.ok(width > 500, `松手后宽度应真的变了：${width}`);
  } finally { await browser.close(); }
});
