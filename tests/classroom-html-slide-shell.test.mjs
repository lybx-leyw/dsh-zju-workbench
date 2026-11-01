import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { validateSlideDeck, renderSlideChapter, validateSlideChapter } from '../packages/dsh-zhiyun-core-classroom-generate/src/html-slide-shell.js';

const visual = '<svg viewBox="0 0 800 560"><rect x="40" y="40" width="720" height="440" fill="#176c68"/><text x="80" y="120" fill="#fff">科学示意</text></svg>';
const slide = (overrides = {}) => ({ title: '守恒关系', kicker: '观察 · 推导', points: ['系统边界', '比较前后状态'], summary: '总量不随内部交换改变', visualHtml: visual, formulas: [{ html: '<math><mrow><mi>E</mi><mo>=</mo><mi>mc</mi><msup><mn>2</mn></msup></mrow></math>', label: '关系式' }, { html: 'ΔE = Q &lt; W' }], explanation: '这里是独立于画布的详细讲解。完整分析系统边界，再说明各物理量及其适用条件。'.repeat(12), ...overrides });
const render = (slides = [slide()]) => renderSlideChapter({ title: '科学课堂', topic: '守恒', slides });

test('schema returns the exact input object and counts Unicode characters', () => {
  const data = { slides: [slide({ title: '😀'.repeat(24) })] };
  assert.equal(validateSlideDeck(data), data);
  for (const bad of [{ slides: Array(1) }, { slides: [slide({ points: Array(1) })] }, { slides: [slide({ formulas: Array(1) })] }, { slides: [] }, { slides: [slide({ title: '长'.repeat(25) })] }, { slides: [slide({ kicker: '长'.repeat(29) })] }, { slides: [slide({ summary: '长'.repeat(49) })] }, { slides: [slide({ points: ['长'.repeat(37)] })] }, { slides: [slide({ points: ['a', 'b', 'c', 'd'] })] }, { slides: [slide({ formulas: Array.from({ length: 5 }, () => ({ html: 'x' })) })] }, { slides: [slide({ formulas: [{ html: 'x', label: '长'.repeat(15) }] })] }, { slides: [slide({ explanation: '' })] }, { slides: [slide({ visualHtml: undefined })] }, { slides: [slide({ css: 'body{}' })] }]) assert.throws(() => validateSlideDeck(bad), /Invalid slide deck/);
});

test('strict SVG token grammar rejects executable and remote content', () => {
  const bad = ['<svg viewBox="0 0 800 560" onload="alert(1)"></svg>', '<svg viewBox="0 0 800 560"><script>alert(1)</script></svg>', '<svg viewBox="0 0 800 560"><image href="https://example.com/a"/></svg>', '<svg viewBox="0 0 800 560"><foreignObject><iframe/></foreignObject></svg>', '<svg viewBox="0 0 800 560"><rect fill="url(#x)"/></svg>', '<svg viewBox="0 0 800 560"><g id="x"/></svg>', '<svg viewBox="0 0 800 560" style="color:red"></svg>', '<svg viewBox="0 0 800 560"><a href="javascript:alert(1)">x</a></svg>', '<svg viewBox="0 0 800 560"><!-- comment --></svg>', '<svg viewBox="0 0 800 560"><g></svg>', '<svg viewBox="0 0 800 560" viewBox="0 0 800 560"/>', '<svg viewBox="0 0 1 1"/>', '<svg viewBox="0 0 800 560"><use/></svg>', '<svg viewBox="0 0 800 560"><animate/></svg>'];
  bad.forEach(visualHtml => assert.throws(() => validateSlideDeck({ slides: [slide({ visualHtml })] }), /Invalid slide deck/));
});

test('formula grammar accepts escaped Unicode and MathML but not model steps or HTML', () => {
  for (const html of ['E = mc²', 'a &lt; b &amp; c &gt; d', '<math xmlns="http://www.w3.org/1998/Math/MathML"><mfrac><mi>a</mi><mi>b</mi></mfrac></math>', '<span>x<sub>i</sub><sup>2</sup></span>']) assert.doesNotThrow(() => validateSlideDeck({ slides: [slide({ formulas: [{ html }] })] }));
  for (const html of ['<script>x</script>', '<img src="x">', '<span data-step="1">x</span>', '<span data-formula-step="1">x</span>', '<math href="x"><mi>x</mi></math>', '<span onclick="x">x</span>', '<span style="background:url(x)">x</span>', '<math><annotation-xml encoding="text/html">x</annotation-xml></math>', '<span>&evil;</span>', '<span>x</sup>']) assert.throws(() => validateSlideDeck({ slides: [slide({ formulas: [{ html }] })] }), /Invalid slide deck/);
});

test('document roundtrip is deterministic and any shell or payload tampering fails', () => {
  const html = render();
  assert.equal(render(), html);
  assert.equal(validateSlideChapter(html), html);
  for (const modified of [html + ' ', html.replace('1600px', '1599px'), html.replace('id="next-slide"', 'id="bad"'), html.replace('守恒关系', '其他标题'), html.replace('科学课堂', '其他课堂'), html.replace('default-src', 'connect-src'), html.replace('window.htmlDeck', 'window.changed'), '<html></html>', null]) assert.throws(() => validateSlideChapter(modified), /^Error: Invalid slide chapter: deterministic shell tamper$/);
});

test('notes live in a separate scroll column, only formula rows carry step markers', () => {
  const html = render([slide(), slide({ title: '第二页' })]);
  assert.equal((html.match(/class="slide" data-slide-index=/g) || []).length, 2);
  assert.equal((html.match(/class="formula-row" data-formula-step=/g) || []).length, 4);
  // 讲解不再跟在幻灯片下面，而是同一层里的独立 aside（右侧滚动栏）。
  assert.match(html, /<main class="deck-layout"><div class="deck-stage">/);
  assert.match(html, /<aside class="deck-notes" aria-label="本页讲解"/);
  // 讲解必须在 stage 之外的 aside 里，不能嵌进 article。
  const aside = html.slice(html.indexOf('<aside class="deck-notes"'));
  const stage = html.slice(html.indexOf('<div class="deck-stage">'), html.indexOf('<aside class="deck-notes"'));
  assert.ok(aside.includes('class="explanation-panel"'), '讲解在 aside 里');
  assert.ok(!stage.includes('class="explanation-panel"'), '讲解不在幻灯片那一栏里');
  assert.doesNotMatch(html, /class="(?:points|summary|visual-pane|explanation-panel)" data-formula-step/);
  assert.match(html, /type="application\/json">\{"title"/);
  assert.match(html, /\\u003csvg/);
  assert.match(html, /script-src 'nonce-classroom-slide-shell-v1'/);
  assert.doesNotMatch(html, /<script[^>]+src=|<link|@import|fetch\(/);
});

test('fixed canvas, reserved formula space, physical scaling, and print contract', () => {
  const html = render();
  assert.match(html, /\.slide\{width:1600px;height:900px;padding:64px/);
  assert.match(html, /grid-template-columns:820px 580px/);
  assert.match(html, /font-size:56px/);
  assert.match(html, /font-size:30px/);
  assert.match(html, /w.style.height=900\*scale/);
  assert.match(html, /transform-origin:top left/);
  assert.match(html, /visibility=visible\?'visible':'hidden'/);
  assert.match(html, /setAttribute\('aria-hidden'/);
  assert.match(html, /@media print/);
  assert.match(html, /\.formula-row\{visibility:visible!important\}/);
  assert.doesNotMatch(html, /overflow:hidden|font-size:clamp|\.formula-row[^}]*display:none/);
  assert.doesNotMatch(html, /<article[^>]*hidden|<section[^>]*hidden/);
});

test('undersized diagram labels are rejected at validation, never silently enlarged', () => {
  // 真实事故：模型按 19px 排版，渲染期被静默放大到 24px，行距没变 →
  // 相邻两行叠在一起，而错误信息只报「标签重叠」，模型连续修不好。
  // 正确行为是在**入口**就拒绝，并说清楚原因。
  //
  // 下限是 18px（实测：18px 在 800×560 图示区渲染成 24px 行高，是清晰可读的正文大小）。
  assert.throws(
    () => validateSlideDeck({ slides: [slide({ visualHtml: '<svg viewBox="0 0 800 560"><text x="40" y="100" font-size="12">小标签</text></svg>' })] }),
    /font-size 12 太小（下限 18）/,
  );
  // 18px 与更大字号都合规，且原样保留不做任何改写。
  const ok = '<svg viewBox="0 0 800 560"><text x="40" y="100" font-size="18">合格</text><text x="40" y="180" font-size="40">大标题</text></svg>';
  const html = render([slide({ visualHtml: ok })]);
  const body = html.slice(0, html.indexOf('<script id="slide-deck-data"'));
  assert.match(body, /font-size="18">合格/);
  assert.match(body, /font-size="40">大标题/);
  assert.equal(validateSlideChapter(html), html);
});

test('in-chapter page progress and state messages follow slide navigation', () => {
  const html = render([slide(), slide({ title: '第二页' }), slide({ title: '第三页' })]);
  const script = html.match(/<script nonce="classroom-slide-shell-v1">([\s\S]*)<\/script>/)[1];
  assert.match(html, /class="page-progress" role="progressbar"/);
  assert.match(html, /aria-valuemax="3"/);
  const make = () => ({ hidden: false, style: {}, setAttribute(k, v) { this[k] = v; }, parentElement: { scrollTop: 0, setAttribute(k, v) { this[k] = v; } } });
  const slides = [[], [], []].map(() => ({ querySelectorAll: () => [] }));
  const wrappers = slides.map(() => ({ ...make(), firstElementChild: make() }));
  const messages = [];
  const bar = make();
  const controls = Object.fromEntries(['status', 'previous-slide', 'next-slide', 'previous-formula', 'next-formula', 'show-all-formulas'].map(id => [id, make()]));
  controls['page-progress-bar'] = bar;
  const viewport = { clientWidth: 1200, clientHeight: 675 };
  const document = { documentElement: { clientWidth: 1200, classList: { add() {} } }, querySelector(selector) { return selector === '.stage-viewport' ? viewport : null; }, querySelectorAll(selector) { return selector === '.slide' ? slides : selector === '.stage-wrapper' ? wrappers : slides.map(make); }, getElementById: id => controls[id], addEventListener() {} };
  const window = { addEventListener() {}, postMessage(data) { messages.push(data); } };
  // The shell posts to its own parent (the embedding page); in this sandbox it is `window`.
  vm.runInNewContext(script, { document, window, parent: window });
  assert.equal(bar.style.width, '33.33333333333333%');
  assert.equal(bar.parentElement['aria-valuenow'], '1');
  window.htmlDeck.goTo(2);
  assert.equal(bar.style.width, '100%');
  assert.equal(bar.parentElement['aria-valuenow'], '3');
  const last = messages.at(-1);
  assert.equal(last.type, 'html-deck:state');
  assert.equal(last.slideIndex, 2);
  assert.equal(last.slideCount, 3);
});

test('shell controls expose state and keep notes independent from formula visibility', () => {
  const html = render();
  const script = html.match(/<script nonce="classroom-slide-shell-v1">([\s\S]*)<\/script>/)[1];
  const make = () => ({ hidden: false, style: {}, setAttribute(k, v) { this[k] = v; } });
  const formulas = [[make(), make()], [make()]];
  const slides = formulas.map(rows => ({ querySelectorAll: () => rows }));
  const wrappers = slides.map(() => ({ ...make(), firstElementChild: make() }));
  const notes = slides.map(make);
  const controls = Object.fromEntries(['status', 'previous-slide', 'next-slide', 'previous-formula', 'next-formula', 'show-all-formulas'].map(id => [id, make()]));
  const viewport = { clientWidth: 390, clientHeight: 500 };
  const document = { documentElement: { clientWidth: 390, classList: { add() {} } }, querySelector(selector) { return selector === '.stage-viewport' ? viewport : null; }, querySelectorAll(selector) { return selector === '.slide' ? slides : selector === '.stage-wrapper' ? wrappers : notes; }, getElementById: id => controls[id], addEventListener() {} };
  const window = { addEventListener() {} };
  vm.runInNewContext(script, { document, window });
  const state = () => JSON.parse(JSON.stringify(window.htmlDeck.getState()));
  assert.deepEqual(state(), { slideIndex: 0, formulaStep: 0, slideCount: 2, formulaCount: 2 });
  assert.equal(wrappers[1].hidden, true);
  assert.equal(notes[0].hidden, false);
  assert.equal(formulas[0][0].style.visibility, 'hidden');
  assert.equal(formulas[0][0]['aria-hidden'], 'true');
  controls['next-formula'].onclick();
  assert.equal(state().formulaStep, 1);
  assert.equal(notes[0].hidden, false);
  window.htmlDeck.showAllFormulas();
  assert.equal(state().formulaStep, 2);
  assert.equal(formulas[0][1]['aria-hidden'], 'false');
  window.htmlDeck.goTo(1);
  assert.equal(notes[0].hidden, true);
  assert.equal(notes[1].hidden, false);
  assert.equal(state().formulaStep, 0);
  assert.equal(Number.parseFloat(wrappers[0].style.width) / Number.parseFloat(wrappers[0].style.height), 16 / 9);
  window.htmlDeck.goTo(-20);
  assert.equal(state().slideIndex, 0);
});
