import type { PPTElement } from '@openmaic/dsl';
import type { HighlightEffectOptions } from '../types/effects';
export interface HighlightOverlayProps {
    element: PPTElement;
    options?: HighlightEffectOptions;
}
export declare function HighlightOverlay({ element, options }: HighlightOverlayProps): import("react/jsx-runtime").JSX.Element | null;
