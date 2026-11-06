// 源：ref/OpenMAIC/packages/@openmaic/generation/src/json-repair.ts:1-120（容错的 JSON 抽取）
// 源：ref/OpenMAIC/lib/chat/structured-output.ts:120-365（结构化残渣抑制的同一判断）

/**
 * 从模型输出里抠 JSON。
 *
 * 上游用 partial-json + jsonrepair 做**流式**增量解析；本包拿到的是一次性
 * 完整文本（窄 llm 的 `call` 约定），所以只需要「整段抽取 + 一次修复」：
 *
 *   1. 去掉 ``` 围栏（模型很爱加）；
 *   2. 从第一个 `{` 或 `[` 开始截断前缀（上游 `parseAgentOutput` 也是这么干的）；
 *   3. 直接 JSON.parse；失败则把尾部的逗号、尾随文本削掉再试一次。
 *
 * 仍失败就是 `E_BAD_OUTPUT` —— 不猜内容。上游对纯文本会走「整段当自然语言」
 * 的分支，但那是**讲解文本**；生成管线要的是结构，猜错的代价是一整段场景
 * 变成空白，比报错坏得多。
 */

/** @returns {unknown|null} 解析失败返回 null（不抛）。 */
export function tryParseJson(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw;

  let text = String(raw).trim();
  if (!text) return null;

  // ```json ... ``` / ``` ... ```
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = fenced[1].trim();

  const firstObject = text.indexOf('{');
  const firstArray = text.indexOf('[');
  let start = -1;
  if (firstObject === -1) start = firstArray;
  else if (firstArray === -1) start = firstObject;
  else start = Math.min(firstObject, firstArray);
  if (start > 0) text = text.slice(start);

  const attempts = [text];
  // 模型常在最后一个 `}` 后面补一句话；从后往前找闭合符再试。
  const lastBrace = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (lastBrace > 0 && lastBrace < text.length - 1) attempts.push(text.slice(0, lastBrace + 1));
  // 尾随逗号：`{"a":1,}`。
  for (const candidate of attempts.slice()) {
    attempts.push(candidate.replace(/,\s*([}\]])/g, '$1'));
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 下一个候选
    }
  }
  return null;
}

/** 只要对象（数组也装箱成 `{ items }` 由调用方决定），失败给 null。 */
export function tryParseJsonObject(raw) {
  const parsed = tryParseJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  return parsed;
}

export function tryParseJsonArray(raw) {
  const parsed = tryParseJson(raw);
  return Array.isArray(parsed) ? parsed : null;
}
