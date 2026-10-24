import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { startServer } from './quiz_bench/bench.mjs';

const artifacts=path.resolve('artifacts/quiz-bench-browser');await fs.mkdir(artifacts,{recursive:true});
const runtime=await startServer({outDir:path.join(artifacts,`runs-${Date.now()}`),sourceDir:path.join(artifacts,'no-sources')});
let browser;
try{
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(runtime.url);await page.locator('#strategies input').first().waitFor();
  await page.locator('#counts').fill('3');await page.locator('#batches').fill('2');
  await page.screenshot({path:path.join(artifacts,'compose.png'),fullPage:true});
  await page.getByRole('button',{name:'开始评测',exact:true}).click();
  await page.locator('#results').waitFor();await page.waitForFunction(()=>!document.getElementById('start').disabled);
  assert.equal(await page.locator('#summary-rows tr').count(),2);
  assert.match(await page.locator('#summary').innerText(),/合成桩/);
  assert.match(await page.locator('#summary-rows').innerText(),/无法判定/);
  await page.locator('.cell').first().locator('summary').first().click();
  await page.screenshot({path:path.join(artifacts,'report.png'),fullPage:true});
  await page.locator('#cursor').fill('1');assert.ok((await page.locator('#event').innerText()).length>10);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'下载人工复核模板',exact:true}).click();const file=await download;
  const template=JSON.parse(await fs.readFile(await file.path(),'utf8'));template.gold={concepts:[{id:'g1',label:'概率定义'}]};
  template.questions[0].reviewed=true;template.questions[0].goldIds=['g1'];template.questions[0].correct=true;
  await page.locator('#review').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(template))});
  await page.waitForFunction(()=>document.getElementById('summary-rows').innerText.includes('100.0%'));
  await page.reload();await page.locator('#runs option').nth(1).waitFor({state:'attached'});
  const id=await page.locator('#runs option').nth(1).getAttribute('value');await page.locator('#runs').selectOption(id);await page.locator('#results').waitFor();
  assert.match(await page.locator('#summary-rows').innerText(),/100.0%/);
  await page.setViewportSize({width:650,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.join(artifacts,'narrow.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('PASS quiz bench: product-backed synthetic run, report, replay, human review import, refresh and narrow layout; no paid calls');
}finally{await browser?.close();await runtime.close();}
