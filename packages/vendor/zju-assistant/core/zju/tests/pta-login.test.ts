/** PTA 登录指纹的隔离、持久化和旧会话升级。远端请求全部使用假的响应。 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CookieJar, DEFAULT_UA, HttpResponse, type RequestOptions } from "../lib/core/http.ts";
import { readJson, writeJson } from "../lib/core/fsjson.ts";
import { Pta, ORIGIN, accountKey, sessionStore } from "../lib/pta/client.ts";
import type { Context } from "../lib/webvpn/transport.ts";
import type { SessionFile } from "../lib/zjuam/session.ts";
import type { VerifyCaptcha } from "../lib/pta/verification.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zju-pta-login-"));
const previousDataDir = process.env.ZJU_DATA_DIR;
process.env.ZJU_DATA_DIR = root;
test.after(() => {
  if (previousDataDir === undefined) delete process.env.ZJU_DATA_DIR;
  else process.env.ZJU_DATA_DIR = previousDataDir;
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("zju-pta-login-"));
  fs.rmSync(root, { recursive: true });
  assert.equal(fs.existsSync(root), false);
});

const legacy = crypto.createHash("md5").update(DEFAULT_UA).digest("hex");
const fingerprintFile = (username: string) => path.join(root, "pta", "fingerprints", `${accountKey(username)}.json`);
function fake(username: string, failLogin = false, verify: VerifyCaptcha = async () => { throw new Error("GATEWAY_WRONG_CAPTCHA"); }) {
  const calls: { url: string; options: RequestOptions }[] = [];
  const ctx = {
    http: { jar: new CookieJar(), userAgent:DEFAULT_UA }, close() {},
    async fetch(url: string, options: RequestOptions = {}) {
      calls.push({ url, options });
      const rejected = failLogin && options.method === "POST";
      return new HttpResponse({ status: rejected ? 403 : 200, url, headers: {}, elapsedMs: 0,
        body: JSON.stringify(rejected ? { error: { code: "GATEWAY_WRONG_CAPTCHA" } } : { user: { id: "1", email: username } }) });
    },
  };
  const client = new Pta(ctx as unknown as Context, { username, password: "test-password" }, verify);
  return { client, calls, ctx };
}
async function importedFingerprint(username: string) {
  const { client, calls } = fake(username);
  try {
    await client.importCookie("PTASession=test-session");
    const fingerprint = calls[0]!.options.headers!["X-Lollipop"]!;
    assert.match(fingerprint, /^[a-f0-9]{32}$/i);
    assert.notEqual(fingerprint, legacy);
    return fingerprint;
  } finally { client.close(); }
}

test("different accounts use separate stable fingerprints", async () => {
  const first = await importedFingerprint("first@example.test");
  const second = await importedFingerprint("second@example.test");
  assert.notEqual(first, second);
  assert.equal(await importedFingerprint("first@example.test"), first);
  assert.equal(await importedFingerprint("FIRST@example.test"), first);
});

test("captcha failures keep the fingerprint and do not retry or replace an existing session", async () => {
  const username = "blocked@example.test", original = sessionStore(username);
  const jar = new CookieJar(); jar.put("PTASession", "previous-session", "pintia.cn");
  original.save(jar, { fingerprint: legacy });
  const originalBytes = fs.readFileSync(original.file, "utf8");
  const one = fake(username, true);
  await assert.rejects(one.client.login(true), /GATEWAY_WRONG_CAPTCHA/);
  await assert.rejects(one.client.login(true), /GATEWAY_WRONG_CAPTCHA/);
  const firstPosts = one.calls.filter(c => c.options.method === "POST");
  assert.equal(firstPosts.length, 1);
  const fingerprint = firstPosts[0]!.options.headers!["X-Lollipop"];
  assert.notEqual(fingerprint, legacy);
  assert.equal(fs.readFileSync(original.file, "utf8"), originalBytes);
  const two = fake(username, true);
  await assert.rejects(two.client.login(true), /GATEWAY_WRONG_CAPTCHA/);
  assert.equal(two.calls.find(c => c.options.method === "POST")!.options.headers!["X-Lollipop"], fingerprint);
  one.client.close(); two.client.close();
});

test("expired cookies and logout do not reset the client identity", async () => {
  const username = "expiry@example.test", fingerprint = await importedFingerprint(username), store = sessionStore(username);
  const saved = readJson<SessionFile>(store.file)!;
  writeJson(store.file, { ...saved, savedAt: Date.now() - 31 * 24 * 3600 * 1000 });
  assert.equal(store.load(), undefined);
  assert.equal(await importedFingerprint(username), fingerprint);
  assert.equal(store.clear(), true);
  assert.equal(await importedFingerprint(username), fingerprint);
});

test("upgrading a shared fingerprint keeps the usable cookie and avoids password login", async () => {
  const username = "upgrade@example.test", store = sessionStore(username), jar = new CookieJar();
  jar.put("PTASession", "working-session", "pintia.cn");
  store.save(jar, { fingerprint: legacy });
  const { client, calls, ctx } = fake(username);
  await client.login();
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.url.endsWith("/api/u/current"));
  assert.equal(ctx.http.jar.get("PTASession", ORIGIN), "working-session");
  assert.notEqual(calls[0]!.options.headers!["X-Lollipop"], legacy);
  assert.equal(store.load()!.extra.fingerprint, calls[0]!.options.headers!["X-Lollipop"]);
  client.close();
});

test("existing individual fingerprints survive migration", async () => {
  const username = "individual@example.test", fingerprint = "a".repeat(32);
  sessionStore(username).save(new CookieJar(), { fingerprint });
  assert.equal(await importedFingerprint(username), fingerprint);
});

test("parallel first runs agree on the same fingerprint across processes", async () => {
  const clientUrl = new URL("../lib/pta/client.ts", import.meta.url).href;
  const httpUrl = new URL("../lib/core/http.ts", import.meta.url).href;
  const script = `import { Pta } from ${JSON.stringify(clientUrl)};
    import { CookieJar, HttpResponse } from ${JSON.stringify(httpUrl)};
    const ctx = { http: { jar: new CookieJar() }, close() {}, async fetch(url, options) {
      process.stdout.write(options.headers['X-Lollipop']);
      return new HttpResponse({ status: 200, headers: {}, url, elapsedMs: 0, body: JSON.stringify({ user: { id: '1', email: 'parallel@example.test' } }) });
    } };
    await new Pta(ctx, { username: 'parallel@example.test', password: 'test' }).importCookie('PTASession=test');`;
  const run = promisify(execFile);
  const results = await Promise.all(Array.from({ length: 6 }, () => run(process.execPath, ["--input-type=module", "--eval", script])));
  const fingerprints = results.map(r => r.stdout);
  assert.equal(new Set(fingerprints).size, 1);
  assert.match(fingerprints[0]!, /^[a-f0-9]{32}$/);
  assert.equal(fs.readdirSync(path.dirname(fingerprintFile("parallel@example.test"))).some(name => name.endsWith(".tmp")), false);
});

test("damaged persisted identity stops before networking instead of silently rotating", () => {
  const username = "damaged@example.test", file = fingerprintFile(username);
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, "broken");
  assert.throws(() => fake(username), /指纹文件损坏/);
  assert.equal(fs.readFileSync(file, "utf8"), "broken");
});

function challenge(username: string, verify: VerifyCaptcha, second: unknown = { user: { id: "1", email: username } }, firstCode = "GATEWAY_WRONG_CAPTCHA") {
  const posts: { body: Record<string, unknown>; fingerprint: string; cookie: string | undefined }[] = [];
  const jar = new CookieJar();
  const ctx = { http: { jar, userAgent:DEFAULT_UA }, close() {}, async fetch(url: string, options: RequestOptions = {}) {
    let body: unknown = { user: { id: "1", email: username } };
    if (options.method === "POST") {
      posts.push({ body:JSON.parse(String(options.body)),fingerprint:options.headers!["X-Lollipop"]!,cookie:ctx.http.jar.get("gateway",ORIGIN) });
      ctx.http.jar.put("gateway","same-attempt","pintia.cn");
      body = posts.length === 1 ? { error: { code:firstCode } } : second;
      if (!(body as {error?:unknown}).error) ctx.http.jar.put("PTASession","verified-session","pintia.cn");
    }
    return new HttpResponse({ status:200,headers:{},url,elapsedMs:0,body:JSON.stringify(body) });
  } };
  return { client:new Pta(ctx as unknown as Context,{username,password:"test-password"},verify),posts };
}

test("PTA challenge sends its proof in one continuation and saves the confirmed session", async () => {
  const username="proof@example.test"; let verified=0;
  const {client,posts}=challenge(username,async()=>{ verified++;return {ticket:"pta-ticket",randStr:"pta-rand"}; });
  await client.login();
  assert.equal(verified,1);assert.equal(posts.length,2);
  assert.deepEqual(posts[0]!.body,{email:username,password:"test-password",rememberMe:true});
  assert.deepEqual(posts[1]!.body,{...posts[0]!.body,ticket:"pta-ticket",randStr:"pta-rand"});
  assert.equal(posts[1]!.fingerprint,posts[0]!.fingerprint);
  assert.equal(posts[1]!.cookie,"same-attempt");
  assert.equal(sessionStore(username).load()!.jar.get("PTASession",ORIGIN),"verified-session");
  const saved=fs.readFileSync(sessionStore(username).file,"utf8");
  assert.doesNotMatch(saved,/pta-ticket|pta-rand|test-password/);
  const next=fake(username);await next.client.login();
  assert.equal(next.calls.length,1);assert.ok(next.calls[0]!.url.endsWith("/api/u/current"));
  client.close();next.client.close();
});

test("repeated challenges and cancellation never loop password submissions", async () => {
  let verified=0;
  const rejected=challenge("rejected@example.test",async()=>{verified++;return{ticket:"t",randStr:"r"};},{error:{code:"GATEWAY_WRONG_CAPTCHA"}});
  await assert.rejects(rejected.client.login(),/GATEWAY_WRONG_CAPTCHA/);
  await assert.rejects(rejected.client.login(),/GATEWAY_WRONG_CAPTCHA/);
  assert.equal(verified,1);assert.equal(rejected.posts.length,2);
  assert.equal(sessionStore("rejected@example.test").load(),undefined);
  const cancelled=challenge("cancelled@example.test",async()=>{throw new Error("cancelled")});
  await assert.rejects(cancelled.client.login(),/cancelled/);
  assert.equal(cancelled.posts.length,1);
  const invalid=challenge("invalid-proof@example.test",async()=>({ticket:"",randStr:""}));
  await assert.rejects(invalid.client.login(),/有效票据/);
  assert.equal(invalid.posts.length,1);
});

test("credential errors never open a captcha and MFA is not treated as login success", async () => {
  const invalid=challenge("password@example.test",async()=>assert.fail("must not verify"),undefined,"USER_SERVICE_WRONG_PASSWORD");
  await assert.rejects(invalid.client.login(),/账号或密码/);
  assert.equal(invalid.posts.length,1);
  const mfa=challenge("mfa@example.test",async()=>({ticket:"t",randStr:"r"}),{requireMfa:true});
  await assert.rejects(mfa.client.login(),/二次验证/);
  assert.equal(sessionStore("mfa@example.test").load(),undefined);
});
