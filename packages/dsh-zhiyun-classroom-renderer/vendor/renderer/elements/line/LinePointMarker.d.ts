import type { LinePoint } from '@openmaic/dsl';
type NonEmptyLinePoint = Exclude<LinePoint, ''>;
interface LinePointMarkerProps {
    id: string;
    position: 'start' | 'end';
    type: NonEmptyLinePoint;
    baseSize: number;
    color?: string;
}
export declare function LinePointMarker({ id, position, type, baseSize, color }: LinePointMarkerProps): import("react/jsx-runtime").JSX.Element;
export {};
