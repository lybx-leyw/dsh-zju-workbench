#!/usr/bin/env node
// 工效学 / 可访问性静态检查（零依赖）。
//
// 检查四类：
//   1. 中文最小字号（<11px 报错；11px 仅提示）
//   2. 关键颜色 token 的对比度（浅色/深色分别算，正文 4.5:1）
//   3. 交互元素的最小高度（<24px 警告）
//   4. :focus-visible 覆盖量（仅统计，不判错）
//
// 用法：node scripts/check-hf.mjs
// 退出码：有 error → 1，否则 0。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const PKG_DIR = path.join(ROOT, 'packages');
const SHELL_CSS = path.join(PKG_DIR, 'dsh-zhiyun-shell-workbench', 'src', 'style.css');

const errors = [];
const warns = [];
const infos = [];

const rel = (p) => path.relative(ROOT, p);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      walk(full, out);
    } else if (name.endsWith('.css')) {
      out.push(full);
    }
  }
  return out;
}

// ── 1. 字号 ────────────────────────────────────────────────────────────
const cssFiles = walk(PKG_DIR);
let tiny = 0;
let meta11 = 0;
for (const file of cssFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /font-size:\s*([\d.]+)px/g;
  let m;
  while ((m = re.exec(text))) {
    const px = Number(m[1]);
    if (px < 11) {
      tiny += 1;
      const line = text.slice(0, m.index).split('\n').length;
      errors.push(`字号 ${px}px < 11px：${rel(file)}:${line}`);
    } else if (px === 11) {
      meta11 += 1;
    }
  }
}
if (tiny === 0) infos.push('字号：没有 <11px 的声明');
if (meta11 > 0) infos.push(`字号：${meta11} 处 11px（仅可用于非关键信息，需 ≥4.5:1）`);

// ── 2. 对比度 ──────────────────────────────────────────────────────────
function luminance(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function parseTokens(block) {
  const out = {};
  const re = /--zy-([a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g;
  let m;
  while ((m = re.exec(block))) out[m[1]] = m[2];
  return out;
}

if (!fs.existsSync(SHELL_CSS)) {
  errors.push(`找不到 shell 样式表：${rel(SHELL_CSS)}`);
} else {
  const css = fs.readFileSync(SHELL_CSS, 'utf8');
  const parts = css.split('body[data-zhiyun][data-ds-dark-theme]');
  const themes = [
    ['浅色', parseTokens(parts[0] || '')],
    ['深色', parseTokens(parts[1] || '')],
  ];
  const pairs = [
    ['text', 'bg', 4.5],
    ['text', 'surface', 4.5],
    ['secondary', 'bg', 4.5],
    ['muted', 'bg', 4.5],
    ['muted', 'surface', 4.5],
  ];
  for (const [name, t] of themes) {
    for (const [fg, bg, min] of pairs) {
      const f = t[fg];
      const b = t[bg];
      if (!f || !b) continue;
      const r = ratio(f, b);
      const label = `${name} ${fg}/${bg} = ${r.toFixed(2)}:1`;
      if (r < min) errors.push(`对比度不足：${label}（需 ≥${min}）`);
      else infos.push(`对比度 ✓ ${label}`);
    }
  }
}

// ── 3. 交互目标尺寸 ────────────────────────────────────────────────────
const interactive = /(button|rail|tab|switch|input|checkbox|radio)/i;
for (const file of cssFiles) {
  const text = fs.readFileSync(file, 'utf8');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(text))) {
    const selector = m[1];
    const body = m[2];
    if (!interactive.test(selector)) continue;
    // 伪元素、装饰图标、分隔线不是交互目标，跳过（避免误报）。
    if (/::?(?:before|after)|\bsvg\b|divider|separator/i.test(selector)) continue;
    const h = body.match(/(?:min-height|height):\s*(\d+)px/);
    if (h && Number(h[1]) < 24) {
      const line = text.slice(0, m.index).split('\n').length;
      warns.push(`目标 <24px（${h[1]}px）：${rel(file)}:${line} ${selector.trim().slice(0, 60)}`);
    }
  }
}

// ── 4. focus-visible 覆盖 ──────────────────────────────────────────────
let focusCount = 0;
let buttonSelectors = 0;
for (const file of cssFiles) {
  const text = fs.readFileSync(file, 'utf8');
  focusCount += (text.match(/:focus-visible/g) || []).length;
  buttonSelectors += (text.match(/(?:^|[\s,])button(?:[\s,{:.[])/gm) || []).length;
}
infos.push(`focus-visible：${focusCount} 处 / 含 button 的选择器 ${buttonSelectors} 处`);
if (focusCount === 0) warns.push('没有任何 :focus-visible 规则');

// ── 输出 ───────────────────────────────────────────────────────────────
console.log(`[check-hf] 扫描 ${cssFiles.length} 个样式表`);
if (infos.length) {
  console.log('\n— 信息 —');
  for (const i of infos) console.log(`  · ${i}`);
}
if (warns.length) {
  console.log('\n— 警告 —');
  for (const w of warns) console.log(`  ⚠ ${w}`);
}
if (errors.length) {
  console.log('\n— 错误 —');
  for (const e of errors) console.log(`  ✗ ${e}`);
  console.log(`\n[check-hf] 失败：${errors.length} 个错误、${warns.length} 个警告`);
  process.exit(1);
}
console.log(`\n[check-hf] 通过：0 个错误、${warns.length} 个警告`);
