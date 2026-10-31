/**
 * 课堂宿主的事件契约（规范 §4 末条 + §7 G-5）。
 *
 * # 为什么单独一个文件
 *
 * 上游有 **4 套 SSE 实现**（`generation/run/sse.ts`、`stages/[id]/freshness`、
 * `agent/owner-events`、`chat/pi`），帧格式各写一遍。本包把「流式接口」统一成
 * `AsyncIterable<event>`：服务方法**返回**迭代器，不注册回调（卸载不漏），
 * 也不返回 `ReadableStream`（宿主层不是 Web 运行时）。
 *
 * # 事件形状（与上游 SSE 的 data 逐字段一致）
 *
 * 上游 `GET /api/generation-runs/:id/events` 写的是
 * `sseFrame(event.type, { ...event, phase }, event.seq)`，即帧的 `data` 就是
 * 存储里那条事件**加上** `phase`（`backlog` = 补历史，`live` = 实时）。
 * 这里保持同形，只把 SSE 的外壳（`event:`/`data:`/`id:` 三行）换成对象字段：
 *
 * ```js
 * {
 *   seq: 12,                    // 存储分配的单调序号，SSE 的 `id:`
 *   type: 'outline.item',       // SSE 的 `event:`
 *   ts: 1730000000000,          // 提交时间（毫秒）
 *   data: { ... },              // 该事件自己的负载，可为 null
 *   phase: 'backlog' | 'live',  // 与上游同名字段
 *   runId: 'run-…',
 * }
 * ```
 *
 * 两种控制帧与上游同名同形：
 *
 * - `{ type:'caught_up', from, seq }` —— 历史补齐；
 * - `{ type:'resync', reason:'compacted', from, snapshot, oldestSeq }` —— 游标落后于
 *   被压掉的旧事件，客户端应重读快照。`snapshot` 是**服务方法名**而不是 URL
 *   （宿主层没有 HTTP；调用方按名字去 `runs.get`）。
 *
 * # 何时结束
 *
 * 流的生命周期由 `signal`（`AbortSignal`）与 run 的终态共同决定：
 * 终态（`completed` / `paused` / `ended`）且历史读空后迭代结束；
 * 取消 `signal` 亦结束（不抛 —— 取消不是错误，规范 §4 的 taxonomy 里
 * `E_CANCELLED` 只用于返回值的场景）。
 */

/** 控制帧类型。业务事件类型由上游存储决定，不在这里枚举（会是漂移源）。 */
export const CONTROL_EVENT_TYPES = Object.freeze(['caught_up', 'resync']);

/** run 的终态：这些状态下不再等待新事件。 */
export const TERMINAL_RUN_STATES = Object.freeze(['completed', 'paused', 'ended']);

/**
 * 造一条事件。`seq` 由存储分配，所以缺省时**不写**这个键
 * （写 `seq: undefined` 会让 `'seq' in event` 的判据翻转，与上游不合）。
 *
 * @param {string} type
 * @param {object|null} [data]
 * @param {{ phase?: 'backlog'|'live', ts?: number, seq?: number, runId?: string }} [extra]
 */
export function createEvent(type, data = null, extra = {}) {
  const { phase = 'live', ts = Date.now(), seq, runId } = extra;
  return {
    ...(seq === undefined ? {} : { seq }),
    type: String(type),
    ts,
    data,
    phase,
    ...(runId === undefined ? {} : { runId }),
  };
}

/**
 * 上游 SSE 帧的序列化（`generation/run/sse.ts:20`），逐字保留。
 *
 * 本包不自己发 SSE（那是 host-bridge 的事），但把它导出：否则每个 HTTP 桥都要
 * 重新实现一遍帧格式，四处漂移正是 G-5 记的那条风险。
 */
export function sseFrame(event, data, id) {
  return `${id !== undefined ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** 上游 `sseHeaders(responseHeaders)` 的最小形状（源文件:generation/run/sse.ts）。 */
export function sseHeaders(extra = []) {
  return [
    ['content-type', 'text/event-stream; charset=utf-8'],
    ['cache-control', 'no-cache, no-transform'],
    ['connection', 'keep-alive'],
    ['x-accel-buffering', 'no'],
    ...extra,
  ];
}

/** 一个永不产出的事件流（终态 run、或没有事件存储时用）。 */
export async function* emptyEventStream() {}

/**
 * 轮询式事件流：上游 `polledEventStream` 的 AsyncIterable 版。
 *
 * 与上游的三条一致：先补 backlog（`phase:'backlog'`），补完写一条 `caught_up`，
 * 之后的新事件是 `phase:'live'`；游标只前进不后退；`signal` 中止即结束。
 *
 * 差一条（**必须记在 ROUTES.md**）：上游靠 `LISTEN/NOTIFY` 唤醒，本仓的存储端口
 * 没有通知通道（`adapter.js` 头注的映射表已写明「无映射」），所以这里只有轮询。
 * 默认 5s，与上游 `RUN_EVENTS_POLL_INTERVAL_MS` 同值。
 *
 * @param {object} options
 * @param {string} options.runId
 * @param {(runId: string, params: {after: number, limit: number}) => Promise<object[]>} options.readEvents
 * @param {(runId: string) => Promise<object|null>} options.readRun
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.after] 起始游标（SSE 的 `Last-Event-ID` / `?after=`）
 * @param {number} [options.pollIntervalMs]
 * @param {number} [options.pageSize]
 * @param {number} [options.maxIdlePolls] 测试用：连续空轮询多少次后结束（默认不限）
 */
export function runEventStream({
  runId,
  readEvents,
  readRun,
  signal,
  after = 0,
  pollIntervalMs = 5_000,
  pageSize = 500,
  maxIdlePolls = Number.POSITIVE_INFINITY,
}) {
  return {
    async *[Symbol.asyncIterator]() {
      let cursor = Number.isFinite(after) ? after : 0;
      const from = cursor;
      let caughtUp = false;
      let idle = 0;

      const aborted = () => signal?.aborted === true;
      const sleep = (ms) => new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener?.('abort', () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });

      for (;;) {
        if (aborted()) return;

        const page = (await readEvents(runId, { after: cursor, limit: pageSize })) ?? [];
        // 游标与第一条之间有空档 = 旧事件被压掉了（上游 `resync` 分支）。
        if (page.length > 0 && Number(page[0].seq) > cursor + 1) {
          yield {
            type: 'resync',
            ts: Date.now(),
            data: {
              type: 'resync',
              reason: 'compacted',
              from: cursor,
              snapshot: 'zhiyunClassroomStudio.runs.get',
              oldestSeq: Number(page[0].seq),
            },
            phase: caughtUp ? 'live' : 'backlog',
            runId,
          };
          cursor = Number(page[0].seq) - 1;
        }

        for (const row of page) {
          const seq = Number(row.seq);
          yield {
            seq,
            type: String(row.type ?? 'event'),
            ts: Number(row.ts ?? Date.now()),
            data: row.data ?? null,
            phase: caughtUp ? 'live' : 'backlog',
            runId,
          };
          cursor = seq;
        }

        if (!caughtUp && page.length === 0) {
          yield { type: 'caught_up', ts: Date.now(), data: { type: 'caught_up', from, seq: cursor }, phase: 'backlog', runId };
          caughtUp = true;
        } else if (!caughtUp && page.length > 0 && page.length < pageSize) {
          yield { type: 'caught_up', ts: Date.now(), data: { type: 'caught_up', from, seq: cursor }, phase: 'backlog', runId };
          caughtUp = true;
        }

        if (page.length >= pageSize) continue; // 还有历史，立刻再读

        // 终态 = 不再有新事件（上游对已完成的 run 也只补存量事件）。
        const run = await readRun(runId).catch(() => null);
        if (!run) return;
        if (TERMINAL_RUN_STATES.includes(String(run.state))) return;

        idle = page.length === 0 ? idle + 1 : 0;
        if (idle >= maxIdlePolls) return;
        await sleep(pollIntervalMs);
      }
    },
  };
}

/**
 * 把若干事件按顺序做成流（测试与「一次性结果」用）。
 * @param {object[]} events
 */
export function arrayEventStream(events = []) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  };
}
