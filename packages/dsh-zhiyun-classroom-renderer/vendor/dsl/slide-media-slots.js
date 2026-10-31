/** Yield the canonical media-slot classification for one slide. */
export function* slideMediaSlotDescriptors(slide) {
    const background = slide.background?.type === 'image' ? slide.background.image : undefined;
    if (background) {
        yield { kind: 'background-image', property: 'src', ref: background.src };
    }
    for (let elementIndex = 0; elementIndex < slide.elements.length; elementIndex += 1) {
        const element = slide.elements[elementIndex];
        if (element.type === 'image') {
            yield { kind: 'image-src', elementIndex, property: 'src', ref: element.src };
            continue;
        }
        if (element.type === 'audio') {
            yield { kind: 'audio-src', elementIndex, property: 'src', ref: element.src };
            continue;
        }
        if (element.type !== 'video')
            continue;
        yield { kind: 'video-src', elementIndex, property: 'src', ref: element.src };
        yield {
            kind: 'video-media-ref',
            elementIndex,
            property: 'mediaRef',
            ref: element.mediaRef,
        };
        yield { kind: 'video-poster', elementIndex, property: 'poster', ref: element.poster };
    }
}
//# sourceMappingURL=slide-media-slots.js.map