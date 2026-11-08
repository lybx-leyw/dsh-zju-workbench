import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

async function entryScenario(contents) {
  const result = await build({
    stdin: { contents: `import { apply, applyWithConfig } from './src/client.jsx'; ${contents}`, resolveDir: process.cwd(), loader: 'jsx' },
    bundle: true, write: false, platform: 'node', format: 'cjs', external: ['react', 'react-dom'],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

for (const entry of ['apply', 'applyWithConfig']) {
  test(`${entry} installs only the owned overlay, without layout or settings dependencies`, async () => {
    const result = await entryScenario(`
      const { Context } = require('@deepseek-ai/cordis');
      const calls = [];
      let registration, live = 0;
      const ctx = Object.assign(new Context(), {
        locale: { register() { return ctx.effect(() => { calls.push('locale'); live++; return () => { live--; }; }); } },
        slots: {
          inject(name, fn) { return ctx.effect(() => { calls.push(name); return fn(); }); },
          register(options) { return ctx.effect(() => { calls.push('register'); registration = options; live++; return () => { live--; }; }); },
        },
      });
      for (const name of ['layout', 'configForms']) Object.defineProperty(ctx, name, { get() { throw Error('unexpected service: ' + name); } });
      const dispose = ${entry}(ctx);
      const pages = ctx.pages;
      const before = live;
      dispose(); dispose();
      const after = live;
      export { calls, pages, registration, before, after };`);
    assert.deepEqual(result.calls, ['locale', 'shell.overlay', 'register']);
    assert.deepEqual(result.pages.getSnapshot().pages, [], 'disposing removes built-in registrations');
    assert.deepEqual(Object.keys(result.registration.children), ['page.content', 'page.rail-action']);
    assert.equal(result.registration.children['page.rail-action'].kind, 'keyed');
    assert.equal(result.registration.inject().railActionSlot, 'page.rail-action');
    assert.equal(result.registration.children['page.content'].kind, 'keyed');
    assert.equal(typeof result.registration.inject().setPagePinned, 'function');
    assert.equal(typeof result.registration.inject().setRailWidth, 'function');
    assert.equal(result.before, 2);
    assert.equal(result.after, 0);
  });
}

test('invalid config is rejected before host access', async () => {
  const { error } = await entryScenario(`
    let error;
    try { apply(new Proxy({}, { get() { throw Error('host accessed'); } }), { pageSlot: 'main' }); }
    catch (reason) { error = reason.message; }
    export { error };`);
  assert.match(error, /pageSlot.*page\./);
});

test('entry exposes only the formal page-shell API', async () => {
  const { keys } = await entryScenario(`import * as client from './src/client.jsx'; const keys = Object.keys(client).sort(); export { keys };`);
  assert.deepEqual(keys, ['apply', 'applyWithConfig', 'inject', 'installPageShell', 'name', 'normalizeConfig']);
});

test('setup failure unwinds the provided service and locale effects', async () => {
  const { message, live, service } = await entryScenario(`
    const { Context } = require('@deepseek-ai/cordis');
    let live = 0, message;
    const ctx = Object.assign(new Context(), {
      locale: { register() { return ctx.effect(() => { live++; return () => { live--; }; }); } },
      slots: { inject() { throw Error('overlay failed'); } },
    });
    try { apply(ctx); } catch (error) { message = error.message; }
    const service = ctx.get('pages');
    export { message, live, service };`);
  assert.equal(message, 'overlay failed');
  assert.equal(live, 0);
  assert.equal(service, undefined);
});
