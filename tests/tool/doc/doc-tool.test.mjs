/**
 * `campus_doc` 工具（`packages/tool/doc`）的守卫。
 *
 * # 这一份守什么
 *
 * 工具层最容易出的错不是业务逻辑，而是**契约漂移**：
 *
 *   - action 表里列了但走不到（模型选了 `pages`，代码却落到 `pdf` 分支）；
 *   - 参数没透传（`out` 被吞掉，产物掉进默认目录，用户找不到）；
 *   - 该在取服务**之前**报的错拖到之后（用户参数写错，却收到「包没装」）；
 *   - 读工具偷偷碰了审批（查个页码也要点同意）。
 *
 * 服务是假的：本文件的目的是「参数怎么翻成服务调用」，不是「PDF 能不能解析」——
 * 后者在 `tests/core/doc` 里对真实的 `pdf-lib` 跑。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { apply, createDocTools, DOC_ACTIONS, inject, splitList } from '../../../packages/tool/doc/src/index.js';

/** 造一个记录调用的假 `zhiyunDoc`。 */
function fakeService() {
  const calls = [];
  const service = {
    text: async (...args) => { calls.push(['text', args]); return { status: 'text' }; },
    pdf: async (...args) => { calls.push(['pdf', args]); return { pages: 1 }; },
    pages: async (...args) => { calls.push(['pages', args]); return { pages: [1] }; },
    find: async (...args) => { calls.push(['find', args]); return { matches: {} }; },
  };
  return { service, calls };
}

/** 取那条工具定义（服务为空表也能构造）。 */
const definition = () => createDocTools({})[0];

/** 挂到最小 ctx 上并拿回宿主工具对象。 */
function registered(services) {
  const tools = [];
  const ctx = {
    get: (key) => services[key],
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    effect: (fn) => fn(),
  };
  apply(ctx);
  return tools;
}

test('一个工具，四个 action —— 与上游 doc 的四条 provides 一一对应', () => {
  const tool = definition();
  assert.equal(tool.name, 'campus_doc');
  assert.deepEqual(tool.parameters.properties.action.enum, ['text', 'pdf', 'pages', 'find']);
  assert.deepEqual([...DOC_ACTIONS], ['text', 'pdf', 'pages', 'find']);
  assert.equal(tool.parameters.type, 'object');
  assert.equal(tool.parameters.additionalProperties, false, '不许放未声明的字段进来');
  assert.deepEqual(tool.parameters.required, ['action', 'file']);
  assert.ok(tool.description.length > 60, 'description 太短，模型会选错');
});

test('inject 声明 tools 与 zhiyunDoc —— 少一个就装不上或装上一个永远失败的工具', () => {
  // Cordis 里没写进 inject 的服务，直读会抛 `cannot get property ... without inject`，
  // 所以 `tools` 必须在；而 `zhiyunDoc` 不在 inject 里的话，插件照样激活、注册出一个
  // 每次都报 SERVICE_MISSING 的工具 —— 模型看到的是「一格永远失败的工具」。
  assert.deepEqual(inject, ['tools', 'zhiyunDoc']);
});

test('每个 action 都真的分派到对应方法（没有列在 enum 里却走 default 的）', async () => {
  for (const action of DOC_ACTIONS) {
    const { service, calls } = fakeService();
    const tool = createDocTools({ zhiyunDoc: service })[0];
    const args = { action, file: 'a.pdf', pages: '1-2', keyword: '甲' };
    await tool.run(args);
    assert.equal(calls.length, 1, `${action} 应当只调一个方法`);
    assert.equal(calls[0][0], action, `${action} 落到了 ${calls[0][0]}`);
  }
});

test('text：文件原样交给服务，不带多余参数', async () => {
  const { service, calls } = fakeService();
  await createDocTools({ zhiyunDoc: service })[0].run({ action: 'text', file: '讲义.pdf' });
  assert.deepEqual(calls, [['text', ['讲义.pdf']]]);
});

test('find：多个关键词用竖线/顿号/逗号都能拆开', async () => {
  const { service, calls } = fakeService();
  const tool = createDocTools({ zhiyunDoc: service })[0];
  await tool.run({ action: 'find', file: 'a.pdf', keyword: '左式堆|斜堆' });
  await tool.run({ action: 'find', file: 'a.pdf', keyword: '左式堆｜斜堆' });
  await tool.run({ action: 'find', file: 'a.pdf', keyword: '左式堆、斜堆，习题' });
  assert.deepEqual(calls.map((call) => call[1][1]), [
    ['左式堆', '斜堆'],
    ['左式堆', '斜堆'],
    ['左式堆', '斜堆', '习题'],
  ]);
});

test('pages：页码与他人给的 out 都透传；不给 out 时不留一个 undefined 键', async () => {
  const { service, calls } = fakeService();
  const tool = createDocTools({ zhiyunDoc: service })[0];
  await tool.run({ action: 'pages', file: 'book.pdf', pages: '43-49', out: 'C:/tmp/take.pdf' });
  await tool.run({ action: 'pages', file: 'book.pdf', pages: '1' });
  assert.deepEqual(calls[0][1], ['book.pdf', '43-49', { out: 'C:/tmp/take.pdf' }]);
  assert.deepEqual(calls[1][1], ['book.pdf', '1', {}]);
});

test('pdf：多文件按 | 拆开且顺序不变；size 默认 a4', async () => {
  const { service, calls } = fakeService();
  const tool = createDocTools({ zhiyunDoc: service })[0];
  await tool.run({ action: 'pdf', file: '第1页.jpg|截图.png|说明.docx' });
  await tool.run({ action: 'pdf', file: 'a.png', size: 'original' });
  assert.deepEqual(calls[0][1], [['第1页.jpg', '截图.png', '说明.docx'], { size: 'a4' }]);
  assert.deepEqual(calls[1][1], [['a.png'], { size: 'original' }]);
});

test('pdf：单个文件不需要分隔符也能用', async () => {
  const { service, calls } = fakeService();
  await createDocTools({ zhiyunDoc: service })[0].run({ action: 'pdf', file: 'a.png', out: 'x.pdf' });
  assert.deepEqual(calls[0][1], [['a.png'], { size: 'a4', out: 'x.pdf' }]);
});

test('未知 action 报 INPUT，且**先于**服务查找（不先抱怨包没装）', async () => {
  // 服务表为空：若 action 校验在服务查找之后，这里会拿到 SERVICE_MISSING。
  await assert.rejects(
    () => definition().run({ action: 'ocr', file: 'a.pdf' }),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /只认/);
      return true;
    },
  );
});

test('关键词为空时在工具层就拒（不发一个必然空的查询）', async () => {
  const { service, calls } = fakeService();
  await assert.rejects(
    () => createDocTools({ zhiyunDoc: service })[0].run({ action: 'find', file: 'a.pdf', keyword: ' || ' }),
    /keyword 里没有内容/,
  );
  assert.deepEqual(calls, []);
});

test('pages 缺 pages 参数时说明「需要 pages」，而不是走到服务再炸', async () => {
  const { service, calls } = fakeService();
  await assert.rejects(
    () => createDocTools({ zhiyunDoc: service })[0].run({ action: 'pages', file: 'a.pdf' }),
    /需要 pages/,
  );
  assert.deepEqual(calls, []);
});

test('服务没装配时报 SERVICE_MISSING，并说清装哪个包', async () => {
  await assert.rejects(
    () => definition().run({ action: 'text', file: 'a.pdf' }),
    (error) => {
      assert.equal(error.code, 'SERVICE_MISSING');
      assert.match(error.message, /@lybx-leyw\/dsh-zju-core-doc/);
      return true;
    },
  );
});

test('注册后 execute 全程不碰审批（读链）', async () => {
  const { service, calls } = fakeService();
  let approvalAsked = false;
  const tools = [];
  const ctx = {
    get: (key) => (key === 'zhiyunDoc' ? service : undefined),
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    approval: { request: async () => { approvalAsked = true; return 'rejected'; } },
    effect: (fn) => fn(),
  };
  apply(ctx);
  assert.deepEqual(tools.map((tool) => tool.name), ['campus_doc']);
  const result = await tools[0].execute({ action: 'find', file: 'a.pdf', keyword: '甲' }, {});
  assert.equal(result.ok, true);
  assert.equal(approvalAsked, false, '读工具不该弹审批');
  assert.deepEqual(calls[0][1], ['a.pdf', ['甲']]);
});

test('每次 execute 都重新查一次服务（装配顺序不保证）', async () => {
  const registry = {};
  const tools = registered(registry);
  // 第一次：服务还没装 → SERVICE_MISSING。
  await assert.rejects(
    () => tools[0].execute({ action: 'text', file: 'a.pdf' }, {}),
    (error) => error.code === 'SERVICE_MISSING',
  );
  // 之后才装配上，同一个已注册的工具必须能用 —— 快照下来的服务表会让它永远失败。
  const { service, calls } = fakeService();
  registry.zhiyunDoc = service;
  const result = await tools[0].execute({ action: 'text', file: 'a.pdf' }, {});
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test('splitList：竖线 / 全角竖线 / 顿号 / 逗号都认，空片段丢掉', () => {
  assert.deepEqual(splitList('a|b', 'x'), ['a', 'b']);
  assert.deepEqual(splitList('a｜b、c，d', 'x'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitList(' a |  b ', 'x'), ['a', 'b']);
  assert.throws(() => splitList(' || ', 'x'), /x 里没有内容/);
  assert.throws(() => splitList(undefined, 'x'), /需要 x/);
});
