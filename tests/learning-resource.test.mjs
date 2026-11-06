/**
 * 标准学习资源层（schema v1）—— 结构闸门、缓存键、来源定位。
 *
 * 本文件钉的是**契约**，不是实现细节：
 *
 * 1. `validate()` 必须按 JSON Pointer 精确报位置，并且**一次收齐全部错误**
 *    （只报第一个的校验器会让人改一处跑一次，五分钟的活变成半小时）。
 * 2. `contentHash` / `revision` 必须对**键序不敏感、对内容敏感**。
 *    前者不对 → 同一份内容算出两个缓存键，派生资源白算；后者不对 → 内容变了却命中旧缓存，
 *    用户拿到的是上一版的题。两条都必须有测试，因为它们都是"悄悄错"的类型。
 * 3. `project()` 必须能把 `anchorId` 反查回 `{topicId, blockId, page, timeRange}`。
 *    这是"来源定位"链的落点：题目要能跳回讲义的那一页、那一秒。
 *    投影若把锚点吞掉，之后的任何一层都补不回来 —— 所以这条单独钉。
 * 4. 宿主侧 `createResourceRegistry` 必须**先校验再落盘**、快照不可变、重复 attach 幂等、
 *    release 不删快照。
 *
 * 测试里的每份 bundle 都写全必填字段：schema 是 `additionalProperties: false` 且 required 14 项，
 * 用"半个对象 + 假设校验器会宽容"来测，测的就不是契约了。
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  name as pluginName,
  inject as pluginInject,
  apply as pluginApply,
  validate,
  contentHash,
  revisionOf,
  canonicalJson,
  stamp,
  project,
  lookupAnchor,
  anchors,
  fromLecture,
  loadSchema,
  formatErrors,
} from '../packages/dsh-zhiyun-core-learning-resource/src/index.js';
import {
  createResourceRegistry,
  toUpstreamResourcePayload,
  snapshotFileName,
  revisionFor,
} from '../packages/dsh-zhiyun-host-deeptutor/src/resources.js';

const SHA = `sha256:${'0'.repeat(64)}`;

/** 一份**合法**的标准学习资源。所有用例都以它为底稿再破坏一处。 */
function makeBundle(overrides = {}) {
  return {
    schemaVersion: 1,
    resourceId: 'res_0123456789abcdef',
    accountScope: { accountId: 'acc-1', workspaceId: null },
    courseId: 'course-1',
    subId: 'sub-1',
    generatedAt: '2026-01-01T00:00:00.000Z',
    revision: SHA,
    contentHash: SHA,
    title: '操作系统绪论',
    language: 'zh',
    contentType: 'lecture-v4',
    chapters: [
      {
        id: 'ch1',
        title: '第一章 概述',
        topics: [
          {
            id: 't1-1',
            title: '什么是操作系统',
            blocks: [
              {
                id: 'b1-1-1',
                type: 'paragraph',
                text: '操作系统是管理硬件与软件资源的系统软件。',
                assetRef: null,
                anchorIds: ['a1-1-1'],
                meta: { lectureKind: 'elaboration' },
              },
              {
                id: 'b1-1-2',
                type: 'callout',
                text: '定义：操作系统是资源的抽象层。',
                assetRef: null,
                anchorIds: ['a1-1-2'],
                // meta 是可选字段，schema 只允许 `object`（不允许 null）：
                // 不写就是"没有额外元数据"，写 null 反而会校验失败。
              },
            ],
          },
          {
            id: 't1-2',
            title: '内核与用户态',
            blocks: [
              {
                id: 'b1-2-1',
                type: 'list',
                text: '内核态：可执行特权指令。\n用户态：受限于系统调用。',
                assetRef: null,
                anchorIds: ['a1-2-1'],
              },
            ],
          },
        ],
      },
    ],
    selectedTopicIds: [],
    selectedRanges: [],
    sourceAnchors: [
      {
        anchorId: 'a1-1-1',
        topicId: 't1-1',
        blockId: 'b1-1-1',
        page: 1,
        timeRange: { startMs: 12000, endMs: 24000 },
        assetRef: null,
        confidence: 0.92,
        origin: 'transcript',
      },
      {
        anchorId: 'a1-1-2',
        topicId: 't1-1',
        blockId: 'b1-1-2',
        page: 2,
        timeRange: { startMs: 24000, endMs: 40000 },
        assetRef: null,
        confidence: 0.88,
        origin: 'slide',
      },
      {
        anchorId: 'a1-2-1',
        topicId: 't1-2',
        blockId: 'b1-2-1',
        page: 3,
        timeRange: null,
        assetRef: null,
        confidence: null,
        origin: 'manual',
      },
      // 没有落到任何块上的锚点：上游只给页码的场合。投影必须照样能反查它。
      {
        anchorId: 'a-orphan',
        topicId: null,
        blockId: null,
        page: 9,
        timeRange: null,
        assetRef: null,
        confidence: null,
        origin: 'manual',
      },
    ],
    warnings: [],
    sourceConfidence: 0.9,
    reviewStatus: 'draft',
    ...overrides,
  };
}

/** 断言校验失败，且**恰好**报了这些路径（顺序无关）。 */
function assertPaths(bundle, expectedPaths) {
  const result = validate(bundle);
  assert.equal(result.valid, false, '这份 bundle 应该校验不通过');
  const actual = result.errors.map((error) => error.path).sort();
  assert.deepEqual(actual, [...expectedPaths].sort(), `报错路径不符：${formatErrors(result.errors)}`);
  for (const error of result.errors) {
    // 每条错误都必须有可读的中文文案：UI 直接把 message 给人看。
    assert.equal(typeof error.message, 'string');
    assert.ok(error.message.length > 0);
  }
  return result;
}

// ── schema 本身 ────────────────────────────────────────────────────────────

test('schema 能加载，并且用到的关键字本校验器都实现了', () => {
  const schema = loadSchema();
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  // 加载期白名单检查若发现未实现的关键字会直接抛错。这里显式再走一遍，
  // 是为了让"上游给 schema 加了关键字、而校验器没跟上"变成一个失败的测试，
  // 而不是线上静默变松（那会让一份不合法的资源顺利进快照）。
  assert.doesNotThrow(() => loadSchema());
  assert.ok(schema.$defs && Object.keys(schema.$defs).length >= 5);
});

test('合法 bundle 通过校验且不产生任何错误', () => {
  const result = validate(makeBundle());
  assert.equal(result.valid, true, formatErrors(result.errors));
  assert.deepEqual(result.errors, []);
});

// ── 结构闸门：错误必须报在**准确的位置** ──────────────────────────────────

test('缺必填字段：报在缺的那一层，不牵连兄弟字段', () => {
  const bundle = makeBundle();
  delete bundle.title;
  delete bundle.language;
  assertPaths(bundle, ['/title', '/language']);
});

test('多余字段：additionalProperties:false 在根与嵌套层都生效', () => {
  // 根层多一个字段。
  assertPaths(makeBundle({ extra: 1 }), ['/extra']);

  // ⚠️ 嵌套层：`$defs/topic` 也是 additionalProperties:false。
  //    这条钉的是"$ref 展开后兄弟关键字也要跑" —— 只用 `$ref` 替换掉整个
  //    子 schema 的朴素实现会漏掉这一条。
  const nested = makeBundle();
  nested.chapters[0].topics[0].surprise = true;
  assertPaths(nested, ['/chapters/0/topics/0/surprise']);
});

test('类型错：报在错的那个字段上，并说明实际是什么', () => {
  assertPaths(makeBundle({ chapters: '不是数组' }), ['/chapters']);
  assertPaths(makeBundle({ schemaVersion: '1' }), ['/schemaVersion']);
  const result = assertPaths(makeBundle({ warnings: {} }), ['/warnings']);
  assert.match(result.errors[0].message, /array/);
});

test('pattern 错：revision / contentHash 必须形如 sha256:<64 hex>', () => {
  assertPaths(makeBundle({ revision: 'sha256:XYZ' }), ['/revision']);
  assertPaths(makeBundle({ contentHash: 'deadbeef' }), ['/contentHash']);
  // 大写 hex 也是错的：规范里写的是 [0-9a-f]，放宽会让大小写两份哈希并存。
  assertPaths(makeBundle({ revision: `sha256:${'A'.repeat(64)}` }), ['/revision']);
});

test('$ref 嵌套错：路径能一路指到最里面的块', () => {
  const badType = makeBundle();
  badType.chapters[0].topics[1].blocks[0].type = 'paragraph-and-more';
  assertPaths(badType, ['/chapters/0/topics/1/blocks/0/type']);

  const badId = makeBundle();
  delete badId.chapters[0].topics[1].blocks[0].id;
  assertPaths(badId, ['/chapters/0/topics/1/blocks/0/id']);

  const badRange = makeBundle();
  badRange.sourceAnchors[0].timeRange = { startMs: 0 };
  assertPaths(badRange, ['/sourceAnchors/0/timeRange/endMs']);

  const badAnchor = makeBundle();
  delete badAnchor.sourceAnchors[2].origin;
  assertPaths(badAnchor, ['/sourceAnchors/2/origin']);
});

test('enum / const / minimum / maximum / minLength 各报在自己的路径上', () => {
  assertPaths(makeBundle({ reviewStatus: '完成' }), ['/reviewStatus']);
  assertPaths(makeBundle({ sourceConfidence: 1.5 }), ['/sourceConfidence']);
  assertPaths(makeBundle({ sourceConfidence: -0.1 }), ['/sourceConfidence']);
  assertPaths(makeBundle({ title: '' }), ['/title']);

  const badPage = makeBundle();
  badPage.sourceAnchors[0].page = -1;
  assertPaths(badPage, ['/sourceAnchors/0/page']);
});

test('format date-time 宽松校验：认 RFC 3339，不认随便一个字符串', () => {
  for (const ok of ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00.123Z', '2026-01-01T08:00:00+08:00']) {
    assert.equal(validate(makeBundle({ generatedAt: ok })).valid, true, `${ok} 应该通过`);
  }
  for (const bad of ['2026-01-01', '昨天', '', 'T00:00:00Z']) {
    assert.equal(validate(makeBundle({ generatedAt: bad })).valid, false, `${bad} 应该被拒`);
  }
});

test('一次收齐全部错误，而不是只报第一个', () => {
  const bundle = makeBundle();
  delete bundle.title;
  delete bundle.courseId;
  bundle.reviewStatus = '待审';
  bundle.chapters[0].topics[0].blocks[1].type = 'nope';
  const result = validate(bundle);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length >= 4, `应当一次报出至少 4 条，实际 ${result.errors.length}`);
  const paths = result.errors.map((error) => error.path);
  for (const expected of ['/title', '/courseId', '/reviewStatus', '/chapters/0/topics/0/blocks/1/type']) {
    assert.ok(paths.includes(expected), `缺少 ${expected} 的报错：${paths.join(' , ')}`);
  }
});

// ── 缓存键：对键序不敏感、对内容敏感 ──────────────────────────────────────

test('contentHash：同一内容、键顺序不同 → 同一个 hash', () => {
  const a = makeBundle();
  // 深递归反转每一层的键序。只反转根层是不够的 —— 真正会漂的是
  // JSON.stringify 的默认键序，它在每一层都按插入顺序走。
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      const out = {};
      for (const key of Object.keys(value).reverse()) out[key] = reverseKeys(value[key]);
      return out;
    }
    return value;
  };
  const b = reverseKeys(makeBundle());
  assert.equal(contentHash(a), contentHash(b));
  assert.equal(revisionOf(a), revisionOf(b));
  // 也钉住规范化结果本身：靠 JSON.stringify 恰好顺序一致不算数。
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test('contentHash：任何一处内容变化都换 hash（含深层字段）', () => {
  const base = contentHash(makeBundle());
  const mutations = [
    ['标题', (bundle) => { bundle.title = '操作系统绪论（二）'; }],
    ['块正文', (bundle) => { bundle.chapters[0].topics[0].blocks[0].text += '。'; }],
    ['块类型', (bundle) => { bundle.chapters[0].topics[0].blocks[0].type = 'callout'; }],
    ['锚点页码', (bundle) => { bundle.sourceAnchors[0].page = 7; }],
    ['锚点时间', (bundle) => { bundle.sourceAnchors[0].timeRange.endMs = 99999; }],
    ['选择器', (bundle) => { bundle.selectedTopicIds = ['t1-1']; }],
    ['复习状态', (bundle) => { bundle.reviewStatus = 'approved'; }],
  ];
  for (const [label, mutate] of mutations) {
    const bundle = makeBundle();
    mutate(bundle);
    assert.notEqual(contentHash(bundle), base, `改了「${label}」就该换 hash`);
  }
});

test('contentHash 不受 revision / contentHash / generatedAt 影响（否则自我循环）', () => {
  // 这三个是**派生**字段：把它们算进内容哈希，等于让哈希依赖它自己。
  // 更实际的后果是：每次重新生成都换缓存键，派生资源永远命中不了缓存。
  const base = contentHash(makeBundle());
  assert.equal(contentHash(makeBundle({ revision: `sha256:${'a'.repeat(64)}` })), base);
  assert.equal(contentHash(makeBundle({ contentHash: `sha256:${'b'.repeat(64)}` })), base);
  assert.equal(contentHash(makeBundle({ generatedAt: '2030-12-31T23:59:59.000Z' })), base);
});

test('stamp：补派生字段，且两次签章得到同一个 revision', () => {
  const bundle = makeBundle();
  const first = stamp(bundle);
  const second = stamp(bundle);
  assert.equal(first.revision, second.revision);
  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.generatedAt, bundle.generatedAt, '已给出的 generatedAt 要保留，不能伪造新的生成时刻');
  assert.equal(validate(first).valid, true);
  // 原对象不被就地改动：调用方可能还要把它拿去别处用。
  assert.equal(bundle.revision, SHA);
});

test('revision 与 contentHash 同形状但不同值，且都随资源身份变化', () => {
  const bundle = makeBundle();
  const stamped = stamp(bundle);
  assert.match(stamped.revision, /^sha256:[0-9a-f]{64}$/);
  assert.match(stamped.contentHash, /^sha256:[0-9a-f]{64}$/);
  assert.notEqual(stamped.revision, stamped.contentHash, 'revision 把身份也算进去了，不该等于纯内容哈希');

  // 账号变了就是另一份资源：两个字段都得跟着变。
  const other = makeBundle({ accountScope: { accountId: 'acc-2', workspaceId: null } });
  assert.notEqual(contentHash(other), contentHash(bundle));
  assert.notEqual(revisionOf(other), revisionOf(bundle));

  // ⚠️ revision 的身份折叠是**额外一层**，不是靠 contentHash 顺带实现的：
  //    若 contentHash 来自外部注入（契约允许），它不一定覆盖身份字段。
  //    这条钉住"同样的 contentHash + 不同账号 → 不同 revision"，
  //    否则两个账号投影出同样的空讲义时会互相顶掉快照
  //    （快照路径是 `<revision>.json`，一条路径只能有一份内容）。
  const digest = contentHash(bundle);
  assert.equal(revisionFor(bundle, digest), revisionFor({ ...bundle }, digest), '同一身份必须算出同一 revision');
  assert.notEqual(revisionFor(bundle, digest), revisionFor(other, digest), '只换账号也必须换 revision');
  assert.notEqual(revisionFor(bundle, digest), revisionFor({ ...bundle, subId: 'sub-2' }, digest), '只换节次也必须换 revision');
});

// ── 投影：来源定位链的落点 ────────────────────────────────────────────────

test('project：纯文本带章节与块号，块号是反查的钥匙', () => {
  const projection = project(makeBundle());
  assert.match(projection.text, /^# 操作系统绪论/m);
  assert.match(projection.text, /## 第一章 概述/);
  assert.match(projection.text, /### 什么是操作系统/);
  assert.match(projection.text, /\[b1-1-1\]/);
  assert.match(projection.text, /\[b1-2-1\]/);
  assert.equal(projection.blocks.length, 3);
  assert.deepEqual(projection.stats.selected, 'all');
});

test('project：anchorIndex 能反查到 topicId / blockId / page / timeRange', () => {
  const projection = project(makeBundle());
  const hit = projection.anchorIndex['a1-1-1'];
  assert.ok(hit, 'anchorIndex 里必须有 a1-1-1');
  assert.equal(hit.topicId, 't1-1');
  assert.equal(hit.blockId, 'b1-1-1');
  assert.equal(hit.page, 1);
  assert.deepEqual(hit.timeRange, { startMs: 12000, endMs: 24000 });

  // 反查还要能拿到对应的块正文 —— 只给页码不够，UI 要能高亮那一段。
  const located = lookupAnchor(projection, 'a1-1-1');
  assert.equal(located.block.blockId, 'b1-1-1');
  assert.match(located.block.text, /操作系统是管理硬件/);

  // 缺时段与页码的锚点不兜底成 0：0 是合法的片头时刻与封面页，
  // 兜底会把"不知道在哪"伪装成"在开头"。
  assert.equal(projection.anchorIndex['a1-2-1'].timeRange, null);
});

test('project：没有落到块上的锚点照样进索引（上游可能只给页码）', () => {
  const projection = project(makeBundle());
  assert.ok(projection.anchorIndex['a-orphan'], 'orphan 锚点不能被投影吞掉');
  assert.equal(projection.anchorIndex['a-orphan'].page, 9);
  assert.equal(projection.anchorIndex['a-orphan'].blockId, null);
});

test('project：选择器只投影选中部分，且索引里不留"索引有、正文无"的假锚点', () => {
  const bundle = makeBundle({ selectedTopicIds: ['t1-2'] });
  const projection = project(bundle);
  assert.equal(projection.stats.selected, 'partial');
  assert.equal(projection.blocks.length, 1);
  assert.equal(projection.blocks[0].blockId, 'b1-2-1');
  assert.ok(!projection.text.includes('什么是操作系统'), '没选中的知识点不该出现在投影里');
  assert.equal(projection.anchorIndex['a1-1-1'], undefined, '没被投影的块的锚点不该在索引里');

  // selectedRanges 只取列出的块（blockIds 为空 = 整段）。
  const ranged = makeBundle({ selectedRanges: [{ topicId: 't1-1', blockIds: ['b1-1-2'] }] });
  const rangedProjection = project(ranged);
  assert.deepEqual(rangedProjection.blocks.map((block) => block.blockId), ['b1-1-2']);
  assert.deepEqual(Object.keys(rangedProjection.anchorIndex).sort(), ['a-orphan', 'a1-1-2']);
});

test('project：坏数据不抛，缺 id 的块被跳过并记进 warnings', () => {
  const bundle = makeBundle();
  delete bundle.chapters[0].topics[0].blocks[0].id;
  const projection = project(bundle);
  assert.equal(projection.blocks.length, 2);
  assert.ok(projection.warnings.some((warning) => warning.code === 'BLOCK_MISSING_ID'));

  // 投影永不抛：即使传空对象，也要给出一个空投影而不是炸在调用方。
  const empty = project({});
  assert.equal(empty.text, '');
  assert.deepEqual(empty.blocks, []);
});

test('anchors：按 anchorId / topicId / 页码三种方式都能取到', () => {
  const index = anchors(makeBundle());
  assert.equal(index.get('a1-1-1').page, 1);
  assert.deepEqual(index.forTopic('t1-1').map((anchor) => anchor.anchorId).sort(), ['a1-1-1', 'a1-1-2']);
  assert.deepEqual(index.forPage(3).map((anchor) => anchor.anchorId), ['a1-2-1']);
  assert.deepEqual(index.locate('a1-2-1'), {
    anchorId: 'a1-2-1',
    page: 3,
    timeRange: null,
    assetRef: null,
    topicId: 't1-2',
    blockId: 'b1-2-1',
    origin: 'manual',
  });
  assert.equal(index.get('不存在'), null);
});

// ── 从既有讲义投影 ────────────────────────────────────────────────────────

test('fromLecture：投影出可校验的 bundle，并丢掉写作态字段', () => {
  const lecture = {
    title: '绪论',
    chapters: [{
      no: 1,
      title: '概述',
      topics: [{
        title: '什么是操作系统',
        fromPage: 1,
        toPage: 3,
        anchor: { page: 1, tSec: 12 },
        // 写作态字段：不该进 bundle（语气判定抖动一次就会换 revision，
        // 让所有派生资源重新计算）。
        register: 'friendly',
        draft: '草稿',
        notes: ['内部备注'],
        passages: [{ text: '口述内容', label: 'P1' }],
        blocks: [
          { kind: 'definition', title: '定义', text: '操作系统是管理硬件的软件' },
          { kind: 'example', title: '例题', stem: 'OS 的作用？', solution: '资源管理' },
          { kind: 'note', text: '   ' },
        ],
      }],
    }],
  };
  const bundle = fromLecture({
    lecture,
    courseId: 'course-1',
    subId: 'sub-1',
    accountScope: { accountId: 'acc-1' },
    title: '绪论讲义',
  });
  const stamped = stamp(bundle);
  assert.equal(validate(stamped).valid, true, formatErrors(validate(stamped).errors));

  const serialized = canonicalJson(stamped);
  for (const leaked of ['friendly', '内部备注', '草稿', '口述内容']) {
    assert.ok(!serialized.includes(leaked), `写作态字段「${leaked}」不该进 bundle`);
  }

  // 例题用 stem + solution 拼正文（与 agent-text.js 的 blockText 同口径）。
  const question = stamped.chapters[0].topics[0].blocks.find((block) => block.type === 'question');
  assert.match(question.text, /OS 的作用/);
  assert.match(question.text, /资源管理/);

  // 空块被跳过并记录，不静默消失。
  assert.equal(stamped.chapters[0].topics[0].blocks.length, 2);
  assert.ok(stamped.warnings.some((warning) => warning.code === 'EMPTY_BLOCK'));

  // 每个块都有可反查的锚点（来源定位链的起点）。
  const projection = project(stamped);
  for (const block of projection.blocks) {
    assert.ok(block.anchorIds.length > 0, `${block.blockId} 必须有锚点`);
    assert.ok(projection.anchorIndex[block.anchorIds[0]], `${block.blockId} 的锚点必须能反查`);
  }
});

test('fromLecture：同一份讲义两次投影得到同一个 resourceId 与 revision', () => {
  const lecture = { chapters: [{ title: 'A', topics: [{ title: 'B', blocks: [{ kind: 'elaboration', text: '正文' }] }] }] };
  const input = { lecture, courseId: 'c', subId: 's', accountScope: { accountId: 'a' }, generatedAt: '2026-01-01T00:00:00.000Z' };
  const first = stamp(fromLecture(input));
  const second = stamp(fromLecture(input));
  assert.equal(first.resourceId, second.resourceId);
  assert.equal(first.revision, second.revision);

  // id 只依赖结构位置：同一份讲义换个标题，块 id 不变（否则改个标题就把锚点全换了）。
  const retitled = stamp(fromLecture({ ...input, title: '另一个标题' }));
  assert.deepEqual(
    retitled.chapters[0].topics[0].blocks.map((block) => block.id),
    first.chapters[0].topics[0].blocks.map((block) => block.id),
  );
});

// ── 宿主侧登记处：先校验、再落不可变快照 ──────────────────────────────────

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-resource-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** 用真实实现注入：测试要钉的是"接线起来之后的行为"。 */
function makeRegistry(dataDir) {
  return createResourceRegistry({ dataDir, validate, contentHash });
}

test('attach：合法 bundle 得到句柄，并落下不可变快照', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    const bundle = stamp(makeBundle());
    const handle = await registry.attach(bundle);

    assert.match(handle.handleId, /^rh_/);
    assert.equal(handle.resourceId, bundle.resourceId);
    assert.equal(handle.revision, revisionOf(bundle));
    assert.equal(handle.courseId, 'course-1');
    assert.equal(handle.subId, 'sub-1');
    assert.deepEqual(handle.accountScope, { accountId: 'acc-1', workspaceId: null });

    // 快照文件名不能用冒号（Windows 不允许），但必须能由 revision 唯一还原。
    assert.equal(path.basename(handle.snapshotPath), snapshotFileName(bundle.revision));
    assert.ok(!path.basename(handle.snapshotPath).includes(':'));

    const snapshot = JSON.parse(await readFile(handle.snapshotPath, 'utf8'));
    assert.equal(snapshot.revision, handle.revision);
    assert.equal(snapshot.title, bundle.title);
    // 快照本身必须还是合法的 schema v1 —— 落盘的是什么，读回来就得是什么。
    assert.equal(validate(snapshot).valid, true);

    // 同一个句柄能读回快照。
    assert.equal((await registry.snapshot(handle.handleId)).resourceId, bundle.resourceId);
    await registry.dispose();
  });
});

test('attach：校验不通过就抛，且**一个文件都不写**', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    const broken = makeBundle({ title: '' });
    await assert.rejects(() => registry.attach(broken), (error) => {
      assert.match(error.message, /学习资源不符合 schema/);
      // 报错要指出具体位置，不能只说"不合规"。
      assert.match(error.message, /\/title/);
      return true;
    });
    // 目录都不该被创建：先校验再落盘是硬约束（先落盘再校验会留下半个快照）。
    await assert.rejects(() => readdir(path.join(dir, 'snapshots')), { code: 'ENOENT' });
    await registry.dispose();
  });
});

test('attach：同一 revision 重复 attach 幂等，快照不重写', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    const bundle = stamp(makeBundle());
    const first = await registry.attach(bundle);
    const before = await readFile(first.snapshotPath, 'utf8');
    const beforeStat = await readdir(path.join(dir, 'snapshots'));

    const second = await registry.attach(bundle);
    const after = await readFile(second.snapshotPath, 'utf8');
    const afterStat = await readdir(path.join(dir, 'snapshots'));

    // "同一份终稿被 attach 两次"是正常行为（页面重开、插件重载）：不能报错。
    assert.equal(second.revision, first.revision);
    assert.equal(second.snapshotPath, first.snapshotPath);
    assert.notEqual(second.handleId, first.handleId, '每次 attach 都是独立句柄');
    assert.equal(await readFile(second.snapshotPath, 'utf8'), before, '快照内容不能被重写');
    assert.deepEqual(afterStat, beforeStat, '不该多出文件');

    // 句柄是两个，快照只有一个。
    assert.equal(registry.list().length, 2);
    await registry.dispose();
  });
});

test('release：只摘句柄，不删快照（其他 run 可能仍在读）', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    const handle = await registry.attach(stamp(makeBundle()));
    await registry.release(handle.handleId);

    assert.equal(registry.get(handle.handleId), null);
    // 快照必须还在：另一个 run 手里可能还攥着同 revision 的 handle。
    assert.equal(validate(JSON.parse(await readFile(handle.snapshotPath, 'utf8'))).valid, true);
    // release 未知句柄是空操作，不抛（卸载路径上重复 release 是常态）。
    await registry.release(handle.handleId);
    await registry.release('rh_不存在');
    await registry.dispose();
  });
});

test('资源注册表：validate / contentHash 缺失时构造期就抛，不静默降级', async () => {
  await withTempDir(async (dir) => {
    // 静默降级成"不校验直接落盘"是最坏的结果：快照看起来合法，实际从没校验过。
    assert.throws(() => createResourceRegistry({ dataDir: dir }), /validate/);
    assert.throws(() => createResourceRegistry({ dataDir: dir, validate }), /contentHash/);
    assert.throws(() => createResourceRegistry({ validate, contentHash }), /dataDir/);
  });
});

test('资源注册表：注入的实现惰性调用（构造时不解析服务）', async () => {
  await withTempDir(async (dir) => {
    // 加载顺序不保证：core-learning-resource 可能在 host-deeptutor 之后加载，
    // 所以 validate / contentHash 只能在 attach 里调，构造期不能碰。
    let calls = 0;
    const registry = createResourceRegistry({
      dataDir: dir,
      logger: {},
      validate: (bundle) => { calls += 1; return validate(bundle); },
      contentHash: (value) => { calls += 1; return contentHash(value); },
    });
    assert.equal(calls, 0, '构造期不该调用注入的实现');
    await registry.attach(stamp(makeBundle()));
    assert.ok(calls >= 2, 'attach 时必须真的校验并算哈希');
    await registry.dispose();
  });
});

test('资源注册表：每次 attach 都重算 revision，不信任调用方给的指纹', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    // 调用方给了合法形状但与内容不符的 revision。若沿用它，
    // 就会把**另一个 revision 名下的旧快照**当成这份资源的正文交给上游。
    const bundle = stamp(makeBundle());
    const forked = { ...bundle, title: '改过的标题', revision: bundle.revision };
    const handle = await registry.attach(forked);
    assert.notEqual(handle.revision, bundle.revision, 'revision 必须按内容重算');
    assert.equal(handle.revision, revisionOf(forked));
    const snapshot = JSON.parse(await readFile(handle.snapshotPath, 'utf8'));
    assert.equal(snapshot.title, '改过的标题', '快照里必须是这份内容，不是旧的那份');
    await registry.dispose();
  });
});

test('资源注册表：dispose 后拒绝新 attach，且不删已有快照', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    const handle = await registry.attach(stamp(makeBundle()));
    await registry.dispose();
    await assert.rejects(() => registry.attach(stamp(makeBundle())), (error) => {
      assert.equal(error.kind, 'E_DISABLED');
      return true;
    });
    // dispose 不删快照：别的 run / 别的进程可能还在读同 revision 的文件。
    assert.equal(validate(JSON.parse(await readFile(handle.snapshotPath, 'utf8'))).valid, true);
  });
});

// ── 上游载荷：来源定位链必须带得出去 ──────────────────────────────────────

test('toUpstreamResourcePayload：带上正文、块与可反查的 anchorIndex', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    const bundle = stamp(makeBundle());
    const handle = await registry.attach(bundle);
    const projection = project(bundle);
    const payload = toUpstreamResourcePayload(handle, bundle, { projection });

    assert.equal(payload.resourceId, handle.resourceId);
    assert.equal(payload.revision, handle.revision);
    assert.match(payload.text, /操作系统是管理硬件/);
    assert.equal(payload.blocks.length, 3);

    // 反查链的落点：上游拿到 anchorId 必须能问出位置。
    const located = payload.anchorIndex['a1-1-2'];
    assert.equal(located.page, 2);
    assert.deepEqual(located.timeRange, { startMs: 24000, endMs: 40000 });
    assert.ok(payload.references.some((reference) => reference.anchorId === 'a1-1-2'));

    // 账号归属这类宿主内政不该出现在给上游的结构里。
    assert.equal(payload.accountScope, undefined);
    assert.equal(payload.warnings, undefined);

    await registry.dispose();
  });
});

test('toUpstreamResourcePayload：缺省投影时仍带 anchorIndex（不能因为少传参数就断链）', async () => {
  await withTempDir(async (dir) => {
    const registry = makeRegistry(dir);
    const bundle = stamp(makeBundle());
    const handle = await registry.attach(bundle);
    const payload = toUpstreamResourcePayload(handle, bundle);
    assert.ok(payload.anchorIndex['a1-1-1'], '没有投影也要能从 sourceAnchors 建索引');
    assert.equal(payload.anchorIndex['a1-1-1'].page, 1);
    assert.match(payload.text, /操作系统是管理硬件/);
    await registry.dispose();
  });
});

// ── Cordis 插件壳 ─────────────────────────────────────────────────────────

test('插件：name / inject 符合契约，apply 交出 zhiyunLearningResource 且能摘干净', async () => {
  assert.equal(pluginName, 'zhiyun-learning-resource');
  assert.deepEqual(pluginInject, []);

  const provided = new Map();
  const ctx = {
    provide(key, value) {
      provided.set(key, value);
      return () => provided.delete(key);
    },
  };
  const teardown = pluginApply(ctx, {});
  const service = provided.get('zhiyunLearningResource');
  assert.ok(service, 'apply 必须交出 zhiyunLearningResource');
  for (const key of ['validate', 'contentHash', 'project', 'anchors', 'schema']) {
    assert.ok(service[key], `服务面上必须有 ${key}`);
  }
  assert.equal(service.validate(makeBundle()).valid, true);
  // 服务面上的函数与直接 import 的是同一份实现（不能有两套哈希规则）。
  assert.equal(service.contentHash(makeBundle()), contentHash(makeBundle()));

  assert.equal(typeof teardown, 'function');
  teardown();
  assert.equal(provided.has('zhiyunLearningResource'), false);
});
