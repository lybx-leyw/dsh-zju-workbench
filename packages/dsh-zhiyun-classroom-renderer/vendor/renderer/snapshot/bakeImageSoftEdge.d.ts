/**
 * Bake the soft-edge feather (a:softEdge) into an <img>'s bitmap. html2canvas-pro
 * ignores CSS masks, so the feather BaseImageElement applies is lost in the PNG.
 * The feather radius is read from `data-soft-edge` (px in the element's displayed
 * box) and scaled to the image's natural pixels. Two `destination-in` linear
 * gradient passes multiply the alpha down to 0 within `r` of each edge (corners
 * get both axes), matching the live CSS mask. No-ops on undecoded/ CORS-tainted
 * images or zero radius.
 */
export declare function bakeImageSoftEdge(img: HTMLImageElement): Promise<void>;
