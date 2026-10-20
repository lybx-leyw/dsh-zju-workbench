import test from 'node:test';
import assert from 'node:assert/strict';
import { probeCredentials, requestBudget } from '../scripts/campus-live-probe.mjs';

test('probe reads file aliases without using the Windows USERNAME or trimming passwords', () => {
  assert.deepEqual(probeCredentials('USERNAME=student\nPASSWORD=" pass "\nPTACOOKIE="sid=fake"'), { username: 'student', password: ' pass ', cookie: 'sid=fake' });
  assert.throws(() => probeCredentials('PASSWORD=fake'), /ENV_INCOMPLETE/);
});
test('credential POST and PTA read can each be attempted only once', async () => {
  let calls = 0;
  const fetcher = requestBudget(async () => { calls++; return new Response('{}'); });
  await fetcher('https://zjuam.zju.edu.cn/cas/login', { method: 'POST' });
  await assert.rejects(fetcher('https://zjuam.zju.edu.cn/cas/login', { method: 'POST' }), { code: 'REQUEST_BUDGET' });
  await fetcher('https://pintia.cn/api/problem-sets');
  await assert.rejects(fetcher('https://pintia.cn/api/problem-sets'), { code: 'REQUEST_BUDGET' });
  assert.equal(calls, 2);
});
test('network failures and rate limiting stop all further requests', async () => {
  for (const status of [403, 429, null]) {
    let calls = 0;
    const fetcher = requestBudget(async () => {
      calls++;
      if (status === null) throw new Error('offline');
      return new Response('', { status });
    });
    await fetcher('https://pintia.cn/api/problem-sets').catch(() => {});
    await assert.rejects(fetcher('https://zjuam.zju.edu.cn/cas/login'), { code: 'REQUEST_BUDGET' });
    assert.equal(calls, 1);
  }
});
test('request ceiling includes redirects and rejects unapproved hosts before sending', async () => {
  let calls = 0;
  const fetcher = requestBudget(async () => { calls++; return new Response(''); }, { maxRequests: 2 });
  await assert.rejects(fetcher('https://example.org/'), { code: 'UNEXPECTED_HOST' });
  await fetcher('https://courses.zju.edu.cn/user/index');
  await fetcher('https://zjuam.zju.edu.cn/cas/login');
  await assert.rejects(fetcher('https://courses.zju.edu.cn/user/index'), { code: 'REQUEST_BUDGET' });
  assert.equal(calls, 2);
});

test('CAS redirects resolve relative locations and reject foreign origins', async () => {
  const { upgrade } = await import('../packages/dsh-zhiyun-source-campus/src/cas/login.js');
  assert.equal(upgrade('/user/index', 'https://courses.zju.edu.cn/login'), 'https://courses.zju.edu.cn/user/index');
  assert.equal(upgrade('http://courses.zju.edu.cn/user/index'), 'https://courses.zju.edu.cn/user/index');
  for (const url of ['https://example.org/', '//example.org/', 'https://user:pass@courses.zju.edu.cn/', 'https://courses.zju.edu.cn:444/']) {
    assert.throws(() => upgrade(url), { code: 'AUTH_REDIRECT' });
  }
});

test('an existing SSO ticket continues business redirects without another password POST', async () => {
  const { Transport } = await import('../packages/dsh-zhiyun-source-campus/src/cas/transport.js');
  const { CAMPUS_HOSTS } = await import('../packages/dsh-zhiyun-source-campus/src/hosts.js');
  const { xzzdLogin } = await import('../packages/dsh-zhiyun-source-campus/src/cas/login.js');
  const calls = [];
  const transport = new Transport({hosts:CAMPUS_HOSTS, fetch: async (url, init) => {
    calls.push({url, method:init.method});
    if (calls.length === 1) return new Response('', {status:302, headers:{location:'https://identity.zju.edu.cn/login'}});
    if (calls.length === 2) return new Response('', {status:302, headers:{location:'https://courses.zju.edu.cn/user/index'}});
    return new Response('ok', {headers:{'set-cookie':'session=fake; Path=/; Secure'}});
  }});
  await transport.session.jar.setCookie('iPlanetDirectoryPro=fake; Domain=.zju.edu.cn; Path=/; Secure', 'https://zjuam.zju.edu.cn/cas/login');
  await xzzdLogin(transport, {username:'fake', password:'fake'});
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.method === 'GET'));
  assert.equal(CAMPUS_HOSTS.has('identity.zju.edu.cn'), true);
});
