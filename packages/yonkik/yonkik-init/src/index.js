/**
 * YONKIK 初始记忆：把内置的知识库铺到用户的记忆区。
 *
 * # 它解决的问题
 *
 * 记忆区（`~/.yonkik`）是 YONKIK 全部能力的底座 —— 没有它，工具只能从零侦察，
 * 而那意味着每次装新机器都要把 130 多个站点重新摸一遍。所以这里内置一份
 * **已脱敏的初始记忆**：装好即可用，往后由用户自己的探索覆盖与扩展。
 *
 * # 「不存在」怎么判
 *
 * 只有当记忆区**还没有记忆**时才铺种子。判据刻意不看目录是否存在（工具自己
 * 会建空目录），而看**有没有实质内容**：
 *
 *   - `sites/_index.json` 存在且 `sites` 非空 → 已有记忆，**不覆盖**；
 *   - `MEMORY.md` 存在 → 同上；
 *   - 两者都没有（目录不存在 / 空目录 / 只有空 index）→ 铺种子。
 *
 * 这样 `yonkik init` 是**幂等**的：重复跑不会把用户后来的探索冲掉。
 *
 * # 为什么不直接覆盖
 *
 * 用户积累的记忆远比种子值钱。宁可少铺一次，也不能覆盖一次 —— 所以默认拒绝，
 * 真要覆盖必须显式传 `force`。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** 本包内置记忆的根目录（`memory/`）。 */
export const SEED_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'memory');

/**
 * 默认记忆区。
 *
 * 与 `@lybx-leyw/dsh-zju-yonkik-tool` 的 `MEMORY_ROOT` 同一套口径：
 * `YONKIK_HOME` 优先，否则 `~/.yonkik`。
 *
 * @param env - 环境变量表。
 * @returns 记忆区的绝对路径。
 */
export function memoryRoot(env = process.env) {
  return path.resolve(env.YONKIK_HOME || path.join(os.homedir(), '.yonkik'));
}

/**
 * 记忆区里是否已有实质内容。
 *
 * @param root - 记忆区路径。
 * @returns `{ initialized: boolean, reason: string }`。
 */
export function inspect(root) {
  const memoryFile = path.join(root, 'MEMORY.md');
  if (fs.existsSync(memoryFile)) {
    return { initialized: true, reason: 'MEMORY.md 已存在' };
  }

  // ⚠️ **不能** 拿「_index.json 有几行」当判据。
  //
  // `yonkik-tool` 启动时会跑 `seedDefaultSites()`，把 zjuers 的 98 个站点以
  // `status: 'pending'` 写进 `_index.json` —— 那只是一张**待探索的路由表**，
  // 不含任何知识（没有 wiki、没有接口、没有鉴权结论）。
  //
  // 拿它当「已初始化」会导致：工具先建空索引 → 本包紧跟其后判定「已有 98 个站」
  // → 跳过 → **一个 wiki 都没铺**，而界面上看不出任何异常（工具照常可以跑，
  // 只是什么都不知道）。实测过这个顺序，bundle 序里 tool 在 init 之前。
  //
  // 所以判据改成**有没有真知识**：至少存在一份站点的 wiki.md。
  const sitesDir = path.join(root, 'sites');
  let wikis = 0;
  try {
    for (const entry of fs.readdirSync(sitesDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      if (fs.existsSync(path.join(sitesDir, entry.name, 'wiki.md'))) wikis += 1;
    }
  } catch { /* 没有 sites/ 就是没有记忆 */ }

  if (wikis > 0) return { initialized: true, reason: `已有 ${wikis} 个站点的 wiki` };
  return { initialized: false, reason: '没有任何站点的 wiki.md（仅有路由表不算记忆）' };
}

/** 递归复制，逐级建目录。 */
function copyTree(from, to) {
  let files = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(dst, { recursive: true });
      files += copyTree(src, dst);
    } else {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      files += 1;
    }
  }
  return files;
}

/**
 * 把内置记忆铺到记忆区。
 *
 * @param options - `{ root?, force?, dry? }`。
 * @param options.root - 目标记忆区；默认 {@link memoryRoot}。
 * @param options.force - 已有记忆时也覆盖（危险，默认 false）。
 * @param options.dry - 只报告会做什么，不落盘。
 * @returns `{ ok, action, root, files?, reason?, error? }`。
 */
export function seed({ root = memoryRoot(), force = false, dry = false } = {}) {
  if (!fs.existsSync(SEED_ROOT)) {
    return { ok: false, action: 'yonkik:init', root, error: `内置记忆缺失：${SEED_ROOT}` };
  }

  const state = inspect(root);
  if (state.initialized && !force) {
    return {
      ok: true, action: 'yonkik:init', root, files: 0, skipped: true,
      reason: state.reason + '；未覆盖（要覆盖请显式传 force）',
    };
  }

  if (dry) {
    return { ok: true, action: 'yonkik:init', root, dry: true, wouldCopy: true, reason: state.reason };
  }

  try {
    fs.mkdirSync(root, { recursive: true });
    const files = copyTree(SEED_ROOT, root);
    return { ok: true, action: 'yonkik:init', root, files, skipped: false, reason: state.reason };
  } catch (error) {
    return { ok: false, action: 'yonkik:init', root, error: `写入失败：${error?.message ?? String(error)}` };
  }
}

export const name = 'zw-yonkik-init';
export const inject = [];

/** 已初始化的标记文件名（放在记忆区根部）。 */
export const FLAG_FILE = '.yonkik-initialized';

/**
 * 读初始化标记。
 *
 * @param root - 记忆区路径。
 * @returns 标记内容，或 `null`（没有标记 / 读不出来）。
 */
export function readFlag(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, FLAG_FILE), 'utf8'));
  } catch { return null; }
}

/**
 * 写初始化标记。
 *
 * 记下**从哪来的种子**与**什么时候铺的**，便于日后判断这份记忆有多旧。
 *
 * @param root - 记忆区路径。
 * @param seedVersion - 种子版本（本包 version）。
 * @returns 写入的标记对象。
 */
export function writeFlag(root, seedVersion) {
  const flag = {
    initializedAt: new Date().toISOString(),
    seedVersion,
    seedFiles: countFiles(SEED_ROOT),
  };
  try {
    fs.writeFileSync(path.join(root, FLAG_FILE), JSON.stringify(flag, null, 2) + '\n');
  } catch { /* 标记写不了不影响记忆本身 */ }
  return flag;
}

/** 递归数文件。 */
function countFiles(dir) {
  let n = 0;
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) n += countFiles(path.join(dir, entry.name));
      else n += 1;
    }
  } catch { /* 目录不存在就是 0 */ }
  return n;
}

/** 本包版本，写进标记。从 package.json 读，避免两处硬编码。 */
function seedVersion() {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(SEED_ROOT, '..', 'package.json'), 'utf8'));
    return manifest.version ?? 'unknown';
  } catch { return 'unknown'; }
}

/**
 * 自动初始化：装了本包、且记忆区还是空的，就把内置记忆铺出去。
 *
 * # 为什么要自动，而不是等人敲一条命令
 *
 * 「初始记忆」的意义就是**装好即用**。如果还要用户记得去跑 `yonkik init`，
 * 那这个包在 90% 的机器上就从来没生效过 —— 因为它不生效时没有任何提示，
 * 用户只会觉得「YONKIK 什么都不知道」。
 *
 * # 三道闸，保证只铺一次、且不覆盖用户的东西
 *
 * 1. **标记**：`<root>/.yonkik-initialized` 存在即认为已初始化过，直接返回。
 *    这是「打过 flag 就不再重新初始化」的那一条。
 * 2. **内容**：记忆区已有 `_index.json`（非空）或 `MEMORY.md` 也算已初始化 ——
 *    覆盖用户从别处带来的记忆是不可接受的。
 * 3. **幂等**：`seed()` 本身也判这两条，双保险。
 *
 * 任何一步失败都**不抛**：初始化失败不该让整个插件树挂掉，更不能卡住
 * 依赖本包的工具。失败原因写进日志，下次启动会重试（标记没写成功时）。
 *
 * @param ctx - Cordis 上下文（可空，用于日志）。
 * @returns 初始化结果，便于测试直接断言。
 */
export function apply() {
  // ⚠️ 不碰 `ctx.log` —— Cordis 的 ctx 是**按 inject 声明代理**的：
  // 没声明 `log` 就访问它，会在取值时抛 "cannot get property \"log\" without inject"，
  // 整个 entry 激活失败。本包一个依赖都不需要，用 console 就够。
  const root = memoryRoot();
  const flag = readFlag(root);
  if (flag !== null) {
    console.info(`[yonkik-init] 已初始化过（${flag.initializedAt}），跳过`);
    return { ok: true, action: 'yonkik:init', root, skipped: true, reason: '已有初始化标记' };
  }

  const result = seed({ root });
  if (result.ok && !result.skipped) {
    const written = writeFlag(root, seedVersion());
    console.info(`[yonkik-init] 已铺初始记忆：${result.files} 个文件 → ${root}`);
    return { ...result, flag: written };
  }
  if (result.ok && result.skipped) {
    // 有记忆但没有标记（用户从别处拷来的 / 老版本装的）：补一个标记，免得每次启动都判。
    const written = writeFlag(root, seedVersion());
    console.info(`[yonkik-init] 记忆已存在（${result.reason}），补记初始化标记`);
    return { ...result, flag: written };
  }
  console.warn(`[yonkik-init] 初始化跳过：${result.error ?? result.reason}`);
  return result;
}

// ⚠️ **不要** 加 `export default seed`。
//
// 宿主 Loader 解析 bundle exports 时优先取 `default`（`unwrapExports`：
// `exports = exports.default ?? exports`），于是 Cordis 会把 `seed` 当成插件的
// `apply` 去调用，传进来的是 `(ctx, config)` —— 而 seed 期待 `{ root, force, dry }`，
// 报「cannot get property "force" without inject」，整个 entry 激活失败。
//
// 这不是猜测：本仓 `ui-shared/src/client.jsx` 的记录里就写着这个坑。
