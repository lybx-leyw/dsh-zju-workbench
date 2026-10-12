/**
 * 「反馈」页（迷你社区）的守卫。
 *
 * 这一页的产物会以公开日志的形式被所有人读到，所以断言分成三类：
 *   1. 形状：讨论串与评论的字段、编号唯一、状态枚举 —— 错了页面会静默画坏；
 *   2. 红线：**不得夹带身份信息**（真名、学号、联系方式、IP）。这条一旦破了就是泄露，
 *      而且不会被别的测试发现；
 *   3. 契约：与服务端 `deploy/feedback-service/server.py` 同一套字段与上限。
 *      两端漂移的表现是"用户填得好好的，提交却被服务端拒了"，很晚才会暴露。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  COMMENT_FIELDS, FORBIDDEN_FIELDS, ISSUE_FIELDS, ISSUE_KINDS, ISSUE_STATES, LIMITS, NAME_KEY,
  ago, checkComment, checkIssue, isValidName, loadIssues, localName, needsReply, orderIssues,
  paths, pendingIssues, randomName, resetName, submitComment, submitIssue,
  summarize, validateBoard, validateIssue,
} from '../packages/dsh-zhiyun-page-feedback/src/board.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}packages/dsh-zhiyun-page-feedback/src/client.jsx`, 'utf8');
const server = readFileSync(`${root}deploy/feedback-service/server.py`, 'utf8');

/** 服务端 `fold()` 会产出的一个条目（形状即契约）。 */
const sampleIssue = {
  id: 'F-001',
  kind: 'new',
  title: '标题',
  detail: '正文',
  name: '访客-7f3a',
  at: 1700000000,
  status: 'open',
  comments: [{ cid: 'F-001-c1', name: '访客-1', body: '我也想要', at: 1700000100, robot: false }],
  last: 1700000100,
};

/** 假的 localStorage，够用即可。 */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
  };
}

/* ────────────────────────────────────────────────── 形状与红线 */

test('服务端产出的形状是合法的', () => {
  assert.deepEqual(validateBoard([sampleIssue]), []);
});

test('条目字段是白名单：未知字段会被拦下', () => {
  assert.ok(validateIssue({ ...sampleIssue, extra: 1 }, 0).some(message => message.includes('未知字段 extra')));
  for (const key of Object.keys(sampleIssue)) assert.ok(ISSUE_FIELDS.includes(key), `${key} 不在条目白名单里`);
  for (const key of Object.keys(sampleIssue.comments[0])) assert.ok(COMMENT_FIELDS.includes(key), `${key} 不在评论白名单里`);
});

test('不得夹带身份信息 —— 这条是红线', () => {
  for (const field of FORBIDDEN_FIELDS) {
    assert.ok(validateIssue({ ...sampleIssue, [field]: 'someone' }, 0)
      .some(message => message.includes('禁止字段')), `条目字段 ${field} 必须被拦下`);
    assert.ok(validateIssue({ ...sampleIssue, comments: [{ body: 'b', name: 'n', [field]: 'x' }] }, 0)
      .some(message => message.includes('禁止字段')), `评论字段 ${field} 必须被拦下`);
  }
  // 真实姓名字段也得在禁区里：笔名机制给了"署名"，但绝不能顺势收真名。
  assert.ok(FORBIDDEN_FIELDS.includes('realName'));
});

test('编号形状与唯一性', () => {
  assert.ok(validateIssue({ ...sampleIssue, id: 'X-1' }, 0).some(m => m.includes('F-001 形式')));
  assert.ok(validateBoard([sampleIssue, { ...sampleIssue, title: 'another' }]).some(m => m.includes('编号重复')));
});

test('状态枚举：没有「待处理」这种中间态', () => {
  assert.deepEqual(ISSUE_STATES, ['open', 'done', 'declined']);
  assert.ok(validateIssue({ ...sampleIssue, status: 'pending' }, 0).some(m => m.includes('status')));
});

test('评论本身也校验：空正文与坏笔名都要拦', () => {
  assert.ok(validateIssue({ ...sampleIssue, comments: [{ body: '  ', name: 'n' }] }, 0).some(m => m.includes('缺 body')));
  assert.ok(validateIssue({ ...sampleIssue, comments: [{ body: 'b', name: 'a b' }] }, 0).some(m => m.includes('name')));
  assert.ok(validateIssue({ ...sampleIssue, comments: 'nope' }, 0).some(m => m.includes('必须是数组')));
});

test('讨论串必须是数组', () => {
  assert.deepEqual(validateBoard(null), ['讨论串必须是数组']);
  assert.deepEqual(validateBoard({ issues: [] }), ['讨论串必须是数组']);
});

/* ────────────────────────────────────────────────── 本地笔名 */

test('随机笔名形状固定，且不含可识别信息', () => {
  assert.equal(randomName(() => 0), '访客-0000');
  assert.equal(randomName(() => 0.5), '访客-8000');
  assert.equal(randomName(() => 0.999999), '访客-ffff');
  for (let i = 0; i < 50; i += 1) {
    const name = randomName();
    assert.ok(isValidName(name), `${name} 应当合法`);
    assert.match(name, /^访客-[0-9a-f]{4}$/);
  }
});

test('笔名首次生成后固定下来（同一个人下次还是它）', () => {
  const storage = fakeStorage();
  const first = localName({ storage, random: () => 0.25 });
  assert.equal(first, '访客-4000');
  assert.equal(storage.getItem(NAME_KEY), first, '要写进存储');
  // 换一个 random 也不该变 —— 复用的是存下来的那个。
  assert.equal(localName({ storage, random: () => 0.75 }), first);
});

test('换笔名会写回存储，让用户能重新匿名', () => {
  const storage = fakeStorage({ [NAME_KEY]: '访客-0001' });
  const fresh = resetName({ storage, random: () => 0.5 });
  assert.equal(fresh, '访客-8000');
  assert.equal(storage.getItem(NAME_KEY), fresh);
  assert.equal(localName({ storage }), fresh);
});

test('存储不可用时给临时笔名，而不是让页面崩掉', () => {
  // 无痕模式下 `setItem`/`getItem` 会抛 —— 这时宁可每次现算一个。
  const hostile = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const name = localName({ storage: hostile, random: () => 0 });
  assert.equal(name, '访客-0000');
  assert.equal(resetName({ storage: hostile, random: () => 0 }), '访客-0000');
  // 完全没有 storage（宿主没注入）也不能抛。
  assert.ok(isValidName(localName({ storage: null, random: () => 0.1 })));
});

test('存储里的脏值不会被当成笔名用', () => {
  const storage = fakeStorage({ [NAME_KEY]: '张三 13800138000' });
  const name = localName({ storage, random: () => 0.5 });
  assert.equal(name, '访客-8000', '脏值要丢掉重新生成');
  assert.equal(storage.getItem(NAME_KEY), '访客-8000');
});

/* ────────────────────────────────────────────────── 排序与摘要 */

test('排序：按最后活动时间倒序，有动静的浮上来', () => {
  const ordered = orderIssues([
    { id: 'F-001', last: 100, status: 'open', comments: [] },
    { id: 'F-003', last: 300, status: 'open', comments: [] },
    { id: 'F-002', last: 200, status: 'done', comments: [] },
  ]);
  assert.deepEqual(ordered.map(issue => issue.id), ['F-003', 'F-002', 'F-001']);
  // 不改动入参。
  const input = [{ id: 'F-001', last: 100 }, { id: 'F-002', last: 200 }];
  orderIssues(input);
  assert.deepEqual(input.map(issue => issue.id), ['F-001', 'F-002']);
});

test('摘要计数含评论总数', () => {
  assert.deepEqual(
    summarize([
      { status: 'open', comments: [{}, {}] },
      { status: 'open', comments: [] },
      { status: 'done', comments: [{}] },
      { status: 'declined' },
    ]),
    { total: 4, open: 2, done: 1, declined: 1, comments: 3 },
  );
});

/* ────────────────────────────────────────────────── 校验（两端同口径） */

test('提交前校验与服务端同一套规则', () => {
  assert.equal(checkIssue({ kind: 'new', title: '标题', detail: '正文' }), '');
  assert.equal(checkIssue({ kind: 'track', title: '标题', detail: '正文' }), '');
  assert.match(checkIssue({ kind: 'other', title: '标题', detail: '正文' }), /提新需求还是追踪/);
  assert.match(checkIssue({ kind: 'new', title: '  ', detail: '正文' }), /标题/);
  assert.match(checkIssue({ kind: 'new', title: '标题', detail: '  ' }), /具体/);
  assert.match(checkIssue({ kind: 'new', title: 'x'.repeat(LIMITS.title + 1), detail: '正文' }), /标题最多/);
  assert.match(checkIssue({ kind: 'new', title: '标题', detail: 'x'.repeat(LIMITS.detail + 1) }), /正文最多/);

  assert.equal(checkComment('说点什么'), '');
  assert.match(checkComment('   '), /不能为空/);
  assert.match(checkComment('x'.repeat(LIMITS.comment + 1)), /评论最多/);
});

test('上限与服务端逐字一致（漂移会变成"用户填得好好的却被拒"）', () => {
  assert.match(server, new RegExp(`MAX_TITLE = ${LIMITS.title}\\b`), '标题上限要和服务端一样');
  assert.match(server, new RegExp(`MAX_DETAIL = ${LIMITS.detail}\\b`), '正文上限要和服务端一样');
  assert.match(server, new RegExp(`MAX_COMMENT = ${LIMITS.comment}\\b`), '评论上限要和服务端一样');
  for (const state of ISSUE_STATES) assert.match(server, new RegExp(`"${state}"`), `服务端要认识状态 ${state}`);
  for (const kind of ISSUE_KINDS) assert.match(server, new RegExp(`"${kind}"`), `服务端要认识种类 ${kind}`);
});

test('笔名规则两端一致：中文笔名在两边都合法', () => {
  // 这条踩过：JS 的 `\w` **只认 ASCII**（即使带 u 标志也一样），而 Python 的 `\w`
  // 默认是 Unicode 的 —— 客户端照抄 `[\w-]` 会把默认生成的「访客-xxxx」判成非法，
  // 于是用户看到的是"自己填的笔名不合法"，而服务端其实完全接受。
  const line = server.match(/NAME_RE = re\.compile\(.*\)/)?.[0] ?? '';
  assert.ok(line.includes('[\\w-]'), `服务端笔名规则应为 Unicode 的 \\w 形式，实际是：${line}`);
  assert.ok(!/\[A-Za-z0-9/.test(line), '不要退化成 ASCII 专用字符类');

  // 用「Python 的 \w 等价物」当参照物：\p{L}\p{N}_ 。
  const serverSide = /^[\p{L}\p{N}_-]{1,24}$/u;
  for (const good of ['访客-7f3a', '同学', 'abc', 'a_b-1', '机-2']) {
    assert.ok(isValidName(good), `${good} 在客户端应当合法`);
    assert.ok(serverSide.test(good), `${good} 在服务端也该合法 —— 两端必须一致`);
  }
  for (const bad of ['a b', '<script>', '', 'x'.repeat(25), '张三 138']) {
    assert.equal(isValidName(bad), false, `${bad} 应当被拒`);
    assert.equal(serverSide.test(bad), false, `${bad} 在服务端也该被拒`);
  }
});

/* ────────────────────────────────────────────────── 接口 */

test('发新需求只发白名单字段，不夹带身份信息', async () => {
  let sent = null;
  const fake = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ ok: true, issue: { id: 'F-009' } }) };
  };
  const answer = await submitIssue(
    { kind: 'new', title: '  标题  ', detail: '  正文  ', name: '访客-1', username: 'someone', ip: '1.2.3.4' },
    { endpoint: 'https://example.test', fetch: fake },
  );
  assert.equal(answer.ok, true);
  assert.equal(answer.issue.id, 'F-009');
  assert.equal(sent.url, 'https://example.test/feedback');
  assert.deepEqual(Object.keys(sent.body).sort(), ['detail', 'kind', 'name', 'title'], '多一个字段都不许发');
  assert.deepEqual(sent.body, { kind: 'new', title: '标题', detail: '正文', name: '访客-1' }, '两端空白要修掉');
});

test('评论打到评论端点，只发白名单字段', async () => {
  let sent = null;
  const fake = async (url, options) => {
    sent = { url, body: JSON.parse(options.body) };
    return { ok: true, status: 200, json: async () => ({ ok: true, comment: { cid: 'c1' } }) };
  };
  const answer = await submitComment(
    { issue: 'F-002', body: '  我也想要  ', name: '访客-2', email: 'a@b.c' },
    { endpoint: 'https://example.test', fetch: fake },
  );
  assert.equal(answer.ok, true);
  assert.equal(sent.url, 'https://example.test/feedback/comment');
  assert.deepEqual(Object.keys(sent.body).sort(), ['body', 'issue', 'name']);
  assert.deepEqual(sent.body, { issue: 'F-002', body: '我也想要', name: '访客-2' });
});

test('端点路径是契约：与服务端逐一对应', () => {
  // 路径写错的表现是 404，而且只有真跑起来才发现 —— 这里对着服务端的路由钉住。
  assert.equal(paths.issues, '/feedback');
  assert.equal(paths.comment, '/feedback/comment');
  for (const path of Object.values(paths)) {
    assert.ok(server.includes(`"${path}"`), `服务端没有 ${path} 这个路由`);
  }
});

test('页面侧不打机器人端点：那不是它的事，归 robot/feedback.py', () => {
  // 页面只有「发需求 / 评论 / 读列表」三件事。机器人回帖与状态推进由 `robot/` 负责 ——
  // 那两条路径**公开可用**（谁都能当机器人），但页面本身不该替用户去当。
  // 只看**代码**、不看注释 —— 注释里正当的解释（"那两条不在这里"）不该被判违规。
  const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const board = strip(readFileSync(`${root}packages/dsh-zhiyun-page-feedback/src/board.js`, 'utf8'));
  assert.ok(!/feedback\/robot/.test(board), 'board.js 不该有机器人端点');
  assert.ok(!/feedback\/status/.test(board), 'board.js 不该有状态端点');
  const robot = readFileSync(`${root}robot/feedback.py`, 'utf8');
  assert.match(robot, /\/feedback\/robot/, '机器人脚本要打机器人端点');
  assert.match(robot, /\/feedback\/status/, '机器人脚本要打状态端点');
});

test('机器人路径是公开的：代码里不该有任何凭证机制', () => {
  // 这一条是用户明确要求的形态：拿到 robot/SKILL.md 的任何人都能当机器人，
  // 「谁想处理评论都行」。曾经用令牌把这两条路径锁起来，那违背了这个意志。
  const server = readFileSync(`${root}deploy/feedback-service/server.py`, 'utf8');
  for (const pattern of [/ROBOT_TOKEN/, /x-robot-token/, /hmac/, /_authed/]) {
    assert.ok(!pattern.test(server), `服务端不该再有凭证机制：${pattern}`);
  }
  const robot = readFileSync(`${root}robot/feedback.py`, 'utf8');
  assert.ok(!/TOKEN/.test(robot), '机器人工具不该读令牌');
});

/* ────────────────────────────────────────── 待回应队列（机器人据此干活） */

test('needsReply：没人评论过要回应，机器人最后说过就不用', () => {
  assert.equal(needsReply({ ...sampleIssue, comments: [] }), true, '没人理的需求最需要先开口');
  assert.equal(needsReply({ ...sampleIssue, comments: [{ name: 'n', body: 'b' }] }), true);
  assert.equal(needsReply(sampleIssue), true, '最后一条是普通用户 → 要回应');
  assert.equal(needsReply({ ...sampleIssue, comments: [{ name: 'n', body: 'b' }, { name: '反馈机器人', body: 'r', robot: true }] }), false);
  // 机器人答复后用户又追加 → 重新变成待回应。
  assert.equal(needsReply({
    ...sampleIssue,
    comments: [{ robot: true, body: 'r' }, { robot: false, body: '还是不行' }],
  }), true);
  // 状态无关：已实现的需求下面照样可以有新讨论。
  assert.equal(needsReply({ ...sampleIssue, status: 'done', comments: [{ robot: false, body: 'b' }] }), true);
  assert.equal(needsReply({ ...sampleIssue, status: 'done', comments: [{ robot: true, body: 'r' }] }), false);
  assert.equal(needsReply({ id: 'F-1' }), true, '评论字段缺失时当作待回应，不能静默漏掉');
});

test('pendingIssues：只留待回应的，且最久没人管的排最前', () => {
  const pending = pendingIssues([
    { id: 'F-001', last: 300, comments: [{ robot: false, body: 'b' }] },
    { id: 'F-002', last: 100, comments: [{ robot: false, body: 'b' }] },
    { id: 'F-003', last: 200, comments: [{ robot: true, body: 'r' }] },
    { id: 'F-004', last: 50, comments: [] },
  ]);
  // F-003 已答复，排除；其余按 last 升序 —— 先来先答，否则冷门条目永远轮不上。
  assert.deepEqual(pending.map(issue => issue.id), ['F-004', 'F-002', 'F-001']);
  // 不改动入参。
  const input = [{ id: 'F-001', last: 300, comments: [] }, { id: 'F-002', last: 100, comments: [] }];
  pendingIssues(input);
  assert.deepEqual(input.map(issue => issue.id), ['F-001', 'F-002']);
});

test('服务端拒收时报出它的原因，网络故障不伪装成成功', async () => {
  const rejected = await submitIssue({ kind: 'new', title: 't', detail: 'd', name: 'n' }, {
    endpoint: 'https://x.test',
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: '字段不合法' }) }),
  });
  assert.deepEqual(rejected, { ok: false, error: '字段不合法' });

  const offline = await submitIssue({ kind: 'new', title: 't', detail: 'd', name: 'n' }, {
    endpoint: 'https://x.test',
    fetch: async () => { throw new Error('network down'); },
  });
  assert.equal(offline.ok, false);
  assert.match(offline.error, /连不上/);
});

test('读取社区：正常返回讨论串，失败时给空表与原因', async () => {
  const ok = await loadIssues({
    endpoint: 'https://x.test',
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, issues: [sampleIssue] }) }),
  });
  assert.deepEqual(ok.issues, [sampleIssue]);

  const bad = await loadIssues({ endpoint: 'https://x.test', fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.issues, [], '失败时必须给空表，调用方不用再防 undefined');
  assert.match(bad.error, /请求失败/);

  // 服务端连不上（实例重启中）也是最常见的故障之一。
  const down = await loadIssues({ endpoint: 'https://x.test', fetch: async () => { throw new Error('down'); } });
  assert.deepEqual(down.issues, []);
  assert.match(down.error, /连不上/);
});

/* ────────────────────────────────────────────────── 时间 */

test('相对时间只给量级，注入 now 才可测', () => {
  const now = 1700000000;
  assert.equal(ago(now - 5, now), '刚刚');
  assert.equal(ago(now - 120, now), '2 分钟前');
  assert.equal(ago(now - 7200, now), '2 小时前');
  assert.equal(ago(now - 86400 * 3, now), '3 天前');
  assert.equal(ago(now - 86400 * 60, now), '2 个月前');
  assert.equal(ago(undefined, now), '', '没有时间就不硬编一个');
  assert.equal(ago('x', now), '');
  // 时钟偏差导致"未来"的时间戳也不能显示成负数。
  assert.equal(ago(now + 500, now), '刚刚');
});

/* ────────────────────────────────────────────────── 接线 */

test('接线：注册了 zhiyun.feedback.content 插槽', () => {
  assert.match(source, /'zhiyun\.feedback\.content'/, '页面必须注册 zhiyun.feedback.content 插槽');
  assert.match(readFileSync(`${root}packages/dsh-zhiyun-shell/src/model.js`, 'utf8'), /id: 'feedback'/, '外壳 NAV 里必须有 id: feedback');
});

test('接线：页面只依赖 slots，收件服务挂了不影响它渲染', () => {
  // 只能声明 slots：反馈入口是用户唯一能说"哪里坏了"的地方，不能因为别的包停用而消失。
  const inject = source.match(/export const inject = \[([^\]]*)\]/);
  assert.ok(inject, '页面必须显式声明 inject');
  assert.deepEqual(inject[1].split(',').map(part => part.trim().replace(/['"]/g, '')).filter(Boolean), ['slots']);
  // 离线时要说清楚是"连不上"，不能装作"还没有人提过"（那是两回事，后者会让人以为数据没了）。
  assert.match(source, /连不上反馈服务/);
});

test('仓库里不再有第二份只读公开板（单一真值）', () => {
  // 服务端条目改了而仓库那份不知道，就会出现两个打架的来源 —— 宁可只有服务端一处。
  assert.throws(() => readFileSync(`${root}packages/dsh-zhiyun-page-feedback/data/issues.json`, 'utf8'),
    /ENOENT/, 'data/issues.json 应当已经删掉');
  assert.ok(!/issues\.json/.test(source), '页面不该再引用仓库内的公开板');
});
