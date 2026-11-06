import type { Slide } from './slides.js';
/** Every media-bearing property the slide DSL assigns a semantic role. */
export type SlideMediaSlotKind = 'background-image' | 'image-src' | 'audio-src' | 'video-src' | 'video-media-ref' | 'video-poster';
export type SlideMediaSlotProperty = 'src' | 'mediaRef' | 'poster';
/**
 * A read-only description of one media slot in a slide.
 *
 * `elementIndex` is absent only for the image background. Optional properties
 * are described even when empty so consumers that write slots and consumers
 * that only enumerate populated refs share exactly the same role definition.
 */
export interface SlideMediaSlotDescriptor {
    readonly kind: SlideMediaSlotKind;
    readonly elementIndex?: number;
    readonly property: SlideMediaSlotProperty;
    readonly ref: string | undefined;
}
/** Yield the canonical media-slot classification for one slide. */
export declare function slideMediaSlotDescriptors(slide: Pick<Slide, 'background' | 'elements'>): Generator<SlideMediaSlotDescriptor>;
//# sourceMappingURL=slide-media-slots.d.ts.map