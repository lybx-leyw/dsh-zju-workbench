import { BadResponse } from "../core/errors.ts";
import { beijingMinute } from "../core/output.ts";
import { id, type Xuezai } from "./client.ts";
import { activityType, currentSemesters, listCourses, listSemesters } from "./courses.ts";
import { listHomework, requirementText } from "./homework.ts";
import type { Todo } from "./types.ts";

export async function listTodos(client: Xuezai, courseId?: number): Promise<Todo[]> {
  const data = await client.json<{ todo_list: Todo[] }>("/api/todos?no-intercept=true");
  if (!Array.isArray(data.todo_list)) throw new BadResponse("待办响应缺少 todo_list");
  return courseId === undefined ? data.todo_list : data.todo_list.filter((t) => Number(t.course_id) === Number(id(courseId)));
}

/**
 * 用课程作业列表补查原生待办可能漏掉的未交作业；失败不会伪装成没有待办。范围是指定课程，或当前学期的全部课程。
 * done 为真时已交的作业也留下（行里的 submitted 为真），日程表用它把交过的标成已完成；读的还是同一份列表，不多发请求。
 */
export async function scanHomeworkTodos(client: Xuezai, only?: { id: number; name: string }, { done = false } = {}) {
  const listed = only ? [only] : await listCourses(client, { semester: currentSemesters(await listSemesters(client)).map((s) => s.id) });
  const courses = [...new Map(listed.map((c) => [c.id, c])).values()];
  const tasks: Todo[] = [];
  const errors: { course: string; message: string }[] = [];
  for (let i = 0; i < courses.length; i += 6) {
    await Promise.all(courses.slice(i, i + 6).map(async (course) => {
      try {
        for (const row of await listHomework(client, course.id)) if (done || row.submitted !== true) tasks.push({ ...row, type: "homework", course_id: course.id, course_name: course.name });
      } catch (e) { errors.push({ course: course.name, message: e instanceof Error ? e.message : String(e) }); }
    }));
  }
  const result = { todos: tasks, errors };
  if (errors.length) throw new BadResponse("部分课程作业读取失败，待办列表不完整", { result });
  return result;
}

/** Native exams/quizzes plus a complete homework scan; the caller never selects a source. done adds submitted homework, marked done. */
export async function getTodos(client: Xuezai, only?: { id: number; name: string }, { done = false } = {}) {
  const responses = await Promise.allSettled([listTodos(client, only?.id), scanHomeworkTodos(client, only, { done })]);
  const native = responses[0]!, scanned = responses[1]!;
  const scan = scanned.status === "fulfilled" ? scanned.value : scanned.reason instanceof BadResponse
    ? scanned.reason.detail.result as { todos: Todo[]; errors: unknown[] } | undefined : undefined;
  const merged = new Map<string, Todo>();
  const key = (row: Todo) => `${row.type ?? "unknown"}:${row.course_id ?? ""}:${row.activity_id ?? row.id}`;
  for (const row of native.status === "fulfilled" ? native.value : []) merged.set(key(row), row);
  for (const row of scan?.todos ?? []) merged.set(key(row), { ...merged.get(key(row)), ...row });
  const deadline = (row: Todo) => { const t = Date.parse(String(row.end_time ?? row.deadline ?? "")); return Number.isFinite(t) ? t : Infinity; };
  const todos = [...merged.values()].sort((a, b) => deadline(a) - deadline(b)).map(row => {
    const requirement = requirementText(row.data);
    return { course: row.course_name ?? "", title: row.title, type: activityType(row.type), deadline: beijingMinute(row.end_time ?? row.deadline), ...(row.submitted === true ? { done: true } : {}), ...(requirement ? { requirement } : {}) };
  });
  const result = { currentTime: beijingMinute(Date.now()), count: todos.length, todos };
  const errors = responses.flatMap((r, i) => r.status === "rejected" ? [{ source: i ? "课程作业" : "平台待办", message: String(r.reason?.message ?? r.reason) }] : []);
  if (errors.length) throw new BadResponse("待办查询不完整，已保留取得的内容", { result: { ...result, errors, ...(scan?.errors?.length ? { courseErrors: scan.errors } : {}) } });
  return result;
}
