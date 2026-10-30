/**
 * 把 vendor 里的 pipeline.yaml 转成可被 JS 直接 import 的模块。
 *
 * 为什么要有这一步：提示词是出题质量的主要来源，一个字都不能改。
 * 但 JS 不能直接读 YAML（仓库也没有 yaml 依赖），所以用这个脚本
 * 在构建期一次性转换，产出纯 JS 常量。原 yaml 保持只读，转换结果可逐字比对。
 *
 * 用法：node scripts/convert-prompts.mjs <zh|en> <输出目录>
 */
import fs from 'node:fs';
import path from 'node:path';

const lang = process.argv[2] ?? 'zh';
const outDir = process.argv[3] ?? 'packages/dsh-zhiyun-core-question/src/prompts';
const src = path.join(
  'packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor/agents/question/prompts',
  lang,
);

/**
 * 极简 YAML 解析器：只覆盖这几个提示词文件用到的子集。
 *
 * 支持的形状（就是上游实际用的）：
 *   - 顶层 key:                    → 对象键
 *   - key: |-                      → 多行字面量（保留换行，去掉公共缩进）
 *   - key: "text"                  → 单行字符串
 *   - 缩进的 key: value            → 嵌套对象
 *   - 缩进的 "key": value          → 带引号的键（标签里有中文引号场景）
 *
 * 不支持：数组、锚点、多文档 —— 提示词文件里没有，不支持反而更安全。
 */
function parseYaml(text) {
  const lines = text.split(/\r?\n/);
  const root = {};
  // 栈里每项是 {indent, obj}
  const stack = [{ indent: -1, obj: root }];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    // 空行和纯注释跳过（注释不进入提示词）
    if (!raw.trim() || /^\s*#/.test(raw)) { i++; continue; }

    const indent = raw.match(/^ */)[0].length;
    const body = raw.slice(indent);

    const blockMatch = body.match(/^("?[^":]+"?):\s*(\|-|\|\+?|>)\s*$/);
    if (blockMatch) {
      const key = blockMatch[1].replace(/^"|"$/g, '');
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
      // |- 不留尾换行；| 保留一个尾换行。两种都见过，按原语义处理。
      const keepTrailing = blockMatch[2].startsWith('|') && !blockMatch[2].startsWith('|-');
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      stack[stack.length - 1].obj[key] = collected.join('\n') + (keepTrailing ? '\n' : '');
      continue;
    }

    const scalar = body.match(/^("?[^":]+"?):\s*(.*)$/);
    if (scalar) {
      const key = scalar[1].replace(/^"|"$/g, '');
      let value = scalar[2].trim();
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1].obj;
      if (value === '') {
        // 嵌套对象起点
        const child = {};
        parent[key] = child;
        stack.push({ indent, obj: child });
      } else {
        value = value.replace(/^"(.*)"$/s, '$1').replace(/^'(.*)'$/s, '$1');
        parent[key] = value;
      }
      i++;
      continue;
    }
    // 认不出的行直接抛错，宁可失败也不要静默丢提示词
    throw new Error(`无法解析的 YAML 行（第 ${i + 1} 行）：${raw}`);
  }
  return root;
}

const files = fs.readdirSync(src).filter(f => f.endsWith('.yaml'));
const converted = {};
for (const file of files) {
  const key = path.basename(file, '.yaml');
  converted[key] = parseYaml(fs.readFileSync(path.join(src, file), 'utf8'));
}

fs.mkdirSync(outDir, { recursive: true });

// 每个 yaml 产出独立模块，方便按需 import；再产出一个索引
for (const [name, data] of Object.entries(converted)) {
  const file = path.join(outDir, `${name}.js`);
  fs.writeFileSync(file, [
    `/** 自动生成，请勿手改。源文件：vendor/deeptutor/.../prompts/${lang}/${name}.yaml */`,
    `export default ${JSON.stringify(data, null, 2)};`,
    '',
  ].join('\n'));
}

fs.writeFileSync(path.join(outDir, 'index.js'), [
  `/** 自动生成，请勿手改。语言：${lang}。生成脚本：scripts/convert-prompts.mjs */`,
  ...Object.keys(converted).map(n => `export {default as ${n}} from './${n}.js';`),
  '',
  `export const PROMPT_LANGUAGE = ${JSON.stringify(lang)};`,
  '',
].join('\n'));

console.log(JSON.stringify({
  language: lang,
  files: files.length,
  modules: Object.keys(converted),
  outDir,
}, null, 2));
