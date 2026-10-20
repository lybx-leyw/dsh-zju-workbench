import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { initialize, runHost, root } from './profile.mjs';
import { ClassroomError } from '../packages/dsh-zhiyun-campus/src/cas/errors.js';

export function probeCredentials(text) {
  const env = parseEnv(text);
  const username = env.ZJU_USERNAME ?? env.USERNAME;
  const password = env.ZJU_PASSWORD ?? env.PASSWORD;
  const cookie = env.PTA_COOKIE ?? env.PTACOOKIE;
  if (!username || !password || !cookie) throw new Error('ENV_INCOMPLETE');
  return { username, password, cookie };
}

export function requestBudget(fetcher, { maxRequests = 12, maxLogins = 1, requestOffset = 0, allowedHosts = ['zjuam.zju.edu.cn', 'courses.zju.edu.cn', 'identity.zju.edu.cn', 'pintia.cn'], record = () => {} } = {}) {
  let requests = 0, logins = 0, pta = 0, stopped = false;
  return async (url, init = {}) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password || !allowedHosts.includes(target.hostname)) {
      throw new ClassroomError('UNEXPECTED_HOST', '实验拒绝未批准的目标');
    }
    const login = target.hostname === 'zjuam.zju.edu.cn' && (init.method ?? 'GET').toUpperCase() === 'POST';
    const isPta = target.hostname === 'pintia.cn';
    if (stopped || requests >= maxRequests || (login && logins >= maxLogins) || (isPta && pta >= 1)) {
      throw new ClassroomError('REQUEST_BUDGET', '实验请求预算已用完，停止访问');
    }
    requests++;
    if (login) logins++;
    if (isPta) pta++;
    const entry = { request: requestOffset + requests, host: target.hostname, method: init.method ?? 'GET' };
    try {
      const response = await fetcher(url, init);
      entry.status = response.status;
      if (response.headers.get('location')) { try { entry.locationHost = new URL(response.headers.get('location'), target).hostname; } catch {} }
      if (response.status === 429 || response.status === 403) stopped = true;
      record(entry);
      return response;
    } catch (error) {
      stopped = true;
      record({ ...entry, failed: true });
      throw error;
    }
  };
}

export async function runProbe(ctx, { envFile, reportFile, sessionDir, resume = false }) {
  const { Transport } = await import('../packages/dsh-zhiyun-campus/src/cas/transport.js');
  const { SessionStore } = await import('../packages/dsh-zhiyun-campus/src/cas/session.js');
  const { xzzdLogin, xzzdAuthorize } = await import('../packages/dsh-zhiyun-campus/src/cas/login.js');
  const { XzzdApi, hasXzzdSession } = await import('../packages/dsh-zhiyun-campus/src/xzzd.js');
  const { PtaApi, parsePtaCookie } = await import('../packages/dsh-zhiyun-campus/src/pta.js');
  const { CAMPUS_HOSTS } = await import('../packages/dsh-zhiyun-campus/src/hosts.js');
  const { createEgress, loadUndici } = await import('../packages/dsh-zhiyun-campus/src/egress.js');
  const account = probeCredentials(await readFile(envFile, 'utf8'));
  const undici = await loadUndici();
  if (!undici) throw new Error('UNDICI_UNAVAILABLE');
  const egress = createEgress({ mode: 'direct', undici });
  const report = resume ? JSON.parse(await readFile(reportFile, 'utf8')) : { startedAt: new Date().toISOString(), hostContext: Boolean(ctx.profileContext?.dir), requests: [], results: {} };
  if (resume) report.resumedAt = new Date().toISOString();
  const fetcher = requestBudget(egress.send, { maxRequests: 12 - report.requests.length, maxLogins: resume === 'sso' ? 0 : 1, requestOffset: report.requests.length, record: entry => report.requests.push(entry) });
  const session = new SessionStore({ file: path.join(sessionDir, 'xzzd.session') });
  const transport = new Transport({ session, hosts: CAMPUS_HOSTS, fetch: fetcher, timeoutMs: 12000 });
  const ptaTransport = new Transport({ hosts: CAMPUS_HOSTS, fetch: fetcher, timeoutMs: 12000 });
  const check = async (name, fn) => {
    try { report.results[name] = { ok: true, ...await fn() }; }
    catch (error) { report.results[name] = { ok: false, code: error.code ?? 'PROBE_FAILED' }; }
    await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  };
  try {
    if (!resume) await check('pta', async () => {
      const parsed = parsePtaCookie(account.cookie);
      if (!parsed) throw Object.assign(new Error(), { code: 'COOKIE_PARSE' });
      for (const pair of parsed.cookie.split(';')) await ptaTransport.session.jar.setCookie(pair.trim() + '; Path=/; Secure', 'https://pintia.cn/');
      const result = await new PtaApi(ptaTransport).problemSets();
      return { rows: result.problemSets.length, total: result.total };
    });
    await check('xzzd', async () => {
      await session.load();
      if (resume === 'sso') await xzzdAuthorize(transport);
      else if (!await hasXzzdSession(transport)) await xzzdLogin(transport, account);
      const client = new XzzdApi(transport);
      const semesters = await client.activeSemesterIds();
      const courses = await client.courses(semesters);
      return { semesterCount: semesters.length, courseCount: courses.length };
    });
  } finally { await egress.close(); }
  return report;
}

async function main() {
  probeCredentials(await readFile(path.join(root, '.env'), 'utf8'));
  const resume = process.argv.includes('--resume-sso') ? 'sso' : process.argv.includes('--resume-storage') ? 'storage' : false;
  if (!process.argv.includes('--live') && !resume) {
    console.log('Credential fields ready; zero network requests. --live runs one bounded real-host experiment.');
    return;
  }
  const { dpapi } = await import('../packages/dsh-zhiyun-campus/src/cas/session.js');
  await dpapi(Buffer.from('offline-storage-preflight'));
  const evidence = path.join(root, 'artifacts', 'campus-live');
  if (resume) {
    const previous = JSON.parse(await readFile(path.join(evidence, 'report.json'), 'utf8'));
    const expected = resume === 'sso' ? 'AUTH_REDIRECT' : 'STORAGE';
    const posts = previous.requests.filter(r => r.method === 'POST').length;
    if (previous.results.xzzd?.code !== expected || posts !== (resume === 'sso' ? 1 : 0) || previous.requests.length >= 12) throw new Error('RESUME_NOT_ALLOWED');
  }
  await mkdir(evidence, { recursive: true });
  const runtime = await initialize({ home: path.join(evidence, 'home') });
  const plugin = path.join(runtime.profile, 'node_modules', 'zhiyun-live-probe');
  await mkdir(plugin, { recursive: true });
  const config = { resume, envFile: path.join(root, '.env'), reportFile: path.join(evidence, 'report.json'), sessionDir: path.join(evidence, 'sessions') };
  await writeFile(path.join(plugin, 'package.json'), JSON.stringify({ name: 'zhiyun-live-probe', type: 'module', main: 'index.js', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(path.join(plugin, 'cordis.patch.yml'), '- insert:\n    - id: zhiyun-live-probe\n      name: zhiyun-live-probe\n');
  await writeFile(path.join(plugin, 'index.js'), `import { runProbe } from ${JSON.stringify(pathToFileURL(fileURLToPath(import.meta.url)).href)};\nexport const inject = ['profileContext'];\nexport async function apply(ctx) { try { const report = await runProbe(ctx, ${JSON.stringify(config)}); console.log('CAMPUS_PROBE_RESULT=' + JSON.stringify(report)); } catch { console.log('CAMPUS_PROBE_FATAL'); } }\n`);
  const manifestFile = path.join(runtime.profile, 'package.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  if (!manifest.dsh.profile.bundles.includes('zhiyun-live-probe')) manifest.dsh.profile.bundles.push('zhiyun-live-probe');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  // A crash also consumes the experiment. Never remove this latch automatically.
  await writeFile(path.join(evidence, resume ? resume + '-resume.json' : 'attempt.json'), JSON.stringify({ startedAt: new Date().toISOString(), maxRequests: 12, maxCredentialPosts: 1 }), { flag: 'wx' });
  const server = runHost(runtime, ['--no-open', '--port', '0'], { pipe: true });
  await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => { server.kill(); reject(new Error('HOST_PROBE_TIMEOUT')); }, 90000);
    const consume = chunk => {
      output += chunk;
      const match = output.match(/CAMPUS_PROBE_RESULT=([^\r\n]+)/);
      if (match || output.includes('CAMPUS_PROBE_FATAL')) {
        clearTimeout(timer); server.kill();
        if (match) { console.log(match[1]); resolve(); }
        else reject(new Error('HOST_PROBE_FATAL'));
      }
    };
    server.stdout.setEncoding('utf8'); server.stderr.setEncoding('utf8');
    server.stdout.on('data', consume); server.stderr.on('data', consume);
    server.on('error', error => { clearTimeout(timer); reject(error); });
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`HOST_EXIT_${code}`)); });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}




