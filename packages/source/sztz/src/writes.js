/**
 * 素质拓展平台的写操作：**算参数 + 执行**两段。
 *
 * # 契约（与 `cc98/writes.js`、`lab/writes.js` 同一套）
 *
 * | 方法 | 做什么 | 会不会改变状态 |
 * | --- | --- | --- |
 * | `xxxPrepare(args)` | 找活动、判能不能报、算出一句说明 | 不会 |
 * | `xxxExecute(signal)` | `POST` 那个动作 | **会** |
 *
 * # 这个平台的两个特点
 *
 * 1. **写请求就是 GET 风格的路径 + 活动 id**（`student/home/hdbm` 之类）。
 *    看起来像读取，实际改变状态 —— 所以不能按「是不是 GET」判读写的。
 * 2. **有些活动不在平台报名**（`bmfs` 写着线下报名）。那种要如实说「去哪报」，
 *    而不是替用户提交一个必然失败的请求。
 */

import { SztzError } from './sztz.js';

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
      throw new SztzError('NEED_PREPARE', '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。');
    }
    return this.prepared.run(signal);
  }

  clear() {
    this.prepared = null;
  }
}

/** 参数错误。 */
const invalid = (message) => new SztzError('CONFIG', message);

/**
 * 造一对 Prepare / Execute。
 *
 * @param client - 已登录的 `Sztz` 实例。
 * @returns 写操作集合。
 */
export function createSztzWrites(client) {
  /**
   * 按名字找活动；找到多个时**不猜**。
   *
   * 猜第一个会让用户报错活动 —— 那比报错更糟，因为「取消报名」也可能选错。
   *
   * @param name - 活动名（或 id）。
   * @returns 活动对象。
   */
  const findActivity = async (name) => {
    const wanted = String(name ?? '').trim();
    if (!wanted) throw invalid('需要活动名或活动编号');

    const all = await client.unfinished();
    const exact = all.filter((row) => String(row.mc ?? '').trim() === wanted || String(row.id) === wanted);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
      throw invalid(`有 ${exact.length} 个活动都叫「${wanted}」，请用活动编号指定`);
    }
    // 退一步按包含匹配，但仍然要求唯一。
    const loose = all.filter((row) => String(row.mc ?? '').includes(wanted));
    if (loose.length === 1) return loose[0];
    if (!loose.length) throw invalid(`没找到「${wanted}」这个活动（用 listActivities 看真实名字）`);
    throw invalid(`「${wanted}」匹配到 ${loose.length} 个活动：${loose.slice(0, 3).map((row) => row.mc).join('、')}…请说得更具体`);
  };

  const pair = (name, build) => {
    const session = new WriteSession();
    return {
      prepare: async (args = {}) => {
        if (session.prepared) {
          throw new SztzError('WRITE_BUSY', `${name} 上一次还没执行完，先别重复准备。`, { action: name });
        }
        const { summarized, run } = await build(args);
        session.set(summarized, run);
        return summarized;
      },
      execute: async (signal) => {
        try {
          return await session.run(signal);
        } catch (error) {
          if (error instanceof SztzError && !error.details?.action) {
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
    signupActivity: pair('sztz.signupActivity', async (args) => {
      const activity = await findActivity(args.activity);
      const title = String(activity.mc ?? activity.id);

      // 不在平台报名的活动：如实说去哪报，不替用户提交一个必然失败的请求。
      const way = String(activity.bmfs?.label ?? activity.bmfs ?? '');
      if (way && !/平台|系统|线上/.test(way)) {
        const how = String(activity.jtbmfs ?? '').trim();
        throw invalid(`「${title}」不在本平台报名，要按活动写明的方式报：${how || way}`);
      }

      // 已经报过就不必再提交（平台会拒，但先判一下能省一次写请求）。
      const mine = await client.myActivities();
      if (mine.some((row) => String(row.id) === String(activity.id))) {
        return {
          summarized: `已经报过名：${title}（再提交一次平台会拒）`,
          run: () => client.call('POST', 'student/home/hdbm', { id: activity.id }),
        };
      }

      return {
        summarized: `报名二课活动：${title}`,
        run: () => client.call('POST', 'student/home/hdbm', { id: activity.id }),
      };
    }),

    cancelActivity: pair('sztz.cancelActivity', async (args) => {
      const wanted = String(args.activity ?? '').trim();
      if (!wanted) throw invalid('需要活动名或活动编号');

      // 取消要从**已报名**里找，不是从未报名里找 —— 两个集合不重叠。
      const mine = await client.myActivities();
      const hit = mine.find((row) => String(row.mc ?? '').trim() === wanted || String(row.id) === wanted)
        ?? mine.find((row) => String(row.mc ?? '').includes(wanted));
      if (!hit) throw invalid(`你没报名「${wanted}」（用 myActivities 看已报名的活动）`);

      return {
        summarized: `取消报名：${hit.mc ?? hit.id}`,
        run: () => client.call('POST', 'student/home/hdqxbm', { id: hit.id }),
      };
    }),
  };
}
