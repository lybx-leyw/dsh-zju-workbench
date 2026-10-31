import type { Slide } from '@openmaic/dsl';
export { measureSlideElementGeometry, type MeasuredGeometry, type MeasureOptions } from './measure';
export interface SlideToPngOptions {
    /**
     * Output pixel width. Defaults to the slide's native `viewportSize`
     * (e.g. 1280 for a 16:9 widescreen deck). Height is derived from
     * `viewportRatio`.
     */
    width?: number;
    /**
     * Multiplier on output resolution. Default tracks `window.devicePixelRatio`
     * (typically 2 on retina displays) so the exported PNG is as sharp as
     * the on-screen canvas. Pass 1 for a lighter file at the cost of
     * sub-pixel clarity.
     */
    pixelRatio?: number;
    /**
     * Background color filled behind the slide. Defaults to white. Pass
     * 'transparent' to keep the slide's own background only.
     */
    backgroundColor?: string;
    /**
     * Output format. 'blob' yields a `Blob` suitable for `URL.createObjectURL`
     * + download; 'dataUrl' yields a `data:image/png;base64,...` string.
     */
    format?: 'blob' | 'dataUrl';
    /**
     * Settle timeout in milliseconds. The snapshot waits for `document.fonts.ready`
     * and every `<img>` inside the container to load (or error) before
     * capturing — but won't wait longer than this. Defaults to 5000.
     */
    timeoutMs?: number;
    /**
     * Debug only — render the off-screen container on-screen for the given
     * number of milliseconds after snapshot so you can visually confirm what
     * was captured. Do not use in production.
     */
    debugVisibleMs?: number;
}
/**
 * Render a `Slide` to a PNG image.
 *
 * Throws if called outside a browser (no `document` / `window`), if React
 * fails to mount, or if html2canvas-pro hits a CORS-tainted canvas (cross-
 * origin `<img>` without permissive headers will block the snapshot).
 */
export declare function slideToPng(slide: Slide, options?: SlideToPngOptions): Promise<Blob | string>;
