// 「插件依赖」页的**宿主半边**。
//
// 为什么这一页需要一个真正干活的宿主半边：宿主与浏览器各有一棵独立的 Cordis 插件树，
// 而本仓最重要的那几条依赖边全在**宿主面** —— dsh-zhiyun-core-study 的 `inject` 里写着
// `zhiyunClassroom / zhiyunParser / zhiyunKnowledge`，解析包写着 `zhiyunClassroom`，
// 讲义与出题包写着 `zhiyunParser`。浏览器里读不到宿主那棵树，所以由这里读出来交给客户端；
// 浏览器面（模块边、客户端硬边）由客户端自己就地读。
//
// 数据只走运行时已有的字段：Loader 条目的 `options.name`/`fiber`、fiber 的 `inject`、
// 以及 `ctx.reflect.store` 里每条实现的 `name`/`fiber`。不解析源码，不扫描目录。
import { readPlane } from './runtime.js';

/** 与 dsh-zhiyun-core-study 同一套信封：宿主面读运行时，必须已经有一棵装载完成的树。 */
export const inject = ['connection', 'loader'];

/** 一次请求能带的包数上限：图只关心本仓这几个包，超出的请求直接拒掉而不是白算。 */
const MAX_METHOD_LENGTH = 200;

/**
 * 读宿主面的服务依赖事实。
 * @param ctx - 宿主插件上下文。
 * @returns 可 JSON 化的平面读数（Map 折成有序对，才能在信封里过一遍）。
 */
function readHostPlane(ctx) {
  const plane = readPlane({
    entries: [...ctx.loader.entries()],
    runtimes: [...ctx.registry.values()],
    store: ctx.reflect.store,
  });
  return {
    rows: plane.rows,
    providers: [...plane.providers.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en')),
  };
}

/**
 * 注册 `/api/zhiyun-plugins`：目前只有一个只读方法 `graph`。
 *
 * 只读是一件刻意的事：改开关走宿主自带的 `pluginManager.setPluginEnabled`（客户端直接调
 * 那个 Remote），这里再开一个写入口就等于把同一件事做出两条路径 —— 一条会绕过宿主的
 * 只读保护与事件通知。
 * @param ctx - 宿主插件上下文。
 * @returns 卸载时摘掉路由的清理函数。
 */
export async function apply(ctx) {
  return ctx.connection.fetch.register({
    path: '/api/zhiyun-plugins',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let rpcId = 'invalid-request';
      let result;
      try {
        const message = await request.json();
        if (message?.type !== 'client-request' || message.method !== 'zhiyun-plugins'
          || typeof message.rpcId !== 'string' || message.rpcId.length > MAX_METHOD_LENGTH) {
          throw Object.assign(new Error('invalid envelope'), { code: 'INPUT' });
        }
        rpcId = message.rpcId;
        const method = message.payload?.method;
        if (method !== 'graph') throw Object.assign(new Error('unknown method'), { code: 'INPUT' });
        result = { ok: true, value: readHostPlane(ctx) };
      } catch (error) {
        result = { ok: false, error: { ...publicError(error), details: {} } };
      }
      return Response.json({ type: 'server-response', rpcId, result }, { headers: { 'cache-control': 'no-store' } });
    },
  });
}

/**
 * 只把业务码与一句话交给浏览器，堆栈和路径留在宿主日志里。
 * @param error - 抛出的任意值。
 * @returns `{ code, message }`。
 */
function publicError(error) {
  const code = typeof error?.code === 'string' ? error.code : 'INVALID';
  const message = error instanceof Error && error.message ? error.message : '请求未能完成';
  return { code, message };
}
