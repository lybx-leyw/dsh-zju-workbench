"use client";
import { jsxs, Fragment, jsx } from 'react/jsx-runtime';
import { useElementShadow } from '../shared/useElementShadow.js';
import { useElementFlip } from '../shared/useElementFlip.js';
import { useClipImage } from './useClipImage.js';
import { useFilter } from './useFilter.js';
import { ImageOutline } from './ImageOutline.js';

function BaseImageElement({ elementInfo, renderImage }) {
    const { shadowStyle } = useElementShadow(elementInfo.shadow);
    const { flipStyle } = useElementFlip(elementInfo.flipH, elementInfo.flipV);
    const { clipShape, imgPosition } = useClipImage(elementInfo);
    const { filter } = useFilter(elementInfo.filters);
    const src = elementInfo.src;
    // Soft-edge feather (a:softEdge): fade the image alpha to transparent over
    // `softEdge` px at every edge. Two intersecting linear-gradient masks feather
    // all four sides (corners get both). html2canvas-pro ignores CSS masks, so
    // slideToPng bakes the same feather into pixels via the data-soft-edge hook.
    const softEdge = elementInfo.softEdge && elementInfo.softEdge > 0 ? elementInfo.softEdge : undefined;
    const softEdgeMaskStyle = softEdge
        ? (() => {
            const grad = (dir) => `linear-gradient(${dir}, transparent 0, #000 ${softEdge}px, #000 calc(100% - ${softEdge}px), transparent 100%)`;
            const mask = `${grad('to right')}, ${grad('to bottom')}`;
            return {
                maskImage: mask,
                WebkitMaskImage: mask,
                maskComposite: 'intersect',
                WebkitMaskComposite: 'source-in',
                maskRepeat: 'no-repeat',
                WebkitMaskRepeat: 'no-repeat',
            };
        })()
        : {};
    const defaultContent = src ? (jsxs(Fragment, { children: [jsx("img", { src: src, draggable: false, "data-soft-edge": softEdge || undefined, 
                // Lazy + async decode: thumbnail surfaces (sidebar, nav rail, course
                // cards) mount far more images than the viewport needs. In-viewport
                // images are unaffected — the browser fetches them immediately.
                // slideToPng forces these back to eager in its off-screen tree.
                loading: "lazy", decoding: "async", style: {
                    position: 'absolute',
                    top: imgPosition.top,
                    left: imgPosition.left,
                    width: imgPosition.width,
                    height: imgPosition.height,
                    maxWidth: 'none',
                    maxHeight: 'none',
                    filter,
                    ...softEdgeMaskStyle,
                }, alt: "", onDragStart: (e) => e.preventDefault() }), elementInfo.colorMask && (jsx("div", { style: {
                    position: 'absolute',
                    inset: 0,
                    backgroundColor: elementInfo.colorMask,
                } }))] })) : null;
    return (jsx("div", { className: "base-element-image element-content", style: {
            position: 'absolute',
            top: `${elementInfo.top}px`,
            left: `${elementInfo.left}px`,
            width: `${elementInfo.width}px`,
            height: `${elementInfo.height}px`,
        }, children: jsx("div", { style: {
                width: '100%',
                height: '100%',
                transform: `rotate(${elementInfo.rotate}deg)`,
            }, children: jsxs("div", { style: {
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
                    transform: flipStyle,
                }, children: [jsx(ImageOutline, { elementInfo: elementInfo }), jsx("div", { style: {
                            position: 'relative',
                            width: '100%',
                            height: '100%',
                            overflow: 'hidden',
                            clipPath: clipShape.style,
                            pointerEvents: renderImage ? 'auto' : undefined,
                        }, children: renderImage ? renderImage(elementInfo, src, defaultContent) : defaultContent })] }) }) }));
}

export { BaseImageElement };
//# sourceMappingURL=BaseImageElement.js.map
