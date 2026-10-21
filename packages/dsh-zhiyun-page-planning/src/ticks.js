/**
 * 平台待办上的**本机勾选**。
 *
 * # 这解决什么
 *
 * 学在浙大待办与拼题A 题集是**平台**的数据：我们能读，但不能写。用户想勾掉一条
 * （"这份作业我交过了"），原来无处可勾 —— 页面上只有只读的一行。
 *
 * # 最关键的一条：这是**本机的标记**，不是平台的完成状态
 *
 * 勾一下**不会**让学在浙大认为你交了作业，也**不会**让拼题A 关闭题集。它只表示
 * 「我自己认为这件事不用再提醒了」。所以：
 *
 *   - 存在本地（`ticks.json`），绝不写回任何平台；
 *   - 页面上必须**明确写出这一点**，不能让用户以为勾了就等于交了；
 *   - 平台那边**仍然是权威**：如果平台显示未提交，那就是未提交，本机勾选只是
 *     "我不需要为它操心了"，不是"它已经完成了"。
 *
 * 为什么值得做：这一页的用途是"我接下来要做什么"。一条已经处理完的事继续挂在
 * 「已过期」里，会持续占用注意力 —— 而它恰恰是最需要被清掉的那类。
 *
 * # 键的形状
 *
 * `${source}:${id}`，例如 `xzzd:48213` / `pta:1042`。
 *
 * **必须带 source**：两个平台的 id 都是小整数，`xzzd:12` 与 `pta:12` 是
 * 完全不同的两件事，只按 id 存会互相覆盖。
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

/** 允许勾选的来源。别的来源（中转站、自己的规划）各有各的存储，不走这里。 */
export const TICK_SOURCES = Object.freeze(['xzzd', 'pta']);
/**
 * 拼一条勾选键。
 *
 * @param source - 来源（`xzzd` / `pta`）。
 * @param id - 平台给的那条的 id。
 * @returns 键，或 null 表示这条**没有可用的身份**（那就不该能勾）。
 */
export function tickKey(source, id) {
  const s = String(source ?? '').trim();
  const i = String(id ?? '').trim();
  if (!TICK_SOURCES.includes(s)) return null;
  // 空 id 不能勾：没有身份就无法在下次同步时认出"还是这一条"，
  // 勾了也只会在下一次刷新时凭空消失 —— 那是比不能勾更糟的体验。
  if (!i) return null;
  return `${s}:${i}`;
}

/**
 * 勾选的状态仓库。
 *
 * 只存"勾了哪些"，不存"没勾哪些"：没勾是默认值，存下来只会让文件无限增长
 * （平台的新条目会不断增加）。取消勾选 = 删掉这条记录。
 *
 * 顺带清理：平台那边已经不存在的条目，键会一直留着。`prune` 由调用方在拿到
 * 最新列表后调用 —— 不清理的话文件会慢慢积累已删除作业的残影。
 */
export class TickStore {
  /**
   * @param file - `ticks.json` 路径。
   * @param now - 注入当前时间（测试用）。
   */
  constructor(file, now = () => Date.now()) {
    this.file = file;
    this.now = now;
    this.ticks = {};
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8'));
      this.ticks = normalizeTicks(parsed?.ticks);
    } catch {
      // 不存在 / 坏了都退回空表：一处勾选不值得让整页起不来
      this.ticks = {};
    }
    return this.ticks;
  }

  /** 落盘。先写临时文件再 rename，断电不会留下半个 JSON。 */
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ ticks: this.ticks }, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.file);
  }

  /** 某一条是否被本机勾掉。 */
  isDone(source, id) {
    const key = tickKey(source, id);
    return key ? Boolean(this.ticks[key]) : false;
  }

  /**
   * 勾选 / 取消。
   *
   * @param source - 来源。
   * @param id - 平台 id。
   * @param done - 是否标记为已处理。
   * @returns `{ key, done }`，或 null 表示这条没有可用身份。
   */
  setDone(source, id, done) {
    const key = tickKey(source, id);
    if (!key) return null;
    if (done) this.ticks[key] = { doneAt: Math.floor(this.now() / 1000) };
    else delete this.ticks[key];
    this.save();
    return { key, done: Boolean(done) };
  }

  /** 全部勾选（给页面渲染用）。 */
  all() {
    return this.ticks;
  }

  /**
   * 丢掉平台那边已经不存在的勾选。
   *
   * 不清理的后果是文件慢慢积累"早已交掉的作业"的残影 —— 不会显示出来（那些条目
   * 本身没了），但会一直占着文件、也会让人误以为还有一堆没处理。
   *
   * @param liveKeys - 当前**确实存在**的条目键全集。
   * @returns 清掉了几个。
   */
  prune(liveKeys) {
    const live = new Set(liveKeys);
    let removed = 0;
    for (const key of Object.keys(this.ticks)) {
      if (!live.has(key)) {
        delete this.ticks[key];
        removed += 1;
      }
    }
    if (removed > 0) this.save();
    return removed;
  }
}

/**
 * 规整从磁盘读回的勾选表。
 *
 * 只保留形状对的记录：手改坏了某一条不该让整份表消失，也不该让一条脏数据
 * 在页面上变成一个假的勾选。
 *
 * @param raw - 磁盘上的 `ticks` 对象。
 * @returns 干净的勾选表。
 */
export function normalizeTicks(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    const [source, ...rest] = String(key).split(':');
    const id = rest.join(':');
    // 键必须能被解析成合法来源 + 非空 id，否则丢弃
    if (tickKey(source, id) !== key) continue;
    // 值必须是个对象：`null` / 字符串 / 数字都算脏数据。
    // 注意 `{ doneAt: null }` 是**合法**的（时间未知但确实勾了），别把两者混为一谈。
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const doneAt = Number(value.doneAt);
    out[key] = { doneAt: Number.isFinite(doneAt) && doneAt > 0 ? doneAt : null };
  }
  return out;
}
