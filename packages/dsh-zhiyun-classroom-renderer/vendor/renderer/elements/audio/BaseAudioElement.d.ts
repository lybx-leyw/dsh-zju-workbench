import type { PPTAudioElement } from '@openmaic/dsl';
export interface BaseAudioElementProps {
    readonly elementInfo: PPTAudioElement;
}
/**
 * The audio affordance belongs to the renderer rather than the editor UI so
 * read-only slide previews can play it directly. Editing mode layers its hit
 * targets above this button, keeping selection and transform gestures intact.
 */
export declare function BaseAudioElement({ elementInfo }: BaseAudioElementProps): import("react/jsx-runtime").JSX.Element;
