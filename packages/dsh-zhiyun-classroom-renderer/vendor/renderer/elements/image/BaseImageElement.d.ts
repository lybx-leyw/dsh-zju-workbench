import type { ReactNode } from 'react';
import type { PPTImageElement } from '@openmaic/dsl';
export interface BaseImageElementProps {
    elementInfo: PPTImageElement;
    /**
     * Optional render slot: replace the default <img> with custom content.
     * The slot receives `(element, resolvedSrc, defaultContent)` and is responsible
     * for selecting placeholders, retry UI, or the renderer's prepared image.
     * Its return value is authoritative, including `null`.
     */
    renderImage?: (element: PPTImageElement, resolvedSrc: string, defaultContent: ReactNode) => ReactNode;
}
export declare function BaseImageElement({ elementInfo, renderImage }: BaseImageElementProps): import("react/jsx-runtime").JSX.Element;
