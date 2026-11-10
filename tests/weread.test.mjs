import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

/**
 * `packages/source/weread/` 的仓库级守卫。
 *
 * # 为什么这个包需要单独一条守卫
 *
 * 它是本仓唯一一个**保留上游 agent skill 形态**的 source 包 —— 没有
 * `src/index.js`、没有 `src/client.jsx`、入口是 CLI 脚本。所以
 * `tests/source-capability.test.mjs` 那条「代码里的裸 import 都被 requires 覆盖」
 * 对它是**空转的**：那个扫描器只看 `src/**`，而本包的代码全在 `lib/`、`scripts/`。
 *
 * 也就是说：**这个包的声明与代码是否一致，没有任何既有守卫在看。**
 * 这条文件补上这个缺口，并钉死几件一旦漏掉就会静默出事的事：
 *
 * 1. **`lib/` 必须真的在版本控制里。** 根 `.gitignore` 里有两条匹配
 *    `packages/<分组>/<包>/lib/` 的规则（本意是构建产物），会把这个包的
 *    **源码目录**整目录吞掉。症状极隐蔽：文件在磁盘上、`node --test` 也跑得通，
 *    但 `git status` 看不见，一提交就少整个 `lib/`，包直接不可用且没有报错。 * 2. **两份许可文件必须在、且逐字未改。** `LICENSE-Tencent`（腾讯的 Apache-2.0
 *    声明）与 `THIRD_PARTY_NOTICES.txt`（MIT）各自对应一条再分发义务。
 * 3. **`lib/` 与上游 vendored 副本逐字节相同。** 这是「无损融合」的可核对形式：
 *    上游就在同一个仓库里，直接做哈希比对，比记一份会过期的清单可靠。
 * 4. **Electron 必须留在 `optionalDependencies`。** 它「可选」不等于「可以删」——
 *    `lib/browser/*` 与 `lib/captcha/electron.mjs` 全靠它。
 *
 * # 它拦不住什么（如实说明）
 *
 * 只做静态检查：`lib/` 里的实现是否**正确**，靠包内 `tests/*.test.ts` 与
 * `*.test.mjs`（本机 27 过 / 18 跳过，均为缺少依赖或 Electron）；真实公众号文章、真实登录、
 * 真实 Electron 启动，本仓**都没有验证过**，这条也不会替它们背书。
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const PKG = path.join(root, 'packages', 'source', 'weread');
const UPSTREAM = path.join(root, 'packages', 'vendor', 'zju-assistant', 'core', 'weread');

const manifest = JSON.parse(readFileSync(path.join(PKG, 'package.json'), 'utf8'));

test('weread：包目录存在且保留了上游 skill 的形态', () => {
  for (const name of ['SKILL.md', 'tsconfig.json', 'LICENSE-Tencent', 'THIRD_PARTY_NOTICES.txt', 'package.json']) {
    assert.ok(existsSync(path.join(PKG, name)), `缺 ${name}`);
  }
  // CLI 入口是**上游形态的核心**：这个包不是 Cordis 插件，它是个能被 spawn 的脚本。
  assert.equal(manifest.bin?.weread, 'scripts/weread.ts');
  assert.ok(existsSync(path.join(PKG, 'scripts', 'weread.ts')), 'CLI 入口文件不在');
  // 反过来，它**不该**有插件形态的那些东西 —— 有的话说明有人把它改写了。
  assert.equal(manifest.main, undefined, '本包是 skill，不该有 main');
  assert.equal(manifest.exports, undefined, '本包是 skill，不该有 exports');
  assert.ok(!existsSync(path.join(PKG, 'src', 'index.js')), '本包不该有 src/index.js');
  assert.ok(!existsSync(path.join(PKG, 'src', 'client.jsx')), '本包不该有 src/client.jsx');
});

test('weread：capability 声明合法，且与「不写、抓公网网页」的事实一致', () => {
  const cap = manifest.dsh?.capability;
  assert.ok(cap !== undefined, '缺 dsh.capability');
  assert.equal(cap.tier, 1);
  assert.equal(cap.auth, 'none', '微信读书扫码登录不是本仓的凭据体系');
  assert.equal(cap.network, 'public', '抓的是公网网页（mp.weixin.qq.com / weread.qq.com）');
  assert.equal(cap.writes, false, '本包不做任何写操作');
  assert.deepEqual(cap.requires, [], '不依赖本仓其它 source 包（自成一体）');
  // 声明与依赖图一致：没有任何 @lybx-leyw 前缀的运行时依赖。
  for (const section of ['dependencies', 'optionalDependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      assert.ok(!name.startsWith('@lybx-leyw/'), `${section} 里出现了本仓包 ${name}，requires 却没写`);
    }
  }
});

test('weread：Electron 留在 optionalDependencies 且版本被钉住', () => {
  // 「可选」指的是**装不上也能加载模块**（惰性 require），不是「可以删掉」。
  // lib/browser/{host.cjs,service.cjs,runtime.ts} 与 lib/captcha/electron.mjs 全靠它。
  assert.deepEqual(manifest.optionalDependencies, { electron: '44.10.1' },
    'electron 必须是 optionalDependencies 里的精确版本');
  assert.equal(manifest.dependencies?.electron, undefined,
    'electron 不该升成必需依赖 —— 那会让 npm install 在没有 GUI 的环境里直接失败');
});

test('weread：两份许可文件逐字未改（与上游副本比对）', () => {
  // 任务书要求这两份**逐字保留**。上游副本就在同一个仓库里，直接比对即可。
  if (!existsSync(UPSTREAM)) return;   // 上游副本不在时跳过（它对发布产物没有意义）
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  for (const name of ['LICENSE-Tencent', 'THIRD_PARTY_NOTICES.txt']) {
    assert.ok(existsSync(path.join(PKG, name)), `缺 ${name}`);
    assert.ok(statSync(path.join(PKG, name)).size > 0, `${name} 是空文件`);
    assert.equal(digest(path.join(PKG, name)), digest(path.join(UPSTREAM, name)),
      `${name} 被改动了（要求逐字保留）`);
  }
});

test('weread：LICENSE-Tencent 保留了 Apache-2.0 的关键声明', () => {
  const text = readFileSync(path.join(PKG, 'LICENSE-Tencent'), 'utf8');
  // 不比对整份哈希之外的措辞：这里钉的是**这几句还在**，逐字要求由上一条保证。
  assert.match(text, /Tencent is pleased to support the open source community by making WeChatReading available\./);
  assert.match(text, /Copyright \(C\) 2026 Tencent\. All rights reserved\./);
  assert.match(text, /WeChatReading is licensed under Apache-2\.0\./);
  assert.match(text, /END OF TERMS AND CONDITIONS/);
});

test('weread：lib/ 的 15 个文件与上游逐字节相同', () => {
  if (!existsSync(UPSTREAM)) return;
  const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
  const seen = [];
  const walk = (dir, base = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { walk(path.join(dir, entry.name), rel); continue; }
      seen.push(`lib/${rel}`);
      const there = path.join(UPSTREAM, 'lib', rel);
      assert.ok(existsSync(there), `上游没有 lib/${rel}`);
      assert.equal(digest(path.join(dir, entry.name)), digest(there), `lib/${rel} 与上游不一致`);
    }
  };
  walk(path.join(PKG, 'lib'));
  // 15 这个数字是核对过的：6 个顶层 + article/ 1 + browser/ 4 + captcha/ 4。
  // 加文件是允许的，但必须是**有意的**；这条断言让「多出来一个文件」也需要解释。
  assert.equal(seen.length, 15, `lib/ 下文件数变了（现 ${seen.length}）：${seen.join(', ')}`);
});

test('weread：8 个上游测试文件与 4 个夹具都在', () => {
  const tests = readdirSync(path.join(PKG, 'tests')).filter(name => /\.test\.(ts|mjs)$/.test(name)).sort();
  assert.deepEqual(tests, [
    'article.test.ts',
    'browser-runtime.test.ts',
    'captcha-electron.test.mjs',
    'captcha-pta.test.mjs',
    'captcha-recognizer.test.mjs',
    'cli.test.ts',
    'meta.test.mjs',
    'sources.test.ts',
    'web.test.ts',
  ], '上游 8 个测试文件必须都在（meta.test.mjs 是本仓新增）');
  const fixtures = readdirSync(path.join(PKG, 'tests', 'fixtures')).sort();
  assert.deepEqual(fixtures, ['article-page.cjs', 'captcha-frame.cjs', 'hosted.cjs', 'pta-slider.mjs']);
});

test('weread：lib/ 不会被根 .gitignore 静默吞掉', () => {
  // 这条不调 git（测试环境不保证有 git），而是**复现判定规则**：
  // 根 .gitignore 里有两条 `packages/.../lib/` 规则（构建产物），
  // 本包必须有自己的 `.gitignore` 且含 `!lib/` 才能反白名单化。
  //
  // ⚠️ 这条只能证明「本包声明了反白名单」，不能证明 git 真的放行了
  //    （Windows junction / core.excludesFile 等因素不在测试范围内）。
  //    真正的验证命令写在包内 README，手动跑一次即可：
  //      git check-ignore packages/source/weread/lib/article.ts   → 退出码必须是 1
  const local = path.join(PKG, '.gitignore');
  assert.ok(existsSync(local), '本包缺 .gitignore —— 整个 lib/ 会被根规则吞掉');
  const text = readFileSync(local, 'utf8');
  assert.match(text, /^!lib\/$/m, ".gitignore 里必须有独立的 `!lib/` 一行");

  const rootIgnore = readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(rootIgnore, /^packages\/\*\/\*\/lib\/$/m,
    '根 .gitignore 的构建产物规则变了 —— 本包的 .gitignore 注释需要同步更新');
});

/**
 * skill 包**不该**有 cordis.patch.yml —— 这条断言是反过来的。
 *
 * 本包是 agent skill（`SKILL.md` + `bin` CLI），没有 `main` / `exports` / `apply(ctx)`。
 * `cordis.patch.yml` 会往 profile 插一条 loader row，宿主去 `import` 包名时
 * 必然 `ERR_MODULE_NOT_FOUND`；而 `Entry._init()` 只记日志、不阻止启动，
 * 于是「启动正常、这行静默失效」，极难排查。
 */
test('weread：没有 cordis.patch.yml（skill 不是 Cordis 插件）', () => {
  assert.equal(existsSync(path.join(PKG, 'cordis.patch.yml')), false, 'skill 包不该有 cordis.patch.yml');
  assert.equal(manifest.dsh?.bundle, undefined, 'skill 包不该声明 dsh.bundle');
  assert.equal(manifest.files.includes('cordis.patch.yml'), false, 'files 不该列 cordis.patch.yml');
  // 反过来钉住 skill 形态。
  assert.equal(manifest.main, undefined, 'skill 包没有 main');
  assert.equal(manifest.exports, undefined, 'skill 包没有 exports');
  assert.ok(manifest.bin && typeof manifest.bin.weread === 'string', 'skill 包靠 bin 提供 CLI');
});

test('weread：package.json 的 files 覆盖了所有运行期需要的目录', () => {
  const files = manifest.files ?? [];
  for (const entry of ['lib/', 'scripts/', 'references/', 'SKILL.md', 'ATTRIBUTION.md',
    'LICENSE-Tencent', 'THIRD_PARTY_NOTICES.txt', 'README.md']) {
    assert.ok(files.includes(entry), `files 里缺 ${entry}`);
  }
});

test('weread：没有把真实文章内容或用户数据带进仓库', () => {
  // 硬规则：不把真实文章内容或用户数据写进仓库。
  // 判据用几个**特征串**，而不是「读起来像不像文章」——后者不可执行。
  const suspicious = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|mjs|cjs|json|md|txt)$/.test(entry.name)) continue;
      // 测试与夹具里允许出现**合成的** HTML；这里只挡真实凭据与真实文章 id。
      const text = readFileSync(full, 'utf8');
      if (/__biz=Mz[A-Za-z0-9+/]{20,}/.test(text)) suspicious.push(`${entry.name}: 疑似真实 __biz`);
      if (/(pass_ticket|appmsg_token|wr_skey|wr_vid)=[A-Za-z0-9%+/=]{16,}/.test(text)) {
        suspicious.push(`${entry.name}: 疑似真实票据`);
      }
    }
  };
  walk(PKG);
  assert.deepEqual(suspicious, [], `疑似真实数据：\n${suspicious.join('\n')}`);
});
