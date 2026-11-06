/**
 * 自绘控制条：**一条轨道，同时是播放进度和内容结构**。
 *
 * # 为什么不改造原生控制条
 *
 * 原生控制在浏览器的 **shadow DOM** 里，外部无法向其中注入节点；
 * `::-webkit-media-controls-*` 只能改有限样式（隐藏某个按钮、改颜色），
 * 不能把任意 DOM 插进进度轨道，而且 Firefox / Safari 完全不支持这套伪元素。
 * 所以只能关掉原生 `controls`、自己画一条。
 *
 * # 为什么这个文件放在 page-study 里，而不是 dsh-zhiyun-core-playback
 *
 * 上一版放进跨包客户端产物里，结果整页白屏，而排查手段在沙箱里不可用。
 * 放在**同一个包内**的好处：只改一个 bundle，跨包依赖面一个字节都不变 ——
 * `page-study` 已经在用 `core-playback` 的纯函数（那条路已验证可用），
 * 不必再往那个产物里塞 JSX 组件。
 *
 * # 代价（真的代价）
 *
 * | 失去 | 说明 |
 * |---|---|
 * | 画中画 / 投屏 / 下载按钮 | 原生自带的，这里没重做 |
 * | 系统级无障碍 | 原生有内置读屏语义，这里只能补 `aria-*` |
 *
 * 回退开关在 `video-panel.jsx` 的 `USE_CUSTOM_CONTROLS`：改成 `false`
 * 就回到原生控制条，不必回退文件。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { branchRanges } from './skip-branch.js';
import { RATE_STEP, nextRate, atRateBound } from './speed.js';
import { pendingSteps, speedKeyAction, shouldHandleSpeedKey } from './speed-key.js';
import { readRateVisible, writeRateVisible, formatRate } from './rate-display.js';
import { estimateRemainingMs, formatEta, formatSaved } from './eta.js';
import { rateAt } from './uniform-speed.js';

/** 长按连发的心跳间隔。比 `repeatMs`(80ms) 细，保证补偿判断有足够分辨率。 */
const SPEED_TICK_MS = 40;

/**
 * **自由速度模式**。
 *
 * 开着时：只给「慢 / 快」两个按钮，每次 0.1，**界面上不显示当前倍数** ——
 * 用户靠"加速还是减速"来调节，而不是盯着一个数字去凑。
 * 关掉时回到原来的预设档循环（0.75 / 1 / 1.25 / 1.5 / 2）。
 */
const FREE_SPEED_MODE = true;

/** 预设档（`FREE_SPEED_MODE = false` 时用）。 */
const RATES = [0.75, 1, 1.25, 1.5, 2];

// 自由模式的边界、步长与浮点对齐住在 `speed.js`：那三个函数有"累加误差"这个
// 隐蔽坑，必须能被单测钉住，而 `.jsx` 在 node 里 import 不了。

/** 毫秒 → `mm:ss`（超过一小时给 `h:mm:ss`）。 */
function formatTime(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * 把 `video.buffered` 转成 0–1 比例数组。
 *
 * 拖过进度之后缓冲会出现**空洞**（0–20s 有、20–60s 没有、60–100s 有）。
 * 写死成一条 `[0, end]` 会在"只缓冲了后半段"时画出"全都好了"，用户拖过去就转圈。
 *
 * `TimeRanges` 也不是数组：没有 `map`，媒体被拆掉后读 `start(i)` 还会抛异常，
 * 所以逐项 try 包住 —— 缓冲条缺失不该让播放崩。
 */
function bufferedRatios(timeRanges, durationMs) {
  const duration = Number(durationMs);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const out = [];
  try {
    for (let i = 0; i < timeRanges.length; i += 1) {
      const start = Number(timeRanges.start(i)) * 1000;
      const end = Number(timeRanges.end(i)) * 1000;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      out.push({
        from: Math.min(1, Math.max(0, start / duration)),
        to: Math.min(1, Math.max(0, end / duration)),
      });
    }
  } catch {
    // 媒体被拆掉后读 TimeRanges 会抛；缓冲条缺失不影响播放。
  }
  return out;
}

/**
 * @param videoRef - 指向真正的 `<video>`（父组件持有，时间轴共用）。
 * @param bar - `toSeekBar()` 的产物 `{ axisMs, segments, heat }`；可为 `null`。
 * @param bands - `speechBands()` 的产物 `{ from, to, state }[]`。
 * @param nowMs - 当前播放时刻（毫秒），由父组件 `timeupdate` 驱动。
 * @param durationMs - 横轴总长，来自 `<video>.duration`。
 * @param onSeek - 跳到哪（毫秒），父组件写 `currentTime` 并同步状态。
 * @param onFullscreen - 全屏按钮点击（父组件负责全屏**画面层**）。
 */
export function MediaControls({
  videoRef,
  bar = null,
  /**
   * **精确分段**：不归并的那份，只给需要毫秒级边界的地方用
   * （跳支线斜纹、剩余时间估算）。缺省时退回 `bar`。
   *
   * 为什么需要两份：`bar` 的分段为了画得清爽做过归并（相邻同角色的短段并成
   * 一段），段边界因此变宽。拿它算"跳过支线到哪"会跳过头；拿它算剩余时间会
   * 少估支线时长。渲染可以将就，判定不行。
   */
  preciseBar = null,
  bands = [],
  nowMs = 0,
  durationMs = 0,
  onSeek,
  onFullscreen,
  skipBranch = false,
  onToggleSkipBranch,
  uniform = false,
  onToggleUniform,
  uniformPlan = null,
  /** 是否在全屏。全屏下控制条**悬停才出现**（影院模式）。 */
  fullscreen = false,
  /** 全屏下是否已分屏。 */
  split = false,
  /** 分屏开关。**只在全屏时传入** —— 页面内不给这个入口。 */
  onToggleSplit,
}) {
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  /**
   * 倍率是否显示。默认显示，用户点一下「x」就藏起来，偏好记在 localStorage。
   *
   * 初值用惰性初始化（传函数）：`readRateVisible` 会读 localStorage，
   * 每次渲染都读一遍没有必要，而且首帧就该是用户上次的选择，不能先显示再跳。
   */
  const [rateVisible, setRateVisible] = useState(() => readRateVisible());
  /** 切换显示并落盘。写失败只是记不住，不影响本次会话。 */
  const toggleRateVisible = useCallback(() => {
    setRateVisible((value) => {
      const next = !value;
      writeRateVisible(next);
      return next;
    });
  }, []);
  const [buffered, setBuffered] = useState([]);
  const dragging = useRef(false);

  /**
   * 均速模式：把 `playbackRate` 换成"这一刻该有的倍率"。
   *
   * # 为什么必须写在这里，而不是让 `nudgeRate` 直接算
   *
   * 用户设的 `rate` 是**平均速度**（存在组件 state 里），实际播放倍率由
   * `uniformPlan` 按当前时刻查出来。两者不能混：一旦把 `plan` 的结果写回
   * `rate`，用户下次按 Q/S 就会从"刚才那一瞬间的速度"开始加减，
   * 平均值会一路漂走。
   *
   * # 为什么依赖 `nowMs` 而不是自己监听 timeupdate
   *
   * 这一层的时间轴真源是父组件传下来的 `nowMs`（它由 `<video>` 的
   * `timeupdate` 驱动）。跟着它走不会出现两套时钟。
   *
   * # 关闭时要把倍率还原
   *
   * 关掉均速模式的瞬间，`playbackRate` 还停在上一段的加权值上。必须写回
   * 用户设的 `rate`，否则"关了均速"却还在用 1.15x 播 —— 用户会以为开关坏了。
   */
  useEffect(() => {
    const node = videoRef?.current;
    if (!node) return;
    // 计划基准是 1，所以要乘上用户的平均倍率（见上面 `plannedRate` 的说明）。
    const base = uniform && uniformPlan?.length ? rateAt(uniformPlan, nowMs, 1) : 1;
    const average = Number.isFinite(rate) && rate > 0 ? rate : 1;
    const target = uniform && uniformPlan?.length ? base * average : average;
    // 只在真的不同时才写：写回相同值也会触发 `ratechange`（进而触发一轮
    // state 同步与重渲染），而这个 effect 每次 nowMs 变化都会跑。
    if (Math.abs(node.playbackRate - target) > 1e-6) node.playbackRate = target;
  }, [uniform, uniformPlan, nowMs, rate, videoRef]);

  // 播放状态、音量、倍速都住在 `<video>` 元素上，不在 React 里。
  // 这里只做单向同步：元素事件 → 本地 state。反向（点按钮）直接操作元素。
  useEffect(() => {
    const node = videoRef?.current;
    if (!node) return undefined;
    const sync = () => {
      setPlaying(!node.paused && !node.ended);
      setVolume(Number.isFinite(node.volume) ? node.volume : 1);
      setMuted(node.muted === true);
      // ⚠️ **均速模式下绝对不要把 `playbackRate` 写回 `rate`**。
      //
      // 均速时 `playbackRate` 是加权算出的瞬时值（每个 timeupdate 都可能变），
      // 而 `rate` 是用户设的**平均值**。如果在这里把它同步回去，就会形成死循环：
      //
      //   rate 变 → 上面那个 effect 写 playbackRate → 触发 ratechange
      //     → sync 把 playbackRate 写回 rate → 又触发上面那个 effect → …
      //
      // 实际表现是整个页面卡死（用户报告："一开匀速模式就崩"）。
      // 所以这个方向只在**非均速**模式下同步：那时 `playbackRate` 就是用户
      // 直接设的值，同步它是对的。
      if (!uniform) setRate(Number.isFinite(node.playbackRate) ? node.playbackRate : 1);
    };
    const syncBuffered = () => setBuffered(bufferedRatios(node.buffered, durationMs));
    sync();
    syncBuffered();
    node.addEventListener('play', sync);
    node.addEventListener('pause', sync);
    node.addEventListener('ended', sync);
    node.addEventListener('volumechange', sync);
    node.addEventListener('ratechange', sync);
    node.addEventListener('progress', syncBuffered);
    node.addEventListener('timeupdate', syncBuffered);
    return () => {
      node.removeEventListener('play', sync);
      node.removeEventListener('pause', sync);
      node.removeEventListener('ended', sync);
      node.removeEventListener('volumechange', sync);
      node.removeEventListener('ratechange', sync);
      node.removeEventListener('progress', syncBuffered);
      node.removeEventListener('timeupdate', syncBuffered);
    };
  }, [videoRef, durationMs, uniform]);

  const togglePlay = useCallback(() => {
    const node = videoRef?.current;
    if (!node) return;
    // `play()` 返回 Promise，可能被自动播放策略拒绝。拒绝时静默失败即可 ——
    // 用户再点一次通常就成了，弹错反而吵。
    if (node.paused) node.play()?.catch?.(() => {});
    else node.pause();
  }, [videoRef]);

  const toggleMute = useCallback(() => {
    const node = videoRef?.current;
    if (!node) return;
    node.muted = !node.muted;
  }, [videoRef]);

  const changeVolume = useCallback((value) => {
    const node = videoRef?.current;
    if (!node) return;
    const next = Math.min(1, Math.max(0, value));
    node.volume = next;
    // 从 0 拉起来要解除静音，否则用户拖了滑块却还没声音。
    if (next > 0 && node.muted) node.muted = false;
  }, [videoRef]);

  /** 预设档循环（仅在 `FREE_SPEED_MODE = false` 时使用）。 */
  const cycleRate = useCallback(() => {
    const node = videoRef?.current;
    if (!node) return;
    const at = RATES.indexOf(node.playbackRate);
    node.playbackRate = RATES[(at + 1) % RATES.length];
  }, [videoRef]);

  /**
   * 自由模式：加减一个步长。
   *
   * 取值与夹紧全交给 `speed.js` 的 `nextRate()` —— 那里处理了浮点累加
   * （`1 + 0.1 + 0.1 = 1.2000000000000002`）。这里只管"要不要写回"：
   * 到边界时 `nextRate()` 会返回与当前相同的值，此时**不要写** ——
   * 写回同一个 `playbackRate` 也会触发 `ratechange`，白跑一轮渲染。
   *
   * # 均速模式下调的是"平均值"，不是当前实际倍率
   *
   * 均速模式下 `playbackRate` 是加权算出来的瞬时值（可能 1.15x）。若拿它去
   * ±0.1，用户每按一次都会从"那一瞬间的速度"起算，平均值会一路漂走。
   * 所以这里加减的是 `rate` state（用户设的平均值），由上面的 effect 再
   * 换算成本刻的实际倍率写进 `<video>`。
   */
  const nudgeRate = useCallback((delta) => {
    const node = videoRef?.current;
    if (!node) return;
    if (uniform) {
      // 平均值的调整：直接走 state，写回由 effect 负责。
      setRate((current) => {
        const base = Number.isFinite(current) ? current : 1;
        const next = nextRate(base, delta);
        return next === base ? current : next;
      });
      return;
    }
    const next = nextRate(node.playbackRate, delta);
    if (next === node.playbackRate) return;
    node.playbackRate = next;
  }, [videoRef, uniform]);

  /** 回到原速。不做可见按钮 —— 它会把"当前速度"变成可观察的基准点。 */
  const resetRate = useCallback(() => {
    const node = videoRef?.current;
    // 均速模式下"原速"指平均值回到 1，实际倍率由 effect 换算。
    if (uniform) setRate(1);
    if (node) node.playbackRate = 1;
  }, [videoRef, uniform]);

  /**
   * Q / S 快捷键：短按 ±0.1，**按住连续变速**。
   *
   * 时序全在 `speed-key.js` 里（纯函数、有单测），这里只做三件事：
   * 起一个 40ms 的心跳、每跳按 `pendingSteps()` 补档、松手时清干净。
   *
   * # 为什么用心跳而不是 setTimeout 链
   *
   * `setTimeout` 在后台标签页会被节流到 1s 一次，链式 setTimeout 会让
   * "按住变速"变成"每秒跳一格"。用固定心跳 + **按经过时间补偿**（`pendingSteps`），
   * 即使心跳被推迟，恢复时也会一次补齐，速度追得上。
   *
   * # 为什么必须处理 blur
   *
   * 按住 Q 时切走窗口，`keyup` 永远收不到 —— 不处理的话回来会发现速度自己
   * 涨到了 4x。`blur` 时统一清理。
   */
  useEffect(() => {
    if (!FREE_SPEED_MODE) return undefined;
    /** 当前按住的键：`{ action, startedAt, applied }`。同时只认一个键。 */
    let held = null;
    let timer = null;

    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      held = null;
    };

    const tick = () => {
      if (held === null) return;
      const elapsed = Date.now() - held.startedAt;
      const pending = pendingSteps(elapsed, held.applied);
      if (pending === 0) return;
      const delta = held.action === 'faster' ? RATE_STEP : -RATE_STEP;
      for (let i = 0; i < pending; i += 1) nudgeRate(delta);
      held.applied += pending;
    };

    const onKeyDown = (event) => {
      const action = speedKeyAction(event);
      if (action === null) return;
      if (!shouldHandleSpeedKey(event, document.activeElement)) return;
      // 系统按键重复（event.repeat）要挡掉：那套频率由用户的系统设置决定，
      // 且会让速度一路冲到边界。连发完全由下面自己的计时控制。
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const delta = action === 'faster' ? RATE_STEP : -RATE_STEP;
      nudgeRate(delta);   // 第一下立即生效：短按就是一次 ±0.1
      held = { action, startedAt: Date.now(), applied: 0 };
      if (timer !== null) clearInterval(timer);
      timer = setInterval(tick, SPEED_TICK_MS);
    };

    const onKeyUp = (event) => {
      const action = speedKeyAction(event);
      if (action === null) return;
      // 只清自己那个键：按住 Q 时补按 S，不该把 Q 的长按状态弄丢。
      if (held?.action === action) stop();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    // 切走窗口时收不到 keyup，必须兜底 —— 否则回来速度已经跑到边界。
    window.addEventListener('blur', stop);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', stop);
      stop();
    };
  }, [nudgeRate]);

  /** 到没到边界。`rate` 只用来判断按钮 disabled，不给用户看数值。 */
  const atMinRate = atRateBound(rate, 'min');
  const atMaxRate = atRateBound(rate, 'max');

  const axis = bar?.axisMs > 0 ? bar.axisMs : durationMs;
  const progress = axis > 0 ? Math.min(1, Math.max(0, nowMs / axis)) : 0;
  /**
   * 精确分段：跳支线与剩余时间估算用它。
   *
   * 为什么不用 `bar`：`bar` 为了画得清爽做过归并，段边界变宽。
   * - 拿它算"跳过支线到哪"会**跳过头**（原本 5 分钟的支线并成 8 分钟，
   *   用户莫名少看 3 分钟主线）；
   * - 拿它算剩余时间会**少估**支线时长，导致 ETA 偏大。
   */
  const precise = preciseBar ?? bar;
  /** 要"叉掉"的支线区间。只在开跳支线时画 —— 用精确边界。 */
  const allBranches = branchRanges(precise?.segments);
  const skipped = skipBranch ? allBranches : [];
  /** 有几段可跳 —— 没有就不显示开关（点了没反应的按钮比没有更差）。 */
  const branchCount = allBranches.length;
  /**
   * 当前所在的段。用于在控制条上显示「这段在讲什么」。
   *
   * **用归并后的 `bar`**：标签要稳定。用精确分段的话，相邻短块每几秒换一次，
   * 标签会不停跳字 —— 而"这段在讲什么"本来就是粗粒度信息。
   *
   * 边界取左闭右开，与 `skip-branch.js` 的 `segmentAt` 一致：若用闭区间，
   * 段与段的交界处会同时命中两段，摘要就会在边界闪。
   */
  const nowSegment = progress >= 0 && bar?.segments
    ? (bar.segments.find((s) => progress >= s.from && progress < s.to) ?? null)
    : null;
  const currentSummary = typeof nowSegment?.summary === 'string' ? nowSegment.summary : '';
  /** 有没有分段可画 —— 没有就不显示图例（图例指向不存在的东西更糟）。 */
  const hasSegments = (bar?.segments?.length ?? 0) > 0;
  /**
   * 预计还要看多久：`(总长 − 剩余要跳过的支线) ÷ 当前倍率`。
   *
   * 三个刻意的选择（详见 `eta.js` 文件头）：
   * - 起点是**剩余时长**，不是总长 —— 已经花掉的时间要计入已经发生的账；
   * - 只扣**当前位置之后**的支线，已播过的支线不重复扣；
   * - 用**当前**倍率，不预测用户接下来会不会再调。
   *
   * 它随着 `nowMs` 每秒在变，但变化幅度很小（一秒的差别），不会让文字闪。
   */
  /* 剩余时间用**精确分段**：归并后的段边界变宽，会把支线时长算少，
     ETA 因此偏大（用户看到"还剩 40 分钟"实际只要 32 分钟）。 */
  const eta = estimateRemainingMs(axis, nowMs, rate, precise?.segments, skipBranch);
  const etaText = formatEta(eta.estimateMs);
  const savedText = formatSaved(eta.skippedMs);
  /**
   * 均速模式下这一时刻的实际倍率。
   *
   * `rate` 是用户设的**平均**速度，`uniformPlan` 是「语速归一化」的相对倍率
   * 计划（基准 1）。两者相乘才是真正该写的 `playbackRate`：
   *
   * ```
   * 实际倍率 = 计划倍率 × 用户平均倍率
   * ```
   *
   * 为什么分成两层：计划只跟**语速分布**有关，用户调速度时不必重建计划，
   * 只要换个乘数。也正因为如此，「用户设 2x 就有 2x 的平均速度」这件事
   * 天然成立（计划按时间加权平均约为 1）。
   *
   * 计划为空时退回 `rate` —— 此时均速模式等于没效果，不该假装在起作用。
   */
  const plannedRate = uniform && uniformPlan
    ? rateAt(uniformPlan, nowMs, 1) * (Number.isFinite(rate) && rate > 0 ? rate : 1)
    : rate;
  /** 均速模式可用性：有计划才显示开关，否则点了没反应。 */
  const uniformAvailable = (uniformPlan?.length ?? 0) > 0;

  /** 指针位置 → 毫秒。与内容条同一套算法，避免两处行为不一致。 */
  const atPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || !(axis > 0)) return null;
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    return ratio * axis;
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const ms = atPointer(event);
    if (ms === null) return;
    dragging.current = true;
    // 捕获指针：拖到条外面也要继续跟着，否则一滑出边界拖动就断。
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSeek?.(ms);
  };
  const onPointerMove = (event) => {
    if (!dragging.current) return;
    const ms = atPointer(event);
    if (ms !== null) onSeek?.(ms);
  };
  const endDrag = (event) => {
    if (!dragging.current) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.key === 'ArrowRight' ? 5000 : -5000;
    onSeek?.(Math.min(axis, Math.max(0, nowMs + step)));
  };

  // 版式是**两行**：
  //
  //   ┌──────────────────────────────────────────────────────────┐
  //   │ ══════════════ 轨道（整行宽，主支线分段画在这里）══════════ │
  //   │ ▶  12:34 / 1:56:47            1x  跳支线  🔊 ▬  ⛶        │
  //   └──────────────────────────────────────────────────────────┘
  //
  // 单行版（轨道挤在按钮中间）在真实宽度下只剩 ~40%，一条 100 分钟的课
  // 里一分钟的支线只有几个像素，根本看不出主次。轨道独占一行后宽度接近 100%，
  // 同样的支线宽了 2.5 倍 —— 这才是"能看清主支线"的前提。
  return <div className="zs-mc" data-playing={playing ? 'true' : 'false'}>
    <div className="zs-mc-trackrow">
      {/* 轨道：这一条**既是进度条也是内容条** */}
      <div
        className="zs-mc-track"
        role="slider"
        tabIndex={0}
        aria-label="播放进度（轨道上同时显示主线与支线分段）"
        aria-valuemin={0}
        aria-valuemax={Math.round(axis)}
        aria-valuenow={Math.round(Math.min(axis, Math.max(0, nowMs)))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        {buffered.map((range, index) => <span
          key={`buf${index}`}
          className="zs-mc-buffered"
          style={{ left: `${range.from * 100}%`, width: `${Math.max(0, (range.to - range.from) * 100)}%` }}
        />)}
        {bands.map((band, index) => <span
          key={`band${index}`}
          className="zs-mc-voice"
          data-state={band.state}
          style={{ left: `${band.from * 100}%`, width: `${Math.max(0, (band.to - band.from) * 100)}%` }}
        />)}
        {(bar?.segments ?? []).map((segment, index) => <span
          key={`seg${index}`}
          className="zs-mc-seg"
          data-role={segment.role ?? 'none'}
          title={segment.summary || undefined}
          style={{ left: `${segment.from * 100}%`, width: `${Math.max(0, (segment.to - segment.from) * 100)}%` }}
        />)}
        {/* 支线被"叉掉"：开启跳支线时，在那些区间上盖一层斜纹。
            用斜纹而不是仅变淡 —— 变淡和"时间不可信"的样式太像，会混淆两种语义。 */}
        {skipped.map((range, index) => <span
          key={`skip${index}`}
          className="zs-mc-skip"
          title={range.summary ? `跳过支线：${range.summary}` : '跳过支线'}
          style={{ left: `${range.from * 100}%`, width: `${Math.max(0, (range.to - range.from) * 100)}%` }}
        />)}
        <span className="zs-mc-played" style={{ width: `${progress * 100}%` }} />
        <span className="zs-mc-thumb" style={{ left: `${progress * 100}%` }} />
      </div>
    </div>

    <div className="zs-mc-row">
      <button
        type="button"
        className="zs-mc-btn zs-mc-play"
        aria-label={playing ? '暂停' : '播放'}
        title={playing ? '暂停' : '播放'}
        onClick={togglePlay}
      ><span aria-hidden="true">{playing ? '❚❚' : '▶'}</span></button>

      <span className="zs-mc-time" aria-label="播放进度">
        <strong>{formatTime(nowMs)}</strong>
        <span className="zs-mc-dim"> / {formatTime(axis)}</span>
      </span>

      {/* 当前段概述。它是**内容**不是图例，所以给它在控制条上留位置；
          窄屏时省略，不和按钮抢空间。 */}
      {currentSummary && <span className="zs-mc-now" title={currentSummary}>{currentSummary}</span>}

      {/* 预计还要看多久。粗粒度（分钟/小时）—— 预估本来就是估算，精确到秒是假精度。
          `savedText` 只在真的跳掉了 1 分钟以上的支线时才出现，否则是噪声。 */}
      <span className="zs-mc-eta" title="按当前倍速估算">
        还剩 {etaText}
        {savedText && <span className="zs-mc-saved">{savedText}</span>}
      </span>

      {/* 图例：告诉用户轨道上那两种块是什么。
          没有它，"深色块 = 支线"只能靠猜 —— 而支线和主线是这段 UI 的核心信息。
          只在真的有分段时出现；窄屏省略。 */}
      {hasSegments && <span className="zs-mc-legend" aria-hidden="true">
        <i data-role="main" />主线
        <i data-role="branch" />支线
      </span>}

      <span className="zs-mc-spacer" />

      {/* 速度控制。
          自由模式（FREE_SPEED_MODE）：「慢 / 快」两个按钮，每次 0.1。
          中间的倍率**默认显示、点一下就藏**（偏好记入 localStorage）——
          有人想看着数字精确调，有人不想被数字牵着走，两边都留着。
          双击整组回到原速：不给独立的"重置"按钮，避免在控制条上再加一个钮。 */}
      {FREE_SPEED_MODE ? <span
        className="zs-mc-speed"
        onDoubleClick={resetRate}
        title="双击回到原速（Q 加速 / S 减速，可按住）"
      >
        <button
          type="button"
          className="zs-mc-btn zs-mc-speed-btn"
          aria-label="减速 0.1 倍"
          title="慢一点（按住 S 可持续减速）"
          disabled={atMinRate}
          onClick={() => nudgeRate(-RATE_STEP)}
        ><span aria-hidden="true">−</span></button>

        {/* 倍率本体：点它切换显示/隐藏。
            `min-width` 固定宽度 —— 否则从 `1.3x` 变成 `·` 时整组按钮会横向跳动。
            `data-away` 表示"当前不是原速"：隐藏数字后仍能靠颜色看出正在变速。
            **均速模式下这里显示的是此刻的瞬时倍率**（会随语速浮动），
            `data-auto` 让它带标记色，与"平均值"区分 —— 平均值在下面那个小字里。 */}
        <button
          type="button"
          className="zs-mc-btn zs-mc-rateview"
          data-visible={rateVisible ? 'true' : 'false'}
          data-away={Math.round(Number(rate) * 10) === 10 ? 'false' : 'true'}
          data-auto={uniform && uniformAvailable ? 'true' : undefined}
          aria-pressed={rateVisible ? 'true' : 'false'}
          aria-label={rateVisible ? '隐藏倍率' : '显示倍率'}
          title={rateVisible
            ? (uniform && uniformAvailable
              ? `此刻 ${formatRate(plannedRate)}（均速模式，平均 ${formatRate(rate)}）`
              : '点击隐藏倍率')
            : '点击显示倍率'}
          onClick={toggleRateVisible}
        >{rateVisible ? formatRate(uniform && uniformAvailable ? plannedRate : rate) : '·'}</button>

        {/* 均速模式下的**平均速度**小字。
            为什么要它常驻：主数字会随语速浮动（1.0–2.6 来回跳），用户按 Q/S 时
            根本看不出自己把"平均值"调到了多少 —— 而平均值才是他设的那个数。
            只在均速开启且倍率可见时出现：隐藏倍率是用户明确要求"别让我看数字"，
            此时硬塞一个平均速度进去等于没听他的。 */}
        {uniform && uniformAvailable && rateVisible && <span
          className="zs-mc-avg"
          title="均速模式：这是你设定的平均速度，上面的数字是此刻的实际倍率"
        >平均 {formatRate(rate)}</span>}
        <button
          type="button"
          className="zs-mc-btn zs-mc-speed-btn"
          aria-label="加速 0.1 倍"
          title="快一点（按住 Q 可持续加速）"
          disabled={atMaxRate}
          onClick={() => nudgeRate(RATE_STEP)}
        ><span aria-hidden="true">＋</span></button>
      </span> : <button
        type="button"
        className="zs-mc-btn zs-mc-rate"
        aria-label={`倍速 ${formatRate(rate)}，点击切换`}
        title="切换倍速"
        onClick={cycleRate}
      >{formatRate(rate)}</button>}

      {/* 均速模式开关。只在有语速数据时渲染 —— 没有数据时它等于没效果，
          显示一个点了没反应的按钮比没有更差。 */}
      {uniformAvailable && <button
        type="button"
        className="zs-mc-btn zs-mc-uniform-toggle"
        data-on={uniform ? 'true' : 'false'}
        aria-pressed={uniform ? 'true' : 'false'}
        aria-label={uniform ? '关闭均速模式' : '开启均速模式'}
        title={uniform
          ? '均速模式已开启：慢的地方自动加速、密的地方自动减速（点击关闭）'
          : '均速模式：按每段实际语速自动调节，让整节课信息密度一致'}
        onClick={onToggleUniform}
      >均速</button>}

      {/* 跳支线开关。没有支线可跳时不渲染 —— 一个点了没反应的按钮比没有按钮更差。 */}
      {branchCount > 0 && <button
        type="button"
        className="zs-mc-btn zs-mc-skip-toggle"
        data-on={skipBranch ? 'true' : 'false'}
        aria-pressed={skipBranch ? 'true' : 'false'}
        aria-label={skipBranch ? '关闭跳过支线' : `跳过支线（共 ${branchCount} 段）`}
        title={skipBranch
          ? `已开启：播放时自动跳过 ${branchCount} 段支线（点击关闭）`
          : `跳过支线：播放时自动跳过 ${branchCount} 段支线`}
        onClick={onToggleSkipBranch}
      >跳支线</button>}

      <span className="zs-mc-vol">
        <button
          type="button"
          className="zs-mc-btn"
          aria-label={muted || volume === 0 ? '取消静音' : '静音'}
          title={muted || volume === 0 ? '取消静音' : '静音'}
          onClick={toggleMute}
        ><span aria-hidden="true">{muted || volume === 0 ? '🔇' : '🔊'}</span></button>
        <input
          className="zs-mc-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label="音量"
          onChange={(event) => changeVolume(Number(event.target.value))}
        />
      </span>

      {/* 分屏开关。**只在全屏时渲染** —— 页面内已经有「⇄」切主视图。
          全屏单画面时它是唯一能唤出课件的入口，所以图标要显眼一点。 */}
      {onToggleSplit && <button
        type="button"
        className="zs-mc-btn zs-mc-split"
        data-on={split ? 'true' : 'false'}
        aria-pressed={split ? 'true' : 'false'}
        aria-label={split ? '关闭分屏' : '分屏：右侧显示课件与知识点'}
        title={split ? '关闭分屏（回到只看视频）' : '分屏（右侧显示课件与知识点）'}
        onClick={onToggleSplit}
      ><span aria-hidden="true">◫</span></button>}

      <button
        type="button"
        className="zs-mc-btn"
        aria-label="全屏"
        title="全屏"
        onClick={onFullscreen}
      ><span aria-hidden="true">⛶</span></button>
    </div>
  </div>;
}
