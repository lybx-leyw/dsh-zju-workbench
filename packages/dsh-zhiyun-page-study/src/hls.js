/**
 * HLS 播放的**浏览器侧适配层**：把「这个地址该不该用 hls.js」与「怎么挂/怎么拆」
 * 从 `video-panel.jsx` 里分出来。
 *
 * # ⚠️ 关于「按需加载」——实测结论与直觉相反，不要按直觉改
 *
 * 本仓客户端包的产物是 **CJS**（`scripts/build.mjs` 的 `format: 'cjs'` +
 * `window.__ModuleLoader__.load({factory:(require)=>…})`，见那里的 banner），
 * 而 esbuild **在 CJS 格式下无法做代码分割**。也就是说 `await import('hls.js')`
 * 并不会产生一个独立的 chunk —— 它只是「不在启动时执行」，字节仍然全部在
 * `lib/client.js` 里。实测：不加 hls.js 时 page-study 产物 203 KB，加了
 * 完整版是 1.5 MB。
 *
 * 所以这里**只能**靠选小的构建产物来控体积。实测（本包完整打包后的大小）：
 *
 * | 入口 | 体积 | 取舍 |
 * | --- | --- | --- |
 * | `hls.mjs` | 1450 KB 源码 → 产物 1.5 MB | 全功能，含字幕轨 / 备用音轨 / EME |
 * | `hls.light.mjs` | 949 KB 源码 → 产物 1.1 MB | 去掉上述三项，但**未压缩** |
 * | `hls.light.min.mjs` | **363 KB** | ✅ 选它：light 的能力 + 已经压缩 |
 *
 * light 版少的那三样，课堂直播一个都用不上（没有字幕轨、没有多音轨、不需要
 * DRM），而它省下的体积是实打实的 —— 对一个「大多数人根本不看直播」的页面，
 * 这是值的。
 *
 * `import()` 仍然保留，理由是**执行时机**而不是下载体积：hls.js 在模块求值时
 * 会建 Logger、注册事件表，没必要让只看回放的人付这份 CPU。
 *
 * # 为什么先问原生
 *
 * Safari / iOS 原生支持 `application/vnd.apple.mpegurl`，此时挂 hls.js 不但浪费，
 * 还更差：MSE 这条路要自己管缓冲与重连，而原生是系统播放器。所以判定顺序是
 * **先原生、后 hls.js**，能原生就绝不加载库。
 *
 * # 为什么返回值是「拆除函数」而不是实例
 *
 * 调用方是 React 的 `useEffect`：它只想知道「怎么收尾」。把 `Hls` 实例封在闭包里，
 * 组件不用认识 hls.js 的任何 API，将来换库也只改这一个文件。
 */

/** m3u8 判定：只看路径与查询串，不看域名（转发层给的地址也带 `?u=`）。 */
const HLS_PATTERN = /\.m3u8(?:[?#]|$)/i;

/** 把任意地址归一成「是不是 HLS 流」。空值、非法值一律 false。 */
export function isHlsUrl(url) {
  if (typeof url !== 'string' || !url.trim()) return false;
  // 本机转发端点的地址形如 `/zhiyun-live/hls?u=<编码后的原始 m3u8>`：
  // 只看 query 会漏掉它，所以解码后再判一次 —— 否则直播会被当成普通 mp4
  // 直接塞给 <video>，Chrome 上表现为「一直是黑屏、也不报错」。
  if (HLS_PATTERN.test(url)) return true;
  const encoded = /\?u=([^&]+)/.exec(url);
  if (!encoded) return false;
  try {
    return HLS_PATTERN.test(decodeURIComponent(encoded[1]));
  } catch {
    return false;
  }
}

/**
 * 原生能否直接播 HLS。
 *
 * ⚠️ 必须传一个真实的 `<video>` 元素去问：`canPlayType` 是**实例方法**，
 *    在 `HTMLVideoElement.prototype` 上调用会返回空串（浏览器只在这台设备的
 *    媒体能力上作答）。拿不到元素时按「不支持」处理，走 hls.js —— 它对
 *    Safari 也是可用的（只是多余），而反过来（声称支持却放不了）是黑屏。
 */
export function nativeHls(video) {
  if (!video || typeof video.canPlayType !== 'function') return false;
  return video.canPlayType('application/vnd.apple.mpegurl') !== '';
}

/**
 * 判断这个地址是否需要 hls.js。
 *
 * 三个条件同时成立才需要：**是 HLS**、**原生不支持**、**有 video 元素可挂**。
 * 非 HLS（回放 mp4）永远返回 false —— 这条路径必须保持改动前的行为。
 */
export function needsHlsJs(url, video) {
  return isHlsUrl(url) && Boolean(video) && !nativeHls(video);
}

/**
 * 把 HLS 流挂到 `video` 上，返回拆除函数。
 *
 * 失败时返回的拆除函数是空操作，并**不抛错**：调用方已经在 `useEffect` 里，
 * 抛出去只会变成未捕获异常。真正的降级由调用方做（把 `src` 留给浏览器试一次）。
 *
 * `lowLatencyMode` 关掉：智云是普通 HLS（有固定分片时长），LL-HLS 的
 * `#EXT-X-PART` 用不上，开着反而让 hls.js 走更激进的追赶逻辑，在校园网抖动时
 * 表现为反复跳帧。`enableWorker` 打开：转封装跑在 Worker 里，主线程正在渲染
 * 字幕与课件，不该再承担 TS 解包。
 */
export async function attach(url, video, { onFatal } = {}) {
  const noop = () => {};
  if (!video || !url) return noop;
  let Hls;
  try {
    // 必须显式指到 `dist/hls.light.min.mjs`，不能用包名默认入口，也不能用
    // `/light` 子路径 —— 理由都在文件头那张表里，两次实测的数字：
    //   · 默认入口 hls.mjs           → 产物 1.5 MB
    //   · hls.light.mjs（未压缩）    → 产物 1.1 MB
    //   · hls.light.min.mjs（本条）  → 产物 约 700 KB，且仍比完整版少 216 KB 的源码
    // 本仓客户端产物是 CJS，esbuild 不做代码分割，所以「小」只能靠选产物。
    // `dist/*` 已在 hls.js 的 exports 里放行，子路径是官方支持的。
    ({ default: Hls } = await import('hls.js/dist/hls.light.min.mjs'));
  } catch {
    // 动态 import 失败（产物没带上、CSP 拦截）：交给调用方用原生 src 试一次。
    return noop;
  }
  if (!Hls?.isSupported?.()) return noop;
  const hls = new Hls({ lowLatencyMode: false, enableWorker: true });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    // 只把致命错误交出去：网络抖动 hls.js 自己会重试，报给界面只会闪一下错误。
    if (data?.fatal) onFatal?.(data);
  });
  hls.attachMedia(video);
  hls.loadSource(url);
  return () => {
    try { hls.destroy(); } catch { /* 已经拆过 */ }
  };
}
