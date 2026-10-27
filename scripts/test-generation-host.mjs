import assert from 'node:assert/strict';
import {mkdir,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {chromium} from 'playwright';
import {initialize,runHost,root} from './profile.mjs';
const artifacts=path.join(root,'artifacts/study');await mkdir(artifacts,{recursive:true});
const runtime=await initialize({home:path.join(artifacts,`host-${Date.now()}`)});
await symlink(path.join(root,'tests/fixtures/study-backend'),path.join(runtime.profile,'node_modules/zhiyun-test-study-backend'),'junction');
await writeFile(path.join(runtime.profile,'cordis.patch.yml'),'- insert:\n    - id: study-fixture\n      name: zhiyun-test-study-backend\n');
let server,browser,page,hostLog='',url;const checks=[],errors=[];
async function settle(page){for(let i=0,quiet=0;i<100;i++){let clicked=false;for(const name of ['继续','稍后配置']){const b=page.getByRole('button',{name,exact:true});if(await b.isVisible().catch(()=>false)&&await b.isEnabled().catch(()=>false)){await b.click();clicked=true;break;}}quiet=clicked?0:quiet+1;if(quiet>=8)return;await page.waitForTimeout(250);}}
try{
  server=runHost(runtime,['--no-open','--port','0'],{pipe:true});
  url=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('host startup timed out')),60000);const consume=chunk=>{hostLog+=chunk;const match=hostLog.match(/dsh web: (http:\/\/\S+)/);if(match){clearTimeout(timeout);resolve(match[1]);}};server.stdout.setEncoding('utf8');server.stderr.setEncoding('utf8');server.stdout.on('data',consume);server.stderr.on('data',consume);server.on('error',reject);server.on('exit',code=>reject(new Error(`host exited ${code}`)));});
  const unauthorized=await fetch(new URL('/api/zhiyun-study',url),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'unauthorized-fixture',method:'zhiyun-study',payload:{method:'state',args:{}}})});assert.equal(unauthorized.status,401);checks.push('Study RPC requires host browser authentication');
  browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1440,height:980}});page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack);});
  await page.goto(url,{waitUntil:'domcontentloaded'});await settle(page);
  const nav=name=>page.getByRole('navigation',{name:'主要页面'}).getByRole('button',{name,exact:true});
  // 先等课程行出来再展开：点开只是发一个「读节次」的请求，节次是异步回来的。
  // 不 waitFor 就断言 `.zs-tree-lesson` 的数目，会在数据比渲染慢的机器上偶发 0（本轮实测踩到）。
  const expandCourse=async()=>{const mobile=page.locator('.zs-mobile-tree-toggle');if(await mobile.isVisible())await mobile.click();const toggle=page.locator('.zs-course-toggle').filter({hasText:'概率论与数理统计'});await toggle.waitFor();if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();await page.locator('.zs-course-toggle').filter({hasText:'概率论与数理统计'}).locator('..').locator('.zs-tree-lesson').first().waitFor();};
  // 登录从「个人页上的一个区块」搬到了**账号对话框**（导轨头像 → 登录）。三个动作抽成
  // 小工具，因为三条路径都要走一遍；`closeLogin` 必须有 —— `showModal()` 之后页面其余
  // 部分是 inert，不关掉后面点侧栏会一直被挡住。
  const openLogin=async()=>{await page.getByRole('button',{name:'登录智云课堂',exact:true}).click();await page.getByRole('dialog',{name:'登录智云课堂'}).waitFor();};
  const closeLogin=async()=>{await page.getByRole('button',{name:'关闭',exact:true}).click();await page.getByRole('dialog',{name:'登录智云课堂'}).waitFor({state:'hidden'});};
  const signInClassroom=async()=>{
    await page.evaluate(async()=>{
      const response=await fetch('/api/zhiyun-study',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'generation-fixture-login',method:'zhiyun-study',payload:{method:'login',args:{username:'fixture-account',password:'fixture-password'}}})});
      const data=await response.json();if(!data.result?.ok)throw Error('Synthetic classroom login failed');
    });
    await page.reload({waitUntil:'domcontentloaded'});await settle(page);
  };
  await nav('学习').click();await signInClassroom();checks.push('Personal login connects authenticated classroom service without browser persistence of credentials');
  await nav('学习').click();await expandCourse();
  await page.getByRole('button',{name:/第一节 · 概率密度函数/}).click();
  assert.equal(await page.locator('.zs-live-fold').count(),0,'unfinished live directory is not mounted');
  assert.equal(await page.getByRole('button',{name:/正在直播|^直播$/}).count(),0,'live actions are removed from study UI');
  const generate=page.getByRole('button',{name:/^生成讲义/});await generate.waitFor();
  assert.equal(await generate.count(),1);
  const config=page.locator('.zs-generation-models');
  assert.equal(await config.getByRole('dialog',{name:'生成配置',exact:true}).isVisible(),false,'configuration has no permanent bar');
  await config.getByRole('button',{name:'讲义生成配置',exact:true}).click();
  await config.getByRole('checkbox',{name:'study-second',exact:true}).check();
  await config.getByLabel('study-fixture 模型',{exact:true}).selectOption('text');
  await config.getByLabel('study-fixture worker 数',{exact:true}).fill('2');
  await config.getByLabel('study-second 模型',{exact:true}).selectOption('vision');
  await config.getByLabel('study-second worker 数',{exact:true}).fill('3');
  assert.equal(await generate.isDisabled(),true,'unapplied changes cannot silently use the old configuration');
  await config.getByRole('button',{name:'应用配置',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.zs-current-actions .zs-primary')?.disabled);
  assert.equal(await config.getByRole('dialog',{name:'生成配置',exact:true}).isVisible(),false,'applying options closes the popover');
  await config.getByRole('button',{name:'讲义生成配置',exact:true}).click();
  assert.match(await config.locator('.zs-generation-config-heading').innerText(),/2 个供应商 · 总并发 5/);
  await page.screenshot({path:path.join(artifacts,'generation-provider-workers.png'),fullPage:true});
  await page.keyboard.press('Escape');
  assert.equal(await config.getByRole('dialog',{name:'生成配置',exact:true}).isVisible(),false);
  assert.equal(await config.getByRole('button',{name:'讲义生成配置',exact:true}).evaluate(el=>el===document.activeElement),true,'Escape restores focus');
  await config.getByRole('button',{name:'讲义生成配置',exact:true}).click();
  await page.locator('.zs-current-meta').click();
  assert.equal(await config.getByRole('dialog',{name:'生成配置',exact:true}).isVisible(),false,'outside click dismisses configuration');
  const firstTask=page.locator('.zs-task-current, .zs-task-history').filter({has:page.locator('.zs-task-title').filter({hasText:'第一节 · 概率密度函数'})});
  const progress=firstTask.locator('.zs-generation');
  await generate.click();
  await page.getByRole('button',{name:'取消',exact:true}).waitFor();
  await progress.getByText('总耗时',{exact:false}).waitFor();
  await progress.getByText('识别课件',{exact:true}).waitFor();
  await page.screenshot({path:path.join(artifacts,'generation-progress.png'),fullPage:true});
  assert.equal(await config.getByLabel('study-fixture worker 数',{exact:true}).isDisabled(),true,'running tasks keep an immutable configuration');
  assert.equal(await page.locator('.zs-current-main > .zs-generation').count(),0,'course header has no resident stage strip');
  await page.getByRole('button',{name:'收起任务面板',exact:true}).click();
  await page.getByRole('button',{name:/第二节 · 尚未解析/}).click();
  await page.getByRole('button',{name:'生成讲义',exact:true}).click();
  await page.locator('.zs-task-waiting').getByText('第二节 · 尚未解析',{exact:true}).waitFor();
  assert.match(await page.getByRole('button',{name:'下载与生成任务',exact:true}).getAttribute('title'),/1 进行中 · 1 等待/);
  const panelBounds=await page.getByRole('dialog',{name:'下载与生成队列',exact:true}).boundingBox();
  const workspaceBounds=await page.locator('.zs-workbench-shell').boundingBox();
  assert.ok(panelBounds.width<=480 && panelBounds.x>=0,'queue opens in a compact floating panel');
  assert.equal(await page.getByRole('button',{name:'下载与生成任务',exact:true}).innerText(),'','entry uses only a download icon');
  await page.getByRole('button',{name:'收起任务面板',exact:true}).click();
  const closedWorkspace=await page.locator('.zs-workbench-shell').boundingBox();
  assert.ok(Math.abs(closedWorkspace.y-workspaceBounds.y)<1,'opening the popover never shifts the workspace');
  await page.getByRole('button',{name:'下载与生成任务',exact:true}).click();
  assert.equal(await page.locator('.zs-task-panel').evaluate(el=>getComputedStyle(el).position),'fixed','details render in a floating panel');
  await page.screenshot({path:path.join(artifacts,'generation-queue.png'),fullPage:true});
  await nav('规划').click();
  assert.equal(await page.getByRole('button',{name:'下载与生成任务',exact:true}).isVisible(),false,'planning has no task entry competing with its pet');
  assert.equal(await page.getByRole('dialog',{name:'下载与生成队列',exact:true}).isVisible(),false,'leaving study hides its panel');
  await page.waitForFunction(async()=>{
    const response=await fetch('/api/zhiyun-study',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'queue-off-page',method:'zhiyun-study',payload:{method:'queue',args:{}}})});
    const data=await response.json();return data.result?.value?.jobs?.length===2 && data.result.value.jobs.every(job=>!['running','queued'].includes(job.state));
  },null,{timeout:60000});
  await nav('学习').click();
  await page.getByRole('button',{name:'下载与生成任务',exact:true}).waitFor();
  if(!await page.getByRole('dialog',{name:'下载与生成队列',exact:true}).isVisible())await page.getByRole('button',{name:'下载与生成任务',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.zs-task-history').length===2);
  assert.equal(await page.locator('.zs-task-history').count(),2,'background queue finishes while its controls are hidden');
  await firstTask.locator('.zs-task-title').click();
  await page.getByRole('button',{name:'重新生成讲义',exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'下载与生成队列',exact:true}).isVisible(),false,'opening a task navigates to its classroom and closes the panel');
  await page.getByRole('button',{name:'下载与生成任务',exact:true}).click();
  checks.push('Page-local queue controls hide on planning, reserve layout space and keep FIFO generation running in the background');
  const generatedJob=await page.evaluate(async()=>{
    const response=await fetch('/api/zhiyun-study',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'worker-pool-result',method:'zhiyun-study',payload:{method:'result',args:{courseId:'10',subId:'20'}}})});
    const envelope=await response.json();return envelope.result.value.job;
  });
  assert.equal(generatedJob.concurrency,5);
  assert.deepEqual(generatedJob.workers.map(entry=>entry.workers),[2,3]);
  assert.ok(generatedJob.workers.every(entry=>entry.completed>0),'both configured providers actually receive model calls');
  assert.equal(await progress.locator('details').getAttribute('open'),null,'finished progress collapses to its summary');
  await progress.locator('.zs-generation-heading').click();
  const text=await progress.innerText();
  assert.match(text,/按知识点成稿/);assert.match(text,/逐点终审/);assert.match(text,/分/);
  assert.equal(await page.getByRole('button',{name:'生成阅读讲义',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'恢复上一版',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:/^重新生成讲义/}).count(),1);
  await progress.locator('.zs-generation-heading').click();
  await page.screenshot({path:path.join(artifacts,'generation-finished.png'),fullPage:true});
  await page.getByRole('button',{name:'收起任务面板',exact:true}).click();
  await page.setViewportSize({width:650,height:900});
  await page.getByRole('button',{name:'下载与生成任务',exact:true}).click();
  const queueBox=await page.getByRole('dialog',{name:'下载与生成队列',exact:true}).boundingBox();
  assert.ok(queueBox.x>=0 && queueBox.x+queueBox.width<=650 && queueBox.y>=0);
  await page.screenshot({path:path.join(artifacts,'generation-queue-narrow.png'),fullPage:true});
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button',{name:'下载与生成任务',exact:true}).evaluate(el=>el===document.activeElement),true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.reload({waitUntil:'domcontentloaded'});await settle(page);
  await nav('学习').click();await expandCourse();await page.getByRole('button',{name:/第一节 · 概率密度函数/}).click();
  await page.getByRole('button',{name:/^重新生成讲义/}).waitFor();
  await page.waitForFunction(()=>document.querySelector('.zs-generate-action')?.title.includes('5 workers'));
  assert.match(await page.getByRole('button',{name:/^重新生成讲义/}).getAttribute('title'),/5 workers/);
  // Rich synthetic reading content makes line length and navigation measurable.
  const paragraph='概率分布描述随机变量取各个可能值的规律。阅读一个分布时，应先确定随机变量的取值范围，再检查各个区间所对应的概率。图形、公式和文字是同一规律的不同表达，可以相互核对。';
  await page.route('**/api/zhiyun-study',async route=>{
    const response=await route.fetch();
    const envelope=await response.json();
    const record=envelope.result?.value?.result;
    if(record?.lecture){
      record.blocks.push({index:9001,startMs:7654,page:1,tag:{role:'支线',summary:'课堂补充：概率的直觉',facets:['拓展']},sentences:[{text:'支线独有内容：这是一段额外的课堂补充。',startMs:7654}]});
      const block=(kind,text,title)=>({kind,text,title,sourceBlockIndexes:[1]});
      const topic=(title,blocks)=>({title,register:'written',fromPage:1,toPage:1,sourceBlockIndexes:[1],blocks});
      record.lecture.chapters=[
        {title:'随机变量与概率分布',topics:[
          topic('从随机现象到数学描述',[block('elaboration',paragraph+'\n\n'+paragraph,'建立直观认识'),block('definition','随机变量是将随机试验的每个结果映射为一个实数的函数。','随机变量')]),
          topic('分布函数的基本性质',[block('elaboration',paragraph+'\n\n'+paragraph,'理解取值范围')]),
        ]},
        {title:'分布的应用',topics:[topic('用区间理解概率',[block('example','', '区间概率'),block('elaboration',paragraph,'从结果回到问题')])]},
      ];
      record.lecture.chapters[1].topics[0].blocks[0].stem='设随机变量在区间 [0, 1] 上均匀分布，求它落在前半个区间的概率。';
      record.lecture.chapters[1].topics[0].blocks[0].solution='均匀分布下，区间概率等于相应长度之比。因此概率为 1/2。';
    }
    await route.fulfill({response,json:envelope});
  });
  await page.setViewportSize({width:1440,height:980});
  await page.reload({waitUntil:'domcontentloaded'});await settle(page);await nav('学习').click();await expandCourse();
  await page.getByRole('button',{name:/第一节 · 概率密度函数/}).click();
  await page.getByRole('tab',{name:'支线黑板',exact:true}).click();
  await page.getByRole('heading',{name:'课堂补充：概率的直觉',exact:true}).waitFor();
  assert.equal(await page.locator('.zs-branch-card').count(),1,'board projects only explicitly classified side blocks');
  assert.equal(await page.locator('.zs-branch-text').isVisible(),false,'side cards start collapsed');
  const branchRow=await page.locator('.zs-branch-card summary').boundingBox();
  assert.ok(branchRow.height<=48,'side entry is a compact notification row');
  assert.equal(await page.locator('.zs-branch-card h3').evaluate(el=>getComputedStyle(el).fontSize),'13px');
  assert.match(await page.locator('.zs-branch-meta').innerText(),/00:07/);
  await page.locator('.zs-branch-card summary').click();
  assert.match(await page.locator('.zs-branch-card').innerText(),/支线独有内容/);
  await page.locator('.zs-branch-card summary').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.zs-branch-text').isVisible(),false,'keyboard toggles a side card');
  await page.getByRole('searchbox',{name:'查找支线',exact:true}).fill('不存在的补充');
  assert.equal(await page.locator('.zs-branch-card').count(),0);
  await page.getByRole('searchbox',{name:'查找支线',exact:true}).fill('');
  await page.locator('.zs-branch-card summary').click();
  await page.locator('.zs-branch-card').getByRole('button',{name:'回到视频',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'视频',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'支线黑板',exact:true}).click();
  await page.screenshot({path:path.join(artifacts,'branch-board.png'),fullPage:true});
  await page.getByRole('tab',{name:'知识点',exact:true}).click();
  const reader=page.locator('.zs-handout'),paper=reader.locator('.zs-handout-main');
  // Export uses its own full-document render, including solutions hidden in the reader.
  await page.evaluate(()=>{window.lecturePdf={save:filename=>new Promise(resolve=>{window.__pdfFilename=filename;window.__pdfResolve=resolve;window.__pdfReady=true;})};});
  await reader.getByRole('button',{name:'导出 PDF',exact:true}).click();
  await page.waitForFunction(()=>window.__pdfReady===true);
  assert.match(await page.evaluate(()=>window.__pdfFilename),/\.pdf$/);
  assert.equal(await page.locator('#zs-lecture-export .zs-pdf-chapter').count(),2);
  assert.equal(await page.locator('#zs-lecture-export .zs-pdf-map-sheet').count(),1);
  assert.match(await page.locator('#zs-lecture-export').innerText(),/知识图谱/);
  assert.match(await page.locator('#zs-lecture-export').innerText(),/因此概率为 1\/2/);
  await page.emulateMedia({media:'print'});
  assert.equal(await page.locator('.zs-study-layout').isVisible(),false,'application chrome is excluded from the PDF');
  const pdfFile=path.join(artifacts,'lecture-and-graph.pdf');
  const pdf=await page.pdf({path:pdfFile,format:'A4',preferCSSPageSize:true,printBackground:true});assert.ok(pdf.subarray(0,5).toString()==='%PDF-');
  try{
    const {stdout}=await promisify(execFile)('pdftotext',['-enc','UTF-8',pdfFile,'-']);
    assert.match(stdout,/知识图谱/);assert.match(stdout,/分布的应用/);assert.match(stdout,/均匀分布下/);assert.ok(!stdout.includes('全局题库'));
    const {stdout:info}=await promisify(execFile)('pdfinfo',['-f','1','-l','100',pdfFile]);
    const sizes=[...info.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
    assert.ok(sizes.length>=2,'PDF reports each physical page');
    assert.ok(sizes.slice(0,-1).every(([w,h])=>w<h),'body pages retain portrait orientation');
    assert.ok(sizes.at(-1)[0]>sizes.at(-1)[1],'the final graph page is landscape');
    const pages=stdout.split('\f').filter(p=>p.trim());
    assert.match(pages.at(-1),/知识图谱/);assert.match(pages.at(-1),/分布函数的基本性质/);
    await promisify(execFile)('pdftoppm',['-f','1','-l','8','-scale-to','1200','-png',pdfFile,path.join(artifacts,'lecture-pdf-page')]);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.__pdfResolve({canceled:false}));
  await page.locator('#zs-lecture-export').waitFor({state:'detached'});
  // Feed a larger synthetic snapshot through the actual export renderer and fitting pass.
  await page.evaluate(()=>{
    window.__pdfReady=false;
    const clone=window.structuredClone;
    window.structuredClone=function(value,...args){
      const result=clone(value,...args);
      if(value?.lecture&&Array.isArray(value.graph)){
        window.structuredClone=clone;
        result.graph=Array.from({length:5},(_,c)=>({title:`布局测试章节 ${c+1}`,topics:Array.from({length:16},(_,t)=>({title:`节点 ${c+1}-${t+1}：较长的知识点标题，用于检查多列换行和完整排版`}))}));
        result.lecture.polish={warnings:['测试提示应放在图谱之前']};
      }
      return result;
    };
  });
  await reader.getByRole('button',{name:'导出 PDF',exact:true}).click();
  await page.waitForFunction(()=>window.__pdfReady===true);
  assert.equal(await page.locator('.zs-pdf-map-branches li').count(),80);
  const fits=await page.locator('.zs-pdf-map-viewport').evaluate(viewport=>{
    const box=viewport.getBoundingClientRect(),grid=viewport.firstElementChild.getBoundingClientRect();
    return grid.top>=box.top-1&&grid.bottom<=box.bottom+1&&grid.left>=box.left-1&&grid.right<=box.right+1&&grid.width>=box.width*.98;
  });
  assert.ok(fits,'all 80 graph nodes fit inside the final page area');
  await page.emulateMedia({media:'print'});
  const largePdfFile=path.join(artifacts,'lecture-large-graph.pdf');
  await page.pdf({path:largePdfFile,format:'A4',preferCSSPageSize:true,printBackground:true});
  try{
    const {stdout}=await promisify(execFile)('pdftotext',['-enc','UTF-8',largePdfFile,'-']);
    const pages=stdout.split('\f').filter(p=>p.trim()),last=pages.at(-1);
    assert.ok(!last.includes('测试提示应放在图谱之前'));
    for(let c=1;c<=5;c++)for(let t=1;t<=16;t++)assert.ok(last.includes(`节点 ${c}-${t}：`),`node ${c}-${t} stays on the final page`);
    await promisify(execFile)('pdftoppm',['-f',String(pages.length),'-singlefile','-scale-to','1600','-png',largePdfFile,path.join(artifacts,'lecture-large-graph')]);
  }catch(error){if(error.code!=='ENOENT')throw error;}
  await page.emulateMedia({media:'screen'});await page.evaluate(()=>window.__pdfResolve({canceled:false}));
  await page.locator('#zs-lecture-export').waitFor({state:'detached'});
  assert.equal(await paper.isVisible(),true,'normal reading is restored after PDF export');
  await paper.getByRole('heading',{name:'随机变量与概率分布',exact:true}).waitFor();
  assert.equal(await page.getByRole('navigation',{name:'讲义目录',exact:true}).count(),1);
  const typography=await paper.locator('.zs-handout-block p').first().evaluate(el=>({font:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));
  assert.equal(typography.font,17);assert.ok(typography.line>=30);
  const openPaper=await paper.boundingBox(),toc=await reader.locator('.zs-handout-drawer').boundingBox();
  assert.ok(toc.x+toc.width<openPaper.x,'TOC sits to the left of the reading column');
  assert.ok(openPaper.width>=500,'the open TOC must not squeeze the body into a narrow column');
  await page.screenshot({path:path.join(artifacts,'lecture-layout-open.png'),fullPage:true});
  await reader.getByRole('button',{name:'收起目录',exact:true}).click();
  const closedPaper=await paper.boundingBox(),body=await reader.locator('.zs-handout-body').boundingBox();
  assert.ok(Math.abs(closedPaper.x+closedPaper.width/2-(body.x+body.width/2))<2,'closed TOC recenters the paper within all available width');
  assert.ok(closedPaper.width>=openPaper.width);assert.ok(closedPaper.width<=738);
  assert.equal(await reader.locator('.zs-handout-drawer').count(),0);
  await page.screenshot({path:path.join(artifacts,'lecture-layout-closed.png'),fullPage:true});
  // Native button interaction must also work from the keyboard.
  await reader.getByRole('button',{name:'展开目录',exact:true}).focus();await page.keyboard.press('Enter');
  await reader.locator('.zs-handout-drawer').waitFor();
  await reader.locator('.zs-handout-tree-topic').filter({hasText:'分布函数的基本性质'}).click();
  assert.equal(await reader.locator('.zs-handout-tree-topic[aria-current="location"]').count(),1);
  await page.setViewportSize({width:650,height:900});
  await reader.getByRole('button',{name:'收起目录',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const mobilePaper=await paper.boundingBox(),mobileBody=await reader.locator('.zs-handout-body').boundingBox();
  assert.ok(Math.abs(mobilePaper.x+mobilePaper.width/2-(mobileBody.x+mobileBody.width/2))<2);
  await page.screenshot({path:path.join(artifacts,'lecture-layout-narrow.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:980});
  const themeToggle=page.getByRole('button',{name:'切换明暗',exact:true});
  if(await themeToggle.isVisible()){
    await themeToggle.click();await page.screenshot({path:path.join(artifacts,'lecture-layout-dark.png'),fullPage:true});
  }
  await page.unroute('**/api/zhiyun-study');
  await page.reload({waitUntil:'domcontentloaded'});await settle(page);
  await nav('学习').click();await expandCourse();await page.getByRole('button',{name:/第一节 · 概率密度函数/}).click();
  await page.getByRole('button',{name:'卡片',exact:true}).click();
  await page.locator('.zs-k-card').first().click();
  await page.getByRole('tab',{name:'题',exact:true}).click();
  await page.getByRole('heading',{name:'这个知识点的出题设置',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('.zs-bank-settings .zs-primary')?.disabled);
  assert.equal(await page.locator('.zs-bank-scope').count(),0,'point-level entry is scoped rather than asking for raw blocks');
  await page.getByRole('button',{name:'打开全局题库',exact:true}).click();
  await page.getByRole('region',{name:'全局题库',exact:true}).waitFor();
  assert.equal(await page.locator('.zs-bank-page h1').count(),0,'the bank does not repeat a page title');
  // 知识点树不在主体里常驻：按钮打开浮窗，选完关掉。
  assert.equal(await page.getByRole('button',{name:'全选当前列表',exact:true}).isVisible().catch(()=>false),false,'scope tree stays closed until the trigger is pressed');
  await page.getByRole('button',{name:'选择知识点',exact:true}).click();
  await page.getByRole('dialog',{name:'知识点范围',exact:true}).waitFor();
  await page.getByRole('button',{name:'全选当前列表',exact:true}).waitFor();
  assert.equal(await page.locator('.zs-bank-lesson').count(),2,'bank includes both generated classrooms');
  const scopeCourse=await page.locator('.zs-bank-course > summary > input').first().boundingBox(),scopeLesson=await page.locator('.zs-bank-lesson > summary > input').first().boundingBox(),scopePoint=await page.locator('.zs-scope-point > input').first().boundingBox();
  assert.ok(Math.abs(scopeLesson.x-scopeCourse.x-16)<2&&Math.abs(scopePoint.x-scopeLesson.x-16)<2,'course, lesson and point checkboxes follow aligned 16px indents');
  await page.getByRole('button',{name:'全选当前列表',exact:true}).click();
  await page.screenshot({path:path.join(artifacts,'question-point-selector.png'),fullPage:true});
  await page.screenshot({path:path.join(artifacts,'question-bank-scope-popover.png'),fullPage:true});
  await page.getByRole('button',{name:'完成选择',exact:true}).click();
  assert.equal(await page.getByRole('dialog',{name:'知识点范围',exact:true}).isVisible(),false);
  const quizConfig=page.locator('.zs-generation-models[data-purpose=quiz]');
  await quizConfig.getByRole('button',{name:'出题生成配置',exact:true}).click();
  await quizConfig.getByLabel('study-fixture 模型',{exact:true}).selectOption('text');
  await quizConfig.getByLabel('study-fixture worker 数',{exact:true}).fill('1');
  await quizConfig.getByLabel('study-second 模型',{exact:true}).selectOption('text');
  await quizConfig.getByLabel('study-second worker 数',{exact:true}).fill('2');
  assert.ok((await quizConfig.getByLabel('study-second worker 数',{exact:true}).boundingBox()).width>=70,'worker quota is a readable input, not a squeezed sliver');
  await page.screenshot({path:path.join(artifacts,'question-worker-settings.png'),fullPage:true});
  await quizConfig.getByRole('button',{name:'应用配置',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-purpose=quiz] .zs-generate-action')?.title.includes('3 workers'));
  assert.match(await page.locator('.zs-bank-scope-button').innerText(),/已选 \d+/);
  await page.screenshot({path:path.join(artifacts,'question-bank-compose.png'),fullPage:true});
  await page.getByRole('spinbutton',{name:'总题数',exact:true}).fill('4');
  const initialTypes=page.getByRole('group',{name:'题型',exact:true});
  await initialTypes.getByRole('checkbox',{name:'填空题',exact:true}).uncheck();
  await page.getByRole('button',{name:'按知识点生成题目',exact:true}).click();
  await page.getByRole('region',{name:'出题进度',exact:true}).waitFor();
  await page.getByRole('progressbar',{name:'出题完成进度',exact:true}).waitFor();
  await page.locator('.zs-qgen-cache').filter({hasText:/已整理 [1-9] 个知识点/}).waitFor();
  await page.screenshot({path:path.join(artifacts,'question-generation-progress.png'),fullPage:true});
  await page.getByRole('button',{name:'暂停出题',exact:true}).click();
  await page.getByRole('button',{name:'继续出题',exact:true}).waitFor();
  const savedBeforeReload=await page.getByRole('progressbar',{name:'出题完成进度',exact:true}).getAttribute('value');
  await page.reload({waitUntil:'domcontentloaded'});await settle(page);await nav('题库').click();
  await page.getByRole('button',{name:'继续出题',exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar',{name:'出题完成进度',exact:true}).getAttribute('value'),savedBeforeReload,'saved question count survives reload');
  assert.equal(await page.getByRole('progressbar',{name:'出题完成进度',exact:true}).getAttribute('max'),'4');
  await page.screenshot({path:path.join(artifacts,'question-generation-resume.png'),fullPage:true});
  await page.getByRole('button',{name:'继续出题',exact:true}).click();
  await page.getByRole('status').filter({hasText:'4 道题已存入题库'}).waitFor({timeout:60000});
  await page.getByRole('button',{name:'历史题库 · 4',exact:true}).click();
  assert.equal(await page.locator('.zs-bank-question').count(),4,'generated questions persist in global history');
  await page.screenshot({path:path.join(artifacts,'question-bank-history.png'),fullPage:true});
  const curatable=page.locator('.zs-bank-question').filter({has:page.getByRole('button',{name:'停用此挖空位置',exact:true,includeHidden:true})}).first();
  await curatable.locator('summary').first().click();
  await curatable.getByRole('button',{name:'停用此挖空位置',exact:true}).click();
  await page.getByRole('status').filter({hasText:'已停用此挖空位置'}).waitFor();
  await page.getByRole('button',{name:'练习',exact:true}).click();
  await page.getByRole('spinbutton',{name:'练习题数',exact:true}).fill('4');
  await page.getByRole('button',{name:'开始练习',exact:true}).click();
  await page.getByRole('button',{name:'提交答案',exact:true}).waitFor();
  if(await page.getByRole('radio').count())await page.getByRole('radio').first().check();
  else {
    const stem=await page.locator('.zs-bank-stem').innerText();
    const answer=await page.evaluate(async stem=>{const response=await fetch('/api/zhiyun-study',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:'fixture-bank-answer',method:'zhiyun-study',payload:{method:'bank-load',args:{}}})});const data=await response.json();return data.result.value.questions.find(q=>q.stem.replace(/\{\{c\d+::[^}]*\}\}/g,'____')===stem)?.answer;},stem);
    assert.ok(answer);await page.getByRole('textbox',{name:'填写答案',exact:true}).fill(answer);
  }
  await page.getByRole('button',{name:'提交答案',exact:true}).click();
  await page.getByText('回答正确',{exact:true}).waitFor();
  await page.screenshot({path:path.join(artifacts,'question-bank-practice.png'),fullPage:true});
  await page.getByRole('button',{name:'结束本次练习',exact:true}).click();
  await page.getByRole('combobox',{name:'练习方式',exact:true}).selectOption('review');
  await page.getByRole('button',{name:'开始练习',exact:true}).click();
  await page.getByRole('button',{name:'提交答案',exact:true}).waitFor();
  assert.ok((await page.locator('.zs-bank-practice h2').innerText()).includes('1 / 1'),'review only draws the previously answered question');
  await page.getByRole('button',{name:'结束本次练习',exact:true}).click();
  await page.getByRole('combobox',{name:'练习方式',exact:true}).selectOption('mixed');
  await page.getByRole('button',{name:'开始练习',exact:true}).click();
  await page.getByRole('button',{name:'提交答案',exact:true}).waitFor();
  assert.ok((await page.locator('.zs-bank-practice h2').innerText()).includes('1 / 4'));
  await page.getByRole('button',{name:'结束本次练习',exact:true}).click();
  // The four strategies share one composer, while new forms have their own honest grading flow.
  for(const [strategy,type] of [['理解拓展','判断题'],['应用变式','简答题'],['综合探究','简答题']]){
    await page.getByRole('button',{name:'出题',exact:true}).click();
    for(const option of await page.locator('.zs-strategy-option').all())await option.locator('input').setChecked((await option.innerText()).includes(strategy));
    const forms=page.getByRole('group',{name:'题型',exact:true});
    for(const label of ['填空题','选择题','判断题','简答题'])await forms.getByRole('checkbox',{name:label,exact:true}).setChecked(label===type);
    await page.getByRole('spinbutton',{name:'总题数',exact:true}).fill('1');
    assert.match(await page.locator('.zs-strategy-preview').innerText(),new RegExp(`${strategy}\\s+1`));
    await page.getByRole('button',{name:'按知识点生成题目',exact:true}).click();
    await page.getByRole('button',{name:'暂停出题',exact:true}).waitFor();
    await page.getByRole('button',{name:'暂停出题',exact:true}).waitFor({state:'hidden'});
    assert.equal(await page.getByRole('progressbar',{name:'出题完成进度',exact:true}).getAttribute('value'),'1',`${strategy} completes`);
    await page.screenshot({path:path.join(artifacts,`question-strategy-${strategy}.png`),fullPage:true});
  }
  await page.getByRole('button',{name:'练习',exact:true}).click();
  await page.getByRole('combobox',{name:'练习方式',exact:true}).selectOption('new');
  await page.getByRole('combobox',{name:'练习题型',exact:true}).selectOption('trueFalse');
  await page.getByRole('button',{name:'开始练习',exact:true}).click();
  await page.getByRole('radio',{name:'正确',exact:true}).check();await page.getByRole('button',{name:'提交答案',exact:true}).click();
  await page.getByText('回答正确',{exact:true}).waitFor();
  await page.getByRole('button',{name:'结束本次练习',exact:true}).click();
  await page.getByRole('combobox',{name:'练习题型',exact:true}).selectOption('shortAnswer');
  await page.getByRole('button',{name:'开始练习',exact:true}).click();
  await page.getByRole('textbox',{name:'你的解答',exact:true}).fill('先描述概率密度函数，再结合原文给出推理。');
  await page.getByRole('button',{name:'对照参考答案',exact:true}).click();
  await page.getByRole('button',{name:'部分掌握',exact:true}).click();
  await page.getByText('自评已记录',{exact:true}).waitFor();
  await page.screenshot({path:path.join(artifacts,'question-short-answer-self-review.png'),fullPage:true});
  await page.getByRole('button',{name:/^历史题库/}).click();
  const activeCount=await page.locator('.zs-bank-active-questions .zs-bank-question').count();assert.ok(activeCount>0);
  await page.route('**/api/zhiyun-study',async route=>{let method;try{method=route.request().postDataJSON()?.payload?.method;}catch{}if(method==='bank-discard')await new Promise(resolve=>setTimeout(resolve,1500));await route.continue();});
  await page.getByRole('checkbox',{name:'全选当前题目',exact:true}).check();
  await page.getByRole('button',{name:'批量弃用',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.zs-bank-active-questions .zs-bank-question').length===0,null,{timeout:700});
  assert.equal(await page.locator('.zs-bank-archive').getAttribute('open'),null,'discarded questions are immediately moved to a collapsed archive');
  await page.getByRole('status').filter({hasText:`已弃用 ${activeCount} 道题`}).waitFor();await page.unroute('**/api/zhiyun-study');
  await page.locator('.zs-bank-archive > summary').click();
  assert.ok(await page.locator('.zs-bank-archive .zs-bank-question').count()>=activeCount);
  await page.screenshot({path:path.join(artifacts,'question-bank-bulk-archive.png'),fullPage:true});
  await page.locator('.zs-bank-archive > summary').click();
  await page.setViewportSize({width:650,height:900});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(artifacts,'question-bank-narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS one generation action, live phases and speed, completed handout persistence, collapsible TOC, measured centered reading column, keyboard navigation and narrow layout; deterministic model only');
}catch(error){await writeFile(path.join(artifacts,'generation-failure.json'),JSON.stringify({error:error.message,errors,pageText:await page?.locator('body').innerText().catch(()=>''),hostLog:hostLog.replace(/token=[^\s]+/g,'token=[redacted]')},null,2));throw error;}finally{await browser?.close();if(server&&!server.killed)server.kill();}
