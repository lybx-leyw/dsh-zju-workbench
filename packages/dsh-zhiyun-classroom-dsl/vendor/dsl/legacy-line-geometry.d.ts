/**
 * Pure, dependency-free cleanup for legacy `line` elements carrying the stray
 * `rotate` / `height` fields the slide contract omits
 * (`PPTLineElement extends Omit<PPTBaseElement, 'height' | 'rotate'>`).
 *
 * Documents written before version stamping existed were never schema-checked,
 * so a stray `rotate` (and in principle a `height`) could survive into storage
 * on a `line` element. Since 1.0.0, whole-canvas validation against the closed
 * slide schema (`additionalProperties: false`, and the `line` variant lists
 * neither field) rejects such a canvas — so one legacy line element makes every
 * edit to its scene fail. Stripping is lossless: line geometry is fully
 * determined by `left` / `top` / `width` plus `start` / `end` (the renderer
 * positions the container at `(left, top)` and draws straight from `start` to
 * `end`), and no reader or writer uses `rotate` on a line element.
 *
 * Semantics (mirroring the package's migration transforms):
 *   - **never mutates** its input; stripped elements are fresh objects and the
 *     enclosing objects are copied along the touched path,
 *   - **returns the input by identity** when nothing needs stripping, so
 *     callers can detect a no-op cheaply,
 *   - **shares** every untouched subtree by reference,
 *   - **idempotent**: stripping an already-clean document is a no-op.
 *
 * Every line-element surface of every migratable envelope is walked (see
 * `version.ts`: the migratable unit is deliberately envelope-agnostic):
 *   - a **Stage aggregate** (`{ stage, scenes }`): each scene's canvas
 *     (`scenes[*].content.canvas.elements`) and interactive whiteboard slides
 *     (`scenes[*].whiteboards[*].elements`, which hang their `elements`
 *     directly off the slide), plus the stage-level explainer boards
 *     (`stage.whiteboard[*].elements`),
 *   - a **single Scene row** (its `content.canvas` and `whiteboards`),
 *   - a **single Stage row** (its `whiteboard`).
 * Quiz / widget / PBL and other scene kinds pass through untouched: their
 * `content.type` is not `'slide'`, so even a canvas-shaped app extension on
 * them is out of scope (an absent `content.type` stays eligible — the
 * dirty-line epoch predates schema enforcement). Anything else that is not
 * shaped as expected (a missing level, a non-array where an array is
 * expected, a non-object element) passes through untouched too: this is a
 * targeted cleanup, not a validator — it never throws and never invents shape.
 *
 * No runtime dependencies.
 */
/**
 * Strip the stray legacy `rotate` / `height` fields from `type: 'line'`
 * elements on every slide surface of a Stage aggregate, a single Scene row, or
 * a single Stage row (see the module docstring for the exact paths). Pure:
 * returns the input by identity when nothing needs stripping; fresh objects
 * along the touched path otherwise.
 */
export declare function stripLegacyLineGeometry(doc: unknown): unknown;
//# sourceMappingURL=legacy-line-geometry.d.ts.map