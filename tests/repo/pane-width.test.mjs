/**
 * 页面侧栏宽度（`--zw-pane-w`）必须与宿主侧栏同宽。
 *
 * # 这条在防什么
 *
 * 这个值曾经是 `229`，算式是「宿主侧栏 280 − 旧页面壳自建的 51px 导轨」。
 * 2026-11 页面壳退役、页面改走 DSH 原生槽之后，**那条自建导轨不存在了**，
 * 229 就变成了一个没有依据的补偿值：实测页面树栏 229px、宿主侧栏 280px，
 * 并排看差了整整 51px。
 *
 * 这类错误不会让任何功能失败，也不会报错 —— 只是两条本该对齐的竖线错开一格。
 * 所以只能靠静态守卫拦。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const css = readFileSync(path.join(ROOT, 'packages/client/ui-shared/src/style.css'), 'utf8');

/** `.ref` 里 `ui-layout/src/client/columns.ts` 的 `SIDEBAR_DEFAULT`。 */
const HOST_SIDEBAR_DEFAULT = 280;

test('--zw-pane-w 等于宿主侧栏出厂宽度', () => {
  const found = /--zw-pane-w:\s*(\d+)px/.exec(css);
  assert.ok(found !== null, 'style.css 里没找到 --zw-pane-w');
  assert.equal(Number(found[1]), HOST_SIDEBAR_DEFAULT,
    `--zw-pane-w 应为 ${HOST_SIDEBAR_DEFAULT}px（宿主侧栏出厂宽度），收到 ${found[1]}px`);
});

test('声明不再使用旧壳的补偿值 229（注释里可以讲这段历史）', () => {
  // 只查**声明**：229 = 280 − 51 是旧页面壳的补偿值，页面壳退役后不该再是生效值。
  //
  // 注释里**允许**提到这个算式 —— 那段说明恰恰是为了让后来的人明白
  // 「229 从哪来、为什么不再用」，删掉它反而会让下一个人重新踩一遍。
  assert.doesNotMatch(css, /--zw-pane-w:\s*229px/, '229px 是旧页面壳的补偿值，页面壳已退役');
});
