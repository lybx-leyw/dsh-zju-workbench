/**
 * tyys venue book 只约一次：没放号、没空场直接返回，不等也不刷；提交被拒不重试。场馆是假的，不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zju-tyys-booking-"));
process.env.ZJU_DATA_DIR = path.join(root, "data");
process.env.ZJU_ALLOW_WRITE = "1";
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { bookVenue, VenueJournal } = await import("../lib/tyys/booking.ts");
const { RemoteRejected } = await import("../lib/core/errors.ts");

const site = { id: "1", campus: "紫金港", venue: "体育馆", name: "羽毛球", sport: "羽毛球", maxSlots: 2 };
/** 北京时间 2026-11-02 10:00，约三天后 11-05 晚上 19:00。 */
const now = Date.parse("2026-11-02T10:00:00+08:00");
const date = "2026-11-05";

function slots(status: number) {
  return ["18:00", "19:00", "20:00"].map((start, i) => ({ spaceId: "s1", space: "1 号场", timeId: `t${i}`, start, end: `${18 + i + 1}:00`, status }));
}
/** 假场馆：day 给什么就返回什么，记下每次调用。submit 照 onSubmit 处理。 */
function venue(day: { open: boolean; days: number; slots: ReturnType<typeof slots> }, onSubmit: () => unknown = () => ({ orderInfo: {} })) {
  const calls: string[] = [];
  const client = {
    username: "test",
    async catalog() { return { sites: [site], maxSlots: 2, fetchedAt: "" }; },
    async notice() { return { title: "", content: "", releaseTimes: [{ scope: "紫金港羽毛球", time: "12:00" }], fetchedAt: "", source: "" }; },
    async day(_site: unknown, target: string) { calls.push(`day ${target}`); return { date: target, weekStart: "2026-11-02", token: "tk", message: "", ...day }; },
    async identity() { return {}; },
    async request(method: string, endpoint: string) {
      calls.push(`${method} ${endpoint}`);
      if (endpoint === "/api/orders/mine") return { content: [], last: true };
      if (endpoint === "/api/reservation/order/info") return { venueInfoBean: { buddyNumMin: 0 }, phone: "13800000000", isCaptchaCheck: 0 };
      if (endpoint === "/api/reservation/order/submit") return onSubmit();
      throw new Error(`没想到的请求 ${endpoint}`);
    },
    close() {},
  };
  return { client, calls };
}
function options(waits: number[]) {
  return { sport: "羽毛球", date, time: { start: "19:00" }, confirm: true, deadline: now + 180_000,
    journal: new VenueJournal("test", path.join(root, `journal-${Math.random()}.jsonl`)),
    now: () => now, wait: async (ms: number) => { waits.push(ms); }, companions: async () => ({}),
    solver: { async start() {}, async solve() { return undefined; }, close() {} } };
}

test("目标日期还没放号：报预计放号时间就返回，不等", async () => {
  const waits: number[] = [], { client, calls } = venue({ open: false, days: 2, slots: [] });
  const result = await bookVenue(client, options(waits));
  assert.equal(result.status, "not-released");
  assert.ok(result.releaseAt);
  assert.match(result.message, /不等放号/);
  assert.deepEqual(waits, []);
  assert.equal(calls.filter(c => c.startsWith("day")).length, 1);
});

test("时段约满：返回相邻时段，不挂着等空场", async () => {
  const waits: number[] = [], { client, calls } = venue({ open: true, days: 4, slots: slots(2) });
  const result = await bookVenue(client, options(waits));
  assert.equal(result.status, "unavailable");
  assert.ok(Array.isArray(result.alternatives));
  assert.deepEqual(waits, []);
  assert.ok(!calls.some(c => c.startsWith("POST")));
});

test("提交被拒（场地被别人约了）：照实返回，不再提交一次", async () => {
  const waits: number[] = [], { client, calls } = venue({ open: true, days: 4, slots: slots(1) }, () => { throw new RemoteRejected("该场地已被预约"); });
  const result = await bookVenue(client, options(waits));
  assert.equal(result.status, "rejected");
  assert.equal(calls.filter(c => c.endsWith("/order/submit")).length, 1);
});

test("正常有空场：提交一次、完成零元确认并回查订单", async () => {
  const waits: number[] = [];
  const order = { tradeNo: "test-order", venueSiteId: site.id, orderStatus: 1, payStatus: 1, amountFee: "0.00",
    reservationStartDate: `${date}T19:00:00+08:00`, reservationEndDate: `${date}T20:00:00+08:00` };
  let created = false;
  const { client, calls } = venue({ open: true, days: 4, slots: slots(1) }, () => { created = true; return { orderInfo: { ...order } }; });
  const original = client.request;
  client.request = async (method: string, endpoint: string) => {
    if (endpoint === "/api/orders/mine") {
      calls.push(`${method} ${endpoint}`);
      return { content: created ? [{ ...order }] : [], last: true };
    }
    if (endpoint === "/api/venue/finances/order/pay") {
      calls.push(`${method} ${endpoint}`); order.payStatus = 2; return {};
    }
    return original(method, endpoint);
  };
  const opts = options(waits), result = await bookVenue(client, opts);
  assert.equal(result.status, "booked");
  assert.equal(calls.filter(c => c.startsWith("day")).length, 1);
  assert.equal(calls.filter(c => c.endsWith("/order/submit")).length, 1);
  assert.equal(calls.filter(c => c.endsWith("/order/pay")).length, 1);
  assert.deepEqual(opts.journal.pending(), []);
  // 平台预下单后的固定间隔仍保留，它不是等放号或刷空场。
  assert.deepEqual(waits, [1500]);
});
