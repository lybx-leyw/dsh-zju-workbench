import { slideMediaSlotDescriptors } from './slide-media-slots.js';
import { isSlideContent } from './stage.js';
function manifestKind(slotKind) {
    switch (slotKind) {
        case 'background-image':
            return 'background';
        case 'image-src':
            return 'image';
        case 'video-src':
        case 'video-media-ref':
            return 'video';
        case 'video-poster':
            return 'poster';
        case 'audio-src':
            return 'audio';
    }
}
/**
 * Enumerate the asset manifest of one document.
 *
 * The traversal order is the document's own: stage whiteboard slides first,
 * then scenes in order (canvas, whiteboards, speech actions), then the stage's
 * video-manifest keys. That order is what makes `entries` deterministic for a
 * fixed document, which the serialized views built on top (the ZIP
 * `mediaIndex`) rely on.
 */
export function enumerateAssetManifest(document, options = {}) {
    const kindsByRef = new Map();
    const orderedPairs = [];
    const ownerKeysByRef = new Map();
    const record = (ref, kind, ownerKey) => {
        let kinds = kindsByRef.get(ref);
        if (!kinds) {
            kinds = new Set();
            kindsByRef.set(ref, kinds);
        }
        if (!kinds.has(kind)) {
            kinds.add(kind);
            orderedPairs.push({ ref, kind });
        }
        let owners = ownerKeysByRef.get(ref);
        if (!owners) {
            owners = new Set();
            ownerKeysByRef.set(ref, owners);
        }
        owners.add(ownerKey);
    };
    const visitSlide = (slide, scopeKey) => {
        for (const slot of slideMediaSlotDescriptors(slide)) {
            if (!slot.ref)
                continue;
            // Structural positions, rather than user-controlled ids, make owners
            // collision-free even for documents whose scene or element ids repeat.
            const ownerKey = slot.elementIndex !== undefined
                ? `${scopeKey}:element:${slot.elementIndex}`
                : `${scopeKey}:background`;
            record(slot.ref, manifestKind(slot.kind), slot.kind === 'video-poster' ? `${ownerKey}:poster` : ownerKey);
        }
    };
    const stage = document.stage;
    for (let index = 0; index < (stage.whiteboard ?? []).length; index += 1) {
        const slide = stage.whiteboard[index];
        visitSlide(slide, `stage-whiteboard:${index}`);
    }
    for (let sceneIndex = 0; sceneIndex < document.scenes.length; sceneIndex += 1) {
        const scene = document.scenes[sceneIndex];
        if (isSlideContent(scene.content)) {
            visitSlide(scene.content.canvas, `scene:${sceneIndex}:canvas`);
        }
        for (let index = 0; index < (scene.whiteboards ?? []).length; index += 1) {
            const slide = scene.whiteboards[index];
            visitSlide(slide, `scene:${sceneIndex}:whiteboard:${index}`);
        }
        for (let index = 0; index < (scene.actions ?? []).length; index += 1) {
            const action = scene.actions[index];
            if (action.type !== 'speech' || !action.audioId)
                continue;
            record(action.audioId, 'audio', `scene:${sceneIndex}:speech:${index}`);
        }
    }
    // The video manifest names generated stage-level videos by the mediaRef a
    // PPTVideoElement would carry; each key is a referenced video asset. It is
    // an index over that asset, not another byte owner: replacement ownership
    // remains the element/background/action accounting described above. A
    // manifest-only ref is therefore enumerated but has no provable owner and
    // correctly cannot qualify for in-place replacement.
    for (const ref of Object.keys(stage.videoManifest ?? {})) {
        let kinds = kindsByRef.get(ref);
        if (!kinds) {
            kinds = new Set();
            kindsByRef.set(ref, kinds);
        }
        if (!kinds.has('video')) {
            kinds.add('video');
            orderedPairs.push({ ref, kind: 'video' });
        }
    }
    const entries = [];
    for (const { ref, kind } of orderedPairs) {
        const metadata = options.metadata?.(ref, kind);
        entries.push({
            ref,
            kind,
            ...(metadata?.byteSize !== undefined ? { byteSize: metadata.byteSize } : {}),
            ...(metadata?.mimeType !== undefined ? { mimeType: metadata.mimeType } : {}),
            ...(metadata?.durationSeconds !== undefined
                ? { durationSeconds: metadata.durationSeconds }
                : {}),
            ...(metadata?.voice !== undefined ? { voice: metadata.voice } : {}),
            ...(metadata?.prompt !== undefined ? { prompt: metadata.prompt } : {}),
        });
    }
    const referenceCounts = new Map([...ownerKeysByRef].map(([ref, owners]) => [ref, owners.size]));
    return { entries, referenceCounts };
}
//# sourceMappingURL=asset-manifest.js.map