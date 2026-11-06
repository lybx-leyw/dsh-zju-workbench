// 源：ref/OpenMAIC/lib/whiteboard/viewport.ts:1-26（viewportRatio 归一化）
// 源：ref/OpenMAIC/lib/action/engine.ts:63-69,674-710（形状路径 / 直线包围盒）
/**
 * 白板几何：动作坐标 → 画布元素。
 *
 * 上游把「动作」翻成「白板元素」的转换写在 `ActionEngine.executeWb*` 里，
 * 其中只有三件事是**几何**，其余是字段搬运：
 *
 *   1. 画布宽高比 `viewportRatio` 是 高/宽（16:9 = 0.5625），历史上被写成
 *      16/9 的持久化值必须就地取倒数修回来；
 *   2. 形状的 `path` 要在 1000×1000 的 viewBox 里合法，且尺寸必须有限 —— 这
 *      由几何内核 `validateShapeGeometry` 判定，本包不自己写路径解析；
 *   3. 直线动作给的是**绝对**起止点，元素要存成 `left/top` 加**相对**起止点。
 *
 * 几何内核一律走 `dsh-zhiyun-classroom-geometry`（同目录包，`file:` 依赖），
 * 不在这里复制一份 svg-pathdata。
 *
 * 源：ref/OpenMAIC/lib/whiteboard/viewport.ts:1-26
 * 源：ref/OpenMAIC/lib/action/engine.ts:63-69（SHAPE_PATHS）
 * 源：ref/OpenMAIC/lib/action/engine.ts:674-710（直线包围盒）
 * 源：ref/OpenMAIC/lib/whiteboard/runtime/fold.ts:68-86（新白板的初始形状）
 * 源：ref/OpenMAIC/lib/whiteboard/legacy-shape.ts:1-12
 */

// 走包依赖，不走相对路径。
//
// 原来写的是 `../vendor/geometry/index.js` —— 那是**本包**的 vendor 目录，
// 而 stage 包里根本没有 vendor（vendor 在隔壁 dsh-zhiyun-classroom-geometry）。
// 于是 esbuild 报 Could not resolve，整个构建挂住。
// 上面那段注释本来就写着「几何内核一律走 dsh-zhiyun-classroom-geometry」，
// 这里按注释的本意改成包名。
import { validateShapeGeometry } from 'dsh-zhiyun-classroom-geometry';
import { STAGE_ERROR_CODES, StageActionError } from './errors.js';

/** 形状名 → viewBox 1000×1000 里的路径。逐字照搬上游常量。 */
export const SHAPE_PATHS = Object.freeze({
  rectangle: 'M 0 0 L 1000 0 L 1000 1000 L 0 1000 Z',
  circle: 'M 500 0 A 500 500 0 1 1 499 0 Z',
  triangle: 'M 500 0 L 1000 1000 L 0 1000 Z',
});

/** 形状白名单。白名单外的名字**不能**退化成矩形（上游明确禁止）。 */
export const SHAPE_NAMES = Object.freeze(Object.keys(SHAPE_PATHS));

/** 白板高度/宽度的合理区间：横版到正方。 */
export const MIN_WHITEBOARD_VIEWPORT_RATIO = 0.4;

/** @see MIN_WHITEBOARD_VIEWPORT_RATIO */
export const MAX_WHITEBOARD_VIEWPORT_RATIO = 1;

/** 新建白板的默认边长（与 slide 的 `viewportSize` 同一套坐标系）。 */
export const WHITEBOARD_VIEWPORT_SIZE = 1000;

/**
 * 把 高/宽 比例修进合理区间：> 1（写成宽/高）取倒数，过小的抬到下界，
 * 非有限值回落到规范的 16:9。
 *
 * @param {number} ratio
 * @returns {number}
 */
export function normalizeWhiteboardViewportRatio(ratio) {
  if (!Number.isFinite(ratio)) return 9 / 16;
  const repaired = ratio > 1 ? 1 / ratio : ratio;
  return Math.min(
    Math.max(repaired, MIN_WHITEBOARD_VIEWPORT_RATIO),
    MAX_WHITEBOARD_VIEWPORT_RATIO,
  );
}

/**
 * 一张空白板。`id` 由调用方给（账本用 run+seq 派生，保证重放可复现）。
 *
 * @param {object} [options]
 * @param {string} [options.id]
 * @param {number} [options.viewportRatio] 高/宽
 * @returns {object}
 */
export function createWhiteboard({ id = 'stage-whiteboard', viewportRatio = 9 / 16 } = {}) {
  return {
    id,
    viewportSize: WHITEBOARD_VIEWPORT_SIZE,
    viewportRatio: normalizeWhiteboardViewportRatio(viewportRatio),
    elements: [],
    background: { type: 'solid', color: '#ffffff' },
    animations: [],
  };
}

/**
 * 旧版 `wb_draw_shape` 的兼容性判定：影子动作不允许携带 Native 扩展字段，
 * 形状名也必须在白名单里。返回错误文案而不是抛，方便调用方决定抛或跳过。
 *
 * @param {object} action
 * @returns {string | null}
 */
export function legacyShapeCompatibilityError(action) {
  if (!action || typeof action !== 'object') return 'wb_draw_shape 的动作不是对象。';
  const shape = action.shape;
  const extensions = ['rotate', 'path', 'viewBox', 'stroke', 'expectedLastSeq'];
  if (shape === 'custom' || extensions.some((key) => key in action)) {
    return 'Legacy wb_draw_shape 不支持 Native 的 rotate/path/viewBox/stroke 参数；'
      + '请改用 Native wb_draw_shape 工具与 RuntimeStore 投影，不要下发 Legacy 动作。';
  }
  if (!SHAPE_NAMES.includes(shape)) {
    return `Legacy wb_draw_shape 只支持 ${SHAPE_NAMES.join('|')}；未知形状不能回退成矩形。`;
  }
  return null;
}

/**
 * 把 `wb_draw_shape` 动作翻成画布上的形状元素，并让几何内核验一遍路径与尺寸。
 *
 * @param {object} params
 * @param {string} params.id 元素 id
 * @param {object} params.action 原始动作
 * @returns {object} 形状元素
 * @throws {StageActionError} `E_LEGACY_SHAPE` / `E_SHAPE_GEOMETRY`
 */
export function buildShapeElement({ id, action }) {
  const legacyError = legacyShapeCompatibilityError(action);
  if (legacyError) throw new StageActionError(STAGE_ERROR_CODES.LEGACY_SHAPE, legacyError);

  const width = Number(action.width);
  const height = Number(action.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new StageActionError(
      STAGE_ERROR_CODES.SHAPE_GEOMETRY,
      `wb_draw_shape 的 width/height 必须是正数，收到 ${JSON.stringify(action.width)}×${JSON.stringify(action.height)}`,
      { width: action.width, height: action.height },
    );
  }

  const path = SHAPE_PATHS[action.shape];
  const check = validateShapeGeometry({ path, viewBox: [1000, 1000], width, height });
  if (!check.ok) {
    throw new StageActionError(
      STAGE_ERROR_CODES.SHAPE_GEOMETRY,
      `形状 ${action.shape} 的路径未通过几何校验：${check.error.message}`,
      check.error,
    );
  }

  return {
    id,
    type: 'shape',
    viewBox: [1000, 1000],
    path,
    left: Number(action.x) || 0,
    top: Number(action.y) || 0,
    width,
    height,
    rotate: 0,
    fill: action.fillColor ?? '#5b9bd5',
    fixedRatio: false,
  };
}

/**
 * 直线动作的包围盒：`left/top` 取起止点的较小值，起止点转成相对坐标。
 * 宽高为 0 的直线（水平或垂直）保留 0，渲染侧自己按笔宽补一条线。
 *
 * @param {object} action
 * @returns {{left: number, top: number, start: [number, number], end: [number, number]}}
 */
export function lineBox(action) {
  const startX = Number(action.startX) || 0;
  const startY = Number(action.startY) || 0;
  const endX = Number(action.endX) || 0;
  const endY = Number(action.endY) || 0;
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  return {
    left,
    top,
    start: [startX - left, startY - top],
    end: [endX - left, endY - top],
  };
}

/**
 * 把 `wb_draw_line` 动作翻成画布上的直线元素。
 *
 * @param {object} params
 * @param {string} params.id
 * @param {object} params.action
 * @returns {object}
 */
export function buildLineElement({ id, action }) {
  const box = lineBox(action);
  return {
    id,
    type: 'line',
    left: box.left,
    top: box.top,
    width: Number(action.width) || 2,
    start: box.start,
    end: box.end,
    style: action.style ?? 'solid',
    color: action.color ?? '#333333',
    points: Array.isArray(action.points) && action.points.length === 2
      ? [action.points[0] ?? '', action.points[1] ?? '']
      : ['', ''],
  };
}
