import { useMemo } from 'react';

function useElementFill(element, source) {
    const fill = useMemo(() => {
        if (element.pattern)
            return `url(#${source}-pattern-${element.id})`;
        if (element.gradient)
            return `url(#${source}-gradient-${element.id})`;
        return element.fill || 'none';
    }, [element.pattern, element.gradient, element.fill, element.id, source]);
    return { fill };
}

export { useElementFill };
//# sourceMappingURL=useElementFill.js.map
