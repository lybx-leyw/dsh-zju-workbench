/**
 * 「关掉一个包之后，图还认得它的下游吗」—— r83 的判定。
 *
 * 这组测试钉两件事：
 *   ① **检查器本身是好的**：拿一个「对开关透明」的 buildView（变异体）喂进去，
 *      必须判 `LIVENESS_STABLE` —— 否则那个 `LIVENESS_ERODES` 什么也证明不了
 *      （r69 的教训：判据零判别力时，全绿与全红一样没有信息）。
 *   ② **本仓现状**被如实记录：当前 `buildView` 在关掉一个包之后会让边消失，
 *      并且让**别的**包新获得「可取消」资格。这条是**记录**不是背书 ——
 *      产品决定之后（见报告 §4.4）改实现，这条测试应当随之改成断言新行为。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildView as realBuildView } from '../packages/dsh-zhiyun-page-plugins/src/runtime.js';
import { bundlesOf, edgesOf, planeOf, probe, verdictOf } from '../scripts/radar-provider-liveness.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PKG = ['dsh-zhiyun-core-parser', 'dsh-zhiyun-core-study', 'dsh-zhiyun-page-today'];
const livePlugins = () => PKG.map(name => ({ entryId: `entry:${name}`, moduleName: name, enabled: true, fiberPhase: null }));

test('检查器可跑：真实 buildView 上给出 LIVENESS_ERODES，且报告的是「关谁丢哪条」', () => {
  const result = probe(realBuildView, livePlugins());
  const verdict = verdictOf(result);
  assert.equal(verdict.code, 'LIVENESS_ERODES');
  // 归因必须按「关掉的那一个」分组 —— 而不是笼统一句「有边丢了」。
  const byClosed = Object.fromEntries(verdict.affected.map(item => [item.closed, item.lost]));
  assert.deepEqual(byClosed['dsh-zhiyun-core-parser'], ['dsh-zhiyun-core-study -> dsh-zhiyun-core-parser']);
  assert.deepEqual(byClosed['dsh-zhiyun-page-today'], ['dsh-zhiyun-page-today -> dsh-zhiyun-core-study']);
});

test('真实 buildView：关掉 study-core 之后，parser 被当成叶、并被允许取消', () => {
  // 这是「取消掉不该取消的包」的那条路径：parser 明明还在替 study-core 顶着
  // zhiyunParser，只因为 study-core 不在了，它就变成了「没有任何下游」。
  const result = probe(realBuildView, livePlugins());
  const study = result.cases.find(item => item.closed === 'dsh-zhiyun-core-study');
  assert.ok(study.newlyCancellable.includes('dsh-zhiyun-core-parser'), 'parser 会新获得可取消资格');
  assert.ok(study.lost.includes('dsh-zhiyun-page-today -> dsh-zhiyun-core-study'), 'page-today 连 study-core 的那条边也一并消失');
});

test('基线形状：三包都活着时只有两条边、唯一的叶是 page-today', () => {
  const view = realBuildView({
    bundles: bundlesOf(), modules: [], host: planeOf(PKG), client: planeOf([]), plugins: livePlugins(), slots: [],
  });
  assert.deepEqual([...edgesOf(view)].sort(), [
    'dsh-zhiyun-core-study -> dsh-zhiyun-core-parser',
    'dsh-zhiyun-page-today -> dsh-zhiyun-core-study',
  ]);
  assert.deepEqual(view.leaves, ['dsh-zhiyun-page-today']);
  assert.deepEqual(view.cancellable, ['dsh-zhiyun-page-today']);
});

test('阴性对照（变异体）：把「行被关掉但仍在 requires」的包补进图，判定必须转绿', () => {
  // 变异体只做一件事：**不从 providers/rows 里删掉被关掉的包**，只把 enabled 置 false。
  // 这正是「对开关透明的图」应有的样子。它若仍判 ERODES，说明检查器在乱报。
  const transparent = (args) => {
    const plugins = args.plugins ?? [];
    const closed = new Set(plugins.filter(row => row.enabled === false).map(row => row.moduleName));
    const host = closed.size === 0 ? args.host : planeOf(PKG);
    return realBuildView({ ...args, host });
  };
  const result = probe(transparent, livePlugins());
  assert.equal(verdictOf(result).code, 'LIVENESS_STABLE', '对开关透明的实现不应丢边');
});

test('已知盲区（如实记录）：把图「清空」会被判成 STABLE —— 「什么都没丢」与「本来就没有」同形', () => {
  // 第一版测试写成「空图必须判 ERODES」，实跑打脸：基线边集本身为空时，`lost` 恒为空，
  // 判定只能给 STABLE。这是 r69「判据零判别力」的又一次同构。
  // 所以：① 保留这条测试如实记录盲区；② 真正的防空跑靠上面那条 CLI 测试（它额外断言
  // `lost === 4`，空图不可能凑出 4 条）；③ `main()` 里加了 `baseline 为空即前置失败`。
  const empty = () => ({ rows: [], deps: [], leaves: [], cancellable: [], cycles: [], layerViolations: [], enabled: [], disabled: [], order: [] });
  const result = probe(empty, livePlugins());
  assert.equal(result.baseline.length, 0);
  assert.equal(verdictOf(result).code, 'LIVENESS_STABLE', '空基线无法产生差分 —— 盲区，不辩护');
  assert.equal(verdictOf(result).lost, 0);
});

test('判定只认 buildView 的 deps，不自己重算（避免把被测逻辑抄一遍）', () => {
  const view = realBuildView({
    bundles: bundlesOf(), modules: [], host: planeOf(PKG), client: planeOf([]), plugins: livePlugins(), slots: [],
  });
  const edges = edgesOf(view);
  for (const row of view.rows) assert.equal(row.deps.length, [...row.deps].length);
  assert.equal(edges.size, view.rows.reduce((sum, row) => sum + row.deps.length, 0));
});

test('检查器脚本本身可从命令行跑（--json 可被解析，退出码与判定一致）', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const script = path.join(root, 'scripts/radar-provider-liveness.mjs');
  await assert.rejects(
    () => run(process.execPath, [script, '--json'], { maxBuffer: 4 * 1024 * 1024 }),
    (error) => {
      assert.equal(error.code, 1, 'LIVENESS_ERODES 时退出码必须是 1');
      const parsed = JSON.parse(error.stdout);
      assert.equal(parsed.verdict.code, 'LIVENESS_ERODES');
      assert.equal(parsed.verdict.lost, 4);
      return true;
    },
  );
});
