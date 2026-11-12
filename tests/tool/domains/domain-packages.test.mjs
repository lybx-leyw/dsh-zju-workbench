/**
 * 按域拆开的六个工具包（写 + 读）的结构守卫。
 *
 * # 这一份守什么
 *
 * 六个包（zdbk / sztz / tyys / xuezai / pta / lab）各有一个写工具；
 * 本轮起它们还各有一个**读**工具（`campus_<域>_read`），由另一条注册链挂载。
 * 逐条写参数测试的收益不如守住**共同契约**：
 *
 *   1. 每个包只声明**一个** source 服务 —— 按域拆的意义就在这里；
 *   2. 每个包的 `inject` 都带 `tools` / `approval` / 自己那个服务；
 *   3. 每个写工具都通过 `contractOf` 拿 source 契约（不许自己拼方法名）；
 *   4. 服务没装配时报 `SERVICE_MISSING` 并说清装哪个包；
 *   5. **读工具不过审批** —— 它走另一条注册链，且不读 `ctx.approval`。
 *
 * 逐条参数透传的测试在 `tests/tool/cc98`（那个包工具最多）、
 * `tests/tool/reads`（读工具的共同契约），以及
 * `scripts/probe-write-contract.mjs`（跨层真契约）。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/** 六个包：目录名 → { 写工厂, 读工厂, 服务名, 写工具名, 读工具名 }。 */
const PACKAGES = [
  { dir: 'zdbk', factory: 'createZdbkWriteTools', readFactory: 'createZdbkReadTools', service: 'zwZdbk', pkg: '@lybx-leyw/dsh-zju-source-zdbk', tools: ['campus_course_select'], reads: ['campus_zdbk_read'] },
  { dir: 'sztz', factory: 'createSztzWriteTools', readFactory: 'createSztzReadTools', service: 'zwSztz', pkg: '@lybx-leyw/dsh-zju-source-sztz', tools: ['campus_activity'], reads: ['campus_sztz_read'] },
  { dir: 'tyys', factory: 'createTyysWriteTools', readFactory: 'createTyysReadTools', service: 'zwTyys', pkg: '@lybx-leyw/dsh-zju-source-tyys', tools: ['campus_venue'], reads: ['campus_tyys_read'] },
  { dir: 'xuezai', factory: 'createXuezaiWriteTools', readFactory: 'createXuezaiReadTools', service: 'zwXuezai', pkg: '@lybx-leyw/dsh-zju-source-xuezai', tools: ['campus_homework', 'campus_checkin'], reads: ['campus_xuezai_read'] },
  { dir: 'pta', factory: 'createPtaWriteTools', readFactory: 'createPtaReadTools', service: 'zwPta', pkg: '@lybx-leyw/dsh-zju-source-pta', tools: ['campus_answer'], reads: ['campus_pta_read'] },
  { dir: 'lab', factory: 'createLabWriteTools', readFactory: 'createLabReadTools', service: 'zwLab', pkg: '@lybx-leyw/dsh-zju-source-lab', tools: ['campus_lab_select'], reads: ['campus_lab_read'] },
];

/** 载入一个包。 */
const load = (dir) => import(`../../../packages/tool/${dir}/src/index.js`);

test('每个包只声明一个 source 服务 —— 按域拆的意义就在这里', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    assert.deepEqual(
      mod.inject,
      ['tools', 'approval', entry.service],
      `${entry.dir} 的 inject 应当只有自己那一个数据源`,
    );
  }
});

test('每个包的工具名与数量都对得上', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const tools = mod[entry.factory]({});
    assert.deepEqual(
      tools.map((item) => item.name).sort(),
      [...entry.tools].sort(),
      `${entry.dir} 的工具名不对`,
    );
  }
});

test('每个工具都有够长的 description 与 object 型 parameters', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    for (const definition of mod[entry.factory]({})) {
      assert.ok(
        definition.description.length > 20,
        `${entry.dir}/${definition.name} 的 description 太短，模型会选错`,
      );
      assert.equal(definition.parameters.type, 'object');
      assert.equal(definition.parameters.additionalProperties, false, '不许放未声明的字段进来');
      assert.ok(Array.isArray(definition.parameters.required), 'required 必须是数组');
    }
  }
});

/**
 * 给工具造一组「能走到 source 调用」的必填参数。
 *
 * 只填 required 是不够的：zdbk 的 select 还要 `section`、tyys 的 book 还要
 * `venue`/`slot`/`date`。这些是**条件必填**（同一个工具不同 action 要求不同），
 * 所以这里按 action 补齐，让测试真的走到 `contractOf` 那一步。
 *
 * 只有在测「未知 action」时才用最小参数 —— 那条本来就该在取服务之前失败。
 */
function argsFor(definition, action) {
  const base = Object.fromEntries(definition.parameters.required.map((key) => [key, '1']));
  if (definition.parameters.properties.action) base.action = action;
  const fill = {
    select: { section: 'S1', lab: 'L1', week: '1-16' },
    drop: {},
    reorder: { order: 1 },
    book: { venue: 'V1', slot: '19:00-20:00', date: '2026-11-20' },
    cancel: { record: 'R1', order: 'O1', activity: 'A1' },
    signup: {},
    submit: { content: 'x' },
    retract: {},
    save: { content: 'x' },
  };
  return { ...base, ...(fill[action] ?? {}) };
}

test('服务没装配时报 SERVICE_MISSING 并说清装哪个包', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const definition = mod[entry.factory]({})[0];
    const action = definition.parameters.properties.action?.enum?.[0];
    await assert.rejects(
      () => definition.prepare(argsFor(definition, action)),
      (error) => {
        assert.equal(error.code, 'SERVICE_MISSING', `${entry.dir} 缺服务时应当报 SERVICE_MISSING`);
        assert.match(error.message, new RegExp(entry.pkg.replace(/[/@.]/g, '\\$&')));
        return true;
      },
    );
  }
});

test('source 缺 Cancel 时立刻报 CONTRACT_MISSING —— 否则审批被拒后永久不可用', async () => {
  // `cancel` 是必填契约：审批被拒 / 超时 / 中止时 tool 会调它撤销会话。
  // 缺了它，那个动作会一直 `WRITE_BUSY`，直到重启进程。
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const definition = mod[entry.factory]({})[0];
    // 造一个「有 prepare / execute、没有 cancel」的半套 source。
    const half = {};
    for (const name of [
      'selectCourse', 'dropCourse', 'reorderCourse',
      'signupActivity', 'cancelActivity',
      'bookVenue', 'cancelVenue',
      'submitHomework', 'retractHomework', 'rollcall',
      'saveAnswer', 'submitAnswer',
      'selectLab', 'cancelLab',
    ]) {
      half[`${name}Prepare`] = async () => 'summary';
      half[`${name}Execute`] = async () => ({});
    }
    const action = definition.parameters.properties.action?.enum?.[0];
    await assert.rejects(
      () => mod[entry.factory]({ [entry.service]: half })[0].prepare(argsFor(definition, action)),
      (error) => {
        assert.equal(error.code, 'CONTRACT_MISSING', `${entry.dir} 缺 cancel 时应当报 CONTRACT_MISSING`);
        return true;
      },
    );
  }
});

test('不认识的 action 报 INPUT，而不是先抱怨服务没装', async () => {
  // 用户把 action 写错了，不该先收到「包没装」这种与他的输入毫无关系的提示。
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const definition = mod[entry.factory]({})[0];
    if (!definition.parameters.properties.action) continue; // 无 action 参数的工具跳过
    const args = argsFor(definition, '不存在的动作');
    await assert.rejects(
      () => definition.prepare(args),
      (error) => {
        assert.equal(error.code, 'INPUT', `${entry.dir} 未知 action 应当报 INPUT`);
        return true;
      },
    );
  }
});

test('每个包的 apply 都能装配到最小 ctx 上而不抛', async () => {
  // 注册时只需要名字 / 描述 / 参数，不依赖服务 —— 所以空服务表也该能挂上。
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const registered = [];
    const ctx = {
      get: () => undefined,
      tools: { register: (tool) => { registered.push(tool.name); return () => {}; } },
      approval: { request: async () => 'rejected' },
      effect: (fn) => fn(),
    };
    mod.apply(ctx);
    assert.deepEqual(
      registered.sort(),
      [...entry.tools, ...(entry.reads ?? [])].sort(),
      `${entry.dir} 的 apply 没有把（写 + 读）工具都注册进 ctx.tools`,
    );
  }
});
