import type { SpeechAction } from './action.js';
import type { SceneCore, SceneType, SlideContent } from './stage.js';
export type CourseIssueKind = 'speech-without-audio' | 'media-not-generated' | 'dangling-cue' | 'empty-actions' | 'empty-speech' | 'unbound-cue' | 'empty-discussion';
export interface CourseIssue {
    /** Opaque identity derived from kind and document target; stable across recomputation. */
    id: string;
    kind: CourseIssueKind;
    sceneId: string;
    elementId?: string;
    actionId?: string;
    severity: 'error' | 'warning';
    source: 'document' | 'run' | 'runtime';
    /** Device-local evidence has not been checked for an eligible legacy action. */
    evidence?: 'local-audio-unchecked';
}
/** Structural view shared by the app's extended scenes and SDK documents. */
export type CourseIssueScene = SceneCore & {
    content: SlideContent | {
        type: SceneType;
    };
};
export interface CourseIssueContext {
    /** False when the workspace cannot generate narration; defaults to inspecting it. */
    narrationEnabled?: boolean;
    /** Browser evidence for an unstamped legacy action; undefined means unknown. */
    hasLegacyAudio?: (scene: CourseIssueScene, action: SpeechAction) => boolean | undefined;
}
export declare const ELEMENT_BOUND_CUE_TYPES: ReadonlySet<string>;
/** Whether a value has the generated image/video placeholder shape. */
export declare function isGeneratedMediaPlaceholder(value: string | undefined): value is string;
/** Pure current-document derivation: changing the cause removes the issue. */
export declare function collectCourseIssues(document: {
    scenes: readonly CourseIssueScene[];
}, context?: CourseIssueContext): CourseIssue[];
//# sourceMappingURL=course-issues.d.ts.map