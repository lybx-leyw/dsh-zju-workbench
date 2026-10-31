import { isConcreteMediaAddress } from './media-address.js';
import { isSlideContent } from './stage.js';
import { slideMediaSlotDescriptors } from './slide-media-slots.js';
export const ELEMENT_BOUND_CUE_TYPES = new Set([
    'spotlight',
    'laser',
    'play_video',
]);
const blank = (value) => !value?.trim();
const issueId = (kind, sceneId, actionId, elementId, slideId) => JSON.stringify([kind, sceneId, actionId, elementId, slideId]);
/** Whether a value has the generated image/video placeholder shape. */
export function isGeneratedMediaPlaceholder(value) {
    return !!value && /^gen_(img|vid)_[\w-]+$/i.test(value);
}
/** Existing timeline lint, shared with the course collector. */
function collectActionContentIssues(sceneId, actions) {
    const issues = [];
    for (const action of actions) {
        let kind;
        if (action.type === 'speech' && blank(action.text))
            kind = 'empty-speech';
        else if (ELEMENT_BOUND_CUE_TYPES.has(action.type) &&
            blank(action.elementId))
            kind = 'unbound-cue';
        else if (action.type === 'discussion' && blank(action.topic))
            kind = 'empty-discussion';
        if (kind)
            issues.push({
                id: issueId(kind, sceneId, action.id),
                kind,
                sceneId,
                actionId: action.id,
                severity: 'warning',
                source: 'document',
            });
    }
    return issues;
}
/** Pure current-document derivation: changing the cause removes the issue. */
export function collectCourseIssues(document, context = {}) {
    const issues = [];
    for (const scene of document.scenes) {
        const actions = scene.actions ?? [];
        const add = (kind, fields = {}, slideId) => issues.push({
            id: issueId(kind, scene.id, fields.actionId, fields.elementId, slideId),
            kind,
            sceneId: scene.id,
            severity: 'warning',
            source: 'document',
            ...fields,
        });
        if (!actions.length)
            add('empty-actions');
        issues.push(...collectActionContentIssues(scene.id, actions));
        const canvas = isSlideContent(scene.content) ? scene.content.canvas : undefined;
        const targets = new Map((canvas?.elements ?? []).map((element) => [element.id, element.type]));
        for (const action of actions) {
            if (action.type === 'speech' &&
                !blank(action.text) &&
                blank(action.audioId) &&
                context.narrationEnabled !== false) {
                const legacyUrl = action.audioUrl;
                const legacy = action.audioInvalidated || blank(action.id)
                    ? false
                    : context.hasLegacyAudio?.(scene, action);
                if ((!action.audioInvalidated && !blank(legacyUrl)) || legacy === true)
                    continue;
                add('speech-without-audio', {
                    actionId: action.id,
                    ...(legacy === undefined ? { evidence: 'local-audio-unchecked' } : {}),
                });
            }
            else if (ELEMENT_BOUND_CUE_TYPES.has(action.type)) {
                const elementId = action.elementId;
                if (elementId &&
                    !blank(elementId) &&
                    (!targets.has(elementId) ||
                        (action.type === 'play_video' && targets.get(elementId) !== 'video')))
                    add('dangling-cue', { actionId: action.id, elementId });
            }
        }
        for (const slide of [...(canvas ? [canvas] : []), ...(scene.whiteboards ?? [])]) {
            const reported = new Set();
            for (const slot of slideMediaSlotDescriptors(slide)) {
                if (!isGeneratedMediaPlaceholder(slot.ref) || reported.has(slot.elementIndex))
                    continue;
                const element = slot.elementIndex === undefined ? undefined : slide.elements[slot.elementIndex];
                if (element?.type === 'video' &&
                    (slot.property === 'src' || slot.property === 'mediaRef')) {
                    const source = isConcreteMediaAddress(element.src)
                        ? element.src
                        : element.mediaRef || element.src;
                    if (!isGeneratedMediaPlaceholder(source))
                        continue;
                }
                reported.add(slot.elementIndex);
                add('media-not-generated', {
                    ...(slot.elementIndex === undefined
                        ? {}
                        : { elementId: slide.elements[slot.elementIndex].id }),
                }, slide.id);
            }
        }
    }
    return issues;
}
//# sourceMappingURL=course-issues.js.map