import { type RefObject } from 'react';
export interface ViewportStyles {
    width: number;
    height: number;
    left: number;
    top: number;
}
export interface UseViewportSizeResult {
    viewportStyles: ViewportStyles;
    /** Computed scale: viewport pixels → container pixels at the current fit. */
    fitScale: number;
}
export interface UseViewportSizeOptions {
    /** Viewport width in design pixels (slide.viewportSize), default 1000 */
    viewportSize?: number;
    /** Viewport aspect ratio (slide.viewportRatio), default 0.5625 (16:9) */
    viewportRatio?: number;
    /** Percent of the container the viewport should occupy, default 100 */
    canvasPercentage?: number;
    /** Called whenever the computed fit scale changes. */
    onScaleChange?: (scale: number) => void;
}
/**
 * Compute the viewport rect and fit-scale needed to center a slide of size
 * `viewportSize × viewportSize*viewportRatio` inside `canvasRef`.
 *
 * Pure: no store access. Re-runs on container resize via ResizeObserver.
 */
export declare function useViewportSize(canvasRef: RefObject<HTMLElement | null>, options?: UseViewportSizeOptions): UseViewportSizeResult;
