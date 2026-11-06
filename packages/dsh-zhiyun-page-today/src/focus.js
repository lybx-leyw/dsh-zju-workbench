/**
 * 今天页点一条到期事项时，记下要在规划页停住的那一条。
 *
 * 两页不能互相引用源码。身份只经过 `sessionStorage`，键与
 * `dsh-zhiyun-page-planning` 的 `src/focus.js` 必须一致。
 * 测试 `tests/planning-focus-jump.test.mjs` 守着这条约定。
 */

export const FOCUS_STORAGE_KEY = 'zhiyun.planning.focus';

const KEY = /^(local|xzzd|pta):[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

/** 记下一条。形状不对或存不进去就返回 false，调用方仍然可以打开规划页。 */
export function writeFocus(storage, key, now = Date.now()) {
  if (!storage || !KEY.test(String(key ?? ''))) return false;
  try {
    storage.setItem(FOCUS_STORAGE_KEY, JSON.stringify({ key, at: now }));
    return true;
  } catch {
    return false;
  }
}
