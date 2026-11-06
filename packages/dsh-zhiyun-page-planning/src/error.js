/**
 * 把宿主回的失败信息翻成**一句能读的话**。
 *
 * # 为什么单独一个文件
 *
 * 这段逻辑原先内联在 `client.jsx` 里，而 JSX 文件的函数测试导不进来 ——
 * 于是它坏了很久没人发现：宿主的失败分支回的是**对象**（`{ code, message }`），
 * 而 `new Error(对象)` 会把它字符串化成 `[object Object]`。`NO_LLM`、`BAD_JSON`、
 * `NO_CARDS` 那些写得很具体的说明，一条都没到过用户眼前。
 *
 * 抽出来之后这个分支就有了守卫（见 `tests/planning-errors.test.mjs`）。
 */

/**
 * @param error - 宿主回的 `payload.error`：`{ code, message }` 或字符串。
 * @param status - HTTP 状态码；两者都取不到时用它兜底。
 * @returns 给用户看的一句话。
 */
export function errorText(error, status) {
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object') {
    const message = typeof error.message === 'string' ? error.message.trim() : '';
    if (message) return message;
    if (typeof error.code === 'string' && error.code) return error.code;
  }
  return `设置接口返回 ${status}`;
}
