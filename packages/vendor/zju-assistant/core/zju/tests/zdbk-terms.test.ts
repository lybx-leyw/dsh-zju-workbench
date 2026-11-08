/**
 * 教务网课表页的默认学年学期：正常页面照选中的读；页面里没有学年学期时，研究生说清楚是本科教务网查不到，本科生照旧报页面异常。不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseTimetableDefaults } from "../lib/zdbk/kbcx.ts";
import { isGraduate } from "../lib/zdbk/client.ts";

const PAGE = `<select id="xnm"><option value="2025-2026">2025-2026</option><option value="2026-2027" selected="selected">2026-2027</option></select>
<select id="xqm"><option value="1|秋" selected>秋</option><option value="1|冬">冬</option></select>`;
// 研究生登录本科教务网后拿到的那一页：没有学年学期的下拉框。
const EMPTY = "<html><head><title>教学管理信息服务平台</title></head><body>没有可用的功能</body></html>";

test("学号首位 1、2 是研究生，3 是本科生", () => {
  assert.equal(isGraduate("22451001"), true);
  assert.equal(isGraduate("12351002"), true);
  assert.equal(isGraduate("3250100001"), false);
  assert.equal(isGraduate(""), false);
});

test("正常的课表页照选中的学年学期读", () => {
  assert.deepEqual(parseTimetableDefaults(PAGE, "3250100001"), { year: "2026-2027", term: "1|秋" });
});

test("页面里没有学年学期时，研究生得到能看懂的原因，本科生照旧报页面异常", () => {
  assert.throws(() => parseTimetableDefaults(EMPTY, "22451001"), (error: Error & { code?: string }) => error.code === "CONFIG" && error.message.includes("研究生"));
  assert.throws(() => parseTimetableDefaults(EMPTY, "3250100001"), /无法读取教务课表页面的默认学年学期/);
  assert.throws(() => parseTimetableDefaults(EMPTY), /无法读取教务课表页面的默认学年学期/);
});
