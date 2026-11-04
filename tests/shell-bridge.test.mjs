import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const { pagesFile } = await import('./support/pinned-pages.mjs');

test('shell registers product pages through dsh-pages, not its own navigation slot', async () => {
  const source = await readFile(path.join(root, 'packages/dsh-zhiyun-shell-workbench/src/client.jsx'), 'utf8');
  // 迁移后的契约：外壳**只**注册导航元数据（`registerPage`）；内容由各页面包自己
  // 注册进页面壳的 `page.content`。所以外壳既不该声明自己的导航槽，也不该声明内容槽。
  assert.match(source, /shell\.registerPage\(/);
  assert.doesNotMatch(source, /config\.pageSlot/, '外壳不应代为声明内容槽 —— 那是页面包的事');
  assert.doesNotMatch(source, /'page\.zhiyun\.(navigation|page)'/, '旧的智云槽名必须彻底消失');
  assert.doesNotMatch(source, /renderSlot\(['"]zhiyun\.shell\.navigation/, '外壳不再渲染自己的导轨');
  // 仍然不许接管原生槽：只允许注册 `shell.overlay`（搜索浮窗），不碰 root/sidebar/main。
  const injections = [...source.matchAll(/ctx\.slots\.inject\(['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual(injections, ['shell.overlay']);
  assert.doesNotMatch(source, /ctx\.layout\.selectPanel\(/, 'outer navigation must not take native plugin panel selection');
});

test('formal overlay preserves native ownership, mounted UI and product view cleanup', async t => {
  const { chromium } = await import('playwright');
  let browser;
  for (const options of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { browser = await chromium.launch({ headless: true, ...options }); break; } catch { /* try installed browser */ }
  }
  assert.ok(browser, 'a Chromium browser is required for overlay integration');
  t.after(() => browser.close());
  const { build } = await import('esbuild');
  const result = await build({ stdin: { resolveDir: root, loader: 'jsx', contents: `
    import React, { useEffect, useState, useSyncExternalStore } from 'react';
    import { createRoot } from 'react-dom/client';
    import { createPortal } from 'react-dom';
    import { installPageShell, normalizeConfig } from ${JSON.stringify(pagesFile('src/client.jsx').replaceAll('\\', '/'))};
    let service, outlet, specification, nativeMounts=0, nativeUnmounts=0, productMounts=0, productUnmounts=0, events=0, data=0;
    const cleanups=[], registrations=[], calls=[];
    function Native(){const [count,set]=useState(0);useEffect(()=>{nativeMounts++;return()=>nativeUnmounts++;},[]);
      return <section data-native><header>Native header</header><aside>Native sidebar</aside><main>
        <button id="native-count" onClick={()=>set(n=>n+1)}>{count}</button></main></section>;}
    const native={component:Native,owner:{},children:{main:{},'shell.overlay':{}},store:{},inject:()=>({})};
    const original={...native};
    function Product(){const [count,set]=useState(0),[open,setOpen]=useState(false);
      useEffect(()=>{productMounts++;const listener=()=>events++;window.addEventListener('product-event',listener);
        return()=>{productUnmounts++;window.removeEventListener('product-event',listener);};},[]);
      return <article id="product-page"><button id="product-count" onClick={()=>{set(n=>n+1);data++;}}>{count}</button>
        <button id="product-open" onClick={()=>setOpen(true)}>Open</button><span id="domain">{data}</span>
        {open&&createPortal(<div id="product-dialog">Dialog</div>,document.body)}</article>;}
    const ctx={
      effect(fn){const off=fn();cleanups.push(off);return off;},
      reflect:{provide(name,value){if(name!=='pages')throw Error(name);service=value;return()=>{};}},
      locale:{register:()=>()=>{},resolveText:value=>typeof value==='string'?value:value.en},
      // Any inspection, subscription or mutation of native services fails this fixture.
      layout:new Proxy({}, {get(){throw Error('native layout access');}}),
      uiWorkspace:new Proxy({}, {get(){throw Error('native workspace access');}}),
      slots:{inject(name,fn){calls.push(name);if(name!=='shell.overlay')throw Error(name);return fn();},
        register(spec,component){specification=spec;registrations.push(spec);outlet=component;return()=>{outlet=null;};},
        entries(){throw Error('native entry inspection');},subscribe(){throw Error('native subscription');}}
    };
    installPageShell(ctx,normalizeConfig({homePage:'ask',pageSlot:'page.zhiyun.page'}));
    service.registerPage({id:'study',label:{en:'Study',zh:'学习'}});
    function Overlay(){const face=specification.inject();return React.createElement(outlet,{
      ...face,usePages:selector=>selector(useSyncExternalStore(face.hooks.pages.subscribe,face.hooks.pages.getSnapshot)),
      t:key=>key,renderSlot(name,props,options){if(name==='page.rail-action')return options.fallback;if(name!=='page.zhiyun.page'||options.entryKey!=='study')throw Error(name);return <Product/>;}});}
    const app=createRoot(document.getElementById('root'));
    app.render(<><Native/><Overlay/></>);
    const untouched=()=>Object.keys(original).every(key=>native[key]===original[key]);
    window.fixture={select:id=>service.selectPage(id),fire:()=>window.dispatchEvent(new Event('product-event')),
      inspect:()=>({nativeMounts,nativeUnmounts,productMounts,productUnmounts,events,data,untouched:untouched(),
        names:registrations.map(spec=>spec.name),children:Object.keys(specification.children),calls}),
      dispose(){app.unmount();for(const off of cleanups.reverse())off();return untouched();}};
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', loader: { '.css': 'text' }, logLevel: 'silent' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div>');
  await page.addScriptTag({ content: result.outputFiles[0].text });
  await page.locator('#native-count').click();
  assert.equal(await page.locator('#native-count').textContent(), '1');
  await page.evaluate(() => window.fixture.select('study'));
  await page.locator('#product-count').click();
  await page.locator('#product-open').click();
  await page.locator('#product-dialog').waitFor();
  assert.equal(await page.locator('[data-native] #product-page').count(), 0);
  assert.equal(await page.locator('[data-native][hidden], [data-native][inert]').count(), 0, 'native DOM is not mutated');
  assert.equal(await page.locator('#native-count').textContent(), '1');
  await page.evaluate(() => window.fixture.select('ask'));
  await page.locator('#product-page').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#product-dialog').count(), 0, 'page-owned body portals unwind');
  await page.evaluate(() => window.fixture.fire());
  let state = await page.evaluate(() => window.fixture.inspect());
  assert.equal(state.productUnmounts, 1);
  assert.equal(state.events, 0, 'page listeners unwind');
  assert.equal(state.data, 1, 'business data outlives page UI');
  await page.evaluate(() => window.fixture.select('study'));
  await page.locator('#product-count').waitFor();
  assert.equal(await page.locator('#product-count').textContent(), '0');
  assert.equal(await page.locator('#domain').textContent(), '1');
  state = await page.evaluate(() => window.fixture.inspect());
  assert.equal(state.nativeMounts, 1);
  assert.equal(state.nativeUnmounts, 0);
  assert.equal(state.productMounts, 2);
  assert.equal(state.untouched, true);
  assert.deepEqual(state.names, ['shell.overlay']);
  assert.deepEqual(state.children, ['page.zhiyun.page', 'page.rail-action']);
  assert.deepEqual(state.calls, ['shell.overlay']);
  assert.equal(await page.evaluate(() => window.fixture.dispose()), true);
  assert.equal(await page.locator('style[data-dsh-pages-layout]').count(), 0);
  assert.deepEqual(errors, []);
});
