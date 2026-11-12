/**
 * 教务网的选课写操作：**算参数 + 执行**两段。
 *
 * # 契约（与 `cc98` / `lab` / `sztz` 同一套）
 *
 * | 方法 | 做什么 | 会不会改变状态 |
 * | --- | --- | --- |
 * | `xxxPrepare(args)` | 查学期、找教学班、判重、算出一句说明 | 不会 |
 * | `xxxExecute(signal)` | `POST` 那个表单 | **会** |
 *
 * # 为什么这个文件的 Prepare 特别重
 *
 * 教务网的选课表单要六个字段（`xn` / `xq` / `nj` / `xkkh` / `tabname` / `xkzys`），
 * 其中三个只能从**服务端响应**里拿：
 *
 * - `xn` / `xq` —— 当前学年学期，从选课首页
 * - `tabname` —— 教学班所在页签，**只在教学班详情行里**
 * - `xkzys` —— 志愿数上限，从选课首页
 *
 * 所以 Prepare 必须真的跑一遍查询链。这正是「参数由 source 算」的价值：
 * 把这一串交给 tool 层，等于让它重写一遍选课逻辑。
 *
 * # 一处不能省的安全判断
 *
 * 补考选课（`jxbly === '2'` 或 `tabname === 'jxrwbview'`）**不属于常规志愿**。
 * 上游对此显式报错。本文件沿用 —— 若放它过去，提交的表单会被服务端拒绝，
 * 而报错文案只会说「参数错误」，用户看不出是选错了页签。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import { ZDBK_SELECTION_PATHS } from './hosts.js';
import { parseSelectionRow } from './selection.js';

/** 一次写操作的会话。执行后清空，避免重放。 */
class WriteSession {
  constructor() {
    this.prepared = null;
  }

  set(summarized, run) {
    this.prepared = { summarized, run };
    return summarized;
  }

  async run(signal) {
    if (!this.prepared) {
      throw new ClassroomError('NEED_PREPARE', '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。');
    }
    return this.prepared.run(signal);
  }

  clear() {
    this.prepared = null;
  }
}

/** 参数错误。 */
const invalid = (message) => new ClassroomError('INVALID_ARGUMENT', message);

/**
 * 补考选课不属于常规志愿操作。
 *
 * @param row - 教学班原始行。
 * @returns 是否补考。
 */
const remedial = (row) => String(row.jxbly) === '2' || row.tabname === 'jxrwbview';

/**
 * 把选课的写方法挂到 reader 上。
 *
 * @param reader - 已构造的 `ZdbkReader`（用到它的 `api` 与只读查询）。
 * @returns 写操作集合。
 */
export function createZdbkWrites(reader) {
  const api = reader.api;

  /**
   * 造一对 Prepare / Execute。
   *
   * @param name - 动作名（报错时用）。
   * @param build - `(args) => Promise<{ summarized, run }>`。
   * @returns `{ prepare, execute }`。
   */
  const pair = (name, build) => {
    const session = new WriteSession();
    return {
      prepare: async (args = {}) => {
        if (session.prepared) {
          throw new ClassroomError('WRITE_BUSY', `${name} 上一次还没执行完，先别重复准备。`, { action: name });
        }
        const { summarized, run } = await build(args);
        session.set(summarized, run);
        return summarized;
      },
      execute: async (signal) => {
        try {
          return await session.run(signal);
        } catch (error) {
          if (error instanceof ClassroomError && !error.details?.action) {
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

  /**
   * 在某个页签下把教学班查出来（**原始行**，含 Write 要用的 `tabname`）。
   *
   * # 三件事由本函数自己解决，不推给调用方
   *
   * `selectionSections` 需要 `course` / `pool` / `category` **三个**值，但它们
   * 都是**正方内部的概念**：`pool`（课程号）与 `category`（页签类别码）只能从
   * 一次课程列表查询里拿到。让模型去填它们等于让它猜。
   *
   * 所以这里接**自然输入**：
   *
   * | 调用方给 | 本函数做 |
   * | --- | --- |
   * | `pool` + `category` + `course`（全给） | 直接用（脚本/页面已经查过的情况） |
   * | 只给 `course`（课程号或课程名） | 按默认页签 `xk_1` 查课程列表，按 `code` 或 `name` 匹配出 `pool` |
   *
   * ⚠️ 上一版的工具只传 `{course, section}`，而这里要求 `pool` / `category` ——
   * 于是三个写动作**全部在 prepare 抛「需要 pool」**，选课季直接不可用。
   * 那不是工具的错：`pool`/`category` 本来就不该由模型提供。
   *
   * @param args - `{ course, pool?, category?, section?, search? }`。
   * @returns `{ context, sections }`，`sections` 是原始行。
   */
  const loadSections = async (args) => {
    const wanted = String(args.course ?? '').trim();
    if (!wanted) throw invalid('需要 course（课程号或课程名）');

    const context = await reader.selectionContextData();

    // `category` 缺省用 `xk_1`（常规选课的第一页签）。用户给了就照用。
    const category = String(args.category ?? '').trim() || 'xk_1';
    let course = String(args.pool ?? '').trim() || wanted;
    let pool = String(args.pool ?? '').trim();

    // 没给 pool 就自己去课程列表里找 —— 这是「source 算参数」的核心。
    if (!pool) {
      const listing = await reader.selectionCourses({ category });
      const rows = listing?.courses ?? [];
      const byCode = rows.filter((row) => row.code === wanted);
      const byName = rows.filter((row) => row.name === wanted);
      const loose = rows.filter((row) => String(row.name ?? '').includes(wanted));
      const hits = byCode.length ? byCode : (byName.length ? byName : loose);

      if (hits.length === 1) {
        course = hits[0].code;
        pool = hits[0].pool;
      } else if (!hits.length) {
        throw invalid(
          `页签 ${category} 下没有「${wanted}」这门课。`
          + '可用 selectionCourses 看这一页签里有哪些课；'
          + '若这门课在别的页签（如通识、体育），请一并给 category。',
        );
      } else {
        // 同名多门课（不同教师/不同课程号）不能猜 —— 猜错等于替用户选了别的课。
        throw invalid(
          `「${wanted}」匹配到 ${hits.length} 门课：`
          + `${hits.slice(0, 5).map((row) => `${row.name}（${row.code}）`).join('、')}…`
          + ' 请用课程号指定。',
        );
      }
    }

    const raw = await api.postArray(ZDBK_SELECTION_PATHS.sections, {
      form: {
        dl: category,
        xn: context.academic_year,
        xq: String(context.semester),
        kcdm: course,
        xkkh: pool,
        ylxs: context.study_length,
      },
    });
    const sections = raw.map((row) => parseSelectionRow(row, course));
    return { context, sections };
  };

  /**
   * 在一批已选志愿里定位一个教学班：优先按 `section`，其次按课程名。
   *
   * # 为什么课程名也要收
   *
   * 工具层对用户说的是「退掉这门课」，用户手里通常只有课程名，没有那串
   * `(2025-2026-1)-A-1-1`。先前只认 section，于是 `drop` / `reorder` 在
   * 工具传 `{course}` 时必抛 `需要 section` —— 模型只能去问用户要一个
   * 用户根本不知道的编号。
   *
   * 按课程名定位是**这个数据源的知识**（要知道志愿表里哪个字段是课程名），
   * 不该让每个调用方各查一遍。
   *
   * # 同名多志愿不猜
   *
   * 同一门课可能有第一、第二志愿两个教学班。那时按名字定位是**歧义**，
   * 要列出来让用户/模型用 section 指定 —— 猜错等于替他退错了班。
   *
   * @param choices - `selectionSelected` 的 choices。
   * @param args - `{ section?, course? }`。
   * @returns 命中的志愿行。
   */
  const findChoice = (choices, args) => {
    const section = String(args.section ?? '').trim();
    if (section) {
      const hit = choices.find((row) => String(row.section ?? '') === section);
      if (hit) return hit;
      throw invalid(`你没有教学班 ${section} 的志愿（用 selectionSelected 看真实班号）`);
    }

    const wanted = String(args.course ?? '').trim();
    if (!wanted) throw invalid('需要 section（教学班号）或 course（课程名）');

    const exact = choices.filter((row) => String(row.course ?? '').trim() === wanted);
    const partial = choices.filter((row) => String(row.course ?? '').includes(wanted));
    const hits = exact.length ? exact : partial;

    if (hits.length === 1) return hits[0];
    if (!hits.length) {
      throw invalid(`志愿表里没有「${wanted}」（用 selectionSelected 看已选课程）`);
    }
    throw invalid(
      `「${wanted}」有 ${hits.length} 个志愿：`
      + `${hits.slice(0, 5).map((row) => `${row.course}（${row.section}）`).join('、')}`
      + ' 请用 section 指定。',
    );
  };

  return {
    selectCourse: pair('zdbk.selectCourse', async (args) => {
      const section = String(args.section ?? '').trim();
      if (!section) throw invalid('需要 section（教学班号，来自 selectionSections 的 section）');

      const { context, sections } = await loadSections(args);
      const candidate = sections.find((row) => String(row.xkkh) === section);
      if (!candidate) {
        throw invalid(`课程池里没有教学班 ${section}（用 selectionSections 拿真实班号）`);
      }
      if (remedial(candidate)) {
        throw invalid('补考选课不属于常规志愿操作，请到教务网对应页面处理');
      }
      const tabname = String(candidate.tabname ?? '').trim();
      if (!tabname) {
        throw invalid('教学班响应里没有 tabname，无法提交选课（数据源与站点可能已漂移）');
      }

      // 同一个教学班已在志愿里就不重复提交 —— 平台会拒，且会打断用户的
      // 其它志愿操作。只对同一 xkkh 去重，同课的第二三志愿不受影响。
      const mine = await reader.selectionSelected({ with_credits: false });
      const exists = (mine.choices ?? []).find((row) => String(row.section ?? '') === section);
      const label = `${candidate.kcmc ?? args.course} 教学班 ${section}`;

      return {
        summarized: exists
          ? `已经选过：${label}（再提交一次平台会拒）`
          : `选课：${label}（${context.academic_year} 学年第 ${context.semester} 学期）`,
        run: () => api.post(ZDBK_SELECTION_PATHS.select, {
          form: {
            xn: context.academic_year,
            xq: String(context.semester),
            nj: context.grade ?? '',
            xkkh: section,
            tabname,
            xkzys: String(context.max_choices ?? ''),
          },
        }),
      };
    }),

    dropCourse: pair('zdbk.dropCourse', async (args) => {
      const mine = await reader.selectionSelected({ with_credits: false });
      const hit = findChoice(mine.choices ?? [], args);
      const section = String(hit.section);

      return {
        summarized: `退课：${hit.course ?? section}（教学班 ${section}）`,
        run: () => api.post(ZDBK_SELECTION_PATHS.drop, { form: { xkkh: section } }),
      };
    }),

    reorderCourse: pair('zdbk.reorderCourse', async (args) => {
      const order = Number(args.order);
      if (!Number.isInteger(order) || order < 1) throw invalid('需要正整数 order（目标志愿序号）');

      const mine = await reader.selectionSelected({ with_credits: false });
      const choices = mine.choices ?? [];
      const hit = findChoice(choices, args);
      const section = String(hit.section);

      // 排序必须提交**同一志愿组的完整顺序**，否则服务端会拒。
      // 这里是「把目标移到第 N 位」的语义：同组其它项保持相对顺序补位。
      const group = String(hit.group ?? hit.code ?? '');
      const members = choices.filter((row) => String(row.group ?? row.code ?? '') === group);
      if (members.length < 2) {
        throw invalid(`「${hit.course ?? section}」只有 1 个志愿，没有可调整的次序`);
      }
      const ordered = members.map((row) => String(row.section));
      const without = ordered.filter((item) => item !== section);
      if (order > ordered.length) throw invalid(`目标序号 ${order} 超过这一组的志愿数 ${ordered.length}`);
      without.splice(order - 1, 0, section);

      return {
        summarized: `调整志愿顺序：${hit.course ?? section} 移到第 ${order} 位（这一组共 ${ordered.length} 个志愿）`,
        run: () => api.post(ZDBK_SELECTION_PATHS.reorder, {
          form: {
            xkkhs: without.join(','),
            zypxs: without.map((_, index) => index + 1).join(','),
          },
        }),
      };
    }),
  };
}
