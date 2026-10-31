/**
 * Action — the universal playback verb contract.
 *
 * Actions are the sole mechanism for agents to drive a presentation. Two
 * categories:
 * - Fire-and-forget: visual effects on slides (spotlight, laser)
 * - Synchronous: must wait for completion before the next action (speech,
 *   whiteboard, video, discussion, widget interactions)
 *
 * Both the online (streaming) and offline (playback) paths consume the same
 * Action types, so they belong in the contract alongside the lesson skeleton
 * (`Stage` / `Scene`): a consumer of `@openmaic/dsl` can now describe both what a
 * lesson *looks like* and how it *plays back*.
 *
 * No runtime dependencies. Pure types + plain data constants only.
 */
/** Action types that fire immediately without blocking */
export const FIRE_AND_FORGET_ACTIONS = ['spotlight', 'laser'];
/** Action types that only work on slide scenes (require slide canvas elements) */
export const SLIDE_ONLY_ACTIONS = ['spotlight', 'laser'];
/** Action types that must complete before the next action runs */
export const SYNC_ACTIONS = [
    'speech',
    'play_video',
    'wb_open',
    'wb_draw_text',
    'wb_draw_shape',
    'wb_draw_chart',
    'wb_draw_latex',
    'wb_draw_table',
    'wb_draw_line',
    'wb_draw_code',
    'wb_edit_code',
    'wb_clear',
    'wb_delete',
    'wb_close',
    'discussion',
    'widget_highlight',
    'widget_setState',
    'widget_annotation',
    'widget_reveal',
];
/** Frozen set of every valid {@link ActionType}, for cheap membership checks. */
export const ACTION_TYPES = [
    'spotlight',
    'laser',
    'play_video',
    'speech',
    'wb_open',
    'wb_draw_text',
    'wb_draw_shape',
    'wb_draw_chart',
    'wb_draw_latex',
    'wb_draw_table',
    'wb_draw_line',
    'wb_draw_code',
    'wb_edit_code',
    'wb_clear',
    'wb_delete',
    'wb_close',
    'discussion',
    'widget_highlight',
    'widget_setState',
    'widget_annotation',
    'widget_reveal',
];
const _actionTypesExhaustive = true;
void _actionTypesExhaustive;
/** Narrow an unknown value to a valid {@link ActionType}. Pure, no runtime deps. */
export function isActionType(value) {
    return typeof value === 'string' && ACTION_TYPES.includes(value);
}
//# sourceMappingURL=action.js.map