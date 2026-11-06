import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  buildMirrors,
  digestOfEntries,
  firstVerified,
  mirrorCandidates,
  normalizeMirror,
} from '../scripts/fetch-vendor.mjs';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const CANDIDATE = 'https://codeload.github.com/HKUDS/DeepTutor/tar.gz/a31d82624c27d75f4e771d4fcb78dce16470b383';

test('镜像写法：前缀、模板、none 三种都归一成「地址 → 真实地址」', () => {
  const prefix = normalizeMirror('https://ghfast.top/');
  assert.equal(prefix.apply(CANDIDATE), `https://ghfast.top/${CANDIDATE}`);

  const template = normalizeMirror('https://m.example/{url}');
  assert.equal(template.apply(CANDIDATE), `https://m.example/${CANDIDATE}`);

  assert.deepEqual(normalizeMirror('none'), { disabled: true });
  assert.equal(normalizeMirror(''), null);
  assert.throws(() => normalizeMirror('ghfast.top'), /http\(s\):\/\//);
});

test('镜像候选顺序：镜像在前，直连永远留在末尾兜底', () => {
  const mirrors = buildMirrors('https://a.example,https://b.example');
  assert.deepEqual(mirrorCandidates(CANDIDATE, mirrors), [
    `https://a.example/${CANDIDATE}`,
    `https://b.example/${CANDIDATE}`,
    CANDIDATE,
  ]);

  // `none` 关掉整条镜像链路，只剩直连
  assert.deepEqual(mirrorCandidates(CANDIDATE, buildMirrors('none')), [CANDIDATE]);
  // 同一个镜像写了两遍不会重复试两次
  assert.deepEqual(mirrorCandidates(CANDIDATE, buildMirrors('https://a.example,https://a.example/')), [
    `https://a.example/${CANDIDATE}`,
    CANDIDATE,
  ]);
});

test('镜像返回坏内容会被跳过，并回落到直连的同一份内容', async () => {
  const good = Buffer.from('the real tarball');
  const expected = sha256(good);
  const hits = [];
  const fetchOne = async (url) => {
    hits.push(url);
    if (url !== CANDIDATE) return Buffer.from('tampered payload');
    return good;
  };

  const result = await firstVerified(
    mirrorCandidates(CANDIDATE, buildMirrors('https://bad.example')),
    (body) => (sha256(body) === expected ? { ok: true } : { ok: false, reason: 'SHA-256 不符' }),
    { fetchOne, logger: () => {}, retries: 1 },
  );

  assert.equal(result.url, CANDIDATE);
  assert.equal(sha256(result.body), expected);
  assert.deepEqual(hits, [`https://bad.example/${CANDIDATE}`, CANDIDATE]);
});

test('镜像坏内容不会重试同一个地址，网络错误才重试', async () => {
  const expected = sha256(Buffer.from('ok'));
  const hits = [];
  await assert.rejects(
    firstVerified([CANDIDATE], () => ({ ok: false, reason: 'SHA-256 不符' }), {
      fetchOne: async (url) => { hits.push(url); return Buffer.from('bad'); },
      logger: () => {},
      retries: 3,
    }),
    /SHA-256 不符/,
  );
  assert.equal(hits.length, 1);

  const flaky = [];
  await firstVerified([CANDIDATE], (body) => (sha256(body) === expected ? { ok: true } : { ok: false }), {
    fetchOne: async (url) => {
      flaky.push(url);
      if (flaky.length < 3) throw new Error('fetch failed');
      return Buffer.from('ok');
    },
    logger: () => {},
    retries: 3,
  });
  assert.equal(flaky.length, 3);
});

test('全部候选都失败时报错保留每个地址的失败原因', async () => {
  await assert.rejects(
    firstVerified(['https://a.example/x', 'https://b.example/x'], () => ({ ok: true }), {
      fetchOne: async (url) => { throw new Error(url.includes('a.example') ? 'HTTP 502' : 'fetch failed'); },
      logger: () => {},
      retries: 1,
    }),
    (error) => {
      assert.match(error.message, /https:\/\/a\.example\/x: HTTP 502/);
      assert.match(error.message, /https:\/\/b\.example\/x: fetch failed/);
      return true;
    },
  );
});

test('树摘要按路径排序、对内容敏感、忽略运行期产物', () => {
  const entries = [
    { kind: 'file', path: 'b.py', sha: 'x' },
    { kind: 'file', path: 'a.py', sha: 'y' },
  ];
  const forward = digestOfEntries(entries);
  const backward = digestOfEntries([...entries].reverse());
  assert.equal(forward.digest, backward.digest);
  assert.equal(forward.files, 2);

  const changed = digestOfEntries([{ kind: 'file', path: 'a.py', sha: 'z' }, entries[0]]);
  assert.notEqual(changed.digest, forward.digest);

  const withLink = digestOfEntries([...entries, { kind: 'link', path: 'c.py', target: 'a.py' }]);
  assert.notEqual(withLink.digest, forward.digest);
});

test('锁文件里的树摘要与本地快照互相印证（离线，不需要网络）', (t) => {
  const lock = JSON.parse(
    readFileSync(new URL('../packages/dsh-zhiyun-host-deeptutor/upstream.lock.json', import.meta.url), 'utf8'),
  );
  const tree = lock.upstream?.archive?.tree;
  assert.ok(tree, 'upstream.lock.json 应记录 archive.tree');
  assert.equal(tree.algorithm, 'sha256-lines-v1');
  assert.equal(tree.files, 3875);
  // 摘要本身是解包器与锁文件的契约；本地快照是否在盘上由 `npm run vendor:check` 负责，
  // 这里只钉住「不能悄悄改变算法或删掉文件数」。
  assert.match(tree.digest, /^[0-9a-f]{64}$/);
  t.diagnostic(`deeptutor tree digest ${tree.digest.slice(0, 12)}… / ${tree.files} files`);
});
