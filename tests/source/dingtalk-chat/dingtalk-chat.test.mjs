/**
 * 钉钉聊天包的**包级守卫**。
 *
 * # 它守什么
 *
 * 这个包与其它 source 包形态不同：它**不是 Cordis 插件**，是一个带着
 * `SKILL.md` + 自己的 `package.json` / `tsconfig.json` + CLI 脚本的独立 agent skill
 * （上游 `zju-assistant/core/dingtalk/` 就是这个形态，移植时按要求原样保留）。
 * 形态不同，`source-settings.test.mjs` / `source-error-contract.test.mjs` 那类
 * 「有没有 `src/client.jsx` / `apply()`」的守卫就**不适用**，于是它需要自己这几条。
 *
 * # 为什么这些断言值得常驻
 *
 * 1. **`SKILL.md` 的 frontmatter**：宿主靠 `name` / `description` 决定这个 skill 会不会
 *    被选中。写成空、写漏、或者在 frontmatter 上方多出空行（YAML 前置块就不再是
 *    文件开头），表现是「skill 装了但从来不触发」—— 没有任何报错。
 * 2. **能力声明与代码一致**：`network: none` 是**可以核对的**，不能只当声明。
 *    下面直接扫源码里的网络与写操作 import。
 * 3. **上游形态必须保留**：`bin` / `engines` / `devDependencies` 与 `.ts` 源码。
 *    转译成 `.js` 或改写成 `apply(ctx)` 会让它偏离上游，之后每次升级都要重新对照。
 * 4. **隐私**：真实聊天内容、明文数据库、查询日志都不许出现在这个包里。
 *
 * # 它拦不住什么（如实说明）
 *
 * - 只做静态扫描与存在性检查，不证明「真的能读出聊天」—— 那要真实数据库，见
 *   `packages/source/dingtalk-chat/tests/database.test.ts` 的版本门控。
 * - `network: none` 的扫描基于 import 说明符，动态 `import()` 与原生插件调用不在范围内。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const PKG = path.join(root, 'packages', 'source', 'dingtalk-chat');
const SKILL = path.join(PKG, 'SKILL.md');

const read = (relative) => readFileSync(path.join(PKG, relative), 'utf8');

/** 包内全部文本源文件（`.ts` / `.mjs` / `.json`），用于静态扫描。 */
function sourceFiles(dir = PKG, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'tests') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { sourceFiles(full, out); continue; }
    if (/\.(?:ts|mjs|js|json)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 剥注释：说明性文字里会提到被禁止的写法（本文档自己就提到 `apply(ctx)`）。 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('SKILL.md 存在，frontmatter 是文件开头且含 name / description', () => {
  assert.ok(existsSync(SKILL), 'SKILL.md 必须存在 —— 宿主靠它发现这个 skill');
  const text = readFileSync(SKILL, 'utf8');

  // frontmatter 必须是文件**第一行**。前面哪怕空一行，`---` 就不再是 YAML 前置块，
  // 宿主会把它当正文，`name` / `description` 随之消失。
  assert.ok(text.startsWith('---\n'), 'SKILL.md 必须以 `---` 紧贴文件开头（前面不能有空行或注释）');

  const end = text.indexOf('\n---', 3);
  assert.ok(end > 0, 'frontmatter 没有闭合的 `---`');
  const frontmatter = text.slice(4, end);

  const values = new Map();
  for (const line of frontmatter.split('\n')) {
    const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (match === null) continue;
    values.set(match[1], match[2].trim());
  }

  assert.ok(values.has('name'), 'frontmatter 缺 name');
  assert.ok(values.has('description'), 'frontmatter 缺 description');
  assert.ok((values.get('name') ?? '').length > 0, 'frontmatter 的 name 不能为空');
  assert.ok((values.get('description') ?? '').length > 0, 'frontmatter 的 description 不能为空');
  // description 是 skill 被选中的唯一线索，太短等于没写。
  assert.ok((values.get('description') ?? '').length >= 20, 'description 太短，无法据此判断何时该用这个 skill');
  // name 只写小写与连字符：它同时是 skill 的标识，混入大写或空格会让引用不稳定。
  assert.match(values.get('name') ?? '', /^[a-z0-9][a-z0-9-]*$/, 'name 只能是小写字母、数字与连字符');
  // 「只读、不联网、不发消息」是 this skill 的边界，必须写在 description 里，
  // 否则模型可能以为它能发钉钉消息。
  assert.match(values.get('description') ?? '', /只读/, 'description 必须写明「只读」');
});

test('保留上游 skill 形态：不改成 Cordis 插件', () => {
  const manifest = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8'));

  // 上游的 bin / devDependencies 原样保留 —— 这是「无损融合」的判据。
  assert.equal(manifest.bin?.dingtalk, 'scripts/dingtalk.ts', 'bin 必须仍指向上游的 .ts 入口');
  // engines 是**有意的偏离**：上游写 `>=24`，但 `DatabaseSync.serialize/deserialize`
  // 是 Node 24.16.0 才加的（实测 24.11.1 上两者都是 undefined），而本包的
  // `snapshot()` 依赖 `db.deserialize(plain)`。留 `>=24` 会让 24.11–24.15 的用户
  // 拿到「数据格式未能解析」这种完全指错方向的报错。
  assert.equal(manifest.engines?.node, '>=24.16.0', 'engines 收紧到 deserialize 的真实下限');
  assert.ok(manifest.devDependencies?.['@types/node'], 'devDependencies 应保留 @types/node');
  assert.ok(manifest.devDependencies?.typescript, 'devDependencies 应保留 typescript');
  // `.ts` 靠 Node 24 的 type stripping 直接跑，测试脚本也照上游这么写。
  assert.equal(manifest.scripts?.test, 'node --test tests/*.test.ts', 'test 脚本应沿用上游的 .ts 直跑');

  // 不能是 Cordis 插件：没有 apply(ctx) 宿主入口、没有 main、没有 client 半边。
  assert.equal(manifest.main, undefined, '本包没有 Cordis 宿主入口，不该声明 main');
  assert.equal(manifest.dsh?.client, undefined, '本包没有客户端半边');
  assert.equal(manifest.exports, undefined, '本包不做 npm 出口，只做 CLI + skill');

  // 入口是 CLI 脚本，不是 apply(ctx)。
  assert.ok(existsSync(path.join(PKG, 'scripts', 'dingtalk.ts')), '缺少 CLI 入口 scripts/dingtalk.ts');
  assert.ok(existsSync(path.join(PKG, 'scripts', 'dingtalk.mjs')), '缺少应用入口 scripts/dingtalk.mjs');

  // 移植保留 `.ts`，不转译成 `.js` —— 上游六个模块都要在。
  for (const name of ['chat', 'cli', 'content', 'database', 'errors', 'values']) {
    assert.ok(existsSync(path.join(PKG, 'lib', `${name}.ts`)), `缺少上游模块 lib/${name}.ts`);
    assert.ok(!existsSync(path.join(PKG, 'lib', `${name}.js`)), `lib/${name}.js 不该存在（本包保留 .ts，不转译）`);
  }

  // 上游的两个测试文件与 references/ 都要在。
  assert.ok(existsSync(path.join(PKG, 'tests', 'chat.test.ts')), '缺少移植的 tests/chat.test.ts');
  assert.ok(existsSync(path.join(PKG, 'tests', 'database.test.ts')), '缺少移植的 tests/database.test.ts');
  assert.ok(existsSync(path.join(PKG, 'references', 'local.md')), 'references/local.md 是给使用者的路径说明，不能删');

  // 文档齐全：README 面向维护者，ATTRIBUTION 记录上游来源。
  for (const name of ['README.md', 'ATTRIBUTION.md', 'OWNERS']) {
    assert.ok(existsSync(path.join(PKG, name)), `缺少 ${name}`);
  }
});

test('能力声明与代码一致：network none、writes false、无 Cordis 服务', () => {
  const manifest = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  const capability = manifest.dsh?.capability;
  assert.ok(capability !== undefined, '缺少 dsh.capability');
  assert.equal(capability.tier, 1, '业务数据源是 tier 1');
  assert.equal(capability.auth, 'none', '本机读取不需要任何登录');
  assert.equal(capability.network, 'none', '纯本机操作，不联网');
  assert.equal(capability.writes, false, '只读');
  assert.deepEqual(capability.requires, [], '不依赖任何本仓包');

  // 声明「不联网」就要真的没有网络 import。node:sqlite / node:crypto / node:fs
  // 都是本地的；http / https / net / dns / tls / undici 一个都不该出现。
  const NETWORK = /from\s+['"]node:(?:http2?|https|net|tls|dns|dgram)['"]|from\s+['"](?:undici|axios|node-fetch)['"]|\bfetch\s*\(/;
  const offenders = [];
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (NETWORK.test(code)) offenders.push(path.relative(PKG, file));
  }
  assert.deepEqual(offenders, [], `这些文件引用了网络能力，与 network: none 矛盾：\n${offenders.join('\n')}`);

  // 声明「只读」就要真的没有写操作：不允许出现写文件的 fs 入口。
  const WRITE = /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream|rmSync|rm|unlink|unlinkSync|renameSync|mkdirSync|copyFileSync)\b|openSync\([^)]*['"][wa]/;
  const writers = [];
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (WRITE.test(code)) writers.push(path.relative(PKG, file));
  }
  // 测试里写临时文件是正常的（夹具），所以只扫运行时代码；这里已经跳过 tests/。
  assert.deepEqual(writers, [], `这些文件有写操作，与 writes: false 矛盾：\n${writers.join('\n')}`);

  // 不是 Cordis 插件：不许出现 apply / ctx.provide / ctx.inject 这类装配入口。
  const cordis = [];
  for (const file of sourceFiles().filter(name => /\.(?:ts|mjs)$/.test(name) && name.includes(`${path.sep}lib${path.sep}`))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    if (/\bctx\s*\.\s*(?:provide|inject|effect|tools)\b/.test(code)) cordis.push(path.relative(PKG, file));
  }
  assert.deepEqual(cordis, [], `lib/ 里出现了 Cordis 装配调用，应按要求保持 skill 形态：\n${cordis.join('\n')}`);
});

/**
 * skill 包**不该**有 cordis.patch.yml。
 *
 * # 为什么这条是反过来的
 *
 * 本包是 **agent skill**（`SKILL.md` + `bin` CLI），不是 Cordis 插件：没有 `main`、
 * 没有 `exports`、没有 `apply(ctx)`。
 *
 * 而 `cordis.patch.yml` 的作用是往 profile 里 insert 一条 loader row，宿主会去
 * `import` 那个包名 —— 对 skill 包必然 `ERR_MODULE_NOT_FOUND`。最坏情况是
 * 启动时抛 `invalid plugin` 而 `Entry._init()` 只记日志、**不阻止启动**，
 * 于是「启动正常、这行静默失效」，排查起来极费劲。
 *
 * 所以这里断言 patch **不存在**，而不是断言它格式正确。
 */
test('没有 cordis.patch.yml：本包是 skill 不是 Cordis 插件', () => {
  const manifest = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8'));
  assert.equal(existsSync(path.join(PKG, 'cordis.patch.yml')), false, 'skill 包不该有 cordis.patch.yml');
  assert.equal(manifest.dsh?.bundle, undefined, 'skill 包不该声明 dsh.bundle');
  assert.equal(manifest.files.includes('cordis.patch.yml'), false, 'files 不该列 cordis.patch.yml');
  // 反过来钉住 skill 形态的三个特征。
  assert.equal(manifest.main, undefined, 'skill 包没有 main');
  assert.equal(manifest.exports, undefined, 'skill 包没有 exports');
  assert.ok(manifest.bin && typeof manifest.bin.dingtalk === 'string', 'skill 包靠 bin 提供 CLI');
  for (const entry of ['SKILL.md', 'lib/', 'scripts/', 'references/']) {
    assert.ok(manifest.files.includes(entry), `files 必须包含 ${entry}`);
  }
});

test('仓库里没有真实聊天数据：无数据库副本、无明文导出', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      // 数据库与 WAL 副本：本包只读内存快照，任何 .db / .sqlite / -wal 都不该落进仓库。
      if (/\.(?:db|sqlite|sqlite3)(?:-wal|-shm)?$/.test(entry.name)) offenders.push(`${path.relative(PKG, full)}（数据库副本）`);
      if (/\.(?:json|md|ts|mjs)$/.test(entry.name)) {
        const text = readFileSync(full, 'utf8');
        // 打包好的钉钉查询输出（`ok` + `messages`）落到仓库里就是真实聊天内容。
        if (/"coverage"\s*:\s*"local_synced"/.test(text) && /"messages"\s*:/.test(text)) offenders.push(`${path.relative(PKG, full)}（像是真实查询输出）`);
      }
    }
  };
  walk(PKG);
  assert.deepEqual(offenders, [], `这些文件疑似含真实聊天数据，不能进公开仓库：\n${offenders.join('\n')}`);
});

test('包内 .gitignore 把 lib/ 从根规则的「构建产物」排除里捞回来', () => {
  // 根 `.gitignore` 有 `packages/*/*/lib/`，本意是忽略 `npm run build` 的产物。
  // 但本包的 `lib/` 是**手写源码**，没有任何构建步骤会重新生成它。
  // 少了这条否定规则，文件在磁盘上、测试也跑得通，`git status` 却看不见它们 ——
  // 一提交就少半个包，而且本地一切正常。
  const ignore = readFileSync(path.join(PKG, '.gitignore'), 'utf8');
  const lines = ignore.split(/\r?\n/).map(line => line.trim());
  assert.ok(lines.includes('!lib/'), '.gitignore 必须有 `!lib/`（否则 lib/ 会被根规则静默忽略）');
  // 上游那三条也不该被这次改动冲掉。
  for (const rule of ['node_modules/', '*.db*', '*.sqlite*']) {
    assert.ok(lines.includes(rule), `.gitignore 应保留上游的 \`${rule}\``);
  }
});
