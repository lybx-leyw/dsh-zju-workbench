import type { SpotlightEffectOptions } from '../types/effects';
export interface SpotlightOverlayProps {
    options?: SpotlightEffectOptions;
    /** ID prefix the SlideElement uses on its root div. Default `slide-element-`. */
    elementIdPrefix?: string;
    /** Remeasure when host element data changes without changing the target ID. */
    measurementKey?: unknown;
}
export declare function SpotlightOverlay({ options, elementIdPrefix, measurementKey, }: SpotlightOverlayProps): import("react/jsx-runtime").JSX.Element;
