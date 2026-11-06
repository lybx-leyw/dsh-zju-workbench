/**
 * 学习资源的规范化序列化与内容哈希。
 *
 * # 为什么要自己写一遍「稳定 JSON」
 *
 * `revision` / `contentHash` 是**跨机器同值**的缓存键（契约 §6）：同一份内容在
 * 用户的机器上算出来必须和 CI 上算出来一致，否则派生资源（题目、讲解、阅读投影）
 * 会被无谓地重算一遍。`JSON.stringify` 的键序取决于对象属性的插入顺序，
 * 同一份内容经两条代码路径构造就会得到两个哈希 —— 所以这里先递归按键名排序，
 * 再用无空格的 `JSON.stringify` 序列化，最后 `sha256:` + hex。
 *
 * # 为什么不直接哈希整个 bundle
 *
 * bundle 里有三个字段是**派生**的：`revision`、`contentHash` 自己，以及
 * `generatedAt`（生成时刻）。把它们算进内容哈希会自我循环，而且每次重新生成
 * 都会换一个哈希 —— 缓存键就失去了意义（内容没变却命不中）。
 * 所以内容哈希只覆盖「去掉这三个字段之后的内容」，见 `HASH_EXCLUDED_FIELDS`。
 *
 * # revision 与 contentHash 的分工
 *
 * - `contentHash`：只由内容决定。同内容 → 同值；内容任一字节变化 → 不同值。
 * - `revision`：内容哈希 + 资源身份（resourceId / accountScope / courseId / subId /
 *   schemaVersion）。快照按 revision 落盘，两个账号恰好生成了完全相同的空讲义时
 *   不能互相顶掉对方的快照。
 */

import { createHash } from 'node:crypto';

/**
 * 不参与内容哈希的字段。
 *
 * `generatedAt` 虽然不叫「派生」，但它在语义上是「这一次生成的时刻」，
 * 同一份内容今天重算一次不该换缓存键 —— 所以一并排除。它仍然留在快照里，
 * 供追溯「这份资源是什么时候投影出来的」。
 */
export const HASH_EXCLUDED_FIELDS = Object.freeze(['revision', 'contentHash', 'generatedAt']);

/** 递归按键名排序；`undefined` 按 JSON 语义丢弃（数组里变成 null）。 */
function sortDeep(value) {
  if (Array.isArray(value)) return value.map((item) => (item === undefined ? null : sortDeep(item)));
  if (value && typeof value === 'object') {
    // Date 走 JSON 语义（toISOString），否则会被当成空对象。
    if (value instanceof Date) return value.toISOString();
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      out[key] = sortDeep(item);
    }
    return out;
  }
  return value;
}

/**
 * 规范化序列化：递归键排序 + 稳定 JSON（无空格、无结尾换行）。
 *
 * 单独导出是为了让测试能直接钉住「同一内容、键序不同 → 同一串字节」这条前提，
 * 也供外部（例如 run 指纹）复用同一份序列化。
 */
export function canonicalJson(value) {
  const sorted = sortDeep(value);
  return JSON.stringify(sorted === undefined ? null : sorted);
}

/** `sha256:` + hex。传字符串或任意 JSON 值（先规范化）。 */
export function sha256Hex(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/** 任意值的指纹：`sha256:` + 规范化序列化后的 sha256。 */
export function hashOf(value) {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/** 去掉派生字段后的内容视图（用于算内容哈希）。 */
export function contentOf(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) return bundle ?? null;
  const out = {};
  for (const key of Object.keys(bundle)) {
    if (HASH_EXCLUDED_FIELDS.includes(key)) continue;
    out[key] = bundle[key];
  }
  return out;
}

/**
 * 内容哈希：只覆盖内容，`revision`/`contentHash`/`generatedAt` 不参与。
 *
 * 键序无关、生成时刻无关；任何其它字段（标题、章节、锚点、告警…）变化都会换哈希。
 */
export function contentHash(bundle) {
  return hashOf(contentOf(bundle));
}

/**
 * revision：内容哈希 + 资源身份。
 *
 * 第二个参数允许传入已经算好的内容哈希，避免同一个内容在 attach 流程里算两遍。
 */
export function revisionOf(bundle, digest = contentHash(bundle)) {
  return hashOf({
    schemaVersion: bundle?.schemaVersion ?? null,
    resourceId: bundle?.resourceId ?? null,
    accountScope: bundle?.accountScope ?? null,
    courseId: bundle?.courseId ?? null,
    subId: bundle?.subId ?? null,
    contentHash: digest,
  });
}

/**
 * 给 bundle 补齐派生字段（浅拷贝，不改原对象）。
 *
 * 只补 `generatedAt` / `contentHash` / `revision` 三个派生字段 —— 其它字段原样带走。
 * `generatedAt` 已存在时**保留**调用方给的时刻：重放一份历史资源不该伪造新的生成时间。
 */
export function stamp(bundle, { generatedAt } = {}) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new TypeError('stamp 需要一个学习资源对象');
  }
  const digest = contentHash(bundle);
  return {
    ...bundle,
    generatedAt: bundle.generatedAt ?? generatedAt ?? new Date().toISOString(),
    contentHash: digest,
    revision: revisionOf(bundle, digest),
  };
}

/** 深冻结：快照进内存后不允许任何后续写操作改到它（不可变语义的进程内保障）。 */
export function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}
