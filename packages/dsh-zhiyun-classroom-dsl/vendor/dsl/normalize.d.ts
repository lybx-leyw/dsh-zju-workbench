/**
 * Pure, dependency-free element normalization for the slide DSL contract.
 *
 * The companion to {@link import('./validate.js')}: where the validators *report*
 * on a document, `normalize` *repairs* one. It fills the required fields a
 * producer may have left off, derives geometry-dependent fields, and fails loud
 * on values it cannot interpret — returning a fully-defaulted document that then
 * satisfies `validateScene` / `validateStage`.
 *
 * This is the contract's home for the "fix up the output" pass every producer
 * used to carry imperatively (the generator's element defaults, the importer's
 * theme fill, …). Owning it here keeps the defaults consistent across producers,
 * ships them as part of the published contract (the same static values are
 * emitted onto the JSON Schema as `default` annotations — see `slides.ts`), and
 * makes them visible to non-TS consumers.
 *
 * Boundary (mirrors #787's split): `normalize` owns **structural** defaults —
 * the ones that are the same for every producer:
 *   - static defaults for required fields (font / color / style / fill / …),
 *   - geometry-derived defaults (a line's `start` / `end`, a shape's `viewBox` /
 *     `path`),
 *   - fail-loud coercion (a present-but-malformed field is a producer bug, not
 *     something to silently reset).
 * It does NOT own media-specific reconciliation — e.g. fitting an image box to a
 * resolved asset's real dimensions. That depends on data outside the document
 * and stays a producer concern.
 *
 * Semantics (for the required *content* fields normalize owns):
 *   - **missing** required field  -> filled with the canonical default,
 *   - **present but wrong-typed**  -> throws (fail loud),
 *   - **present and well-formed**  -> passed through untouched.
 * Pure and non-mutating: inputs are never modified; every result is a fresh
 * object. Idempotent: `normalize(normalize(x))` deep-equals `normalize(x)`.
 *
 * Scope: normalize owns element **content** — the per-variant required fields
 * (font / colour / fill / style / points) and geometry it can derive (a line's
 * `start` / `end`, a shape's `viewBox` / `path`). It does NOT fill or check the
 * base identity / geometry every element shares (`id`, `left`, `top`, `width`,
 * `height`, `rotate`): those are producer-supplied (the `id`, notably, is often
 * assigned downstream of this pass), so they carry no content default. Run the
 * `validate*` functions / the JSON Schema for full structural validation of
 * those — normalize and validate are complementary, not redundant.
 *
 * No runtime dependencies.
 */
import type { PPTElement } from './slides.js';
import type { Scene, SceneType, Stage } from './stage.js';
import type { PBLProject } from './pbl.js';
/**
 * The canonical static defaults for required element fields, and the single
 * source of truth for them. The same values are mirrored onto the generated
 * JSON Schema via `@default` JSDoc on the type fields in `slides.ts`; a test
 * (`test/normalize.test.ts`) pins the two together so they cannot drift.
 *
 * Only *static* defaults live here. Geometry-derived defaults (`line.start` /
 * `end`, `shape.viewBox` / `path`) are computed from the element's box at
 * normalize time and have no fixed value to annotate.
 */
export declare const ELEMENT_DEFAULTS: {
    readonly text: {
        readonly defaultFontName: "Microsoft YaHei";
        readonly defaultColor: "#333333";
        readonly content: "";
    };
    readonly image: {
        readonly fixedRatio: true;
    };
    readonly shape: {
        readonly fill: "#5b9bd5";
        readonly fixedRatio: false;
    };
    readonly shapeText: {
        readonly content: "";
        readonly defaultFontName: "Microsoft YaHei";
        readonly defaultColor: "#333333";
        readonly align: "middle";
    };
    readonly line: {
        readonly style: "solid";
        readonly color: "#333333";
        readonly points: readonly ["", ""];
    };
};
/**
 * Normalize a complete design-authored PBL project without interpreting app
 * runtime state. Design-authored fields must be present because normalization
 * cannot invent project content. Seeded skeleton fields may be absent and then
 * receive their canonical values; present malformed values throw.
 *
 * Milestone and microtask statuses must each be consistently absent or present
 * across the project. All-absent milestones seed first-active then locked;
 * all-absent microtasks seed `todo`. Mixed presence is rejected.
 * Pure and idempotent.
 */
export declare function normalizePBLProject(project: unknown): PBLProject;
/**
 * Normalize a single element: fill its required content defaults, derive
 * geometry, and fail loud on malformed content. Returns a fresh, content-
 * defaulted element; the input is never mutated. Base identity / geometry
 * (`id`, `left/top/width/height/rotate`) is out of scope (see the module note).
 * Element kinds the contract owns no defaults for yet (chart / table / latex /
 * video / audio / code) pass through unchanged.
 *
 * @throws if `el` is not an object, its `type` is not a known element type, or a
 * present required content field has the wrong shape.
 */
export declare function normalizeElement(el: unknown): PPTElement;
/**
 * Element-invalidity policy for {@link normalizeSlideWith}.
 *
 * `normalizeElement` fails loud on a present-but-wrong-typed field. What that
 * should do to the *slide* is a producer decision: a build-time producer wants
 * the throw (`'throw'`, the default — what plain {@link normalizeSlide} does);
 * a producer normalizing unreliable wild-world input (an imported deck, model
 * output) prefers to degrade — drop the one element rather than fail the whole
 * document or hand the malformed payload to consumers that read it unguarded
 * (`'drop'`). `onDropped` observes each drop (log it, count it, surface it) so
 * the loss is never silent.
 */
export interface NormalizeSlideOptions {
    onInvalid?: 'throw' | 'drop';
    onDropped?: (element: unknown, error: unknown) => void;
}
/**
 * Normalize every element on a slide-like canvas (a {@link Slide} or a
 * whiteboard — anything carrying an `elements` array). Pure; returns a fresh
 * object with normalized elements. Throws on the first element that fails
 * normalization; for a degrade-per-element policy use
 * {@link normalizeSlideWith}.
 *
 * Deliberately unary so `slides.map(normalizeSlide)` stays valid — an options
 * parameter here would collide with `map`'s index argument.
 */
export declare function normalizeSlide<T extends {
    elements: PPTElement[];
}>(slide: T): T;
/**
 * Build a unary {@link normalizeSlide} variant carrying an element-invalidity
 * policy. Curried (options first) precisely so the result is safe in
 * `slides.map(...)`:
 *
 * ```ts
 * const normalize = normalizeSlideWith({ onInvalid: 'drop', onDropped: log });
 * const clean = slides.map(normalize);
 * ```
 */
export declare function normalizeSlideWith(options: NormalizeSlideOptions): <T extends {
    elements: PPTElement[];
}>(slide: T) => T;
/**
 * Normalize a {@link Scene}: fills element defaults on a slide scene's canvas,
 * fills a PBL scene's canonical seeded skeleton, and normalizes any attached
 * whiteboards. Quiz and interactive content pass through untouched. Generic over
 * `TAction` / `TContent` so app-widened scenes (`Scene<AppAction, AppContent>`)
 * can call it too. Pure; returns a fresh Scene.
 */
export declare function normalizeScene<TAction, TContent extends {
    type: SceneType;
}>(scene: Scene<TAction, TContent>): Scene<TAction, TContent>;
/**
 * Normalize a {@link Stage}: fills element defaults on every whiteboard the
 * stage carries. Pure; returns a fresh Stage (the input when there is nothing to
 * normalize).
 */
export declare function normalizeStage(stage: Stage): Stage;
//# sourceMappingURL=normalize.d.ts.map