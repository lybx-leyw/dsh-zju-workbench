import { type CSSProperties, type ReactNode } from 'react';
import type { PPTElement, PPTImageElement, PPTShapeElement, PPTTableElement, PPTTextElement, PPTVideoElement, Slide, SlideBackground } from '@openmaic/dsl';
import type { SlideEffects } from './types/effects';
export interface SlideCanvasProps {
    /**
     * Single slide data (PPTist-style). May be omitted when this component is
     * rendered inside a `<SlideRendererProvider>` that supplies it.
     */
    slide?: Slide;
    /**
     * Canvas scale. When omitted, the canvas auto-fits the container using
     * `slide.viewportSize` and `slide.viewportRatio`. Set to a fixed number
     * (e.g. 1) to skip auto-fit and render at slide-native dimensions.
     */
    scale?: number;
    /** Percent of the container to use when auto-fitting the slide. */
    canvasPercentage?: number;
    /** Called with the computed fit scale when `scale` is omitted. */
    onScaleChange?: (scale: number) => void;
    /** Override `slide.background`. */
    background?: SlideBackground;
    /** Optional play-time effects, all default off. */
    effects?: SlideEffects;
    /** Replace default <img> rendering for image elements. */
    renderImage?: (element: PPTImageElement, resolvedSrc: string, defaultContent: ReactNode) => ReactNode;
    /** Replace default <video> rendering for video elements. */
    renderVideo?: (element: PPTVideoElement) => ReactNode;
    /** Replace the content node inside the shared text paint wrapper. */
    renderText?: (element: PPTTextElement, defaultContent: ReactNode) => ReactNode;
    /** Replace the static label node inside a Shape element. */
    renderShapeLabel?: (element: PPTShapeElement, defaultContent: ReactNode) => ReactNode;
    /** Replace the static content node inside a Table element. */
    renderTable?: (element: PPTTableElement, defaultContent: ReactNode) => ReactNode;
    /** Enable pointer interaction for video controls or custom video UI. */
    videoInteractive?: boolean;
    /**
     * Background canvases use the frame allowance left by foreground layout
     * effects, then finish in idle time at lower priority. Defaults to normal.
     */
    mathPriority?: 'normal' | 'background';
    /** Click handler invoked on any element. */
    onElementClick?: (element: PPTElement, event: React.MouseEvent) => void;
    /**
     * Prefix used for each element root DOM id. Hosts that layer DOM-measured
     * overlays on top of the canvas can keep their existing id contract.
     */
    elementIdPrefix?: string;
    /** Class on the outer container. */
    className?: string;
    /** Compositor-only offsets used by the editing surface during a move gesture. */
    dragOffsets?: ReadonlyMap<string, {
        x: number;
        y: number;
    }>;
    /** Element ids omitted from rendering and effect targeting. */
    hiddenElementIds?: readonly string[];
    /** Inline style on the outer container. */
    style?: CSSProperties;
    /**
     * Card-style chrome on the inner slide container (drop shadow + rounded
     * corners). Defaults to `true` for on-screen previews. Snapshot pipelines
     * pass `false` so the captured PNG matches the source PPT's edges exactly
     * — html2canvas would otherwise bake the 1px shadow outline and the
     * 0.5rem corner radius into the output and the comparator reads them as
     * a thin border + rounded corners that the original PPT does not have.
     */
    chrome?: boolean;
}
export declare function SlideCanvas(props: SlideCanvasProps): import("react/jsx-runtime").JSX.Element;
