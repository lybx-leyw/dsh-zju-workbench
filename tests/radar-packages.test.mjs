/**
 * 雷达**候选骨架**的形态契约测试。
 *
 * 这些包由每日「生态雷达」自动生成：未评审、未接入 profile、不可直接使用。
 * 正因如此，它们更需要被钉住 —— 骨架里的包名、`dsh.bundle.patch` 指向、
 * 以及 `cordis.patch.yml` 的形状，是**将来接的人唯一能依赖的事实**。
 *
 * 覆盖的是**不连网、不装依赖**就能钉死的那部分：
 *
 *   - **命名**：目录名 / 包名 / patch 的 `id` 三者互相自洽，且统一 `dsh-radar-` 前缀；
 *   - **不越界**：候选骨架**不得**出现在 `profiles/zhiyun-bench/package.json` 的
 *     `dsh.profile.bundles` 里 —— profile 中任何一条 Loader 条目解析失败，
 *     起不来的是**整个工作台**（CONTRIBUTING 3.1）；
 *   - **形态**：`dsh.bundle.patch` 指向的 patch 文件存在、只有一条 `insert`；
 *     `README.md` 顶部必须带「未评审 / 未接入」声明（防止骨架被误当成成品）；
 *     `OWNERS` 必须存在；
 *   - **锁版**（仅对已引入上游依赖的骨架）：`package.json` 的依赖必须是**精确版本**
 *     （不是 `^` / `~` / 范围）。
 *
 * # 为什么不断言更多
 *
 * 2026-10-14 创建的两个骨架（`dsh-radar-dsh-market`、`dsh-radar-fsrs-scheduler`）
 * 是**更早的、更保守的形状**：没有 `src/upstream.js`、patch 里没有「未接入」注释、
 * `src/index.js` 只有一段注释与 `export const name`。
 * 2026-10-15 起规范收紧（见 `docs/ecosystem-radar/README.md`），新骨架带
 * `src/upstream.js` 锁版凭据。本测试**回填式地把两条线都钉住**：对旧骨架只要求
 * 它们**确实遵守**过的那部分，对新骨架要求完整的锁版凭据。这样测试是「记录仓库现状」
 * 而不是「宣布一个没人遵守的理想」—— 后者只会变成一条永远在红的测试。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

const readJson = (relative) => JSON.parse(readFileSync(path.join(root, relative), 'utf8'));
const readText = (relative) => readFileSync(path.join(root, relative), 'utf8');
const exists = (relative) => existsSync(path.join(root, relative));

/** 仓库里所有 `packages/dsh-radar-*` 候选骨架（按目录名排序，保证断言顺序稳定）。 */
const skeletonDirs = readdirSync(path.join(root, 'packages'))
  .filter((name) => name.startsWith('dsh-radar-'))
  .sort();

/**
 * 上游**尚未核实**（npm 上也没有）的骨架。
 *
 * 这类骨架按 `dsh-radar-career-calendar` 的先例处理：**不写 `dependencies`、
 * 也不写 `UPSTREAM_PACKAGE` / `UPSTREAM_VERSION`** —— 宁可不声明，也不要摆一对
 * 看着像锁版凭据、实则待定的常量。逐条点名，评审确认包名与版本后从这里移出。
 */
const UNVERIFIED_UPSTREAM = [
  // `npm view @perrylink/dsh-score` 为 E404（2026-10-20 复核）；线索见其 src/upstream.js。
  'dsh-radar-plugin-score',
];


test('仓库里至少有一个雷达候选骨架目录（否则本测试文件已失效）', () => {
  assert.ok(skeletonDirs.length > 0, `未找到 packages/dsh-radar-*，实际：${skeletonDirs.join(', ')}`);
});

for (const dir of skeletonDirs) {
  const hasUpstreamModule = exists(`packages/${dir}/src/upstream.js`);

  test(`${dir}：包名与目录名一致、private、dsh.bundle.patch 指向存在的文件`, () => {
    const manifest = readJson(`packages/${dir}/package.json`);
    assert.equal(manifest.name, dir, '包名必须与目录名一致');
    assert.equal(manifest.private, true, '候选骨架必须是 private（不得发布）');

    const patchRel = manifest.dsh?.bundle?.patch;
    assert.ok(patchRel, '候选骨架必须带 dsh.bundle.patch');
    assert.ok(
      exists(`packages/${dir}/${patchRel}`),
      `dsh.bundle.patch 指向的文件不存在：${patchRel}`,
    );

    // 骨架不得自带客户端半边：那会接管 settings 分组与外壳布局主张。
    assert.equal(manifest.dsh.client, undefined, '候选骨架不应声明 dsh.client');
  });

  test(`${dir}：cordis.patch.yml 只有一条 insert，且 name 与包名一致`, () => {
    const text = readText(`packages/${dir}/cordis.patch.yml`);

    const inserts = text.split('\n').filter((line) => /^\s*-\s*insert:\s*$/.test(line));
    assert.equal(inserts.length, 1, `候选骨架应只有一条 insert，实际 ${inserts.length} 条`);

    assert.match(
      text,
      new RegExp(`^\\s*name:\\s*${dir}\\s*$`, 'm'),
      `patch 的 name 必须与包名（目录名）一致：${dir}`,
    );
    assert.match(text, /^\s*- id:\s*\S+$/m, 'insert 必须带 id');
  });

  test(`${dir}：README 顶部带「候选骨架 / 未评审 / 未接入」声明`, () => {
    const readme = readText(`packages/${dir}/README.md`);
    const head = readme.split('\n').slice(0, 12).join('\n');

    assert.match(head, /候选骨架/, 'README 顶部必须声明「候选骨架」');
    assert.match(head, /未评审/, 'README 顶部必须声明「未评审」');
    assert.match(head, /未接入/, 'README 顶部必须声明「未接入」');
    assert.match(readme, /强化式集成|全新/, 'README 必须写明是「全新」还是「强化式集成」');
  });

  test(`${dir}：OWNERS 存在且为 Owner: shared`, () => {
    assert.ok(exists(`packages/${dir}/OWNERS`), '候选骨架必须带 OWNERS');
    assert.equal(readText(`packages/${dir}/OWNERS`).trim(), 'Owner: shared', '新包 OWNERS 必须是 shared');
  });

  test(`${dir}：src/index.js 存在、导出 name，且留下 TODO`, () => {
    const source = readText(`packages/${dir}/src/index.js`);
    assert.match(source, /export const name = '/, 'src/index.js 必须导出插件 name');
    assert.match(source, /TODO/, '骨架必须留下 TODO，而不是空实现');
  });

  test(`${dir}：候选骨架不得出现在 profile 的 dsh.profile.bundles 里`, () => {
    const profile = readJson('profiles/zhiyun-bench/package.json');
    const bundles = profile.dsh?.profile?.bundles ?? [];

    assert.ok(
      !bundles.includes(dir),
      `${dir} 出现在 profiles/zhiyun-bench/package.json 的 dsh.profile.bundles 里 —— `
        + '候选骨架未评审，接入会让整个工作台起不来（CONTRIBUTING 3.1）',
    );
    assert.ok(
      !bundles.some((b) => typeof b === 'string' && b.startsWith('dsh-radar-')),
      'profile 里不得出现任何 dsh-radar-* 候选骨架',
    );
  });

  if (hasUpstreamModule) {
    test(`${dir}：带 src/upstream.js，依赖写精确版本且与 UPSTREAM_VERSION 逐字符一致`, () => {
      const manifest = readJson(`packages/${dir}/package.json`);
      const deps = manifest.dependencies ?? {};

      const source = readText(`packages/${dir}/src/upstream.js`);

      // 「上游未核实」的骨架：**没有依赖**，因此也不许摆一对看起来像锁版凭据的常量。
      // 逐个点名而不是"没依赖就放行"，这样新增一个既没依赖又没凭据的骨架会红。
      if (Object.keys(deps).length === 0) {
        assert.ok(
          UNVERIFIED_UPSTREAM.includes(dir),
          `${dir} 既没有 dependencies 也不在「上游未核实」名单里 —— `
            + '要么补锁版依赖，要么在 tests/radar-packages.test.mjs 的 UNVERIFIED_UPSTREAM 里登记理由',
        );
        assert.equal(
          /export const UPSTREAM_PACKAGE = '/.test(source),
          false,
          `${dir} 的上游未核实，不应声明 UPSTREAM_PACKAGE（假装锁版已完成）`,
        );
        assert.equal(
          /export const UPSTREAM_VERSION = '/.test(source),
          false,
          `${dir} 的上游未核实，不应声明 UPSTREAM_VERSION（假装锁版已完成）`,
        );
        return;
      }

      const pkgMatch = /export const UPSTREAM_PACKAGE = '([^']+)'/.exec(source);
      const verMatch = /export const UPSTREAM_VERSION = '([^']+)'/.exec(source);
      assert.ok(pkgMatch, 'src/upstream.js 必须导出 UPSTREAM_PACKAGE');
      assert.ok(verMatch, 'src/upstream.js 必须导出 UPSTREAM_VERSION');

      const [upstreamPackage, upstreamVersion] = [pkgMatch[1], verMatch[1]];

      assert.equal(
        deps[upstreamPackage],
        upstreamVersion,
        `package.json 的 ${upstreamPackage} 依赖必须与 UPSTREAM_VERSION 逐字符一致`,
      );
      assert.match(
        deps[upstreamPackage],
        /^\d+\.\d+\.\d+(?:-[\w.]+)?$/,
        '依赖版本必须是精确版本，不是 ^ / ~ / 范围',
      );
      assert.match(
        source,
        /export const UPSTREAM_REPOSITORY = 'https:\/\/[^']+'/,
        '必须导出 UPSTREAM_REPOSITORY，供人工复核对照',
      );

      // 骨架自身的 src/index.js 必须真的引用锁版凭据，而不是把它摆在那里当装饰。
      assert.match(
        readText(`packages/${dir}/src/index.js`),
        /from '\.\/upstream\.js'/,
        'src/index.js 必须从 ./upstream.js 取用锁版凭据',
      );
    });
  } else {
    test(`${dir}：无锁版凭据模块的历史骨架，其依赖（若有）也必须写精确版本`, () => {
      const manifest = readJson(`packages/${dir}/package.json`);
      for (const [pkg, range] of Object.entries(manifest.dependencies ?? {})) {
        assert.match(
          range,
          /^\d+\.\d+\.\d+(?:-[\w.]+)?$/,
          `${pkg} 的版本 ${range} 不是精确版本（不允许 ^ / ~ / 范围）`,
        );
      }
    });
  }
}

test('所有雷达候选骨架的目录名统一 dsh-radar- 前缀（避免与本仓 dsh-zhiyun-* 混淆）', () => {
  for (const dir of skeletonDirs) {
    assert.ok(dir.startsWith('dsh-radar-'), `${dir} 不符 dsh-radar- 前缀`);
  }
});
