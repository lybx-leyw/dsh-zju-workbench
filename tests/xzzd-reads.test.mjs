/**
 * 学在浙大的深入读取：活动、作业、活动详情、课件、我的提交。
 *
 * 这四块原先只在 omni（TypeScript 移植岗）里有。移植时保留了几条关键口径：
 *
 *  - **端点单复数**：`/api/courses/<id>/activities`（复数）vs
 *    `/api/course/<id>/coursewares`（单数）—— 写错不报 404，只是回另一个结构；
 *  - **当前学生 id 要从「谁读过」反推**，且拿到多个时必须报错（不能猜）；
 *  - **附件去重的"否决权"**：任一处 `allow_download=false`，结果就必须是禁止下载；
 *  - **`unknown` 与 `unsubmitted` 严格分开**：取不到状态不能谎称"未提交"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  XzzdReader, activitySummary, boundedText, filesOf, isGroupHomework,
  pageInfo, publicFile, submissionState,
} from '../packages/dsh-zhiyun-source-campus/src/xzzd-reads.js';

const XZZD = 'https://courses.zju.edu.cn';

/** 假 XzzdApi：记录请求，按路径回包。 */
function fakeApi(routes) {
  const calls = [];
  return {
    calls,
    json: async (url, options) => {
      const target = String(url);
      calls.push({ url: target, options });
      for (const [match, handler] of routes) {
        if (target.includes(match)) return handler(target, options);
      }
      return {};
    },
  };
}

const reader = (api) => new XzzdReader(api, XZZD);

/* ────────────────────────────────────── 纯函数 */

test('boundedText：超长截断并说明原文长度', () => {
  assert.equal(boundedText('short'), 'short');
  const long = 'x'.repeat(20);
  const out = boundedText(long, 5);
  assert.ok(out.startsWith('xxxxx'));
  assert.match(out, /已截断，原文 20 字符/);
  assert.equal(boundedText(null), '');
});

test('publicFile：兼容 name/file_name 与 mime_type/content_type 两种字段名', () => {
  assert.deepEqual(publicFile({ id: 1, name: 'a.pdf', mime_type: 'application/pdf' }), {
    id: 1, name: 'a.pdf', size: null, mimeType: 'application/pdf', allowDownload: null, updatedAt: null,
  });
  assert.equal(publicFile({ upload_id: 2, file_name: 'b.doc', content_type: 'x' }).id, 2);
  assert.equal(publicFile({ upload_id: 2, file_name: 'b.doc', content_type: 'x' }).mimeType, 'x');
});

test('filesOf：三处来源都要看，且"禁止下载"有否决权', () => {
  const files = filesOf({
    uploads: [{ id: 1, name: 'a', allow_download: true }],
    data: {
      // 同一份文件在这里被标成禁止下载 —— 最终结果必须是禁止
      uploads: [{ id: 1, name: 'a', allow_download: false }],
      files: [{ id: 2, name: 'b' }],
    },
  });
  assert.equal(files.length, 2, '按 id 去重');
  assert.equal(files.find((f) => f.id === 1).allowDownload, false, '任一来源禁止即禁止');
  assert.equal(files.find((f) => f.id === 2).name, 'b');
});

test('filesOf：否决权与顺序无关（先 true 后 false 也不行）', () => {
  const first = filesOf({
    uploads: [{ id: 1, allow_download: true }],
    data: { files: [{ id: 1, allow_download: false }] },
  });
  const second = filesOf({
    uploads: [{ id: 1, allow_download: false }],
    data: { files: [{ id: 1, allow_download: true }] },
  });
  assert.equal(first[0].allowDownload, false, 'true → false 必须禁止');
  assert.equal(second[0].allowDownload, false, 'false → true 也必须禁止（否决权不可被覆盖）');
});

test('filesOf：合并时不丢先出现那份的 mimeType/updatedAt', () => {
  // 后出现那份缺 mime/updatedAt，不能把前面已经拿到的值冲成 null
  const files = filesOf({
    uploads: [{ id: 3, mime_type: 'application/pdf', updated_at: '2026-10-01', size: 9 }],
    data: { files: [{ id: 3 }] },
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].mimeType, 'application/pdf', 'mimeType 不能被空对象冲掉');
  assert.equal(files[0].updatedAt, '2026-10-01');
  assert.equal(files[0].size, 9);
});

test('filesOf：没有 id 的文件丢掉，空输入给空数组', () => {
  assert.deepEqual(filesOf({ uploads: [{ name: '无 id' }] }), []);
  assert.deepEqual(filesOf({}), []);
});

test('isGroupHomework：三种字段任一说小组就是小组', () => {
  assert.equal(isGroupHomework({ submit_by_group: true }), true);
  assert.equal(isGroupHomework({ data: { is_group: true } }), true);
  assert.equal(isGroupHomework({ data: { is_group_submission: true } }), true);
  assert.equal(isGroupHomework({}), false);
});

test('submissionState：submitted / draft / unsubmitted / unknown 四态分明', () => {
  assert.equal(submissionState([{ is_draft: false, is_latest_version: true }]), 'submitted');
  assert.equal(submissionState([{ is_draft: true }]), 'draft');
  assert.equal(submissionState([], null), 'unsubmitted', '空列表且平台没说交过 → 没交');
  assert.equal(submissionState([], true), 'unknown', '平台说交过但列表空 → 不知道');
  assert.equal(submissionState([{ is_redo: true }]), 'draft', '重做中是草稿');
});

test('pageInfo：有 total 用 total，没有就看是否满页', () => {
  assert.deepEqual(pageInfo({ total: 100 }, 1, 30, 30), { page: 1, pageSize: 30, total: 100, nextPage: 2 });
  assert.equal(pageInfo({ total: 30 }, 1, 30, 30).nextPage, null, '刚好一页就没有下一页');
  assert.equal(pageInfo({}, 1, 30, 30).nextPage, 2, '没 total 但满页 → 可能还有');
  assert.equal(pageInfo({}, 1, 30, 10).nextPage, null, '没 total 且不满页 → 没了');
});

test('activitySummary：补齐课程 id、链接、附件，时间归一', () => {
  const row = activitySummary({
    id: 9, title: ' 第三章作业 ', type: 'homework',
    end_time: '2026-10-30 15:59:00', start_time: '2026-10-20T08:00:00+08:00',
    submitted: false, is_closed: false, group_set_id: 5,
    score_percentage: 0.2,
    uploads: [{ id: 1, name: '题目.pdf' }],
  }, 7, XZZD);

  assert.equal(row.id, '9');
  assert.equal(row.courseId, '7');
  assert.equal(row.title, '第三章作业', '首尾空白要裁掉');
  assert.equal(row.deadline.iso, '2026-10-30T07:59:00.000Z', '裸时间按东八区解释');
  assert.equal(row.startTime.iso, '2026-10-20T00:00:00.000Z');
  assert.equal(row.weightPercent, 0.2);
  assert.equal(row.files.length, 1);
  assert.match(row.url, /\/course\/7\/learning-activity\/full-screen#\/9/);
});

/* ────────────────────────────────────── 端点单复数 */

test('assignments：身份解析遇到 SESSION_EXPIRED 必须抛出，不能降级成"状态未知"', async () => {
  const api = {
    json: async (url) => {
      const target = String(url);
      if (target.includes('/homework-activities')) {
        return { homework_activities: [{ id: 1, title: '作业一' }] };
      }
      const error = new Error('登录已过期');
      error.code = 'SESSION_EXPIRED';
      throw error;
    },
  };
  await assert.rejects(
    () => reader(api).assignments('7', { withSubmissions: true }),
    (e) => e.code === 'SESSION_EXPIRED',
    '会话失效不能被吞成 submissionError，否则页面会说"状态未知"',
  );
});

test('列表端点：403/404 降级成空，但 SESSION_EXPIRED / RATE_LIMITED / API_SHAPE 必须抛', async () => {
  const notFound = { json: async () => { const e = new Error('x'); e.code = 'HTTP'; throw e; } };
  const forbidden = { json: async () => { const e = new Error('x'); e.code = 'FORBIDDEN'; throw e; } };

  for (const api of [notFound, forbidden]) {
    const out = await reader(api).activities('7');
    assert.deepEqual(out.activities, [], '403/404 是"这类没有"，不是整门课挂掉');
    assert.equal(out.total, null);
  }

  for (const code of ['SESSION_EXPIRED', 'RATE_LIMITED', 'API_SHAPE']) {
    const api = { json: async () => { const e = new Error('x'); e.code = code; throw e; } };
    await assert.rejects(() => reader(api).activities('7'), (e) => e.code === code, `${code} 必须抛`);
  }
});

test('materials：返回 materials 键（同时保留 activities 兼容名）', async () => {
  const api = fakeApi([
    ['/coursewares', () => ({ activities: [{ id: 1, title: '课件', type: 'material' }] })],
  ]);
  const out = await reader(api).materials('7');
  assert.equal(out.materials.length, 1, 'materials 是正式键');
  assert.equal(out.activities.length, 1, 'activities 是兼容键');
  assert.deepEqual(out.materials, out.activities, '两个键指向同一份数据');
});

test('assignments：404 按"这门课没有作业"降级', async () => {
  const api = { json: async () => { const e = new Error('x'); e.code = 'HTTP'; throw e; } };
  const out = await reader(api).assignments('7');
  assert.deepEqual(out.assignments, []);
  assert.equal(out.nextPage, null);
});

test('activities 走复数的 /api/courses/<id>/activities', async () => {
  const api = fakeApi([
    ['/activities', () => ({ activities: [{ id: 1, title: 'a' }], total: 1 })],
  ]);
  await reader(api).activities('7');
  assert.ok(api.calls[0].url.includes('/api/courses/7/activities'), `实际 ${api.calls[0].url}`);
  assert.equal(api.calls[0].url.includes('/api/course/7/'), false, '不能是单数');
});

test('materials 走单数的 /api/course/<id>/coursewares，并带 conditions', async () => {
  const api = fakeApi([
    ['/coursewares', () => ({ activities: [], total: 0 })],
  ]);
  await reader(api).materials('7');
  const url = api.calls[0].url;
  assert.ok(url.includes('/api/course/7/coursewares'), `实际 ${url}`);
  assert.equal(url.includes('/api/courses/7/'), false, '不能是复数');

  const conditions = JSON.parse(new URL(url).searchParams.get('conditions'));
  assert.deepEqual(conditions.itemsSortBy, { predicate: 'chapter', reverse: false });
  assert.deepEqual(conditions.ignore_activity_types, ['lesson'], 'lesson 不是材料，要排除');
});

test('assignments 走复数的 /api/courses/<id>/homework-activities', async () => {
  const api = fakeApi([
    ['/homework-activities', () => ({ homework_activities: [{ id: 1, title: 'hw' }] })],
  ]);
  await reader(api).assignments('7');
  assert.ok(api.calls[0].url.includes('/api/courses/7/homework-activities'));
});

/* ────────────────────────────────────── 参数校验 */

test('非法 courseId / activityId 在发请求前就拦住', async () => {
  const api = fakeApi([]);
  const r = reader(api);
  for (const bad of [0, -1, 'abc', null]) {
    await assert.rejects(() => r.activities(bad), (e) => e.code === 'INVALID_INPUT');
    await assert.rejects(() => r.materials(bad), (e) => e.code === 'INVALID_INPUT');
    await assert.rejects(() => r.activity(bad), (e) => e.code === 'INVALID_INPUT');
  }
  assert.equal(api.calls.length, 0, '非法参数不该打到网络');
});

test('缺 activities 字段时如实报结构异常', async () => {
  const api = fakeApi([['/activities', () => ({ pages: 1 })]]);
  await assert.rejects(() => reader(api).activities('7'), (e) => e.code === 'API_SHAPE');
});

/* ────────────────────────────────────── 当前用户 id */

test('currentUserId：从 activity_reads 反推出唯一 id', async () => {
  const api = fakeApi([
    ['/activity-reads-for-user', () => ({
      activity_reads: [
        { activity_id: 1, created_for_id: '3200100000' },
        { activity_id: 2, created_for_id: '3200100000' },
      ],
    })],
  ]);
  assert.equal(await reader(api).currentUserId('7'), '3200100000');
});

test('currentUserId：多个不同 id 时必须报错，不能猜', async () => {
  const api = fakeApi([
    ['/activity-reads-for-user', () => ({
      activity_reads: [{ created_for_id: '1' }, { created_for_id: '2' }],
    })],
  ]);
  await assert.rejects(() => reader(api).currentUserId('7'), (e) => {
    assert.equal(e.code, 'IDENTITY_UNAVAILABLE');
    return true;
  });
});

test('currentUserId：一条记录都没有也要报错', async () => {
  const api = fakeApi([['/activity-reads-for-user', () => ({ activity_reads: [] })]]);
  await assert.rejects(() => reader(api).currentUserId('7'), (e) => e.code === 'IDENTITY_UNAVAILABLE');
});

test('currentUserId：空串与纯空白要滤掉，不能拼出畸形 URL', async () => {
  const api = fakeApi([
    ['/activity-reads-for-user', () => ({
      activity_reads: [{ created_for_id: '' }, { created_for_id: '   ' }, { created_for_id: '3200100000' }],
    })],
  ]);
  assert.equal(await reader(api).currentUserId('7'), '3200100000', '空串不该算作一个 id');
});

test('currentUserId：数字与字符串形式的同一 id 要去重成一个', async () => {
  const api = fakeApi([
    ['/activity-reads-for-user', () => ({
      activity_reads: [{ created_for_id: 3200100000 }, { created_for_id: '3200100000' }],
    })],
  ]);
  assert.equal(await reader(api).currentUserId('7'), '3200100000');
});

test('小数 id 必须判非法，不能被静默截断成另一门课', async () => {
  const api = fakeApi([]);
  const r = reader(api);
  for (const bad of ['7.9', '12abc', '1e3', '+7.0']) {
    await assert.rejects(() => r.activities(bad), (e) => e.code === 'INVALID_INPUT', `id=${bad} 应被拦`);
  }
  assert.equal(api.calls.length, 0, '非法 id 不该打到网络');
});

/* ────────────────────────────────────── 我的提交 */

test('activitySubmission：个人作业走 students/<id>/submission_list', async () => {
  const api = fakeApi([
    ['/submission_list', () => ({
      list: [
        { id: 1, is_draft: true, is_latest_version: false },
        { id: 2, is_draft: false, is_latest_version: true, submitted_at: '2026-10-20T10:00:00+08:00', final_score: 95, instructor_comment: '不错' },
      ],
    })],
  ]);
  const out = await reader(api).activitySubmission({ id: 9, course_id: 7, submitted: true }, { userId: '3200100000' });

  assert.ok(api.calls[0].url.includes('/activities/9/students/3200100000/submission_list'), `实际 ${api.calls[0].url}`);
  assert.equal(out.submissionStatus, 'submitted');
  assert.equal(out.group, null);
  assert.equal(out.submissionCount, 2);
  assert.deepEqual(out.draftIds, [1]);
  assert.equal(out.latestSubmission.id, 2, '要挑 latest');
  assert.equal(out.latestSubmission.score, 95);
  assert.equal(out.latestSubmission.instructorComment, '不错');
});

test('activitySubmission：小组作业走 groups/<组id>/submission_list', async () => {
  const api = fakeApi([
    ['/group-sets/5/group', () => ({ group: { id: 88, name: '第三组' } })],
    ['/submission_list', () => ({ list: [{ id: 3, is_latest_version: true, is_draft: false }] })],
  ]);
  const out = await reader(api).activitySubmission(
    { id: 9, course_id: 7, group_set_id: 5, submit_by_group: true },
    { userId: '3200100000' },
  );

  assert.ok(api.calls.some((c) => c.url.includes('/group-sets/5/group')));
  assert.ok(api.calls.some((c) => c.url.includes('/activities/9/groups/88/submission_list')), '小组作业走 groups 路径');
  assert.deepEqual(out.group, { id: '88', name: '第三组', groupSetId: '5' });
  assert.equal(out.submissionStatus, 'submitted');
});

test('activitySubmission：小组作业缺 group_set_id 时明确报错但降级为 unknown', async () => {
  const api = fakeApi([]);
  const out = await reader(api).activitySubmission({ id: 9, course_id: 7, submit_by_group: true }, { userId: '1' });
  assert.equal(out.submissionStatus, 'unknown');
  assert.equal(out.submissionError.code, 'GROUP_UNAVAILABLE');
});

test('activitySubmission：未入组时也降级，不让整条作业消失', async () => {
  const api = fakeApi([['/group-sets/5/group', () => ({})]]);
  const out = await reader(api).activitySubmission(
    { id: 9, course_id: 7, group_set_id: 5, submit_by_group: true },
    { userId: '1' },
  );
  assert.equal(out.submissionStatus, 'unknown');
  assert.equal(out.submissionError.code, 'GROUP_UNAVAILABLE');
});

test('activitySubmission：会话失效必须抛出（不能降级成 unknown）', async () => {
  const api = {
    json: async () => {
      const error = new Error('expired');
      error.code = 'SESSION_EXPIRED';
      throw error;
    },
  };
  await assert.rejects(
    () => reader(api).activitySubmission({ id: 9, course_id: 7 }, { userId: '1' }),
    (e) => e.code === 'SESSION_EXPIRED',
  );
});

test('activitySubmission：普通网络错误降级，保留 code/message', async () => {
  const api = {
    json: async () => {
      const error = new Error('boom');
      error.code = 'HTTP';
      throw error;
    },
  };
  const out = await reader(api).activitySubmission({ id: 9, course_id: 7 }, { userId: '1' });
  assert.equal(out.submissionStatus, 'unknown');
  assert.deepEqual(out.submissionError, { code: 'HTTP', message: 'boom' });
});

/* ────────────────────────────────────── 作业列表补提交 */

test('assignments：默认不逐条补提交（避免 N+1），开启后会带上状态', async () => {
  const shared = [
    ['/homework-activities', () => ({
      homework_activities: [
        { id: 1, title: '作业一', submitted: false },
        { id: 2, title: '作业二', submitted: true },
      ],
    })],
    ['/activity-reads-for-user', () => ({ activity_reads: [{ created_for_id: '3200100000' }] })],
    ['/activities/1/students/', () => ({ list: [] })],
    ['/activities/2/students/', () => ({ list: [{ id: 5, is_latest_version: true, is_draft: false }] })],
  ];

  const lazy = fakeApi(shared);
  const out1 = await reader(lazy).assignments('7');
  assert.equal(out1.assignments.length, 2);
  assert.equal(out1.assignments[0].submissionStatus, undefined, '默认不补提交');
  assert.equal(lazy.calls.filter((c) => c.url.includes('submission_list')).length, 0);

  const eager = fakeApi(shared);
  const out2 = await reader(eager).assignments('7', { withSubmissions: true });
  assert.equal(out2.assignments[0].submissionStatus, 'unsubmitted');
  assert.equal(out2.assignments[1].submissionStatus, 'submitted');
});

/* ────────────────────────────────────── 活动详情 */

test('activity：包装成 { activity: ... } 与直接返回都要能解析', async () => {
  const wrapped = fakeApi([['/api/activities/9', () => ({ activity: { id: 9, title: 'x', course_id: 7, description: '说明' } })]]);
  const a = await reader(wrapped).activity('9');
  assert.equal(a.id, '9');
  assert.equal(a.description, '说明');

  const bare = fakeApi([['/api/activities/9', () => ({ id: 9, title: 'y', course_id: 7 })]]);
  const b = await reader(bare).activity('9');
  assert.equal(b.title, 'y');
});

test('activity：缺少 id 时如实报结构异常', async () => {
  const api = fakeApi([['/api/activities/9', () => ({ title: 'x' })]]);
  await assert.rejects(() => reader(api).activity('9'), (e) => e.code === 'API_SHAPE');
});

/* ────────────────────────────────────── 只读 */

test('深入读取全程只发 GET（json 不带 method）', async () => {
  const api = fakeApi([
    ['/activities', () => ({ activities: [], total: 0 })],
    ['/coursewares', () => ({ activities: [], total: 0 })],
  ]);
  await reader(api).activities('7');
  await reader(api).materials('7');
  for (const call of api.calls) {
    assert.equal(call.options?.method, undefined, `出现了非 GET：${call.url}`);
  }
});
