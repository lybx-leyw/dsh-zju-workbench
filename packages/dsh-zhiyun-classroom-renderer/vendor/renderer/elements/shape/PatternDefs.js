import { jsx } from 'react/jsx-runtime';

function PatternDefs({ id, src }) {
    return (jsx("pattern", { id: id, patternContentUnits: "objectBoundingBox", patternUnits: "objectBoundingBox", width: "1", height: "1", children: jsx("image", { href: src, width: "1", height: "1", preserveAspectRatio: "xMidYMid slice" }) }));
}

export { PatternDefs };
//# sourceMappingURL=PatternDefs.js.map
