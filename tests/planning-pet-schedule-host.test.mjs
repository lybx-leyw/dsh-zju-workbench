import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { apply, ScheduleStore } from '../packages/client/page-planning/src/index.js';

async function boot(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pet-schedule-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const services = new Map();
  let handler, modelReply;
  const calls = [];
  const ctx = { profileContext: { dir }, get: name => services.get(name), provide: (name, value) => { services.set(name,value); return () => services.delete(name); } };
  ctx.inject = (_names, factory) => factory({ ...ctx, effect: fn => fn(), webServer: { register: row => { handler = row.handler; return () => {}; } } });
  services.set('zhiyunParser', { llm: { resolve: async () => ({model:'fixture'}), call: async request => { calls.push(request); return {text:modelReply}; }, async *callStream(request) { calls.push(request); yield {type:'delta',text:modelReply}; } } });
  services.set('zhiyunCampus', { todos: async () => ({xzzd:{ok:true,rows:[{id:'external',source:'xzzd',title:'虚构平台任务',due:null}]},pta:{ok:true,rows:[]}}) });
  const dispose = await apply(ctx, {}); t.after(dispose);
  return { dir, calls, service: services.get('zhiyunPlanning'), reply: value => { modelReply = typeof value === 'string' ? value : JSON.stringify(value); }, get handler(){return handler;} };
}

test('host grounds schedule drafts in real local/platform tasks without writing schedules', async t => {
  const host = await boot(t);
  const local = host.service.mine.create({title:'虚构本地任务',due:'2026-11-09T15:59:00Z'});
  host.reply({say:'请确认',action:'schedule',draft:{taskKey:`local:${local.id}`,title:'模型不能覆盖标题',start:'2026-11-02T19:00+08:00',end:'2026-11-02T21:00+08:00'}});
  const result = await host.service.mine.pet('安排到周一晚上7到9点');
  assert.equal(result.action,'schedule'); assert.equal(result.draft.title,local.title);
  assert.equal(result.draft.start,'2026-11-02T11:00:00.000Z');
  assert.match(host.calls[0].constant,/xzzd:external/);
  assert.match(host.calls[0].constant,/local:/);
  const file = path.join(host.dir,'data/zhiyun-planning/schedule.json');
  await assert.rejects(access(file),{code:'ENOENT'});
  assert.equal(host.service.mine.find(local.id).due,local.due);
  host.reply({say:'请确认',action:'schedule',draft:{taskKey:'local:invented',start:'2026-11-02T11:00:00Z',end:'2026-11-02T12:00:00Z'}});
  assert.equal((await host.service.mine.pet('安排一个不存在任务')).action,'ask');
  await assert.rejects(access(file),{code:'ENOENT'});
});

test('existing blocks reach model as context; adjustments preserve id and do not persist until confirmation', async t => {
  const host = await boot(t);
  const local = host.service.mine.create({title:'虚构本地任务'});
  const file = path.join(host.dir,'data/zhiyun-planning/schedule.json');
  // Store instance inside host reads are live; create via the same protected route used by confirmation.
  const input = {taskKey:`local:${local.id}`,title:local.title,start:'2026-11-02T11:00:00Z',end:'2026-11-02T12:00:00Z'};
  async function post(action,body) {
    const {EventEmitter} = await import('node:events');
    const req = new EventEmitter(); Object.assign(req,{url:'/_dsh/zhiyun-planning?'+action,method:'POST',headers:{host:'localhost','x-zhiyun-planning':'1'}});
    let output=''; const res = {on(){},writeHead(){},setHeader(){},flushHeaders(){},write(chunk){output+=chunk;},end(chunk=''){output+=chunk;}};
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)); };
    await host.handler(req,res);
    return output;
  }
  const saved = JSON.parse(await post('schedule-save',input)).schedule[0];
  host.reply('请确认调整\n```json\n'+JSON.stringify({action:'schedule',draft:{...input,id:saved.id,start:'2026-11-03T11:00:00Z',end:'2026-11-03T12:00:00Z'}})+'\n```');
  const stream = await post('pet-stream',{text:'改到周二同一时间'});
  assert.match(stream,/schedule/); assert.match(stream,new RegExp(saved.id));
  assert.match(host.calls.at(-1).constant,new RegExp(saved.id));
  assert.deepEqual(new ScheduleStore(file).all(),[saved]);
});
