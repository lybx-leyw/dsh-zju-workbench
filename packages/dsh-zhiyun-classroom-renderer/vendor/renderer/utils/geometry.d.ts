import type { PPTElement } from '@openmaic/dsl';
/**
 * Percentage-based geometry (0-100 coordinate system)
 * Used by spotlight/laser overlays for responsive positioning.
 */
export interface PercentageGeometry {
    x: number;
    y: number;
    w: number;
    h: number;
    centerX: number;
    centerY: number;
}
export declare function getElementPercentageGeometry(element: PPTElement, viewportSize?: number, viewportRatio?: number): PercentageGeometry | null;
export declare function findElementGeometry(elements: PPTElement[], elementId: string, viewportSize?: number, viewportRatio?: number): PercentageGeometry | null;
export declare function findNearestCorner(geometry: PercentageGeometry): {
    x: number;
    y: number;
};
