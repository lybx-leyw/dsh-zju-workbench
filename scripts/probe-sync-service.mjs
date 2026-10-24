// 手动探针：起真服务，逐项打四种鉴权组合，把状态码打出来。
//
// 与 `tests/sync-service.test.mjs` 的区别：那个是断言，这个只是**看一眼**。
// 排查"测试说我代码错了，但我看不出哪错"时用它。
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SERVER = path.join(import.meta.dirname, '..', 'deploy', 'sync-service', 'server.py');
const WRITE = 'wk-123456';
const READ = 'rk-123456';

const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

const port = await freePort();
const dir = await mkdtemp(path.join(tmpdir(), 'sync-probe-'));
const child = spawn('python', [SERVER], {
  env: {
    ...process.env,
    SYNC_PORT: String(port),
    SYNC_STORE: path.join(dir, 'sync.json'),
    WRITEKEY: WRITE,
    READKEY: READ,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (buf) => process.stderr.write(`[server] ${buf}`));

const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i += 1) {
  try {
    if ((await fetch(`${base}/health`)).ok) break;
  } catch { /* not up yet */ }
  await new Promise((r) => setTimeout(r, 100));
}

const body = JSON.stringify({ items: [{ id: 'a', title: 't' }], contractVersion: 1 });

const probe = async (label, url, init) => {
  const res = await fetch(url, init);
  console.log(`${label.padEnd(28)} ${res.status}`);
};

await probe('读密钥 PUT（期望 404）', `${base}/sync`, {
  method: 'PUT',
  headers: { 'X-Zy-Write-Key': READ },
  body,
});
await probe('正确写密钥 PUT（期望 200）', `${base}/sync`, {
  method: 'PUT',
  headers: { 'X-Zy-Write-Key': WRITE },
  body,
});
await probe('写密钥 GET（期望 404）', `${base}/sync`, {
  headers: { 'X-Zy-Read-Key': WRITE },
});
await probe('正确读密钥 GET（期望 200）', `${base}/sync`, {
  headers: { 'X-Zy-Read-Key': READ },
});
await probe('无密钥 GET（期望 404）', `${base}/sync`, {});

child.kill();
await new Promise((r) => child.once('exit', r));
await rm(dir, { recursive: true, force: true });
