/**
 * 分层守卫：**数据源的错误翻译只在数据源里**。
 *
 * 需求原话：「凭证管理统一在 source 包注册时加入到 setting 栏目里进行配置，
 * source 自己做好凭证管理和报错的封装的拉取数据的函数。下游函数调用 source 的
 * 功能函数就只需要直接调用即可，不用重新处理凭证或者错误等」。
 *
 * 这条以前是破的：`page-planning` 里有一份自己的 `translateXzzdError` /
 * `translatePtaError`，把 campus 的码再映射一遍，还自己写「去『设置 →
 * 浙大一卡通』」那句。凭据写入口改名时，页面那份不会跟着改 —— 用户会被指向
 * 一个不存在的设置项。
 *
 * 现在的契约：
 *   1. `campus.todos()` 返回的 `error` 已经是 `{ code, message }`，message 可直接上屏；
 *   2. 页面只透传，不做码表；
 *   3. 凭证的**读取**只出现在 `packages/source/` 里。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = path.join(ROOT, 'packages', 'source');
const CLIENT = path.join(ROOT, 'packages', 'client');
const SLASH = String.fromCharCode(92);

function sources(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'lib', 'vendor'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { sources(full, out); continue; }
    if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = file => path.relative(ROOT, file).split(SLASH).join('/');

/** 剥注释：说明性文字里会提到这些名字。 */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('两个校园数据源各自导出错误翻译，且 todos() 的返回值已经翻译过', () => {
  // 拆包前这条测的是 `source/campus` 一个文件里有两个翻译函数；
  // 拆开后它们分居两个包，断言也随之分开。
  const xuezai = readFileSync(path.join(SOURCE, 'xuezai', 'src', 'xzzd.js'), 'utf8');
  const xuezaiIndex = readFileSync(path.join(SOURCE, 'xuezai', 'src', 'index.js'), 'utf8');
  assert.match(`${xuezai}\n${xuezaiIndex}`, /translateXzzdError/,
    'xuezai 应有 translateXzzdError（可在 xzzd.js 或 index.js）');
  assert.match(xuezaiIndex, /translateXzzdError\(toError\(error\)\)/,
    'xuezai 的 todos() 没有把错误交给 translateXzzdError —— 下游又得自己翻');

  const ptaIndex = readFileSync(path.join(SOURCE, 'pta', 'src', 'index.js'), 'utf8');
  assert.match(ptaIndex, /translatePtaError/, 'pta 应有 translatePtaError');
  assert.match(ptaIndex, /translatePtaError\(toError\(error\)\)/,
    'pta 的 todos() 没有把错误交给 translatePtaError');
});

test('页面层不再定义数据源的错误码表', () => {
  const violations = [];
  for (const file of sources(CLIENT)) {
    const body = code(readFileSync(file, 'utf8'));
    // 定义一份翻译函数 = 又抄了一遍码表。
    if (/const\s+translate\w*Error\s*=/.test(body)) violations.push(rel(file));
  }
  assert.deepEqual(violations, [],
    '错误翻译应留在数据源（source）里，页面只透传:\n' + violations.join('\n'));
});

test('凭据的读取只出现在 source 包里', () => {
  const violations = [];
  for (const file of sources(CLIENT)) {
    const body = code(readFileSync(file, 'utf8'));
    // 页面自己读宿主凭据服务 = 绕过了 source 的封装。
    if (/ctx\.get\(\s*['"]credentials['"]\s*\)/.test(body) || /\breadCard\s*\(/.test(body)) {
      violations.push(rel(file));
    }
  }
  assert.deepEqual(violations, [],
    '页面不该直接读凭据，调用 source 的封装函数即可:\n' + violations.join('\n'));
});

test('每个 source 包的设置分区都由自己注册（凭证在设置里配）', () => {
  // 这不是「必须有」的硬规则：`webvpn` 是纯库、`http` 是传输层，两者没有设置面。
  // 所以只钉住**有凭据**的那几个必须自己注册 `settings.section`。
  // 拆包后 `campus` 已退役，它那一格拆成 `xuezai`(CAS，不占分区) 与 `pta`(Cookie，自己占一格)。
  // 所以这里列的是**真有独立凭证**的包：CAS 那批共用「浙大一卡通」，不在此列。
  const mustRegister = ['login', 'pta', 'cc98', 'xxt', 'netproxy'];
  const violations = [];
  for (const pkg of mustRegister) {
    const client = path.join(SOURCE, pkg, 'src', 'client.jsx');
    if (!existsSync(client)) { violations.push(`${pkg}: 没有 src/client.jsx，设置分区无处注册`); continue; }
    const body = readFileSync(client, 'utf8');
    if (!body.includes('settings.section')) violations.push(`${pkg}: src/client.jsx 没有注册 settings.section`);
  }
  assert.deepEqual(violations, [],
    '凭据/设置在设置栏里配置，由数据源自己注册:\n' + violations.join('\n'));
});

test('页面不重复注册数据源已有的设置分区（凭据入口只有一个）', () => {
  // 需求：凭证管理统一在 source 注册时加进设置栏。页面又注册一份，用户会看到
  // 两个入口、各自打不同的路由 —— 不知道该信哪个，也不知道该删哪个。
  //
  // 真发生过：`page-planning` 注册过 `zhiyun-pta`（「拼题A」），而
  // `source/campus` 已经注册了含同一份 Cookie 配置的 `zju-source-campus`。
  // 两份都调 `settings('pta', …)` 落同一个 Cookie，于是设置栏里出现两个「拼题A」。
  //
  // # 判据为什么不能靠标签文本
  //
  // 初版想比「分区标题是否同名」，但 source 的标题走 i18n（`text.t('section')`），
  // 字面量抓不到；而页面的标题是字面量 —— 两边根本不同形，守卫会永远绿灯，
  // 等于没写。所以改用**结构判据**：source 已注册了某个 id，页面就不得再注册
  // 同一个 id；此外，页面若在设置里做「保存 Cookie」，那必须是通过 source 的
  // 服务，而不是自己拼一条路由去写同一份凭据。
  const sourceIds = new Set();
  for (const pkg of readdirSync(SOURCE, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const file = path.join(SOURCE, pkg.name, 'src', 'client.jsx');
    if (!existsSync(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(/id:\s*'([^']+)'/g)) sourceIds.add(match[1]);
  }

  const violations = [];
  for (const pkg of readdirSync(CLIENT, { withFileTypes: true })) {
    if (!pkg.isDirectory() || !pkg.name.startsWith('page-')) continue;
    const file = path.join(CLIENT, pkg.name, 'src', 'client.jsx');
    if (!existsSync(file)) continue;
    const body = readFileSync(file, 'utf8');

    // 1) 不得与 source 抢同一个分区 id。
    for (const match of body.matchAll(/id:\s*'([^']+)'/g)) {
      if (sourceIds.has(match[1])) violations.push(`${pkg.name}: 注册了数据源已有的分区 id『${match[1]}』`);
    }

    // 2) 页面里出现「保存 Cookie：」这类设置面板文案，说明它在提供凭据入口。
    //    Cookie 属于数据源，这类入口应由那一边给。
    if (/保存\s*Cookie/.test(body) && /settings\.section/.test(body)) {
      violations.push(`${pkg.name}: 在设置分区里提供了 Cookie 保存入口 —— 凭据配置应归 source`);
    }

    // 3) 页面不得再写「去『设置 → 浙大一卡通』」这类**凭据指引**。
    //    那句文案的归属是数据源：`source/campus` 的 `translateXzzdError` /
    //    `translatePtaError` 会把它塞进 `message`，页面直接透传即可。
    //    页面抄一份的后果是「设置分区改名时只改了 source、页面还指旧入口」。
    //
    //    ⚠️ 先剥注释：说明性文字里会引用这句话（“这里不该出现 …”），那不是文案。
    const codeOnly = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    if (/设置\s*→\s*浙大一卡通|设置\s*→\s*拼题A/.test(codeOnly)) {
      violations.push(`${pkg.name}: 页面里又出现了凭据指引入口文案 —— 应直传数据源的 message`);
    }
  }
  assert.deepEqual(violations, [],
    '凭据/数据源设置应由 source 注册，页面不要重复提供入口:\n' + violations.join('\n'));
});
