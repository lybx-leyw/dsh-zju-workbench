/**
 * 「选中英文 → 悬停自动翻译」里**与 DOM 无关**的那部分判定。
 *
 * 单独成模块的理由是可测：判定规则（这段文字该不该翻、光标是不是压在选区上、
 * 悬停停顿多久才触发）是这个功能里最容易写错又最难手测的部分 —— 在浏览器里
 * 「感觉好像该翻的时候没翻」几乎无法复现。抽出来之后可以在 Node 里直接断言。
 *
 * DOM 连线全在 `ReaderFrame.jsx`（同源 iframe 里挂监听），本文件不碰 document。
 */

/** 少于这个字符数不值得翻（"of"、"we" 之类）。 */
export const MIN_SELECTION_CHARS = 2;

/**
 * 清理选区文本：PDF 文本层会把一个词拆成多个 span，`toString()` 常在换行处
 * 塞进空格与连字符 —— 那是排版痕迹，不是用户选的内容。
 */
export function normalizeSelectionText(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\u00ad/g, '')            // 软连字符（PDF 换行断词留下的）
    .replace(/\s*-\s*\n\s*/g, '')      // 断词连字符 + 换行
    .replace(/\s+/g, ' ')              // 其余空白归一
    .trim();
}

const ASCII_LETTER = /[A-Za-z]/;
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 该不该送翻译。
 *
 * 判定放松一点还是严一点，取决于哪边的错更烦人：
 *   - 放松 → 选中一个公式或引用编号也去调模型（白花钱、弹出无意义的结果）
 *   - 严格 → 用户明确选了英文却什么都不发生（功能看起来是坏的）
 *
 * 所以选择：**只要看起来是英文就翻**，但拦住「几乎没有字母」的东西
 * （数字、公式、纯标点、中文）。已经是中文的输入上游也会原样返回，不额外花钱。
 */
export function isTranslatableSelection(raw) {
  const text = normalizeSelectionText(raw);
  if (text.length < MIN_SELECTION_CHARS) return false;
  if (CJK.test(text)) return false;

  const letters = [...text].filter((ch) => ASCII_LETTER.test(ch)).length;
  if (letters < 2) return false;

  // 字母占「可见字符」的比例。纯公式（`E = mc^2`）虽然有几个字母，
  // 但符号占主体，翻了也没意义；>`0.5` 才认为这是一段文字。
  const visible = [...text].filter((ch) => !/\s/.test(ch)).length;
  return visible > 0 && letters / visible > 0.5;
}

/** 光标是否落在选区的某个矩形里（iframe 视图坐标）。 */
export function intersectsRects(rects, x, y) {
  if (!Array.isArray(rects) || rects.length === 0) return false;
  for (const rect of rects) {
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return true;
  }
  return false;
}

/** 把选区矩形并成一个（浮层定位用）。 */
export function unionRect(rects) {
  if (!Array.isArray(rects) || rects.length === 0) return null;
  let { left, top, right, bottom } = rects[0];
  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

/**
 * 悬停「停住一会儿」才触发。
 *
 * 为什么不是一碰到就触发：用户选完文字后手常常还压在选区上，
 * 立刻触发会让每一次划选都顺带花一次模型调用。停顿 260ms 是「有意停留」
 * 与「顺手划过」的分界。
 *
 * 抽成对象（而不是内联 setTimeout）是因为它有两个真实的状态机边界：
 *   - 焦点在同一个选区内移动时**不能重置计时器**，否则手一抖永远等不到触发；
 *   - 换到别的选区必须立刻取消上一个，否则会弹出前一段文字的译文。
 */
export function createDwell({ delay = 260, onFire } = {}) {
  let timer = null;
  let armed = null;

  const clear = () => {
    if (timer !== null) { clearTimeout(timer); timer = null; }
    armed = null;
  };

  return {
    /** 光标进入某个可翻译选区。同一个 key 重复调用是幂等的。 */
    arm(key, payload) {
      if (armed === key) return;
      clear();
      armed = key;
      timer = setTimeout(() => {
        timer = null;
        const current = armed;
        armed = null;
        onFire(current, payload);
      }, delay);
    },
    /** 光标离开一切选区。 */
    cancel: clear,
    get pending() { return timer !== null; },
  };
}
