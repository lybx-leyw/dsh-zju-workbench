import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 设置分区用到的每个 i18n 键，必须在字典的中英两份里都存在。
 *
 * # 真机踩过
 *
 * 学习通分区改成卡片结构时用了 `t('intro')` 与 `t('statusTitle')`，但字典里
 * 没有这两个键 —— 界面上**直接显示 `intro` / `statusTitle` 这两个词**。
 * 比中文更糟：用户看到的是一串代码标识符。
 *
 * 这类错误的隐蔽性在于：`t()` 的兜底是「返回键名」，所以不会抛错、不会白屏，
 * 只有肉眼看界面才能发现。静态可查，就该在提交前拦住。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));

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

/**
 * 去掉行注释与块注释，避免把注释里的示例代码当成真实调用。
 *
 * 只处理 // 与 /* *\/ 两种；字符串里的这两个序列会被误删，但本仓的字典与
 * 组件代码里没有那种写法，够用即可 —— 这是一条守卫，不是解析器。
 *
 * @param source - 源码文本。
 * @returns 剥掉注释后的文本。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** 从一个 `xx: { ... }` 块里抽出顶层键名。 */
function keysOf(source, locale) {
  const start = new RegExp(`\\b${locale}\\s*:\\s*\\{`).exec(source);
  if (start === null) return null;
  let depth = 0;
  let index = start.index + start[0].length - 1;
  const begin = index + 1;
  for (; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) break; }
  }
  const body = source.slice(begin, index);
  // 键必须处在**对象属性位置**：前面是 `{` / `,` / 换行（可带缩进），
  // 后面是 `:` 再跟值。这样既能覆盖单行字典，又不会把文案里的冒号
  // （`'CC98 is a standalone site: it uses...'`）当成键。
  const keys = new Set();
  for (const m of body.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:\s*['"`{]/gm)) keys.add(m[1]);
  return keys;
}

const files = clientFiles(path.join(root, 'packages'));

test('t() 用到的键必须在 zh / en 字典里都有', () => {
  const problems = [];
  for (const file of files) {
    const rel = path.relative(root, file).replaceAll('\\', '/');
    const source = readFileSync(file, 'utf8');
    if (!source.includes('registerText(')) continue;   // 不走 i18n 的文件跳过
    const zh = keysOf(source, 'zh');
    const en = keysOf(source, 'en');
    if (zh === null || en === null) { problems.push(`${rel}: 找不到 zh 或 en 字典`); continue; }
    // 组件里所有 t('xxx') 的键。**先剥掉注释** —— 头注释里常有
    // 「键名与 `t('…')` 一一对应」这种示例，不剥会把它当成真实调用。
    const code = stripComments(source);
    const used = new Set([...code.matchAll(/\bt\(\s*'([^']+)'\s*\)/g)].map(m => m[1]));
    for (const key of used) {
      if (!zh.has(key)) problems.push(`${rel}: zh 缺 '${key}'`);
      if (!en.has(key)) problems.push(`${rel}: en 缺 '${key}'`);
    }
  }
  assert.deepEqual(problems, [], `界面上会直接显示键名（t() 的兜底是返回键名，不会报错）：\n${problems.join('\n')}`);
});

test('zh 与 en 的键集合必须一致（防止一边漏翻）', () => {
  const problems = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('registerText(')) continue;
    const zh = keysOf(source, 'zh');
    const en = keysOf(source, 'en');
    if (zh === null || en === null) continue;
    const rel = path.relative(root, file).replaceAll('\\', '/');
    for (const key of zh) if (!en.has(key)) problems.push(`${rel}: en 缺 '${key}'（zh 有）`);
    for (const key of en) if (!zh.has(key)) problems.push(`${rel}: zh 缺 '${key}'（en 有）`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});
