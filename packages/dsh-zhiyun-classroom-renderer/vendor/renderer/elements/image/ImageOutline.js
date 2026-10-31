"use client";
import { jsxs, jsx } from 'react/jsx-runtime';
import { useElementOutline } from '../shared/useElementOutline.js';
import { useClipImage } from './useClipImage.js';

function ImageRectOutline({ width, height, outline, radius = '0' }) {
    const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);
    if (!outline)
        return null;
    return (jsx("svg", { style: { position: 'absolute', top: 0, left: 0, zIndex: 2, overflow: 'visible' }, width: width, height: height, children: jsx("rect", { vectorEffect: "non-scaling-stroke", strokeLinecap: "butt", strokeMiterlimit: "8", fill: "transparent", rx: radius, ry: radius, width: width, height: height, stroke: outlineColor, strokeWidth: outlineWidth, strokeDasharray: strokeDashArray }) }));
}
function ImageEllipseOutline({ width, height, outline }) {
    const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);
    if (!outline)
        return null;
    return (jsx("svg", { style: { position: 'absolute', top: 0, left: 0, zIndex: 2, overflow: 'visible' }, width: width, height: height, children: jsx("ellipse", { vectorEffect: "non-scaling-stroke", strokeLinecap: "butt", strokeMiterlimit: "8", fill: "transparent", cx: width / 2, cy: height / 2, rx: width / 2, ry: height / 2, stroke: outlineColor, strokeWidth: outlineWidth, strokeDasharray: strokeDashArray }) }));
}
function ImagePolygonOutline({ width, height, createPath, outline }) {
    const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);
    if (!outline)
        return null;
    return (jsx("svg", { style: { position: 'absolute', top: 0, left: 0, zIndex: 2, overflow: 'visible' }, width: width, height: height, children: jsx("path", { vectorEffect: "non-scaling-stroke", strokeLinecap: "butt", strokeMiterlimit: "8", fill: "transparent", d: createPath(width, height), stroke: outlineColor, strokeWidth: outlineWidth, strokeDasharray: strokeDashArray }) }));
}
function ImageOutline({ elementInfo }) {
    const { clipShape } = useClipImage(elementInfo);
    return (jsxs("div", { className: "image-outline", children: [clipShape.type === 'rect' && (jsx(ImageRectOutline, { width: elementInfo.width, height: elementInfo.height, radius: clipShape.radius, outline: elementInfo.outline })), clipShape.type === 'ellipse' && (jsx(ImageEllipseOutline, { width: elementInfo.width, height: elementInfo.height, outline: elementInfo.outline })), clipShape.type === 'polygon' && clipShape.createPath && (jsx(ImagePolygonOutline, { width: elementInfo.width, height: elementInfo.height, outline: elementInfo.outline, createPath: clipShape.createPath }))] }));
}

export { ImageOutline };
//# sourceMappingURL=ImageOutline.js.map
