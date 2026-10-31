import type { PPTElement, PPTLineElement } from '@openmaic/dsl';
interface RotatedElementData {
    left: number;
    top: number;
    width: number;
    height: number;
    rotate: number;
}
export declare const getRectRotatedRange: (element: RotatedElementData) => {
    xRange: number[];
    yRange: number[];
};
export declare const getElementRange: (element: PPTElement) => {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
};
export declare const getTableSubThemeColor: (themeColor: string) => string[];
export declare const getLineElementPath: (element: PPTLineElement) => string;
export {};
