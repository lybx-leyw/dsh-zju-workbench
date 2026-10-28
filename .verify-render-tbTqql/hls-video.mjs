// packages/dsh-zhiyun-page-study/src/hls-video.jsx
import React, { useEffect, useRef, useState } from "react";

// stub:hls-stub
var HLS_PATTERN = /\.m3u8(?:[?#]|$)/i;
function isHlsUrl(url) {
  if (typeof url !== "string" || !url.trim()) return false;
  if (HLS_PATTERN.test(url)) return true;
  const m = /\?u=([^&]+)/.exec(url);
  if (!m) return false;
  try {
    return HLS_PATTERN.test(decodeURIComponent(m[1]));
  } catch {
    return false;
  }
}
function nativeHls() {
  return false;
}
function needsHlsJs(url, video) {
  return isHlsUrl(url) && Boolean(video) && !nativeHls(video);
}
async function attach() {
  return () => {
  };
}

// packages/dsh-zhiyun-page-study/src/hls-video.jsx
import { jsx } from "react/jsx-runtime";
var HlsVideo = React.forwardRef(function HlsVideo2({ src, live = false, className, ...rest }, forwarded) {
  const ref = useRef(null);
  const [fallback, setFallback] = useState("");
  const target = src || "";
  const useNativeSrc = Boolean(target) && (fallback === target || !isHlsUrl(target));
  const setRef = (node) => {
    ref.current = node;
    if (typeof forwarded === "function") forwarded(node);
    else if (forwarded) forwarded.current = node;
  };
  useEffect(() => {
    const video = ref.current;
    if (!video || !target) return void 0;
    if (!needsHlsJs(target, video)) return void 0;
    let disposed = false, detach = () => {
    };
    video.removeAttribute("src");
    void attach(target, video, { onFatal: () => {
      if (!disposed) setFallback(target);
    } }).then((destroy) => {
      if (disposed) destroy();
      else detach = destroy;
    });
    return () => {
      disposed = true;
      detach();
    };
  }, [target]);
  return /* @__PURE__ */ jsx(
    "video",
    {
      ref: setRef,
      className,
      ...useNativeSrc ? { src: target } : {},
      controls: true,
      autoPlay: live,
      muted: live,
      playsInline: true,
      preload: live ? "none" : "metadata",
      ...rest
    }
  );
});
export {
  HlsVideo
};
