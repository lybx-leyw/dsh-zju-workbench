import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'weread-sources-'))
process.env.WEREAD_DATA_DIR = directory
const { accounts, list, listTracked, read, track, newArticles } = await import('../lib/sources.ts')
const { setBrowser } = await import('../lib/browser/runtime.ts')
const { SkillError } = await import('../lib/config.ts')
test.after(() => fs.rmSync(directory, { recursive: true, force: true }))
const biz = 'MTIzNDU2Nzg5MA==', bookId = 'MP_WXS_1234567890'
function setup(t: any, state: any = {}) {
  state.articles ??= ['第一篇']; state.books ??= [{bookId,title:'测试号'}]; state.requests=[]; state.fetched=[]
  setBrowser({
    request: async url => {
      const target=new URL(url);state.requests.push(target.pathname)
      if (state.error) throw state.error
      const body=target.pathname==='/web/shelf/sync'?{books:state.books}:target.pathname==='/web/mp/articles'?{reviews:target.searchParams.get('offset')==='0'?state.articles.map((title:string)=>({subReviews:[{review:{reviewId:bookId+'_'+Buffer.from(title).toString('hex'),mpInfo:{title}}}]})):[]}:{ }
      return {status:200,body:JSON.stringify(body)}
    }, article:async url=>{state.fetched.push(url);if(state.articleError)throw state.articleError;return '<html><body><h1 id="activity-name">页面标题</h1><div id="js_content"><p>文章正文</p></div></body></html>'},
    cookie:async()=>undefined,login:async()=>({verified:true}),solve:async()=>assert.fail('unexpected captcha'),logout:async()=>{},close:async()=>{},
  })
  t.mock.method(globalThis,'fetch',async()=>assert.fail('article must use app browser'))
  t.after(()=>{setBrowser();fs.rmSync(path.join(directory,'tracked.json'),{force:true})})
  return state
}
test('articles and candidates only use WeRead, even with an obsolete local environment setting',async t=>{
  const state=setup(t);process.env.WEREAD_SOURCE='local';t.after(()=>delete process.env.WEREAD_SOURCE)
  const result=await list({account:'测试号',limit:1});assert.equal(result.articles[0].title,'第一篇')
  assert.deepEqual((await accounts({})).accounts,[{biz,name:'测试号'}]);assert.ok(state.requests.includes('/web/shelf/sync'))
})
test('ambiguous publisher names give candidates',async t=>{
  setup(t,{books:[{bookId,title:'测试号甲'},{bookId:'MP_WXS_999999',title:'测试号乙'}]})
  await assert.rejects(list({account:'测试号'}),(e:any)=>e.code==='account_ambiguous'&&e.details.candidates.length===2)
})
test('read resolves article links once; direct links skip the bookshelf',async t=>{
  const state=setup(t);assert.match((await read({account:'测试号',title:'第一篇'})).markdown,/文章正文/);assert.equal(state.fetched.length,1)
  state.requests=[];await read({url:'https://mp.weixin.qq.com/s/example'});assert.deepEqual(state.requests,[])
})
test('tracking is idempotent for articles; list does not advance new; cancel removes publisher',async t=>{
  const state=setup(t);await track({account:'测试号'});assert.deepEqual((await newArticles({})).articles,[])
  state.articles.unshift('新文章');assert.equal((await listTracked({})).accounts.length,1)
  assert.deepEqual((await newArticles({})).articles.map(a=>a.title),['新文章']);assert.deepEqual((await newArticles({})).articles,[])
  await track({account:'测试号',cancel:true});assert.deepEqual((await listTracked({})).accounts,[])
})
test('verification failures stay on WeRead and retain tracking state',async t=>{
  const state=setup(t);await track({account:'测试号'});state.error=new SkillError('verification_required','需要验证')
  const result=await listTracked({});assert.deepEqual(result.state,{ok:false,status:'verification_required',message:'需要验证'});assert.equal(result.accounts[0].error?.status,'verification_required')
  await assert.rejects(newArticles({}),/需要验证/);state.error=null;state.articles.unshift('稍后文章');assert.equal((await newArticles({})).articles.length,1)
})
test('article extraction failure is returned without retrying lookup',async t=>{
  const state=setup(t,{articleError:new SkillError('article_deleted','原文已删除')});await assert.rejects(read({account:'测试号',title:'第一篇'}),/原文已删除/);assert.equal(state.fetched.length,1)
})
