/**
 * `campus_xuezai_read` 的**下载两个 action**。
 *
 * # 这一份守什么
 *
 * 工具层最容易破的一条是「封装时挑掉了 source 收的字段」——`tool/cc98` 那份
 * 测试的文件头写着同一件事：能力在 source 里存在、在用户手里不存在，
 * 而**两边都不报错**。
 *
 * 所以这里的判据是**参数原样到 source**：`names` 拆成数组、`uploadIds` 拆成
 * 字符串数组、`all` / `parts` 原样，一个都不许吞。
 *
 * 另外两条是这一轮的口径，必须钉住：
 *
 *   1. **不过审批**：下载只往本机写文件，不改平台状态。给下载配批准框，
 *      用户会把「同意」当翻页 —— 真交作业时那次点击就没有意义了。
 *      参照同仓 `campus_cc98_read` 的 `topicDownload`（同一个形态）。
 *   2. **参数里没有目录**：一个能传路径的下载工具等于把「写到哪」交给模型。
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createXuezaiReadTools } from '../../../packages/tool/xuezai/src/reads.js';

/** 收集 source 入参的假服务。 */
function recordingService({ courses = [{ id: '7', name: '数据结构' }], assignments = [] } = {}) {
  const seen = [];
  const service = {
    async xzzdRead(body) {
      if (body.action === 'courses') return { courses, semesterIds: [1] };
      if (body.action === 'assignments') return { assignments };
      throw new Error(`测试没预料到的读动作 ${body.action}`);
    },
    async xzzdDownload(body) {
      seen.push(body);
      return { count: 0, files: [], skipped: [], failed: [] };
    },
  };
  return { service, seen };
}

/** 取出工具并调一次 run。 */
const run = async (services, args) => createXuezaiReadTools(services)[0].run(args, {});
const tool = () => createXuezaiReadTools({})[0];

/* ────────────────────────────────────── 形状 */

test('两个下载 action 都声明了，且参数里**没有目录**', () => {
  const actions = tool().parameters.properties.action.enum;
  assert.ok(actions.includes('materialDownload'), '缺 materialDownload');
  assert.ok(actions.includes('homeworkDownload'), '缺 homeworkDownload');

  const properties = Object.keys(tool().parameters.properties);
  // 能传路径 = 把「写到哪」交给模型。这条边界在 source 侧（目录根由装配层定），
  // 所以工具层连这个参数都不该有 —— 有的话模型一定会试。
  for (const forbidden of ['dir', 'path', 'directory', 'output', 'outDir', 'savePath']) {
    assert.equal(properties.includes(forbidden), false, `参数里不该有 ${forbidden}`);
  }
  assert.equal(tool().parameters.additionalProperties, false, '封闭 schema：多传一个路径字段就被拒');
});

test('下载两个 action 的分派真的在（不是落到默认分支）', async () => {
  for (const action of ['materialDownload', 'homeworkDownload']) {
    const { service } = recordingService({ assignments: [{ id: '101', title: '作业一' }] });
    try {
      await run({ zhiyunXuezai: service }, { action, course: '7', uploadIds: '11', homework: '101' });
    } catch (error) {
      assert.equal(/分派漏了/.test(String(error.message)), false, `${action} 落到了默认分支：${error.message}`);
    }
  }
});

/* ────────────────────────────────────── 参数透传 */

test('materialDownload：names / uploadIds 拆成数组，all 原样交给 source', async () => {
  const { service, seen } = recordingService();
  await run({ zhiyunXuezai: service }, {
    action: 'materialDownload',
    course: '数据结构',
    names: '第一讲.pdf|第二讲.pdf',
  });
  // 没给的那个字段**不许出现**：塞一个默认值会覆盖 source 的「不传就用默认」，
  // 而「有没有指定」正是它判断要不要拒绝的依据。
  assert.deepEqual(seen[0], {
    action: 'materials',
    courseId: '7',
    course: '数据结构',
    names: ['第一讲.pdf', '第二讲.pdf'],
  });

  const byId = recordingService();
  await run({ zhiyunXuezai: byId.service }, { action: 'materialDownload', course: '7', uploadIds: '11，12' });
  // 全角逗号也要认：中文输入法下很容易打出来
  assert.deepEqual(byId.seen[0].uploadIds, ['11', '12']);
  assert.equal('names' in byId.seen[0], false);

  const all = recordingService();
  await run({ zhiyunXuezai: all.service }, { action: 'materialDownload', course: '7', all: true });
  assert.equal(all.seen[0].all, true);
  assert.equal('names' in all.seen[0], false);
  assert.equal('uploadIds' in all.seen[0], false);
});

test('materialDownload：不给名字也不给 all 时当场拒绝，不默认下整门课', async () => {
  const { service, seen } = recordingService();
  await assert.rejects(
    () => run({ zhiyunXuezai: service }, { action: 'materialDownload', course: '7' }),
    (error) => error.code === 'INPUT',
  );
  assert.equal(seen.length, 0, '参数不合法时不该调 source');
});

test('materialDownload：all 与 names 互斥（同时给会让结果取决于实现判序）', async () => {
  const { service, seen } = recordingService();
  await assert.rejects(
    () => run({ zhiyunXuezai: service }, { action: 'materialDownload', course: '7', all: true, names: 'a.pdf' }),
    (error) => error.code === 'INPUT',
  );
  assert.equal(seen.length, 0);
});

test('homeworkDownload：课程名解析成 id、作业名解析成 id，再交给 source', async () => {
  const { service, seen } = recordingService({ assignments: [{ id: '101', title: '第三次作业' }] });
  await run({ zhiyunXuezai: service }, {
    action: 'homeworkDownload',
    course: '数据结构',
    homework: '第三次作业',
    parts: 'attachments,corrections',
  });
  assert.equal(seen[0].action, 'homework');
  assert.equal(seen[0].activityId, '101');
  assert.equal(seen[0].courseId, '7');
  assert.equal(seen[0].course, '数据结构');
  assert.deepEqual(seen[0].parts, ['attachments', 'corrections']);
  assert.equal('uploadIds' in seen[0], false);
  assert.equal('names' in seen[0], false);
});

test('homeworkDownload：没给 parts 时**不传**（让 source 用它自己的默认三类）', async () => {
  const { service, seen } = recordingService({ assignments: [{ id: '101', title: '作业一' }] });
  await run({ zhiyunXuezai: service }, { action: 'homeworkDownload', course: '7', homework: '101' });
  assert.equal('parts' in seen[0], false, '塞一个默认值会覆盖 source 的默认口径');
});

test('homeworkDownload：parts 里写了不认识的类别时在封装层就说清可选值', async () => {
  const { service, seen } = recordingService({ assignments: [{ id: '101', title: '作业一' }] });
  await assert.rejects(
    () => run({ zhiyunXuezai: service }, { action: 'homeworkDownload', course: '7', homework: '101', parts: 'attachments,comments' }),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /attachments/);
      return true;
    },
  );
  assert.equal(seen.length, 0);
});

test('homeworkDownload：作业名对不上时报错并列出候选，不猜', async () => {
  const { service, seen } = recordingService({
    assignments: [{ id: '101', title: '作业一' }, { id: '102', title: '作业二' }],
  });
  await assert.rejects(
    () => run({ zhiyunXuezai: service }, { action: 'homeworkDownload', course: '7', homework: '作业' }),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /101|102/, '要给出候选编号');
      return true;
    },
  );
  assert.equal(seen.length, 0, '歧义时不该下任何一个');
});

test('未知 action 仍是 INPUT（新增两个 action 没把校验放宽）', async () => {
  const { service, seen } = recordingService();
  await assert.rejects(
    () => run({ zhiyunXuezai: service }, { action: 'materialDownloadAll' }),
    (error) => {
      assert.equal(error.code, 'INPUT');
      assert.match(error.message, /materialDownload/);
      return true;
    },
  );
  assert.equal(seen.length, 0);
});

/* ────────────────────────────────────── 不过审批 */

test('下载两个 action 走读链：execute 全程**不碰审批**', async () => {
  // 走**宿主注册出来的那个对象**（`hostTool.execute`），而不是直接调 `run`：
  // 审批只可能被注册器加进去，绕过注册器就测不到它。
  const { createXuezaiReadTools: factory, apply } = await import('../../../packages/tool/xuezai/src/reads.js');
  const { service } = recordingService({ assignments: [{ id: '101', title: '作业一' }] });

  let approvalAsked = false;
  const registered = [];
  const ctx = {
    get: (name) => (name === 'zhiyunXuezai' ? service : undefined),
    tools: { register: (toolDefinition) => { registered.push(toolDefinition); return () => {}; } },
    approval: { request: async () => { approvalAsked = true; return 'allowed-once'; } },
    effect: (fn) => fn(),
  };
  apply(ctx);

  const hostTool = registered.find((item) => item.name === 'campus_xuezai_read');
  assert.ok(hostTool, '读工具没挂上');
  for (const args of [
    { action: 'materialDownload', course: '7', uploadIds: '11' },
    { action: 'homeworkDownload', course: '7', homework: '101' },
  ]) {
    await hostTool.execute(args, {});
  }
  assert.equal(approvalAsked, false, '下载不该请求审批 —— 它不改平台状态');
  // 与写工具的区别就在这儿：那两个要审批，这两个不要。
  assert.equal(typeof factory, 'function');
});
