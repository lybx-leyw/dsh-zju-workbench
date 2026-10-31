// 源：ref/OpenMAIC/lib/playback/engine.ts:554-621（游标推进 / 场景边界）
// 源：ref/OpenMAIC/lib/action/engine.ts:294-339（高亮 / 激光笔落点）
/**
 * 「课堂舞台」的浏览器半边：把账本按时间轴重放成画面。
 *
 * 组件吃三样东西：
 *   - `scenes`：场景列表（`scene.content.type === 'slide'` 的 `content.canvas`
 *     就是一张 PPTist 风格 slide，交给 `dsh-zhiyun-classroom-renderer` 画）；
 *   - `ledger`：账本（`ctx.zhiyunClassroomStage.ledger(runId).records`，或整个
 *     `ledger(runId)` 返回值）；
 *   - `renderer`：可选的渲染器覆盖（默认用 `dsh-zhiyun-classroom-renderer` 的
 *     `ClassroomSlide`，测试里可以换成桩）。
 *
 * # 为什么状态在渲染里算，而不用 setInterval 改 store
 *
 * 上游播放引擎是一台有状态机（`idle/playing/paused/live`）+ 一堆定时器的机器，
 * 每次前进都 `await delay` 再改 store。这里把「第几帧」当成唯一的 UI 状态：
 * 帧快照由纯函数 `buildTimeline()` 一次算好，定时器只负责把游标 +1。
 * 于是：
 *   - 服务端渲染（`renderToStaticMarkup`）不会碰任何浏览器 API —— 初始帧就是
 *     「场景 0 + 空板」；
 *   - 跳帧/回放只要改游标，不用重跑副作用；
 *   - 帧与账本一一对应，视觉状态不会比账本超前。
 *
 * 动作如何落到画布，全部按账本折叠出的 `state` 渲染：`scene_switch` 选场景、
 * `spotlight`/`laser` 盖一层遮罩/光点、`wb_*` 画白板元素。
 *
 * 源：ref/OpenMAIC/lib/playback/engine.ts:554-621（游标推进与场景边界）
 * 源：ref/OpenMAIC/lib/action/engine.ts:294-339（效果落点）
 * 源：ref/OpenMAIC/lib/whiteboard/runtime/browser-projection.ts:14-46（白板投影）
 * 源：ref/OpenMAIC/lib/interactive/logical-viewport.ts:1-29（定尺视口）
 */

import React, { useEffect, useMemo, useState } from 'react';
import css from './style.css';
import { ClassroomSlide } from 'dsh-zhiyun-classroom-renderer';
import { emptyStageState } from './ledger.js';
import { buildTimeline } from './timeline.js';

// 插件面：本包不注册页面/插槽，但客户端 Loader 会把 profile 里登记的每个 client
// 条目当插件装配，因此保留 object 形态的 `apply`（与 renderer 包同形状）。
// 插件 name 必须与包名一致的下划线化形式 —— 宿主用它作为插件 id 去匹配
// profile 里的 bundle 条目（`dsh-zhiyun-core-classroom-stage`）。
//
// 原来写的是 'zhiyun-classroom-stage'（少了 core 段），于是加载成功、注册成功，
// 但宿主找不到同名的 fiber，状态判为 failed，整个工作台停在
// 「HARNESS / Failed to load plugins」。这类错配不会在构建期暴露。
export const name = 'zhiyun-core-classroom-stage';
export const inject = [];
export function apply() {}

export { css };

/**
 * 账本入参的两种写法都吃：`records` 数组，或 `ledger(runId)` 的返回值。
 *
 * @param {unknown} ledger
 * @returns {object[]}
 */
function toRecords(ledger) {
  if (Array.isArray(ledger)) return ledger;
  if (ledger && Array.isArray(ledger.records)) return ledger.records;
  return [];
}

/**
 * 选当前场景。账本还没切过场景时退回第一个场景 —— 上游播放也是从
 * `sceneIndex = 0` 起（`playback/engine.ts:149-161`）。
 *
 * @param {object[]} scenes
 * @param {string|null} sceneId
 * @returns {object|null}
 */
function pickScene(scenes, sceneId) {
  const list = Array.isArray(scenes) ? scenes.filter(Boolean) : [];
  if (list.length === 0) return null;
  if (!sceneId) return list[0];
  return list.find((scene) => scene.id === sceneId) ?? list[0];
}

/**
 * 场景里的 slide JSON。上游的 scene 形状是 `content: { type: 'slide', canvas }`。
 *
 * @param {object|null} scene
 * @returns {object|null}
 */
function slideOf(scene) {
  const content = scene?.content;
  if (!content) return null;
  if (content.type === 'slide') return content.canvas ?? content.slide ?? null;
  return content.canvas ?? null;
}

/**
 * 在 slide 元素与白板元素里找目标框（高亮/激光笔都要落在元素上）。
 *
 * @param {object} state 帧快照
 * @param {object|null} slide
 * @param {string|null} elementId
 * @returns {{left: number, top: number, width: number, height: number} | null}
 */
function elementBox(state, slide, elementId) {
  if (!elementId) return null;
  const candidates = [
    ...(Array.isArray(slide?.elements) ? slide.elements : []),
    ...(state?.whiteboard?.elements ?? []),
  ];
  const found = candidates.find((element) => element && element.id === elementId);
  if (!found) return null;
  const width = Number(found.width);
  const height = Number(found.height);
  return {
    left: Number(found.left) || 0,
    top: Number(found.top) || 0,
    width: Number.isFinite(width) && width > 0 ? width : 1,
    height: Number.isFinite(height) && height > 0 ? height : 1,
  };
}

/**
 * 高亮层：元素框之外的区域压暗。无目标时整块压暗（上游 `dimOpacity` 默认 0.5）。
 *
 * @param {object} props
 * @returns {React.ReactElement}
 */
function Spotlight({ box, scale, dimOpacity }) {
  if (!box) {
    return (
      <div
        className="zyc-stage-spotlight zyc-stage-spotlight--full"
        aria-hidden="true"
        style={{ backgroundColor: `rgba(0, 0, 0, ${dimOpacity})` }}
      />
    );
  }
  return (
    <div
      className="zyc-stage-spotlight"
      aria-hidden="true"
      style={{
        left: box.left * scale,
        top: box.top * scale,
        width: box.width * scale,
        height: box.height * scale,
        boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${dimOpacity})`,
      }}
    />
  );
}

/**
 * 激光笔：目标中心一个光点。
 *
 * @param {object} props
 * @returns {React.ReactElement|null}
 */
function Laser({ box, scale, color }) {
  if (!box) return null;
  return (
    <span
      className="zyc-stage-laser"
      aria-hidden="true"
      style={{
        left: (box.left + box.width / 2) * scale,
        top: (box.top + box.height / 2) * scale,
        backgroundColor: color,
        boxShadow: `0 0 12px 4px ${color}`,
      }}
    />
  );
}

/**
 * 白板元素在板上的定位。板与元素共用 1000 宽的坐标系，所以横竖同一个比例。
 *
 * @param {object} element
 * @param {number} scale
 * @returns {object}
 */
function boardStyle(element, scale) {
  return {
    left: (Number(element.left) || 0) * scale,
    top: (Number(element.top) || 0) * scale,
    width: Number(element.width) > 0 ? Number(element.width) * scale : undefined,
    height: Number(element.height) > 0 ? Number(element.height) * scale : undefined,
  };
}

/**
 * 一条白板元素。种类与上游一致：text / latex / shape / line / table / chart / code。
 *
 * 图表与公式**不在这里**实现渲染器：上游白板用 echarts / katex，那两样是
 * `dsh-zhiyun-classroom-renderer` 的依赖。舞台只负责把元素放到正确的位置，
 * 内容以可读文本占位，等渲染层接管（规范 §2 通道 5：第三方原样保留）。
 *
 * @param {object} props
 * @returns {React.ReactElement}
 */
function BoardElement({ element, scale }) {
  const style = boardStyle(element, scale);

  if (element.type === 'shape') {
    return (
      <svg
        className="zyc-stage-board-el zyc-stage-board-shape"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        style={style}
        aria-hidden="true"
      >
        <path d={element.path} fill={element.fill ?? '#5b9bd5'} />
      </svg>
    );
  }

  if (element.type === 'line') {
    const [startX, startY] = element.start ?? [0, 0];
    const [endX, endY] = element.end ?? [0, 0];
    const dx = endX - startX;
    const dy = endY - startY;
    return (
      <svg
        className="zyc-stage-board-el zyc-stage-board-line"
        style={{
          left: (Number(element.left) || 0) * scale,
          top: (Number(element.top) || 0) * scale,
          width: Math.max(Math.abs(dx) * scale, 1),
          height: Math.max(Math.abs(dy) * scale, 1),
          overflow: 'visible',
        }}
        aria-hidden="true"
      >
        <line
          x1={0}
          y1={0}
          x2={dx * scale}
          y2={dy * scale}
          stroke={element.color ?? '#333333'}
          strokeWidth={Number(element.width) || 2}
          strokeDasharray={element.style === 'dashed' ? '8 6' : undefined}
        />
      </svg>
    );
  }

  if (element.type === 'latex') {
    return (
      <div className="zyc-stage-board-el zyc-stage-board-latex" style={style}>
        {element.latex}
      </div>
    );
  }

  if (element.type === 'table') {
    const rows = Array.isArray(element.data) ? element.data : [];
    return (
      <table className="zyc-stage-board-el zyc-stage-board-table" style={style}>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {(Array.isArray(row) ? row : []).map((cell) => (
                <td key={cell?.id ?? `${rowIndex}-${cell?.text}`}>{cell?.text}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  if (element.type === 'code') {
    const lines = Array.isArray(element.lines) ? element.lines : [];
    return (
      <pre className="zyc-stage-board-el zyc-stage-board-code" style={style}>
        {lines.map((line) => line.content).join('\n')}
      </pre>
    );
  }

  if (element.type === 'chart') {
    const rows = Array.isArray(element.data) ? element.data.length : 0;
    return (
      <div className="zyc-stage-board-el zyc-stage-board-chart" style={style}>
        <span className="zyc-stage-board-chart-kind">{element.chartType ?? 'bar'}</span>
        <span className="zyc-stage-board-chart-rows">{rows} 行数据 · 由渲染层绘制</span>
      </div>
    );
  }

  return (
    <div
      className="zyc-stage-board-el zyc-stage-board-text"
      style={style}
      // 上游白板文本本身就是 HTML（`<p style="font-size: …">`），这里保持同一契约。
      // 内容来自账本、由生成侧产出，与上游信任级别相同。
      dangerouslySetInnerHTML={{ __html: element.content ?? '' }}
    />
  );
}

/**
 * 白板面板：门票open 时才出现在右下角，尺寸按 `viewportRatio`（高/宽）。
 *
 * @param {object} props
 * @returns {React.ReactElement|null}
 */
function Whiteboard({ whiteboard, width }) {
  if (!whiteboard?.open) return null;
  const boardWidth = Math.max(200, Math.round(width * 0.38));
  const ratio = Number(whiteboard.viewportRatio) > 0 ? Number(whiteboard.viewportRatio) : 9 / 16;
  const boardHeight = Math.round(boardWidth * ratio);
  const scale = boardWidth / (Number(whiteboard.viewportSize) || 1000);

  return (
    <aside
      className="zyc-stage-board"
      style={{ width: boardWidth, height: boardHeight }}
      aria-label="白板"
    >
      {(whiteboard.elements ?? []).map((element) => (
        <BoardElement key={element.id} element={element} scale={scale} />
      ))}
    </aside>
  );
}

/**
 * 舞台：按时间轴重放一本账。
 *
 * @param {object} props
 * @param {object[]} [props.scenes] 场景列表
 * @param {object[]|object} [props.ledger] 账本记录，或 `ledger(runId)` 的返回值
 * @param {object|Function} [props.renderer] 渲染器覆盖（`{ClassroomSlide}` 或组件本身）
 * @param {boolean} [props.autoplay] 是否自动按时长推进（默认 true）
 * @param {number} [props.speed] 播放倍速（只在构建时间轴时用）
 * @param {number} [props.width] 画布宽（px），高按 slide 的 `viewportRatio` 推
 * @param {number} [props.startFrame] 起始帧（回放定位/测试用，默认 0）
 * @param {(frame: object) => void} [props.onFrame] 每帧回调（进度条/埋点用）
 * @param {string} [props.className]
 * @returns {React.ReactElement}
 */
export function ClassroomStage({
  scenes = [],
  ledger,
  renderer,
  autoplay = true,
  speed = 1,
  width = 800,
  startFrame = 0,
  onFrame,
  className = '',
}) {
  const timeline = useMemo(() => {
    try {
      return buildTimeline(toRecords(ledger), { speed });
    } catch (error) {
      // 账本坏了也不许整页白屏：退化成「没有动作」的舞台，并把原因挂在 DOM 上。
      return { frames: [{ index: 0, seq: null, type: null, at: 0, duration: 0, state: emptyStageState() }], durationMs: 0, error: error?.message ?? String(error) };
    }
  }, [ledger, speed]);

  const [cursor, setCursor] = useState(() => Math.max(0, Number(startFrame) || 0));

  // 换了账本就回到起始帧。
  useEffect(() => {
    setCursor(Math.max(0, Number(startFrame) || 0));
  }, [timeline, startFrame]);

  // 时间轴推进：唯一的状态变化就是游标 +1，时长来自帧本身。
  useEffect(() => {
    if (!autoplay) return undefined;
    if (timeline.frames.length <= 1) return undefined;
    if (cursor >= timeline.frames.length - 1) return undefined;
    const current = timeline.frames[cursor] ?? timeline.frames[0];
    const wait = Math.max(0, Number(current.duration) || 0);
    const timer = setTimeout(() => {
      setCursor((value) => Math.min(value + 1, timeline.frames.length - 1));
    }, wait);
    return () => clearTimeout(timer);
  }, [autoplay, cursor, timeline]);

  const frames = timeline.frames;
  const safeCursor = Math.min(Math.max(cursor, 0), frames.length - 1);
  const frame = frames[safeCursor];
  const state = frame?.state ?? emptyStageState();
  const scene = pickScene(scenes, state.sceneId);
  const slide = slideOf(scene);
  const scale = width / (Number(slide?.viewportSize) || 1000);

  useEffect(() => {
    if (typeof onFrame !== 'function') return;
    onFrame(frame);
  }, [frame, onFrame]);

  const Slide = typeof renderer === 'function'
    ? renderer
    : (renderer?.ClassroomSlide ?? ClassroomSlide);

  const spotlightBox = elementBox(state, slide, state.effects?.spotlight?.elementId);
  const laserBox = elementBox(state, slide, state.effects?.laser?.elementId);

  return (
    <div
      className={`zyc-stage ${className}`.trim()}
      data-scene={state.sceneId ?? ''}
      data-frame={safeCursor}
      data-timeline-ms={timeline.durationMs}
    >
      <div className="zyc-stage-viewport" style={{ width }}>
        {slide ? (
          <Slide slide={slide} width={width} />
        ) : (
          <div className="zyc-stage-empty" style={{ width, height: Math.round(width * 0.5625) }}>
            {scene ? '该场景不是 slide' : '没有可播放的场景'}
          </div>
        )}
        {state.effects?.spotlight ? (
          <Spotlight
            box={spotlightBox}
            scale={scale}
            dimOpacity={state.effects.spotlight.dimOpacity ?? 0.5}
          />
        ) : null}
        {state.effects?.laser ? (
          <Laser
            box={laserBox}
            scale={scale}
            color={state.effects.laser.color ?? '#ff0000'}
          />
        ) : null}
      </div>
      <Whiteboard whiteboard={state.whiteboard} width={width} />
    </div>
  );
}

export default ClassroomStage;
