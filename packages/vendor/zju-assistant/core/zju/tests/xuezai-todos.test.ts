/**
 * xuezai todos：未交的作业照旧列出；加 done 时已交的也列出来，标 done。学在浙大是假的，不联网。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "zju-xuezai-todos-"));
process.env.ZJU_DATA_DIR = path.join(root, "data");
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const { getTodos } = await import("../lib/xuezai/todos.ts");

/** 一个假的学在浙大：一个当前学期、一门课、三份作业（一份交过了），平台待办里只有没交的。 */
function client() {
  const homework = [
    { id: 101, title: "实验一", end_time: "2026-10-12T15:59:00Z", submitted: true, data: {} },
    { id: 102, title: "实验二", end_time: "2026-10-19T15:59:00Z", submitted: false, data: {} },
    { id: 103, title: "实验三", end_time: "2026-10-26T15:59:00Z", data: {} },
  ];
  return {
    json: async (route: string) => {
      if (route.startsWith("/api/todos")) return { todo_list: [{ id: 102, activity_id: 102, title: "实验二", type: "homework", course_id: 11, course_name: "数据结构基础", end_time: "2026-10-19T15:59:00Z" }] };
      if (route.startsWith("/api/my-semesters")) return { semesters: [{ id: 1, name: "2026-2027秋冬", is_active: true }] };
      throw new Error(`没有这个接口：${route}`);
    },
    all: async (route: string) => {
      if (route.startsWith("/api/my-courses")) return [{ id: 11, name: "数据结构基础" }];
      if (route === "/api/courses/11/homework-activities") return homework;
      throw new Error(`没有这个接口：${route}`);
    },
  };
}

test("todos lists only what is not handed in yet", async () => {
  const result = await getTodos(client() as never);
  assert.deepEqual(result.todos.map((row) => row.title), ["实验二", "实验三"]);
  assert.ok(result.todos.every((row) => !("done" in row)));
});

test("with done, handed-in homework is listed too and marked done", async () => {
  const result = await getTodos(client() as never, undefined, { done: true });
  assert.deepEqual(result.todos.map((row) => [row.title, "done" in row ? row.done : false]), [["实验一", true], ["实验二", false], ["实验三", false]]);
  assert.equal(result.todos[0]!.deadline, "2026-10-12 23:59");
});
