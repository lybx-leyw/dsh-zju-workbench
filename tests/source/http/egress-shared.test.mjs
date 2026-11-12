/**
 * 共享出口：让所有 `source-*` 包都走同一套自动网络策略。
 *
 * # 这套东西要守的三件事
 *
 * 1. **只有一份出口**。WebVPN 是网关会话，各包各自登录会互相作废（与 CAS
 *    双登录同一类事故）；undici Agent 与校园网探测结果同样只该有一份。
 * 2. **惰性解析**。profile 里包装配顺序不保证 campus 在前，`apply()` 阶段
 *    取服务一定拿不到 —— 那次取到的 `undefined` 一旦被缓存，就永久退化成直连。
 * 3. **缺了 campus 也要活**。拿不到服务时退回宿主 fetch（直连），
 *    不能把「没装 campus」变成启动错误。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

import { sharedFetch } from '../../../packages/source/http/src/index.js';

/** 一个假的 ctx：`get` 返回给定服务表里的东西。 */
function fakeCtx(services = {}) {
  return {
    get(name) {
      return services[name];
    },
  };
}

/**
 * 从源码里截出 `const service = { … }` 那个对象字面量的**内部文本**。
 *
 * 为什么需要它：断言「服务有这个成员」时，直接在全文里搜 `state(` 会假绿 ——
 * 注释里的「诊断走 state()」、调用点 `instance.state()` 都能匹配上，
 * 于是把定义删掉断言照样通过。
 *
 * 这里按花括号深度配对，跳过字符串与注释，返回最外层 `{` 与 `}` 之间的内容。
 * 找不到锚点或括号不配对时返回 null（由调用方断言）。
 *
 * @param source - 源码全文。
 * @param anchor - 起始锚点，例如 `'const service = {'`。
 * @returns 对象字面量内部文本，或 null。
 */
function extractObjectLiteral(source, anchor) {
  const start = source.indexOf(anchor);
  if (start < 0) return null;
  // 锚点末尾的 `{` 就是最外层开括号
  const open = start + anchor.length - 1;
  if (source[open] !== '{') return null;

  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (quote !== null) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    if (c === '{') { depth += 1; continue; }
    if (c === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

const URL_UNDER_TEST = 'https://courses.zju.edu.cn/api/todos';

/* ────────────────────────────────────── 服务接入 */

test('sharedFetch：有出口服务时，请求走 egress（而不是宿主 fetch）', async () => {
  const seen = [];
  const egress = {
    fetch: async (url, init) => { seen.push(['egress', url, init?.method]); return 'from-egress'; },
  };
  const hostFetch = async () => { seen.push(['host']); return 'from-host'; };

  const fetch = sharedFetch(fakeCtx({ zwEgress: egress }), { fallback: hostFetch });
  const result = await fetch(URL_UNDER_TEST, { method: 'GET' });

  assert.equal(result, 'from-egress');
  assert.deepEqual(seen, [['egress', URL_UNDER_TEST, 'GET']], '不该碰宿主 fetch');
});

test('sharedFetch：没有出口服务时退回宿主 fetch（缺 campus 仍可用）', async () => {
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(fakeCtx({}), { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

test('sharedFetch：服务没有 fetch 方法时也要退回（半残服务不能把请求打死）', async () => {
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(fakeCtx({ zwEgress: { state: () => ({}) } }), { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

test('sharedFetch：ctx.get 抛错时退回，而不是让请求变成异常', async () => {
  const ctx = { get() { throw new Error('scope 已销毁'); } };
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(ctx, { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

test('sharedFetch：没有 ctx 时也能用（退回宿主 fetch）', async () => {
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(undefined, { fallback: hostFetch });
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

/* ────────────────────────────────────── 惰性：这条最容易写错 */

test('sharedFetch：**惰性**解析 —— 服务晚于调用方就绪也能用上', async () => {
  // 模拟真实时序：包先 apply（此时 campus 还没 provide），之后服务才出现。
  const services = {};
  const ctx = { get: (name) => services[name] };
  const hostFetch = async () => 'from-host';
  const fetch = sharedFetch(ctx, { fallback: hostFetch });

  // 服务还没出现：走宿主
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');

  // 服务出现之后：必须立刻切换过去（如果实现把结果缓存在闭包里，这里会失败）
  services.zwEgress = { fetch: async () => 'from-egress' };
  assert.equal(await fetch(URL_UNDER_TEST), 'from-egress');

  // 服务消失（卸载）：退回宿主
  delete services.zwEgress;
  assert.equal(await fetch(URL_UNDER_TEST), 'from-host');
});

/* ────────────────────────────────────── campus 是否真的提供了服务 */

test('共享出口由 source-http 提供，campus 不再重复注册', async () => {
  // ⚠️ 这条测试的**位置换过**，别按老样子改回去。
  //
  // 历史上 `ctx.provide('zwEgress', …)` 在 campus 里 —— 那是「出口所有权在
  // 业务包」。代价是 `cc98` / `xxt` / `zdbk` 为了用出口，只能依赖 **campus 这个
  // tier1 业务包**（tier1 → tier1 的横向依赖）。
  //
  // 拆出 `@lybx-leyw/dsh-zju-source-http`（tier 0）之后，出口归它提供。
  // campus 里那段被**有意删除**，原因写在它自己的注释里：
  // 同名服务注册两次会让 Cordis 直接报
  // `service "zwEgress" has been registered at <zju-source-http>`，
  // 整个 campus 插件激活失败、设置面板都点不开。
  //
  // 所以现在要断言的是**两件事**：
  //   1. http 包确实 provide 了它，且成员齐全；
  //   2. campus **不再**provide（否则就是上面那个激活失败）。

  const http = await readFile(
    new URL('../../../packages/source/http/src/host.js', import.meta.url), 'utf8',
  );
  assert.match(http, /ctx\.provide\('zwEgress'/, 'source-http 必须 provide 这个服务名');
  // 成员名以 `packages/source/http/src/host.js` 的 `service = { … }` 实际定义为准。
  // 曾经这里断言的是 campus 那版实现（含 `mode` / `toPhysical` / `probeCampus`），
  // 出口搬到 tier 0 之后接口收窄成下面这几个 —— 断言也得跟着换，否则它守的
  // 是一个已经不存在的形状。
  //
  // ⚠️ 断言的是 `service = { … }` **对象字面量的键名**，不是「行首出现这个单词」。
  //
  // 宽松版（`new RegExp(key + '\\s*\\(')` 打在原文上）会假绿：
  //   · `state(` 能匹配注释里的「诊断走 state()」以及调用 `instance.state()`
  //   · `forget(` 能匹配调用 `instance?.forget()`
  //   · `fetch(` 能匹配 `globalThis.fetch(` / `instance.fetch(`
  // 于是把 `async state()` 的定义删了，断言照样通过 —— 那它什么都没守住。
  //
  // 中间版（锚行首 `^\s+(?:async\s+)?key\s*\(`）也不够：`\s+` 在 `/m` 下会跨行，
  // 一行独立的 `state();` 依然能匹配。要真正守住形状，得**先截出 service 字面量**，
  // 再按 `key:` / `key(` 取键名。
  const literal = extractObjectLiteral(http, 'const service = {');
  assert.ok(literal !== null, 'host.js 里找不到 `const service = {` —— 结构变了就要改这条测试');
  // 再剥一层注释：`[{,\s]` 这个字符类会连**注释里的**成员名一起匹配。
  // 反例（实测）：把 `async state()` 删掉、却在字面量里留一行
  // `// 诊断走 state()`，断言仍然通过。今天真实文件里那句注释在字面量**之外**，
  // 所以现在没假绿；但下一次编辑就可能踩上，这一步把那个洞堵掉。
  const literalCode = literal
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  for (const key of ['fetch', 'state', 'forget', 'probe']) {
    // 锚到**代码行首**（行内只有缩进），对象方法简写与 `key: value` 都算；
    // 这样 `instance.state()` 之类的调用点不会误命中。
    assert.match(literalCode, new RegExp(`^[^\\S\\n]+(?:async\\s+)?${key}\\s*[(:]`, 'm'),
      `zwEgress 缺成员 ${key}（要的是 service 对象里的成员定义，不是调用点或注释）`);
  }

  // 除 `source/http` 之外，**任何** source 包都不许再 provide 这个服务名。
  //
  // 拆包前这里只查 `source/campus` 一个文件（当年是它重复注册的），
  // `campus` 已按平台拆成 `xuezai` + `pta` 并退役，所以改成扫全量：
  // 这既覆盖了当年的那处、也挡住了将来任何新包再犯同一个错
  // （同名服务注册两次会让 Cordis 直接抛 `service "zwEgress" has been
  // registered at <zju-source-http>`，整个插件激活失败、设置面板都点不开）。
  const offenders = [];
  for (const group of ['source', 'core', 'client', 'tool']) {
    const dir = new URL(`../../../packages/${group}/`, import.meta.url);
    let names;
    try {
      names = await readdir(dir);
    } catch {
      continue; // 该分组目录不存在
    }
    for (const name of names) {
      if (group === 'source' && name === 'http') continue; // 它才是提供者
      let file;
      try {
        file = await readFile(new URL(`../../../packages/${group}/${name}/src/index.js`, import.meta.url), 'utf8');
      } catch {
        continue; // 该包没有 src/index.js
      }
      // 只看代码行，不看注释 —— 注释里恰好会引用这串字符。
      const code = file
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (/ctx\.provide\('zwEgress'/.test(code)) offenders.push(`${group}/${name}`);
    }
  }
  assert.deepEqual(offenders, [],
    `除 source/http 外不许 provide zwEgress（会让整个插件激活失败）：${offenders.join(', ')}`);
});

test('各 source 包都接了 sharedFetch（不许再直接用 globalThis.fetch）', async () => {
  // 路径写的是**分组后的目录**（`packages/source/<目录>`），不是包名 ——
  // 包名仍是 `dsh-zhiyun-source-*`，两者刻意不同（见 README 的分组说明）。
  const targets = [
    ['packages/source/zdbk/src/index.js', 'zdbk'],
    ['packages/source/cc98/src/index.js', 'cc98'],
    ['packages/source/xxt/src/index.js', 'xxt'],
  ];
  for (const [path, pkg] of targets) {
    const src = await readFile(new URL(`../../../${path}`, import.meta.url), 'utf8');
    assert.match(src, /sharedFetch\(ctx\)/, `${pkg} 应当用 sharedFetch(ctx)`);
    assert.doesNotMatch(
      src,
      /(?:config\.fetch \?\? |: )globalThis\.fetch\b(?!\s*\))/,
      `${pkg} 仍在直接用 globalThis.fetch 当生产出口`,
    );
  }
});

test('classroom 也优先用共享出口，并保留自己的本地兜底', async () => {
  const src = await readFile(
    new URL('../../../packages/source/classroom/src/index.js', import.meta.url), 'utf8',
  );
  assert.match(src, /zwEgress/, 'classroom 应当优先取共享出口');
  assert.match(src, /localNet/, '拿不到共享出口时要有本地兜底');
  // 顺序要求：先试共享出口，再退回本地
  assert.ok(
    src.indexOf('zwEgress') < src.indexOf('localNet.fetch'),
    '必须先查共享出口，再退回本地网络',
  );
});
