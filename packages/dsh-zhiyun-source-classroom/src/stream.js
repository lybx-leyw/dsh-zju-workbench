/**
 * 智云直播（HLS）的本机流转发端点。
 *
 * # 为什么需要这一层
 *
 * 智云直播是 HLS：一个 m3u8 清单 + 一串 ts 分片。浏览器里直接写
 * `<video src="https://…/index.m3u8">` 会失败，而且原因是三条互相独立的：
 *
 *   1. **CDN 校验 Referer/Origin**。媒体域名（`video.cmc.zju.edu.cn` 一类）只对
 *      「从课堂页面发出的」请求放行。`<video>` 发出的请求带的是本应用自己的
 *      Origin，于是被 403。这一层把 Referer/Origin 固定成课堂站点，补上这个缺口。
 *   2. **清单里的分片地址是相对路径、或带签名的绝对路径**。`index.m3u8` 里可能写
 *      `seg-1.ts`、`../v3/seg-1.ts?auth_key=…&expire=…`，甚至 `URI="key.bin"` 这类
 *      加密密钥引用。把清单原样交给浏览器，浏览器会**相对本应用的源**去解析这些
 *      路径 —— 请求打到本应用而不是 CDN，必然 404；就算解析对了，签名参数也得
 *      原样带着走。所以清单必须逐行改写成「也指向本端点」的绝对地址。
 *   3. **跨域**。即使前两条绕过，`<video>` 拉 m3u8 也要过 CORS。同源的本机端点
 *      没有这个问题。
 *
 * 一句话：本文件是这三个问题的**唯一**收敛点，且刻意做成「纯函数 + handler 工厂」，
 * 不 import cordis —— 这样它能被单独 import 进单测，挂载路由是宿主半边 `index.js`
 * 的事。它也**不碰** `ClassroomSource` 的登录会话：直播分片不需要 Cookie
 * （见下面「安全姿态」最后一段）。
 *
 * # 安全姿态（写错了就是一个 SSRF 跳板）
 *
 * 这个端点的语义是「你给一个 URL，我替你去取」，而取回的字节会**从浏览器可读**。
 * 内网服务、云元数据端点（`169.254.169.254`）、本机管理端口全在这条路径的射程内。
 * 所以下面几条是硬约束，不是建议：
 *
 *   - 目标 hostname **必须**匹配 `*.zju.edu.cn`（大小写不敏感）。这里刻意不用
 *     「屏蔽内网 IP / 内网网段」的黑名单：黑名单永远漏，而且 DNS 重绑定就能绕过
 *     （域名先解析到 1.2.3.4 过检查，再解析到 127.0.0.1）。白名单只有一条规则，
 *     能被一眼审完。
 *   - 只允许 `https:`。`http:` / `file:` / `data:` 直接排除。
 *   - 拒绝带 username/password 的 URL：`https://user:pass@host/` 会让 fetch 带上
 *     Basic 凭证，也让「看起来是这个主机」产生歧义。
 *   - 目标 URL 长度上限 4096。签名串通常几百字符，4096 足够，同时挡住「用超长
 *     URL 打爆解析器与日志」这类噪声。
 *   - 不跟随重定向。3xx 的 `Location` 是**另一个** URL，它没走过上面的 hostname
 *     校验；跟随等于免费绕开一次白名单。
 *   - 响应头**自己拼**，不透传上游的 `set-cookie`。那个 Cookie 属于媒体域名，转给
 *     浏览器等于让本应用的源替媒体域名种 cookie；而且 `set-cookie` 一旦带
 *     `Path=/`，浏览器之后会把它送到本应用的**其他**路由上。同理不吃
 *     `authorization`、不吃上游的 `content-encoding`（fetch 已经解过压了，
 *     再透传会让浏览器按 gzip 去解一段明文）。
 *   - 上游请求头是三个常量（Referer / Origin / User-Agent），**没有** Cookie 或
 *     Authorization。本端点不代用户登录，也就不该成为「带凭证访问白名单域」的
 *     通道 —— 那比纯粹的 SSRF 更糟。入站的 `Cookie` / `Authorization` 也一律
 *     丢弃，不转发、不记录。
 *   - 日志只记 `{ kind, host, path, bytes, ms, status }`。**绝不**记完整 URL ——
 *     分片地址的 query 里有 `auth_key` 签名，写进日志等于把播放凭证抄进磁盘。
 */

import { Readable } from 'node:stream';

/** 本端点占用的路由前缀。宿主半边注册 prefix 路由时用同一个常量。 */
export const STREAM_ROUTE_PREFIX = '/zhiyun-live';

/** 目标 URL 长度上限。m3u8 的签名串通常几百字符，4096 只用来拦住畸形请求。 */
const MAX_TARGET_URL_LENGTH = 4096;

/**
 * 唯一允许的出站域名规则：必须以 `.zju.edu.cn` 结尾。
 *
 * 用正则而不是 `hostname.endsWith('.zju.edu.cn')`，两者语义等价，但正则里的
 * `\.` 一眼就能看出这是「点分隔的子域」而不是字符串巧合；`i` 顺带处理大小写。
 * 注意它要求**至少一级子域**（裸 `zju.edu.cn` 不放行）—— 媒体与控制面都在子域上。
 */
const ALLOWED_HOST = /\.zju\.edu\.cn$/i;

/**
 * 固定的上游请求头。
 *
 * 三个头都是「证明请求来自课堂页面」所必需的，值写死：
 *
 *   - `Referer` / `Origin`：CDN 的白名单靠它们判断来源。
 *   - `User-Agent`：个别媒体网关对空 UA 直接拒。
 *
 * 对象是 `Object.freeze` 的，且只在本文件内部拼接 —— 调用方与 HTTP 请求都
 * 没有往里塞头的路径。
 */
const UPSTREAM_HEADERS = Object.freeze({
  Referer: 'https://classroom.zju.edu.cn/',
  Origin: 'https://classroom.zju.edu.cn',
  'User-Agent': 'Mozilla/5.0',
});

/** m3u8 判定之一：media type 里出现这些词（`application/vnd.apple.mpegurl` 等）。 */
const M3U8_CONTENT_TYPE = /mpegurl|m3u8/i;

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

/** 把目标 URL 改写成「指向本端点」的形式。清单里每一行都要过这个函数。 */
function buildUrl(target) {
  return `${STREAM_ROUTE_PREFIX}/hls?u=${encodeURIComponent(target)}`;
}

/**
 * 判断上游响应是不是 m3u8 清单。
 *
 * 两个条件取「或」而不是「与」：签名地址的 pathname 常常不带扩展名（CDN 用
 * `/v3/xxxx` 这种形式，靠 query 区分资源），而 content-type 在部分网关上是
 * `application/octet-stream`。任一条命中就按清单处理 —— 漏判的代价是「把一段文本
 * 当视频流原样吐给浏览器」，播放器只会静默失败，很难排查。
 */
function isPlaylist(contentType, target) {
  if (M3U8_CONTENT_TYPE.test(contentType)) return true;
  // 用 pathname 而不是原始 URL：`index.m3u8?auth_key=…` 的扩展名在 query 之前。
  return /\.m3u8$/i.test(target.pathname);
}

/**
 * 改写 m3u8 清单。
 *
 * 规则与 HLS 的语法一一对应：
 *
 *   - 空行原样保留（去掉也不会坏，但会让 diff 全是噪声）。
 *   - `#` 开头的行是标签。其中可能带 `URI="…"`（`#EXT-X-KEY`、`#EXT-X-MAP`、
 *     `#EXT-X-MEDIA`…），引号里的地址同样是资源、同样要转发，所以替换；
 *     其余标签原样。
 *   - 非 `#` 的行就是分片地址。相对路径必须用 `new URL(line, target)` 解析成
 *     绝对地址 —— 基准是**清单自己的** URL，不是本端点；这一步是整个改写的
 *     关键，漏了的话 `seg-1.ts` 会被解析到本应用根下。
 *
 * 注意 `new URL(u, target)` 只做解析、不做白名单校验，这是故意的：校验在 `hls`
 * 路由入口对**每个**被转发的 URL 各做一次（分片是浏览器再来请求的，天然
 * 重新过一遍 `checkTarget`）。这里若某行解析失败（畸形内容），就原样保留 ——
 * 让它在下游暴露成 403/400，比在改写阶段静默丢掉一行更容易查。
 */
export function rewritePlaylist(text, target) {
  const rewrite = (value) => {
    try {
      return buildUrl(new URL(value, target));
    } catch {
      return value;
    }
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (line === '') return line;
      // `URI="…"` 可能出现在任意 `#` 标签里，且一行里不止一处（少见但合法）。
      if (line.startsWith('#')) return line.replace(/URI="([^"]*)"/gi, (_all, uri) => `URI="${rewrite(uri)}"`);
      return rewrite(line.trim());
    })
    .join('\n');
}

/**
 * 校验目标 URL，返回 `{ ok: true, url }` 或 `{ ok: false, status, reason, host }`。
 *
 * 抽成纯函数是为了能单独断言：这几条判断本身就是安全边界，不该埋在 handler 的
 * 分支里等人读。顺序也有讲究 —— 先做不依赖解析的形状检查（长度），再协议、
 * 凭证，最后 hostname；这样拒绝原因对排查者是有意义的。
 */
export function checkTarget(raw) {
  if (typeof raw !== 'string' || raw === '') {
    return { ok: false, status: 400, reason: 'missing target' };
  }
  if (raw.length > MAX_TARGET_URL_LENGTH) {
    return { ok: false, status: 400, reason: 'target too long' };
  }
  let target;
  try {
    target = new URL(raw);
  } catch {
    return { ok: false, status: 400, reason: 'malformed target' };
  }
  // 只放行 https:。明文 HTTP 既能被中间人改写，也会让「只连白名单域」的承诺
  // 多出一个可降级的维度。
  if (target.protocol !== 'https:') {
    return { ok: false, status: 403, reason: 'protocol not allowed', host: target.hostname };
  }
  // userinfo 会让 fetch 带上 Basic 凭证，也让「看起来是这个主机」产生歧义。
  if (target.username !== '' || target.password !== '') {
    return { ok: false, status: 403, reason: 'credentials in target', host: target.hostname };
  }
  if (!ALLOWED_HOST.test(target.hostname)) {
    return { ok: false, status: 403, reason: 'host not allowed', host: target.hostname };
  }
  return { ok: true, url: target };
}

/**
 * 创建 `(req, res) => Promise<void>` 的 handler，供
 * `webServer.register({ kind: 'prefix', path: STREAM_ROUTE_PREFIX, handler })` 使用。
 *
 * ⚠️ 宿主 `WebRoute.handler` 的签名是 `(req: IncomingMessage, res: ServerResponse)
 *    => void | Promise<void>` —— 是 Node 的**响应所有权**模型，不是 Fetch 的
 *    `Request => Response`。所以这里全程自己 `writeHead` / `end` / `pipe`，
 *    绝不能返回一个 `Response` 对象（宿主不会去读它）。
 *
 * @param {object} [options]
 * @param {Function} [options.fetch] `globalThis.fetch`；注入点只为测试与离线验证。
 * @param {Function} [options.log] 诊断回调，收到安全元数据对象（绝不含 query）。
 * @param {number} [options.timeoutMs] 上游超时；超时回 504。
 */
export function createStreamHandler({ fetch = globalThis.fetch, log = () => {}, timeoutMs = 20000 } = {}) {
  /** `/zhiyun-live/hls` 与 `/zhiyun-live/status` 的实现。 */
  async function dispatch(res, url, kind) {
    if (kind === 'status') {
      sendJson(res, 200, {
        ok: true,
        // 明说「这是转发端点」而不是「媒体服务」：读状态的人不该以为这里有缓存。
        kind: 'live-stream-relay',
        route: `${STREAM_ROUTE_PREFIX}/hls`,
        params: { u: 'encodeURIComponent(目标 URL)' },
        allowedHost: ALLOWED_HOST.source,
        timeoutMs,
        cache: 'none',
      });
      return;
    }

    const check = checkTarget(url.searchParams.get('u'));
    if (!check.ok) {
      // 只记 host 与原因。被拒的 URL 本身也不进日志 —— 它同样可能带签名。
      log({ kind, host: check.host ?? null, path: null, bytes: 0, ms: 0, status: check.status, reason: check.reason });
      sendJson(res, check.status, { ok: false, error: check.reason });
      return;
    }

    const target = check.url;
    const started = Date.now();
    let bytes = 0;
    let settled = false;
    /**
     * 一条请求**只落一条**日志，且字段恰好是 `{ kind, host, path, bytes, ms, status }`。
     *
     * 两点都是刻意的：重复记会让一次失败在日志里出现两三行（排查时以为打了好几次），
     * 而 `reason` 只在对请求说「不」的那条分支上加 —— 那时还不知道 bytes/ms，
     * 也没有 `path`（被拒的 URL 连 pathname 都不该留在磁盘上）。
     */
    const settle = (status, reason) => {
      if (settled) return;
      settled = true;
      const entry = { kind, host: target.hostname, path: target.pathname, bytes, ms: Date.now() - started, status };
      if (reason !== undefined) entry.reason = reason;
      log(entry);
    };

    // `client` 表示「浏览器还在不在」；`timeout` 表示「上游是不是超时」。
    // 两者分开，是因为它们的响应语义完全不同（前者不回响应，后者回 504）。
    const client = new AbortController();
    const onClientClose = () => client.abort(new Error('client closed'));
    res.once('close', onClientClose);
    // 不挂这个空处理器时，res 在断连后的 'error' 会变成未捕获异常。
    res.on('error', () => {});

    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('timeout')), timeoutMs);
    const stopTimer = () => clearTimeout(timer);

    try {
      let response;
      try {
        response = await fetch(target.href, {
          method: 'GET',
          // 不透传任何入站头。上游只看得到下面这三个常量头。
          headers: { ...UPSTREAM_HEADERS },
          // 不跟随重定向：见文件头「安全姿态」。这里多解释一句为什么这对播放
          // 不是问题 —— 智云 CDN 给的是**已签名**的直链，不靠跳转拿地址；万一
          // 真回了 3xx，下面的 `!response.ok` 分支会把它收敛成 502 并留日志，
          // 而不是让 `<video>` 收到一段空的 3xx 响应后静默卡住。
          redirect: 'manual',
          signal: AbortSignal.any([client.signal, timeout.signal]),
        });
      } catch (error) {
        stopTimer();
        // 浏览器已经走了：响应写不出去，也就不必留日志噪声。
        if (client.signal.aborted) return;
        const timedOut = timeout.signal.aborted;
        const status = timedOut ? 504 : 502;
        // 具体原因只进日志（可能含内部主机名），不回给浏览器。
        settle(status, error instanceof Error ? error.message : String(error));
        sendJson(res, status, { ok: false, error: timedOut ? 'upstream timeout' : 'upstream request failed' });
        return;
      }

      const contentType = response.headers.get('content-type') ?? '';

      // 上游 4xx/5xx 不回给浏览器：那通常是 CDN 的错误页（或一张 403 的 HTML），
      // 转给 `<video>` 只会让它静默卡住。统一收敛成 502，只把状态码留在日志与
      // 响应体里（都是安全元数据，不含 URL）。
      if (!response.ok) {
        stopTimer();
        // 读掉并丢弃 body，否则这条连接不会被回收。
        await response.body?.cancel().catch(() => {});
        // 3xx 也走这里（`redirect: 'manual'` 下 3xx 的 `ok` 是 false）：把上游
        // 状态码作为安全元数据一起带出去，排查时能立刻分辨「CDN 说要跳转」和
        // 「CDN 说没权限」。
        settle(502, `upstream status ${response.status}`);
        sendJson(res, 502, { ok: false, error: 'upstream status not ok', upstreamStatus: response.status });
        return;
      }

      if (isPlaylist(contentType, target)) {
        // 清单只有几 KB，整份读完再改写。这里**不能**流式改写：一个 `URI="…"`
        // 可能跨 chunk 边界，逐块替换会把地址切坏。
        const raw = await response.text();
        stopTimer();
        const rewritten = rewritePlaylist(raw, target);
        bytes = Buffer.byteLength(rewritten);
        res.writeHead(200, {
          // 固定成标准 HLS 类型，不回传上游那个变体（有些网关给的是
          // `text/plain`，Safari 会因此不认）。
          'content-type': 'application/vnd.apple.mpegurl; charset=utf-8',
          'content-length': bytes,
          // 清单里带一次性签名，缓存它等于缓存一个过期凭证。
          'cache-control': 'no-store',
        });
        res.end(rewritten);
        settle(200);
        return;
      }

      // 分片：把上游 body 桥接给 res。`Readable.fromWeb` 是 Node 侧唯一稳定的
      // Web Stream → Node Stream 转换；手写 reader 循环很容易在背压上出错。
      if (!response.body) throw new Error('upstream body missing');
      // 头已经拿到，超时的使命结束：直播分片本来就允许慢（长连接是正常的），
      // 再用 20 秒去卡整段传输会把慢网用户直接踢掉。此后由 client 关闭决定生死。
      stopTimer();
      res.writeHead(200, {
        // content-type 只透这一个；缺省按 ts 分片补 `video/mp2t`。
        'content-type': contentType || 'video/mp2t',
        'cache-control': 'no-store',
      });
      const body = Readable.fromWeb(response.body);
      body.on('data', (chunk) => { bytes += chunk.length; });
      // 两侧任一出错都 destroy 对方：只 destroy 自己会留下半开的流，
      // 直播里反复切台就会攒下一堆这样的对（本仓 net-proxy/relay.js 同一姿态）。
      body.on('error', () => { if (!res.destroyed) res.destroy(); });
      res.on('error', () => { body.destroy(); });
      res.once('close', () => { body.destroy(); });
      // 流真正结束（对端收完，或浏览器断开）后才记日志：那时字节数才是最终值。
      res.once('close', () => settle(response.status));
      body.pipe(res);
      return;
    } catch (error) {
      // 读取中途失败（CDN 掐断、body 解码错误等）。头可能已经发出去了，
      // 那就只能断开；没发出去就还能给一个 502。
      stopTimer();
      // `settle` 自带去重：流式分支可能已经挂过 close 监听，这里再记也不会重复。
      settle(502, error instanceof Error ? error.message : String(error));
      if (!res.headersSent) sendJson(res, 502, { ok: false, error: 'upstream read failed' });
      else if (!res.destroyed) res.destroy();
    } finally {
      stopTimer();
      // 非流式分支已经写完响应了：断掉上游（幂等），并摘掉 close 监听。
      // 流式分支在 `body.pipe(res)` 后就 return 了，不会走到这里 —— 那条路径的
      // 清理交给 body 的 error/close 与 res 的 close。
      if (res.writableEnded) {
        res.removeListener('close', onClientClose);
        timeout.abort(new Error('done'));
      }
    }
  }

  return async function handler(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const sub = url.pathname.slice(STREAM_ROUTE_PREFIX.length);
    const kind = sub === '/hls' ? 'hls' : sub === '/status' ? 'status' : 'unknown';
    try {
      // 只服务 GET：这个端点没有任何写操作。用 405 而不是落到 404，免得排查时
      // 误以为路由没挂上。
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' }, { allow: 'GET' });
        return;
      }
      if (sub === '/status' || sub === '/hls') {
        await dispatch(res, url, kind);
        return;
      }
      sendJson(res, 404, { ok: false, error: `not found: ${url.pathname}` });
    } catch (error) {
      // 兜底：任何漏掉的异常都要收敛成一个响应。绝不能让宿主看到一个未处理的
      // rejection —— 那会挂到 webServer 的请求生命周期上，一条坏请求就能连累
      // 整个前端（本仓其他包的 handler 同一姿态）。
      if (!res.headersSent) sendJson(res, 502, { ok: false, error: 'stream relay failed' });
      else if (!res.destroyed) res.destroy();
      log({ kind, host: null, path: null, bytes: 0, ms: 0, status: 502, reason: error instanceof Error ? error.message : String(error) });
    }
  };
}
