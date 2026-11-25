/**
 * YONKIK 初始记忆的契约守卫。
 *
 * # 这条在防什么
 *
 * 初始记忆是给**新机器**铺底的：`yonkik init` 在没有记忆时把它复制到记忆区。
 * 它一旦坏掉，症状是「装好了但工具什么都不知道」，而不会有任何报错 ——
 * 因为缺文件和「还没探索过」看起来一样。
 *
 * 另外它还守一条**安全底线**：这份记忆要进公开仓库，绝不能带上探索者的
 * 登录态与个人数据。脱敏是导出脚本做的，但脚本可能被改坏、也可能有人手工
 * 往 memory/ 里丢文件 —— 所以这里独立复核一遍。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PKG = path.join(ROOT, 'packages/yonkik/yonkik-init');
const MEMORY = path.join(PKG, 'memory');
const { seed, inspect, memoryRoot, SEED_ROOT, apply, readFlag, FLAG_FILE } = await import(
  new URL('../../packages/yonkik/yonkik-init/src/index.js', import.meta.url).href);

test('内置记忆的结构完整：有索引、目录、playbook，且每站至少一份 wiki', () => {
  assert.ok(fs.existsSync(MEMORY), 'memory/ 不存在');
  for (const file of ['MEMORY.md']) {
    assert.ok(fs.existsSync(path.join(MEMORY, file)), `缺 ${file}`);
  }
  for (const file of ['_index.json', '_dir.md', '_playbook.md', '_sso.json']) {
    assert.ok(fs.existsSync(path.join(MEMORY, 'sites', file)), `缺 sites/${file}`);
  }

  const index = JSON.parse(fs.readFileSync(path.join(MEMORY, 'sites', '_index.json'), 'utf8'));
  assert.ok(Object.keys(index.sites ?? {}).length >= 100, '索引站点数偏少，种子可能没导全');

  const sites = fs.readdirSync(path.join(MEMORY, 'sites'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name);
  assert.ok(sites.length >= 100, `站点目录只有 ${sites.length} 个`);
  const withWiki = sites.filter(name => fs.existsSync(path.join(MEMORY, 'sites', name, 'wiki.md')));
  assert.ok(withWiki.length >= sites.length - 5,
    `${sites.length - withWiki.length} 个站缺 wiki.md（超过容忍的 5 个）`);
});

test('内置记忆不含登录态与个人数据（公开仓库底线）', () => {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(MEMORY);

  const banned = [
    [/\.dpapi$/, 'DPAPI 加密会话'],
    [/(^|\/)state\.json$/, '登录态 state.json'],
    [/(^|\/)token\.json$/, 'JWT token.json'],
    [/(^|\/)my-courses\.json$/, '个人选课'],
  ];
  for (const file of files) {
    for (const [re, label] of banned) {
      assert.doesNotMatch(file, re, `memory/ 里出现了 ${label}：${path.relative(MEMORY, file)}`);
    }
  }

  const text = files
    .filter(file => /\.(md|json)$/.test(file))
    .map(file => fs.readFileSync(file, 'utf8'))
    .join('\n');
  // 浙大学号：10 位、3 开头，前后不能是数字。
  assert.doesNotMatch(text, /(?<!\d)3\d{9}(?!\d)/, 'memory/ 里出现了学号');
  // 真实 cookie 快照的招牌形状。
  assert.doesNotMatch(text, /"cookies"\s*:\s*\[/, 'memory/ 里出现了 cookie 快照');
  // 本地绝对路径会带用户名。
  assert.doesNotMatch(text, /[A-Za-z]:\\+Users\\+[^\\\s"']+/, 'memory/ 里出现了本地绝对路径');
  // POSIX 家目录同理。
  assert.doesNotMatch(text, /\/(Users|home)\/[A-Za-z0-9._-]+\//, 'memory/ 里出现了 POSIX 家目录路径');
  // 个人手机号（11 位）。单位座机 / 部门电话本来就可公开，不在本条约束内。
  assert.doesNotMatch(text, /(?<!\d)1[3-9]\d{9}(?!\d)/, 'memory/ 里出现了手机号');
  // 本机回环代理端口是主机指纹：换台机器就是另一个端口，对读者没有意义。
  assert.doesNotMatch(text, /127\.0\.0\.1:\d{4,5}/, 'memory/ 里出现了本机回环代理地址');
});

test('启动即自动初始化：不需要任何人去敲命令', () => {
  // 「初始记忆」的意义就是装好即用。若要用户记得跑 `yonkik init`，
  // 这个包在多数机器上就从未生效过 —— 而它不生效时没有任何提示。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yonkik-auto-'));
  const saved = process.env.YONKIK_HOME;
  try {
    process.env.YONKIK_HOME = dir;
    const result = apply();
    assert.equal(result.ok, true);
    assert.equal(result.skipped, false, '空记忆区应自动铺底');
    assert.ok(result.files > 300, `只复制了 ${result.files} 个文件`);

    // 标记必须写出来 —— 这是「打过 flag 就不再重新初始化」的那一条。
    const flag = readFlag(dir);
    assert.ok(flag !== null, '没有写初始化标记');
    assert.ok(typeof flag.initializedAt === 'string', '标记缺 initializedAt');
    assert.equal(flag.seedFiles, result.files, '标记里的文件数与实际不符');

    // 第二次启动：直接跳过，一个文件都不写。
    const again = apply();
    assert.equal(again.skipped, true);
    assert.equal(again.files, undefined, '第二次不该再写文件');
  } finally {
    if (saved === undefined) delete process.env.YONKIK_HOME;
    else process.env.YONKIK_HOME = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('工具先建的空索引不算「已有记忆」（bundle 顺序陷阱）', () => {
  // yonkik-tool 启动时会 seedDefaultSites() 写 98 行 pending 站点进 _index.json ——
  // 那只是路由表，没有一篇 wiki。若把它当「已初始化」，就会跳过铺底，
  // 结果一个 wiki 都没有，而界面毫无异常。bundle 序里 tool 在 init 之前。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yonkik-order-'));
  try {
    fs.mkdirSync(path.join(dir, 'sites'), { recursive: true });
    const stub = { sites: {} };
    for (let i = 0; i < 98; i++) {
      stub.sites[`stub${i}.zju.edu.cn`] = { status: 'pending', origin: 'https://x', requires: [] };
    }
    fs.writeFileSync(path.join(dir, 'sites', '_index.json'), JSON.stringify(stub));

    assert.equal(inspect(dir).initialized, false, '只有路由表时必须判定为未初始化');
    const result = seed({ root: dir });
    assert.equal(result.skipped, false, '应照常铺底');
    const wikis = fs.readdirSync(path.join(dir, 'sites'))
      .filter(name => fs.existsSync(path.join(dir, 'sites', name, 'wiki.md')));
    assert.ok(wikis.length >= 100, `只铺了 ${wikis.length} 个 wiki`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seed() 只在记忆区为空时铺，重复跑不覆盖', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yonkik-init-'));
  try {
    assert.equal(inspect(dir).initialized, false, '空目录应判定为未初始化');

    const first = seed({ root: dir });
    assert.equal(first.ok, true);
    assert.equal(first.skipped, false);
    assert.ok(first.files > 300, `只复制了 ${first.files} 个文件`);
    assert.ok(fs.existsSync(path.join(dir, 'MEMORY.md')), '没写 MEMORY.md');

    const second = seed({ root: dir });
    assert.equal(second.ok, true);
    assert.equal(second.skipped, true, '第二次必须跳过');
    assert.equal(second.files, 0, '第二次不该再写文件');

    // 用户改了记忆之后，更不该被覆盖。
    fs.writeFileSync(path.join(dir, 'MEMORY.md'), 'user memory');
    seed({ root: dir });
    assert.equal(fs.readFileSync(path.join(dir, 'MEMORY.md'), 'utf8'), 'user memory',
      '已有记忆被覆盖了');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('memoryRoot 尊重 YONKIK_HOME', () => {
  assert.equal(memoryRoot({ YONKIK_HOME: '/tmp/xx' }), path.resolve('/tmp/xx'));
  assert.match(memoryRoot({}), /\.yonkik$/);
  assert.equal(SEED_ROOT, MEMORY, 'SEED_ROOT 应指向本包的 memory/');
});
