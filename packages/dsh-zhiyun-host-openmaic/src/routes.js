/**
 * 宿主侧的操作路由。
 *
 * # 为什么必须有这一层
 *
 * `ctx.zhiyunOpenMAIC` 是**宿主**（Node 进程）的服务。页面跑在浏览器里，跨不过
 * 这道进程边界 —— 客户端插件即使把 `zhiyunOpenMAIC` 写进 inject，也永远等不到
 * 它（真机表现：`web boot: 1 entry did not activate / pending (waiting for service:
 * zhiyunOpenMAIC)`，整页白屏）。
 *
 * 所以页面与宿主之间只能走 HTTP：这里注册两条同源路由，页面 fetch 它们。
 * 与 dsh-zhiyun-source-netproxy 的设置路由是同一套做法。
 *
 * # 形状
 *
 *   GET  /zhiyun-openmaic/status   只读，返回 status()
 *   POST /zhiyun-openmaic/start    幂等启动，返回启动后的 status()
 *   POST /zhiyun-openmaic/stop     停止
 *
 * 只暴露 `status()` 里那几项事实（state / reason / url / version / port），
 * **不回** `databaseUrl` 里的口令 —— 那个字符串会原样进浏览器，属于泄露。
 */

export const ROUTE_PREFIX = '/zhiyun-openmaic';
export const STATUS_PATH = `${ROUTE_PREFIX}/status`;
export const START_PATH = `${ROUTE_PREFIX}/start`;
export const STOP_PATH = `${ROUTE_PREFIX}/stop`;

/** 对外可见的字段。**刻意不包含** `databaseUrl`（可能带口令）。 */
function publicStatus(status) {
  return {
    state: status.state,
    reason: status.reason ?? null,
    url: status.url ?? null,
    port: status.port ?? null,
    version: status.version ?? null,
    lastError: status.lastError ?? null,
    vendorPath: status.vendorPath ?? null,
  };
}

const json = (res, code, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

/**
 * 建一个路由处理器。
 *
 * 读请求一律 200：状态本身就是答案（`no-database` 是一个**可解释的结果**，
 * 不是 HTTP 层的错误）。只有请求方法不对才 405。
 *
 * @param service - 宿主包提供的服务对象。
 */
export function createHandler(service) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    try {
      if (path === STATUS_PATH) {
        if (req.method !== 'GET') return json(res, 405, { success: false, error: 'method not allowed' });
        return json(res, 200, { success: true, status: publicStatus(await service.status()) });
      }

      if (path === START_PATH) {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'method not allowed' });
        return json(res, 200, { success: true, status: publicStatus(await service.start()) });
      }

      if (path === STOP_PATH) {
        if (req.method !== 'POST') return json(res, 405, { success: false, error: 'method not allowed' });
        await service.stop();
        return json(res, 200, { success: true, status: publicStatus(await service.status()) });
      }

      return json(res, 404, { success: false, error: 'not found' });
    } catch (error) {
      // 启动失败要如实回，但只回消息、不回堆栈（堆栈里可能带本机路径）。
      return json(res, 500, { success: false, error: String(error?.message ?? error) });
    }
  };
}
