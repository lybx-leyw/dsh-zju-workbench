import type { Slide } from '@openmaic/dsl';
/** Percentage geometry (0–100) — mirrors the compiler's `PercentageGeometry`. */
export interface MeasuredGeometry {
    x: number;
    y: number;
    w: number;
    h: number;
    centerX: number;
    centerY: number;
}
export interface MeasureOptions {
    /**
     * Off-screen render width in px. Defaults to the slide's native
     * `viewportSize`. Only the *ratio* of element box to container matters for the
     * 0–100 normalization, so the absolute width is not important — but rendering
     * near native size keeps text wrapping (hence auto-height) faithful.
     */
    width?: number;
    /** Settle timeout in ms for `document.fonts.ready`. Default 5000. */
    timeoutMs?: number;
}
/**
 * Measure the rendered content-box geometry (0–100) of the given element ids on
 * a slide. Returns a Map keyed by element id; ids that could not be located are
 * absent (the caller falls back to the authored-box calc). Never throws for a
 * missing element — only for a non-browser environment.
 *
 * The measurement matches `SpotlightOverlay`: prefer the element's
 * `.element-content` box, else the element wrapper, normalized against the
 * SlideCanvas inner container so it is independent of the off-screen scale.
 */
export declare function measureSlideElementGeometry(slide: Slide, elementIds: readonly string[], options?: MeasureOptions): Promise<Map<string, MeasuredGeometry>>;
