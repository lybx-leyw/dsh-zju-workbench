/**
 * 实验课平台的写操作：**算参数 + 执行**两段。
 *
 * # 两段式的理由（与 `cc98/writes.js` 同一个契约）
 *
 * | 方法 | 做什么 | 会不会改变状态 |
 * | --- | --- | --- |
 * | `xxxPrepare(args)` | 查学期、找班次、验周次、算出一句说明 | 不会 |
 * | `xxxExecute(signal)` | 发 POST | **会** |
 *
 * `packages/tool/campus-write` 先调 Prepare 让用户看说明，批准后再 Execute。
 *
 * # 这个平台的一个特点
 *
 * 选实验要三个 id 一起提交：`courseId`（课程）、`courseLabId`（班次）、
 * `selectWeek`（周次段）。三者都由**查询**得来 —— 所以 Prepare 阶段必须
 * 真的去查一遍，不能只做格式校验。这也是为什么写操作值得单独一个文件：
 * 它的前置查询比写请求本身复杂得多。
 */

import { LabError } from './lab.js';

/** 一次写操作的会话。执行后清空，避免重放。 */
class WriteSession {
  constructor() {
    /** @type {{ summarized: string, run: (signal?: AbortSignal) => Promise<unknown> } | null} */
    this.prepared = null;
  }

  set(summarized, run) {
    this.prepared = { summarized, run };
    return summarized;
  }

  async run(signal) {
    if (!this.prepared) {
      throw new LabError('NEED_PREPARE', '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。');
    }
    return this.prepared.run(signal);
  }

  clear() {
    this.prepared = null;
  }
}

/** 参数错误。 */
const invalid = (message) => new LabError('CONFIG', message);

/**
 * 把参数校验成正整数。
 *
 * @param value - 候选值。
 * @param name - 字段名。
 * @returns 数字。
 */
const id = (value, name) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw invalid(`${name} 必须是正整数`);
  return number;
};

/**
 * 造一对 Prepare / Execute。
 *
 * @param client - 已登录的 `LabCourse`。
 * @returns 写操作集合。
 */
export function createLabWrites(client) {
  /**
   * @param name - 动作名（报错时用）。
   * @param build - `(args) => Promise<{ summarized, run }>`。
   * @returns `{ prepare, execute }`。
   */
  const pair = (name, build) => {
    const session = new WriteSession();
    return {
      prepare: async (args = {}) => {
        if (session.prepared) {
          throw new LabError('WRITE_BUSY', `${name} 上一次还没执行完，先别重复准备。`, { action: name });
        }
        const { summarized, run } = await build(args);
        session.set(summarized, run);
        return summarized;
      },
      execute: async (signal) => {
        try {
          return await session.run(signal);
        } catch (error) {
          if (error instanceof LabError && !error.details?.action) {
            error.details = { ...(error.details ?? {}), action: name };
          }
          throw error;
        } finally {
          session.clear();
        }
      },
      cancel: async () => { session.clear(); },
    };
  };

  return {
    selectLab: pair('lab.selectLab', async (args) => {
      const course = id(args.course, '课程编号');
      const lab = id(args.lab, '班次编号');
      const week = String(args.week ?? '').trim();
      if (!week) throw invalid('需要 week（周次段，由班次的 weeks 给出）');

      // 查课程、班次、当前学期 —— 三者都要真的去查，不能只校验格式。
      const termId = await client.termId(args.term);
      const courses = await client.myCourses(termId);
      const hit = courses.find((item) => Number(item.id) === course);
      if (!hit) throw invalid(`这个学期没有编号 ${course} 的实验课`);

      const labs = await client.labs(course);
      const section = labs.find((item) => Number(item.id) === lab);
      if (!section) throw invalid(`课程「${hit.courseName ?? hit.name ?? course}」没有编号 ${lab} 的班次`);

      // 周次段必须是这个班次真的提供的之一 —— 猜一个会被平台拒，
      // 而那种拒绝的文案通常只说「参数错误」，用户看不出是周次写错了。
      const weeks = Array.isArray(section.weeks) ? section.weeks : [];
      if (weeks.length && !weeks.includes(week)) {
        throw invalid(`班次 ${lab} 的可选周次是 ${weeks.join(' / ')}，没有 ${week}`);
      }

      // 已经选过这个班次就不必再提交（平台会拒，但先判一下能省一次写请求）。
      const mine = await client.mySelections(termId);
      const already = mine.find((row) => Number(row.courseLabId) === lab && String(row.selectWeek ?? '') === week);
      const label = `${hit.courseName ?? hit.name ?? course} 班次 ${section.labName ?? lab} 第 ${week} 周`;

      return {
        summarized: already ? `已经选过：${label}（再提交一次平台会拒）` : `选实验：${label}`,
        run: (signal) => client.raw('/api/course/lab/students', {
          courseId: course,
          courseLabId: lab,
          uid: client.auth?.username,
          termId,
          selectWeek: week,
        }, 'POST', true).then((value) => ({ value, signal: Boolean(signal) })),
      };
    }),

    cancelLab: pair('lab.cancelLab', async (args) => {
      const record = id(args.record, '选课记录编号');

      const termId = await client.termId(args.term);
      const mine = await client.mySelections(termId);
      const hit = mine.find((row) => Number(row.id) === record);
      if (!hit) {
        throw invalid(`这个学期没有编号 ${record} 的已选记录（用 mySelections 看真实编号）`);
      }
      const label = `${hit.labName ?? hit.courseLabId} 第 ${hit.selectWeek ?? '?'} 周`;

      return {
        summarized: `退选实验：${label}`,
        run: () => client.raw(`/api/course/lab/students/del/${record}`, {}, 'POST', true),
      };
    }),
  };
}
