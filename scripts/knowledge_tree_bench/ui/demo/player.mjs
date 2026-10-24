/**
 * **播放器**：把一份日志变成可逐步推进的动画。
 *
 * # 设计立场：不自动播放
 *
 * 评测跑完之后，用户要的是**看懂**，不是看它自己演一遍。所以这里：
 *   · 默认停在 `seq = 0`；
 *   · 用户点「下一步」推进一条事件（或点「播」按速度连续走）；
 *   · 随时能跳任一阶段、拖进度条、点节点看产物。
 *
 * 自动播放的问题不是"太快"，而是**它把节奏从用户手里拿走了**：
 * 想细看第 07 段时要等它演完七段，想回头核对第 03 段又要重新等。
 *
 * # 与 `log-core` 的关系
 *
 * 每一帧的状态都是 `fold(records, seq)` 算出来的**纯函数结果**，不是
 * 增量修改的副作用。所以：
 *   · 往回拖 = 重算一帧，不需要"撤销"；
 *   · 任意跳转都正确，不会积累漂移。
 *
 * 增量更新在这里是错的：一旦某条事件被跳过，后面所有帧都是错的，
 * 而且看不出来。重算一帧的成本是这个数量级里最划算的。
 */

import { fold, artifactOf, PHASES, phaseOf } from '/shared/log-core.mjs';

/** 一条事件的**人话**标签。 */
export function labelOf(record) {
  const d = record.data ?? {};
  const phase = phaseOf(record.act);
  const no = phase ? phase.no : '--';
  switch (record.act) {
    case 'vision':
      return `${no} 识别 P${record.subject} · ${d.hasText ? `${d.chars} 字` : `失败 ${d.failure ?? ''}`}`;
    case 'mix':
      return `${no} 混合 P${record.subject} · ${d.skipped ? '跳过（识别失败）' : `${d.blocks ?? 0} 块 / ${d.lines ?? 0} 句`}`;
    case 'mark':
      return `${no} 标记 块${record.subject} · ${d.role ?? '未标'}${(d.facets ?? []).length ? ` · ${d.facets.join('/')}` : ''}`;
    case 'bind':
      return `${no} 来源编号 块${record.subject} · 标记来自mix`;
    case 'organize':
      return `${no} 正式语言组织 ${record.subject} · ${d.blockIndexes?.length ?? 0} 块${d.cached ? '（缓存）' : ''}`;
    case 'sieve':
      return `${no} 筛支线 块${record.subject} · ${d.why ?? ''}`;
    case 'stash':
      return `${no} 挂账 ${d.page != null ? `P${d.page}` : '无课件'} · ${d.pendingTok ?? 0} tok`;
    case 'merge':
      return `${no} 审查合并 叶${record.subject} · ${d.split ? `切成 ${d.parts} 支` : '未超线'}`;
    case 'regroup':
      return `${no} 重构 ${record.subject} · ${d.tok ?? 0} tok / 并 ${d.merged ?? 1} 段`;
    case 'chapter':
      return `${no} 习坎分章 · ${d.title || '（无名）'}`;
    case 'lecture':
      return `${no} 习坎成稿 · ${d.title || '（无名）'} · ${d.chars ?? 0} 字`;
    case 'polish':
      return `${no} 终稿 · ${d.failed ? `失败 ${d.code ?? ''}` : d.unchanged ? '一字未改' : `${d.changes ?? 0} 处改动`}`;
    default:
      return `${no} ${record.act}`;
  }
}

/**
 * 播放器。
 *
 * 事件都来自同一份 `records`，`seq` 只前进/后退，状态永远由 `fold` 重算。
 */
export class Player {
  /**
   * @param {Array} records 日志记录（含 meta）。
   */
  constructor(records) {
    /** 只看 event；meta 由 `fold` 自己处理。 */
    this.records = records;
    this.events = records.filter((r) => r.kind === 'event');
    this.index = -1;                 // -1 = 还没走任何一步
    this.onChange = null;            // (state, index) => void
    this.timer = null;
    this.speedMs = 260;
    /* 斩杀线：从日志的 start 元信息读，供筛选与着色使用。
     * 读不到就是 null —— 此时不判超线，而不是拿一个默认值乱判。 */
    const meta = records.find((r) => r.kind === 'meta' && r.what === 'start');
    this.splitLine = Number.isFinite(meta?.config?.splitLine) ? meta.config.splitLine : null;
  }

  get length() { return this.events.length; }
  get atEnd() { return this.index >= this.events.length - 1; }
  get atStart() { return this.index < 0; }

  /** 当前这一帧的完整状态（纯函数重算）。 */
  get state() {
    if (this.index < 0) return fold([], 0);
    return fold(this.records, this.events[this.index].seq);
  }

  /** 当前这一条事件（还没走则为 null）。 */
  get current() { return this.index < 0 ? null : this.events[this.index]; }

  /** 当前事件所在阶段（用来高亮导轨）。 */
  get phase() {
    const act = this.current?.act;
    return act ? phaseOf(act) : null;
  }

  #emit() {
    if (typeof this.onChange === 'function') this.onChange(this.state, this.index, this.current);
  }

  /** 走一步。越界返回 false。 */
  next() {
    if (this.atEnd) return false;
    this.index += 1;
    this.#emit();
    return true;
  }

  /** 退一步。 */
  prev() {
    if (this.atStart) return false;
    this.index -= 1;
    this.#emit();
    return true;
  }

  /** 跳到第 i 条事件（0 起）。 */
  seek(i) {
    const clamped = Math.max(-1, Math.min(this.events.length - 1, Math.trunc(i)));
    if (clamped === this.index) return;
    this.index = clamped;
    this.#emit();
  }

  /** 跳到某一阶段的**第一条**事件。 */
  seekPhase(phaseKey) {
    const i = this.events.findIndex((e) => phaseOf(e.act)?.key === phaseKey);
    if (i >= 0) this.seek(i);
    return i >= 0;
  }

  /** 走到某一阶段的**最后一条**事件（看该阶段成品）。 */
  seekPhaseEnd(phaseKey) {
    let last = -1;
    for (let i = 0; i < this.events.length; i += 1) {
      if (phaseOf(this.events[i].act)?.key === phaseKey) last = i;
    }
    if (last >= 0) this.seek(last);
    return last >= 0;
  }

  /** 到末尾。 */
  toEnd() { this.seek(this.events.length - 1); }

  /** 回到开头。 */
  toStart() { this.seek(-1); }

  /** 连续播放。`onDone` 在走到末尾时调用。 */
  play(onDone) {
    if (this.timer) return;
    const tick = () => {
      if (!this.next()) { this.pause(); onDone?.(); return; }
    };
    tick();
    this.timer = setInterval(tick, this.speedMs);
  }

  /** 暂停（不改变当前位置）。 */
  pause() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  get playing() { return Boolean(this.timer); }

  /**
   * 按**问题**筛选事件 —— 这是"调适"真正的入口。
   *
   * 审查第 26 条：早先只能按序号逐条翻，要碰到问题得翻几百条。
   * 这里给出四类真正要看的：
   *   · `failed`   —— 识别/混合失败的页，以及润色失败
   *   · `overLine` —— 挂账/合并时超斩杀线的
   *   · `noSource` —— 讲义里没有来源块的节（可能不是从树填充的）
   *   · `deferred` —— 事后补发的事件（时间戳不可信）
   *
   * @param {string} kind
   * @returns {number[]} 事件下标数组
   */
  filter(kind) {
    const out = [];
    const line = Number.isFinite(this.splitLine) ? this.splitLine : null;
    this.events.forEach((e, i) => {
      const d = e.data ?? {};
      switch (kind) {
        case 'failed':
          if (d.failure || d.visionFailure || d.mixFailure || d.failed) out.push(i);
          break;
        case 'overLine':
          if (line !== null && (d.tookTok ?? d.pendingTok ?? d.tok ?? 0) > line) out.push(i);
          break;
        case 'noSource':
          if (e.act === 'lecture' && !(d.blockIndexes ?? []).length) out.push(i);
          break;
        case 'deferred':
          if (d.deferred) out.push(i);
          break;
        default:
          break;
      }
    });
    return out;
  }

  /**
   * 按文本搜索（页号、块号、标题都算）。
   *
   * @param {string} query 非空字符串。
   * @returns {number[]}
   */
  search(query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return [];
    const out = [];
    this.events.forEach((e, i) => {
      const d = e.data ?? {};
      /* ⚠️ 必须包含**人话标签**（`labelOf` 给的中文），不只是 `act`。
       *
       * 屏幕上显示的是 "01 识别 P7 · 14 字"，用户自然会搜"识别"。
       * 但 `act` 是英文 `vision` —— 只搜 act 的话，搜屏幕上看到的词反而 0 条。
       * 搜索必须与**显示文本**一致，否则搜索框是摆设。 */
      const hay = [
        e.act, labelOf(e), String(e.subject ?? ''),
        d.title, d.summary, d.chapter, d.text, d.rawText, d.mixedText,
        String(d.page ?? ''),
      ].filter(Boolean).join(' ').toLowerCase();
      if (hay.includes(q)) out.push(i);
    });
    return out;
  }

  /** 某条事件处的**阶段产物**（探针用）。 */
  artifact(phaseKey, records = null) {
    const state = records ? fold(records) : this.state;
    return artifactOf(state, phaseKey);
  }

  /** 当前帧的**全部**阶段产物（点节点时展示它所处的阶段）。 */
  allArtifacts() {
    const state = this.state;
    const out = {};
    for (const phase of PHASES) out[phase.key] = artifactOf(state, phase.key);
    return out;
  }

  /**
   * 每条事件在时间轴上的**相对位置**（0..1），用于进度条着色。
   * 用 `t` 而不是序号：让"卡在某个模型调用上"看得见。
   */
  timeline() {
    const total = this.events.at(-1)?.t || 1;
    return this.events.map((e, i) => ({
      i, act: e.act, t: e.t, ratio: Math.min(1, (e.t ?? 0) / total),
      phase: phaseOf(e.act)?.key ?? null,
    }));
  }
}
