// Offline artifact verification only: this script never calls an LLM or starts a server.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateHtmlChapter } from '../packages/dsh-zhiyun-core-classroom-generate/src/html-deck.js';

const directory = path.resolve('artifacts/html-teaching-real');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const reports = [];
try {
  for (const number of [1, 2]) {
    const htmlFile = path.join(directory, `chapter-${number}.html`);
    validateHtmlChapter(await readFile(htmlFile, 'utf8'));
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.name));
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push('unexpected-network-request'); });
    await page.goto(pathToFileURL(htmlFile).href);
    await page.waitForLoadState('networkidle');
    const steps = await page.locator('[data-step]').count();
    const initialHidden = await page.locator('[data-step][hidden]').count();
    const next = page.getByRole('button', { name: '下一步', exact: true });
    if (await next.isEnabled()) await next.click();
    const afterNextHidden = await page.locator('[data-step][hidden]').count();
    await page.getByRole('button', { name: '显示全部', exact: true }).click();
    const revealed = await page.locator('[data-step][hidden]').count();
    await page.screenshot({ path: path.join(directory, `chapter-${number}-desktop.png`), fullPage: true });
    const inspect = () => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 2,
      textLength: document.querySelector('main').innerText.length,
      diagrams: document.querySelectorAll('main svg').length,
      formulas: document.querySelectorAll('main math').length,
      svgTextOutside: [...document.querySelectorAll('main svg')].flatMap((svg, index) => {
        const v = svg.viewBox.baseVal;
        if (!v.width || !v.height) return [];
        return [...svg.querySelectorAll('text')].filter(t => {
          const b = t.getBBox(); return b.x < v.x - 3 || b.x + b.width > v.x + v.width + 3 || b.y < v.y - 3 || b.y + b.height > v.y + v.height + 3;
        }).map(() => index);
      }),
    });
    const desktop = await page.evaluate(inspect);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(inspect);
    await page.screenshot({ path: path.join(directory, `chapter-${number}-mobile.png`), fullPage: true });
    await page.emulateMedia({ media: 'print' });
    const printHidden = await page.locator('[data-step]').evaluateAll(nodes => nodes.filter(n => getComputedStyle(n).display === 'none').length);
    const result = { chapter: number, steps, initialHidden, afterNextHidden, revealed, printHidden, desktop, mobile, errors, networkRequests: requests.length };
    result.ok = steps > 1 && initialHidden > afterNextHidden && revealed === 0 && printHidden === 0 && !desktop.overflow && !mobile.overflow && !errors.length && !requests.length;
    reports.push(result);
    await page.close();
  }
} finally { await browser.close(); }
await writeFile(path.join(directory, 'browser-report.json'), JSON.stringify(reports, null, 2) + '\n');
console.log(JSON.stringify(reports, null, 2));
if (reports.some(r => !r.ok)) process.exitCode = 1;
