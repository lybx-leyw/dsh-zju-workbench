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
import type { AssetRef } from './storage.js';
export interface ActionBase {
    id: string;
    title?: string;
    description?: string;
}
/** Spotlight — focus on a single element, dim everything else */
export interface SpotlightAction extends ActionBase {
    type: 'spotlight';
    elementId: string;
    dimOpacity?: number;
}
/** Laser — point at an element with a laser effect */
export interface LaserAction extends ActionBase {
    type: 'laser';
    elementId: string;
    color?: string;
}
/** Speech — teacher narration (wait for TTS to finish) */
export interface SpeechAction extends ActionBase {
    type: 'speech';
    text: string;
    /**
     * An asset reference for narration audio. Documents converted by the app-side
     * reference converter (#1007 part 2, step c) hold allocated asset ids here.
     * Unconverted legacy documents may still carry TTS-derived ids until they are
     * opened and converted; such values are foreign to the asset pool and resolve
     * through the app's legacy read fallbacks.
     */
    audioId?: AssetRef;
    /** Prevent legacy derived-id fallback after an edit invalidates old narration. */
    audioInvalidated?: boolean;
    voice?: string;
    speed?: number;
}
/** Open whiteboard (wait for animation) */
export interface WbOpenAction extends ActionBase {
    type: 'wb_open';
}
/** Draw text on whiteboard (wait for render) */
export interface WbDrawTextAction extends ActionBase {
    type: 'wb_draw_text';
    elementId?: string;
    content: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    fontSize?: number;
    color?: string;
}
/** Draw shape on whiteboard (wait for render) */
export interface WbDrawShapeAction extends ActionBase {
    type: 'wb_draw_shape';
    elementId?: string;
    shape: 'rectangle' | 'circle' | 'triangle';
    x: number;
    y: number;
    width: number;
    height: number;
    fillColor?: string;
}
/** Draw chart on whiteboard (wait for render) */
export interface WbDrawChartAction extends ActionBase {
    type: 'wb_draw_chart';
    elementId?: string;
    chartType: 'bar' | 'column' | 'line' | 'pie' | 'ring' | 'area' | 'radar' | 'scatter';
    x: number;
    y: number;
    width: number;
    height: number;
    data: {
        labels: string[];
        legends: string[];
        series: number[][];
    };
    themeColors?: string[];
}
/** Draw LaTeX formula on whiteboard (wait for render) */
export interface WbDrawLatexAction extends ActionBase {
    type: 'wb_draw_latex';
    elementId?: string;
    latex: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    color?: string;
}
/** Draw table on whiteboard (wait for render) */
export interface WbDrawTableAction extends ActionBase {
    type: 'wb_draw_table';
    elementId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    data: string[][];
    outline?: {
        width: number;
        style: string;
        color: string;
    };
    theme?: {
        color: string;
    };
}
/** Draw line/arrow on whiteboard (wait for render) */
export interface WbDrawLineAction extends ActionBase {
    type: 'wb_draw_line';
    elementId?: string;
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color?: string;
    width?: number;
    style?: 'solid' | 'dashed';
    points?: ['', 'arrow'] | ['arrow', ''] | ['arrow', 'arrow'] | ['', ''];
}
/** Clear all whiteboard elements */
export interface WbClearAction extends ActionBase {
    type: 'wb_clear';
}
/** Delete a specific whiteboard element by ID */
export interface WbDeleteAction extends ActionBase {
    type: 'wb_delete';
    elementId: string;
}
/** Close whiteboard (wait for animation) */
export interface WbCloseAction extends ActionBase {
    type: 'wb_close';
}
/** Draw code block on whiteboard (wait for typing animation) */
export interface WbDrawCodeAction extends ActionBase {
    type: 'wb_draw_code';
    elementId?: string;
    language: string;
    code: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    fileName?: string;
}
/** Edit code block on whiteboard (line-level operations) */
export interface WbEditCodeAction extends ActionBase {
    type: 'wb_edit_code';
    elementId: string;
    operation: 'insert_after' | 'insert_before' | 'delete_lines' | 'replace_lines';
    lineId?: string;
    lineIds?: string[];
    content?: string;
}
/** Play video — start playback of a video element on the slide */
export interface PlayVideoAction extends ActionBase {
    type: 'play_video';
    elementId: string;
}
/** Discussion — trigger a roundtable discussion */
export interface DiscussionAction extends ActionBase {
    type: 'discussion';
    topic: string;
    prompt?: string;
    agentId?: string;
}
/** Widget Highlight — highlight an element in a widget iframe */
export interface WidgetHighlightAction extends ActionBase {
    type: 'widget_highlight';
    target: string;
    content?: string;
}
/** Widget SetState — set widget state (e.g., simulation variables) */
export interface WidgetSetStateAction extends ActionBase {
    type: 'widget_setState';
    state: Record<string, unknown>;
    content?: string;
}
/** Widget Annotation — add floating annotation to an element */
export interface WidgetAnnotationAction extends ActionBase {
    type: 'widget_annotation';
    target: string;
    content?: string;
}
/** Widget Reveal — reveal hidden content in widget */
export interface WidgetRevealAction extends ActionBase {
    type: 'widget_reveal';
    target: string;
    content?: string;
}
export type Action = SpotlightAction | LaserAction | PlayVideoAction | SpeechAction | WbOpenAction | WbDrawTextAction | WbDrawShapeAction | WbDrawChartAction | WbDrawLatexAction | WbDrawTableAction | WbDrawLineAction | WbClearAction | WbDeleteAction | WbCloseAction | WbDrawCodeAction | WbEditCodeAction | DiscussionAction | WidgetHighlightAction | WidgetSetStateAction | WidgetAnnotationAction | WidgetRevealAction;
export type ActionType = Action['type'];
/** Action types that fire immediately without blocking */
export declare const FIRE_AND_FORGET_ACTIONS: ActionType[];
/** Action types that only work on slide scenes (require slide canvas elements) */
export declare const SLIDE_ONLY_ACTIONS: ActionType[];
/** Action types that must complete before the next action runs */
export declare const SYNC_ACTIONS: ActionType[];
/** Frozen set of every valid {@link ActionType}, for cheap membership checks. */
export declare const ACTION_TYPES: readonly ["spotlight", "laser", "play_video", "speech", "wb_open", "wb_draw_text", "wb_draw_shape", "wb_draw_chart", "wb_draw_latex", "wb_draw_table", "wb_draw_line", "wb_draw_code", "wb_edit_code", "wb_clear", "wb_delete", "wb_close", "discussion", "widget_highlight", "widget_setState", "widget_annotation", "widget_reveal"];
/** Narrow an unknown value to a valid {@link ActionType}. Pure, no runtime deps. */
export declare function isActionType(value: unknown): value is ActionType;
/**
 * Percentage-based geometry (0-100 coordinate system)
 * Used by spotlight/laser overlays for responsive positioning.
 */
export interface PercentageGeometry {
    x: number;
    y: number;
    w: number;
    h: number;
    centerX: number;
    centerY: number;
}
//# sourceMappingURL=action.d.ts.map