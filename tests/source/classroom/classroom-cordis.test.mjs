import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, lock } from '../../../scripts/profile.mjs';
import * as plugin from '../../../packages/source/classroom/src/index.js';

for (const version of lock.hostVersions) test(`actual Cordis ${version}: service mounts, isolates profiles and retracts on disposal`, async t => {
  const modulePath = path.join(root, '.runtime', `dsh-${version}`, 'node_modules', '@deepseek-ai', 'cordis', 'lib', 'index.js');
  try { await access(modulePath); } catch { return t.skip('此宿主未安装'); }
  const { Context } = await import(pathToFileURL(modulePath).href);
  const dir = await mkdtemp(path.join(tmpdir(), 'zw-cordis-'));
  const first = new Context(), second = new Context();
  try {
    first.provide('profileContext', { dir: path.join(dir, 'first') });
    second.provide('profileContext', { dir: path.join(dir, 'second') });
    const fiber = await first.plugin(plugin);
    const other = await second.plugin(plugin);
    const service = first.get('zwClassroom'), isolated = second.get('zwClassroom');
    assert.ok(service); assert.ok(isolated); assert.notEqual(service, isolated);
    await service.transport.session.jar.setCookie('JWTUser=%7B%22sub%22%3A%221%22%7D; Path=/; Secure', 'https://classroom.zju.edu.cn/');
    assert.equal((await service.getCurrentUser()).id, '1'); assert.equal(await isolated.getCurrentUser(), null);
    await fiber.dispose(); assert.equal(service.transport.closed, true); assert.equal(first.get('zwClassroom'), undefined);
    await other.dispose(); assert.equal(isolated.transport.closed, true);
  } finally {
    await first.fiber.dispose();
    await second.fiber.dispose();
    /**
     * Windows 上 `rm -rf` 与「后台仍在写盘的预取任务」会撞车：
     * 目录刚被判定为空、正要 rmdir，另一个句柄又写进一个文件，于是抛
     * `ENOTEMPTY`。`force: true` 只忽略「本来就不存在」，不忽略这个竞态。
     *
     * 重试是最小且正确的修法：目录最终一定会空，只是不保证第一次就空。
     */
    for (let attempt = 0; ; attempt += 1) {
      try { await rm(dir, { recursive: true, force: true }); break; }
      catch (error) {
        if (attempt >= 10 || !['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
    }
  }
});
