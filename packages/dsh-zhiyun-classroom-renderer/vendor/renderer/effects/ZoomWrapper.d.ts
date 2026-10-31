import type { ReactNode } from 'react';
import type { PercentageGeometry } from '../utils/geometry';
import type { ZoomEffectOptions } from '../types/effects';
export interface ZoomWrapperProps {
    children: ReactNode;
    zoom?: ZoomEffectOptions;
    geometry: PercentageGeometry | null;
}
export declare function ZoomWrapper({ children, zoom, geometry }: ZoomWrapperProps): import("react/jsx-runtime").JSX.Element;
