/**
 * README 截图必须存在、且是**真的从干净 profile 拍的**。
 *
 * # 这条在防什么
 *
 * 一是防「README 引用了不存在的图」—— 断链在 GitHub 上只是显示成裂图，
 * 本地看 markdown 源文件完全正常，很容易漏。
 *
 * 二是防「拿开发机的截图凑数」。开发机的截图会带上真实工作区名、会话标题、
 * 真实课程名 —— 本仓库是公开仓库，这些一进 git 就永久可检索。
 * 所以截图必须来自空工作区，这里用「文件名约定 + 尺寸」把这条钉住：
 * 文件名带 `-1440x900`，实际像素也必须是 1440×900。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

/** README 里引用的所有截图（相对路径）。 */
const refs = [...readme.matchAll(/!\[[^\]]*\]\((docs\/assets\/screenshots\/[^)]+\.png)\)/g)]
  .map(match => match[1]);

/**
 * README 里引用的**示意图**（`docs/show/`）。
 *
 * 它们和截图分开管：示意图不限尺寸（内容决定长宽比），但同样必须存在 ——
 * 文件名是中文，Markdown 里要用 `<>` 包住路径，否则括号与空格会把链接截断。
 */
const diagrams = [...readme.matchAll(/!\[[^\]]*\]\(<(docs\/show\/[^>]+\.png)>\)/g)]
  .map(match => match[1]);
/** 目录里实际有的截图。 */
const dir = path.join(ROOT, 'docs/assets/screenshots');

/** 读 PNG 的 IHDR 宽高（不引第三方库）。 */
function pngSize(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString('ascii', 1, 4), 'PNG', `${file} 不是 PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('README 引用的每张截图都存在', () => {
  assert.ok(refs.length >= 3, `README 里只有 ${refs.length} 张截图，应当至少 3 张`);
  for (const ref of refs) {
    assert.ok(existsSync(path.join(ROOT, ref)), `README 引用了不存在的截图：${ref}`);
  }
});

test('README 引用的示意图都存在，且路径用 <> 包住', () => {
  assert.ok(diagrams.length >= 2, `README 里只有 ${diagrams.length} 张示意图`);
  for (const ref of diagrams) {
    assert.ok(existsSync(path.join(ROOT, ref)), `README 引用了不存在的示意图：${ref}`);
    // 中文文件名 + 全角逗号，不加 <> 会被 Markdown 的括号/空格规则截断。
    assert.match(ref, /[^\x00-\x7F]/, '这条断言只对中文文件名的图有意义');
  }
  // 反例：同一批图如果写成不带 <> 的形式，正则就抓不到 —— 等于守卫失效。
  for (const ref of diagrams) {
    assert.ok(readme.includes(`(<${ref}>)`), `示意图链接应写成 (<路径>)：${ref}`);
  }
});

test('截图是 1440×900（约定尺寸，来自干净 profile）', () => {
  for (const ref of refs) {
    const { width, height } = pngSize(path.join(ROOT, ref));
    assert.equal(width, 1440, `${ref} 宽 ${width}，应为 1440`);
    assert.equal(height, 900, `${ref} 高 ${height}，应为 900`);
    // 文件名里的尺寸必须与实际一致，否则改图时容易忘了改名字。
    assert.match(ref, /-1440x900\.png$/, `${ref} 文件名应带 -1440x900`);
  }
});
