import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { build } from 'esbuild';
import { buildClient } from '../build.mjs';

const expectedExports = ['apply', 'applyWithConfig', 'inject', 'installPageShell', 'name', 'normalizeConfig'];

test('published ESM client exports work without a window loader; DSH loader bundle still registers', async () => {
  const result = await buildClient();
  assert.deepEqual(result.errors, []);
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.exports['./client'], { import: './lib/client.mjs', default: './lib/client.js' });
  const client = await import('../lib/client.mjs');
  assert.deepEqual(Object.keys(client).sort(), expectedExports);
  assert.equal(typeof client.applyWithConfig, 'function');
  assert.equal(client.normalizeConfig({ railPosition: 'right' }).railPosition, 'right');
  const bundled = await build({
    stdin: { contents: 'export { applyWithConfig } from "@lybx-leyw/dsh-pages/client";', resolveDir: process.cwd() },
    bundle: true, write: false, format: 'esm', platform: 'browser',
    external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
  });
  assert.deepEqual(bundled.warnings, [], 'public subpath must not silently import undefined');
  // DSH clientExportOf reads the string `default`, not Node's import condition.
  const loaderText = await readFile(new URL('../' + manifest.exports['./client'].default, import.meta.url), 'utf8');
  let registration;
  vm.runInNewContext(loaderText, { window: { __ModuleLoader__: { load(value) { registration = value; } } } });
  assert.equal(registration.id, manifest.name);
  const loaded = registration.factory(createRequire(import.meta.url));
  assert.deepEqual(Object.keys(loaded).sort(), expectedExports);
  assert.equal(typeof loaded.applyWithConfig, 'function');
});
