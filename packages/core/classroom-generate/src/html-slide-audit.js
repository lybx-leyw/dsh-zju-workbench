// Browser port: no browser package is imported here. The caller owns Chromium lifecycle.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fitSlideOutput } from './html-slide-fit.js';

/** Default production gate; deployments may inject a shared browser instead. Fail closed if unavailable. */
export async function validateHtmlWithBrowser(result) {
  let browser;
  try {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  } catch {
    throw Object.assign(new Error('横版 HTML 需要 Chromium 进行版式校验；请安装浏览器或注入 validateHtml 校验端口。'), { code: 'E_HTML_LAYOUT_UNAVAILABLE' });
  }
  try { await fitSlideOutput(result, { browser }); return await auditSlideHtml(result.html, { browser }); }
  finally { await browser.close(); }
}

export async function auditSlideHtml(html, { browser, screenshotDirectory, prefix = 'chapter' } = {}) {
  if (!browser?.newPage) throw new Error('HTML slide audit needs a browser port');
  if (!/^[a-zA-Z0-9_-]+$/.test(prefix)) throw new Error('Unsafe audit prefix');
  const page = await browser.newPage({ viewport: { width: 1720, height: 1220 } });
  const errors = [], requests = [], pages = [], failures = [];
  page.on('pageerror', error => errors.push(error.name));
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push('network request'); });
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.htmlDeck);
    const count = await page.locator('.slide').count();
    if (!count) throw new Error('No landscape slides');
    for (let index = 0; index < count; index++) {
      await page.evaluate(i => window.htmlDeck.goTo(i), index);
      const noteBefore = await page.locator('.explanation-panel:visible').innerText();
      await page.evaluate(() => window.htmlDeck.showAllFormulas());
      const noteAfter = await page.locator('.explanation-panel:visible').innerText();
      const result = await page.evaluate(i => {
        const slide = [...document.querySelectorAll('.slide')][i];
        const rect = slide.getBoundingClientRect();
        const sx = rect.width / 1600, sy = rect.height / 900;
        const problems = [];
        const describe = e => (e.getAttribute('class') || e.tagName).slice(0, 70);
        if (Math.abs(rect.width / rect.height - 16 / 9) > .01) problems.push('aspect ratio is not 16:9');
        if (slide.offsetWidth !== 1600 || slide.offsetHeight !== 900) problems.push('canvas is not 1600x900');
        if (slide.scrollWidth > slide.clientWidth + 2 || slide.scrollHeight > slide.clientHeight + 2) problems.push('canvas content overflows');
        if (slide.querySelector('.explanation-panel')) problems.push('explanation is inside the slide');
        if (slide.querySelector('p:not(.kicker):not(.summary)')) problems.push('explanatory paragraph is inside the slide');
        // 内容栏自身的溢出：要点太多或太长会把公式挤出可视区。
        //
        // ⚠️ 纵向用 `scrollHeight` 判（可靠：内容变高就会撑高）；
        //    横向**不能**用 `scrollWidth` —— 它把 MathML 内联盒的字体度量也算进去，
        //    实测一条 442px 宽、完全放得下的公式会让 `content-pane` 的 scrollWidth
        //    虚报 215px。横向改为逐个子行量矩形。
        for (const pane of slide.querySelectorAll('.content-pane')) {
          if (pane.scrollHeight > pane.clientHeight + 2) {
            problems.push(`右栏内容超出 ${pane.scrollHeight - pane.clientHeight}px（要点或公式太多太长）：请删减要点、缩短单条要点，或把推导拆到下一页`);
          }
          const paneRect = pane.getBoundingClientRect();
          for (const child of pane.children) {
            const r = child.getBoundingClientRect();
            if (r.right > paneRect.right + 2) {
              const name = child.className?.toString().replace(/^.*?\b(points|formula-row)\b.*$/, '$1') || child.tagName;
              problems.push(`右栏的「${name}」横向超出 ${Math.ceil(r.right - paneRect.right)}px；请缩短单条要点或公式`);
            }
          }
        }
        // Check actual rendered descendant geometry, including hidden/clipped text.
        //
        // ⚠️ SVG 与 MathML 的**内部**元素不逐个查：
        //   - SVG 用 viewBox 自己的坐标系，子节点越出 viewBox 由上面的标签检查单独管；
        //   - MathML 的 `mtext`/`mo` 等内联盒会因字体度量（斜体右伸、上下标伸出）
        //     比父级 `<math>` 宽出几像素，而整条公式其实放得下。实测 25 页里
        //     绝大多数「exceeds canvas」都是这种假阳性。
        // 只查它们的**根元素**（`<svg>` / `<math>`），那才是真实的占位范围。
        for (const e of slide.querySelectorAll('*')) {
          const tag = e.tagName.toLowerCase();
          if (e.closest('svg') && tag !== 'svg') continue;
          if (e.closest('math') && tag !== 'math') continue;
          if (e.matches('script,style') || !e.getClientRects().length) continue;
          const b = e.getBoundingClientRect();
          if (b.left < rect.left - 2 || b.top < rect.top - 2 || b.right > rect.right + 2 || b.bottom > rect.bottom + 2) problems.push(`${describe(e)} exceeds canvas`);
          if (e.matches('h1,h2,[data-formula-step],.summary,.point,svg') && (b.left < rect.left + 60 * sx - 2 || b.right > rect.right - 60 * sx + 2 || b.top < rect.top + 50 * sy - 2 || b.bottom > rect.bottom - 45 * sy + 2)) problems.push(`${describe(e)} exceeds safe margin`);
        }
        const walker = document.createTreeWalker(slide, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim() || node.parentElement.closest('svg')) continue;
          const range = document.createRange(); range.selectNodeContents(node);
          for (const b of range.getClientRects()) {
            if (b.left < rect.left - 2 || b.right > rect.right + 2 || b.top < rect.top - 2 || b.bottom > rect.bottom + 2) problems.push('text exceeds canvas');
          }
        }
        const svgs = [...slide.querySelectorAll('svg')];
        for (const [svgIndex, svg] of svgs.entries()) {
          const v = svg.viewBox.baseVal;
          if (!v.width || !v.height) { problems.push(`svg ${svgIndex} has no viewBox`); continue; }
          const texts = [...svg.querySelectorAll('text')];
          for (const t of texts) {
            const b = t.getBBox();
            // 报「越界」时必须说清**哪一侧、差多少**，否则模型只能猜着挪。
            // 实测一份作业图把居中标签放在 x=60，左边出血 20 多像素，
            // 模型连修两次都只是把 x 从 60 改到 58 —— 它不知道问题在左侧。
            const escapes = [];
            if (b.x < v.x - 2) escapes.push(`左侧超出 ${Math.ceil(v.x - b.x)}px`);
            if (b.y < v.y - 2) escapes.push(`上方超出 ${Math.ceil(v.y - b.y)}px`);
            if (b.x + b.width > v.x + v.width + 2) escapes.push(`右侧超出 ${Math.ceil(b.x + b.width - (v.x + v.width))}px`);
            if (b.y + b.height > v.y + v.height + 2) escapes.push(`下方超出 ${Math.ceil(b.y + b.height - (v.y + v.height))}px`);
            if (escapes.length) {
              const label = t.textContent.trim().slice(0, 20);
              problems.push(`svg ${svgIndex} 标签「${label}」${escapes.join('、')}（锚点 x=${t.getAttribute('x') ?? '-'} y=${t.getAttribute('y') ?? '-'} text-anchor=${t.getAttribute('text-anchor') ?? 'start'}，字号 ${t.getAttribute('font-size') ?? '默认'}）；请挪进 20..780 / 20..540 的安全区`);
            }
            // 可读下限 18px（见 html-slide-shell.js 的 MIN_SVG_FONT_SIZE 注释里的实测数据：
            // 18px 在 800×560 图示区渲染成 24px 行高，是清晰可读的正文大小）。
            if (parseFloat(getComputedStyle(t).fontSize) < 18) problems.push(`svg ${svgIndex} 标签「${t.textContent.trim().slice(0, 20)}」字号小于 18px`);
          }
          for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
            const x = texts[a].getBoundingClientRect(), y = texts[b].getBoundingClientRect();
            const w = Math.min(x.right, y.right) - Math.max(x.left, y.left);
            const h = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
            if (w > 2 && h > 2 && w * h > .15 * Math.min(x.width * x.height, y.width * y.height)) {
              // 重叠也说清是水平还是垂直方向挤到了，以及重叠了多少像素。
              problems.push(`svg ${svgIndex} 标签重叠「${texts[a].textContent.trim().slice(0, 12)}」与「${texts[b].textContent.trim().slice(0, 12)}」（水平重叠 ${Math.round(w)}px、垂直重叠 ${Math.round(h)}px）；请加大水平/垂直间距`);
            }
          }
        }
        const formulas = [...slide.querySelectorAll('[data-formula-step]')];
        for (const formula of formulas) {
          // 判「公式放不下」用三条**互补**的物理判据，缺一条都会漏：
          //
          //   1. `math` 实际宽度超出内容区 —— 横向溢出
          //   2. `math` 底边越出所在行 —— 纵向溢出（公式行太高）
          //   3. **内容区 scrollWidth 显著大于 clientWidth** —— MathML 会被浏览器
          //      **压缩**到容器宽度显示（`mathW` 看起来正好等于容器宽），真实内容却
          //      远宽于容器（实测 `scrollWidth 1554` vs `clientWidth 580`）。
          //      只看第 1 条会完全漏掉这种情况：屏幕上公式被挤成一团，但量出来不越界。
          //
          // 用 scrollHeight/clientHeight 判纵向会大量误报（`.formula-content` 上有
          // `width:100%;min-width:0`，scrollHeight 会把行内 padding 也算进去），
          // 所以纵向只用底边比较。
          const content = formula.querySelector('.formula-content');
          const math = formula.querySelector('math');
          const rowRect = formula.getBoundingClientRect();
          const contentRect = content?.getBoundingClientRect();
          const mathRect = (math ?? content)?.getBoundingClientRect();
          if (!mathRect || !contentRect || !content) continue;
          if (mathRect.width > contentRect.width + 2) {
            problems.push(`公式横向超出右栏 ${Math.ceil(mathRect.width - contentRect.width)}px；请拆行或拆到下一页`);
          }
          if (mathRect.bottom > rowRect.bottom + 2) {
            problems.push(`公式纵向越出所在行 ${Math.ceil(mathRect.bottom - rowRect.bottom)}px；请拆到下一页`);
          }
          if (content.scrollWidth > content.clientWidth + 8) {
            problems.push(`公式内容被压进右栏（真实宽度 ${content.scrollWidth}px，栏宽 ${content.clientWidth}px）：请拆行或拆到下一页`);
          }
        }
        if (document.querySelector('[data-formula-step]:not(.slide [data-formula-step])')) problems.push('formula steps outside canvas');
        if ([...document.querySelectorAll('[data-step]')].length) problems.push('generic explanation reveal is forbidden');
        return { index: i, title: slide.querySelector('h1,h2')?.textContent ?? '', width: slide.offsetWidth, height: slide.offsetHeight,
          diagrams: svgs.length, formulas: formulas.length, issues: [...new Set(problems)] };
      }, index);
      if (noteBefore !== noteAfter || !noteAfter.trim()) result.issues.push('explanation missing or changed by formula reveal');
      pages.push(result);
      if (result.issues.length) failures.push({ slide: index + 1, issues: result.issues });
      if (screenshotDirectory) {
        await mkdir(screenshotDirectory, { recursive: true });
        await page.locator('.slide').nth(index).screenshot({ path: path.join(screenshotDirectory, `${prefix}-slide-${index + 1}.png`) });
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileIssues = [];
    for (let index = 0; index < count; index++) {
      await page.evaluate(i => { window.htmlDeck.goTo(i); window.htmlDeck.showAllFormulas(); }, index);
      const state = await page.evaluate(i => {
        const r = [...document.querySelectorAll('.slide')][i].getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth + 2, ratio: r.width / r.height, right: r.right, left: r.left };
      }, index);
      if (state.overflow || Math.abs(state.ratio - 16 / 9) > .01 || state.left < -2 || state.right > 392) mobileIssues.push(index + 1);
    }
    if (mobileIssues.length) failures.push({ mobileOverflowSlides: mobileIssues });
    if (errors.length || requests.length) failures.push({ browserErrors: errors, networkRequests: requests.length });
    const report = { ok: failures.length === 0, pages, mobile: { width: 390, overflowSlides: mobileIssues }, browserErrors: errors, networkRequests: requests.length, failures };
    if (screenshotDirectory) await writeFile(path.join(screenshotDirectory, `${prefix}-audit.json`), JSON.stringify(report, null, 2) + '\n');
    if (!report.ok) throw new Error(`Slide layout validation failed: ${JSON.stringify(failures).slice(0, 2400)}`);
    return report;
  } finally { await page.close(); }
}
