/** Interactive scene content and its dependency-free widget extension point. */
/** Every widget kind produced by the interactive-content pipeline. */
export type WidgetType = 'simulation' | 'diagram' | 'code' | 'game' | 'visualization3d' | 'procedural-skill';
/** Frozen set of every valid {@link WidgetType}. */
export declare const WIDGET_TYPES: readonly ["simulation", "diagram", "code", "game", "visualization3d", "procedural-skill"];
/** Narrow an unknown value to a valid {@link WidgetType}. */
export declare function isWidgetType(value: unknown): value is WidgetType;
/**
 * Minimal contract shared by every widget configuration. The contract names
 * only `type`; every other widget-config member belongs to the app domain.
 */
export interface WidgetConfigBase {
    type: WidgetType;
    [key: string]: unknown;
}
/**
 * Interactive web content.
 *
 * `html` is a complete HTML document rendered via iframe `srcDoc`; `url` is a
 * `src` fallback used only when `html` is absent. `url` is optional because
 * producers historically wrote `url: ''` when no fallback existed. The
 * validators require at least one of `html` or `url` to be present as a string,
 * a disjunction intentionally not expressed by the generated schema.
 */
export type InteractiveContent<TWidgetConfig extends WidgetConfigBase = WidgetConfigBase> = {
    type: 'interactive';
    url?: string;
    html?: string;
    widgetType?: WidgetType;
    widgetConfig?: TWidgetConfig;
};
/** Cheap structural guard for {@link InteractiveContent}. */
export declare function isInteractiveContent(value: unknown): value is InteractiveContent;
//# sourceMappingURL=interactive.d.ts.map