/**
 * `scripts/radar-host-window.mjs` 的判定层单测。
 *
 * 只测纯函数（`checkWindow` / `grade`）：联网取 manifest 那部分不进单测。
 * 这套判定的价值全在**边界**上 —— 每一条边界都对应本轮真实踩过的坑（2026-10-27 r84）：
 *
 *   1. 宿主层 vs 框架层：`@deepseek-ai/cordis` 是 4.x，混进 0.2.x 宿主比 → 全判不相容（M-1）
 *   2. 锁的版本 vs latest：拿 latest 的 peer 去评锁版 → 凭空多出一个不相容（M-2）
 *   3. 「没有宿主 peer」≠「通过」：它是不表达需求，必须单独一类（与 r81 声明层衔接）
 *   4. 「没查到」≠「不相容」：semver 缺失 / 元数据取不到只能是 `UNKNOWN`
 *   5. 一个宿主满足、一个不满足 → `DRIFT`（这才是「宿主窗口」的字面含义）
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { checkWindow, grade } from '../scripts/radar-host-window.mjs';

const require = createRequire(import.meta.url);
/**
 * semver 的取法跟脚本本体一致：先仓库根，再 `RADAR_SEMVER_DIR`（仓库外的安装点）。
 * 本仓 `npm ci` 长期失败（L-15），沙箱里通常没有 `node_modules` ——
 * 但**不该因此跳过全部边界用例**，那会让这套判定失去回归保护。
 */
const semver = (() => {
  const candidates = ['semver', process.env.RADAR_SEMVER_DIR
    && `${process.env.RADAR_SEMVER_DIR}/node_modules/semver`].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // 下一个
    }
  }
  return null;
})();

// 没有 semver 的环境（本仓 npm ci 长期失败）跳过依赖它的用例，而不是让 CI 红。
const needsSemver = semver ? test : test.skip;

const H = ['0.2.0-rc.2', '0.2.1-alpha.1'];
const D = '@deepseek-ai/';

test('grade：一个宿主 NG → DRIFT（哪怕另一个 OK）', () => {
  assert.equal(grade({ [H[0]]: true, [H[1]]: false }, H), 'DRIFT');
});

test('grade：全部 OK → OK', () => {
  assert.equal(grade({ [H[0]]: true, [H[1]]: true }, H), 'OK');
});

test('grade：全是 null（没查到）→ UNKNOWN，不是 DRIFT', () => {
  assert.equal(grade({ [H[0]]: null, [H[1]]: null }, H), 'UNKNOWN');
});

test('grade：宿主窗口为空 → UNKNOWN（runtime.lock.json 坏了不等于全都不满足）', () => {
  assert.equal(grade({}, []), 'UNKNOWN');
});

test('没有宿主 peer → NO_HOST_PEER，且不计入 OK', () => {
  const { rows, summary } = checkWindow(
    { 'plain-lib': '1.0.0' },
    { 'plain-lib': { cordis: '^4.0.0' } },
    H,
    () => true,
  );
  assert.equal(rows[0].verdict, 'NO_HOST_PEER');
  assert.equal(summary.noHostPeer, 1);
  assert.equal(summary.ok, 0);
});

test('取不到元数据（peers 里没有这个包）→ UNKNOWN', () => {
  const { rows } = checkWindow({ 'ghost@1': '1.0.0' }, {}, H, () => true);
  assert.equal(rows[0].verdict, 'UNKNOWN');
  assert.equal(rows[0].reason, 'no-metadata');
});

needsSemver('框架层 cordis 用 cordisMajor 判，不跟宿主版本混比（M-1）', () => {
  // 上游只声明了 cordis，没声明任何 @deepseek-ai/dsh-*
  const { rows } = checkWindow(
    { pkg: '1.0.0' },
    { pkg: { [`${D}cordis`]: '^4.0.2' } },
    H,
    semver.satisfies,
    4,
  );
  assert.equal(rows[0].verdict, 'NO_HOST_PEER');
  assert.equal(rows[0].frameworkOk, true, 'cordis ^4.0.2 在 cordisMajor=4 下应放行');
});

needsSemver('框架层大版本不符才判 frameworkOk=false（≥5 不该被 4 满足）', () => {
  const { rows } = checkWindow(
    { pkg: '1.0.0' },
    { pkg: { [`${D}cordis`]: '>=5.0.0' } },
    H,
    semver.satisfies,
    4,
  );
  assert.equal(rows[0].frameworkOk, false);
});

needsSemver('`>=0.1.0-rc.5` 不接受 `0.2.0-rc.2`（预发布版被区间排除，npm 实装同判）', () => {
  const { rows } = checkWindow(
    { md: '0.1.2' },
    { md: { [`${D}dsh-client-locale`]: '>=0.1.0-rc.5' } },
    H,
    semver.satisfies,
    4,
  );
  assert.deepEqual(rows[0].hosts, { [H[0]]: false, [H[1]]: false });
  assert.equal(rows[0].verdict, 'DRIFT');
});

needsSemver('`>=0.2.0-rc.2 <0.3.0`：rc 宿主 OK、alpha 宿主 NG → 典型 DRIFT', () => {
  const { rows } = checkWindow(
    { 'kb-rag': '1.6.8' },
    { 'kb-rag': { [`${D}dsh-tools`]: '>=0.2.0-rc.2 <0.3.0' } },
    H,
    semver.satisfies,
    4,
  );
  assert.deepEqual(rows[0].hosts, { [H[0]]: true, [H[1]]: false });
  assert.equal(rows[0].verdict, 'DRIFT');
  assert.equal(rows[0].allHostsOk, false);
});

needsSemver('多个宿主包的 peer 取交集：任一条不满足，该宿主即不满足', () => {
  const { rows } = checkWindow(
    { pkg: '1.0.0' },
    {
      pkg: {
        [`${D}dsh-tools`]: '>=0.2.0-rc.2 <0.3.0',
        [`${D}dsh-llm`]: '^0.2.1-rc.3',
      },
    },
    H,
    semver.satisfies,
    4,
  );
  assert.equal(rows[0].hosts[H[0]], false, 'tools 满足但 llm 不满足 → 该宿主不满足');
});

test('semver 不可用 → 全部 UNKNOWN，且不抛错', () => {
  const { rows, summary } = checkWindow(
    { pkg: '1.0.0' },
    { pkg: { [`${D}dsh-tools`]: '>=0.2.0-rc.2' } },
    H,
    null,
  );
  assert.equal(rows[0].verdict, 'UNKNOWN');
  assert.equal(summary.unknown, 1);
});

test('区间写法非法 → 该宿主判 null（不抛错，也不当成不相容）', () => {
  const throws = () => { throw new Error('bad range'); };
  const { rows } = checkWindow(
    { pkg: '1.0.0' },
    { pkg: { [`${D}dsh-tools`]: 'not-a-range' } },
    H,
    throws,
  );
  assert.deepEqual(rows[0].hosts, { [H[0]]: null, [H[1]]: null });
  assert.equal(rows[0].verdict, 'UNKNOWN');
});
