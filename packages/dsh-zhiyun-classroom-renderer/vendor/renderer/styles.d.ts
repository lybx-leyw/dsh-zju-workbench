/**
 * Package-level CSS rules that can't be expressed inline (descendant selectors,
 * keyframes, pseudo-classes). Rendered once via `<style>` at the top of
 * `<SlideCanvas>` so the package stays self-contained without Tailwind.
 *
 * The `.slide-renderer-prose` rules undo host and user-agent defaults so the
 * slide JSON is the single source of truth. Paragraph spacing comes from the
 * `--paragraphSpace` CSS variable. List rules restore semantic markers that
 * host resets such as Tailwind Preflight remove.
 */
/**
 * Generates the reset rules that define rich-text geometry inside a slide.
 *
 * Both the static renderer and the ProseMirror editor need these exact rules:
 * keeping the selector configurable lets them share one layout contract while
 * retaining their different DOM roots.
 */
export declare function createTextProseStyles(selector: string): string;
export declare const SLIDE_RENDERER_STYLES: string;
