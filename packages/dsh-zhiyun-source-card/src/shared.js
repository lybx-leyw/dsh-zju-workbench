/**
 * 宿主半边与客户端半边**共用的常量**。
 *
 * # 为什么单独一个文件
 *
 * 路由、写头、打码值这三样在两端各写一份时，漂移的表现是「点了保存没反应」：
 * 客户端打的路由宿主上没有，或者写头名字差一个字母被 403 拒掉 —— 两种都不会报错，
 * 只看得到一个不动的按钮。
 *
 * # 为什么客户端**不能**直接 import `index.js`
 *
 * 本包的 `index.js` 是**宿主半边**（`apply` + 凭据读写 + HTTP 路由）。客户端 bundle
 * 若 import 它，宿主 Loader 解 bundle 的 exports 时会拿到那份 `apply`（见
 * `vendor/loader` 的 `unwrapExports`），于是把一个宿主插件当成客户端插件跑；
 * 而且 `node:fs` 之类的东西也会被拽进浏览器产物。
 *
 * 所以只把**纯常量与纯函数**放在这里：两端都能 import，谁也不会因此把对方打包进来。
 */

/** 设置路由。与其它包一致用 `/_dsh/` 前缀。 */
export const ROUTE_PATH = '/_dsh/zhiyun-card';

/** 写操作必须带的自定义头（跨站发不出，等于 CSRF 闸）。 */
export const WRITE_HEADER = 'x-zhiyun-card';

/** 密码回显值：页面回传它表示"不改密码"。 */
export const MASK = '********';

/**
 * 把宿主回的失败信息翻成**一句能读的话**。
 *
 * 宿主当前一律回**字符串** `{ error: '...' }`，所以这条路径现在很少走到对象分支；
 * 但同一仓的其它设置路由（`dsh-zhiyun-page-planning`）回的是 `{ code, message }`
 * 对象，而 `new Error(对象)` 会把它字符串化成 `[object Object]` —— 用户看到的是一句
 * 完全没有信息量的话。这个函数让"将来改了错误形状"不会静默退化成那样。
 *
 * @param error - `payload.error`：字符串，或 `{ code, message }` 对象。
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
