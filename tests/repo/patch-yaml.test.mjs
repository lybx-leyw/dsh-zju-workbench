import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

/**
 * 每个 `cordis.patch.yml` 都必须能被 YAML 解析。
 *
 * # 为什么值得一条常驻测试
 *
 * 宿主解析失败时**不会崩**，只是把那个 bundle 跳过：
 *
 * ```text
 * dsh: failed to parse overlay .../cordis.patch.yml:
 *   YAMLException: bad indentation of a mapping entry (3:13)
 * ```
 *
 * 表现是「插件装了但那一层配置没生效」—— 界面照常、功能静默缺失，
 * 而报错文本完全没提真正原因。
 *
 * # 这个 bug 真的发生过
 *
 * 包改名 `dsh-zju-source-cc98` → `@lybx-leyw/dsh-zju-source-cc98` 之后：
 * `name:` 的值以 **`@` 开头**，而 `@` 是 YAML 的保留字符，裸写非法。
 * 批量改名只换了字符串，没意识到**换进来的字符本身有语法意义**；
 * JS-YAML 报的却是「缩进错误」，把人引向完全无关的方向。
 *
 * 所以这条测试的价值不只是「YAML 合法」，而是把这类**跨格式语义**的错误
 * 挡在提交之前 —— 靠人眼看 diff 是看不出来的。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));
const SKIP = new Set(['node_modules', 'lib', 'vendor', '.git']);

/**
 * 宿主解析 patch 用的 Schema —— **必须与它一致**，否则这条测试在测一个不存在的约束。
 *
 * `dsh-app-boot/lib/index.js` 干的是这件事：
 *
 * ```js
 * :672  const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {kind:'scalar', ...})
 * :680  const entryListSchema = yaml.JSON_SCHEMA.extend(JsExpr)
 * :4743 parsed = yaml.load(content, { schema: userPatchesSchema })
 * ```
 *
 * 也就是说 `!!js` 是宿主**官方支持**的写法，用来表达「按运行时条件禁用某条插件」：
 *
 * ```yaml
 * - id: tool-bash
 *   disabled: !!js process.platform === 'win32'
 * ```
 *
 * DSH 自带的 `dsh-base/cordis.patch.yml` 里用的是一模一样的三个 idiom
 * （`:22/:30/:107/:111` 的 `!!js "!ctx.get('profileContext')"`、
 * `:283` 与 `:287` 的按平台禁用）。本仓 preset 里那三行是照着它抄的，**是对的**。
 *
 * ⚠️ 用 `JSON_SCHEMA` 而**不是** `DEFAULT_SCHEMA`：后者会把 `yes`/`no`/`on`/`off`
 *    解析成布尔、把时间戳解析成 Date —— 宿主不会，那等于换了个解析器再测一遍。
 *    照抄宿主的选择才是「测它真的会怎么读」。
 */
const jsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => data,
});
const HOST_SCHEMA = yaml.JSON_SCHEMA.extend([jsExpr]);

function patchFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { patchFiles(full, out); continue; }
    if (entry.name === 'cordis.patch.yml') out.push(full);
  }
  return out;
}

const files = patchFiles(path.join(root, 'packages'));

test('所有 cordis.patch.yml 都能被 YAML 解析', () => {
  assert.ok(files.length > 50, `只找到 ${files.length} 个 patch 文件，扫描可能失效`);
  const failures = [];
  for (const file of files) {
    try {
      yaml.load(readFileSync(file, 'utf8'), { schema: HOST_SCHEMA });
    } catch (error) {
      failures.push(`${path.relative(root, file)}: ${String(error.message).split('\n')[0]}`);
    }
  }
  // 措辞校正：「静默跳过」并不准确 —— 宿主对 bundle 的 patch 解析失败会记进
  // profile.skippedBundles 并往 stderr 打一行 `dsh: skipping profile bundle …`；
  // 对 profile 自己的 cordis.patch.yml 则直接抛出（硬失败）。
  // 真正的问题是「那层配置没生效」，而不是「一点痕迹都没有」。
  assert.deepEqual(failures, [], `以下 patch 无法解析（宿主会跳过该 bundle 或直接失败）：\n${failures.join('\n')}`);
});

test('name 的值若以 @ 开头，必须显式加引号', () => {
  // 这一条比上一条更具体：它指名道姓地防住本次踩过的坑。
  // `@` 是 YAML 保留字符，裸写非法；而 `dsh-*` 开头的旧包名是合法的，
  // 于是「改名」这一步会把一个合法文件悄悄变成非法文件。
  const offenders = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((line, index) => {
      const match = /^\s*name:\s*(.+)$/.exec(line);
      if (match === null) return;
      const value = match[1].trim();
      if (value.startsWith('@') && !value.startsWith('"') && !value.startsWith("'")) {
        offenders.push(`${path.relative(root, file)}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `以下 name 值需要加引号（@ 是 YAML 保留字符）：\n${offenders.join('\n')}`);
});
