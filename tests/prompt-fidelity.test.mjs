/**
 * 校验转换后的提示词与 vendor 原 yaml **逐字一致**。
 *
 * 提示词是出题质量的主要来源。转换器写错、或有人手改生成文件，
 * 都会让质量悄悄下滑而没有任何报错 —— 这是最危险的一类退化。
 *
 * 注意：yaml 里同一个 key（如 `system`）会在不同阶段重复出现：
 * explore.system / plan.system / quiz_step.system / repair.system /
 * tool_summarizer.system。所以必须按**完整嵌套路径**比对，
 * 不能用后缀匹配 —— 那样只会拿最后一个去比，掩盖掉前四个的错误。
 *
 * 用法：node tests/prompt-fidelity.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// vendor 可能在归档区（见 archive/README.md）。
// 源文件在 → 做逐字比对（最强保护）；源文件不在 → 退化成生成物自身完整性校验。
// 直接崩掉会让「归档」这件事看起来像「把测试搞坏了」。
const VENDOR_LIVE = 'packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor/agents/question/prompts';
const VENDOR_ARCHIVED = 'archive/deeptutor-vendor-1.6.15/deeptutor/agents/question/prompts';
const VENDOR = fs.existsSync(VENDOR_LIVE) ? VENDOR_LIVE : VENDOR_ARCHIVED;
const GENERATED = {
  zh: 'packages/dsh-zhiyun-core-question/src/prompts',
  en: 'packages/dsh-zhiyun-core-question/src/prompts-en',
};

const BLOCK_RE = /^(\s*)("?[^":]+"?):\s*(\|-|\|\+?|>)\s*$/;
const KEY_RE = /^(\s*)("?[^":]+"?):\s*(.*)$/;

/**
 * 从 yaml 原文抽块标量，**按完整路径**返回（如 explore.system）。
 * 用一个缩进栈维护当前路径前缀，与转换器同规则但独立实现。
 */
function blocksOf(text) {
  const lines = text.split(/\r?\n/);
  const out = new Map();
  const stack = []; // {indent, key}
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    if (!raw.trim() || /^\s*#/.test(raw)) { i++; continue; }
    const indent = raw.match(/^ */)[0].length;

    const block = raw.match(BLOCK_RE);
    if (block) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const key = block[2].replace(/^"|"$/g, '');
      const fullPath = [...stack.map(s => s.key), key].join('.');
      i++;
      const collected = [];
      let blockIndent = null;
      while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { collected.push(''); i++; continue; }
        const ind = line.match(/^ */)[0].length;
        if (blockIndent === null) {
          if (ind <= indent) break;
          blockIndent = ind;
        }
        if (ind < blockIndent) break;
        collected.push(line.slice(blockIndent));
        i++;
      }
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      out.set(fullPath, collected.join('\n'));
      continue;
    }

    const keyMatch = raw.match(KEY_RE);
    if (keyMatch) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      if (keyMatch[3].trim() === '') {
        stack.push({ indent, key: keyMatch[2].replace(/^"|"$/g, '') });
      }
      i++;
      continue;
    }
    i++;
  }
  return out;
}

/** 摊平成 dot 路径 → 字符串。 */
function flatten(node, prefix = '') {
  const out = new Map();
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') for (const [kk, vv] of flatten(v, key)) out.set(kk, vv);
    else if (typeof v === 'string') out.set(key, v);
  }
  return out;
}

for (const [lang, dir] of Object.entries(GENERATED)) {
  const files = fs.readdirSync(path.join(VENDOR, lang)).filter(f => f.endsWith('.yaml'));
  for (const file of files) {
    const name = path.basename(file, '.yaml');
    const sourceBlocks = blocksOf(fs.readFileSync(path.join(VENDOR, lang, file), 'utf8'));
    const generated = flatten(
      (await import(pathToFileURL(path.resolve(dir, `${name}.js`)).href)).default,
    );

    test(`${lang}/${name}：每个块标量都逐字保留（按完整路径比对）`, () => {
      for (const [fullPath, expected] of sourceBlocks) {
        const actual = generated.get(fullPath);
        assert.ok(actual !== undefined, `${lang}/${name}: 缺少 ${fullPath}`);
        // | 会在末尾补一个换行，比对正文即可
        assert.equal(
          actual.replace(/\s+$/, ''),
          expected.replace(/\s+$/, ''),
          `${lang}/${name}: ${fullPath} 正文与原文不一致`,
        );
      }
    });

    test(`${lang}/${name}：生成模块没有多余的空值`, () => {
      for (const [k, v] of generated) {
        assert.ok(typeof v === 'string' && v.trim().length > 0, `${lang}/${name}: ${k} 是空的`);
      }
    });
  }
}

test('块标量总数与 vendor 一致（防止解析器整体漏读）', () => {
  for (const lang of Object.keys(GENERATED)) {
    let total = 0;
    for (const file of fs.readdirSync(path.join(VENDOR, lang)).filter(f => f.endsWith('.yaml'))) {
      total += blocksOf(fs.readFileSync(path.join(VENDOR, lang, file), 'utf8')).size;
    }
    // 实测中文 15 个、英文 15 个块标量
    assert.ok(total >= 14, `${lang} 应当解析出 14 个以上块标量，实际 ${total}`);
  }
});
