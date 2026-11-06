/** Interactive scene content and its dependency-free widget extension point. */
/** Frozen set of every valid {@link WidgetType}. */
export const WIDGET_TYPES = [
    'simulation',
    'diagram',
    'code',
    'game',
    'visualization3d',
    'procedural-skill',
];
const _widgetTypesExhaustive = true;
void _widgetTypesExhaustive;
/** Narrow an unknown value to a valid {@link WidgetType}. */
export function isWidgetType(value) {
    return typeof value === 'string' && WIDGET_TYPES.includes(value);
}
/** Cheap structural guard for {@link InteractiveContent}. */
export function isInteractiveContent(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return false;
    const content = value;
    if (content.type !== 'interactive')
        return false;
    if (typeof content.html !== 'string' && typeof content.url !== 'string')
        return false;
    if (content.url !== undefined && typeof content.url !== 'string')
        return false;
    if (content.html !== undefined && typeof content.html !== 'string')
        return false;
    if (content.widgetType !== undefined && !isWidgetType(content.widgetType))
        return false;
    if (content.widgetConfig !== undefined) {
        if (typeof content.widgetConfig !== 'object' ||
            content.widgetConfig === null ||
            Array.isArray(content.widgetConfig))
            return false;
        if (!isWidgetType(content.widgetConfig.type))
            return false;
    }
    return true;
}
//# sourceMappingURL=interactive.js.map