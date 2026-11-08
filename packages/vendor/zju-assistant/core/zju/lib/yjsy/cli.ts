import { command, type Command, type Flags } from "../core/command.ts";
import { openYjsy, timetable } from "./index.ts";

const text = (f: Flags, ...keys: string[]) => Object.fromEntries(keys.filter((k) => typeof f[k] === "string").map((k) => [k, f[k] as string]));

export function createYjsyCommands(open: typeof openYjsy = openYjsy): Record<string, Command> {
  return {
    timetable: command("研究生课表（研究生院的教务系统，本科教务网里没有）：每门课的教师、星期、节次、起止时间、地点、周次和每次课的日期；研究生和选了研究生课的本科生都用它", {
      year: { description: "学年，如 2026-2027；默认现在这个学年" },
      term: { description: "学期：秋、冬、春、夏，或整个大学期秋冬、春夏；默认现在这个大学期" },
    }, async (f) => { const y = await open(); try { return await timetable(y, text(f, "year", "term")); } finally { y.close(); } }),
  };
}

export const yjsyCommands = createYjsyCommands();
