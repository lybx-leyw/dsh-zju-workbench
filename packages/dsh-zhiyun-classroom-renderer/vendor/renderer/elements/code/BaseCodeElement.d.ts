import type { PPTCodeElement } from '@openmaic/dsl';
export interface BaseCodeElementProps {
    elementInfo: PPTCodeElement;
    animate?: boolean;
}
export declare function BaseCodeElement({ elementInfo, animate }: BaseCodeElementProps): import("react/jsx-runtime").JSX.Element;
