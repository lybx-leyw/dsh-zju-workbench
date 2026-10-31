import type { PercentageGeometry } from '../utils/geometry';
export interface LaserOverlayProps {
    geometry: PercentageGeometry;
    color?: string;
    duration?: number;
}
export declare function LaserOverlay({ geometry, color, duration: _duration, }: LaserOverlayProps): import("react/jsx-runtime").JSX.Element;
