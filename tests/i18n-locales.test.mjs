import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 每个设置分区的字典必须提供**全部 8 种语言**，且键集合与 `en` 一致。
 *
 * # 为什么是 8 种
 *
 * `.ref` 里官方每个插件注册的都是：
 *   ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt })
 *
 * 宿主 `translate()` 查不到当前语言时会回退到 `en`，再查不到**返回键名**。
 * 所以「某语言缺某个键」的表现是界面上显示 `passwordHintKeep` 这样的标识符 ——
 * 不报错、不白屏，只有切到那种语言才看得见。
 *
 * # 真机踩过
 *
 * 起初只有 zh/en，用户切到界面以外才发现官方支持 8 种。
 * 后来又出现「加了 ja 但漏了某个键」—— 都是同一类静默失败。
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const LANGS = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'];

function clientFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'lib') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { clientFiles(full, out); continue; }
    if (entry.name === 'client.jsx') out.push(full);
  }
  return out;
}

/** 抽出一个 `locale: {...}` 块的键集合（只认对象属性位置的键）。 */
function keysOf(source, locale) {
  const start = new RegExp(`\\b${locale}\\s*:\\s*\\{`).exec(source);
  if (start === null) return null;
  let depth = 0;
  let i = source.indexOf('{', start.index);
  const begin = i + 1;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = source.slice(begin, i);
  const out = new Set();
  const re = /(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:\s*(?:'([^'\\]|\\.)*'|`([^`\\]|\\.)*`)/gm;
  for (const m of body.matchAll(re)) out.add(m[1]);
  return out;
}

const files = clientFiles(path.join(root, 'packages'));

test('每个设置分区的字典提供全部 8 种语言', () => {
  const problems = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('registerText(')) continue;
    const rel = path.relative(root, file).replaceAll('\\', '/');
    for (const lang of LANGS) {
      if (keysOf(source, lang) === null) problems.push(`${rel}: 缺 ${lang} 字典`);
    }
  }
  assert.deepEqual(problems, [], `官方插件提供 zh/en/ja/es/fr/de/ru/pt 八种：\n${problems.join('\n')}`);
});

test('8 种语言的键集合与 en 完全一致', () => {
  const problems = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('registerText(')) continue;
    const rel = path.relative(root, file).replaceAll('\\', '/');
    const en = keysOf(source, 'en');
    if (en === null) continue;
    for (const lang of LANGS) {
      const dict = keysOf(source, lang);
      if (dict === null) continue;   // 上一条测试已报
      const missing = [...en].filter(k => !dict.has(k));
      const extra = [...dict].filter(k => !en.has(k));
      if (missing.length > 0) problems.push(`${rel} ${lang} 缺: ${missing.join(', ')}`);
      if (extra.length > 0) problems.push(`${rel} ${lang} 多: ${extra.join(', ')}`);
    }
  }
  assert.deepEqual(problems, [], `缺键时界面显示键名本身，不报错：\n${problems.join('\n')}`);
});
