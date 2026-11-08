/**
 * chaoxing homework：学习任务里的作业和测试、手机端列表补老师直接发的。超星是假的，不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zju-chaoxing-homework-"));
process.env.ZJU_DATA_DIR = path.join(root, "data");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { listHomework, plansOf, fromWorkRow } = await import("../lib/chaoxing/homework.ts");
const { parseStuWork } = await import("../lib/chaoxing/parse.ts");

const NOW = Date.parse("2026-11-04T08:00:00Z");
const plan = (name: string, planType: number, finish: number, dates: { startDate?: string; endDate?: string } = {}, introduce = "") =>
  ({ planUserBO: { finish, plan: { name, planType, introduce, startDate: null, endDate: null, ...dates } } });
const standard = (...rows: unknown[]) => ({ userTaskQualifyDTO: { passStandardCalcResultDTOList: rows } });

const WEEK = { startDate: "2026-11-02T00:00:00.000+00:00", endDate: "2026-11-15T15:59:00.000+00:00" };
const STU_WORK = `<ul class="nav">
  <li onclick="goTask(this)" data="x"><span class="spanImg"><img src="a.png"></span><i class="redPoint"></i>
    <div role="option"><p aria-hidden="true">第八周小论文</p><span class="status">未提交</span><span>《示例课程》</span><span class="fr">剩余 2小时 5分钟</span><span aria-label="x"></span></div></li>
  <li onclick="goTask(this)" data="x"><span class="spanImg"><img src="a.png"></span>
    <div role="option"><p aria-hidden="true">第一周周测</p><span>已完成</span><span>《示例课程》</span><span aria-label="x"></span></div></li>
</ul>`;

/** 假的超星：一门课，任务和明细由 world 给；记下读了哪些明细。 */
function client(world: { tasks: unknown[]; details: Record<string, unknown>; work?: string; failList?: boolean }) {
  const reads: string[] = [];
  const page = (url: string, body: string) => ({ url, status: 200, body });
  return {
    reads,
    json: async (url: string) => {
      if (url.includes("/mycourse/backclazzdata")) return { channelList: [{ content: { id: 2, cpi: 3, name: "默认班级", course: { data: [{ id: 1, name: "示例课程", teacherfactor: "老师" }] } } }] };
      if (url.includes("/active/getData")) {
        if (world.failList) return { result: 0, msg: "读不了" };
        return { result: 1, data: world.tasks };
      }
      const key = decodeURIComponent(url.split("encryTaskUserId=")[1] ?? "");
      reads.push(key);
      return { code: 200, result: true, data: world.details[key] };
    },
    page: async (url: string) => {
      if (url.includes("/work/stu-work")) return page(url, world.work ?? `<p>暂无作业</p>`);
      const id = /taskId=(\d+)/.exec(url)?.[1];
      return page(url, `<script>const eTaskUserId = "key@${id}"</script>`);
    },
  };
}
const task = (id: number, name: string, finished: number, total: number) => ({ id, name, planFinishCount: finished, planCount: total, userTaskQualifyStatus: finished >= total ? "已达标" : "未达标" });
const clean = () => fs.rmSync(path.join(root, "data"), { recursive: true, force: true });

test("plansOf keeps only homework items and counts the rest that are left", () => {
  const { plans, otherLeft } = plansOf(standard(plan("腰背痛", 1, 0), plan("关节痛", 1, 1), plan("第八周周测", 4, 0, WEEK, "<p>必做</p>"), plan("讨论题", 9, 0)));
  assert.equal(otherLeft, 2);
  assert.deepEqual(plans, [{ title: "第八周周测", requirement: "必做", opens: Date.parse(WEEK.startDate), ends: Date.parse(WEEK.endDate), done: false }]);
  assert.throws(() => plansOf({}), /格式不对/);
});

test("homework comes out of study tasks with Beijing deadlines; tests are told apart by name", async () => {
  clean();
  const c = client({
    tasks: [task(10, "第八周学习任务", 1, 4), task(11, "实验任务", 0, 2)],
    details: {
      "key@10": standard(plan("腰背痛", 1, 0), plan("第七周讲义", 1, 1), plan("第八周周测", 4, 0, WEEK), plan("第八周大作业", 4, 0, WEEK, "下载附件填写")),
      // 老师挂着不管的那种：没有截止时间。
      "key@11": standard(plan("实验报告（请提交到别的平台）", 4, 0), plan("操作视频", 10, 0)),
    },
  });
  const { homeworks, failed } = await listHomework(c as never, { now: NOW });
  assert.deepEqual(failed, []);
  assert.deepEqual(homeworks.map((row) => [row.task, row.title, row.type, row.deadline, row.done, row.otherLeft]), [
    ["第八周学习任务", "第八周周测", "测试", "2026-11-15 23:59", false, 1],
    ["第八周学习任务", "第八周大作业", "作业", "2026-11-15 23:59", false, 1],
    ["实验任务", "实验报告（请提交到别的平台）", "作业", null, false, 1],
  ]);
  assert.equal(homeworks[1]!.requirement, "下载附件填写");
  assert.equal(homeworks[0]!.opens, "2026-11-02 08:00");
});

test("finished tasks and quiet ones are not read again; open homework and --fresh are", async () => {
  clean();
  const world = {
    tasks: [task(20, "做完的", 1, 1), task(21, "还有作业的", 0, 1), task(22, "没人管的", 0, 1)],
    details: {
      "key@20": standard(plan("上周周测", 4, 1, { endDate: "2026-10-30T15:59:00Z" })),
      "key@21": standard(plan("本周作业", 4, 0, WEEK)),
      "key@22": standard(plan("实验报告", 4, 0)),
    },
  };
  const first = client(world);
  await listHomework(first as never, { now: NOW });
  assert.deepEqual(first.reads, ["key@20", "key@21", "key@22"]);
  const second = client(world);
  await listHomework(second as never, { now: NOW + 60_000 });
  assert.deepEqual(second.reads, ["key@21"]);
  // 老师往任务里加了一项，进度的分母变了，这个任务就重读。
  const third = client({ ...world, tasks: [task(20, "做完的", 1, 2), world.tasks[1], world.tasks[2]] });
  await listHomework(third as never, { now: NOW + 120_000 });
  assert.deepEqual(third.reads, ["key@20", "key@21"]);
  const fourth = client(world);
  await listHomework(fourth as never, { now: NOW + 180_000, fresh: true });
  assert.deepEqual(fourth.reads, ["key@20", "key@21", "key@22"]);
  // 隔久了，没人管的也重读一次。
  const fifth = client(world);
  await listHomework(fifth as never, { now: NOW + 7 * 3600_000 });
  assert.ok(fifth.reads.includes("key@22"));
});

test("the mobile list adds homework the teacher sent directly, without repeating what the tasks already have", async () => {
  clean();
  const c = client({
    tasks: [task(30, "第一周", 1, 1)],
    details: { "key@30": standard(plan("第一周周测", 4, 1, { endDate: "2026-10-01T15:59:00Z" })) },
    work: STU_WORK,
  });
  const { homeworks } = await listHomework(c as never, { now: NOW });
  assert.deepEqual(homeworks.map((row) => [row.title, row.task, row.done, row.deadline]), [
    ["第一周周测", "第一周", true, "2026-10-01 23:59"],
    ["第八周小论文", "", false, "2026-11-04 18:05"],
  ]);
});

test("the mobile list is parsed row by row; its rounded-down time left is rounded back up to the minute", () => {
  const rows = parseStuWork(STU_WORK);
  assert.deepEqual(rows, [
    { title: "第八周小论文", course: "示例课程", status: "未提交", leftMinutes: 125 },
    { title: "第一周周测", course: "示例课程", status: "已完成", leftMinutes: null },
  ]);
  assert.deepEqual(parseStuWork("<p>暂无作业</p>"), []);
  // 北京时间 16:00:30 还剩 7 小时 58 分（实际 7 小时 58 分 30 秒），截止是 23:59。
  assert.equal(fromWorkRow({ title: "t", course: "c", status: "未提交", leftMinutes: 478 }, Date.parse("2026-11-04T08:00:30Z")).deadline, "2026-11-04 23:59");
  assert.equal(fromWorkRow({ title: "第二周周测", course: "c", status: "已完成", leftMinutes: null }, NOW).done, true);
  assert.equal(fromWorkRow({ title: "t", course: "c", status: "待批阅", leftMinutes: null }, NOW).type, "作业");
  assert.equal(fromWorkRow({ title: "t", course: "c", status: "待批阅", leftMinutes: null }, NOW).done, true);
});

test("a course that cannot be read is reported; the others still come back", async () => {
  clean();
  const { homeworks, failed } = await listHomework(client({ tasks: [], details: {}, failList: true, work: STU_WORK }) as never, { now: NOW });
  assert.deepEqual(failed.map((row) => row.course), ["示例课程"]);
  assert.equal(homeworks.length, 2);
});
