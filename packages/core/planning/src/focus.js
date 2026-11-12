/**
 * 规划页读「停在这一条」的定位键。
 *
 * 这是「从别处跳进规划页时，把某一条待办滚到眼前并高亮」用的：写入方把
 * `{ key, at }` 放进 localStorage，规划页读出来、用完即弃。
 *
 * 读不到、过期、或列表里没有这一条，调用方就当没这回事，不报错。
 *
 * 纯函数（storage 由调用方注入），所以页面与测试共用同一份实现。
 */

export const FOCUS_STORAGE_KEY = 'zw.planning.focus';

const MAX_AGE = 2 * 60 * 1000;
const KEY = /^(local|xzzd|pta):[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

export function focusElementId(key) {
  return KEY.test(String(key ?? '')) ? `zwpg-due-${key}` : '';
}

export function readFocus(storage, now = Date.now()) {
  if (!storage) return null;
  let raw;
  try { raw = storage.getItem(FOCUS_STORAGE_KEY); }
  catch { return null; }
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    clearFocus(storage);
    return null;
  }
  const key = String(parsed?.key ?? '');
  const at = Number(parsed?.at);
  if (!KEY.test(key) || !Number.isFinite(at) || now - at > MAX_AGE || at > now + 5000) {
    clearFocus(storage);
    return null;
  }
  return { key, at };
}

export function clearFocus(storage) {
  try { storage?.removeItem(FOCUS_STORAGE_KEY); }
  catch { /* 清不掉就留到过期 */ }
}

/**
 * 列表还在读就等。读完仍没有这一行（勾掉了、对不上）就丢掉。
 * 已经在树上就滚动。
 *
 * @param pending - `readFocus` 的结果。
 * @param loadedAt - 最近一次列表请求结束的时间。0 表示这次还没请求完。
 * @returns `idle` / `wait` / `scroll` / `drop`。
 */
export function focusDecision({ pending, loading, loadedAt, hasElement }) {
  if (!pending) return 'idle';
  if (hasElement) return 'scroll';
  if (loading || !(loadedAt >= pending.at)) return 'wait';
  return 'drop';
}
