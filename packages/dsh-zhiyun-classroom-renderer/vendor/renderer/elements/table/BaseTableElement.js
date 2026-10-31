"use client";
import { jsx } from 'react/jsx-runtime';
import { StaticTable } from './StaticTable.js';

function BaseTableElement({ elementInfo, target, renderContent }) {
    const defaultContent = jsx(StaticTable, { elementInfo: elementInfo });
    return (jsx("div", { className: "base-element-table", style: {
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
            }, children: jsx("div", { className: "element-content", style: { width: '100%', height: '100%' }, children: renderContent?.(elementInfo, defaultContent) ?? defaultContent }) }) }));
}

export { BaseTableElement };
//# sourceMappingURL=BaseTableElement.js.map
