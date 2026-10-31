import { type RefObject } from 'react';
/**
 * Inline formulas in slide prose. Stored prose carries each formula as LaTeX
 * source (`<span data-inline-math="LATEX">LATEX</span>`); older or unsaved
 * content may still carry a rendered KaTeX tree with the same attribute. The
 * renderer typesets every such span in the browser from its source.
 */
export declare const INLINE_MATH_ATTRIBUTE = "data-inline-math";
/**
 * Marks an element whose injected prose is one typesetting root (a text box,
 * a shape label, a table), so callers that typeset a whole slide at once use
 * the same roots, budgets and caps as the live elements.
 */
export declare const INLINE_MATH_ROOT_ATTRIBUTE = "data-inline-math-root";
/** Longest source typeset; longer sources are shown as plain LaTeX text. */
export declare const MAX_INLINE_MATH_SOURCE = 2000;
/**
 * Bound uncached typesetting work in a batch. Live prose roots share a batch;
 * standalone renderInlineMath calls get their own. Ordinary slides fit before
 * paint; mixed/dense slides may defer even short formulas to idle time.
 */
export declare const INLINE_MATH_SYNC_SOURCE_BUDGET = 4000;
export declare const INLINE_MATH_SYNC_FORMULA_BUDGET = 100;
/**
 * Hard cap per prose root, counting every formula in document order: past it,
 * formulas are shown as their LaTeX text and never typeset.
 */
export declare const INLINE_MATH_MAX_ROOT_SOURCE = 50000;
export declare const INLINE_MATH_MAX_ROOT_FORMULAS = 1000;
export interface RenderInlineMathOptions {
    /**
     * Typeset every formula now, ignoring the per-pass budget (the hard cap
     * still applies). For callers that capture the result right away, such as
     * slide snapshots.
     */
    readonly complete?: boolean;
}
/**
 * Typeset the inline formulas under `root`. Each `span[data-inline-math]` is
 * replaced by a KaTeX render of its source carrying the same attribute (the
 * editor's storage shape); a source that cannot be typeset is shown as text.
 * Returns `true` when the budget deferred formulas; pending sources stay hidden.
 */
export declare function renderInlineMath(root: ParentNode, options?: RenderInlineMathOptions): boolean;
/**
 * Typeset every formula under `container` now, root by root (each element
 * marked with {@link INLINE_MATH_ROOT_ATTRIBUTE}), so each root keeps its own
 * hard cap exactly as the live elements apply it. For snapshots, which
 * capture right away instead of waiting for idle time.
 */
export declare function completeInlineMath(container: Element): void;
/**
 * A `dangerouslySetInnerHTML` value that keeps its identity while `html` is
 * unchanged. React rewrites injected markup whenever it receives a new value
 * object, which would discard typeset formulas and any idle progress on each
 * re-render; a stable value leaves the DOM alone.
 */
export declare function useInnerHtml(html: string): {
    __html: string;
};
/** {@link useInnerHtml} for a grid of cells (table text), keyed on every cell's markup. */
export declare function useInnerHtmlGrid(cells: readonly (readonly string[])[]): {
    __html: string;
}[][];
type MathPriority = 'normal' | 'background';
export declare const InlineMathPriorityContext: import("react").Context<MathPriority>;
/**
 * Typeset the inline formulas of prose injected into `ref` as `html`. Runs
 * after every commit, before paint: React may rewrite the injected markup on
 * any re-render (not only when `html` changes), which would put the stored
 * source spans back. Formulas already typeset are skipped and cached renders
 * are cloned, so a commit that left the markup alone costs one query. What the
 * shared budget leaves over is typeset in idle time, using the current markup.
 * Pending roots stay in that queue on unchanged commits (including when an
 * external caller rewrites the HTML). New content can use the current frame's
 * synchronous allowance. Unmounting or replacing a root removes its queued work.
 * Foreground roots run in layout effects; background roots use the remaining
 * allowance in a microtask, following the nearest InlineMathPriorityContext.
 * Never updates React state.
 */
export declare function useInlineMath(ref: RefObject<Element | null>, html: string): void;
export {};
