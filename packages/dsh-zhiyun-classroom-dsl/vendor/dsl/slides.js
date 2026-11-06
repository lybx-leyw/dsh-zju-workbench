/**
 * The MAIC slide object model — the canonical, dependency-free contract.
 *
 * This file is the single source of truth that supersedes the three copies that
 * had drifted apart before @openmaic/dsl existed:
 *   - app:      lib/types/slides.ts
 *   - renderer: packages/@openmaic/renderer/src/types/slides.ts
 *   - importer: packages/@openmaic/importer/src/openmaic/types/slides.ts
 *
 * It is a *superset*: every field that appeared in any of the three copies is
 * kept here so that the renderer and the importer can adopt this contract
 * without losing data. Fields that only existed in one copy are annotated with
 * `@since-merge` so the reconciliation history stays explicit. See README.md
 * (the "Divergence reconciled" section) for the full list.
 *
 * Pure types only — no runtime imports, no React/pptx/echarts.
 */
/**
 * Regular (not `const`) enum on purpose: consumers compile with
 * `isolatedModules`, under which importing an ambient `const enum` across the
 * package boundary is an error (TS2748). A regular enum emits a runtime object
 * that bundles cleanly and is usable as both a value and a type.
 */
export var ShapePathFormulasKeys;
(function (ShapePathFormulasKeys) {
    ShapePathFormulasKeys["ROUND_RECT"] = "roundRect";
    ShapePathFormulasKeys["ROUND_RECT_DIAGONAL"] = "roundRectDiagonal";
    ShapePathFormulasKeys["ROUND_RECT_SINGLE"] = "roundRectSingle";
    ShapePathFormulasKeys["ROUND_RECT_SAMESIDE"] = "roundRectSameSide";
    ShapePathFormulasKeys["CUT_RECT_DIAGONAL"] = "cutRectDiagonal";
    ShapePathFormulasKeys["CUT_RECT_SINGLE"] = "cutRectSingle";
    ShapePathFormulasKeys["CUT_RECT_SAMESIDE"] = "cutRectSameSide";
    ShapePathFormulasKeys["CUT_ROUND_RECT"] = "cutRoundRect";
    ShapePathFormulasKeys["MESSAGE"] = "message";
    ShapePathFormulasKeys["ROUND_MESSAGE"] = "roundMessage";
    ShapePathFormulasKeys["L"] = "L";
    ShapePathFormulasKeys["RING_RECT"] = "ringRect";
    ShapePathFormulasKeys["PLUS"] = "plus";
    ShapePathFormulasKeys["TRIANGLE"] = "triangle";
    ShapePathFormulasKeys["PARALLELOGRAM_LEFT"] = "parallelogramLeft";
    ShapePathFormulasKeys["PARALLELOGRAM_RIGHT"] = "parallelogramRight";
    ShapePathFormulasKeys["TRAPEZOID"] = "trapezoid";
    ShapePathFormulasKeys["BULLET"] = "bullet";
    ShapePathFormulasKeys["INDICATOR"] = "indicator";
    ShapePathFormulasKeys["DONUT"] = "donut";
    ShapePathFormulasKeys["DIAGSTRIPE"] = "diagStripe";
})(ShapePathFormulasKeys || (ShapePathFormulasKeys = {}));
export var ElementTypes;
(function (ElementTypes) {
    ElementTypes["TEXT"] = "text";
    ElementTypes["IMAGE"] = "image";
    ElementTypes["SHAPE"] = "shape";
    ElementTypes["LINE"] = "line";
    ElementTypes["CHART"] = "chart";
    ElementTypes["TABLE"] = "table";
    ElementTypes["LATEX"] = "latex";
    ElementTypes["VIDEO"] = "video";
    ElementTypes["AUDIO"] = "audio";
    ElementTypes["CODE"] = "code";
})(ElementTypes || (ElementTypes = {}));
//# sourceMappingURL=slides.js.map