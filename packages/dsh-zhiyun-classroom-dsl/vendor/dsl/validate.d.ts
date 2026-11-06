export interface ValidationIssue {
    /** JSON-pointer-ish path to the offending value, e.g. `/actions/0/elementId`. */
    path: string;
    message: string;
}
export type ValidationResult = {
    valid: true;
} | {
    valid: false;
    errors: ValidationIssue[];
};
/** Validate a {@link Stage} aggregate (course metadata; scenes are separate). */
export declare function validateStage(doc: unknown): ValidationResult;
/** Validate a {@link Scene} aggregate, including its nested content + actions. */
export declare function validateScene(doc: unknown): ValidationResult;
/** Validate a standalone interactive content payload. */
export declare function validateInteractiveContent(doc: unknown): ValidationResult;
/** Validate a standalone current or legacy PBL content payload. */
export declare function validatePBLContent(doc: unknown): ValidationResult;
/** Validate a single {@link Action}, including its variant-required fields. */
export declare function validateAction(doc: unknown): ValidationResult;
/**
 * Validate a runtime session envelope (#869). Payloads live on records, so
 * this is a pure envelope check; `kind` is an open string by design.
 */
export declare function validateRuntimeSession(doc: unknown): ValidationResult;
/**
 * Validate a runtime record envelope (#869). The payload is app-owned and
 * checked only for presence — per-kind payload validators are injected at
 * the store boundary, exactly like scene-content validators (#860).
 */
export declare function validateRuntimeRecord(doc: unknown): ValidationResult;
//# sourceMappingURL=validate.d.ts.map