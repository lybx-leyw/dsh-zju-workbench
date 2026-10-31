import { useMemo } from 'react';

function useElementShadow(shadow) {
    const shadowStyle = useMemo(() => {
        if (shadow) {
            const { h, v, blur, color } = shadow;
            return `${h}px ${v}px ${blur}px ${color}`;
        }
        return '';
    }, [shadow]);
    return { shadowStyle };
}

export { useElementShadow };
//# sourceMappingURL=useElementShadow.js.map
