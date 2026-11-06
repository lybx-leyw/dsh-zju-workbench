import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

/** 起一个最小的笔记库服务（不启整个 Cordis）。 */
export async function makeVault() {
  const dir = await mkdtemp(path.join(tmpdir(), 'vault-pdf-'));
  const mod = await import(pathToFileURL(path.join(root, 'packages/dsh-zhiyun-page-notes/src/index.js')).href);
  const provided = {};
  const ctx = {
    profileContext: { dir: path.join(dir, 'profile') },
    logger: { info: () => {}, warn: () => {} },
    inject: (_deps, cb) => cb({
      connection: { fetch: { register: () => () => {} } },
      // PDF 阅读器路由会 `inject(['webServer'])` 注册自己；这里给一个不落地的桩。
      webServer: { register: () => () => {} },
      effect: (fn) => { const d = fn(); return () => { if (typeof d === 'function') d(); }; },
    }),
    provide: (name, value) => { provided[name] = value; return () => {}; },
    get: () => undefined,
  };
  await mod.apply(ctx, { dir: path.join(dir, 'notes') });
  return { dir: path.join(dir, 'notes'), svc: provided.zhiyunVaultNotes, mod, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
