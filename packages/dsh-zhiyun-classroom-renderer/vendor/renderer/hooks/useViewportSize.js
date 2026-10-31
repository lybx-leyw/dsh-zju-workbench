import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

/**
 * Compute the viewport rect and fit-scale needed to center a slide of size
 * `viewportSize × viewportSize*viewportRatio` inside `canvasRef`.
 *
 * Pure: no store access. Re-runs on container resize via ResizeObserver.
 */
function useViewportSize(canvasRef, options = {}) {
    const { viewportSize = 1000, viewportRatio = 0.5625, canvasPercentage = 100, onScaleChange, } = options;
    const [viewportLeft, setViewportLeft] = useState(0);
    const [viewportTop, setViewportTop] = useState(0);
    const [fitScale, setFitScale] = useState(1);
    const lastReportedScaleRef = useRef(undefined);
    const wasReportingScaleRef = useRef(false);
    const updateFitScale = useCallback((nextScale) => {
        if (Object.is(lastReportedScaleRef.current, nextScale))
            return;
        lastReportedScaleRef.current = nextScale;
        setFitScale(nextScale);
        onScaleChange?.(nextScale);
    }, [onScaleChange]);
    useEffect(() => {
        const isReportingScale = onScaleChange !== undefined;
        if (isReportingScale && !wasReportingScaleRef.current) {
            lastReportedScaleRef.current = undefined;
        }
        wasReportingScaleRef.current = isReportingScale;
    }, [onScaleChange]);
    const computeFit = useCallback(() => {
        if (!canvasRef.current)
            return;
        const canvasWidth = canvasRef.current.clientWidth;
        const canvasHeight = canvasRef.current.clientHeight;
        if (canvasHeight / canvasWidth > viewportRatio) {
            const viewportActualWidth = canvasWidth * (canvasPercentage / 100);
            const nextScale = viewportActualWidth / viewportSize;
            updateFitScale(nextScale);
            setViewportLeft((canvasWidth - viewportActualWidth) / 2);
            setViewportTop((canvasHeight - viewportActualWidth * viewportRatio) / 2);
        }
        else {
            const viewportActualHeight = canvasHeight * (canvasPercentage / 100);
            const nextScale = viewportActualHeight / (viewportSize * viewportRatio);
            updateFitScale(nextScale);
            setViewportLeft((canvasWidth - viewportActualHeight / viewportRatio) / 2);
            setViewportTop((canvasHeight - viewportActualHeight) / 2);
        }
    }, [canvasRef, canvasPercentage, updateFitScale, viewportRatio, viewportSize]);
    useEffect(() => {
        computeFit();
    }, [computeFit]);
    useEffect(() => {
        const el = canvasRef.current;
        if (!el)
            return;
        const resizeObserver = new ResizeObserver(computeFit);
        resizeObserver.observe(el);
        return () => resizeObserver.unobserve(el);
    }, [canvasRef, computeFit]);
    const viewportStyles = useMemo(() => ({
        width: viewportSize,
        height: viewportSize * viewportRatio,
        left: viewportLeft,
        top: viewportTop,
    }), [viewportSize, viewportRatio, viewportLeft, viewportTop]);
    return { viewportStyles, fitScale };
}

export { useViewportSize };
//# sourceMappingURL=useViewportSize.js.map
