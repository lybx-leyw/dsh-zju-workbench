/**
 * sztz activity new：哪些活动算新的、已读记录怎么记和清理、应用和助手各记各的。平台是假的，不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zju-sztz-test-"));
process.env.ZJU_DATA_DIR = path.join(root, "data");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { freshActivities, newActivities } = await import("../lib/sztz/index.ts");

const DAY = 86_400_000;
const iso = (at: number) => new Date(at).toISOString();
/** 一个活动：报名从 opens 到 closes，活动从 starts 到 ends，都是相对 now 的天数。 */
const activity = (now: number, id: number, opens: number, closes: number, starts: number, ends: number, mc = `活动${id}`) =>
  ({ id, mc, zxfs: 0.5, zdfs: 0.5, bmkssj: iso(now + opens * DAY), bmjssj: iso(now + closes * DAY), hdkssj: iso(now + starts * DAY), hdjssj: iso(now + ends * DAY) });

test("还能报名和还没开始报名的才算新的；见过的不再给", () => {
  const now = Date.parse("2026-10-12T12:00:00+08:00");
  const rows = [
    activity(now, 1, -2, 5, 8, 9), // 报名中
    activity(now, 2, 3, 6, 8, 9), // 未开始报名
    activity(now, 3, -9, -1, 2, 3), // 报名已截止
    activity(now, 4, -9, -5, -1, 2), // 进行中
    activity(now, 5, -30, -20, -10, -9), // 已结束
  ];
  const first = freshActivities(rows, {}, now);
  assert.deepEqual(first.fresh.map(p => p.id), [1, 2]);
  assert.deepEqual(first.seen, { 1: rows[0]!.bmjssj, 2: rows[1]!.bmjssj });
  assert.deepEqual(freshActivities(rows, first.seen, now).fresh, []);
  // 平台上多了一个：只给这一个。
  assert.deepEqual(freshActivities([...rows, activity(now, 6, -1, 2, 4, 5)], first.seen, now).fresh.map(p => p.id), [6]);
});

test("已读记录：报名截止一周以后清掉，没到一周的留着", () => {
  const now = Date.parse("2026-10-12T12:00:00+08:00");
  const seen = { 7: iso(now - 8 * DAY), 8: iso(now - 3 * DAY), 9: "不是时间" };
  assert.deepEqual(Object.keys(freshActivities([], seen, now).seen), ["8"]);
});

test("第一次全给，第二次不给；应用和助手各记各的", async (t) => {
  const now = Date.now(), calls: Record<string, unknown>[] = [];
  const rows = [activity(now, 11, -1, 3, 5, 6, " 新生杯辩论赛 "), activity(now, 12, 2, 4, 5, 6), activity(now, 13, -9, -1, 2, 3)];
  const platform = { call: async (_method: string, _path: string, params: Record<string, unknown>) => { calls.push(params); return { code: 0, msg: null, data: rows, totalPages: 1, count: rows.length }; } };
  const previous = process.env.ZJU_NOTICE_READER;
  t.after(() => { if (previous === undefined) delete process.env.ZJU_NOTICE_READER; else process.env.ZJU_NOTICE_READER = previous; });
  delete process.env.ZJU_NOTICE_READER;
  const first = await newActivities(platform as never);
  // 报名截止早的在前；地址是活动中心带着活动编号。
  assert.deepEqual(first.activities.map(a => [a.id, a.name, a.status]), [[11, "新生杯辩论赛", "报名中"], [12, "活动12", "未开始报名"]]);
  assert.equal(first.activities[0]!.url, `https://sztz.zju.edu.cn/dekt/#/index/hdzx?xmmc=${encodeURIComponent("新生杯辩论赛")}&xmId=11`);
  assert.match(first.note, /第一次查看/);
  assert.equal("lastChecked" in first, false);
  // 只读活动列表，不读本人的报名和收藏。
  assert.deepEqual(calls.map(params => params.lx), [2]);
  const second = await newActivities(platform as never);
  assert.deepEqual([second.count, typeof second.lastChecked], [0, "string"]);
  // 应用读的时候带着自己的名字，另记一份：助手读过的，应用第一次读照样全给。
  process.env.ZJU_NOTICE_READER = "app";
  assert.equal((await newActivities(platform as never)).count, 2);
  assert.deepEqual(fs.readdirSync(path.join(root, "data", "sztz")).sort(), ["seen.app.json", "seen.json"]);
});
