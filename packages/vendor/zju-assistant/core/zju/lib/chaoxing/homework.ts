/**
 * 学习通里要交的作业和测试。老师常把它们打包进课程「任务」栏里按周发的学习任务（任务引擎），这种作业课程的作业栏里没有，
 * 手机端作业列表也不全，所以先读每个学习任务的明细，再用手机端列表补上老师直接发的。
 * 周测、小测在平台上也是作业，没有字段能分，只能看名字。
 * 只读：都是列表和明细，不打开作业本身，不上报学习进度。读明细不会改变任务的进度和学习时间（真实账号上前后比对过）。
 */
import path from "node:path";
import { BadResponse, ZjuError } from "../core/errors.ts";
import { readJson, writeJson } from "../core/fsjson.ts";
import { beijingMinute } from "../core/output.ts";
import { paths } from "../core/paths.ts";
import { API, MOBILELEARN, TASK, type Chaoxing } from "./client.ts";
import { listCourses, type Course } from "./courses.ts";
import { parseStuWork, type WorkRow } from "./parse.ts";

export interface Homework {
  course: string;
  /** 所在的学习任务；老师直接发的是空的 */
  task: string;
  title: string;
  type: "作业" | "测试";
  opens: string | null;
  deadline: string | null;
  done: boolean;
  /** 已经截止了 */
  closed: boolean;
  requirement: string;
  /** 同一个学习任务里，作业以外还有几项没学完 */
  otherLeft: number;
}

interface TaskRow { id?: unknown; name?: unknown; planCount?: unknown; planFinishCount?: unknown }
interface StandardRow { planUserBO?: { finish?: unknown; plan?: { name?: unknown; introduce?: unknown; planType?: unknown; startDate?: unknown; endDate?: unknown } } }
interface Standard { userTaskQualifyDTO?: { passStandardCalcResultDTOList?: StandardRow[] } }

interface Plan { title: string; requirement: string; opens: number | null; ends: number | null; done: boolean }
interface TaskPlans { plans: Plan[]; otherLeft: number }
interface Cache { version: 1; tasks: Record<string, TaskPlans & { signature: string; at: number }> }

/** 明细里作业这一类的 planType（字段 standardPlanTypeMethod 是 HOMEWORK）。 */
const HOMEWORK = 4;
const TEST = /周测|小测|测验|测试|考试/;
/** 还没到截止的作业每次都重读；别的没做完的任务隔这么久重读一次，老师放着不管的课不必每次一项项读，超星对密集请求会要验证码。 */
const QUIET_MS = 6 * 3600_000;

const kindOf = (title: string): Homework["type"] => TEST.test(title) ? "测试" : "作业";
const text = (value: unknown) => String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
function time(value: unknown): number | null {
  const at = typeof value === "string" && value ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
}
const count = (value: unknown) => typeof value === "number" ? value : 0;

/** 学习任务明细（getUserStandard 的 data）→ 里面的作业，和作业以外没学完的项数。 */
export function plansOf(standard: Standard | undefined): TaskPlans {
  const rows = standard?.userTaskQualifyDTO?.passStandardCalcResultDTOList;
  if (!Array.isArray(rows)) throw new BadResponse("超星学习任务的明细格式不对");
  const result: TaskPlans = { plans: [], otherLeft: 0 };
  for (const row of rows) {
    const plan = row.planUserBO?.plan, done = row.planUserBO?.finish === 1;
    if (plan?.planType !== HOMEWORK) { if (!done) result.otherLeft++; continue; }
    result.plans.push({ title: text(plan.name), requirement: text(plan.introduce), opens: time(plan.startDate), ends: time(plan.endDate), done });
  }
  return result;
}

/** 课程任务栏点开学习任务时的那一跳给出加密编号，明细按它读。只取这一页的文字，页面上的脚本不运行。 */
async function readPlans(c: Chaoxing, course: Course, id: string): Promise<TaskPlans> {
  const page = await c.page(`${TASK}/api/v1/middlePageApi/jumpStudyPlanList?taskId=${id}&moocClassId=${course.clazzId}`);
  const key = /const eTaskUserId = "([^"]+)"/.exec(page.body)?.[1];
  if (!key) throw new BadResponse("超星学习任务页里没有任务编号", { path: new URL(page.url).pathname });
  const data = await c.json<{ data?: Standard }>(`${TASK}/userStudyPlan/getUserStandard?encryTaskUserId=${encodeURIComponent(key)}`);
  return plansOf(data.data);
}

const cacheFile = (course: Course) => path.join(paths.cache(), "chaoxing", `tasks-${course.courseId}-${course.clazzId}.json`);

/** 上次读到的这个任务这次还能不能用：进度变了不能；全部做完的能；没做完的看有没有还没截止的作业，和隔了多久。 */
function reusable(saved: Cache["tasks"][string] | undefined, signature: string, finished: boolean, now: number): boolean {
  if (saved?.signature !== signature) return false;
  if (finished) return true;
  return !saved.plans.some((plan) => !plan.done && plan.ends !== null && plan.ends > now) && now - saved.at < QUIET_MS;
}

/** 一门课的学习任务里的作业。 */
async function courseHomework(c: Chaoxing, course: Course, fresh: boolean, now: number): Promise<Homework[]> {
  const list = await c.json<{ result?: unknown; data?: TaskRow[] }>(`${MOBILELEARN}/v2/apis/active/getData?DB_STRATEGY=DEFAULT&courseId=${course.courseId}&classId=${course.clazzId}`);
  if (list.result !== 1) throw new BadResponse("超星学习任务列表没读到", { course: course.name });
  const tasks = (Array.isArray(list.data) ? list.data : []).filter((task) => task.id);
  const saved = readJson<Cache>(cacheFile(course));
  const before = saved?.version === 1 && saved.tasks ? saved.tasks : {};
  // 只留现在还在的任务；读到一半出错时，已经读到的换成新的，没读到的留着上一次的。
  const after: Cache["tasks"] = Object.fromEntries(tasks.flatMap((task) => before[String(task.id)] ? [[String(task.id), before[String(task.id)]!]] : []));
  const rows: Homework[] = [];
  try {
    for (const task of tasks) {
      const id = String(task.id), total = count(task.planCount), finished = count(task.planFinishCount);
      const signature = `${finished}/${total}`;
      const old = before[id];
      const entry = !fresh && reusable(old, signature, total > 0 && finished >= total, now) ? old! : { ...await readPlans(c, course, id), signature, at: now };
      after[id] = entry;
      for (const plan of entry.plans) {
        rows.push({
          course: course.name, task: text(task.name), title: plan.title, type: kindOf(plan.title),
          opens: beijingMinute(plan.opens), deadline: beijingMinute(plan.ends), done: plan.done, closed: plan.ends !== null && plan.ends <= now,
          requirement: plan.requirement, otherLeft: entry.otherLeft,
        });
      }
    }
  } finally {
    writeJson(cacheFile(course), { version: 1, tasks: after } satisfies Cache);
  }
  return rows;
}

/** 手机端列表的一行 → 老师直接发的一份作业。页面只写「剩余 N 小时 M 分钟」（往下取整），截止时间按整分钟往上补回去。 */
export function fromWorkRow(row: WorkRow, now: number): Homework {
  const ends = row.leftMinutes === null ? null : Math.ceil((now + row.leftMinutes * 60_000) / 60_000) * 60_000;
  return {
    course: row.course, task: "", title: row.title, type: kindOf(row.title), opens: null, deadline: beijingMinute(ends),
    done: /已完成|待批阅|已批阅|已提交/.test(row.status), closed: /已过期|已截止/.test(row.status), requirement: "", otherLeft: 0,
  };
}

/** 这个错读下去也还是这样（登录没过、平台要验证码），不用一门门试。 */
const fatal = (error: unknown) => !(error instanceof ZjuError) || ["AUTH_EXPIRED", "NEEDS_USER", "RATE_LIMITED"].includes(error.code);

export interface HomeworkList {
  homeworks: Homework[];
  /** 没读到的课和原因；其余的照常返回 */
  failed: { course: string; reason: string }[];
}

/** 本人要交的作业和测试，按截止时间从近到远，没有截止时间的在最后。course 给了就只看这门课。 */
export async function listHomework(c: Chaoxing, options: { course?: Course; fresh?: boolean; now?: number } = {}): Promise<HomeworkList> {
  const now = options.now ?? Date.now();
  const courses = options.course ? [options.course] : await listCourses(c);
  const homeworks: Homework[] = [], failed: HomeworkList["failed"] = [];
  for (const course of courses) {
    try { homeworks.push(...await courseHomework(c, course, options.fresh === true, now)); }
    catch (error) { if (fatal(error)) throw error; failed.push({ course: course.name, reason: (error as Error).message }); }
  }
  try {
    const known = new Set(homeworks.map((row) => `${row.course}\n${row.title}`));
    const rows = parseStuWork((await c.page(`${API}/work/stu-work`)).body).map((row) => fromWorkRow(row, now));
    homeworks.push(...rows.filter((row) => !known.has(`${row.course}\n${row.title}`) && (!options.course || row.course === options.course.name)));
  } catch (error) { if (fatal(error)) throw error; failed.push({ course: "手机端作业列表", reason: (error as Error).message }); }
  return { homeworks: homeworks.sort((a, b) => (a.deadline ?? "9").localeCompare(b.deadline ?? "9")), failed };
}
