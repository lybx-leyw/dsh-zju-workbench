"use client";
import { jsxs, jsx } from 'react/jsx-runtime';

function HighlightOverlay({ element, options }) {
    if (element.type === 'line')
        return null;
    const color = options?.color ?? '#ff6b6b';
    const opacity = options?.opacity ?? 0.3;
    const borderWidth = options?.borderWidth ?? 3;
    const animated = options?.animated ?? true;
    const height = 'height' in element ? element.height : 0;
    const rotate = 'rotate' in element ? element.rotate : 0;
    return (jsxs("div", { className: "highlight-overlay", style: {
            position: 'absolute',
            pointerEvents: 'none',
            left: `${element.left}px`,
            top: `${element.top}px`,
            width: `${element.width}px`,
            height: `${height}px`,
            transform: `rotate(${rotate || 0}deg)`,
            transformOrigin: 'center',
            zIndex: 999,
            transition: 'all 0.3s ease-in-out',
        }, children: [jsx("div", { className: animated ? 'slide-renderer-pulse' : undefined, style: {
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '4px',
                    border: `${borderWidth}px solid ${color}`,
                    boxShadow: `0 0 ${borderWidth * 3}px ${color}, inset 0 0 ${borderWidth * 2}px rgba(255,255,255,${opacity * 0.5})`,
                    backgroundColor: `${color}${Math.round(opacity * 255)
                        .toString(16)
                        .padStart(2, '0')}`,
                } }), animated && (jsx("div", { className: "slide-renderer-ping", style: {
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '4px',
                    border: `${borderWidth}px solid ${color}`,
                    opacity: 0.5,
                    animationDuration: '2s',
                } }))] }));
}

export { HighlightOverlay };
//# sourceMappingURL=HighlightOverlay.js.map
