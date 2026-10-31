// dsh-zhiyun-core-classroom-stage 的契约测试。
//
// 覆盖任务书的三条验证：
//   1. 动作账本按序重放，得到**相同终态**（宿主折叠 vs 重新折叠，逐字段深比较）；
//   2. 乱序 / 重复 seq 被拒，且拒绝不污染账本；
//   3. `<ClassroomStage>` 在 `renderToStaticMarkup` 下不抛。
//
// 另补两条「搬运有没有走样」的断言：
//   - `wb_edit_code` 的行序与上游 `executeWbEditCode` 一致（插入锚点/替换复用 id）；
//   - 时间轴的时长来自上游 `choreography/timing.ts`（开门 2000 / 淡入 800 …）。
//
// 跑法：`node --test tests/classroom-stage.test.mjs`

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const pkgDir = path.join(root, 'packages/dsh-zhiyun-core-classroom-stage');

const plugin = await import(pathToFileURL(path.join(pkgDir, 'src/index.js')).href);
const ledgerModule = await import(pathToFileURL(path.join(pkgDir, 'src/ledger.js')).href);
const timelineModule = await import(pathToFileURL(path.join(pkgDir, 'src/timeline.js')).href);

const { foldRecords, STAGE_ACTION_TYPES, STAGE_EXECUTED_TYPES } = ledgerModule;
const { buildTimeline, WB_OPEN_MS, WB_DRAW_MS } = timelineModule;

// ── 测试装置 ────────────────────────────────────────────────────────────────

/** 最小 Cordis 假 ctx（与其它领域包的测试同形状）。 */
function makeCtx({ provideThrows = false } = {}) {
  const provided = new Map();
  const disposers = [];
  const logs = [];
  const ctx = {
    logger: {
      debug: (...args) => logs.push(['debug', ...args]),
      info: (...args) => logs.push(['info', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    get: (serviceName) => provided.get(serviceName),
    provide: (serviceName, value) => {
      if (provideThrows) throw new Error(`service ${serviceName} already registered`);
      provided.set(serviceName, value);
      return () => provided.delete(serviceName);
    },
    on: (event, handler) => {
      if (event === 'dispose') disposers.push(handler);
    },
  };
  return { ctx, provided, disposers, logs };
}

function mount(config = {}, options = {}) {
  const harness = makeCtx(options);
  const dispose = plugin.apply(harness.ctx, config);
  return { ...harness, dispose, service: harness.provided.get('zhiyunClassroomStage') };
}

/** 一段覆盖全部落地分支的动作序列（顺序与上游播放一致：先切场景再画）。 */
const SCRIPT = [
  { type: 'scene_switch', sceneId: 'scene-1' },
  { type: 'speech', text: '这一页我们看三个公式。' },
  { type: 'spotlight', elementId: 'title', dimOpacity: 0.6 },
  { type: 'wb_open' },
  { type: 'wb_draw_text', elementId: 'note-1', content: '先记结论', x: 80, y: 90 },
  { type: 'wb_draw_latex', elementId: 'f-1', latex: 'E = mc^2', x: 80, y: 200 },
  { type: 'wb_draw_shape', elementId: 'box-1', shape: 'rectangle', x: 500, y: 120, width: 200, height: 120 },
  { type: 'wb_draw_line', elementId: 'ln-1', startX: 100, startY: 400, endX: 300, endY: 500 },
  {
    type: 'wb_draw_code',
    elementId: 'code-1',
    language: 'javascript',
    code: 'const a = 1;\nconst b = 2;',
    x: 500,
    y: 300,
  },
  { type: 'wb_edit_code', elementId: 'code-1', operation: 'insert_after', lineId: 'L1', content: 'const c = 3;' },
  { type: 'wb_draw_table', elementId: 'tb-1', data: [['量', '值'], ['a', '1']], x: 80, y: 560 },
  { type: 'wb_draw_chart', elementId: 'ch-1', chartType: 'bar', data: [1, 2, 3], x: 400, y: 560 },
  { type: 'laser', elementId: 'f-1', color: '#00ff88' },
  { type: 'widget_setState', state: 'idle' },
  { type: 'wb_draw_shape', elementId: 'drop-me', shape: 'circle', x: 10, y: 10, width: 40, height: 40 },
  { type: 'wb_delete', elementId: 'drop-me' },
  { type: 'wb_clear' },
  { type: 'scene_switch', sceneId: 'scene-2' },
  { type: 'wb_close' },
];

/** 把 SCRIPT 灌进一个 run，返回该 run 的 ledger。 */
function seed(service, runId) {
  SCRIPT.forEach((action) => service.dispatch({ ...action }, { runId }));
  return service.ledger(runId);
}

// ── 1. 装配 ─────────────────────────────────────────────────────────────────

test('apply() 提供 zhiyunClassroomStage，且三个方法都在', () => {
  const { service, logs } = mount();
  assert.ok(service, 'apply 后应 provide zhiyunClassroomStage');
  assert.equal(typeof service.dispatch, 'function');
  assert.equal(typeof service.ledger, 'function');
  assert.equal(typeof service.reset, 'function');
  assert.ok(logs.some(([level]) => level === 'info'), '启动应留下一条 info 日志');
});

test('provide 抛错时 apply 不抛，工作台还活着', () => {
  const { service, logs } = mount({}, { provideThrows: true });
  assert.equal(service, undefined);
  assert.ok(logs.some(([level]) => level === 'error'));
});

test('动作类型覆盖 15/22', () => {
  assert.equal(STAGE_ACTION_TYPES.length, 22);
  assert.equal(STAGE_EXECUTED_TYPES.length, 15);
  assert.equal(plugin.STAGE_PASSTHROUGH_TYPES.length, 7);
});

// ── 2. 按序重放：终态相同 ────────────────────────────────────────────────────

test('账本按序重放得到相同终态', () => {
  const { service } = mount();
  const book = seed(service, 'run-a');

  assert.equal(book.records.length, SCRIPT.length);
  assert.deepEqual(book.records.map((record) => record.seq), SCRIPT.map((_, index) => index));
  assert.equal(book.lastSeq, SCRIPT.length - 1);

  // 终态的形状：两张场景都进过 trail，白板被清过又关掉，元素清空。
  assert.equal(book.state.sceneId, 'scene-2');
  assert.deepEqual(book.state.sceneTrail, ['scene-1', 'scene-2']);
  assert.equal(book.state.whiteboard.open, false);
  assert.deepEqual(book.state.whiteboard.elements, []);

  // 重放：用账本自己的记录再折一遍，必须逐字段相同。
  assert.deepEqual(foldRecords(book.records), book.state);
  // 连折两遍也相同（纯函数、无时钟、无随机）。
  assert.equal(JSON.stringify(foldRecords(book.records)), JSON.stringify(foldRecords(book.records)));
});

test('同一脚本在两个 run 上得到同一终态（run 之间互不影响）', () => {
  const { service } = mount();
  const a = seed(service, 'run-a');
  const b = seed(service, 'run-b');
  assert.deepEqual(a.state, b.state);
  assert.notDeepEqual(a.records.map((record) => record.id), b.records.map((record) => record.id));
});

test('白板动作在清板前确实落在画布上（省略 id 也能重放）', () => {
  const { service } = mount();
  ['wb_draw_text', 'wb_draw_latex', 'wb_draw_shape', 'wb_draw_line', 'wb_draw_code'].forEach((type, index) => {
    service.dispatch({
      type,
      content: '内容',
      latex: 'x^2',
      shape: 'triangle',
      code: 'a',
      x: 10 * index,
      y: 20,
      width: 100,
      height: 100,
      startX: 0,
      startY: 0,
      endX: 10,
      endY: 10,
    }, { runId: 'ids' });
  });
  const book = service.ledger('ids');
  assert.deepEqual(book.state.whiteboard.elements.map((el) => el.id), [
    'el_0', 'el_1', 'el_2', 'el_3', 'el_4',
  ]);
  // 隐式开板：没有 wb_open，但画了东西就是开着的。
  assert.equal(book.state.whiteboard.open, true);
  assert.deepEqual(foldRecords(book.records).whiteboard.elements, book.state.whiteboard.elements);
});

test('wb_draw_text 的公式会被提升成 latex 元素（上游 engine.ts:472-482）', () => {
  const { service } = mount();
  service.dispatch({ type: 'wb_draw_text', elementId: 'f', content: '$$\\frac{1}{2}$$', x: 0, y: 0 });
  service.dispatch({ type: 'wb_draw_text', elementId: 't', content: '普通文字', x: 0, y: 100 });
  const [latex, text] = service.ledger().state.whiteboard.elements;
  assert.equal(latex.type, 'latex');
  assert.equal(latex.latex, '\\frac{1}{2}');
  assert.equal(text.type, 'text');
  assert.match(text.content, /<p style="font-size: 18px;">普通文字<\/p>/);
});

test('wb_edit_code 的行序与上游一致，且行 id 由 seq 派生（可复现）', () => {
  const { service } = mount();
  service.dispatch({ type: 'wb_draw_code', elementId: 'c', code: 'a\nb\nc', x: 0, y: 0 });
  service.dispatch({ type: 'wb_edit_code', elementId: 'c', operation: 'insert_after', lineId: 'L1', content: 'x' });
  service.dispatch({ type: 'wb_edit_code', elementId: 'c', operation: 'delete_lines', lineIds: ['L3'] });
  service.dispatch({ type: 'wb_edit_code', elementId: 'c', operation: 'replace_lines', lineIds: ['L1'], content: 'A1\nA2' });

  const book = service.ledger();
  const code = book.state.whiteboard.elements[0];
  assert.deepEqual(code.lines.map((line) => line.content), ['A1', 'A2', 'x', 'b']);

  // 第一次插入的行 id 是 `L_1_1`（seq=1）；被替换行复用原 id，多出来的用 seq=3 派生。
  assert.deepEqual(code.lines.map((line) => line.id), ['L1', 'L_3_2', 'L_1_1', 'L2']);
  assert.deepEqual(foldRecords(book.records), book.state);
});

test('reset(runId) 只清指定 run，重置后 seq 从 0 重新计', () => {
  const { service } = mount();
  seed(service, 'keep');
  seed(service, 'drop');
  assert.deepEqual(service.reset('drop'), { runId: 'drop', removed: SCRIPT.length });
  assert.equal(service.ledger('drop').records.length, 0);
  assert.equal(service.ledger('keep').records.length, SCRIPT.length);
  assert.equal(service.dispatch({ type: 'laser', elementId: 'x' }, { runId: 'drop' }).seq, 0);
});

// ── 3. 乱序 / 重复 seq 被拒 ─────────────────────────────────────────────────

test('乱序 seq 被拒，账本保持不变', () => {
  const { service } = mount();
  service.dispatch({ type: 'spotlight', elementId: 'a', seq: 0 }, { runId: 'order' });

  assert.throws(
    () => service.dispatch({ type: 'spotlight', elementId: 'b', seq: 2 }, { runId: 'order' }),
    (error) => error.code === 'E_SEQ_OUT_OF_ORDER',
  );
  assert.throws(
    () => service.dispatch({ type: 'spotlight', elementId: 'b', seq: 1.5 }, { runId: 'order' }),
    (error) => error.code === 'E_SEQ_INVALID',
  );
  assert.throws(
    () => service.dispatch({ type: 'spotlight', elementId: 'b', seq: -1 }, { runId: 'order' }),
    (error) => error.code === 'E_SEQ_INVALID',
  );

  const book = service.ledger('order');
  assert.equal(book.records.length, 1);
  assert.equal(book.lastSeq, 0);
});

test('重复 seq 被拒（即使动作内容相同）', () => {
  const { service } = mount();
  const action = { type: 'spotlight', elementId: 'a', seq: 0 };
  service.dispatch({ ...action }, { runId: 'dup' });

  assert.throws(
    () => service.dispatch({ ...action }, { runId: 'dup' }),
    (error) => error.code === 'E_SEQ_DUPLICATE',
  );
  assert.equal(service.ledger('dup').records.length, 1);
});

test('显式 seq 严格递增时被接受', () => {
  const { service } = mount();
  const first = service.dispatch({ type: 'laser', elementId: 'a', seq: 0 }, { runId: 'ok' });
  const second = service.dispatch({ type: 'laser', elementId: 'b', seq: 1 }, { runId: 'ok' });
  assert.equal(first.seq, 0);
  assert.equal(second.seq, 1);
  assert.equal(service.ledger('ok').lastSeq, 1);
});

test('未知类型 / 非法形状在写入前被拒，账本不脏', () => {
  const { service } = mount();

  assert.throws(
    () => service.dispatch({ type: 'wb_teleport' }),
    (error) => error.code === 'E_UNKNOWN_ACTION',
  );
  assert.throws(
    () => service.dispatch({ type: 'wb_draw_shape', shape: 'star', x: 0, y: 0, width: 10, height: 10 }),
    (error) => error.code === 'E_LEGACY_SHAPE',
  );
  assert.throws(
    () => service.dispatch({ type: 'wb_draw_shape', shape: 'custom', path: 'M0 0', x: 0, y: 0, width: 10, height: 10 }),
    (error) => error.code === 'E_LEGACY_SHAPE',
  );
  assert.throws(
    () => service.dispatch({ type: 'wb_draw_shape', shape: 'rectangle', x: 0, y: 0, width: 0, height: 10 }),
    (error) => error.code === 'E_SHAPE_GEOMETRY',
  );
  assert.throws(
    () => service.dispatch(null),
    (error) => error.code === 'E_INVALID_ACTION',
  );

  assert.equal(service.ledger('default').records.length, 0);
});

// ── 4. 时间轴 ───────────────────────────────────────────────────────────────

test('时间轴帧数与时长来自上游 timing 常量', () => {
  const { service } = mount();
  service.dispatch({ type: 'wb_open' }, { runId: 't' });
  service.dispatch({ type: 'wb_draw_text', elementId: 'a', content: 'hi', x: 0, y: 0 }, { runId: 't' });
  const book = service.ledger('t');
  const timeline = buildTimeline(book.records);

  assert.equal(timeline.frames.length, book.records.length + 1);
  assert.equal(timeline.frames[0].state.whiteboard.open, false);
  assert.equal(timeline.frames[1].duration, WB_OPEN_MS);
  assert.equal(timeline.frames[2].duration, WB_DRAW_MS / 1);
  assert.equal(timeline.durationMs, WB_OPEN_MS + WB_DRAW_MS);
  // 帧与折叠状态对齐（效果之外的字段必须一致）。
  assert.deepEqual(timeline.state.whiteboard, book.state.whiteboard);
});

test('时间轴按 EFFECT_AUTO_CLEAR_MS 抹掉过期的高亮', () => {
  const { service } = mount();
  service.dispatch({ type: 'spotlight', elementId: 'a' }, { runId: 'fx' });
  service.dispatch({ type: 'speech', text: '这是一段足够长的讲解文字用来把时间推过去'.repeat(3) }, { runId: 'fx' });
  const timeline = buildTimeline(service.ledger('fx').records);
  assert.equal(timeline.frames[1].state.effects.spotlight.elementId, 'a');
  assert.equal(timeline.frames[2].state.effects.spotlight, null);
});

// ── 5. 客户端：服务端静态渲染不抛 ───────────────────────────────────────────

/**
 * 把 client.jsx 打成可 import 的 ESM。
 *
 * 渲染层换成桩：本测试只回答「组件树能不能渲染出 HTML」，真渲染树由
 * `dsh-zhiyun-classroom-renderer` 自己的测试负责（那里 vendor 了上游产物）。
 */
async function loadClient() {
  const { build } = await import('esbuild');
  const dir = await mkdtemp(path.join(root, '.verify-stage-render-'));
  const outfile = path.join(dir, 'client.mjs');
  try {
    await build({
      entryPoints: [path.join(pkgDir, 'src/client.jsx')],
      bundle: true,
      write: true,
      outfile,
      format: 'esm',
      jsx: 'automatic',
      logLevel: 'silent',
      external: ['react', 'react/jsx-runtime', 'react-dom'],
      loader: { '.css': 'text' },
      plugins: [{
        name: 'stub-renderer',
        setup(builder) {
          builder.onResolve({ filter: /^dsh-zhiyun-classroom-renderer$/ }, () => ({
            path: 'renderer-stub',
            namespace: 'stub',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
            contents: `
              import React from "react";
              export function ClassroomSlide({ slide, width }) {
                return React.createElement("div", {
                  className: "stub-slide",
                  "data-slide": slide?.id ?? "",
                  "data-width": width,
                }, (slide?.elements ?? []).map((el) => el.content ?? el.id));
              }
              export default ClassroomSlide;
            `,
          }));
        },
      }],
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const SCENES = [
  {
    id: 'scene-1',
    content: {
      type: 'slide',
      canvas: {
        id: 'slide-1',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        elements: [
          { id: 'title', type: 'text', left: 100, top: 80, width: 800, height: 60, content: '第一页' },
        ],
      },
    },
  },
  {
    id: 'scene-2',
    content: {
      type: 'slide',
      canvas: {
        id: 'slide-2',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        elements: [
          { id: 'title-2', type: 'text', left: 100, top: 80, width: 800, height: 60, content: '第二页' },
        ],
      },
    },
  },
];

test('<ClassroomStage> 在 renderToStaticMarkup 下不抛（空账本 / 有账本 / 末帧）', async () => {
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const client = await loadClient();
  assert.equal(typeof client.ClassroomStage, 'function');

  const { service } = mount();
  const empty = service.ledger('none');
  seed(service, 'full');
  const full = service.ledger('full');

  const render = (props) => renderToStaticMarkup(
    React.createElement(client.ClassroomStage, props),
  );

  // 空账本：没有场景、没有画布内容，但结构必须出来。
  const emptyHtml = render({ scenes: [], ledger: empty });
  assert.match(emptyHtml, /class="zyc-stage/);
  assert.match(emptyHtml, /zyc-stage-empty/);

  // 第一帧：场景 0 + 渲染层桩（证明真的调用了渲染器）。
  const firstHtml = render({ scenes: SCENES, ledger: full });
  assert.match(firstHtml, /stub-slide/);
  assert.match(firstHtml, /data-slide="slide-1"/);
  assert.doesNotMatch(firstHtml, /zyc-stage-board/);

  // 末帧：账本里画过白板又清过，末帧应该只剩关着的板（不渲染）。
  const lastHtml = render({ scenes: SCENES, ledger: full, startFrame: Number.MAX_SAFE_INTEGER });
  assert.match(lastHtml, /data-scene="scene-2"/);
  assert.doesNotMatch(lastHtml, /zyc-stage-board/);

  // 中段某一帧：白板开着且有元素。
  const timeline = buildTimeline(full.records);
  const boardFrame = timeline.frames.findIndex((frame) => frame.state.whiteboard.open
    && frame.state.whiteboard.elements.length > 0);
  assert.ok(boardFrame > 0);
  const boardHtml = render({ scenes: SCENES, ledger: full, startFrame: boardFrame });
  assert.match(boardHtml, /zyc-stage-board/);
  assert.match(boardHtml, /zyc-stage-board-text/);
});

test('账本可序列化传输：JSON 往返后重放终态不变', () => {
  const { service } = mount();
  const book = seed(service, 'wire');
  const roundTrip = JSON.parse(JSON.stringify(book.records));
  assert.deepEqual(foldRecords(roundTrip), book.state);
});
