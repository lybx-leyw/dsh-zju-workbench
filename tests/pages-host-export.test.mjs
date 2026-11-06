import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { locateHost } from '../scripts/profile.mjs';

test('real DSH metadata resolver selects a self-registering pages client, while imports select ESM', async t => {
  let host;
  try { host = await locateHost(); } catch { t.skip('requires a supported DSH host installation'); return; }
  const { ClientModuleRegistry } = await import(pathToFileURL(path.join(host.modules, '@deepseek-ai/dsh-client-modules/lib/index.js')));
  // Run the actual host resolver without constructing its Web carrier or Loader.
  const registry = Object.create(ClientModuleRegistry.prototype);
  Object.defineProperty(registry, 'ctx', { value: { loader: {} } });
  registry.pkgMeta = new Map();
  const metadata = registry.resolveMeta('@lybx-leyw/dsh-pages', new URL('../package.json', import.meta.url).href);
  assert.ok(metadata);
  assert.equal(path.basename(metadata.meta.clientPath), 'client.js');
  let registration;
  vm.runInNewContext(await readFile(metadata.meta.clientPath, 'utf8'), {
    window: { __ModuleLoader__: { load(value) { registration = value; } } },
  });
  assert.equal(registration?.id, '@lybx-leyw/dsh-pages');
  assert.equal(typeof registration.factory, 'function');
  const client = await import('@lybx-leyw/dsh-pages/client');
  assert.equal(typeof client.applyWithConfig, 'function');
});
