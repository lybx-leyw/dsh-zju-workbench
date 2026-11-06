/**
 * 课件图片缓存的**决策逻辑**（纯函数，可脱离文件系统测试）。
 *
 * # 为什么单独一层
 *
 * 真正的下载由 `dsh-zhiyun-source-classroom` 的 `downloadResource` 做 ——
 * 它已经支持断点续传、ETag、原子落盘，重造没有意义。这个文件只回答
 * **"这张图要不要下、下完叫什么、哪些该淘汰"**。
 *
 * 把它与文件 IO 分开，是因为这里有几个容易算错的地方，而算错之后表现为
 * "缓存好像没起作用"或"缓存越清越多"，都很难靠肉眼发现：
 *
 * 1. **缓存命中判定**要用**内容标识**而不是 URL —— 智云的图片 URL 带时效
 *    签名，同一张图换个签名就是另一个字符串；
 * 2. **文件名**必须从内容标识派生，否则刷新一次签名就重下一遍；
 * 3. **容量淘汰**要按"最近使用"而不是"最老创建"，否则用户反复看的那节课
 *    会被新看的课挤掉。
 */

import { createHash } from 'node:crypto';

/**
 * 单张课件图的大小上限。
 *
 * 智云课件帧是 1280×720 的 jpg，实测约 100–300 KB。给 8 MB 是防呆：
 * 服务端若返回 HTML 错误页或异常大的图，不该把它写进缓存。
 */
export const MAX_SLIDE_BYTES = 8 * 1024 * 1024;

/**
 * 缓存总容量上限。
 *
 * 2 GB 的估算：一节 83 页 × 约 200 KB ≈ 17 MB，2 GB 能装约 100 节课。
 * 这个量级足够"常看的课都在"，又不会让用户发现磁盘莫名少了一大块。
 */
export const CACHE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * 缓存键：从图片地址派生的**内容标识**。
 *
 * # 为什么要剥掉 query
 *
 * 智云课件图地址形如
 * `https://video.cmc.zju.edu.cn/.../page.jpg?e=1730000000&token=abc`。
 * 签名会随会话刷新而变，`e` / `token` 一变整条 URL 就不同 —— 拿完整 URL
 * 当键，刷新一次就重下一遍，缓存等于没有。
 *
 * 剥掉 query + fragment 之后只剩 `origin + pathname`，那才是这张图的身份。
 *
 * @param imageUrl - 课件图地址。
 * @returns 32 位十六进制键；地址无效时返回 `null`。
 */
export function cacheKeyForSlide(imageUrl) {
  const raw = typeof imageUrl === 'string' ? imageUrl.trim() : '';
  if (raw === '') return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  return digest(`${url.origin}${url.pathname}`);
}

/**
 * 缓存文件名：`<页序>-<键前 12 位>.jpg`。
 *
 * 带页序是为了**人工排查时能按页排**（打开缓存目录就看到 0001、0002…）；
 * 带键是为了同一页换了图（老师重传课件）时不会张冠李戴 —— 键变则文件名变，
 * 旧文件在淘汰阶段自然出清。
 *
 * @param page - 页号（1-based）。
 * @param key - `cacheKeyForSlide` 的产出。
 */
export function slideFileName(page, key) {
  const number = Number(page);
  const order = Number.isInteger(number) && number > 0 ? String(number).padStart(4, '0') : '0000';
  const short = typeof key === 'string' && key.length >= 12 ? key.slice(0, 12) : 'unknown000000';
  return `${order}-${short}.jpg`;
}

/**
 * 判断某张图是否已在缓存里。
 *
 * @param key - `cacheKeyForSlide` 的产出。
 * @param index - 缓存索引：`{ [key]: { file, bytes, usedAt } }`。
 * @returns 命中的索引条目；未命中（或条目损坏）返回 `null`。
 *
 * ⚠️ 这里只查索引、**不查磁盘**：调用方在真正用它之前应该 `stat` 一次，
 * 因为索引可能是旧的（用户手动删了文件）。索引命中的价值是"知道该找哪个
 * 文件名"，不是"保证文件存在"。
 */
export function lookupCached(key, index) {
  if (typeof key !== 'string' || key === '') return null;
  if (index === null || typeof index !== 'object') return null;
  const entry = index[key];
  if (entry === null || typeof entry !== 'object') return null;
  if (typeof entry.file !== 'string' || entry.file === '') return null;
  return entry;
}

/**
 * 把一批下载结果并进索引。
 *
 * @param index - 现有索引（会被拷一份，不就地改）。
 * @param results - `[{ key, file, bytes }]`，`bytes` 为实际大小。
 * @param now - 时间戳（毫秒），用于 `usedAt`。
 * @returns 新索引。
 */
export function mergeIndex(index, results, now = Date.now()) {
  const next = { ...(index ?? {}) };
  for (const result of Array.isArray(results) ? results : []) {
    const key = result?.key;
    const file = result?.file;
    const bytes = Number(result?.bytes);
    if (typeof key !== 'string' || key === '') continue;
    if (typeof file !== 'string' || file === '') continue;
    if (!Number.isFinite(bytes) || bytes <= 0) continue;
    next[key] = { file, bytes, usedAt: now };
  }
  return next;
}

/**
 * 标记一组键"刚用过"。
 *
 * 为什么需要：容量淘汰按 `usedAt` 排序，而"看过但没重下"的课不会经过
 * `mergeIndex`。不更新它的话，常看的旧课会被当成"很久没用"而淘汰 ——
 * 那正好淘汰掉最该留的。
 */
export function touchIndex(index, keys, now = Date.now()) {
  const next = { ...(index ?? {}) };
  for (const key of Array.isArray(keys) ? keys : []) {
    const entry = next[key];
    if (entry === undefined) continue;
    next[key] = { ...entry, usedAt: now };
  }
  return next;
}

/**
 * 算出该淘汰哪些键，直到总大小回到配额内。
 *
 * @param index - 缓存索引。
 * @param quotaBytes - 配额。
 * @returns `{ evict, totalBytes, evictedBytes }`：`evict` 是要删的键（按最久未用优先）。
 *
 * 淘汰策略是 **LRU**：按 `usedAt` 升序删，直到进配额。
 * 为什么不是 FIFO（按创建时间）：用户反复看的那节课应该留到最后 ——
 * 按创建时间淘汰会先删掉最早下的、往往也是他最常看的那门课。
 *
 * 单条超大（超过配额本身）的条目也会被删：留着它等于一条就吃掉全部预算。
 */
export function planEviction(index, quotaBytes = CACHE_QUOTA_BYTES) {
  const entries = Object.entries(index ?? {})
    .map(([key, entry]) => ({
      key,
      bytes: Number(entry?.bytes) || 0,
      usedAt: Number(entry?.usedAt) || 0,
    }))
    // 先删最久未用的
    .sort((a, b) => a.usedAt - b.usedAt);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (totalBytes <= quotaBytes) return { evict: [], totalBytes, evictedBytes: 0 };

  const evict = [];
  let remaining = totalBytes;
  for (const entry of entries) {
    if (remaining <= quotaBytes) break;
    evict.push(entry.key);
    remaining -= entry.bytes;
  }
  return { evict, totalBytes, evictedBytes: totalBytes - remaining };
}

/**
 * 从索引里删掉一批键。
 *
 * @returns 新索引（不移除原对象）。
 */
export function removeKeys(index, keys) {
  const next = { ...(index ?? {}) };
  for (const key of Array.isArray(keys) ? keys : []) delete next[key];
  return next;
}

/**
 * 挑出"还没缓存"的那些页。
 *
 * @param slides - `getSlides().items`，每项有 `imageUrl` 与 `page`。
 * @param index - 缓存索引。
 * @returns `[{ page, imageUrl, key, file }]`：需要下载的页。
 */
export function missingSlides(slides, index) {
  const out = [];
  for (const slide of Array.isArray(slides) ? slides : []) {
    const key = cacheKeyForSlide(slide?.imageUrl);
    if (key === null) continue;
    const hit = lookupCached(key, index);
    if (hit !== null) continue;
    out.push({
      page: slide.page,
      imageUrl: slide.imageUrl,
      key,
      file: slideFileName(slide.page, key),
    });
  }
  return out;
}

/**
 * 简单的 SHA-256 前 32 位十六进制。
 *
 * 用 `node:crypto` 而不是自己写：这里只需要"能把 URL 稳定映射成定长串"，
 * 不需要密码学强度，但用现成的没有任何代价。
 *
 * 注意：这个函数让本文件依赖 Node（不能进浏览器 bundle）。页面侧**不需要**
 * 算键 —— 它从宿主拿到 `{ key, file }` 的对应关系即可。
 */
function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 32);
}
