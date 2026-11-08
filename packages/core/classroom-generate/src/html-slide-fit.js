// Deterministic presentation compilation: split equations/pages, never alter terms or shrink type.
import { renderSlideChapter, validateSlideDeck } from './html-slide-shell.js';

export async function fitSlideOutput(result, { browser }) {
  validateSlideDeck({ slides: result.slides });
  const page = await browser.newPage({ viewport: { width: 1720, height: 1220 } });
  try {
    await page.setContent(result.html, { waitUntil: 'load' });
    const plan = await page.evaluate(() => {
      const plans = [];
      const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      for (const [slideIndex, slide] of [...document.querySelectorAll('.slide')].entries()) {
        window.htmlDeck.goTo(slideIndex); window.htmlDeck.showAllFormulas();
        const formulaPlans = [];
        const pane = slide.querySelector('.content-pane');
        const paneOverflow = pane.scrollHeight > pane.clientHeight + 2;
        for (const row of slide.querySelectorAll('[data-formula-step]')) {
          const content = row.querySelector('.formula-content');
          const math = content.querySelector('math');
          const width = Math.min(560, content.clientWidth - 8);
          // 溢出判据与 audit 完全一致（三选一即为溢出）：
          //   1. math 实际宽度超出内容区
          //   2. math 底边越出所在行
          //   3. 内容区 scrollWidth 显著大于 clientWidth（MathML 被浏览器**压缩**显示时，
          //      mathW 恰好等于容器宽，只有 scrollWidth 才反映真实宽度）
          const rowRect = row.getBoundingClientRect();
          const contentRect = content.getBoundingClientRect();
          const mathRect = (math ?? content).getBoundingClientRect();
          const overflowX = mathRect.width > contentRect.width + 2
            || content.scrollWidth > content.clientWidth + 8;
          const overflowY = mathRect.bottom > rowRect.bottom + 2;
          if (!overflowX && !overflowY) { formulaPlans.push(null); continue; }
          let nodes;
          if (math) {
            nodes = [...math.childNodes].filter(n => n.nodeType === 1 || n.textContent.trim());
            while (nodes.length === 1 && nodes[0].nodeType === 1 && nodes[0].localName === 'mrow') nodes = [...nodes[0].childNodes].filter(n => n.nodeType === 1 || n.textContent.trim());
          } else if (!content.children.length) nodes = [...content.textContent].map(c => document.createTextNode(c));
          else { formulaPlans.push(null); continue; }
          const text = n => n.textContent;
          const isOperator = n => math ? n.nodeType === 1 && n.localName === 'mo' && /^[=+−\-≤≥]$/.test(text(n)) : /^[=+−\-≤≥]$/.test(text(n));
          const chunks = []; let chunk = [], depth = 0;
          for (const n of nodes) {
            const s = text(n);
            if (!depth && isOperator(n) && chunk.length) { chunks.push(chunk); chunk = []; }
            chunk.push(n);
            if (/^[([{]$/.test(s)) depth++;
            if (/^[)\]}]$/.test(s)) depth = Math.max(0, depth - 1);
          }
          if (chunk.length) chunks.push(chunk);
          // 拆不开的公式（只有一个顶层运算符、或整体是一个不可分割的长表达式）：
          // **按节点数逐次对半切**，直到每段都放得下或切到单个节点为止。
          // 只切一次不够 —— 实测 795px 的公式对半后每段仍约 400px 加上分式高度，
          // 有时还是超；递归切能保证收敛到「单节点」这个下界。
          const serialize = ns => math
            ? `<math display="block"><mrow>${ns.map(n => n.nodeType === 1 ? n.outerHTML : escape(n.textContent)).join('')}</mrow></math>`
            : escape(ns.map(n => n.textContent).join(''));
          const measure = ns => {
            const probe = document.createElement('div');
            probe.className = 'formula-row';
            probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;width:max-content;max-width:none;white-space:nowrap;padding:0;border:0;';
            probe.innerHTML = serialize(ns); document.body.append(probe);
            const w = probe.getBoundingClientRect().width; probe.remove(); return w;
          };
          // 拆不开的公式（只有一个顶层运算符、或整体是不可分割的长表达式）：
          // 按节点数**递归**对半切，直到每段都放得下或切到单节点。
          // 只切一次不够 —— 实测 795px 的公式对半后每段仍超 580px。
          if (chunks.length < 2) {
            const splitRecursively = list => {
              if (list.length < 2 || measure(list) <= width) return [list];
              const half = Math.ceil(list.length / 2);
              return [...splitRecursively(list.slice(0, half)), ...splitRecursively(list.slice(half))];
            };
            const parts = splitRecursively(nodes);
            if (parts.length < 2) { formulaPlans.push('unbreakable'); continue; }
            chunks.length = 0;
            chunks.push(...parts);
          }
          const groups = []; let group = [];
          for (const part of chunks) {
            if (group.length && measure([...group, ...part]) > width) { groups.push(group); group = []; }
            group.push(...part);
          }
          if (group.length) groups.push(group);
          // 尽力而为：即使某一组自己就超宽（不可分割的长分式/长下标），也**照拆**，
          // 让超宽只落在一行上，再由分页把它单独放到一页。
          //
          // 曾经是「任一组超宽就整条放弃拆分」—— 结果一个长分式让整条公式保持原样，
          // 页面溢出、fit 报告「无改动」、模型收到的错误是「formula exceeds its row」，
          // 而它根本无从下手。实测 25 页卡在这里。
          const split = groups.length > 1;
          formulaPlans.push(split ? groups.map(serialize) : null);
        }
        plans.push({ formulaPlans, paneOverflow });
      }
      return plans;
    });
    const compiled = [], changes = [];
    for (const [index, slide] of result.slides.entries()) {
      const { formulaPlans, paneOverflow } = plan[index];
      // `'unbreakable'` 也算「需要处理」，否则会被当成 `null`（= 无需改动）。
      const split = formulaPlans.some(Boolean);
      if (!split && !paneOverflow) { compiled.push(slide); continue; }
      const rows = (slide.formulas ?? []).flatMap((formula, n) => {
        const plan = formulaPlans[n];
        if (!plan) return [formula];
        // 拆得动的：按拆好的行展开。
        if (Array.isArray(plan)) {
          return plan.map((html, i) => ({ html, ...(formula.label ? { label: i ? '续式' : formula.label } : {}) }));
        }
        // 拆不动的：原样保留一行，但**单独占一页**（下面按 rows.length 分组时
        // groupSize=1 会让它独占），让公式拿到整栏宽度。
        return [formula];
      });
      const onlyUnbreakable = formulaPlans.some(p => p === 'unbreakable');
      // 有一行拆不动时，整页按「一页一行」排，并切成**公式优先版式**：
      // 图示缩为上方一条、公式占满整幅宽。
      const groupSize = onlyUnbreakable ? 1 : paneOverflow ? 2 : 3;
      if (!rows.length) { compiled.push(slide); continue; }
      for (let start = 0; start < rows.length; start += groupSize) {
        const page = {
          ...slide,
          ...(start ? { kicker: `公式推导 · 续页 ${Math.floor(start / groupSize) + 1}` } : {}),
          formulas: rows.slice(start, start + groupSize),
        };
        // 拆不动的公式独占整幅宽度，否则永远卡在 580px 里。
        if (onlyUnbreakable) page.layout = 'wide-formula';
        compiled.push(page);
      }
      changes.push({ slide: index + 1, originalRows: slide.formulas?.length ?? 0, compiledRows: rows.length,
        pages: Math.ceil(rows.length / groupSize), wide: onlyUnbreakable });
    }
    if (changes.length) {
      validateSlideDeck({ slides: compiled });
      result.slides = compiled;
      result.html = renderSlideChapter({ title: result.title, topic: result.topic ?? '', slides: compiled });
      result.layoutCompilation = changes;
    }
    return changes;
  } finally { await page.close(); }
}
