/** 体育课考勤的只读查询：各学期每次课的日期与到勤状态。 */
import { RemoteRejected } from "../core/errors.ts";
import type { ApiResponse, AttendanceClient } from "./client.ts";

const API = "/api/l/v6";
function data(res: ApiResponse, what: string): unknown {
  if (res.code !== 200) throw new RemoteRejected("体艺" + what + "失败：" + (res.message || "code " + res.code), { code: res.code });
  return res.data;
}
/** App ClassAttendanceModel2.Status labels. */
const STATUS_LABELS: Record<string, string> = { "-1": "停课", "0": "未考勤", "1": "到", "2": "缺勤", "3": "早退", "4": "病假", "5": "事假", "6": "迟到", "7": "未确认" };

/**
 * Attendance history of every term's PE course, newest first. Counts come from the held sessions in `detail`:
 * the list's own `lack` also counts sessions not yet held (2026-09 term: shouldReach 16, lack 13 after 3 classes).
 */
export async function history(client: AttendanceClient, course?: string) {
  const wanted = course?.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const terms = data(await client.get(`${API}/termlist`), "学期查询");
  const perTerm = await Promise.all((Array.isArray(terms) ? terms : []).reverse().map(async (t) => {
    const rows = data(await client.get(`${API}/student/courselist`, { uid: client.username, termId: String(t.termId), schoolYear: String(t.schoolYear) }), "课程查询");
    return (Array.isArray(rows) ? rows : []).map((c) => ({ courseId: String(c.courseId), name: String(c.name), semester: String(t.name ?? "") }));
  }));
  const courses = perTerm.flat().filter((c) => !wanted || c.name.normalize("NFKC").replace(/\s+/g, "").toLowerCase().includes(wanted));
  const found = await Promise.all(courses.map(async (c) => {
    const [list, times] = await Promise.all([
      client.get(`${API}/student/attendancelist`, { uid: client.username, courseId: c.courseId }).then((res) => data(res, "考勤记录查询") as { shouldReach?: unknown; detail?: unknown } | null),
      client.get(`${API}/course_times`, { courseId: c.courseId }).then((res) => data(res, "课次查询")),
    ]);
    const dates = new Map((Array.isArray(times) ? times : []).map((r) => [String(r.teachingWeek), String(r.date ?? "").slice(0, 10)]));
    const records = (Array.isArray(list?.detail) ? list.detail : []).map((r) => ({
      session: Number(r.teachingWeek), date: dates.get(String(r.teachingWeek)) ?? "",
      status: (STATUS_LABELS[String(r.status)] ?? `状态 ${r.status}`) + (Number(r.isEarly) === 1 && String(r.status) !== "3" ? "（早退）" : ""),
    })).sort((a, b) => b.session - a.session);
    const signed = records.filter((r) => r.status.startsWith("到") || r.status.startsWith("迟到")).length;
    return { course: c.name, semester: c.semester, planned: Number(list?.shouldReach) || undefined, held: records.length, signed, records };
  }));
  const missed = found.flatMap((c) => c.records.filter((r) => !/^(到|迟到|停课)/.test(r.status)).map((r) => `${c.course} 第 ${r.session} 次课${r.date ? `（${r.date}）` : ""} ${r.status}`));
  const held = found.reduce((n, c) => n + c.held, 0), signed = found.reduce((n, c) => n + c.signed, 0);
  const message = !courses.length ? (course ? `没有找到体育课“${course}”。` : "没有体艺课程。")
    : !held ? `${found.map((c) => c.course).join("、")}还没有考勤记录。`
    : `${found.length} 门体育课已有 ${held} 次考勤，到勤 ${signed} 次` + (missed.length ? `，未到：${missed.join("；")}。` : "，没有缺勤。");
  return { status: held ? "found" : "none", message, courses: found };
}
