/**
 * 研究生教育管理信息系统（yjsy.zju.edu.cn，研究生院的教务系统，和本科教务网 zdbk 是两套）：本人课表。
 *
 * 声明：auth=cas network=public writes=false。页面是单页应用，接口都在 https://yjsy.zju.edu.cn/dataapi 下，GET 带查询串，
 *       请求头 X-Access-Token 带登录换来的 token；响应 {success, code, message, result}。
 * 登录：统一身份认证给 service 签 ticket，GET sys/cas/client/validateLogin?ticket=&service= 换 token（result.token、result.userInfo）。
 *       研究生的 service 是 https://yjsy.zju.edu.cn/；选了研究生课的本科生走本科生入口 https://yjsy.zju.edu.cn/bks。
 *       本科生的账号在研究生入口换 token 返回 500「无效的用户信息」（2026-11-02 实测），所以按学号选入口，换不到再试另一个。
 * 学年学期：xn 是学年的头一年（2026 即 2026-2027）；xq 是大学期，11 春夏、12 秋冬；pkxq 是小学期，11 春、12 夏、13 秋、14 冬。
 *       现在是哪个学年学期：GET system/sysApp/queryByDm?dm=py_xsxk 的 dqxn、dqxq。
 * 教学日历：GET system/sysJxrlXqsj/getJxrlByXnxq?xn&xq&sfqr=1 → kssj（第 1 周所在的那天）、jssj、pkzcs（一共几周）、
 *       xdxjKszc（下半学期从第几周起，冬、夏学期的周次从这里接着数）、sysJxrlSjdList（每节 jc 的 kssj、jssj，写成 800、845 这样的数）。
 * 课表：GET py/pyKcbj/queryXskbByLoginUser?xn&pkxq → result.kcbMap[星期 1–7][节次].pyKcbjSjddVOList，一门课占几节就在几格里各出现一次；
 *       每项 kcmc 课程名、bjbh 班号、kcbjId、zc 周次（逗号分隔，按大学期从第 1 周数）、xm 教师、xqmc 校区、jxl 楼、cdmc 教室、
 *       bkbj=1 是本科生课、xkzt=12 是还没处理完的选课（页面上标橙色）。result.sjddList 是上课时间地点由学院另行通知的课。
 *       这些字段照官方页面的前端代码（js/app.*.js 里的 PyGrkb、kcb 两个组件）；2026-11-02 用没选研究生课的本科生账号实测过登录、
 *       学年学期、教学日历和空课表，有课时的数据还没对过真实账号。
 */
import type { ModuleRequirements } from "../core/module.ts";
import { openContext, type Context, type OpenOptions } from "../webvpn/transport.ts";
import { AuthExpired, BadResponse, ConfigError, RemoteRejected } from "../core/errors.ts";
import { credentials } from "../profile/profile.ts";

export const HOST = "yjsy.zju.edu.cn";
const API = `https://${HOST}/dataapi`;
export const requirements: ModuleRequirements = { name: "yjsy", title: "研究生教育管理信息系统", hosts: [HOST], auth: "cas", network: "public", writes: false };

const ENTRIES = { graduate: `https://${HOST}/`, undergraduate: `https://${HOST}/bks` } as const;
type Entry = keyof typeof ENTRIES;
/** 学号首位是培养层次：1 博士、2 硕士、3 本科。 */
const isGraduate = (su: string) => /^[12]\d{7,11}$/.test(su);

interface Reply<T> { success: boolean; code: number; message: string; result: T }

export class Yjsy {
  readonly ctx: Context;
  readonly entry: Entry;
  private readonly token: string;
  constructor(ctx: Context, entry: Entry, token: string) { this.ctx = ctx; this.entry = entry; this.token = token; }

  async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
    const res = await this.ctx.fetch(`${API}/${path}?${new URLSearchParams(query)}`, { headers: { "X-Access-Token": this.token, Accept: "application/json" } });
    const reply = res.json<Reply<T>>();
    if (!reply || typeof reply.success !== "boolean") throw new BadResponse(`研究生教务网没有返回 JSON（HTTP ${res.status}）`, { path });
    if (reply.code === 401 || reply.code === 510) throw new AuthExpired("yjsy", "研究生教务网的登录失效了");
    if (!reply.success) throw new RemoteRejected(`研究生教务网：${reply.message || "请求失败"}`, { path });
    return reply.result;
  }

  close(): void { this.ctx.close(); }
}

/** 用统一身份认证换一个 token；换不到时返回原因，由调用方决定换不换入口。 */
async function signIn(ctx: Context, entry: Entry): Promise<{ token: string } | { reason: string }> {
  if (!ctx.zjuam) throw new AuthExpired("zjuam", "研究生教务网需要统一身份认证");
  const service = ENTRIES[entry];
  const back = await ctx.zjuam.service(service);
  const ticket = new URL(back).searchParams.get("ticket");
  if (!ticket) throw new AuthExpired("zjuam", "统一身份认证没有给研究生教务网签票");
  const res = await ctx.fetch(`${API}/sys/cas/client/validateLogin?${new URLSearchParams({ ticket, service })}`, { headers: { Accept: "application/json" } });
  const reply = res.json<Reply<{ token?: string }>>();
  if (!reply || typeof reply.success !== "boolean") throw new BadResponse(`研究生教务网登录没有返回 JSON（HTTP ${res.status}）`);
  if (reply.success && reply.result?.token) return { token: reply.result.token };
  return { reason: reply.message || `code ${reply.code}` };
}

/** 登录：研究生先走研究生入口，本科生先走本科生入口；换不到 token 再试另一个，都不行时说清两边的原因。 */
export async function openYjsy(opts: OpenOptions = {}): Promise<Yjsy> {
  const ctx = await openContext(requirements, opts);
  try {
    const order: Entry[] = isGraduate(credentials().username) ? ["graduate", "undergraduate"] : ["undergraduate", "graduate"];
    const reasons: string[] = [];
    for (const entry of order) {
      const result = await signIn(ctx, entry);
      if ("token" in result) return new Yjsy(ctx, entry, result.token);
      reasons.push(`${entry === "graduate" ? "研究生入口" : "本科生入口"}：${result.reason}`);
    }
    throw new RemoteRejected(`研究生教务网不让这个账号登录（${reasons.join("；")}）`);
  } catch (error) { ctx.close(); throw error; }
}

// ── 学年学期 ──────────────────────────────────────────

/** 大学期和它的两个小学期。 */
const SEMESTERS = { 秋冬: { xq: "12", halves: { 秋: "13", 冬: "14" } }, 春夏: { xq: "11", halves: { 春: "11", 夏: "12" } } } as const;
type Semester = keyof typeof SEMESTERS;
const HALF_NAMES: Record<string, string> = { "11": "春", "12": "夏", "13": "秋", "14": "冬" };

/** --year、--term 换成接口的 xn、xq 和要查的小学期；不给时用系统上的当前学年学期。 */
export async function resolveTerm(y: Yjsy, options: { year?: string; term?: string }): Promise<{ year: string; semester: Semester; xn: string; xq: string; halves: string[] }> {
  let xn: string, semester: Semester | undefined;
  if (options.year !== undefined) {
    const m = /^(\d{4})-(\d{4})$/.exec(options.year);
    if (!m || +m[2]! !== +m[1]! + 1) throw new ConfigError("学年要写成 2026-2027 这样");
    xn = m[1]!;
  }
  const term = options.term?.trim();
  if (term !== undefined && !["秋", "冬", "春", "夏", "秋冬", "春夏"].includes(term)) throw new ConfigError("学期只能是秋、冬、春、夏、秋冬、春夏");
  if (term) semester = term in SEMESTERS ? term as Semester : (["秋", "冬"].includes(term) ? "秋冬" : "春夏");
  if (options.year === undefined || !semester) {
    const now = await y.get<{ dqxn?: string; dqxq?: string }>("system/sysApp/queryByDm", { dm: "py_xsxk" });
    if (!/^\d{4}$/.test(String(now?.dqxn)) || !["11", "12"].includes(String(now?.dqxq))) throw new BadResponse("研究生教务网没有说现在是哪个学年学期");
    xn ??= String(now.dqxn);
    semester ??= now.dqxq === "12" ? "秋冬" : "春夏";
  }
  const info = SEMESTERS[semester];
  const halves = term && term.length === 1 ? [(info.halves as Record<string, string>)[term]!] : Object.values(info.halves);
  return { year: `${xn!}-${+xn! + 1}`, semester, xn: xn!, xq: info.xq, halves };
}

// ── 课表 ──────────────────────────────────────────────

interface CalendarReply {
  kssj?: string; jssj?: string; pkzcs?: number | string; xdxjKszc?: number | string;
  sysJxrlSjdList?: { jc?: number | string; kssj?: number | string; jssj?: number | string }[];
}
interface Cell {
  kcbjId?: string; kcmc?: string; bjbh?: string; zc?: string; pkxq?: string; xm?: string; xqmc?: string; jxl?: string; cdmc?: string;
  bkbj?: string; xkzt?: string;
}
interface Unscheduled { kcmc?: string; bjbh?: string; pkxq?: string; kkxyMc?: string; skxq?: string; zjjsXm?: string; bz?: string; xkzt?: string }
interface Meeting { weekday: number; periods: number[]; startTime: string; endTime: string; location: string; weeks: string; dates: string[] }

const DAY_MS = 86_400_000;
const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const mondayOf = (date: string) => addDays(date, 1 - (new Date(`${date}T00:00:00Z`).getUTCDay() || 7));
/** 800 → 08:00 */
const clock = (value: unknown) => { const digits = String(value ?? "").padStart(4, "0"); return /^\d{4}$/.test(digits) ? `${digits.slice(0, 2)}:${digits.slice(2)}` : ""; };
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** [1,2,3,5,7] → 第1-3,5,7周 */
function weeksText(weeks: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < weeks.length;) {
    let j = i;
    while (j + 1 < weeks.length && weeks[j + 1] === weeks[j]! + 1) j++;
    parts.push(j > i ? `${weeks[i]}-${weeks[j]}` : `${weeks[i]}`);
    i = j + 1;
  }
  return parts.length ? `第${parts.join(",")}周` : "";
}

/**
 * 本人一个学期的课表：每门课的教师、星期、节次、起止时间、地点、周次，和每次课的日期。
 * 周次换成小学期里的第几周（冬、夏学期从 1 数起，和本科教务网一样）；dates 按教学日历的第 1 周算好。
 */
export async function timetable(y: Yjsy, options: { year?: string; term?: string } = {}) {
  const term = await resolveTerm(y, options);
  const calendar = await y.get<CalendarReply>("system/sysJxrlXqsj/getJxrlByXnxq", { xn: term.xn, xq: term.xq, sfqr: "1" });
  const start = text(calendar?.kssj).slice(0, 10), secondHalf = Number(calendar?.xdxjKszc);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new BadResponse(`研究生教务网还没有 ${term.year} ${term.semester}学期的教学日历`);
  // 第 14 节的下课时间，官方页面不照接口给的写，一律显示 22:05。
  const periodTimes = (calendar.sysJxrlSjdList ?? []).map(row => ({ period: Number(row.jc), startTime: clock(row.kssj), endTime: Number(row.jc) === 14 ? "22:05" : clock(row.jssj) }))
    .filter(row => Number.isInteger(row.period) && row.startTime && row.endTime).sort((a, b) => a.period - b.period);
  if (!periodTimes.length) throw new BadResponse("研究生教务网的教学日历里没有节次时间");
  const firstMonday = mondayOf(start);

  const courses = new Map<string, { name: string; class: string; teacher: string; term: string; undergraduate: boolean; pending: boolean; slots: Map<string, { weekday: number; location: string; zc: number[]; periods: number[] }> }>();
  const unscheduled: Record<string, string | boolean>[] = [];
  for (const half of term.halves) {
    const result = await y.get<{ kcbMap?: Record<string, Record<string, { pyKcbjSjddVOList?: Cell[] }>>; sjddList?: Unscheduled[] }>("py/pyKcbj/queryXskbByLoginUser", { xn: term.xn, pkxq: half });
    if (!result || typeof result !== "object") throw new BadResponse("研究生教务网的课表不是对象");
    for (const [day, cells] of Object.entries(result.kcbMap ?? {})) {
      const weekday = Number(day);
      if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new BadResponse("研究生教务网课表的星期不对", { day });
      for (const [jc, cell] of Object.entries(cells ?? {})) {
        const period = Number(jc);
        if (!Number.isInteger(period) || period < 1) throw new BadResponse("研究生教务网课表的节次不对", { jc });
        for (const item of cell?.pyKcbjSjddVOList ?? []) {
          const zc = text(item.zc).split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
          const location = `${text(item.xqmc)}${text(item.jxl)}${text(item.cdmc)}`;
          const key = text(item.kcbjId) || `${text(item.kcmc)}|${text(item.bjbh)}`;
          const course = courses.get(key) ?? { name: text(item.kcmc), class: text(item.bjbh), teacher: text(item.xm), term: HALF_NAMES[text(item.pkxq)] ?? HALF_NAMES[half]!,
            undergraduate: text(item.bkbj) === "1", pending: text(item.xkzt) === "12", slots: new Map() };
          // 同一门课、同一天、同一地点、同样周次的几格并成一次课。
          const slotKey = JSON.stringify([weekday, location, zc]);
          const slot = course.slots.get(slotKey) ?? { weekday, location, zc, periods: [] };
          if (!slot.periods.includes(period)) slot.periods.push(period);
          course.slots.set(slotKey, slot);
          courses.set(key, course);
        }
      }
    }
    for (const row of result.sjddList ?? []) {
      unscheduled.push({ name: text(row.kcmc), class: text(row.bjbh), term: HALF_NAMES[text(row.pkxq)] ?? HALF_NAMES[half]!, college: text(row.kkxyMc), campus: text(row.skxq),
        teacher: text(row.zjjsXm), note: text(row.bz), pending: text(row.xkzt) === "12" });
    }
  }

  const timeOf = (period: number) => periodTimes.find(row => row.period === period);
  const out = [...courses.values()].map(({ slots, ...course }) => {
    const meetings: Meeting[] = [];
    for (const slot of slots.values()) {
      const periods = [...slot.periods].sort((a, b) => a - b);
      // 连着的节次是一次课；中间断开的分成几次。
      for (let i = 0; i < periods.length;) {
        let j = i;
        while (j + 1 < periods.length && periods[j + 1] === periods[j]! + 1) j++;
        const run = periods.slice(i, j + 1), first = timeOf(run[0]!), last = timeOf(run.at(-1)!);
        if (!first || !last) throw new BadResponse("研究生教务网课表的节次在教学日历里没有时间", { periods: run });
        // 冬、夏学期的周次接着秋、春学期数：换成这个小学期里的第几周。
        const offset = ["冬", "夏"].includes(course.term) && Number.isInteger(secondHalf) && secondHalf > 1 ? secondHalf - 1 : 0;
        meetings.push({ weekday: slot.weekday, periods: run, startTime: first.startTime, endTime: last.endTime, location: slot.location,
          weeks: weeksText(slot.zc.map(w => w - offset).filter(w => w > 0)), dates: slot.zc.map(w => addDays(firstMonday, (w - 1) * 7 + slot.weekday - 1)).sort() });
        i = j + 1;
      }
    }
    meetings.sort((a, b) => a.weekday - b.weekday || a.periods[0]! - b.periods[0]!);
    return { ...course, meetings };
  }).sort((a, b) => a.name.localeCompare(b.name, "zh"));

  return {
    term: { year: term.year, term: term.halves.length > 1 ? term.semester : HALF_NAMES[term.halves[0]!]!, start, end: text(calendar.jssj).slice(0, 10), weeks: Number(calendar.pkzcs) || null,
      ...(Number.isInteger(secondHalf) && secondHalf > 1 ? { secondHalfFrom: addDays(firstMonday, (secondHalf - 1) * 7) } : {}) },
    entry: y.entry === "graduate" ? "研究生入口" : "本科生入口",
    timezone: "Asia/Shanghai", periodTimes, count: out.length, courses: out, ...(unscheduled.length ? { unscheduled } : {}),
  };
}
