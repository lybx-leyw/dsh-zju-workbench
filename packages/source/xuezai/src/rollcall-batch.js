/**
 * 学在浙大**批量签到**（上游 `xuezai rollcall all`，coverage-gaps 的 W-5）。
 *
 * # 这个文件存在的理由，以及它和 `writes.js` 的分工
 *
 * `writes.js` 的 `rollcall` 是**单次**语义：调用方给出**一个**点名（id 或课程名），
 * 它应答那一个然后结束。上游的 `rollcall all` 是**另一件事** —— 它自己去看
 * 「现在有哪些点名没签」，然后逐个签。
 *
 * ⚠️ **这两者不是同一个动作，不能靠给 `rollcall` 加个默认参数就当成做了。**
 * 判据很清楚：
 *
 * | | 本仓 `rollcall`（单次） | 上游 `rollcall all`（批量） |
 * | --- | --- | --- |
 * | 谁决定签哪个 | **调用方**给出 id / 课程名 | **它自己**列出待签 |
 * | 数量 | 1 个 | 0..N 个（每次看到几个就签几个） |
 * | 时间形态 | 一次应答，可能试 13 个参考点 | 可以**反复扫**（每轮重新看有没有新的） |
 *
 * 把它「简化」成给 `rollcall` 传个空参数的后果是：看起来有批量能力，实际
 * 只签得到调用方点名的那一个 —— 而那正是用户在紧急场景（点名窗口几分钟）里
 * 最需要它自己找的时候。所以这个区分必须留在代码里。
 *
 * # 为什么不改 `writes.js`
 *
 * 单点应答的协议（13 个参考点、数字口令走另一个端点）**一行都不用重写** ——
 * 本文件把 `writes.js` 的 `rollcall` 那一对 `prepare` / `execute` 当成「一次
 * 应答动作」直接复用（见 `answerOne`）。批量逻辑（列表、多轮、并发两路）
 * 才是新东西，全在这里。
 *
 * # 关于 `radarRollcalls` 为什么在这而不是 `xzzd.js`
 *
 * `GET /api/radar/rollcalls` 是「当前有哪些点名」的唯一来源，本仓此前**没有实现**
 * （`xzzd-reads.js` 的 `rollcallHistory` 是**历史记录**，不是当前点名）。
 * 按分层它其实该进 `xzzd.js`（客户端方法）或 `xzzd-reads.js`（读方法）。
 *
 * 本轮放进这里是一个**临时取舍**，原因是 `xuezai/src/index.js` 与 `xzzd-reads.js`
 * 当时由另一条编辑线在改（下载）。放在新文件里可以零冲突落地，代价是
 * **将来若要合并，得知道有这份实现**：合并时把它挪进 `xzzd.js` 作为
 * `XzzdApi.radarRollcalls()`，然后本文件改成转调即可 —— 签名（
 * `(reader, { signal }) => rows`）是照那个目标写的。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

import { XZZD_BASE } from './hosts.js';
import { createXuezaiWrites } from './writes.js';

/**
 * 点名应答算不算签上了。
 *
 * 与 `writes.js` 里的同名判据**口径必须一致**：上游 `rollcall.ts` 判 `status` 或
 * `status_name` 是 `on_call` / `on_call_fine`。这里不能只看 HTTP 200 ——
 * 平台对「位置不对」也回 200。
 *
 * 复制一份（而不是从 `writes.js` 导出）是因为那个文件不能改；两处判据一旦
 * 漂移，表现是「批量说签上了、单次说没签上」。若将来能改 `writes.js`，
 * 应当只留一份并从这里 import。
 *
 * @param row - 点名行或应答体。
 * @returns 是否已签。
 */
export const answered = (row) => [row?.status, row?.status_name]
  .some((value) => value === 'on_call' || value === 'on_call_fine');

/**
 * 点名的人话名字（课程名优先，退到标题，再退到编号）。
 *
 * @param row - 点名行。
 * @returns 名字。
 */
const nameOf = (row) => String(row?.course_title ?? row?.title ?? `点名 ${row?.rollcall_id ?? '?'}`).trim();

/**
 * 列出**当前**的点名。
 *
 * # 为什么需要它（这是 W-5 真正的前置）
 *
 * 上游 `signin` 每轮先 `GET /api/radar/rollcalls`，才知道这一轮有没有点名、
 * 哪些还没签。没有这个端点，「批量签到」根本无从知道该签什么 —— 那不是
 * 「组合器没写」，是**缺一个读**。
 *
 * # 形状
 *
 * `{ rollcalls: [...] }`，每行至少带 `rollcall_id`、`is_radar` / `is_number`、
 * `status` / `status_name`，以及 `course_title` / `title` 之一。
 *
 * # 为什么用 `reader.json()`
 *
 * 它已经处理了会话失效（`SESSION_EXPIRED`）、登录页 HTML、非 JSON 响应这些
 * 判定。自己 `transport.request` 一遍等于把那套判据抄第二次，两处迟早漂。
 *
 * @param reader - `XzzdApi`（或测试替身，只要有 `json`）。
 * @param options.signal - 中止信号。
 * @returns 点名行数组。
 * @throws {ClassroomError} 响应缺少 `rollcalls` 数组时。
 */
export async function radarRollcalls(reader, { signal } = {}) {
  const data = await reader.json(`${XZZD_BASE}/api/radar/rollcalls`, { signal });
  if (!Array.isArray(data?.rollcalls)) {
    throw new ClassroomError('API_SHAPE', '当前点名响应缺少 rollcalls 数组，不能据此判断有没有点名。');
  }
  return data.rollcalls;
}

/**
 * 「数字点名」这一路的默认执行器：**如实报它现在做不了**。
 *
 * # 为什么不假装做了
 *
 * 数字点名要的是**四位码**，而码在课堂字幕里。取字幕在本仓是另一条链路
 * （`campus_classroom_read` 的 `liveText`），把它接进签到属于跨包装配，
 * 不在 W-5 这一步的范围内。
 *
 * # 为什么不干脆不实现这一路
 *
 * 因为「**有数字点名在等，但没人知道**」比「知道它签不了」糟得多：用户会以为
 * 批量签到已经把一切都处理了。所以这一路保留着，并且**明确回报**它跳过了
 * 什么、为什么跳。
 *
 * 注入点与上游一致（`executors.number`）：将来接上字幕，把
 * `createRollcallBatch` 的 `executors.number` 换掉即可，组合逻辑不用改。
 *
 * @param options.rows - 本轮看到的数字点名。
 * @returns `{ status: 'not-signed', message, signed: [] }`。
 */
export async function numberUnavailable({ rows = [] } = {}) {
  const names = rows.map(nameOf);
  return {
    status: 'not-signed',
    message: names.length
      ? `数字点名签不了：${names.join('、')} 需要课堂字幕里的四位码，本仓还没接字幕（W-5 的剩余部分）。`
      : '本轮没有数字点名。',
    signed: [],
  };
}

/**
 * 跑两条执行路（radar / number），共用同一个中止信号。
 *
 * # 为什么是并发而不是「先试 A 再试 B」
 *
 * 点名窗口只有几分钟。串行跑两路等于把窗口耗在等待上，而两路处理的是
 * **不同种类**的点名（互不冲突），没有必须串行的理由。
 *
 * # `stopAtFirst` 是上游的语义，但**不是默认**
 *
 * 上游 `rollcall-all.ts` 的做法是「任一路确认成功 → `stop.abort()` 另一路」。
 * 那对「通常只有一个点名」的场景是对的，但它会**中断另一路还没签完的工作**：
 * 若此刻同时有 3 个雷达点名和一个数字点名，停早了就漏签。
 *
 * 所以本仓默认 `stopAtFirst: false`（**签完所有待签**），把「先签上者停」
 * 留成一个可选项。这个差异是**有意的**，理由写在上面 —— 默认值要服务
 * 「一次签全部待签」这个用户能理解的说法。
 *
 * @param lanes - `[{ kind, run(signal) }]`。
 * @param options.signal - 调用方的中止信号。
 * @param options.stopAtFirst - 任一路成功后是否停掉另一路。
 * @returns `{ outcomes, winner }`。
 */
async function runLanes(lanes, { signal, stopAtFirst = false } = {}) {
  /** 内部的停止开关：`stopAtFirst` 命中或外部中止时打开。 */
  const stop = new AbortController();
  const merged = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;

  let winner = null;
  const noteSuccess = (kind, result) => {
    if (!winner) winner = { kind, result };
    // 只有 opt-in 了才停兄弟路。默认不停 —— 停早了会漏签。
    if (stopAtFirst) stop.abort();
  };

  const outcomes = await Promise.all(lanes.map(async ({ kind, run }) => {
    try {
      const result = await run(merged, (value) => noteSuccess(kind, value));
      return { kind, ...result };
    } catch (error) {
      // 一路出错不该拖垮另一路（上游同款）：把它当成这一路的结果。
      // 但**外部中止**要原样抛出去 —— 那是用户的操作，不是一路的失败。
      if (signal?.aborted) throw error;
      return {
        kind,
        status: 'not-signed',
        message: error instanceof Error ? error.message : String(error),
        signed: [],
      };
    }
  }));

  return { outcomes, winner };
}

/** 一次的应答计数。 */
const emptyTally = () => ({ signed: [], already: [], pending: [], failures: [] });

/**
 * 造一对 Prepare / Execute：批量签到。
 *
 * 形状与 `writes.js` 的其它写动作**完全一致**（`prepare` / `execute` / `cancel`），
 * 因为工具层用 `contractOf()` 取这三个方法 —— 少一个 `cancel` 的后果不是
 * 「少个功能」，是「审批被拒后这个动作永久不可用（WRITE_BUSY）」。
 *
 * @param reader - `XzzdApi` 实例。
 * @param options.rollcall - 单点应答的那一对（默认从 `writes.js` 取）。
 * @param options.executors - 覆盖执行器（`{ radar, number }`），测试或将来接字幕时用。
 * @param options.now - 取当前时间（测试注入）。
 * @param options.wait - 两轮之间等多久（测试注入，避免真 sleep）。
 * @returns `{ prepare, execute, cancel }`。
 */
export function createRollcallBatch(reader, options = {}) {
  /**
   * 单点应答。**默认复用 `writes.js` 的 `rollcall`** —— 协议不重写。
   *
   * 它接受一个「活动对象」作为入参（`{ id, title }` 就够），所以不必先去
   * 待办表里查：雷达点名的 id 未必出现在待办里，而 `resolveActivity` 对
   * 对象的处理正是「有 id 就直接用」。
   */
  const answer = options.rollcall ?? createXuezaiWrites(reader).rollcall;
  const now = options.now ?? (() => Date.now());
  const wait = options.wait ?? ((ms, signal) => sleep(ms, signal));

  /** 一次写会话。与其它写动作同一套：执行后清空，避免重放。 */
  let prepared = null;

  /**
   * 一轮：列一次点名，把**所有还没签的**逐个签掉。
   *
   * 取 `executors` 的方式照上游：一个 kind 一个执行器，`radar` 与 `number`
   * 各管自己那批（它们处理的是**不同种类**的点名，不抢同一个）。
   *
   * @param options.signal - 中止信号。
   * @param options.stopAtFirst - 见 `runLanes`。
   * @returns 这一轮的汇总。
   */
  const sweep = async ({ signal, stopAtFirst, executors, waitMs, only }) => {
    const rows = await radarRollcalls(reader, { signal });
    // 两类点名按平台的布尔字段分派。`is_radar !== false` 是**故意宽松**的：
    // 平台对雷达点名不一定回 `is_radar: true`（有的只给 `is_number: false`），
    // 严格相等会把绝大多数点名漏掉。
    const radarRows = rows.filter((row) => row?.is_number !== true && row?.is_radar !== false);
    const numberRows = rows.filter((row) => row?.is_number === true);

    /**
     * `course` 筛选必须在这里生效，**不能只用于 Prepare 的说明文案**。
     *
     * 这是一处真出过的 bug：Prepare 按课程筛了、写在审批框上（「只签数据结构」），
     * 而 Execute 里的 `sweep` 没拿到筛选条件，于是把**全部**待签的都签了 ——
     * 用户在审批框上看到的和实际发生的不是一回事。审批的意义就在这两者一致。
     */
    const keep = (row) => (only ? nameOf(row).includes(only) : true);
    const radar = radarRows.filter(keep);
    const number = numberRows.filter(keep);
    // 「已签过」按**全部**点名算（不筛）：筛选只决定签哪些，不决定报哪些现状。
    const already = [...radarRows, ...numberRows].filter((row) => answered(row)).map(nameOf);
    const pendingRadar = radar.filter((row) => !answered(row));
    const pendingNumber = number.filter((row) => !answered(row));

    // 两路并发。`radar` 与 `number` 处理的是**互不重叠**的点名集合。
    const lanes = [];
    if (pendingRadar.length) {
      lanes.push({
        kind: 'radar',
        run: async (laneSignal, onSuccess) => executors.radar({
          rows: pendingRadar,
          answer,
          signal: laneSignal,
          onSuccess,
        }),
      });
    }
    if (pendingNumber.length) {
      lanes.push({
        kind: 'number',
        run: async (laneSignal, onSuccess) => executors.number({
          rows: pendingNumber,
          signal: laneSignal,
          onSuccess,
          // 数字那一路行不行，交给执行器自己判（默认那一路会如实说不行）。
        }),
      });
    }

    if (!lanes.length) {
      return {
        seen: rows.length, signed: [], already, failures: [], outcomes: [],
        pending: [], waitMs,
      };
    }

    const { outcomes /* winner 见 stopAtFirst 说明 */ } = await runLanes(lanes, { signal, stopAtFirst });
    const signed = outcomes.flatMap((outcome) => outcome.signed ?? []);
    const failures = outcomes.flatMap((outcome) => outcome.failures ?? []);
    // 待签里既没签上、也没进 failures 的（比如数字那一路整体拒绝）——
    // 如实列出来，别让用户以为「没提就是没这回事」。
    const accounted = new Set([...signed, ...failures.map((one) => one.name)]);
    const pending = [...pendingRadar, ...pendingNumber]
      .map(nameOf)
      .filter((name) => !accounted.has(name));

    return { seen: rows.length, signed, already, failures, outcomes, pending, waitMs };
  };

  return {
    /**
     * 算参数与说明。**不发写请求** —— 只列一次当前点名（纯 GET）。
     *
     * 说明里要**逐个列出会签哪些**：用户批准的是「签这几个」，
     * 不是「某个动作」。审批框上只写「批量签到」等于没写。
     *
     * @param args.passes - 扫几轮（默认 1 = 一次扫完）。要盯一段时间就给大一点。
     * @param args.waitMs - 两轮之间等多久，默认 4000ms（上游同款）。
     */
    prepare: async (args = {}) => {
      if (prepared) {
        throw new ClassroomError('WRITE_BUSY', 'xuezai.rollcallAll 上一次还没执行完，先别重复准备。', { action: 'xuezai.rollcallAll' });
      }

      const passes = Number(args.passes ?? 1);
      if (!Number.isSafeInteger(passes) || passes < 1 || passes > 600) {
        throw invalid('passes 要是 1 到 600 之间的整数');
      }
      const waitMs = Number(args.waitMs ?? 4000);
      if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > 300_000) {
        throw invalid('waitMs 要在 0 到 300000 毫秒之间');
      }
      if (args.course !== undefined && args.course !== null && String(args.course).trim() === '') {
        throw invalid('course 给了就不能是空串（不给表示签全部）');
      }

      // 只读一次列表，让用户在批准前看清「这次会签哪些」。
      const rows = await radarRollcalls(reader);
      const radarRows = rows.filter((row) => row?.is_radar !== false && !row?.is_number);
      const numberRows = rows.filter((row) => row?.is_number === true);
      const pending = [...radarRows, ...numberRows].filter((row) => !answered(row));
      const already = [...radarRows, ...numberRows].filter((row) => answered(row)).map(nameOf);

      const target = String(args.course ?? '').trim();
      const wanted = target
        ? pending.filter((row) => nameOf(row).includes(target))
        : pending;
      const names = wanted.map(nameOf);

      const summary = names.length
        ? `批量签到（可能一次签多个点名）：${names.join('、')}`
          + `。共 ${names.length} 个待签${target ? `（按课程「${target}」筛过）` : ''}`
          + `${already.length ? `；已签过的 ${already.length} 个不动` : ''}`
        : `批量签到：当前没有待签的点名（看了 ${rows.length} 个）`;

      prepared = {
        summarized: summary,
        run: async (signal) => {
          /**
           * 多轮扫描：每轮**重新读一次点名列表**。
           *
           * 为什么要多轮而不是一次：点名是**陆续发起**的（老师上课时点一次、
           * 下课前可能再点一次）。上游的 `duration` 就是这个意思 —— 盯一段时间，
           * 期间出现了就签。
           *
           * 循环里没有任何「已经问过了就跳过」的短路：`sweep` 每轮都重新读列表，
           * 所以新出现的点名一定会被看到。已签过的由 `answered(row)` 过滤掉，
           * 不会重复提交。
           */
          const runs = [];
          let result = null;
          for (let pass = 1; pass <= passes; pass += 1) {
            signal?.throwIfAborted();
            result = await sweep({
              signal,
              stopAtFirst: args.stopAtFirst === true,
              executors: { radar: options.executors?.radar ?? answerRadar, number: options.executors?.number ?? numberUnavailable },
              waitMs,
              // 筛选条件必须传下去，否则 Execute 会签掉审批框上没写的那些。
              only: String(args.course ?? '').trim() || undefined,
            });
            runs.push(result);
            if (pass < passes) await wait(waitMs, signal);
          }
          return summarize(result, { passes, runs });
        },
      };

      return summary;
    },

    /** 发请求（`passes` 轮）。 */
    execute: async (signal) => {
      if (!prepared) {
        throw new ClassroomError('NEED_PREPARE', '写操作必须先 Prepare 再 Execute —— 参数还没算出来，不能直接发请求。');
      }
      try {
        return await prepared.run(signal);
      } finally {
        prepared = null;
      }
    },

    /**
     * 撤销待执行的那一轮。
     *
     * 审批被拒 / 超时 / 中止时工具层会调它。**没有它，这个动作此后一直
     * `WRITE_BUSY`，直到重启进程** —— 拒绝不等于封锁。
     */
    cancel: async () => { prepared = null; },
  };
}

/**
 * 把多轮的结果翻成一句人话。
 *
 * # 为什么要把**所有轮**合起来，而不是只看最后一轮
 *
 * 点名是陆续出现的：第 1 轮签上了「数据结构」，第 2 轮只剩一个已签过的。
 * 只看最后一轮的话，用户会看到「1 个之前就签过」—— 他刚签上的那个不见了，
 * 于是一定会再点一次，而那次会白签（已签的不会再提交）。
 *
 * # 为什么要跨轮**去重**
 *
 * 同一条点名会在多轮里被反复看到（签上之后进 `already`）。直接拼会得到
 * 「已签 2 个：数据结构；1 个之前就签过」这种自相矛盾的话。
 * 所以 `signed` 按名字去重，`already` 里扣掉签上的那些。
 *
 * @param result - 最后一轮的 `sweep()` 返回（给出 `seen` 与最终的 `pending`）。
 * @param options.passes - 扫了几轮。
 * @param options.runs - 每轮的返回（用于跨轮合并）。
 * @returns 一句话。
 */
function summarize(result, { passes = 1, runs = [] } = {}) {
  const all = runs.length ? runs : (result ? [result] : []);
  if (!all.length) return '批量签到：没有执行。';

  const signed = [...new Set(all.flatMap((run) => run.signed ?? []))];
  const signedSet = new Set(signed);
  const already = [...new Set(all.flatMap((run) => run.already ?? []))].filter((name) => !signedSet.has(name));

  // 失败取**最后一次**的：前几轮失败、最后一轮成功的，不该还报失败。
  const last = all.at(-1) ?? {};
  const failures = (last.failures ?? []).filter((one) => !signedSet.has(one.name));

  const parts = [];
  if (signed.length) parts.push(`已签 ${signed.length} 个：${signed.join('、')}`);
  if (already.length) parts.push(`${already.length} 个之前就签过`);
  // 数字那一路自己会说清它跳过了什么、为什么 —— 原样转述，不在这里编。
  for (const outcome of last.outcomes ?? []) {
    if (outcome.kind === 'number' && outcome.status === 'not-signed' && outcome.message) {
      parts.push(outcome.message);
    }
  }
  if (failures.length) {
    parts.push(`${failures.length} 个没签上：${failures.map((one) => `${one.name}（${one.reason}）`).join('；')}`);
  }
  // 「还没处理」的要如实说：不说的话用户会以为已经签完了。
  if (last.pending?.length) {
    parts.push(`${last.pending.length} 个还没处理：${last.pending.join('、')}`);
  }
  if (!parts.length) parts.push(`看了 ${last.seen ?? 0} 个点名，没有待签的`);

  const tail = passes > 1 ? `（扫了 ${passes} 轮）` : '';
  return `批量签到：${parts.join('；')}。${tail}`;
}

/**
 * 雷达那一路：把**本轮所有待签的雷达点名**逐个签掉。
 *
 * # 为什么用单点应答逐个来，而不是自己拼一次批量请求
 *
 * 平台没有「批量应答」接口 —— 每个点名一个 `PUT /api/rollcall/{id}/answer`。
 * 所以「批量」在本仓指的是**编排**（一次调用签多个），不是一次请求。
 *
 * # 为什么一个失败不影响下一个
 *
 * 一个点名签不上（不在范围内、已结束）不该让其余几个也失败 ——
 * 用户要的是「能签的都签上」。所以逐个 try，把失败记进 `failures` 继续。
 *
 * # `answer` 由调用方注入
 *
 * 单点应答的那对 `prepare` / `execute` / `cancel` 来自 `writes.js`
 * （测试里换成假的）。这个函数只负责「逐个」和「出错继续」，
 * **不碰协议细节** —— 13 个参考点、数字口令那些都在 `writes.js` 里。
 *
 * @param context.rows - 本轮待签的雷达点名。
 * @param context.answer - 单点应答那一对。
 * @param context.signal - 中止信号。
 * @param context.onSuccess - 签上一个就报一次（供 `stopAtFirst` 用）。
 * @returns `{ status, signed, failures }`。
 */
async function answerRadar({ rows, answer, signal, onSuccess }) {
  const signed = [];
  const failures = [];
  for (const row of rows) {
    signal?.throwIfAborted();
    const id = Number(row?.rollcall_id ?? row?.id);
    const name = nameOf(row);
    if (!Number.isSafeInteger(id) || id <= 0) {
      failures.push({ name, reason: '点名编号不合法' });
      continue;
    }
    try {
      // 复用 `writes.js` 的单点应答：给它「活动对象」形状，它会直接用这个 id。
      await answer.prepare({ rollcall: { id, title: name } });
      try {
        await answer.execute(signal);
      } finally {
        // execute 自己会清会话；显式再清一次是为了「prepare 抛了但会话却占了」的情况。
        await answer.cancel().catch(() => {});
      }
      signed.push(name);
      onSuccess?.({ signed: [name] });
    } catch (error) {
      if (signal?.aborted) throw error;
      failures.push({ name, reason: String(error?.message ?? error).slice(0, 120) });
    }
  }
  return {
    status: signed.length ? 'signed' : failures.length ? 'not-signed' : 'no-pending',
    signed,
    failures,
  };
}

/** 参数错误。 */
const invalid = (message) => new ClassroomError('INVALID_ARGUMENT', message);

/**
 * 等一会儿（可被中止）。
 *
 * 可中止是必须的：`passes` 大于 1 时会等 4 秒，用户中途点了停止还要等完
 * 那 4 秒才响应，感受上就是「停不下来」。
 *
 * @param ms - 毫秒。
 * @param signal - 中止信号。
 */
function sleep(ms, signal) {
  if (!ms || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}
