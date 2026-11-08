import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StudyWorkbench } from '../packages/core/study/src/workbench.js';

const scene = { id: 's1', title: '标题', order: 1, content: { type: 'slide', canvas: { elements: [] } }, actions: [{ type: 'speech', text: '讲稿' }] };
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'study-teaching-rpc-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const workbench = Object.assign(Object.create(StudyWorkbench.prototype), {
    directory, ready: Promise.resolve(), closed: false, controllers: new Set(),
    classroom: { getCurrentUser: async () => ({ id: 'account' }) },
    result: async () => ({ lecture: { chapters: [] } }), effectiveWorkers: () => [],
    atomic: async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); },
  });
  let live = { runId: 'r1', status: 'done', scenes: [scene] };
  const calls = [];
  workbench.generateOf = () => ({
    start: async (brief, opts) => { calls.push(opts); return { runId: 'r1' }; },
    get: async () => live,
    resume: async runId => { calls.push(runId); return { runId, status: 'running' }; },
  });
  workbench.vaultOf = () => ({ runs: { get: async () => ({ id: 'r1', state: 'completed' }), steps: async () => [{ id: 'scenes', output: { scenes: [scene] } }] } });
  workbench.exportOf = () => ({ pptx: async (doc, opts) => { assert.deepEqual(doc.scenes, [scene]); assert.equal(opts.report, true); return { buffer: Buffer.from('pptx'), fileName: 'lesson.pptx' }; } });
  await workbench.invoke('teach-generate', { courseId: '1', subId: '2' });
  return { workbench, calls, setLive: (value) => { live = value; }, forget: () => { live = null; } };
}

test('teaching RPC exports and resumes by runId without lesson identifiers', async t => {
  const { workbench, calls } = await fixture(t);
  assert.deepEqual(await workbench.invoke('teach-export', { runId: 'r1' }), { fileName: 'lesson.pptx', base64: Buffer.from('pptx').toString('base64') });
  assert.deepEqual(await workbench.invoke('teach-resume', { runId: 'r1' }), { runId: 'r1', status: 'running' });
  assert.equal(calls.at(-1), 'r1');
  await assert.rejects(workbench.invoke('teach-export', {}), { code: 'INPUT' });
});

test('load uses per-lesson index and vault checkpoints after restart; resume states limitation', async t => {
  const { workbench, forget } = await fixture(t);
  forget();
  const loaded = await workbench.invoke('teach-load', { courseId: '1', subId: '2' });
  assert.equal(loaded.saved, true);
  assert.equal(loaded.runId, 'r1');
  assert.equal(loaded.pages[0].speech, '讲稿');
  assert.equal(loaded.resumable, false);
  assert.deepEqual(await workbench.invoke('teach-load', { courseId: '1', subId: '3' }), { pages: [], saved: false });
  assert.equal((await workbench.invoke('teach-export', { runId: 'r1' })).fileName, 'lesson.pptx');
  await assert.rejects(workbench.invoke('teach-resume', { runId: 'r1' }), { code: 'NOT_FOUND' });
});

test('teaching run index prevents another classroom account from exporting or resuming', async t => {
  const { workbench } = await fixture(t);
  workbench.classroom.getCurrentUser = async () => ({ id: 'other' });
  await assert.rejects(workbench.invoke('teach-export', { runId: 'r1' }), { code: 'NOT_FOUND' });
  await assert.rejects(workbench.invoke('teach-resume', { runId: 'r1' }), { code: 'NOT_FOUND' });
});

test('failed new run never loads previous classroom as its own result', async t => {
  const { workbench, setLive } = await fixture(t);
  setLive({ runId: 'r1', status: 'failed', scenes: [] });
  workbench.vaultOf = () => ({ classroom: { load: async () => ({ scenes: [scene] }) } });
  const loaded = await workbench.invoke('teach-load', { courseId: '1', subId: '2' });
  assert.deepEqual(loaded.pages, []);
  assert.equal(loaded.resumable, true);
  await assert.rejects(workbench.invoke('teach-export', { runId: 'r1' }), { code: 'EMPTY' });
});

test('lecture changes invalidate saved teaching automatically', async t => {
  const { workbench } = await fixture(t);
  workbench.result = async () => ({ lecture: { chapters: [{ title: 'new chapter' }] } });
  assert.deepEqual(await workbench.invoke('teach-load', { courseId: '1', subId: '2' }), { pages: [], saved: false });
});

test('missing optional export service is a readable NOT_WIRED error', async t => {
  const { workbench } = await fixture(t);
  workbench.exportOf = () => undefined;
  await assert.rejects(workbench.invoke('teach-export', { runId: 'r1' }), { code: 'NOT_WIRED' });
});
