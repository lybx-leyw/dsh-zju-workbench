"use client";
import { jsxs, jsx } from 'react/jsx-runtime';
import { useRef, useMemo } from 'react';
import { AnimatePresence } from 'motion/react';
import { findElementGeometry } from './utils/geometry.js';
import { useSlideBackgroundStyle } from './hooks/useSlideBackgroundStyle.js';
import { useViewportSize } from './hooks/useViewportSize.js';
import { SlideElement } from './SlideElement.js';
import { HighlightOverlay } from './effects/HighlightOverlay.js';
import { SpotlightOverlay } from './effects/SpotlightOverlay.js';
import { LaserOverlay } from './effects/LaserOverlay.js';
import { useOptionalSlideContext } from './context.js';
import { SLIDE_RENDERER_STYLES } from './styles.js';
import { InlineMathPriorityContext } from './utils/inlineMath.js';

function SlideCanvas(props) {
    const ctx = useOptionalSlideContext();
    const slide = props.slide ?? ctx?.slide;
    if (!slide) {
        throw new Error('<SlideCanvas> requires `slide` either as a prop or via <SlideRendererProvider>.');
    }
    const scale = props.scale ?? ctx?.scale;
    const background = props.background ?? ctx?.background;
    const effects = props.effects ?? ctx?.effects;
    const renderImage = props.renderImage ?? ctx?.renderImage;
    const renderVideo = props.renderVideo ?? ctx?.renderVideo;
    const renderText = props.renderText;
    const renderShapeLabel = props.renderShapeLabel;
    const renderTable = props.renderTable;
    const videoInteractive = props.videoInteractive ?? ctx?.videoInteractive;
    const onElementClick = props.onElementClick ?? ctx?.onElementClick;
    const elementIdPrefix = props.elementIdPrefix ?? 'slide-element-';
    const { className, dragOffsets, style } = props;
    const chrome = props.chrome ?? true;
    const canvasRef = useRef(null);
    const elements = slide.elements;
    const visibleElements = useMemo(() => {
        if (!props.hiddenElementIds?.length)
            return elements;
        const hidden = new Set(props.hiddenElementIds);
        return elements.filter((element) => !hidden.has(element.id));
    }, [elements, props.hiddenElementIds]);
    const elementIndexById = useMemo(() => new Map(elements.map((element, index) => [element.id, index + 1])), [elements]);
    const { viewportStyles, fitScale } = useViewportSize(canvasRef, {
        viewportSize: slide.viewportSize,
        viewportRatio: slide.viewportRatio,
        canvasPercentage: props.canvasPercentage,
        onScaleChange: scale === undefined ? props.onScaleChange : undefined,
    });
    const canvasScale = scale ?? fitScale;
    const resolvedBackground = background ?? slide.background;
    const { backgroundStyle } = useSlideBackgroundStyle(resolvedBackground);
    // Plain derivations: when this package is consumed in a React Compiler build
    // these are auto-memoized; otherwise the cost (O(elements) lookups) is trivial.
    const laserGeometry = effects?.laser
        ? findElementGeometry(visibleElements, effects.laser.elementId, slide.viewportSize, slide.viewportRatio)
        : null;
    const zoomGeometry = effects?.zoom
        ? findElementGeometry(visibleElements, effects.zoom.elementId, slide.viewportSize, slide.viewportRatio)
        : null;
    const highlights = effects?.highlights ?? (effects?.highlight ? [effects.highlight] : []);
    return (jsxs("div", { ref: canvasRef, className: className, style: {
            position: 'relative',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            userSelect: 'none',
            ...style,
        }, children: [jsx("style", { dangerouslySetInnerHTML: { __html: SLIDE_RENDERER_STYLES } }), jsxs("div", { style: {
                    position: 'absolute',
                    ...(chrome
                        ? {
                            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.01), 0 0 12px 0 rgba(0, 0, 0, 0.1)',
                            borderRadius: '0.5rem',
                        }
                        : {}),
                    overflow: 'hidden',
                    transitionProperty: 'transform',
                    transitionDuration: '700ms',
                    width: `${viewportStyles.width * canvasScale}px`,
                    height: `${viewportStyles.height * canvasScale}px`,
                    left: `${viewportStyles.left}px`,
                    top: `${viewportStyles.top}px`,
                    ...(effects?.zoom && zoomGeometry
                        ? {
                            transform: `scale(${effects.zoom.scale})`,
                            transformOrigin: `${zoomGeometry.centerX}% ${zoomGeometry.centerY}%`,
                        }
                        : {}),
                }, children: [jsx("div", { style: {
                            width: '100%',
                            height: '100%',
                            backgroundPosition: 'center',
                            ...(chrome ? { borderRadius: '0.5rem' } : {}),
                            ...backgroundStyle,
                        } }), jsxs("div", { style: {
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            transformOrigin: 'top left',
                            width: `${viewportStyles.width}px`,
                            height: `${viewportStyles.height}px`,
                            transform: `scale(${canvasScale})`,
                        }, children: [jsx(InlineMathPriorityContext.Provider, { value: props.mathPriority ?? 'normal', children: visibleElements.map((element) => (jsx(SlideElement, { elementInfo: element, elementIndex: elementIndexById.get(element.id) ?? 1, theme: slide.theme, renderImage: renderImage, renderVideo: renderVideo, renderText: renderText, renderShapeLabel: renderShapeLabel, renderTable: renderTable, videoInteractive: videoInteractive, onElementClick: onElementClick, idPrefix: elementIdPrefix, dragOffset: dragOffsets?.get(element.id) }, element.id))) }), highlights.map((highlight) => {
                                const element = visibleElements.find((el) => el.id === highlight.elementId);
                                return element ? (jsx(HighlightOverlay, { element: element, options: highlight }, highlight.elementId)) : null;
                            })] }), jsx(SpotlightOverlay, { options: effects?.spotlight, elementIdPrefix: elementIdPrefix, measurementKey: visibleElements }), jsx("div", { style: {
                            position: 'absolute',
                            inset: 0,
                            pointerEvents: 'none',
                            padding: '5%',
                        }, children: jsx("div", { style: { position: 'relative', width: '100%', height: '100%' }, children: jsx(AnimatePresence, { children: effects?.laser && laserGeometry && (jsx(LaserOverlay, { geometry: laserGeometry, color: effects.laser.color, duration: effects.laser.duration }, `laser-${effects.laser.elementId}`)) }) }) })] })] }));
}

export { SlideCanvas };
//# sourceMappingURL=SlideCanvas.js.map
