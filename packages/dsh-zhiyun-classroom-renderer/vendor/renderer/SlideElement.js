"use client";
import { jsxs, Fragment, jsx } from 'react/jsx-runtime';
import { memo, useMemo } from 'react';
import { ElementTypes } from '../dsl/index.js';
import { BaseImageElement } from './elements/image/BaseImageElement.js';
import { BaseTextElement } from './elements/text/BaseTextElement.js';
import { BaseShapeElement } from './elements/shape/BaseShapeElement.js';
import { BaseLineElement } from './elements/line/BaseLineElement.js';
import { BaseChartElement } from './elements/chart/BaseChartElement.js';
import { BaseLatexElement } from './elements/latex/BaseLatexElement.js';
import { BaseTableElement } from './elements/table/BaseTableElement.js';
import { BaseVideoElement } from './elements/video/BaseVideoElement.js';
import { BaseAudioElement } from './elements/audio/BaseAudioElement.js';
import { BaseCodeElement } from './elements/code/BaseCodeElement.js';

const DEFAULT_THEME = {
    fontColor: '#333333',
    fontName: 'Microsoft YaHei',
};
const SlideElementContent = memo(function SlideElementContent({ elementInfo, animate, renderImage, renderVideo, renderText, renderShapeLabel, renderTable, videoInteractive, }) {
    const Component = useMemo(() => {
        switch (elementInfo.type) {
            case ElementTypes.IMAGE:
                return 'image';
            case ElementTypes.TEXT:
                return 'text';
            case ElementTypes.SHAPE:
                return 'shape';
            case ElementTypes.LINE:
                return 'line';
            case ElementTypes.CHART:
                return 'chart';
            case ElementTypes.LATEX:
                return 'latex';
            case ElementTypes.TABLE:
                return 'table';
            case ElementTypes.VIDEO:
                return 'video';
            case ElementTypes.AUDIO:
                return 'audio';
            case ElementTypes.CODE:
                return 'code';
            default:
                return null;
        }
    }, [elementInfo.type]);
    if (!Component)
        return null;
    return (jsxs(Fragment, { children: [Component === 'text' && elementInfo.type === 'text' && (jsx(BaseTextElement, { elementInfo: elementInfo, renderContent: renderText })), Component === 'shape' && elementInfo.type === 'shape' && (jsx(BaseShapeElement, { elementInfo: elementInfo, renderLabel: renderShapeLabel })), Component === 'image' && elementInfo.type === 'image' && (jsx(BaseImageElement, { elementInfo: elementInfo, renderImage: renderImage })), Component === 'line' && elementInfo.type === 'line' && (jsx(BaseLineElement, { elementInfo: elementInfo, animate: animate })), Component === 'chart' && elementInfo.type === 'chart' && (jsx(BaseChartElement, { elementInfo: elementInfo })), Component === 'latex' && elementInfo.type === 'latex' && (jsx(BaseLatexElement, { elementInfo: elementInfo })), Component === 'table' && elementInfo.type === 'table' && (jsx(BaseTableElement, { elementInfo: elementInfo, renderContent: renderTable })), Component === 'video' && elementInfo.type === 'video' && (jsx(BaseVideoElement, { elementInfo: elementInfo, renderVideo: renderVideo, interactive: videoInteractive })), Component === 'audio' && elementInfo.type === 'audio' && (jsx(BaseAudioElement, { elementInfo: elementInfo })), Component === 'code' && elementInfo.type === 'code' && (jsx(BaseCodeElement, { elementInfo: elementInfo, animate: animate }))] }));
});
const SlideElement = memo(function SlideElement({ elementInfo, elementIndex, theme, animate, renderImage, renderVideo, renderText, renderShapeLabel, renderTable, videoInteractive, onElementClick, idPrefix = 'slide-element-', dragOffset, }) {
    const fontColor = theme?.fontColor ?? DEFAULT_THEME.fontColor;
    const fontName = theme?.fontName ?? DEFAULT_THEME.fontName;
    return (jsx("div", { className: "slide-element", id: `${idPrefix}${elementInfo.id}`, style: {
            position: 'absolute',
            inset: 0,
            zIndex: elementIndex,
            color: fontColor,
            fontFamily: fontName,
            pointerEvents: 'none',
        }, onClick: onElementClick ? (e) => onElementClick(elementInfo, e) : undefined, children: jsx("div", { className: "slide-element-hit-target", style: {
                pointerEvents: onElementClick ? 'auto' : undefined,
                transform: dragOffset
                    ? `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`
                    : undefined,
                willChange: dragOffset ? 'transform' : undefined,
            }, children: jsx(SlideElementContent, { elementInfo: elementInfo, animate: animate, renderImage: renderImage, renderVideo: renderVideo, renderText: renderText, renderShapeLabel: renderShapeLabel, renderTable: renderTable, videoInteractive: videoInteractive }) }) }));
});

export { SlideElement };
//# sourceMappingURL=SlideElement.js.map
