// HLS 直播的 `<video>`：一处接线，两个面板共用。
//
// # 为什么是组件而不是在两处各写一遍 useEffect
//
// 「直播」栏（`study-workspace.jsx` 的 `LivePane`）与「视频」栏（`video-panel.jsx`）
// 都会碰到 m3u8：前者是直播，后者是回放地址偶尔也会是 HLS。两处各写一份
// `new Hls()` 最直接的后果不是重复代码，而是**两个 MSE 实例可能同时挂在一个
// 播放器上**（切栏时旧的还没拆、新的已经 attach），表现为画面卡在第一帧而
// 控制条还在走 —— 比功能缺失难查得多。收在一个组件里，挂载与拆除天然成对。
//
// # 为什么非要 `useEffect` 而不用 `src`
//
// Chrome / Edge 的 `<video>` 不认识 m3u8：直接写 `src` 是黑屏且**不报错**。
// Safari 认识，所以原生优先（见 `hls.js` 的 `nativeHls`）。这个判断依赖真实
// 元素，只能在 ref 挂上之后做 —— 也就是 `useEffect`。
import React, { useEffect, useRef, useState } from 'react';
import { attach, needsHlsJs } from './hls.js';

/**
 * @param src - 流地址。空值时只渲染空播放器，不做任何接线。
 * @param live - 直播态：直播要 `autoPlay` + `muted`（浏览器自动播放策略要求
 *               两者同时成立），回放不要自动播 —— 那是用户点进来的，得他自己按。
 * @param videoRef - 可选的**外部 ref**。回放栏要拿 `currentTime` 驱动时间轴，
 *                   必须能摸到真正的 `<video>` 元素；只在组件内部 ref 会让
 *                   它拿不到节点。两条 ref 都指向同一个元素。
 */
export const HlsVideo = React.forwardRef(function HlsVideo({ src, live = false, className, ...rest }, forwarded) {
  const ref = useRef(null);
  // 挂 hls.js 失败时把地址退回给浏览器原生试一次。用 state 而不是直接改 DOM，
  // 是为了让「有没有走降级」体现在渲染结果里，而不是一个看不见的隐式副作用。
  const [fallback, setFallback] = useState('');
  const target = src || '';
  const usingFallback = fallback === target && Boolean(target);

  // 内部 ref 干活，外部 ref（如果有）跟着指向同一个节点。
  const setRef = (node) => {
    ref.current = node;
    if (typeof forwarded === 'function') forwarded(node);
    else if (forwarded) forwarded.current = node;
  };

  useEffect(() => {
    const video = ref.current;
    if (!video || !target) return undefined;
    // 非 HLS（普通 mp4）与「原生就能播」两种都不该加载 hls.js。
    if (!needsHlsJs(target, video)) return undefined;
    let disposed = false, detach = () => {};
    // 不直接 `video.src = target`：Chrome 会把 m3u8 当成不认识的类型静默失败。
    // 先清掉 src，避免上一次降级留下的地址与 MSE 抢同一个元素。
    video.removeAttribute('src');
    void attach(target, video, { onFatal: () => { if (!disposed) setFallback(target); } })
      .then((destroy) => {
        // 组件可能在 import 还没回来时就卸载了：这时候必须立刻拆掉，
        // 否则那个 Hls 实例会挂在一个已经不在文档里的元素上继续拉流。
        if (disposed) destroy();
        else detach = destroy;
      });
    return () => { disposed = true; detach(); };
  }, [target]);

  return <video
    ref={setRef}
    className={className}
    {...(usingFallback ? { src: target } : {})}
    controls
    autoPlay={live}
    muted={live}
    playsInline
    preload={live ? 'none' : 'metadata'}
    {...rest}
  />;
});
