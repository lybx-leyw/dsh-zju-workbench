/**
 * 题库页（packages/dsh-zhiyun-page-quiz）的静态契约守卫。
 *
 * 这一页被用户直接反馈「丑、不友好」，可它此前从未进过任何自动验收：shots 脚本只拍
 * today/ask/me，测试只测服务端批次。于是「改没改、改好没改好」只能靠人眼，改完之后也
 * 没人拦得住回退。下面每条断言都对应一个真实形状：
 *
 *   - 小于 11px 的正文字号：进度步骤、版本号、「未选择」提示都靠它压小，中文界面上
 *     等于读不清；壳的 style.css 自己也写明「元信息≥11px」。
 *   - 缺 :disabled / :focus-visible / color-scheme：禁用态没有视觉、键盘用户看不出
 *     焦点落在哪、深色主题下 select/input 还是白底。
 *   - 硬编码色值：这一页的规矩是「颜色只取壳的 --zy-* 变量」，硬编码在换肤后会变成
 *     一块孤立颜色（上一版就留了 #ffd787 与 #39876a）。
 *   - 顶层同名选择器重复：胜负只由「谁写在后面」决定，改第一处不生效，必须读完整张
 *     表才知道哪条赢 —— 原表有 18 组这样的重复。
 *   - JSX 结构契约：出题设置必须是一屏内的 setup/aside 两栏，知识点入口是 chips，
 *     不是那个被替换掉的 scope-trigger 按钮。
 *
 * 只读文件、纯静态比对：不起宿主、不跑构建，lib/client.js 一行不碰。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 fileURLToPath 而不是 url.pathname：后者在 Windows 上带着开头的 /，还会把路径里
// 的空格百分号编码 —— 仓库就放在「带空格的目录」里。
const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = rel => readFileSync(path.join(root, rel), 'utf8');

const CSS = 'packages/dsh-zhiyun-page-quiz/src/style.css';
const BANK = 'packages/dsh-zhiyun-page-quiz/src/question-bank.jsx';
const MODELS = 'packages/dsh-zhiyun-page-quiz/src/generation-models.jsx';
const PROGRESS = 'packages/dsh-zhiyun-page-quiz/src/question-generation-progress.jsx';

const css = read(CSS);

// 报错要带行号：只说「有 8 处」还是得自己去找，行号能直接跳过去改。
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const lineList = (text, regExp) => [...text.matchAll(regExp)].map(match => lineAt(text, match.index) + ':' + match[0].trim());
// 按数值判，不按字面判：`10px` 只是其中最扎眼的一档，9px/8px 一样读不清，而写成
// `font-size:10\u0070x` 这种字面匹配既漏 9.5px 也会被 `0.9rem` 绕过。
const smallFontSizes = text => [...text.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)]
  .map(match => ({ line: lineAt(text, match.index), size: match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]), raw: match[0] }))
  .filter(hit => hit.size < 11)
  .map(hit => hit.line + ':' + hit.raw.trim());

// 顶层规则的选择器：只认行首的 body[data-zhiyun]；@media 里的规则有缩进，因此天然被
// 排除 —— 媒体查询里同一个选择器再写一次是合法的响应式覆盖，不是重复。
// 选择器组要按「顶层逗号」拆：`:is(a, b)` 里的逗号不是分隔符，按 split(',') 拆会把
// 一条选择器切成两半，于是 .zs-qz-page 这种正常的成组写法反而被误报成重复。
function splitSelectors(head) {
  const parts = [];
  let depth = 0, quote = null, current = '';
  for (const char of head) {
    if (quote) { if (char === quote) quote = null; current += char; continue; }
    if (char === '"' || char === "'") { quote = char; current += char; continue; }
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if (char === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += char;
  }
  parts.push(current);
  return parts.map(part => part.trim().replace(/\s+/g, ' ')).filter(Boolean);
}

function topLevelSelectors(sheet) {
  const heads = sheet.match(/^body\[data-zhiyun\][^{]*\{/gm) ?? [];
  return heads.map(head => head.replace(/\{$/, '')).flatMap(splitSelectors);
}

function duplicatedSelectors(sheet) {
  const counts = new Map();
  for (const selector of topLevelSelectors(sheet)) counts.set(selector, (counts.get(selector) ?? 0) + 1);
  return [...counts.entries()].filter(([, times]) => times > 1).map(([selector]) => selector);
}

/* ------------------------------------------------------------ 真实仓库的契约 */

test('题库页没有小于 11px 的正文字号', () => {
  // 10px 只是其中最扎眼的一档；9px/8px 一样读不清，所以按数值判而不是按字面判。
  const hits = smallFontSizes(css);
  assert.deepEqual(hits, [], '这些行字号小于 11px：' + hits.join('、') + '。100% 缩放下中文就已经读不清，而壳的样式表自己写着「元信息≥11px」');
});

test('样式表补齐禁用态、键盘焦点与原生控件配色', () => {
  const disabled = [...css.matchAll(/:disabled/g)].length;
  assert.ok(disabled >= 4, '只找到 ' + disabled + ' 处 :disabled：按钮/输入框禁用后外观不变，用户不知道「现在按不了」');
  assert.ok(/[^{}]*:focus-visible[^{}]*\{/.test(css), '缺少 :focus-visible 规则：键盘用户看不出焦点落在哪个控件上');
  assert.ok(/(^|[\s;{])color-scheme\s*:/m.test(css), '缺少 color-scheme 声明：深色主题下 select/input/滚动条仍是系统浅色');
  assert.ok(/appearance\s*:\s*none/.test(css), '原生控件没有 reset：13 个 select、number 的微调箭头、checkbox 都会与自绘圆角卡并存');
});

test('颜色只取壳的 --zy-* 变量，不硬编码色值', () => {
  const hex = lineList(css, /#[0-9a-fA-F]{3,8}\b/g);
  assert.deepEqual(hex, [], '这些行硬编码了色值：' + hex.join('、') + '。换肤后会变成一块孤立颜色，暗色主题下也无法自适应');
  assert.ok(!/#ffd787|#39876a/i.test(css), '旧版那两个孤立色值又回来了');
});

test('顶层规则没有同名选择器重复（不靠「后写的赢」做覆盖）', () => {
  const selectors = topLevelSelectors(css);
  assert.ok(selectors.length >= 150, '只解析出 ' + selectors.length + ' 条顶层选择器，守卫可能已失效');
  const duplicated = duplicatedSelectors(css);
  assert.deepEqual(duplicated, [], '这些选择器在顶层出现了不止一次，改第一处不生效：' + duplicated.join(' / '));
});

test('版面按 884px 可用宽设计：.zs-qz-page 不再写 1080px', () => {
  // 壳的 .zy-content 是 max-width:980px + 左右各 48px padding，题库页永远拿不到 1080。
  // 允许 max-width 写在 .zs-qz-page 自己的规则里，也允许与 .zs-qz 成组写成
  // :is(.zs-qz-page, .zs-qz) —— 后者是更省事的写法，不该因为形式不同就判失败。
  const widths = [];
  for (const rule of css.matchAll(/^body\[data-zhiyun\][^{]*\{([^}]*)\}/gm)) {
    const head = rule[0].slice(0, rule[0].indexOf('{'));
    if (!/(?:^|[\s,(])\.zs-qz-page(?=[\s,){])/.test(head)) continue;
    const declared = /max-width:\s*(\d+)px/.exec(rule[1]);
    if (declared) widths.push(Number(declared[1]));
  }
  assert.ok(widths.length > 0, '没找到 .zs-qz-page 的 max-width：版面预算回到「想当然」的状态');
  const widest = Math.max(...widths);
  assert.ok(widest <= 900, '.zs-qz-page 的 max-width 是 ' + widest + 'px，超过壳给的 884px 可用宽，双列会一直挤');
});

test('出题设置用新契约（setup / aside / more / chips），旧的长条结构与 scope-trigger 已消失', () => {
  const bank = read(BANK);
  assert.ok(bank.length > 1000, BANK + ' 读不到内容');
  for (const name of ['zs-qz-setup', 'zs-qz-aside', 'zs-qz-more', 'zs-qz-chips', 'zs-qz-setup-foot']) {
    assert.ok(bank.includes(name), BANK + ' 里没有 ' + name + '：出题设置没按「一屏两栏」重排，shots 的几何读数与 CSS 契约都会落空');
  }
  for (const gone of ['zs-qz-scope-trigger', 'zs-qz-gen-settings', 'zs-qz-strategy-advanced']) {
    assert.ok(!bank.includes(gone), BANK + ' 里仍有 ' + gone + '：旧版那些折叠层是「要滚两屏」的直接原因');
  }
});

test('生成按钮的禁用原因写成可见文字，不只藏在 hover title 里', () => {
  const bank = read(BANK);
  assert.ok(bank.includes('zs-qz-hint'), BANK + ' 里没有 .zs-qz-hint：7 项条件里缺哪一项、用户该怎么补，必须常驻可见');
  assert.ok(/blockers/.test(bank), BANK + ' 里没有 blockers：合取条件没有被逐条翻译成人话');
  const models = read(MODELS);
  assert.ok(models.includes('zs-qz-blocked'), MODELS + ' 里没有 .zs-qz-blocked：生成配置没就绪时没有一个可见的说明位');
});

test('未配置供应商时不再把生成按钮永久变灰', () => {
  const models = read(MODELS);
  // 服务端 effectiveWorkers('quiz') 会回落到 lecture 选择、再回落到默认路由，所以
  // 「一行都没配」是合法状态。旧版 rows.length>0 才算 ready，主按钮因此一直灰着。
  assert.ok(/rows\.length\s*===\s*0\s*\|\|/.test(models), MODELS + ' 里没有「一行都没配也算可用」的短路：主按钮会再次永久变灰');
  // 空数组传下去会让服务端 normalizeWorkers([]) 得到 []，反而跳过回落。
  assert.ok(/workers\?\.length\?workers:undefined/.test(models + read(BANK)), '出题调用仍在传空 workers 数组：服务端会用 [] 覆盖掉默认配置');
});

test('生成配置浮窗不会「随便滚一下就关掉」', () => {
  const models = read(MODELS);
  assert.ok(models.length > 1000, MODELS + ' 读不到内容');
  // 不用 doesNotMatch：断言失败时它会把整份源码（两万字符）当 actual 打出来，真正有用
  // 的那一行反而被淹掉。这里只报行号。
  const at = models.search(/addEventListener\(\s*['"]scroll['"]/);
  assert.equal(at, -1, MODELS + ':' + (at < 0 ? '?' : lineAt(models, at)) + ' 仍监听 scroll 关浮窗：用户一滚模型列表，刚改的供应商/并发就全丢了');
});

test('进度栏没有批次时也有内容，不把右栏留成空白', () => {
  const progress = read(PROGRESS);
  assert.ok(progress.includes('zs-qz-gen-empty'), PROGRESS + ' 里没有空态卡：没出过题时右栏首屏是一片空白，用户分不清「这是进度」还是「页面坏了」');
  assert.ok(!/if\(!run\)return null/.test(progress), PROGRESS + ' 仍是 if(!run) return null');
  // 英文枚举直接进 aria-label 会让屏幕阅读器念出 needs-repair 这类内部词。
  assert.ok(!/aria-label=\{t\.state\}/.test(progress), PROGRESS + ' 仍把任务状态原值塞进 aria-label');
  assert.ok(/taskStates/.test(progress), PROGRESS + ' 没有任务状态的中文映射');
});

/* ------------------------------------------------------- 造坏：确认守卫抓得住 */

test('守卫能发现「顶层同名选择器出现两次」', () => {
  const baked = 'body[data-zhiyun] .zs-a {\n  color: var(--zy-text);\n}\nbody[data-zhiyun] .zs-b,\nbody[data-zhiyun] .zs-a {\n  margin: 0;\n}';
  assert.deepEqual(duplicatedSelectors(baked), ['body[data-zhiyun] .zs-a']);
});

test('守卫不把 @media 里的覆盖误判成顶层重复（否则这条断言会被迫删掉）', () => {
  const baked = 'body[data-zhiyun] .zs-a {\n  gap: 8px;\n}\n@media (max-width: 760px) {\n  body[data-zhiyun] .zs-a {\n    gap: 4px;\n  }\n}';
  assert.deepEqual(duplicatedSelectors(baked), []);
});

test('守卫能发现小于 11px 的字号', () => {
  const baked = 'body[data-zhiyun] .zs-a {\n  font-size: 10px;\n}\nbody[data-zhiyun] .zs-b {\n  font-size: 0.5rem;\n}\nbody[data-zhiyun] .zs-c {\n  font-size: 12px;\n}';
  assert.deepEqual(smallFontSizes(baked), ['2:font-size: 10px', '5:font-size: 0.5rem']);
});
