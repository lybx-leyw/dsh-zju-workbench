import { type ReactNode } from 'react';
import type { PPTShapeElement } from '@openmaic/dsl';
export interface BaseShapeElementProps {
    elementInfo: PPTShapeElement;
    /** Replace the static Shape label with editor content. */
    renderLabel?: (element: PPTShapeElement, defaultContent: ReactNode) => ReactNode;
}
export declare function BaseShapeElement({ elementInfo, renderLabel }: BaseShapeElementProps): import("react/jsx-runtime").JSX.Element | null;
