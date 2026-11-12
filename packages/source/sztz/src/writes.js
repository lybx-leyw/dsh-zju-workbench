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
 *
 * # 三个动作的**重发语义不一样**（这是本文件最容易看漏的一节）
 *
 * | 动作 | 平台接口 | 重发同一次请求的后果 |
 * | --- | --- | --- |
 * | `signupActivity` 报名 | `student/home/hdbm` | 平台拒绝（已报过）→ **幂等** |
 * | `cancelActivity` 取消报名 | `student/home/hdqxbm` | 平台拒绝（没报过）→ **幂等** |
 * | `setFavorite` 收藏 / 取消收藏 | `student/home/hdsc` | **把状态翻回去** → 有害 |
 *
 * `hdsc` 是**开关**：同一个 id 再发一次，收藏就变回未收藏。所以收藏这条走
 * `client.write()`（不重发），另两条走 `client.call()`（允许重发）。
 * 上游 `sztz/index.ts:297` 的注释说的是同一件事：「收藏是开关，重发会把状态翻回去」。
 *
 * 由此还推出收藏必须的一条判据：**状态已经符合时不提交**。否则「已经收藏过」
 * 会被真正发出去，把用户的收藏**取消**掉 —— 那不是没做成，是反着做了。
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
   * 取本人的某个列表（**原始记录**）。
   *
   * # 为什么必须是原始记录，而不是 `myActivities()` 的返回
   *
   * 两个入口都在真实客户端上，但形状不同：
   *
   * | 入口 | 返回 | 带 `id` 吗 |
   * | --- | --- | --- |
   * | `client.myList(action)` | 平台原始数组 | **带** |
   * | `client.myActivities()` | `{ signedUp, favorites, recognized, counts, note }`，细项经 `activityView` 转换 | **不带** |
   *
   * `activityView` 的对外形状里**故意没有 `id`**（那是给人看的视图，编号是内部
   * 坐标）。于是先前这里写 `(await client.myActivities()).some(row => row.id …)`
   * 在实机上必然 `TypeError` —— 它既拿错误的对象又读了不存在的字段。
   * 测试没抓到，是因为假客户端返回的是数组（详见 coverage-gaps 的 Y-13）。
   *
   * 所以这里认 `myList` 为准。没有 `myList` 的替身（`scripts/probe-write-contract.mjs`
   * 与更早的测试夹具）退回 `myActivities()`：返回数组就当成「报名列表」，
   * 返回对象就读它自己的字段名。**这条退路只为兼容替身**，不改变上面的结论。
   *
   * @param action - 0 报名的、1 收藏的、2 已认定的。
   * @returns 原始记录数组。
   */
  const mineList = async (action) => {
    if (typeof client.myList === 'function') return client.myList(action);
    const mine = await client.myActivities();
    if (Array.isArray(mine)) return mine; // 只有替身会给数组
    const key = { 0: 'signedUp', 1: 'favorites', 2: 'recognized' }[action];
    return mine?.[key] ?? [];
  };

  /**
   * 在一组记录里按名字 / 编号定位**唯一**一条；找到多个时不猜。
   *
   * 猜第一个会让用户操作错活动 —— 那比报错更糟，因为「取消收藏」也可能是
   * 另一条。所以宁可让用户补一个编号。
   *
   * @param rows - 候选记录（原始记录，带 `id` 与 `mc`）。
   * @param name - 活动名或编号。
   * @param options.see - 找不到时该去看哪个方法（写进提示里，让用户有下一步）。
   * @param options.missing - 覆盖「没找到」那句话（报名与收藏该去看的列表不同）。
   * @returns 命中的记录。
   */
  const uniqueIn = (rows, name, { see, missing }) => {
    const wanted = String(name ?? '').trim();
    if (!wanted) throw invalid('需要活动名或活动编号');

    const exact = rows.filter((row) => String(row.mc ?? '').trim() === wanted || String(row.id) === wanted);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) {
      throw invalid(`有 ${exact.length} 个活动都叫「${wanted}」，请用活动编号指定`);
    }
    // 退一步按包含匹配，但仍然要求唯一。
    const loose = rows.filter((row) => String(row.mc ?? '').includes(wanted));
    if (loose.length === 1) return loose[0];
    if (!loose.length) throw invalid(missing ?? `没找到「${wanted}」这个活动（用 ${see} 看真实名字）`);
    throw invalid(`「${wanted}」匹配到 ${loose.length} 个活动：${loose.slice(0, 3).map((row) => row.mc).join('、')}…请说得更具体`);
  };

  /**
   * 在「还没结束的活动」里找活动。
   *
   * @param name - 活动名（或 id）。
   * @returns 活动对象。
   */
  const findActivity = async (name) => uniqueIn(await client.unfinished(), name, { see: 'listActivities' });

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
      const mine = await mineList(0);
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
      const hit = uniqueIn(await mineList(0), wanted, {
        see: 'myActivities',
        missing: `你没报名「${wanted}」（用 myActivities 看已报名的活动）`,
      });

      return {
        summarized: `取消报名：${hit.mc ?? hit.id}`,
        run: () => client.call('POST', 'student/home/hdqxbm', { id: hit.id }),
      };
    }),

    /**
     * 收藏 / 取消收藏（`student/home/hdsc`，一个**开关**接口）。
     *
     * 两个方向各是一个独立的写会话：它们的参数、该查的列表（收藏列表 vs
     * 未结束活动）、以及「状态已经符合」的判据都不同。共用一个会话会让
     * 「准备收藏」被「准备取消收藏」撞成 `WRITE_BUSY`，而那是两件事。
     *
     * 两条路径共同的铁律写在这里，别各写一遍：
     *
     * 1. **状态已经符合时一个请求都不发**。收藏是开关，对已收藏的活动再发一次
     *    就是**取消收藏** —— 那不是没做成，是反着做了。上游
     *    `sztz/index.ts:358` 的 `setFavorite` 同样先读列表再判。
     * 2. **回查由调用方做**，本文件不在 `run` 里读一次收藏列表：多一次网络往返
     *    会把「到底发没发出去」和「发出去成没成」两件事混在一条错误里。
     *    `run` 返回的是平台信封，`code !== 0` 时如实抛平台给的原因。
     *
     * @param args.activity - 活动名或编号。
     * @param cancel - true 取消收藏、false 收藏。
     * @returns `{ summarized, run }`。
     */
    ...(() => {
      const build = (cancel) => async (args) => {
        const wanted = String(args.activity ?? '').trim();
        if (!wanted) throw invalid('需要活动名或活动编号');

        // 两个方向查的是**不同的列表**：取消收藏只能从收藏过的里面找；
        // 收藏从还没结束的活动里找（已结束的活动不再有意义，也不在活动中心里）。
        const rows = cancel
          ? await mineList(1)
          : await client.unfinished();
        const activity = uniqueIn(rows, wanted, cancel
          ? {
            see: 'myActivities',
            missing: `「${wanted}」不在你的收藏里（用 myActivities 看已收藏的活动）`,
          }
          : { see: 'listActivities' });
        const title = String(activity.mc ?? activity.id);

        // 判据不同：收藏看「已在收藏列表里」，取消看「不在收藏列表里」。
        // 只有取消这条需要多读一次收藏列表 —— 收藏那条刚从列表里查出来，
        // 但如果它来自 `unfinished()`，就还不知道收没收藏过。
        const favorites = cancel ? rows : await mineList(1);
        const isFavorite = favorites.some((row) => String(row.id) === String(activity.id));
        if (cancel ? !isFavorite : isFavorite) {
          // 状态已经符合：**不发请求**。开关接口发出去就是反向操作。
          return {
            summarized: cancel
              ? `「${title}」不在收藏里，无需取消收藏（没有提交）`
              : `「${title}」已经收藏过了，不必再收藏（没有提交）`,
            run: async () => ({ skipped: true, favorite: isFavorite, id: activity.id }),
          };
        }

        return {
          summarized: cancel ? `取消收藏：${title}` : `收藏二课活动：${title}`,
          run: async () => {
            // `write()` 不重发：这是开关，重发会把状态翻回去。
            const reply = await client.write('student/home/hdsc', { id: activity.id });
            if (reply?.code !== 0) {
              throw new SztzError(
                'REJECTED',
                `${cancel ? '取消收藏' : '收藏'}没有成功，素质拓展平台的答复：${reply?.msg ?? '平台没有说明原因'}`,
                { id: activity.id, code: reply?.code },
              );
            }
            return { ok: true, favorite: !cancel, id: activity.id };
          },
        };
      };

      return {
        favoriteActivity: pair('sztz.favoriteActivity', build(false)),
        unfavoriteActivity: pair('sztz.unfavoriteActivity', build(true)),
      };
    })(),
  };
}
