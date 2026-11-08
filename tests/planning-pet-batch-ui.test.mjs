import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';

async function launch(t) {
  try { return await chromium.launch({ headless: true }); }
  catch (error) {
    if (!/Executable doesn't exist/.test(error.message)) throw error;
    try { return await chromium.launch({ headless: true, channel: 'msedge' }); }
    catch (fallback) {
      if (/not found|doesn't exist|not installed/i.test(fallback.message)) { t.skip('No browser installed'); return null; }
      throw fallback;
    }
  }
}

test('one AI reply proposing three time blocks saves all three after a single confirmation', async t => {
  const browser = await launch(t);
  if (!browser) return;
  try {
    const result = await build({ stdin: { contents: `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {Planning} from './packages/client/page-planning/src/client.jsx';
      import baseCss from './packages/client/page-planning/src/style.css';
      import agendaCss from './packages/client/page-planning/src/schedule.css';
      document.head.appendChild(Object.assign(document.createElement('style'),{textContent:baseCss+agendaCss}));
      const mines = ['期末作业','完成新中国史线上课程期中考核','提交新中国史期末论文电子版'].map((title,i)=>({id:'t'+i,title,due:null,done:false,createdAt:1,updatedAt:1}));
      let schedule=[];
      window.probe={mines, get schedule(){return schedule}};
      window.fetch=async (url,options={})=>{
        const action=String(url).split('?')[1];
        const input=options.body?JSON.parse(options.body):{};
        if(action==='pet-stream') return Response.json({error:{code:'NO_STREAM',message:'fixture'}},{status:400});
        if(action==='pet-chat') return Response.json({ok:true,say:'三项都排到周六下午，确认后保存。',action:'schedule',
          draft:{slots:[
            {taskKey:'local:t0',start:'2026-11-07T05:00:00Z',end:'2026-11-07T06:00:00Z'},
            {taskKey:'local:t1',start:'2026-11-07T06:00:00Z',end:'2026-11-07T07:00:00Z'},
            {taskKey:'local:t2',start:'2026-11-07T07:00:00Z',end:'2026-11-07T08:00:00Z'}],
            assumptions:['用户说时间随便，按周六下午各一小时']}});
        if(action==='schedule-save-batch'){
          schedule=[...schedule,...input.items.map((item,i)=>({...item,id:'s'+i}))];
          window.probe.lastBatch=input; return Response.json({ok:true,schedule});
        }
        if(action==='schedule-save'){schedule=[...schedule,{...input,id:'s'+schedule.length}];return Response.json({ok:true,schedule});}
        return Response.json({local:mines,entries:[],plans:{},ticks:{},schedule,todos:{rows:[],errors:[]},remote:null,pta:null});
      };
      createRoot(document.getElementById('root')).render(<Planning ctx={null}/>);
    `, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', loader: { '.css': 'text' }, plugins: [{ name: 'fixture', setup(builder) {
      builder.onResolve({ filter: /^@lybx-leyw\/dsh-zju-ui-shared$/ }, () => ({ path: 'ui', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: "import React from 'react'; export const Icon=()=>null; export const Empty=({title,children})=><div>{title}{children}</div>; export const Notice=({children})=><div>{children}</div>; export const mountStyle=()=>{}; export const registerPageContent=()=>{};", loader: 'jsx', resolveDir: process.cwd() }));
    } }] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('http://planning.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body data-zhiyun><div id="root"></div></body></html>' }));
    await page.goto('http://planning.test/');
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.getByRole('button', { name: '打开规划助手', exact: true }).click();
    await page.getByRole('textbox', { name: '跟助手说话' }).fill('周五周六处理这三件事，时间随便取');
    await page.getByRole('button', { name: '说', exact: true }).click();
    await page.getByRole('button', { name: '确认保存日程', exact: true }).waitFor();
    // All three blocks must be visible in the confirmation card before saving.
    assert.equal(await page.locator('.zpg-pet-draft li').count(), 3, '三项草案必须一次全部展示');
    assert.equal(await page.evaluate(() => window.probe.schedule.length), 0, '确认前不能写入');
    await page.getByRole('button', { name: '确认保存日程', exact: true }).click();
    await page.waitForFunction(() => window.probe.schedule.length === 3);
    assert.equal(await page.evaluate(() => window.probe.mines[0].due), null, 'DDL 不能被改动');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
