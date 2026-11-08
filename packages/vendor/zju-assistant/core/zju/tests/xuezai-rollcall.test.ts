/** Sign-in uses fake clients, captions and clocks; never contacts a campus service. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zju-rollcall-"));
process.env.ZJU_DATA_DIR = path.join(root, "data");
process.env.ZJU_ALLOW_WRITE = "1";
test.after(() => {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith("zju-rollcall-"));
  fs.rmSync(root, { recursive: true });
  assert.equal(fs.existsSync(root), false);
});

const { signin } = await import("../lib/xuezai/rollcall.ts");
const { signinNumber, numberCandidates, createCaptionInput } = await import("../lib/xuezai/rollcall-number.ts");
const { signinAll } = await import("../lib/xuezai/rollcall-all.ts");
const { createRollcallCommand, rollcallCommands } = await import("../lib/xuezai/rollcall-cli.ts");
const { liveInput } = await import("../lib/zhiyun/live-input.ts");
const { liveRoot } = await import("../lib/zhiyun/live.ts");
const { modules } = await import("../lib/cli.ts");

const epoch = Date.parse("2026-10-31T08:00:00+08:00");
const row = (kind = "radar", signed = false) => ({ rollcall_id: 12, course_title: "测试课程", is_radar: kind === "radar", is_number: kind === "number", status: signed ? "on_call_fine" : "absent" });
function options(overrides = {}) {
  let time = epoch;
  return { confirm: true, journal: async () => {}, durationMs: 8000, pollMs: 4000,
    now: () => time, wait: async (ms: number) => { time += ms; }, ...overrides };
}
function captions(text = "签到码零零零七", fail = false) {
  const calls: unknown[] = [];
  return { calls, input: {
    async prepare(until: number) { calls.push(["prepare", until]); if (fail) throw new Error("字幕不可用"); },
    async read(course: string, from: number, to: number) {
      calls.push(["read", course, from, to]);
      return { status: "available", message: "定稿字幕", course, segments: [{ start: new Date(epoch - 1000).toISOString(), end: new Date(epoch).toISOString(), text }] };
    },
    async close() { calls.push("close"); },
  } };
}

test("三种签到入口都在联网前检查双重授权", async () => {
  let opened = 0;
  for (const kind of ["gps", "number", "all"] as const) {
    const command = createRollcallCommand(async () => { opened++; throw new Error("不应打开客户端"); }, kind);
    await assert.rejects(command.run({}, []), { code: "WRITE_GATE_CLOSED" });
    process.env.ZJU_ALLOW_WRITE = "0";
    try { await assert.rejects(command.run({ confirm: true }, []), { code: "WRITE_GATE_CLOSED" }); }
    finally { process.env.ZJU_ALLOW_WRITE = "1"; }
  }
  assert.equal(opened, 0);
});

test("GPS 成功立即停止，写前日志先于提交，不处理已签的数字点名", async () => {
  const events: string[] = [];
  const client = {
    async json() { events.push("list"); return { rollcalls: [row("number", true), row()] }; },
    async request(url: string, request: RequestInit) {
      events.push("put"); assert.match(url, /answer\?api_version=1.1.2$/);
      assert.equal(request.method, "PUT");
      return { status: 200, json: () => ({ status: "on_call_fine" }) };
    },
  };
  const result = await signin(client, options({ journal: async ({ stage }: { stage: string }) => { events.push(stage); } }));
  assert.equal(result.status, "signed");
  assert.equal(result.polls, 1);
  assert.equal(result.answers, 1);
  assert.deepEqual(events, ["list", "answer", "put", "response"]);
});

test("已签不重复提交；仅有另一种已签点名时不能冒充本次成功", async () => {
  const client = (kind: string) => ({ async json() { return { rollcalls: [row(kind, true)] }; }, async request() { assert.fail("不应提交"); } });
  assert.equal((await signin(client("radar"), options())).status, "already-signed");
  const result = await signin(client("number"), options());
  assert.equal(result.status, "not-signed");
  assert.equal(result.polls, 2);
});

test("日志写入失败停止提交；提前取消不查询或写入", async () => {
  let queries = 0, writes = 0;
  const client = { async json() { queries++; return { rollcalls: [row()] }; }, async request() { writes++; throw new Error("不应提交"); } };
  await assert.rejects(signin(client, options({ journal: async () => { throw new Error("磁盘写入失败"); } })), /日志写入失败/);
  assert.equal(writes, 0);
  const result = await signin(client, options({ signal: AbortSignal.abort() }));
  assert.equal(result.status, "cancelled");
  assert.equal(queries, 1);
});

test("数字候选保留前导零，不补三位数，不采用普通年份或远隔语句", () => {
  const segment = (text: string, seconds = 0) => ({ start: new Date(epoch + seconds * 1000).toISOString(), end: new Date(epoch + seconds * 1000).toISOString(), text });
  assert.equal(numberCandidates([segment("签到码 零零零七")])[0]?.code, "0007");
  assert.equal(numberCandidates([segment("点名密码 12 34")])[0]?.code, "1234");
  assert.deepEqual(numberCandidates([segment("签到码 123")]), []);
  assert.deepEqual(numberCandidates([segment("今年是2026年")]), []);
  assert.deepEqual(numberCandidates([segment("签到码"), segment("2026", 20)]), []);
});

test("数字签到从同课窗口取码，提交后回查才成功，最后关闭输入", async () => {
  const { input, calls } = captions(); let signed = false;
  const client = {
    async json() { return { rollcalls: [row("number", signed)] }; },
    async request(url: string, request: RequestInit) {
      assert.match(url, /answer_number_rollcall$/);
      assert.equal(JSON.parse(String(request.body)).numberCode, "0007");
      signed = true; return { status: 200, json: () => ({}) };
    },
  };
  const result = await signinNumber(client, options(), input);
  assert.equal(result.status, "signed"); assert.equal(result.answers, 1);
  assert.deepEqual(calls, [["prepare", epoch + 8000], ["read", "测试课程", epoch - 300000, epoch], "close"]);
});

test("提交响应说成功但回查未签，不能报告成功；缺码或字幕不可用不提交", async () => {
  let writes = 0;
  const client = {
    async json() { return { rollcalls: [row("number")] }; },
    async request() { writes++; return { status: 200, json: () => ({ status: "on_call_fine" }) }; },
  };
  const result = await signinNumber(client, options(), captions().input);
  assert.equal(result.status, "needs-code"); assert.equal(writes, 2);
  for (const input of [captions("签到码123").input, captions("", true).input]) {
    writes = 0;
    const missing = await signinNumber(client, options(), input);
    assert.equal(missing.status, "needs-code"); assert.equal(writes, 0);
  }
});

test("全开在任一路成功时立刻取消另一条，故障不阻断可用分支", async () => {
  const client = { async json() { assert.fail("注入执行器不会联网"); }, async request() { assert.fail("不会提交"); } };
  let siblingStopped = false;
  const success = { status: "signed" as const, message: "签到成功", polls: 1, answers: 1 };
  const result = await signinAll(client, options(), {
    async gps(_client, opts) { await Promise.resolve(); opts.onSuccess?.(success); return success; },
    async number(_client, opts) {
      await new Promise<void>(resolve => { if (opts.signal?.aborted) resolve(); else opts.signal?.addEventListener("abort", () => resolve(), { once: true }); });
      siblingStopped = true; return { ...success, status: "cancelled" as const, message: "已停止" };
    },
  });
  assert.equal(result.status, "signed"); assert.equal(result.via, "gps"); assert.equal(siblingStopped, true);
  const recovered = await signinAll(client, options(), {
    async gps() { throw new Error("GPS 不可用"); },
    async number(_client, opts) { opts.onSuccess?.(success); return success; },
  });
  assert.equal(recovered.status, "signed"); assert.equal(recovered.via, "number");
});

test("字幕输入服从智云开关，并且不能停止其他任务", async () => {
  process.env.ZJU_DISABLED_MODULES = "zhiyun";
  try {
    await assert.rejects(createCaptionInput().prepare(epoch + 600000), /禁用/);
    await assert.rejects(liveInput({ action: "text", course: "测试", from: epoch, to: epoch }), /禁用/);
  } finally { delete process.env.ZJU_DISABLED_MODULES; }
  const taskFile = path.join(liveRoot(), "task.json");
  fs.mkdirSync(liveRoot(), { recursive: true });
  const saved = JSON.stringify({ id: crypto.randomUUID(), status: "running", pid: process.pid });
  fs.writeFileSync(taskFile, saved);
  const result = await liveInput({ action: "stop", requestId: crypto.randomUUID() });
  assert.equal(result.status, "not-owned");
  assert.equal(fs.readFileSync(taskFile, "utf8"), saved);
  assert.equal(fs.existsSync(path.join(liveRoot(), "stop.json")), false);
});

test("CLI 使用默认时限，成功关闭客户端，失败保留业务结果；场馆不再接受等待参数", async () => {
  let closed = 0;
  const open = async () => ({ async json() { return { rollcalls: [row("radar", true)] }; }, async request() { assert.fail("已签不提交"); }, close() { closed++; } });
  const result = await createRollcallCommand(open).run({ confirm: true }, []) as { status: string };
  assert.equal(result.status, "already-signed"); assert.equal(closed, 1);
  assert.equal(rollcallCommands.rollcall!.options!.duration!.default, 600);
  assert.equal(rollcallCommands.rollcall!.options!.interval!.default, 4);
  const empty = async () => ({ async json() { return { rollcalls: [] }; }, async request() { assert.fail("没有点名"); }, close() { closed++; } });
  await assert.rejects(createRollcallCommand(empty).run({ confirm: true, duration: "1" }, []), error => {
    assert.equal(error.code, "NEEDS_USER"); assert.equal(error.detail.result.status, "not-signed");
    assert.ok(error.detail.journalFile); return true;
  });
  assert.equal(closed, 2);
  await assert.rejects(modules.tyys.commands.venue!.children!.book!.run({ duration: "600" }, []), /不支持 --duration/);
});
