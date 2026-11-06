/**
 * 围栏剥离 —— **纯函数**，本骨架唯一有实现的部分。
 *
 * ## 为什么需要它（以及为什么不是「再造一个工具函数」）
 *
 * 本仓现在**四处**各自的围栏剥离，口径互不相同，且没有任何一处有测试：
 *
 * | 位置 | 形态 | 尾随说明（` ```…```\n谢谢`） | JS 模板串里的 ``` 行 | CRLF |
 * | --- | --- | --- | --- | --- |
 * | `dsh-zhiyun-lecture/src/polish.js:538` | 整串锚定 `^…$` | ❌ 整段原样返回（围栏不剥） | ✅ 保留 | ✅ 先归一 |
 * | `dsh-zhiyun-quiz/src/generate.js:678` | 首行起、**末尾** ``` 截断 | ✅ 剥掉 | ✅ 保留 | ✅ ~~靠 trim~~ |
 * | `dsh-zhiyun-parser/src/core.js:4` | 整串锚定 + `replaceAll` | ❌ | ✅ | ✅ 先归一 |
 * | `dsh-zhiyun-parser/src/vision.js` | 复用 core 的 | ❌ | ✅ | ✅ |
 *
 * 两个**实测**出来的差异（本轮用 `node -e` 对真实实现跑过，见 README「实证」节）：
 * 1. `lecture` 版本的整串锚定意味着 **模型在围栏后多说一句话，围栏就不会被剥**
 *    → 后续 `JSON.parse` 拿到的是 ```json 前缀，报错信息里看到的是「响应开头」而非真实原因。
 *    `quiz` 版本早已处理过这种情况（它的注释写着「只剥围栏，不改内容」，但实现是截断）。
 * 2. `quiz` 版本的截断用 `lastIndexOf('```')`，对**含模板字符串的 JS/JSON** 会切错位
 *    （`{"tpl":"```"}` 之后再来一个 ``` 就得多截一次才能碰巧正确）。
 *
 * 本文件的取舍：**从尾部往前找「第二个整行 ```」，并允许其后跟少量尾随文字**，
 * 而不是「最后一个 ```」。理由：模型尾随的说明文字里几乎不会再出现「整行只有 ```」，
 * 而代码块内容里出现「整行只有 ```」是**合法且常见**的（嵌套代码 / 模板串）。
 *
 * ⚠ 这条判据是**本轮第一版**，且第一版写错过：初版要求「最后一条非空行必须是 ```」，
 *   于是 ```` ```json\n{…}\n```\n谢谢 ```` 直接判为「不是围栏」、原样返回 ——
 *   **与它要修的那个 bug 一模一样**（见测试 4，第一版红、第二版绿）。
 *   现在的实现是「从尾往前数到第 2 个整行 ``` 就截在那里」，代价是：
 *   若围栏正文里恰好有**两行**整行 ```，会截短。这条代价**未经真实样本验证**（TODO 2）。
 *
 * ## 边界（不改语义的地方）
 * - **不**解析 JSON、**不**校验 schema —— 那是调用方的事（`quiz` 有 `QuizParseError`，
 *   `lecture` 有 `FORMAT` 错误码）。本函数只负责「把包裹层脱掉」。
 * - **不**把「无围栏」当成错误 —— 模型直接返回裸 JSON 是合法的，原样返回。
 * - **不**对单行围栏（```json {"a":1} ```）做特殊处理 —— 本仓现有四处也都不处理。
 *
 * @param raw - 模型原始响应。
 * @returns 剥掉外层围栏后的文本（首尾空白已 trim）。
 */
export function stripFences(raw) {
  // ① 换行归一：CRLF / CR → LF。四处实现里只有两处做了，但做了的两处没坏处。
  const text = String(raw ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  const lines = text.split('\n');

  // ② 首行必须是围栏（允许 ``` 后面跟语言标记，如 ```json / ```js / ```markdown）。
  if (!/^```[A-Za-z0-9_+-]*$/.test(lines[0].trim())) return text;

  // ③ 从**尾部**往回数「整行只有 ```」的行，数到第 2 个就是闭合行（第 1 个是尾随说明后
  //    若有残留的围栏，或者就是闭合行本身）。这样 ```` ```…```\n谢谢 ```` 与
  //    ```` ```…```  ```` 走同一条路径。
  const fences = [];
  for (let i = lines.length - 1; i > 0 && fences.length < 2; i -= 1) {
    if (lines[i].trim() === '```') fences.push(i);
  }
  if (fences.length === 0) return text;
  const close = fences[fences.length - 1];

  // ④ 围栏内首行原样保留（可能是 Markdown 代码块里的 ``` 嵌套），只去掉开/闭两行。
  return lines.slice(1, close).join('\n').trim();
}

/**
 * 判断一段模型响应**是否**被围栏包裹（只判形，不剥）。
 *
 * 用途：`quiz` 需要在「剥了围栏」的响应上做 JSON 解析，但错误信息里要如实说
 * 「模型返回的是围栏包裹的非 JSON」，而不是笼统的「解析失败」。两件事分开判。
 *
 * @param raw - 模型原始响应。
 * @returns `true` 表示首行是围栏且尾部存在整行 ```。
 */
export function hasFence(raw) {
  const text = String(raw ?? '').replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
  const lines = text.split('\n');
  if (!/^```[A-Za-z0-9_+-]*$/.test(lines[0].trim())) return false;
  for (let i = lines.length - 1; i > 0; i -= 1) {
    if (lines[i].trim() === '```') return true;
  }
  return false;
}
