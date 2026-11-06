import { SVGPathData } from 'svg-pathdata';
import type { PPTShapeElement } from '@openmaic/dsl';
export { shapeToTextFallback } from './shape-text-fallback.js';
export interface PathLimits {
    /** UTF-16 code units, checked before tokenization or parsing. */
    maxLength: number;
    /** Includes implicit repeated parameter groups and close-path commands. */
    maxCommands: number;
    /** Applies to input, resolved coordinates, and scaled drawing coordinates. */
    maxCoordinate: number;
}
export declare const INPUT_PATH_LIMITS: Readonly<PathLimits>;
/** Rendering budget only: never apply these limits while loading a document. */
export declare const RENDER_PATH_LIMITS: Readonly<PathLimits>;
export interface GeometryError {
    code: 'syntax' | 'non_finite' | 'invalid_dimension' | 'resource_limit';
    field: string;
    message: string;
    /** Zero-based UTF-16 offset in the original path, where available. */
    position?: number;
}
export interface PathBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}
export type PathValidation = {
    ok: true;
    commands: SVGPathData['commands'];
    bounds: PathBounds | null;
} | {
    ok: false;
    error: GeometryError;
};
/**
 * Validate the complete SVG path grammar before delegating geometry to svg-pathdata.
 * The library alone accepts numbers after Z, Infinity, and missing arc separators.
 * No browser, logger, DOM, exporter, or document mutation is involved.
 */
export declare function validateSvgPath(path: unknown, policy?: Partial<PathLimits>): PathValidation;
export declare function validateShapeGeometry(shape: Pick<PPTShapeElement, 'path' | 'viewBox' | 'width' | 'height'>, policy?: Partial<PathLimits>): PathValidation;
/** Validate only changed geometry so unrelated edits of historical shapes work. */
export declare function shapeGeometryChanged(before: PPTShapeElement, after: PPTShapeElement): boolean;
//# sourceMappingURL=index.d.ts.map