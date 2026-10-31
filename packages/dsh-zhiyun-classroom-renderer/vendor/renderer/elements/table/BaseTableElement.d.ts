import type { ReactNode } from 'react';
import type { PPTTableElement } from '@openmaic/dsl';
export interface BaseTableElementProps {
    elementInfo: PPTTableElement;
    target?: string;
    renderContent?: (element: PPTTableElement, defaultContent: ReactNode) => ReactNode;
}
export declare function BaseTableElement({ elementInfo, target, renderContent }: BaseTableElementProps): import("react/jsx-runtime").JSX.Element;
