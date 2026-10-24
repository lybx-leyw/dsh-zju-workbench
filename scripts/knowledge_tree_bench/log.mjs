/**
 * 日志的**落盘与读盘**（Node 专用）。
 *
 * 纯逻辑（阶段表、`fold`、产物快照）在 `shared/log-core.mjs` —— 那部分
 * 浏览器也要用，所以不能带 node 依赖。这里只做两件与环境相关的事：
 * 追加写一行、把文件读成记录数组。
 */

import fs from 'node:fs/promises';

export {
  LOG_VERSION, PHASES, phaseOf, fold, artifactOf, artifacts, summarize,
} from './shared/log-core.mjs';

import { LOG_VERSION } from './shared/log-core.mjs';

/* ── 写入 ───────────────────────────────────────────────────────── */

/**
 * 一个只追加的日志写入器。
 *
 * @param {string} file 目标文件（`.jsonl`）。
 *
 * 写入是**串行**的：`append()` 内部排队，避免并发 `write` 把行交错。
 * 基准会并行收事件（多个 worker 同时回调），这一步不能省。
 */
export function createWriter(file, { initialSeq = 0 } = {}) {
  let chain = Promise.resolve();
  let closed = false;
  let seq = initialSeq;

  /* 写盘失败**不能静默吞掉**（审查第 30 条）。
   *
   * 不中断评测是对的（日志坏了不该让整个跑挂掉），但必须留下痕迹：
   * 记下失败次数与最后一条错误，`close()` 之后由调用方检查并告知用户
   * "这份日志不完整"。否则用户会把残缺证据当完整回放。
   */
  let writeFailures = 0;
  let lastWriteError = null;

  const append = (record) => {
    if (closed) return chain;
    seq += 1;
    const line = JSON.stringify({ v: LOG_VERSION, seq, ...record }) + '\n';
    chain = chain.then(() => fs.appendFile(file, line, 'utf8')).catch((error) => {
      writeFailures += 1;
      lastWriteError = String(error?.message ?? error);
    });
    return chain;
  };

  return {
    /** 写一条事件。`record` 会被补上 `seq`。 */
    event(record) { return append({ kind: 'event', ...record }); },
    /** 写一条阶段产物快照。 */
    artifact(record) { return append({ kind: 'artifact', ...record }); },
    /** 写一条运行元信息（配置、开始/结束）。 */
    meta(record) { return append({ kind: 'meta', ...record }); },
    /** 等所有排队写入落盘。 */
    flush() { return chain; },
    async close() { closed = true; await chain; },
    get count() { return seq; },
    /** 写盘失败次数与最后错误 —— 调用方要据此告知"日志不完整"。 */
    get failures() { return { count: writeFailures, lastError: lastWriteError }; },
  };
}

/* ── 读取 ───────────────────────────────────────────────────────── */

/**
 * 读一份日志。
 *
 * 坏行（写盘中断、手工改过）**跳过但不隐藏**：返回里带 `broken` 计数，
 * 让调用方能提示"这份日志有 N 行读不懂"，而不是假装完整。
 */
export async function readLog(file) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); }
  catch { return { records: [], broken: 0, missing: true, version: null }; }

  const records = [];
  let broken = 0, version = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let record;
    try { record = JSON.parse(line); }
    catch { broken += 1; continue; }
    if (version === null && Number.isFinite(record?.v)) version = record.v;
    records.push(record);
  }
  return { records, broken, missing: false, version };
}
