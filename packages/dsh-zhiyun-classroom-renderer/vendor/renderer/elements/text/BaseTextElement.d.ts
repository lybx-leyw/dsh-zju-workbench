import { type ReactNode } from 'react';
import type { PPTTextElement } from '@openmaic/dsl';
export interface BaseTextElementProps {
    elementInfo: PPTTextElement;
    target?: string;
    renderContent?: (element: PPTTextElement, defaultContent: ReactNode) => ReactNode;
    /** Keep a recovered shape's label container sized for an absolute-positioned editor. */
    fillHeight?: boolean;
}
export declare function BaseTextElement({ elementInfo, target, renderContent, fillHeight, }: BaseTextElementProps): import("react/jsx-runtime").JSX.Element;
