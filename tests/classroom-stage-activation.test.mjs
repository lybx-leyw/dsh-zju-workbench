import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { buildClientPackage } from '../scripts/build.mjs';

const requireHost = createRequire(import.meta.url);

// Reproduce the real client module table, then the Cordis Loader's default-first
// unwrapExports contract. Components may be named exports, never the plugin default.
async function clientModules() {
  const factories = new Map();
  const exports = new Map();
  const scope = vm.createContext({
    console,
    window: { __ModuleLoader__: { load(row) { factories.set(row.id, row.factory); } } },
  });
  for (const name of ['dsh-zhiyun-shell-ui', 'dsh-zhiyun-classroom-renderer']) {
    const text = await readFile(new URL(`../packages/${name}/lib/client.js`, import.meta.url), 'utf8');
    vm.runInContext(text, scope, { filename: `${name}/client.js` });
  }
  for (const name of ['dsh-zhiyun-core-classroom-stage', 'dsh-zhiyun-page-classroom-play']) {
    const { result } = await buildClientPackage(name, { write: false });
    vm.runInContext(result.outputFiles[0].text, scope, { filename: `${name}/client.js` });
  }
  const load = id => {
    if (exports.has(id)) return exports.get(id);
    if (!factories.has(id)) return requireHost(id);
    const value = factories.get(id)(load);
    exports.set(id, value);
    return value;
  };
  return { load, scope };
}

test('stage and play activate their plugin faces rather than invoke React components as plugins', async () => {
  const { load, scope } = await clientModules();
  const stage = load('dsh-zhiyun-core-classroom-stage');
  const play = load('dsh-zhiyun-page-classroom-play');
  assert.equal(typeof stage.ClassroomStage, 'function');
  assert.equal(typeof play.ClassroomPlay, 'function');
  const hooks = [];
  const cleanups = [];
  const styleNodes = new Set();
  scope.document = {
    createElement: () => ({ dataset: {}, remove() { styleNodes.delete(this); } }),
    head: { append(node) { styleNodes.add(node); } },
  };
  const context = {
    effect(fn) { const off = fn(); if (typeof off === 'function') cleanups.push(off); return off; },
    // No pages/studio service: registration must remain lazy, not fail activation.
    inject(keys) { hooks.push([...keys]); },
  };
  for (const [name, module] of [['stage', stage], ['play', play]]) {
    const plugin = module.default ?? module;
    assert.equal(typeof plugin, 'object', `${name}: a React component default overrides named apply and is invoked outside React`);
    assert.equal(plugin.apply, module.apply, `${name}: the loader must receive the named plugin apply`);
    assert.doesNotThrow(() => plugin.apply(context));
  }
  assert.deepEqual(hooks, [['zhiyunClassroomStudio']]);
  assert.equal(styleNodes.size, 1);
  for (const cleanup of cleanups.reverse()) cleanup();
  assert.equal(styleNodes.size, 0);
});
