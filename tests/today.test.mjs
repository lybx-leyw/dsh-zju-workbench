import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { StudyWorkbench } from '../packages/dsh-zhiyun-core-study/src/workbench.js';
import { createStudyController } from '../packages/dsh-zhiyun-core-study/src/model.js';
import { mountKnowledge } from './fixtures/study-storage.mjs';
import { clock, projectAgenda } from '../packages/dsh-zhiyun-page-today/src/agenda.js';
import { collectDue, shanghaiDay } from '../packages/dsh-zhiyun-page-today/src/due.js';

const eight = Date.parse('2026-10-14T00:00:00Z');
const entry = (title, startMs, endMs) => ({
  courseId: '10', subId: '20', sourceId: `${title}:${startMs}`, courseTitle: title,
  roomName: '东1', teacherName: '甲', startAt: startMs / 1000, endAt: endMs / 1000, startMs, endMs,
});

test('today agenda keeps an unconfirmed timetable off the page and classifies a full day', () => {
  assert.equal(clock(eight / 1000), '08:00');
  const hidden = projectAgenda([{ day: '2026-10-14', courses: [entry('线代', eight, eight + 5400000)] }], { complete: false }, eight);
  assert.equal(hidden.kind, 'incomplete');
  assert.equal(hidden.entries.length, 0);
  const broken = projectAgenda([{ day: '2026-10-14', courses: [{ courseTitle: '线代' }] }], { complete: true }, eight);
  assert.equal(broken.kind, 'incomplete');
  const day = projectAgenda([{
    day: '2026-10-14',
    courses: [entry('线代', eight, eight + 5400000), entry('写作', eight + 7200000, eight + 10800000)],
  }], { complete: true }, eight + 60000);
  assert.equal(day.kind, 'day');
  assert.equal(day.current.courseTitle, '线代');
  assert.equal(day.upcoming[0].courseTitle, '写作');
  assert.equal(day.finished.length, 0);
  const done = projectAgenda([{ day: '2026-10-14', courses: [entry('线代', eight, eight + 1000)] }], { complete: true }, eight + 1000);
  assert.equal(done.current, null);
  assert.equal(done.finished.length, 1);
  assert.equal(projectAgenda([], { complete: true }, eight).kind, 'empty');
});

test('schedule is read-only for the signed-in account and a bad date is rejected before the source', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-today-'));
  const host = await mountKnowledge(dir);
  let user = { id: '1' };
  let seen = null;
  const service = new StudyWorkbench({
    directory: dir,
    knowledge: host.service,
    llm: { listProviders: () => [], resolveModelInfo: async () => ({}) },
    classroom: {
      getCurrentUser: async () => user,
      getSchedule: async (options) => { seen = options; return { items: [{ day: '2026-10-14', courses: [] }], meta: { complete: true, reason: 'single-response' } }; },
    },
    parser: { llm: { routes: {} }, parseClassroom: async () => ({}) },
  });
  try {
    const data = await service.invoke('schedule', {});
    assert.equal(data.meta.complete, true);
    assert.equal(seen.start, undefined);
    assert.equal(data.items[0].day, '2026-10-14');
    await assert.rejects(service.invoke('schedule', { start: 1 }), { code: 'INPUT' });
    service.classroom.getSchedule = async () => { throw new TypeError('结束日期早于开始日期'); };
    await assert.rejects(service.invoke('schedule', { start: '2026-10-15', end: '2026-10-14' }), { code: 'INPUT' });
    user = null;
    await assert.rejects(service.invoke('schedule', {}), { code: 'SESSION_EXPIRED' });
  } finally {
    await service.dispose();
    await host.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('the today page load keeps a schedule failure off the study error banner', async () => {
  const controller = createStudyController(async (method) => {
    if (method === 'state') return { user: { id: '1' }, jobs: [] };
    if (method === 'courses') return { items: [{ id: '10', title: '线代' }], meta: { complete: true } };
    if (method === 'schedule') throw Object.assign(new Error('课堂服务暂时无法连接，请稍后重试。'), { code: 'NETWORK' });
    return { items: [], meta: { complete: true } };
  }, { navigate() {} });
  try {
    await controller.refresh();
    await controller.loadSchedule();
    assert.equal(controller.getSnapshot().error, null);
    assert.match(controller.getSnapshot().scheduleError, /无法连接/);
    assert.equal(controller.getSnapshot().schedule, null);
  } finally {
    controller.dispose();
  }
});

test('the last opened lesson is remembered for this account only', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-recent-'));
  const host = await mountKnowledge(dir);
  let user = { id: '1' };
  const service = new StudyWorkbench({
    directory: dir,
    knowledge: host.service,
    llm: { listProviders: () => [], resolveModelInfo: async () => ({}) },
    classroom: {
      getCurrentUser: async () => user,
      login: async (credentials) => { user = { id: credentials.username }; return { user }; },
    },
    parser: { llm: { routes: {} }, parseClassroom: async () => ({}) },
  });
  try {
    assert.equal(await service.invoke('recent', {}), null);
    const saved = await service.invoke('recent-save', { courseId: '10', subId: '20', courseTitle: '线代', lessonTitle: '第一节' });
    assert.equal(saved.lessonTitle, '第一节');
    assert.match(saved.openedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await service.invoke('recent', {})).courseId, '10');
    await service.invoke('login', { username: '2', password: 'fixture' });
    assert.equal(await service.invoke('recent', {}), null);
    user = { id: '1' };
    assert.equal((await service.invoke('recent', {})).lessonTitle, '第一节');
    await writeFile(path.join(dir, 'recent.json'), '{', 'utf8');
    await assert.rejects(service.invoke('recent', {}), { code: 'RECENT' });
  } finally {
    await service.dispose();
    await host.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('opening a lesson records it, and today can resume that lesson', async () => {
  const saved = [];
  const controller = createStudyController(async (method, payload) => {
    if (method === 'state') return { user: { id: '1' }, jobs: [] };
    if (method === 'courses') return { items: [{ id: '10', title: '线代' }], meta: { complete: true } };
    if (method === 'recent-save') {
      saved.push(payload);
      return { courseId: '10', subId: '20', courseTitle: '线代', lessonTitle: '第一节', openedAt: '2026-10-14T00:00:00.000Z' };
    }
    if (method === 'recent') return { courseId: '10', subId: '20', courseTitle: '线代', lessonTitle: '第一节', openedAt: '2026-10-14T00:00:00.000Z' };
    if (method === 'lessons') return { items: [{ id: '10_20', subId: '20', title: '第一节', isPlayable: true }], meta: { complete: true } };
    if (method === 'results') return { items: {} };
    if (method === 'content') return { slides: { items: [], meta: { complete: true } }, subtitles: { items: [], meta: { complete: true } } };
    if (method === 'result') return { result: null, job: null };
    return null;
  }, { navigate() {} });
  try {
    await controller.refresh();
    await controller.selectLesson({ subId: '20', title: '第一节' }, { id: '10', title: '线代' });
    assert.equal(saved[0].courseTitle, '线代');
    assert.equal(saved[0].lessonTitle, '第一节');
    assert.equal(controller.getSnapshot().error, null);
    assert.equal(controller.getSnapshot().recent.lessonTitle, '第一节');
    controller.getSnapshot().recent = null;
    await controller.loadRecent();
    assert.equal(await controller.resumeRecent(), true);
    assert.equal(controller.getSnapshot().lesson.subId, '20');
  } finally {
    controller.dispose();
  }
});

test('review lists only this account’s accepted questions, without answers', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'zhiyun-review-'));
  const host = await mountKnowledge(dir);
  let user = { id: '1' };
  const service = new StudyWorkbench({
    directory: dir,
    knowledge: host.service,
    llm: { listProviders: () => [], resolveModelInfo: async () => ({}) },
    classroom: { getCurrentUser: async () => user },
    parser: { llm: { routes: {} }, parseClassroom: async () => ({}) },
  });
  const base = {
    sourceId: 'zhiyun:1:10:20', status: 'ready', fetchedAt: '2026-10-14T00:00:00.000Z', schema: 1,
    sentences: [], unassignedSentences: [], blocks: [], spine: '', outline: [], vocabulary: [], warnings: [], lecture: null,
  };
  try {
    const many = Array.from({ length: 21 }, (_, index) => ({
      id: String(index).padStart(2, '0'), status: 'accepted', type: 'cloze', stem: `题 ${index}`, answer: '不外泄',
    }));
    await host.service.put({
      ...base, accountId: '1', courseId: '10', subId: '20',
      quiz: { items: [
        ...many,
        { id: 'draft', status: 'proposed', type: 'cloze', stem: '不该出现' },
        { id: 'gone', status: 'rejected', type: 'shortAnswer', stem: '也不该出现' },
        { id: 'blank', status: 'accepted', type: 'cloze', stem: '   ' },
      ] },
    });
    await host.service.put({
      ...base, accountId: '10', courseId: '10', subId: '20', sourceId: 'zhiyun:10:10:20',
      quiz: { items: [{ id: 'other', status: 'accepted', type: 'shortAnswer', stem: '十号账号的题', answer: '别人的答案' }] },
    });
    const mine = await service.invoke('review', {});
    assert.equal(mine.truncated, true);
    assert.equal(mine.items.length, 20);
    assert.equal(mine.items[0].id, '00');
    assert.equal(mine.items.some((item) => item.id === 'draft' || item.id === 'gone' || item.id === 'other' || item.stem.includes('十号')), false);
    assert.equal('answer' in mine.items[0], false);
    user = { id: '10' };
    const theirs = await service.invoke('review', {});
    assert.deepEqual(theirs.items.map((item) => item.id), ['other']);
    assert.equal(theirs.items[0].stem, '十号账号的题');
    assert.equal('answer' in theirs.items[0], false);
  } finally {
    await service.dispose();
    await host.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test('opening an accepted question lands on that lesson and a miss stays off the study banner', async () => {
  const controller = createStudyController(async (method) => {
    if (method === 'state') return { user: { id: '1' }, jobs: [] };
    if (method === 'courses') return { items: [{ id: '10', title: '线代' }], meta: { complete: true } };
    if (method === 'review') return { items: [{ courseId: '10', subId: '20', id: 'q1', type: 'cloze', stem: '密度的定义' }], truncated: false };
    if (method === 'lessons') return { items: [{ id: '10_20', subId: '20', title: '第一节', isPlayable: true }], meta: { complete: true } };
    if (method === 'results') return { items: {} };
    if (method === 'content') return { slides: { items: [], meta: { complete: true } }, subtitles: { items: [], meta: { complete: true } } };
    if (method === 'result') return { result: null, job: null };
    if (method === 'recent-save') return { courseId: '10', subId: '20', courseTitle: '线代', lessonTitle: '第一节', openedAt: '2026-10-14T00:00:00.000Z' };
    return null;
  }, { navigate() {} });
  try {
    await controller.refresh();
    await controller.loadReview();
    assert.equal(controller.getSnapshot().error, null);
    assert.equal(controller.getSnapshot().review[0].stem, '密度的定义');
    assert.equal(await controller.openReview(controller.getSnapshot().review[0]), true);
    assert.equal(controller.getSnapshot().lesson.subId, '20');
    assert.deepEqual(controller.getSnapshot().focusTab, { tab: '出题', courseId: '10', subId: '20' });
    assert.equal(await controller.openReview({ courseId: '99', subId: '20', id: 'x' }), false);
    assert.match(controller.getSnapshot().reviewError, /不在当前课程列表/);
    assert.equal(controller.getSnapshot().error, null);
    assert.equal(controller.getSnapshot().review[0].id, 'q1');
  } finally {
    controller.dispose();
  }
});

test('today lists only unfinished items due on the Shanghai calendar day', () => {
  const now = Date.parse('2026-10-23T16:30:00.000Z');
  assert.equal(shanghaiDay(now), '2026-10-24');
  const local = [
    { id: 'p0', title: '昨晚', due: '2026-10-23T15:30:00.000Z', done: false },
    { id: 'p1', title: '交实验', due: '2026-10-23T16:40:00.000Z', done: false },
    { id: 'p2', title: '明天的', due: '2026-10-24T16:00:00.000Z', done: false },
    { id: 'p3', title: '做完了', due: '2026-10-23T18:00:00.000Z', done: true },
    { id: 'p4', title: '没写日期', due: null, done: false },
    { id: 'p5', title: '原文', due: '2026-10-23T17:00:00.000Z', done: false, splitInto: ['p6'] },
    { id: 'p6', title: '拆出来的', due: '2026-10-23T17:10:00.000Z', done: false },
    { id: 'p7', title: '日期坏了', due: '明天', done: false },
  ];
  const todos = {
    xzzd: { ok: true, rows: [
      { id: '12', title: '作业', due: '2026-10-24T01:00:00.000Z', detail: '线代' },
      { id: '13', title: '不再提醒', due: '2026-10-24T02:00:00.000Z' },
    ] },
    pta: { ok: false, rows: [{ id: '9', title: '不该出现', due: '2026-10-24T03:00:00.000Z', detail: '未结束' }] },
  };
  const listed = collectDue(local, todos, { 'xzzd:13': { doneAt: 1 } }, now);
  assert.deepEqual(listed.items.map((item) => item.title), ['交实验', '拆出来的', '作业']);
  assert.equal(listed.items[2].label, '学在浙大');
  assert.equal(listed.items[2].detail, '线代');
  assert.equal(listed.truncated, false);
  assert.deepEqual(collectDue(null, null, null, now), { items: [], truncated: false });
});
