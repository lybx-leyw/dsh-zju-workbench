"use client";
import { jsx, jsxs } from 'react/jsx-runtime';
import { ElementOutline } from '../shared/ElementOutline.js';
import { Chart } from './Chart.js';

function BaseChartElement({ elementInfo, target }) {
    return (jsx("div", { className: "base-element-chart", style: {
            position: 'absolute',
            top: `${elementInfo.top}px`,
            left: `${elementInfo.left}px`,
            width: `${elementInfo.width}px`,
            height: `${elementInfo.height}px`,
            pointerEvents: target === 'thumbnail' ? 'none' : undefined,
        }, children: jsx("div", { className: "rotate-wrapper", style: {
                width: '100%',
                height: '100%',
                transform: `rotate(${elementInfo.rotate}deg)`,
            }, children: jsxs("div", { className: "element-content", style: { width: '100%', height: '100%', backgroundColor: elementInfo.fill }, children: [jsx(ElementOutline, { width: elementInfo.width, height: elementInfo.height, outline: elementInfo.outline }), jsx(Chart, { width: elementInfo.width, height: elementInfo.height, type: elementInfo.chartType, data: elementInfo.data, themeColors: elementInfo.themeColors, textColor: elementInfo.textColor, lineColor: elementInfo.lineColor, options: elementInfo.options, importedStyle: elementInfo.importedStyle })] }) }) }));
}

export { BaseChartElement };
//# sourceMappingURL=BaseChartElement.js.map
