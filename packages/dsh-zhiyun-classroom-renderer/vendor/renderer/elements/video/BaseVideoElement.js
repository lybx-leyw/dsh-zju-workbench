"use client";
import { jsx } from 'react/jsx-runtime';

function BaseVideoElement({ elementInfo, renderVideo, interactive = true, }) {
    return (jsx("div", { className: "base-element-video element-content", "data-video-element": true, style: {
            position: 'absolute',
            top: `${elementInfo.top}px`,
            left: `${elementInfo.left}px`,
            width: `${elementInfo.width}px`,
            height: `${elementInfo.height}px`,
            pointerEvents: interactive ? 'auto' : 'none',
        }, onClick: interactive ? (e) => e.stopPropagation() : undefined, onPointerDown: interactive ? (e) => e.stopPropagation() : undefined, children: jsx("div", { style: {
                width: '100%',
                height: '100%',
                transform: `rotate(${elementInfo.rotate}deg)`,
            }, children: renderVideo ? (renderVideo(elementInfo)) : elementInfo.src || elementInfo.poster ? (
            // Render <video> when we have either a playable src OR just a
            // poster/preview frame. A PPTX「视频」often has no decodable src in
            // this pipeline but does carry a preview image; rendering
            // <video poster> still shows that frame on the live canvas (instead
            // of falling through to the gray play-icon placeholder — slide 34).
            // Snapshot capture of the poster frame is handled in slideToPng
            // (html2canvas can't draw <video> directly).
            jsx("video", { style: { width: '100%', height: '100%', objectFit: 'contain' }, ...(elementInfo.src ? { src: elementInfo.src } : {}), poster: elementInfo.poster, preload: "metadata", controls: !!elementInfo.src, playsInline: true })) : (jsx("div", { style: {
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.1)',
                    borderRadius: '4px',
                }, children: jsx("svg", { style: { width: '48px', height: '48px', color: '#9ca3af' }, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", children: jsx("polygon", { points: "5 3 19 12 5 21 5 3" }) }) })) }) }));
}

export { BaseVideoElement };
//# sourceMappingURL=BaseVideoElement.js.map
