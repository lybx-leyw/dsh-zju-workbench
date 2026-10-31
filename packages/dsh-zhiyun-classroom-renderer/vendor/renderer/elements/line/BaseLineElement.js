"use client";
import { jsx, jsxs } from 'react/jsx-runtime';
import { useRef, useState, useId, useMemo, useEffect } from 'react';
import { getLineElementPath } from '../../utils/element.js';
import { useElementShadow } from '../shared/useElementShadow.js';
import { LinePointMarker } from './LinePointMarker.js';

const DRAW_ANIMATION_MS = 600;
function BaseLineElement({ elementInfo, animate }) {
    const { shadowStyle } = useElementShadow(elementInfo.shadow);
    const pathRef = useRef(null);
    const [drawComplete, setDrawComplete] = useState(!animate);
    const markerId = `${elementInfo.id}-${useId().replaceAll(':', '')}`;
    const svgWidth = useMemo(() => {
        const width = Math.abs(elementInfo.start[0] - elementInfo.end[0]);
        return width < 24 ? 24 : width;
    }, [elementInfo.start, elementInfo.end]);
    const svgHeight = useMemo(() => {
        const height = Math.abs(elementInfo.start[1] - elementInfo.end[1]);
        return height < 24 ? 24 : height;
    }, [elementInfo.start, elementInfo.end]);
    const lineDashArray = useMemo(() => {
        const size = elementInfo.width;
        if (elementInfo.style === 'dashed')
            return size <= 8 ? `${size * 5} ${size * 2.5}` : `${size * 5} ${size * 1.5}`;
        if (elementInfo.style === 'dotted')
            return size <= 8 ? `${size * 1.8} ${size * 1.6}` : `${size * 1.5} ${size * 1.2}`;
        return '0 0';
    }, [elementInfo.width, elementInfo.style]);
    const path = useMemo(() => getLineElementPath(elementInfo), [elementInfo]);
    useEffect(() => {
        if (!animate)
            return;
        const pathEl = pathRef.current;
        if (!pathEl)
            return;
        const length = pathEl.getTotalLength();
        if (length === 0) {
            const t = setTimeout(() => setDrawComplete(true), 0);
            return () => clearTimeout(t);
        }
        pathEl.style.strokeDasharray = `${length}`;
        pathEl.style.strokeDashoffset = `${length}`;
        pathEl.style.transition = 'none';
        pathEl.getBoundingClientRect();
        pathEl.style.transition = `stroke-dashoffset ${DRAW_ANIMATION_MS}ms ease-out`;
        pathEl.style.strokeDashoffset = '0';
        const timer = setTimeout(() => {
            pathEl.style.transition = 'none';
            pathEl.style.strokeDasharray = '';
            pathEl.style.strokeDashoffset = '';
            setDrawComplete(true);
        }, DRAW_ANIMATION_MS + 50);
        return () => clearTimeout(timer);
    }, [animate]);
    return (jsx("div", { className: "base-element-line", style: {
            position: 'absolute',
            top: `${elementInfo.top}px`,
            left: `${elementInfo.left}px`,
        }, children: jsx("div", { className: "element-content", style: {
                position: 'relative',
                width: '100%',
                height: '100%',
                filter: shadowStyle ? `drop-shadow(${shadowStyle})` : '',
            }, children: jsxs("svg", { overflow: "visible", width: svgWidth, height: svgHeight, style: { transformOrigin: '0 0', overflow: 'visible' }, children: [jsxs("defs", { children: [elementInfo.points[0] && (jsx(LinePointMarker, { id: markerId, position: "start", type: elementInfo.points[0], color: elementInfo.color, baseSize: elementInfo.width })), elementInfo.points[1] && (jsx(LinePointMarker, { id: markerId, position: "end", type: elementInfo.points[1], color: elementInfo.color, baseSize: elementInfo.width }))] }), jsx("path", { ref: pathRef, d: path, stroke: elementInfo.color, strokeWidth: elementInfo.width, strokeDasharray: lineDashArray, fill: "none", markerStart: drawComplete && elementInfo.points[0]
                            ? `url(#${markerId}-${elementInfo.points[0]}-start)`
                            : '', markerEnd: drawComplete && elementInfo.points[1]
                            ? `url(#${markerId}-${elementInfo.points[1]}-end)`
                            : '' })] }) }) }));
}

export { BaseLineElement };
//# sourceMappingURL=BaseLineElement.js.map
