import { type ReactNode } from 'react';
import { type PPTElement, type PPTImageElement, type PPTShapeElement, type PPTTableElement, type PPTTextElement, type PPTVideoElement, type SlideTheme } from '@openmaic/dsl';
export interface SlideElementProps {
    elementInfo: PPTElement;
    elementIndex: number;
    theme?: Pick<SlideTheme, 'fontColor' | 'fontName'>;
    animate?: boolean;
    renderImage?: (element: PPTImageElement, resolvedSrc: string, defaultContent: ReactNode) => ReactNode;
    renderVideo?: (element: PPTVideoElement) => ReactNode;
    renderText?: (element: PPTTextElement, defaultContent: ReactNode) => ReactNode;
    renderShapeLabel?: (element: PPTShapeElement, defaultContent: ReactNode) => ReactNode;
    renderTable?: (element: PPTTableElement, defaultContent: ReactNode) => ReactNode;
    videoInteractive?: boolean;
    onElementClick?: (element: PPTElement, event: React.MouseEvent) => void;
    /** Prefix used for the root div id — must match SpotlightOverlay's `elementIdPrefix`. */
    idPrefix?: string;
    /** Compositor-only offset used by the editing surface during a move gesture. */
    dragOffset?: {
        x: number;
        y: number;
    };
}
export declare const SlideElement: import("react").NamedExoticComponent<SlideElementProps>;
