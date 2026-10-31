import { useMemo } from 'react';

const FILTER_UNITS = {
    blur: 'px',
    brightness: '%',
    contrast: '%',
    grayscale: '%',
    saturate: '%',
    'hue-rotate': 'deg',
    sepia: '%',
    invert: '%',
    opacity: '%',
};
function useFilter(filters) {
    const filter = useMemo(() => {
        return imageFiltersToCss(filters);
    }, [filters]);
    return { filter };
}
function imageFiltersToCss(filters) {
    if (!filters)
        return '';
    const parts = [];
    for (const [name, value] of Object.entries(filters)) {
        if (value === undefined || value === null || value === '')
            continue;
        const unit = FILTER_UNITS[name] ?? '';
        const rendered = unit && !value.endsWith(unit) ? `${value}${unit}` : value;
        parts.push(`${name}(${rendered})`);
    }
    return parts.join(' ');
}

export { imageFiltersToCss, useFilter };
//# sourceMappingURL=useFilter.js.map
