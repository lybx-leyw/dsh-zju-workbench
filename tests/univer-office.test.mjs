/**
 * 「Office 接入层」的测试。
 *
 * 覆盖在**没有宿主、不连网**的前提下能钉死的那部分契约：
 *
 *   - 锁版：`upstream.js` 的预期版本、`package.json` 的声明、磁盘上真正装到的
 *     版本三者一致，且必须装在本包**自己的** `node_modules` 下；
 *   - patch 形态：两条 insert 缺一不可 —— 这条是**实测踩出来的**（见下）；
 *   - 声明面：本包自己**不许**声明 `dsh.client`（客户端半边归上游）；
 *   - 宿主半边：状态路由的 200/404 形状与服务提供；
 *   - 上游 `dsh.client.inject` 的 7 个目标在宿主里确实存在。
 *
 * ⚠️ patch 那条是回归测试，钉的是一个真机缺陷：
 *
 *   profile 的层栈**从空条目列表开始**，每个 bundle 的 patch 依次往上追加
 *   （见 dsh-app-boot 的 profile 文档：「the tree is composed by applying each
 *   bundle's patch lists in `dsh.profile.bundles` order over an empty entry list」）。
 *   所以 **bundle 列在 `dsh.profile.bundles` 里并不会自动加载** —— 它必须在自己的
 *   patch 里把自己 insert 进去。
 *
 *   只写「插入上游」那一条的后果是：本包 `src/index.js` **从未被 apply**
 *   （没有日志、状态路由 404），而上游的客户端半边照样进图谱 ——
 *   一半在跑、一半静默不跑，最难查的那种。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { apply, inject, name } from '../packages/dsh-zhiyun-host-office/src/index.js';
import { UPSTREAM_PACKAGE, UPSTREAM_VERSION } from '../packages/dsh-zhiyun-host-office/src/upstream.js';
import { locateHost } from '../scripts/profile.mjs';

const root = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const pkgDir = path.join(root, 'packages', 'dsh-zhiyun-host-office');

const readJson = (absolute) => JSON.parse(readFileSync(absolute, 'utf8'));

/* ────────────────────────── 锁版 ────────────────────────── */

test('锁版：声明、预期、实际安装三者一致，且不允许语义化范围', () => {
  const manifest = readJson(path.join(pkgDir, 'package.json'));
  const declared = manifest.dependencies?.[UPSTREAM_PACKAGE];

  assert.equal(declared, UPSTREAM_VERSION, 'package.json 必须写精确版本，不是 ^ 或 ~ 范围');
  assert.match(declared, /^\d+\.\d+\.\d+$/, '依赖版本必须锁定为精确版本');

  // 真正装到的是哪一份，只有运行时才知道（lockfile、覆盖、npm link 都能改它）。
  // 从插件自己的位置解析：该包只装在 `packages/dsh-zhiyun-host-office/node_modules` 下。
  const require = createRequire(new URL('../packages/dsh-zhiyun-host-office/package.json', import.meta.url));
  const installedFile = require.resolve(`${UPSTREAM_PACKAGE}/package.json`);
  assert.equal(readJson(installedFile).version, UPSTREAM_VERSION);

  // ⚠️ 必须来自本插件自己的 node_modules：Loader 解析的基准是「拥有该行的树」，
  //    依赖装在 profile 根或仓根都会让这一行解不开。
  const normalized = installedFile.split(path.sep).join('/');
  assert.ok(
    normalized.includes(`/packages/dsh-zhiyun-host-office/node_modules/${UPSTREAM_PACKAGE}/`),
    `上游应解析到本插件自己的 node_modules，实际解析到 ${installedFile}`,
  );
});

/* ────────────────────────── patch 形态 ────────────────────────── */

/** 从 patch 里取出所有 `- id: … / name: …` 行对。 */
function patchRows() {
  const source = readFileSync(path.join(pkgDir, 'cordis.patch.yml'), 'utf8');
  return [...source.matchAll(/-\s*id:\s*(\S+)\s*\r?\n\s*name:\s*'?([^'\r\n]+?)'?\s*(?:\r?\n|$)/g)]
    .map(([, id, entryName]) => ({ id, name: entryName.trim() }));
}

test('patch：两条 insert 缺一不可 —— 自己那条漏了宿主半边会静默不跑', () => {
  const manifest = readJson(path.join(pkgDir, 'package.json'));
  const rows = patchRows();

  assert.equal(rows.length, 2, `patch 应恰好两条 insert，实际 ${rows.length} 条：${JSON.stringify(rows)}`);

  // ① 自己 —— 漏了它，src/index.js 永远不会被 apply（状态路由 404、无日志）。
  const self = rows.find((row) => row.name === manifest.name);
  assert.ok(self !== undefined, `patch 必须 insert 自己（${manifest.name}）：bundle 列在 dsh.profile.bundles 里不会自动加载`);
  assert.equal(self.id, 'zhiyun-univer-office');

  // ② 上游 —— 必须用**它自己的名字**，否则客户端图谱扫不到那 7 个 inject。
  const upstream = rows.find((row) => row.name === UPSTREAM_PACKAGE);
  assert.ok(upstream !== undefined, `patch 必须 insert 上游，且行名是 ${UPSTREAM_PACKAGE}（换了名字客户端半边会整块消失）`);
  assert.notEqual(upstream.name, manifest.name, '上游那一行不能用本包的名字');

  // 同名两行会在 Loader 里撞（曾经手工装过一次，真撞过）。
  const names = rows.map((row) => row.name);
  assert.equal(new Set(names).size, names.length, `patch 里出现重复行名：${names.join('、')}`);
});

test('声明面：本包不许声明 dsh.client', () => {
  const manifest = readJson(path.join(pkgDir, 'package.json'));

  // 客户端半边由上游自己的 Loader 行提供。本包一旦声明 dsh.client，宿主会去找
  // 本包的 "./client" 导出；没有就抛「declares dsh.client but exports no ./client bundle」。
  assert.equal(manifest.dsh?.client, undefined, '客户端半边来自上游，本包不声明 dsh.client');
  assert.equal(manifest.exports?.['./client'], undefined, '本包没有客户端产物');

  // 但 patch 声明必须在（这是它进层栈的唯一途径）。
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
});

/* ────────────────────────── 宿主半边 ────────────────────────── */

function createResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { if (body !== undefined) this.body = String(body); },
  };
}

const request = (url) => ({ method: 'GET', url, headers: {} });

/** 只实现本包真正用到的那几个面：logger / inject(webServer) / provide。 */
function createCtx() {
  const routes = [];
  const provided = new Map();
  const info = [];
  const warn = [];

  const ctx = {
    logger: { info: (line) => info.push(line), warn: (line) => warn.push(line) },
    inject(names, callback) {
      assert.deepEqual(names, ['webServer']);
      callback({
        webServer: { register(route) { routes.push(route); return () => { route.disposed = true; }; } },
        effect(factory, label) { assert.equal(typeof label, 'string'); return factory(); },
      });
    },
    provide(service, value) { provided.set(service, value); return () => provided.delete(service); },
  };
  return { ctx, routes, provided, info, warn };
}

test('宿主半边：声明只依赖 profileContext（不 inject 上游服务）', () => {
  // ⚠️ inject 上游提供的服务就等于「上游没就绪时本包一直 pending」，
  //    而本包除了版本核对没有任何必须等上游才能做的事。
  assert.deepEqual(inject, ['profileContext']);
  assert.equal(name, 'zhiyun-univer-office');
});

/** 捕获 apply 期间的 console 输出。 */
function captureConsole() {
  const lines = { log: [], warn: [] };
  const original = { log: console.log, warn: console.warn };
  console.log = (message) => lines.log.push(String(message));
  console.warn = (message) => lines.warn.push(String(message));
  return {
    lines,
    restore() { console.log = original.log; console.warn = original.warn; },
  };
}

test('宿主半边：注册 prefix 状态路由，命中 200 / 其余 404，并提供服务', async () => {
  const { ctx, routes, provided, info, warn } = createCtx();
  const capture = captureConsole();
  let dispose;
  try {
    dispose = await apply(ctx);
  } finally {
    capture.restore();
  }

  assert.equal(routes.length, 1, '本包只有一条自有路由');
  assert.equal(routes[0].kind, 'prefix', "exact 在这个位置拿不到请求（实测 404），成例是 prefix");
  assert.equal(routes[0].path, '/zhiyun-univer-office');

  for (const url of ['/zhiyun-univer-office', '/zhiyun-univer-office/status']) {
    const res = createResponse();
    routes[0].handler(request(url), res);
    assert.equal(res.status, 200, `${url} 应命中`);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.headers['cache-control'], 'no-store', '状态随时会变，不许缓存');
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.status.upstream.package, UPSTREAM_PACKAGE);
    assert.equal(payload.status.upstream.expected, UPSTREAM_VERSION);
    assert.equal(payload.status.upstream.ok, true, '本机装的就是锁版那一份');
  }

  // 前缀路由必须自己按 pathname 分派，否则会把整棵子树都吞掉。
  const miss = createResponse();
  routes[0].handler(request('/zhiyun-univer-office/别的东西'), miss);
  assert.equal(miss.status, 404);
  assert.equal(JSON.parse(miss.body).ok, false);

  // 版本一致时应当是普通 info，不是 warn。
  assert.equal(capture.lines.warn.length, 0, `版本一致却报了警告：${capture.lines.warn.join(' / ')}`);
  assert.equal(capture.lines.log.length, 1);
  assert.match(capture.lines.log[0], /0\.3\.7/);

  // ⚠️ 刻意走 console 而不是 ctx.logger：`ctx.logger.info` 在本机启动日志里看不到，
  //    而「日志里没有这一行」曾被误判成「宿主半边没加载」，白查了好几轮。
  //    锁版的价值全押在这一行刺眼，看不见就等于没锁。
  assert.equal(info.length, 0, '不该走 ctx.logger.info');
  assert.equal(warn.length, 0, '不该走 ctx.logger.warn');

  const service = provided.get('zhiyunUniverOffice');
  assert.ok(service !== undefined, 'ctx.provide 的面要给出去');
  assert.equal(service.status().upstream.ok, true);
  assert.ok(service.upstreamFile().includes('node_modules'), 'upstreamFile 应指向包内那份安装');

  // 卸载要把服务摘掉（Loader 行被移除时不该留下悬空服务）。
  dispose();
  assert.equal(provided.has('zhiyunUniverOffice'), false);
});

/* ────────────────────────── 上游的客户端注入面 ────────────────────────── */

test('上游声明的 7 个 dsh.client.inject 目标在宿主里齐备', async (t) => {
  const upstreamDir = path.join(pkgDir, 'node_modules', UPSTREAM_PACKAGE);
  const targets = readJson(path.join(upstreamDir, 'package.json')).dsh?.client?.inject ?? [];
  assert.equal(targets.length, 7, `上游声明的 inject 目标应为 7 个，实际 ${targets.length} 个`);

  let host;
  try {
    host = await locateHost();
  } catch (error) {
    return t.skip(`本机找不到可用宿主，无法核对 inject 目标：${error.message}`);
  }

  for (const target of targets) {
    const manifest = path.join(host.modules, ...target.split('/'), 'package.json');
    let version = null;
    try { version = readJson(manifest).version; } catch { /* 下面统一报 */ }
    assert.ok(version !== null, `上游要注入 ${target}，但宿主里没有这个包（客户端图谱会缺行）`);
  }
});
