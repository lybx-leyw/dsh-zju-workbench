"use client";
import { jsx } from 'react/jsx-runtime';
import { useElementOutline } from './useElementOutline.js';

function ElementOutline({ width, height, outline }) {
    const { outlineWidth, outlineColor, strokeDashArray } = useElementOutline(outline);
    if (!outline)
        return null;
    return (jsx("svg", { className: "element-outline", style: { position: 'absolute', top: 0, left: 0, overflow: 'visible' }, width: width, height: height, children: jsx("path", { vectorEffect: "non-scaling-stroke", strokeLinecap: "butt", strokeMiterlimit: "8", fill: "transparent", d: `M0,0 L${width},0 L${width},${height} L0,${height} Z`, stroke: outlineColor, strokeWidth: outlineWidth, strokeDasharray: strokeDashArray }) }));
}

export { ElementOutline };
//# sourceMappingURL=ElementOutline.js.map
