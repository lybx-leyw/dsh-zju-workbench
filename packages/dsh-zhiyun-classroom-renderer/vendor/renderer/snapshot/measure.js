"use client";
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { SlideCanvas } from '../SlideCanvas.js';
import { completeInlineMath } from '../utils/inlineMath.js';

const DEFAULT_VIEWPORT_RATIO = 0.5625;
const DEFAULT_TIMEOUT_MS = 5000;
/** SlideElement renders each element wrapper as `slide-element-<id>` by default. */
const ELEMENT_ID_PREFIX = 'slide-element-';
function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
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
async function measureSlideElementGeometry(slide, elementIds, options = {}) {
    const result = new Map();
    if (typeof document === 'undefined') {
        throw new Error('measureSlideElementGeometry requires a browser environment');
    }
    const ids = [...new Set(elementIds)].filter(Boolean);
    if (ids.length === 0)
        return result;
    const width = options.width ?? slide.viewportSize ?? 1280;
    const viewportRatio = slide.viewportRatio ?? DEFAULT_VIEWPORT_RATIO;
    const height = Math.round(width * viewportRatio);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const container = document.createElement('div');
    container.style.cssText = [
        'position: absolute',
        'left: -99999px',
        'top: 0',
        `width: ${width}px`,
        `height: ${height}px`,
        'pointer-events: none',
    ].join('; ');
    document.body.appendChild(container);
    let root = null;
    try {
        root = createRoot(container);
        flushSync(() => {
            root.render(createElement(SlideCanvas, { slide, chrome: false }));
        });
        // Typeset every inline formula now, root by root: the live renderer
        // leaves what the shared live budget does not cover to idle time, after this
        // capture.
        completeInlineMath(container);
        // Let the ResizeObserver-driven fit settle, then settle fonts before we read
        // rects. Auto-height text only reaches its final extent once the real faces
        // load, and `document.fonts.ready` alone is racy — it can resolve before the
        // off-screen render triggers a self-hosted woff2 fetch, leaving a fallback
        // face whose Latin/digit advances differ and shift the measured content box.
        // So force-load every (style, weight, family) actually used first (mirrors
        // `slideToPng`), then await readiness, capped by the settle timeout.
        await nextFrame();
        await nextFrame();
        if (document.fonts && typeof document.fonts.load === 'function') {
            const fontSpecs = new Set();
            container.querySelectorAll('*').forEach((el) => {
                if (!el.textContent || !el.textContent.trim())
                    return;
                const cs = getComputedStyle(el);
                if (!cs.fontFamily)
                    return;
                fontSpecs.add(`${cs.fontStyle} ${cs.fontWeight} 16px ${cs.fontFamily}`);
            });
            await Promise.race([
                Promise.all([...fontSpecs].map((spec) => document.fonts.load(spec).catch(() => undefined))),
                new Promise((resolve) => setTimeout(resolve, timeoutMs)),
            ]);
        }
        if (document.fonts?.ready) {
            await Promise.race([
                document.fonts.ready,
                new Promise((resolve) => setTimeout(resolve, timeoutMs)),
            ]);
        }
        // Let any font-triggered relayout settle (KaTeX re-fits once KaTeX_Size loads,
        // a React state update) before reading rects — two frames to commit.
        await nextFrame();
        await nextFrame();
        // The SlideCanvas inner container is the positioned box every element is
        // absolute within; normalizing against it (not the outer offscreen div)
        // makes the geometry independent of the fit scale — exactly what
        // SpotlightOverlay does against its own `inset:0` container.
        const canvasEl = container.firstElementChild ?? container;
        const containerRect = canvasEl.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0)
            return result;
        for (const id of ids) {
            const el = container.querySelector(`#${cssEscape(ELEMENT_ID_PREFIX + id)}`);
            if (!el)
                continue;
            const contentEl = el.querySelector('.element-content');
            const targetEl = contentEl ?? el;
            const r = targetEl.getBoundingClientRect();
            if (r.width === 0 && r.height === 0)
                continue;
            const x = ((r.left - containerRect.left) / containerRect.width) * 100;
            const y = ((r.top - containerRect.top) / containerRect.height) * 100;
            const w = (r.width / containerRect.width) * 100;
            const h = (r.height / containerRect.height) * 100;
            result.set(id, { x, y, w, h, centerX: x + w / 2, centerY: y + h / 2 });
        }
    }
    finally {
        if (root) {
            const r = root;
            setTimeout(() => r.unmount(), 0);
        }
        setTimeout(() => container.remove(), 0);
    }
    return result;
}
/** Minimal CSS.escape fallback for element ids used in a selector. */
function cssEscape(value) {
    const g = globalThis;
    if (g.CSS?.escape)
        return g.CSS.escape(value);
    // Escape characters that are not safe in a CSS identifier.
    return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

export { measureSlideElementGeometry };
//# sourceMappingURL=measure.js.map
