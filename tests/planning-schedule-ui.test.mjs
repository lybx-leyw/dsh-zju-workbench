import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

// Isolated browser fixture, not a replacement server and never real user data.
test('DDL task -> multiple execution slots -> edit/delete, with independent due date', async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) {
    if (!/Executable doesn't exist/.test(error.message)) throw error;
    try { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (fallback) {
      if (/not found|doesn't exist|not installed/i.test(fallback.message)) { t.skip('Neither Playwright Chromium nor Edge is installed'); return; }
      throw fallback;
    }
  }
  try {
    const result = await build({ stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Planning} from './packages/dsh-zhiyun-page-planning/src/client.jsx';
      import baseCss from './packages/dsh-zhiyun-page-planning/src/style.css';
      import agendaCss from './packages/dsh-zhiyun-page-planning/src/schedule.css';
      document.head.appendChild(Object.assign(document.createElement('style'),{textContent:baseCss+agendaCss}));
      const local = {id:'demo', title:'虚构作业', due:'2026-11-08T15:59:00.000Z', done:false, createdAt:1, updatedAt:1};
      let schedule = [], serial = 0;
      const prefix = 'note'+String.fromCharCode(0)+'fixture';
      const plans = {[prefix]:{cards:[{title:'虚构AI任务',action:'独立执行',due:null,done:false}]}};
      window.probe = {local, aiKey:'plan:'+prefix+':0', get schedule(){return schedule}};
      window.fetch = async (url, options={}) => {
        const action = String(url).split('?')[1];
        const input = options.body ? JSON.parse(options.body) : {};
        if (action === 'pet-stream') return Response.json({error:{code:'NO_STREAM',message:'fixture fallback'}},{status:400});
        if (action === 'pet-chat') return Response.json({ok:true,say:'请确认这个执行时段。',action:'schedule',draft:{taskKey:'local:demo',title:local.title,start:'2026-11-05T11:00:00.000Z',end:'2026-11-05T13:00:00.000Z'}});
        if (action === 'schedule-save') {
          const slot = {...input,id:input.id || 'slot-'+(++serial)};
          schedule = [...schedule.filter(item=>item.id!==slot.id),slot];
          return Response.json({ok:true,schedule});
        }
        if (action === 'schedule-remove') { schedule=schedule.filter(item=>item.id!==input.id); return Response.json({ok:true,schedule}); }
        return Response.json({local:[local],entries:[],plans,ticks:{},schedule,todos:{rows:[],errors:[]},remote:null,pta:null});
      };
      createRoot(document.getElementById('root')).render(<Planning ctx={null}/>);
    `, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', loader: { '.css': 'text' }, plugins: [{ name: 'ui-fixture', setup(builder) {
      builder.onResolve({filter:/^dsh-zhiyun-shell-ui$/},()=>({path:'ui',namespace:'fixture'}));
      builder.onLoad({filter:/.*/,namespace:'fixture'},()=>({ contents: `import React from 'react'; export const Icon=()=>null; export const Empty=({title,children})=><div>{title}{children}</div>; export const Notice=({children})=><div>{children}</div>; export const mountStyle=()=>{};`, loader:'jsx',resolveDir:process.cwd() }));
    } }] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('http://planning.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body data-zhiyun><div id="root"></div></body></html>' }));
    await page.goto('http://planning.test/');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.getByRole('button', { name: '为「虚构作业」安排时间' }).click();
    await page.getByRole('heading', { name: /日程表/ }).waitFor();
    const start = page.getByLabel('开始（上海时间）');
    const end = page.getByLabel('结束（上海时间）');
    await start.fill('2026-11-03T09:00'); await end.fill('2026-11-03T10:00');
    await page.getByRole('button', { name: '保存安排', exact: true }).click();
    await page.getByText('安排已保存', {exact:true}).waitFor();
    assert.equal(await page.locator('.zpg-schedule-block').count(), 1);
    assert.equal(await page.evaluate(()=>window.probe.local.due), '2026-11-08T15:59:00.000Z');
    await page.getByLabel('关联 DDL').selectOption('local:demo');
    await start.fill('2026-11-03T11:00'); await end.fill('2026-11-03T12:00');
    await page.getByRole('button', { name: '保存安排', exact: true }).click();
    await page.waitForFunction(()=>window.probe.schedule.length===2 && document.querySelectorAll('.zpg-schedule-block').length===2);
    assert.equal(await page.locator('.zpg-schedule-block').count(), 2);
    await page.locator('.zpg-schedule-block').first().getByRole('button',{name:'编辑',exact:true}).click();
    await end.fill('2026-11-03T10:30');
    await page.getByRole('button',{name:'保存修改',exact:true}).click();
    await page.waitForFunction(()=>window.probe.schedule[1].end==='2026-11-03T02:30:00.000Z');
    await page.locator('.zpg-schedule-block').first().getByRole('button',{name:'删除',exact:true}).click();
    await page.waitForFunction(()=>window.probe.schedule.length===1 && document.querySelectorAll('.zpg-schedule-block').length===1);
    await page.getByRole('button',{name:'DDL 列表',exact:true}).click();
    await page.getByRole('button', { name: '为「虚构作业」安排时间' }).waitFor();
    await page.getByRole('button',{name:'日程表',exact:true}).click();
    assert.equal(await page.locator('.zpg-schedule-block').count(), 1);
    await page.getByRole('button',{name:'DDL 列表',exact:true}).click();
    await page.getByRole('button', { name: '为「虚构AI任务」安排时间' }).click();
    assert.equal(await start.inputValue(), '');
    assert.equal(await page.getByLabel('关联 DDL').inputValue(), await page.evaluate(()=>window.probe.aiKey));
    await start.fill('2026-11-04T09:00'); await end.fill('2026-11-04T10:00');
    await page.getByRole('button', { name: '保存安排', exact: true }).click();
    await page.waitForFunction(()=>window.probe.schedule.some(slot=>slot.taskKey===window.probe.aiKey));
    const beforeAi = await page.evaluate(()=>window.probe.schedule.length);
    await page.getByRole('button',{name:'打开规划助手',exact:true}).click();
    await page.getByRole('textbox',{name:'跟助手说话'}).fill('把虚构作业安排到周四晚上7到9点');
    await page.getByRole('button',{name:'说',exact:true}).click();
    await page.getByRole('button',{name:'确认保存日程',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.probe.schedule.length), beforeAi, 'AI 回复只生成草案，不得提前写入');
    await page.getByRole('button',{name:'取消日程草案',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.probe.schedule.length), beforeAi);
    await page.getByRole('textbox',{name:'跟助手说话'}).fill('还是安排到周四晚上7到9点');
    await page.getByRole('button',{name:'说',exact:true}).click();
    await page.getByRole('button',{name:'确认保存日程',exact:true}).click();
    await page.waitForFunction(count=>window.probe.schedule.length===count+1,beforeAi);
    assert.equal(await page.evaluate(()=>window.probe.local.due), '2026-11-08T15:59:00.000Z');
    await page.getByRole('button',{name:'收起助手',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.zpg-schedule-week') && getComputedStyle(document.querySelector('.zpg-schedule-week')).gridTemplateColumns.split(' ').length===1);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth), '日程和工具栏不应造成横向溢出');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
