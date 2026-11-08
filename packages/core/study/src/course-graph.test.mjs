import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { StudyWorkbench } from './workbench.js';

// Exercise the RPC boundary without constructing unrelated model/config services.
function fixture() {
  let user = { id: 'account-a' };
  const reads = [], calls = [];
  const lessons = ['30', '10', '20', '40', '50', '60'].map(id => ({ id, subId: id, title: `Lesson ${id}`, playable: false }));
  const tree = { kind: 'title', title: 'Topic', children: [{ kind: 'leaf', id: 'point', blocks: [] }] };
  const semanticPlan = [{ title: 'Chapter', topics: [{ title: 'Point', text: 'point content', from: 0, to: 0 }] }];
  const records = new Map([
    ['account-a:7:30', { tree, semanticPlan, blocks: [{ sentences: [{ text: 'PRIVATE TRANSCRIPT' }] }], pages: ['PRIVATE PAGE'], lecture: {} }],
    ['account-a:7:20', { semanticPlan, knowledgeTree: [{ id: 'legacy-point' }] }],
    ['account-a:7:40', { tree: { kind: 'title', title: 'Empty', children: [] } }],
    ['account-a:7:50', { tree: [] }],
    ['account-a:7:60', { tree: 'invalid' }],
    ['account-b:7:10', { tree, semanticPlan }],
  ]);
  const service = Object.assign(Object.create(StudyWorkbench.prototype), {
    ready: Promise.resolve(), closed: false, accountBusy: false, controllers: new Set(),
    classroom: {
      getCurrentUser: async () => user,
      listLessons: async (courseId, options) => { calls.push({ courseId, options }); return { items: lessons }; },
    },
    result: async key => { reads.push(key); return records.get(key) ?? null; },
  });
  return { service, lessons, tree, reads, calls, setUser: value => { user = value; } };
}

test('course-graph returns only nonempty stored trees in course lesson order, without full records', async () => {
  const { service, lessons, tree, reads, calls } = fixture();
  const value = await service.invoke('course-graph', { courseId: '7', accountId: 'account-b', subIds: ['10'] });
  assert.deepEqual(value.items.map(item => item.lesson), [lessons[0], lessons[2]]);
  for (const item of value.items) {
    assert.deepEqual(item.chapters.map(chapter => ({ title: chapter.title, points: chapter.topics.map(topic => topic.title) })), [{ title: 'Chapter', points: ['Point'] }]);
    assert.deepEqual(Object.keys(item), ['lesson', 'chapters']);
  }
  assert.deepEqual(reads, lessons.map(lesson => `account-a:7:${lesson.subId}`));
  assert.equal(calls[0].courseId, '7');
  assert.equal(calls[0].options.onlyPlayable, false);
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.ok(!JSON.stringify(value).includes('PRIVATE'));
});

test('course-graph authenticates, validates the course, and scopes records to the current user', async () => {
  const { service, setUser, calls } = fixture();
  setUser(null);
  await assert.rejects(service.invoke('course-graph', { courseId: '7' }), { code: 'SESSION_EXPIRED' });
  assert.equal(calls.length, 0);
  setUser({ id: 'account-b' });
  await assert.rejects(service.invoke('course-graph', { courseId: '../7' }), { code: 'INPUT' });
  assert.deepEqual((await service.invoke('course-graph', { courseId: '7' })).items.map(item => item.lesson.id), ['10']);
  setUser({ id: 'account-c' });
  assert.deepEqual(await service.invoke('course-graph', { courseId: '7' }), { items: [] });
});

test('course-graph observes cancellation and is registered in the host allowlist', async () => {
  const { service, calls } = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(service.invoke('course-graph', { courseId: '7' }, controller.signal), { name: 'AbortError' });
  assert.equal(calls.length, 0);
  const host = await readFile(new URL('./host.js', import.meta.url), 'utf8');
  assert.match(host, /"results", "course-graph"/);
});
