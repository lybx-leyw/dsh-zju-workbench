import test from 'node:test';
import assert from 'node:assert/strict';
import { savedAccountConnection } from '../packages/dsh-zhiyun-classroom/src/connection.js';
const account={username:'fake',password:'fake'};
function setup(login) {
  let current=account;
  const source={ready:Promise.resolve(),transport:{session:{jar:{getCookies:async()=>[]}}},login};
  return {connection:savedAccountConnection({source,readAccount:async()=>current,getUser:async()=>null}),change:()=>{current={...account,password:'changed'};}};
}
test('opening state with saved credentials coalesces classroom authentication',async()=>{
 let count=0;
 const {connection}=setup(async(_,options)=>{count++;assert.equal(options.reuseSso,false);return {authenticated:true};});
 await Promise.all([connection.ensure(),connection.ensure(),connection.ensure()]);
 assert.equal(count,1);
});
test('failed automatic login is not resubmitted by repeated state requests',async()=>{
 let count=0;
 const {connection,change}=setup(async()=>{count++;throw new Error('rejected');});
 await assert.rejects(connection.ensure());await assert.rejects(connection.ensure());assert.equal(count,1);
 change();await assert.rejects(connection.ensure());assert.equal(count,2);
});
test('explicit logout prevents immediate automatic reconnection',async()=>{
 let count=0;const {connection,change}=setup(async()=>{count++;return {authenticated:true};});
 await connection.suspend();assert.equal(await connection.ensure(),false);assert.equal(count,0);
 change();assert.equal(await connection.ensure(),true);assert.equal(count,1);
});

test('a saved account change cannot reuse the previous account SSO',async()=>{
 let account={username:'one',password:'fake'},calls=0;
 const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:4000000000})).toString('base64url')+'.sig';
 const source={ready:Promise.resolve(),transport:{session:{accountKey:(await import('node:crypto')).createHash('sha256').update('one').digest('hex'),jar:{getCookies:async()=>[{key:'_token',value:token}]}}},login:async(_,options)=>{calls++;assert.equal(options.reuseSso,false);return {authenticated:true};}};
 const connection=savedAccountConnection({source,readAccount:async()=>account,getUser:async()=>({id:'old'})});
 await connection.ensure();assert.equal(calls,0);
 account={username:'two',password:'fake'};await connection.ensure();assert.equal(calls,1);
});

test('an expired SSO ticket cannot mask a rejected password', async () => {
 const { Transport }=await import('../packages/dsh-zhiyun-classroom/src/transport.js');
 const { authenticate }=await import('../packages/dsh-zhiyun-classroom/src/auth.js');
 let posts=0;
 const transport=new Transport({fetch:async(url,init)=>{
  const target=new URL(url);
  if(target.hostname==='yjapi.cmc.zju.edu.cn')return new Response('',{status:302,headers:{location:'https://zjuam.zju.edu.cn/cas/login?service=fake'}});
  if(target.pathname==='/cas/v2/getPubKey')return new Response(JSON.stringify({modulus:'10001',exponent:'3'}));
  if(init.method==='POST'){posts++;return new Response('<input name="execution" value="again">');}
  return new Response('<input name="execution" value="fake">');
 }});
 await transport.session.jar.setCookie('iPlanetDirectoryPro=old; Domain=zju.edu.cn; Path=/; Secure','https://zjuam.zju.edu.cn/cas/login');
 await assert.rejects(authenticate(transport,{username:'fake',password:'fake'},{entry:'oauth'}),{code:'AUTH_REJECTED'});
 assert.equal(posts,1);
});

test('a legacy token without an account binding cannot authorize another saved account',async()=>{
 const token='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({exp:4000000000})).toString('base64url')+'.sig';
 let calls=0;
 const source={ready:Promise.resolve(),transport:{session:{jar:{getCookies:async()=>[{key:'_token',value:token}]}}},login:async(_,options)=>{calls++;assert.equal(options.reuseSso,false);return {authenticated:true};}};
 const connection=savedAccountConnection({source,readAccount:async()=>({username:'new-account',password:'fake'}),getUser:async()=>({id:'legacy-user'})});
 await connection.ensure();assert.equal(calls,1);
});
