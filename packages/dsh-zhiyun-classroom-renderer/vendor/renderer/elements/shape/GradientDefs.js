import { jsx } from 'react/jsx-runtime';

function GradientDefs({ id, type, colors, rotate = 0 }) {
    if (type === 'linear') {
        return (jsx("linearGradient", { id: id, x1: "0%", y1: "0%", x2: "100%", y2: "0%", gradientTransform: `rotate(${rotate},0.5,0.5)`, children: colors.map((item, index) => (jsx("stop", { offset: `${item.pos}%`, stopColor: item.color }, index))) }));
    }
    return (jsx("radialGradient", { id: id, children: colors.map((item, index) => (jsx("stop", { offset: `${item.pos}%`, stopColor: item.color }, index))) }));
}

export { GradientDefs };
//# sourceMappingURL=GradientDefs.js.map
