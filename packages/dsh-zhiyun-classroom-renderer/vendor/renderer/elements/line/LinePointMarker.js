import { jsx } from 'react/jsx-runtime';

const pathMap = {
    dot: 'm0 5a5 5 0 1 0 10 0a5 5 0 1 0 -10 0z',
    arrow: 'M0,0 L10,5 0,10 Z',
};
const rotateMap = {
    'arrow-start': 180,
    'arrow-end': 0,
};
function LinePointMarker({ id, position, type, baseSize, color }) {
    const path = pathMap[type];
    const rotate = rotateMap[`${type}-${position}`] || 0;
    const size = baseSize < 2 ? 2 : baseSize;
    return (jsx("marker", { id: `${id}-${type}-${position}`, markerUnits: "userSpaceOnUse", orient: "auto", markerWidth: size * 3, markerHeight: size * 3, refX: size * 1.5, refY: size * 1.5, children: jsx("path", { d: path, fill: color, transform: `scale(${size * 0.3}, ${size * 0.3}) rotate(${rotate}, 5, 5)` }) }));
}

export { LinePointMarker };
//# sourceMappingURL=LinePointMarker.js.map
