// Real-browser render of the progress panel: verifies scan-ability, no overflow,
// and that step states are visually distinguishable (colour is not the only cue).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = path.join(ROOT, '.tmp', `progress-shot-${process.pid}`);
fs.mkdirSync(dir, { recursive: true });
const entry = path.join(dir, 'entry.jsx');
fs.writeFileSync(entry, `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TeachingProgress } from '${path.join(ROOT, 'packages/client/page-study/src/teaching-progress.jsx').replaceAll('\\', '/')}';
const progress = {
  phase: 'html', chapterTotal: 4, chaptersDone: 1, slidesDone: 5,
  chapterProgress: [
    { chapterIndex: 0, chapterId: 'a', title: '概率的加法公式', status: 'done', slidesDone: 5, scenesTotal: 5 },
    { chapterIndex: 1, chapterId: 'b', title: '古典概型与超几何模型', status: 'running', stage: 'html', slidesDone: 2, sceneIndex: 2, scenesTotal: 6 },
    { chapterIndex: 2, chapterId: 'c', title: '条件概率与独立性', status: 'running', stage: 'html-storyboard', slidesDone: 0, scenesTotal: null },
    { chapterIndex: 3, chapterId: 'd', title: '随机变量及其分布', status: 'pending', slidesDone: 0, scenesTotal: null },
  ],
};
createRoot(document.getElementById('root')).render(<TeachingProgress progress={progress} startedAt={Date.now() - 134000} />);
`);

const esbuild = await import('esbuild');
await esbuild.build({ entryPoints: [entry], bundle: true, outfile: path.join(dir, 'bundle.js'),
  format: 'iife', jsx: 'automatic', platform: 'browser', logLevel: 'silent',
  define: { 'process.env.NODE_ENV': '"development"' } });

const studyCss = fs.readFileSync(path.join(ROOT, 'packages/client/page-study/src/style.css'), 'utf8');
const shellCss = `:root{--zy-surface:#fffdf8;--zy-line:#dcd6c8;--zy-text:#1d2724;--zy-muted:#6b7671;--zy-secondary:#3f4b47;--zy-accent:#176c68;--zy-hover:#eef2ef;--zy-space-1:4px;--zy-space-2:8px;--zy-space-3:12px;--zy-space-4:16px;--zy-space-5:20px;--zy-fs-sm:13px;--zy-fs-md:15px}
body[data-zhiyun]{margin:0;padding:32px;background:#f2efe7;font-family:system-ui,sans-serif;color:var(--zy-text)}`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 640, height: 620 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('about:blank');
  await page.setContent(`<!doctype html><body data-zhiyun><div id="root"></div></body>`);
  await page.addStyleTag({ content: shellCss });
  await page.addStyleTag({ content: studyCss });
  await page.addScriptTag({ path: path.join(dir, 'bundle.js') });
  await page.waitForSelector('.zs-teach-progress');

  const report = await page.evaluate(() => {
    const panel = document.querySelector('.zs-teach-progress');
    const box = panel.getBoundingClientRect();
    const steps = [...panel.querySelectorAll('.zs-teach-steps > li')].map(li => ({
      state: li.dataset.state,
      label: li.querySelector('span').textContent,
      dotBg: getComputedStyle(li.querySelector('i')).backgroundColor,
      opacity: getComputedStyle(li.querySelector('i')).opacity,
      fontWeight: getComputedStyle(li).fontWeight,
    }));
    const count = state => steps.filter(step => step.state === state).length;
    return {
      phases: panel.querySelector('strong').textContent,
      percent: panel.querySelector('.zs-teach-percent')?.textContent,
      elapsed: [...panel.querySelectorAll('span')].find(span => span.textContent.includes('已用'))?.textContent ?? null,
      overflows: panel.scrollWidth > panel.clientWidth + 1,
      inViewport: box.right <= innerWidth + 1 && box.left >= -1,
      chapters: panel.querySelectorAll('.zs-teach-chapter-list > li').length,
      stepCounts: { done: count('done'), active: count('active'), pending: count('pending') },
      distinctVisuals: {
        activeDotFilled: steps.find(s => s.state === 'active')?.dotBg,
        pendingDotTransparent: steps.find(s => s.state === 'pending')?.dotBg,
        activeBold: steps.find(s => s.state === 'active')?.fontWeight,
        pendingNormal: steps.find(s => s.state === 'pending')?.fontWeight,
      },
    };
  });
  await page.screenshot({ path: path.join(ROOT, 'artifacts', 'html-slides-real', 'teaching-progress.png') });
  console.log(JSON.stringify({ ...report, errors }, null, 2));
} finally { await browser.close(); }
