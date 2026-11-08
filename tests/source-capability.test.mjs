import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * **能力契约守卫**：`dsh.capability` 声明必须与代码实际依赖一致。
 *
 * # 为什么需要这条测试
 *
 * 设计借鉴自 `Anchorite-no/dsh-zju-assistant` 的模块清单（`core/zju/lib/<域>/module.json`：
 * `tier` / `auth` / `network` / `provides` / `requires`）。读了它的设计，**没有复制代码**；
 * 记在根 `ATTRIBUTION.md`。
 *
 * 我们采纳的核心是那一条：**业务域应当平级依赖基础设施，而不是互相依赖**。
 *
 * 在本仓此前的实际形状里，`cc98` / `zdbk` / `xxt` 都是 `import ... from
 * '@lybx-leyw/dsh-zju-source-campus'` —— 一个数据包的能力被另一个**业务包**绑架：
 * campus 不装，它们的共享出口就没了。这类耦合靠读代码很难发现，
 * 因为 import 语句散在各处、而且「顺手借一下」看起来无害。
 *
 * 这条测试把隐性依赖变成**可检查的声明**：`requires` 里没写的包，代码不许 import。
 *
 * # 它拦得住什么
 *
 * - 新增业务包时顺手 `import` 另一个业务包（应当先抽到基础设施层）；
 * - 声明与代码漂移（删了依赖忘了改声明，或反之）；
 * - 声明了一个并不存在的依赖（拼写错误会静默失效）。
 *
 * # 它拦不住什么（如实说明）
 *
 * - 只检查**静态 import 说明符**。动态 `import()`、相对路径穿越、
 *   或通过 `ctx.get('服务名')` 的运行时耦合都不在检查范围内 —— 服务依赖是
 *   Cordis 的正常用法，不该被禁止。
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_ROOT = path.join(root, 'packages', 'source');

/** 本仓 source 分组的包目录（分组目录本身没有 manifest）。 */
function sourcePackages() {
  const out = [];
  for (const entry of readdirSync(SOURCE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SOURCE_ROOT, entry.name);
    const manifestPath = path.join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    out.push({ dir, name: entry.name, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) });
  }
  return out;
}

/** 收集一个包 `src/**` 下所有静态 import 的**裸说明符**（非相对路径）。 */
function bareImports(dir) {
  const specifiers = new Set();
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx|mjs)$/.test(entry.name)) continue;
      const source = readFileSync(full, 'utf8');
      // 只认静态 import / export from；动态 import() 与 require() 不在范围内（见文件头）
      for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (!specifier.startsWith('.') && !specifier.startsWith('node:')) specifiers.add(specifier);
      }
      for (const match of source.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (!specifier.startsWith('.') && !specifier.startsWith('node:')) specifiers.add(specifier);
      }
    }
  };
  const srcDir = path.join(dir, 'src');
  if (existsSync(srcDir) && statSync(srcDir).isDirectory()) walk(srcDir);
  return specifiers;
}

/** 把一个 import 说明符归到**某个包的包名**（`pkg/sub` → `pkg`，`@scope/pkg/sub` → `@scope/pkg`）。 */
function packageOf(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const HOST_PREFIX = '@deepseek-ai/';
const VENDOR = new Set(['undici', 'tough-cookie', 'react', 'react-dom', 'js-yaml', 'pptxgenjs', 'playwright']);

test('每个 source 包都声明了 dsh.capability', () => {
  const missing = sourcePackages()
    .filter(({ manifest }) => manifest.dsh?.capability === undefined)
    .map(({ name }) => name);
  assert.deepEqual(missing, [], `这些包缺 dsh.capability：${missing.join(', ')}`);
});

test('capability 的字段取值合法', () => {
  const TIERS = [0, 1];
  const AUTH = ['none', 'own', 'cas'];
  const NETWORK = ['public', 'campus'];
  const problems = [];
  for (const { name, manifest } of sourcePackages()) {
    const cap = manifest.dsh?.capability;
    if (cap === undefined) continue;
    if (!TIERS.includes(cap.tier)) problems.push(`${name}: tier=${cap.tier}`);
    if (!AUTH.includes(cap.auth)) problems.push(`${name}: auth=${cap.auth}`);
    if (!NETWORK.includes(cap.network)) problems.push(`${name}: network=${cap.network}`);
    if (typeof cap.writes !== 'boolean') problems.push(`${name}: writes 必须是布尔`);
    if (!Array.isArray(cap.requires)) problems.push(`${name}: requires 必须是数组`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('requires 里不得出现自己', () => {
  const problems = [];
  for (const { manifest } of sourcePackages()) {
    const cap = manifest.dsh?.capability;
    if (cap?.requires?.includes(manifest.name)) problems.push(manifest.name);
  }
  assert.deepEqual(problems, [], `自依赖：${problems.join(', ')}`);
});

test('requires 里声明的每个包都真实存在（防拼写错误静默失效）', () => {
  const known = new Set();
  for (const dir of [path.join(root, 'packages'), path.join(root, 'packages', 'client'), path.join(root, 'packages', 'source')]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(dir, entry.name, 'package.json');
      if (!existsSync(manifestPath)) continue;
      known.add(JSON.parse(readFileSync(manifestPath, 'utf8')).name);
    }
  }
  const problems = [];
  for (const { name, manifest } of sourcePackages()) {
    for (const dep of manifest.dsh?.capability?.requires ?? []) {
      if (!known.has(dep)) problems.push(`${name} 声明了不存在的依赖 ${dep}`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('业务包（tier 1）不得依赖另一个业务包 —— 基础设施才可被共享', () => {
  const tierOf = new Map();
  for (const { manifest } of sourcePackages()) {
    tierOf.set(manifest.name, manifest.dsh?.capability?.tier);
  }
  const violations = [];
  for (const { name, manifest } of sourcePackages()) {
    const cap = manifest.dsh?.capability;
    if (cap?.tier !== 1) continue;
    for (const dep of cap.requires ?? []) {
      if (tierOf.get(dep) === 1) violations.push(`${name}（tier 1）依赖 ${dep}（tier 1）`);
    }
  }
  assert.deepEqual(violations, [],
    `业务包之间不应互相依赖，应当先把共用部分抽到 tier 0：\n${violations.join('\n')}`);
});

test('代码里的裸 import 都被 requires 覆盖（这是本守卫的核心）', () => {
  const declared = new Map();
  const selfNames = new Map();
  for (const { manifest } of sourcePackages()) {
    declared.set(manifest.name, new Set(manifest.dsh?.capability?.requires ?? []));
    selfNames.set(manifest.name, manifest.name);
  }

  const problems = [];
  for (const { dir, manifest } of sourcePackages()) {
    const allowed = declared.get(manifest.name) ?? new Set();
    for (const specifier of bareImports(dir)) {
      const pkg = packageOf(specifier);
      if (pkg === manifest.name) continue;
      if (pkg.startsWith(HOST_PREFIX)) continue;   // 宿主提供的包
      if (VENDOR.has(pkg)) continue;               // 第三方运行时依赖
      if (!declared.has(pkg)) continue;            // 非本仓 source 包，不归这条规则管
      if (!allowed.has(pkg)) {
        problems.push(`${manifest.name} import 了 ${pkg}，但 requires 里没写 —— 补声明或抽到基础设施层`);
      }
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('反向：requires 里写的每个本仓 source 包都真的被 import 了（防过期声明）', () => {
  const problems = [];
  for (const { dir, manifest } of sourcePackages()) {
    const imported = new Set([...bareImports(dir)].map(packageOf));
    for (const dep of manifest.dsh?.capability?.requires ?? []) {
      if (!dep.startsWith('@lybx-leyw/') && !dep.startsWith('dsh-zhiyun-')) continue;
      // 只对本仓 source 分组内的包做反向检查
      const isSourcePkg = sourcePackages().some(({ manifest: m }) => m.name === dep);
      if (!isSourcePkg) continue;
      if (!imported.has(dep)) problems.push(`${manifest.name} 声明依赖 ${dep}，但代码里没有 import 它`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});
