import { useMemo } from 'react';

function useElementFlip(flipH, flipV) {
    const flipStyle = useMemo(() => {
        let style = '';
        if (flipH && flipV)
            style = 'rotateX(180deg) rotateY(180deg)';
        else if (flipV)
            style = 'rotateX(180deg)';
        else if (flipH)
            style = 'rotateY(180deg)';
        return style;
    }, [flipH, flipV]);
    return { flipStyle };
}

export { useElementFlip };
//# sourceMappingURL=useElementFlip.js.map
