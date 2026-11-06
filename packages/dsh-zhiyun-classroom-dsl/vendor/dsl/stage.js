/** Frozen set of every valid {@link SceneType}, for cheap membership checks. */
export const SCENE_TYPES = [
    'slide',
    'quiz',
    'interactive',
    'pbl',
];
const _sceneTypesExhaustive = true;
void _sceneTypesExhaustive;
/** Narrow an unknown value to a valid {@link SceneType}. Pure, no runtime deps. */
export function isSceneType(value) {
    return typeof value === 'string' && SCENE_TYPES.includes(value);
}
// ---------------------------------------------------------------------------
// Pure discriminant guards
// ---------------------------------------------------------------------------
/**
 * Narrow a candidate to {@link SlideContent}. Accepts any value tagged with a
 * `type: SceneType` discriminant, including a consumer-specialized interactive
 * content union.
 * Pure, no runtime deps.
 */
export function isSlideContent(content) {
    return content.type === 'slide';
}
/**
 * Narrow a candidate to {@link QuizContent}. Accepts any value tagged with a
 * `type: SceneType` discriminant, including a consumer-specialized interactive
 * content union.
 * Pure, no runtime deps.
 */
export function isQuizContent(content) {
    return content.type === 'quiz';
}
//# sourceMappingURL=stage.js.map