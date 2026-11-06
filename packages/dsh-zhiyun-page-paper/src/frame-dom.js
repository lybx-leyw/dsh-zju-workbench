/**
 * 阅读器 iframe 的**根元素**操作。
 *
 * # 为什么单独抽出来
 *
 * iframe 换 `src` 之后（打开一篇新文献、上传完自动打开上一篇）存在一个窗口期：
 * `contentDocument` **已经有值**，但里面还是空文档，`documentElement` 是 `null`。
 *
 * 原来的写法是
 *
 *     frameRef.current?.contentDocument?.documentElement.classList.toggle(...)
 *
 * `?.` 只护住它**紧挨着**的那一个值。这里 `contentDocument` 命中了，
 * 于是继续读 `.documentElement.classList` —— 对 `null` 取属性直接抛
 * `TypeError: Cannot read properties of null (reading 'classList')`。
 * 异常抛在 `useEffect` 里，被 `zhiyun.paper.content` 那个 slot 的 error boundary
 * 接住，**整个论文页变成空白**（用户看到的是"点开论文，页面没了"）。
 *
 * 这个窗口期是**时序相关**的，在测试机上时而命中时而不命中 —— 所以判定逻辑
 * 必须能脱离浏览器单独验，见 `tests/paper-upload.test.mjs`。
 */

/**
 * 安全地在阅读器 iframe 的根元素上开关一个 class。
 *
 * @param doc - `iframe.contentDocument`（可能为 null，也可能是个还没解析出根元素的空文档）。
 * @param className - 要 toggle 的 class。
 * @param on - true 加、false 去。
 * @returns 真的操作到了根元素就返回 true；iframe 还没准备好返回 false（**不抛**）。
 */
export function toggleFrameClass(doc, className, on) {
  const root = doc?.documentElement;
  if (!root || typeof root.classList?.toggle !== 'function') return false;
  root.classList.toggle(className, Boolean(on));
  return true;
}
