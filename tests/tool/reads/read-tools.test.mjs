/**
 * 读工具（`campus_<域>_read`）的共同守卫。
 *
 * # 这一份守什么
 *
 * 读工具与写工具**共用一套参数判据，但走两条注册链**。这条边界一旦破了不会报错：
 *
 *   - 读工具如果也挂到写注册器上，它就会要求 `exec.agent` 并弹审批 —— 表现是
 *     「查个课表也要点一次同意」，用户很快会对「同意」脱敏；
 *   - 反过来，写工具如果漏了审批，缺陷同样不报错 —— 它表现为「某天有人发现
 *     作业被交了」。所以两条链各自的守卫都要有。
 *
 * 这里守的**不是**每个 action 的业务语义（那在各包的测试里），而是：
 *
 *   1. 每个读工具都能被 `createReadToolRegistrar` 注册，且 `execute` 时**不碰审批**；
 *   2. 每个读工具的参数是封闭 schema（`additionalProperties: false`）；
 *   3. 未知 action 报 `INPUT`，且**先于**服务查找（不许先抱怨「包没装」）；
 *   4. 服务缺失报 `SERVICE_MISSING`，并说清装哪个包；
 *   5. action 表里的每个值都能分派（没有「列在 enum 里但走 default」的悬空值）。
 *
 * 全离线：source 服务都是假的。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/** 本轮的读工具包：目录 → { 模块, 工厂, 服务名, 工具名, 包名 }。 */
const PACKAGES = [
  { dir: 'zdbk', factory: 'createZdbkReadTools', service: 'zhiyunZdbk', tool: 'campus_zdbk_read', pkg: '@lybx-leyw/dsh-zju-source-zdbk' },
  { dir: 'xuezai', factory: 'createXuezaiReadTools', service: 'zhiyunXuezai', tool: 'campus_xuezai_read', pkg: '@lybx-leyw/dsh-zju-source-xuezai' },
  { dir: 'cc98', factory: 'createCc98ReadTools', service: 'zhiyunCc98', tool: 'campus_cc98_read', pkg: '@lybx-leyw/dsh-zju-source-cc98' },
  { dir: 'pta', factory: 'createPtaReadTools', service: 'zhiyunPta', tool: 'campus_pta_read', pkg: '@lybx-leyw/dsh-zju-source-pta' },
  { dir: 'sztz', factory: 'createSztzReadTools', service: 'zhiyunSztz', tool: 'campus_sztz_read', pkg: '@lybx-leyw/dsh-zju-source-sztz' },
  { dir: 'tyys', factory: 'createTyysReadTools', service: 'zhiyunTyys', tool: 'campus_tyys_read', pkg: '@lybx-leyw/dsh-zju-source-tyys' },
  { dir: 'lab', factory: 'createLabReadTools', service: 'zhiyunLab', tool: 'campus_lab_read', pkg: '@lybx-leyw/dsh-zju-source-lab' },
  { dir: 'classroom', factory: 'createClassroomReadTools', service: 'zhiyunClassroom', tool: 'campus_classroom_read', pkg: '@lybx-leyw/dsh-zju-source-classroom' },
  { dir: 'notice', factory: 'createNoticeReadTools', service: 'zhiyunNotice', tool: 'campus_notice_read', pkg: '@lybx-leyw/dsh-zju-source-notice' },
  { dir: 'chalaoshi', factory: 'createChalaoshiReadTools', service: 'zhiyunChalaoshi', tool: 'campus_chalaoshi_read', pkg: '@lybx-leyw/dsh-zju-source-chalaoshi' },
  { dir: 'ebook', factory: 'createEbookReadTools', service: 'zhiyunEbook', tool: 'campus_ebook_read', pkg: '@lybx-leyw/dsh-zju-source-ebook' },
  { dir: 'yjsy', factory: 'createYjsyReadTools', service: 'zhiyunYjsy', tool: 'campus_yjsy_read', pkg: '@lybx-leyw/dsh-zju-source-yjsy' },
  { dir: 'xxt', factory: 'createXxtReadTools', service: 'zhiyunXxt', tool: 'campus_xxt_read', pkg: '@lybx-leyw/dsh-zju-source-xxt' },
];

const load = (dir) => import(`../../../packages/tool/${dir}/src/index.js`);

/**
 * 造一个「任何属性访问都会记录」的 source 假身。
 *
 * 读工具会按 action 取方法名（`service.timetable(...)`），假身只要让每次调用
 * 都返回一个标记即可 —— 我们关心的是**参数与分派**，不是平台返回什么。
 */
function proxyService(calls) {
  return new Proxy({}, {
    get: (_target, key) => async (...args) => {
      calls.push([String(key), args]);
      return { stub: String(key) };
    },
  });
}

/** 该工具的参数里有没有 action（无 action 的工具是「只有一种读法」那种）。 */
const actionOf = (definition) => definition.parameters.properties.action;

test('每个读工具都能被读注册器挂上，且 execute 不碰审批', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const tools = mod[entry.factory]({});
    assert.deepEqual(tools.map((item) => item.name), [entry.tool], `${entry.dir} 的读工具名不对`);

    let approvalAsked = false;
    const registered = [];
    const ctx = {
      get: () => undefined,
      tools: { register: (tool) => { registered.push(tool); return () => {}; } },
      // 读工具**不该**读它；读了就会让 approvalAsked 变真。
      approval: { request: async () => { approvalAsked = true; return 'allowed-once'; } },
      effect: (fn) => fn(),
    };
    mod.apply(ctx);
    // 有些包同时有写工具（zdbk / cc98 / …），所以这里只断言「读工具在里面」。
    const hostTool = registered.find((tool) => tool.name === entry.tool);
    assert.ok(hostTool, `${entry.dir} 的 apply 没挂上读工具`);

    // ⚠️ 必须走**宿主注册出来的那个对象**（`hostTool.execute`），而不是直接调
    // `definition.run`：审批只可能被注册器加进去，绕过注册器就测不到它。
    // 这条曾经确实测不到 —— 把 `ctx.approval.request` 塞进注册器后守卫仍然是绿的。
    const definition = mod[entry.factory]({})[0];
    const args = entry.service === 'zhiyunEbook' || entry.dir === 'ebook'
      ? { title: '算法导论' }
      : minimalArgs(definition, actionOf(definition)?.enum?.[0]);
    try {
      await hostTool.execute(args, {});
    } catch { /* 服务缺失或参数不全都算走到了 —— 关键是没有审批 */ }
    assert.equal(approvalAsked, false, `${entry.dir} 的读工具不该请求审批`);
  }
});

test('每个读工具都是封闭 schema，且有够长的 description', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    for (const definition of mod[entry.factory]({})) {
      assert.ok(
        definition.description.length > 40,
        `${definition.name} 的 description 太短，模型会选错`,
      );
      assert.equal(definition.parameters.type, 'object');
      assert.equal(definition.parameters.additionalProperties, false, '不许放未声明的字段进来');
      assert.ok(Array.isArray(definition.parameters.required), 'required 必须是数组');
    }
  }
});

test('未知 action 报 INPUT，而不是先抱怨服务没装', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const definition = mod[entry.factory]({})[0];
    if (!actionOf(definition)) continue;
    await assert.rejects(
      () => definition.run({ action: '不存在的动作' }, {}),
      (error) => {
        assert.equal(error.code, 'INPUT', `${entry.dir} 未知 action 应当报 INPUT`);
        return true;
      },
    );
  }
});

test('action 表里的每个值都能分派，不落到默认分支', async () => {
  // 一个「列在 enum 里但分派表里没有」的 action，模型会照着 enum 传，
  // 然后在运行时撞上 `Error: 分派漏了 …` —— 那是本文件的 bug 泄漏给了用户。
  // 所以这里把 enum 的每个值都真正跑一遍（用假 source 顶住所有平台调用）。
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const definition = mod[entry.factory]({})[0];
    const enumValues = actionOf(definition)?.enum;
    if (!enumValues) continue;
    for (const action of enumValues) {
      const calls = [];
      const live = mod[entry.factory]({ [entry.service]: proxyService(calls) })[0];
      try {
        await live.run(minimalArgs(live, action), {});
      } catch (error) {
        // 分派漏掉的默认分支抛的是「…的 action 分派漏了 …」——那是本文件的 bug。
        // 其余错误（参数、服务、source 抛的）在这组最小参数下都是合法的。
        assert.equal(
          /分派漏了/.test(String(error.message)),
          false,
          `${entry.dir}/${action} 在 enum 里但分派表里没有它：${error.message}`,
        );
        if (error.code === 'INPUT' && /不认识的 action/.test(error.message)) {
          assert.fail(`${entry.dir}/${action} 在 enum 里但分派表里没有它`);
        }
      }
    }
  }
});

test('服务没装配时报 SERVICE_MISSING 并说清装哪个包', async () => {
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const definition = mod[entry.factory]({})[0];
    // `campus_ebook_read` 没有 action：它先校验「书名或 ISBN 给一个」，
    // 那条参数错本来就该先报。所以这里给它一个合法参数，才走得到服务查找。
    const args = entry.dir === 'ebook' ? { title: '算法导论' } : minimalArgs(definition, actionOf(definition)?.enum?.[0]);
    await assert.rejects(
      () => definition.run(args, {}),
      (error) => {
        assert.equal(error.code, 'SERVICE_MISSING', `${entry.dir} 缺服务时应当报 SERVICE_MISSING`);
        assert.match(error.message, new RegExp(entry.pkg.replace(/[/@.]/g, '\\$&')));
        return true;
      },
    );
  }
});

test('每个工具包都声明了 inject —— 漏了会在挂载时抛 undefined', async () => {
  // # 为什么这条必须存在
  //
  // 不声明 `inject` 时宿主不会等服务就绪，`ctx.tools` 可能是 undefined，
  // `apply()` 里 `ctx.tools.register(...)` 直接抛
  // `Cannot read properties of undefined (reading 'register')`。
  //
  // 2026-11-12 实测过：`tool/ebook`、`tool/notice`、`tool/chalaoshi`、`tool/yjsy`
  // 四个包**都漏了**。它们没被发现，是因为一直没有任何 preset 挂载它们 ——
  // 「不声明也能跑」从未被验证过。补上之后这条守卫挡住复发。
  //
  // ⚠️ 只断言 `tools`。**不断言服务名**：`tool/classroom` 用的是
  // `zhiyunStudy`（讲义来自 `core/study`），与它的目录名 classroom 不是
  // 同一个词；按「目录名推出服务名」写断言会误报。服务名对不对由
  // 上一组 SERVICE_MISSING 测试覆盖（它拿 `entry.service` 实际去查）。
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    assert.ok(Array.isArray(mod.inject), `${entry.dir} 必须声明 inject`);
    assert.ok(mod.inject.includes('tools'), `${entry.dir} 的 inject 必须含 tools`);
    assert.ok(typeof mod.name === 'string' && mod.name.startsWith('zhiyun-tool-'),
      `${entry.dir} 的 name 应当以 zhiyun-tool- 开头`);
  }
});

test('apply() 在最小 ctx 上能把工具注册进去，且卸载干净', async () => {
  // 光有 inject 声明还不够：要确认 apply 真的用了 `ctx.tools`。
  //
  // ⚠️ 不断言「恰好一个」：`tool/classroom` 注册 2 个（3 个课堂资料工具 +
  // 1 个读工具），`tool/zdbk` 也注册 2 个（读 + 写）。要断言的是**至少有一个
  // 名字带 campus_ 或 study_ 的工具**，否则说明 apply 根本没注册东西。
  for (const entry of PACKAGES) {
    const mod = await load(entry.dir);
    const registered = [];
    const effects = [];
    const ctx = {
      get: (key) => (key === entry.service ? {} : undefined),
      tools: { register: (tool) => { registered.push(tool.name); return () => {}; } },
      effect: (fn) => { effects.push(fn); return () => {}; },
    };
    mod.apply(ctx);
    // effect 是惰性的，得跑一遍才算真注册。
    for (const fn of effects) fn();
    assert.ok(registered.length >= 1, `${entry.dir} 应当注册至少一个工具`);
    assert.ok(
      registered.some((n) => n === entry.tool || n.startsWith('campus_') || n.startsWith('study_')),
      `${entry.dir} 注册的工具名都不像工具：${registered.join(', ')}`,
    );
  }
});

/**
 * 给一个 action 造「能走到 source 调用」的最小参数。
 *
 * 只填 required 是不够的：`campus_cc98_read` 的 `topic` 还要 `topic`、
 * `campus_zdbk_read` 的 `selectionSections` 还要 `course`/`pool`/`category`。
 * 这些是**按 action 的条件必填**，所以这里按 action 补齐，让测试真的走到
 * `source` 那一步。填的是一眼能认出来的占位值。
 */
function minimalArgs(definition, action) {
  const base = Object.fromEntries(
    (definition.parameters.required ?? []).map((key) => [key, key === 'action' ? action : '1']),
  );
  if (action === undefined) return base;
  const fill = {
    // zdbk
    selectionSections: { course: 'CS1001G', pool: '(2025-2026-1)-CS1001G-0012345-1', category: 'xk_1' },
    selectionCourses: {},
    selectionSearch: { keyword: '高等数学' },
    // xuezai
    courseView: { course: '11' },
    materialList: { course: '11' },
    homeworkList: { course: '11' },
    homeworkView: { course: '11', homework: '101' },
    rollcallHistory: { course: '11' },
    // cc98
    search: { keyword: '选课' },
    boardTopics: { board: '12' },
    boardTags: { board: '12' },
    topic: { topic: '9' },
    topicDownload: { topic: '9', floor: '1' },
    original: { post: '88' },
    messageView: { user: '3' },
    signinMonth: { year: 2026, month: 11 },
    // pta
    setList: {},
    setView: { problemSet: '1' },
    problemList: { problemSet: '1' },
    problemView: { problemSet: '1', problem: '2' },
    submissionList: { problemSet: '1' },
    submissionView: { problemSet: '1', submission: '3' },
    reconcile: { problemSet: '1' },
    // sztz / tyys / lab
    activities: {},
    newActivities: {},
    mine: {},
    credits: {},
    projects: {},
    notices: {},
    venueList: {},
    venueSlots: { venueSiteId: 'V1' },
    venueNotice: {},
    orderList: {},
    courseList: {},
    labList: {},
    weekStatus: {},
    mySelections: {},
    openStatus: {},
    timetable: {},
    myInfo: {},
    terms: {},
    currentTerm: {},
    // classroom
    searchCourses: { keyword: '数据结构' },
    lessonList: { courseId: '1' },
    resourceList: { courseId: '1', subId: '2' },
    captionSearch: { keyword: '点名' },
    liveStatus: {},
    liveText: {},
    // notice / chalaoshi / ebook / yjsy
    list: {},
    view: { title: '通知' },
    new: {},
    sources: {},
    search: { keyword: '王伟' },
    teacher: { teacherId: '1' },
    course: { course: '微积分' },
  };
  return { ...base, ...(fill[action] ?? {}) };
}
