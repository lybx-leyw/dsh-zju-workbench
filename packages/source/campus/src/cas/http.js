/**
 * campus 的 `/http` 出口面 —— **现在只是转发**。
 *
 * # 历史与现状
 *
 * 这一层原先自己装着 `Transport` / `SessionStore` / `ClassroomError` / `sharedFetch`，
 * 于是 `cc98` / `xxt` / `zdbk` 为了用传输层，只能 `import`
 * `@lybx-leyw/dsh-zju-source-campus/http` —— **论坛与一个数据源包之间出现了
 * 根本不存在的业务依赖**。
 *
 * 现在实现全在 `@lybx-leyw/dsh-zju-source-http`（tier 0），本文件只做两件事：
 *
 *   1. 保留 `/http` 这个**子路径**，老的 import 语句还能解析（迁移期的缓冲）；
 *   2. 附带 campus 自己的两个登录域常量。
 *
 * 新代码请直接 `import … from '@lybx-leyw/dsh-zju-source-http'`。
 * 本文件没有自己的逻辑，删掉它不会丢任何行为。
 */

export {
  AUTH_HOSTS,
  CAS_HOST,
  ClassroomError,
  IDENTITY_HOST,
  REFERER,
  SessionStore,
  Transport,
  array,
  dpapi,
  object,
  resourceUrl,
  shape,
  sharedFetch,
} from '@lybx-leyw/dsh-zju-source-http';
