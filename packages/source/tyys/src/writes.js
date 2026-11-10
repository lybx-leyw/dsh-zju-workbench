/**
 * 体育场馆预约的写操作：**算参数 + 执行**两段。
 *
 * # 契约（与 `cc98` / `lab` / `sztz` / `zdbk` 同一套）
 *
 * | 方法 | 做什么 | 会不会改变状态 |
 * | --- | --- | --- |
 * | `xxxPrepare(args)` | 查场馆、查空场、预下单算费用 | 不会 |
 * | `xxxExecute(signal)` | 提交订单 | **会** |
 *
 * # 验证码：**能处理，但识别靠注入**
 *
 * 预下单返回 `captchaRequired: true` 时要过点字验证码。上游的做法是
 * **把题目和图交给用户自己选的多模态模型**（`captcha.ts`），不是本地识别器。
 *
 * 本仓照这个思路实现了 `captcha.js`（放大、拼题、解析坐标全是本仓的），
 * 但**模型调用由调用方注入** —— 因为上游那条管道绑在 ZJU-Omni 的应用壳里，
 * 而本仓的宿主是 DSH，那套壳不存在。
 *
 * 没注入求解器时**明确报错并说清怎么办**，不假装提交、也不编一个坐标上去。
 *
 * # 一处如实拒绝：抢场
 *
 * 上游注释写着「不做抢场」：没放号、没空场都直接返回，不等放号、不刷空场。
 * 本文件沿用 —— 抢场会让用户在不知情的情况下反复打请求，而那属于
 * 调用方（`tool` 或页面）该不该做的决定，不该由数据源默认做。
 */

import { CaptchaSolver } from './captcha.js';
import { TyysError, listOrders } from './tyys.js';

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
      throw new TyysError('NEED_PREPARE', '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。');
    }
    return this.prepared.run(signal);
  }

  clear() {
    this.prepared = null;
  }
}

/** 参数错误。 */
const invalid = (message) => new TyysError('CONFIG', message);

/**
 * 把场馆预约的写方法挂上去。
 *
 * @param client - 已登录的 `Tyys` 实例。
 * @returns 写操作集合。
 */
export function createTyysWrites(client) {
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
          throw new TyysError('WRITE_BUSY', `${name} 上一次还没执行完，先别重复准备。`, { action: name });
        }
        const { summarized, run } = await build(args);
        session.set(summarized, run);
        return summarized;
      },
      execute: async (signal) => {
        try {
          return await session.run(signal);
        } catch (error) {
          if (error instanceof TyysError && !error.details?.action) {
            error.details = { ...(error.details ?? {}), action: name };
          }
          throw error;
        } finally {
          session.clear();
        }
      },
    };
  };

  return {
    bookVenue: pair('tyys.bookVenue', async (args) => {
      const site = String(args.venue ?? '').trim();
      const date = String(args.date ?? '').trim();
      const start = String(args.start ?? '').trim();
      const end = String(args.end ?? '').trim();
      if (!site) throw invalid('需要 venue（场地编号，来自场馆查询）');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw invalid('date 要写成 YYYY-MM-DD');
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) throw invalid('start / end 要写成 HH:MM');

      // 1) 这一天的空场（只读）。
      const day = await client.day(site, date);
      if (!day?.open) {
        // 不做抢场：没放号就如实说「还没放号」，而不是等或刷。
        throw invalid(`${date} 还没发布时段（本包不等放号，到时再约）`);
      }

      const slots = Array.isArray(day.slots) ? day.slots : [];
      const wanted = slots.filter((slot) => slot.start >= start && slot.end <= end);
      if (!wanted.length) throw invalid(`${date} ${start}-${end} 没有可用时段（用场馆查询看真实时段）`);
      const taken = wanted.filter((slot) => slot.status !== 1);
      if (taken.length) {
        throw invalid(`${date} ${start}-${end} 已经有约满的时段（${taken.map((s) => `${s.start}-${s.end}`).join('、')}）`);
      }
      if (!day.token || !day.weekStart) throw new TyysError('SHAPE', '时段响应里缺少提交凭据（token / weekStart），无法下单');

      // 2) 预下单（只读）：拿电话、判要不要验证码、看同伴要求。
      const preview = await client.preview({
        venueSiteId: site,
        date,
        weekStartDate: day.weekStart,
        slots: wanted,
        token: day.token,
      });

      // 需要验证码就走 `captcha.js`。求解器由调用方注入（`args.solver`）——
      // 没注入时 `CaptchaSolver.start()` 会报 `DEPENDENCY_MISSING` 并说清原因，
      // 而不是让「没有模型可用」看起来像「这道题没认出来」。
      let verification;
      if (preview.captchaRequired) {
        const solver = args.solver ?? new CaptchaSolver();
        await solver.start();
        // 取题目与图：这一步是只读（`captcha/check` 在 READ_POSTS 里）。
        const challenge = await client.request('POST', '/api/reservation/captcha/check', {
          venueSiteId: site,
          reservationDate: date,
        });
        const words = Array.isArray(challenge?.words) ? challenge.words : [];
        if (!words.length || !challenge?.image) {
          throw new TyysError('SHAPE', '验证码响应里缺少题面或图片，无法作答。', { venue: site, date });
        }
        const points = await solver.solve(challenge.image, words);
        if (!points) {
          // 一道题没认齐是正常情况：换一道。但不无限重试 —— 那会把用户的
          // 预约窗口耗在一次验证码上。
          throw new TyysError(
            'CAPTCHA_RETRY',
            '这道验证码没认齐（模型对题目里的字没有各认出正好一个），请重试一次换一道题。',
            { venue: site, date },
          );
        }
        verification = points;
      }
      if (!preview.phone) {
        throw invalid('预约账号上没有登记联系电话，请先在场馆平台补齐（否则订单会被拒）');
      }
      // 需要同伴的场地（网球/羽毛球双打之类）要另给同伴参数。
      // **这条尚未实现**（不是裁决）：上游走 `vip/view/buddy_no` 查同伴再填。
      // 已记进 `coverage-gaps.md` 的待补清单。
      if (preview.buddyMin > 0) {
        throw new TyysError(
          'NOT_IMPLEMENTED',
          `这个场地要求至少 ${preview.buddyMin} 名同伴，本仓还没实现代填同伴信息。`,
          { venue: site, date, buddyMin: preview.buddyMin },
        );
      }

      const fee = wanted.reduce((sum, slot) => sum + (Number(slot.fee) || 0), 0);
      return {
        summarized: `预约场馆：${site} ${date} ${start}-${end}（${wanted.length} 个时段，费用约 ${fee} 元）`,
        run: (signal) => client.request('POST', '/api/reservation/order/submit', {
          venueSiteId: site,
          reservationDate: date,
          weekStartDate: day.weekStart,
          reservationOrderJson: JSON.stringify(wanted.map((slot) => ({
            spaceId: slot.spaceId, timeId: slot.timeId, venueSpaceGroupId: null,
          }))),
          schoolType: 1,
          token: day.token,
          phone: preview.phone,
          ...(verification ? { captchaVerification: JSON.stringify(verification) } : {}),
          isOfflineTicket: 1,
        }, signal),
      };
    }),

    cancelVenue: pair('tyys.cancelVenue', async (args) => {
      const order = String(args.order ?? '').trim();
      if (!order) throw invalid('需要 order（订单号，来自「我的订单」tyys.orders）');

      // 取消前先核对这笔订单真的存在 —— 否则「单号写错」会表现为「取消失败」，
      // 而两者原因完全不同，用户会以为是平台挂了。
      //
      // `listOrders` 是模块级函数（不是 client 上的方法），与只读侧同一份实现。
      const list = await listOrders(client, {});
      const hit = (list?.orders ?? []).find((row) => String(row.number) === order || String(row.id) === order);
      if (!hit) {
        throw invalid(`没找到订单 ${order}（用 tyys.orders 看真实单号）`);
      }

      const label = [hit.venue, hit.date, hit.start && hit.end ? `${hit.start}-${hit.end}` : '']
        .filter(Boolean).join(' ');
      return {
        summarized: `取消场馆预约：${label || order}`,
        run: () => client.request('POST', '/api/venue/finances/order/cancel', { orderId: hit.id ?? order }),
      };
    }),
  };
}
