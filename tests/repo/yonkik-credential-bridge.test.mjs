import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

const vpnRecord = 'zw-campus/webvpn';
const configRecord = 'yonkik/config';
const grant = (payload) => ({ kind: 'grant', payload });
const digest = (value) => createHash('sha256').update(value).digest('hex');

test('YONKIK bridges current WebVPN credentials without exposing or storing them in settings', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'yonkik-bridge-'));
  const oldHome = process.env.YONKIK_HOME;
  process.env.YONKIK_HOME = home;
  t.after(async () => {
    if (oldHome === undefined) delete process.env.YONKIK_HOME;
    else process.env.YONKIK_HOME = oldHome;
    await rm(home, { recursive: true, force: true });
  });
  const { apply } = await import('../../packages/yonkik/yonkik-tool/src/index.js');
  const records = new Map([
    ['zw-classroom/account', grant({ username: 'fixture-cas-user', password: 'fixture-cas-pass' })],
    [vpnRecord, grant({ username: 'fixture-vpn-user', password: 'fixture-vpn-pass' })],
  ]);
  const routes = new Map();
  const credentials = {
    readRecord: async (key) => records.get(key),
    modifyRecord: async (key, fn) => records.set(key, fn(records.get(key))),
  };
  let tool;
  apply({
    get: (key) => key === 'credentials' ? credentials : undefined,
    effect: (fn) => fn(),
    inject: (_deps, fn) => fn({ effect: (cb) => cb(), webServer: {
      register: ({ path, handler }) => routes.set(path, handler),
    } }),
    tools: { register: (def) => { tool = def; } },
  });
  const route = async (url, body) => {
    const req = Object.assign(Readable.from(body ? [JSON.stringify(body)] : []), {
      method: body ? 'POST' : 'GET', url, headers: { 'x-zw-yonkik': '1' },
    });
    let status, raw;
    await routes.get(url.split('?')[0])(req, {
      writeHead: (code) => { status = code; }, end: (value) => { raw = value; },
    });
    assert.equal(status, 200);
    assert.doesNotMatch(raw, /fixture-(?:vpn|cas)-(?:pass|user)/);
    return JSON.parse(raw);
  };

  const settings = '/_dsh/yonkik';
  const check = settings + '/credcheck';
  assert.equal((await route(settings)).credentials.find((c) => c.key === 'webvpn').fromWorkbench, true);
  assert.equal((await route(check)).webvpnBridged, true);
  assert.equal((await route(check)).campusSsoBridged, true);
  await route(settings + '?action=save', { credentials: {}, sites: [] });
  assert.deepEqual(records.get(configRecord), grant({ credentials: {}, sites: [] }));

  const selfcheck = await tool.execute({ script: 'credcheck' });
  assert.equal(selfcheck.ok, true, selfcheck.result.stderr);
  const report = JSON.parse(selfcheck.result.stdout);
  assert.deepEqual(report.webvpn, { present: true, keys: ['键一', '键二'] });
  assert.equal(report['campus-sso'].present, true);
  assert.doesNotMatch(selfcheck.result.stdout, /fixture-(?:vpn|cas)-(?:pass|user)/);

  await writeFile(join(home, 'check.mjs'), [
    "import { createHash } from 'node:crypto';",
    'const vpn = JSON.parse(process.env.YONKIK_CREDENTIALS).webvpn;',
    "console.log(vpn ? createHash('sha256').update(vpn.键一 + ':' + vpn.键二).digest('hex') : 'absent');",
  ].join('\n'));
  const scriptResult = async () => {
    const result = await tool.execute({ script: 'run', args: ['check.mjs'] });
    assert.equal(result.ok, true, result.result.stderr);
    return result.result.stdout.trim();
  };
  assert.equal(await scriptResult(), digest('fixture-vpn-user:fixture-vpn-pass'));
  records.set(vpnRecord, grant({ username: 'fixture-vpn-user', password: 'rotated-test-pass' }));
  assert.equal(await scriptResult(), digest('fixture-vpn-user:rotated-test-pass'));
  records.set(configRecord, grant({ credentials: { webvpn: { 键一: 'manual-test', 键二: 'manual-pass' } } }));
  assert.equal((await route(check)).webvpnBridged, false);
  assert.equal(await scriptResult(), digest('manual-test:manual-pass'));
  records.delete(configRecord);
  records.set(vpnRecord, grant({ username: 'fixture-vpn-user', password: 123 }));
  assert.equal((await route(check)).webvpnBridged, false);
  assert.equal(await scriptResult(), 'absent');
  records.delete(vpnRecord);
  assert.equal((await route(settings)).credentials.some((c) => c.key === 'webvpn'), false);
  assert.equal(await scriptResult(), 'absent');
  await assert.rejects(access(join(home, 'secrets', 'credentials.json')), { code: 'ENOENT' });
});
