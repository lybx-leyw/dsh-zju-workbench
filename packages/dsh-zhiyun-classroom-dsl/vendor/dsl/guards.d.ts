/**
 * Pure, dependency-free type guards for the slide object model.
 *
 * These narrow a `PPTElement` union member to its concrete variant by its
 * discriminant `type`. No runtime dependencies, no side effects.
 */
import type { PPTElement, PPTTextElement, PPTImageElement, PPTShapeElement, PPTLineElement, PPTChartElement, PPTTableElement, PPTLatexElement, PPTVideoElement, PPTAudioElement, PPTCodeElement } from './slides.js';
/** All valid `PPTElement["type"]` discriminants. */
export type PPTElementType = PPTElement['type'];
/** Frozen set of every supported element type, for cheap membership checks. */
export declare const PPT_ELEMENT_TYPES: readonly ["text", "image", "shape", "line", "chart", "table", "latex", "video", "audio", "code"];
export declare function isPPTElementType(value: unknown): value is PPTElementType;
export declare function isTextElement(el: PPTElement): el is PPTTextElement;
export declare function isImageElement(el: PPTElement): el is PPTImageElement;
export declare function isShapeElement(el: PPTElement): el is PPTShapeElement;
export declare function isLineElement(el: PPTElement): el is PPTLineElement;
export declare function isChartElement(el: PPTElement): el is PPTChartElement;
export declare function isTableElement(el: PPTElement): el is PPTTableElement;
export declare function isLatexElement(el: PPTElement): el is PPTLatexElement;
export declare function isVideoElement(el: PPTElement): el is PPTVideoElement;
export declare function isAudioElement(el: PPTElement): el is PPTAudioElement;
export declare function isCodeElement(el: PPTElement): el is PPTCodeElement;
//# sourceMappingURL=guards.d.ts.map