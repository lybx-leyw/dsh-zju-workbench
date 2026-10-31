import { type CSSProperties, type ReactNode } from 'react';
import type { PPTElement, PPTImageElement, PPTVideoElement, Slide, SlideBackground } from '@openmaic/dsl';
import type { SlideEffects } from './types/effects';
export interface SlideContextValue {
    slide: Slide;
    scale?: number;
    background?: SlideBackground;
    effects?: SlideEffects;
    renderImage?: (element: PPTImageElement, resolvedSrc: string, defaultContent: ReactNode) => ReactNode;
    renderVideo?: (element: PPTVideoElement) => ReactNode;
    videoInteractive?: boolean;
    onElementClick?: (element: PPTElement, event: React.MouseEvent) => void;
}
export interface SlideRendererProviderProps extends SlideContextValue {
    children?: ReactNode;
    className?: string;
    style?: CSSProperties;
}
export declare function SlideRendererProvider({ children, className, style, ...value }: SlideRendererProviderProps): import("react/jsx-runtime").JSX.Element;
/**
 * Read the closest SlideRendererProvider value.
 * Throws if used outside a provider — use `useOptionalSlideContext` for nullable access.
 */
export declare function useSlideContext(): SlideContextValue;
/** Nullable variant; returns null when outside a provider. */
export declare function useOptionalSlideContext(): SlideContextValue | null;
