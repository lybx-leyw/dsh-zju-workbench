import type { GradientColor, GradientType } from '@openmaic/dsl';
interface GradientDefsProps {
    id: string;
    type: GradientType;
    colors: GradientColor[];
    rotate?: number;
}
export declare function GradientDefs({ id, type, colors, rotate }: GradientDefsProps): import("react/jsx-runtime").JSX.Element;
export {};
