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
import { randomUUID } from 'node:crypto';

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
/**
 * 本进程的实例标识。`randomUUID()` 每次构造都换，那样「同进程重开同一个文件」
 * 会被自己当成另一个实例、把自己的勾当成别人的 —— 所以进程内只取一次。
 */
const PROCESS_OWNER = randomUUID();

export class TickStore {
  /**
   * @param file - `ticks.json` 路径。
   * @param now - 注入当前时间（测试用）。
   * @param owner - 实例标识。**同一进程内默认稳定**（一个窗口 = 一个实例）：
   *   同一个 `ticks.json` 在本进程里被重新打开时，仍认出自己的勾；
   *   测试可传定值。
   */
  constructor(file, now = () => Date.now(), owner = PROCESS_OWNER) {
    this.file = file;
    this.now = now;
    this.owner = String(owner);
    /** 磁盘上**被别的实例**勾掉的键。只读：不显示、不写回、不在本进程里翻转。 */
    this.foreign = new Set();
    this.ticks = {};
    this.load();
  }

  /**
   * 从磁盘读回勾选表，并分出「自己的」与「别人的」。
   *
   * 归不到 `this.owner` 的记录一律进 `foreign`：它们属于另一个正在运行的实例
   * （典型场景是「设置 → 重启实例」后新旧两个进程并存的一小段时间，或两个窗口）。
   */
  load() {
    let raw = {};
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'))?.ticks;
    } catch {
      // 不存在 / 坏了都退回空表：一处勾选不值得让整页起不来
      raw = {};
    }
    this.ticks = normalizeTicks(raw);
    this.foreign = new Set();
    const all = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    for (const key of Object.keys(this.ticks)) {
      // 脏记录（值不是对象）没有 owner 可言，按自己的旧格式收下，不因此丢失勾选
      const owner = all[key] && typeof all[key] === 'object' ? recordOwner(all[key]) : null;
      if (owner === null || owner === this.owner) {
        // 迁移：旧格式（只有 `{ doneAt }`）当作本实例的记录收下，下次落盘时补上 owner
        this.ticks[key] = { doneAt: this.ticks[key].doneAt, owner: this.owner };
        continue;
      }
      delete this.ticks[key];
      this.foreign.add(key);
    }
    return this.all();
  }

  /**
   * 落盘。先写临时文件再 rename，断电不会留下半个 JSON。
   *
   * 写的是「磁盘上别人的记录 ∪ 自己的记录」：另一个活着的实例刚写下的那些照单保留，
   * 本实例只覆盖自己名下的键 —— 不拿构造时的旧快照整份覆盖磁盘。
   * 这也让 `foreign` 不必事先 `absorb` 就能被保住：别的实例写下的增量不会丢。
   */
  save() {
    mkdirSync(dirname(this.file), { recursive: true });
    // 只读一次磁盘；读不到就是"别人已经不在"，foreign 只是少写几条，下次 load 会补回来
    let disk = {};
    try {
      disk = JSON.parse(readFileSync(this.file, 'utf8'))?.ticks ?? {};
    } catch {
      disk = {};
    }
    if (!disk || typeof disk !== 'object' || Array.isArray(disk)) disk = {};
    const merged = {};
    // 增量合并：磁盘上**不是本实例**的那部分照单留下（别处勾的 + 别处取消的都已经反映在盘上）
    for (const [key, value] of Object.entries(disk)) {
      const owner = value && typeof value === 'object' ? recordOwner(value) : null;
      if (owner !== null && owner !== this.owner) merged[key] = value;
    }
    Object.assign(merged, this.ticks);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ ticks: merged }, null, 2)}\n`, 'utf8');
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
    if (done) this.ticks[key] = { doneAt: Math.floor(this.now() / 1000), owner: this.owner };
    else delete this.ticks[key];
    // 本实例明确取消了这条：它不再是"别人的"，save 时也就不该被写回
    this.foreign.delete(key);
    this.save();
    return { key, done: Boolean(done) };
  }

  /**
   * 某一条在**别的实例**那边是否被勾掉。页面用它把这些行置灰，而不是假装没勾。
   *
   * @param source - 来源。
   * @param id - 平台 id。
   */
  isDoneElsewhere(source, id) {
    const key = tickKey(source, id);
    return key ? this.foreign.has(key) : false;
  }

  /**
   * 把磁盘上新出现的「别人的」勾选并进来（不重读自己的那份）。
   *
   * 只往 `foreign` 加，不改 `ticks` —— 本实例自己勾的以内存为准。
   *
   * @returns 新并入的键。
   */
  absorbForeign() {
    let all = {};
    try {
      all = JSON.parse(readFileSync(this.file, 'utf8'))?.ticks ?? {};
    } catch {
      return [];
    }
    if (!all || typeof all !== 'object' || Array.isArray(all)) return [];
    const added = [];
    for (const [key, value] of Object.entries(all)) {
      if (this.ticks[key]) continue;
      const owner = recordOwner(value);
      if (owner === null || owner === this.owner) continue;
      if (this.foreign.has(key)) continue;
      this.foreign.add(key);
      added.push(key);
    }
    return added;
  }

  /**
   * 这一条**在谁那儿**被勾了。
   *
   * @param source - 来源。
   * @param id - 平台 id。
   * @returns `'mine'` / `'elsewhere'` / `'none'`。
   */
  statusFor(source, id) {
    const key = tickKey(source, id);
    if (!key) return 'none';
    if (this.ticks[key]) return 'mine';
    return this.foreign.has(key) ? 'elsewhere' : 'none';
  }

  /**
   * 全部勾选（给页面渲染用）。
   *
   * 含**别的实例**勾的那几条，值形如 `{ doneAt: null, owner: <别人> }` —— 页面据此
   * 把它们也置灰（否则用户会看到「我明明勾过，怎么又活了」）。
   */
  all() {
    const out = { ...this.ticks };
    for (const key of this.foreign) if (!out[key]) out[key] = { doneAt: null, owner: null };
    return out;
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
 * 从一条记录里取 owner。
 *
 * @param value - 磁盘上的一条记录。
 * @returns owner 字符串；`null` 表示旧格式（没有 owner 字段，按本实例收下）。
 */
export function recordOwner(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const owner = typeof value.owner === 'string' ? value.owner.trim() : '';
  return owner || null;
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
    out[key] = {
      doneAt: Number.isFinite(doneAt) && doneAt > 0 ? doneAt : null,
      owner: recordOwner(value),
    };
  }
  return out;
}
