/** Frozen set of every supported element type, for cheap membership checks. */
export const PPT_ELEMENT_TYPES = [
    'text',
    'image',
    'shape',
    'line',
    'chart',
    'table',
    'latex',
    'video',
    'audio',
    'code',
];
export function isPPTElementType(value) {
    return typeof value === 'string' && PPT_ELEMENT_TYPES.includes(value);
}
export function isTextElement(el) {
    return el.type === 'text';
}
export function isImageElement(el) {
    return el.type === 'image';
}
export function isShapeElement(el) {
    return el.type === 'shape';
}
export function isLineElement(el) {
    return el.type === 'line';
}
export function isChartElement(el) {
    return el.type === 'chart';
}
export function isTableElement(el) {
    return el.type === 'table';
}
export function isLatexElement(el) {
    return el.type === 'latex';
}
export function isVideoElement(el) {
    return el.type === 'video';
}
export function isAudioElement(el) {
    return el.type === 'audio';
}
export function isCodeElement(el) {
    return el.type === 'code';
}
//# sourceMappingURL=guards.js.map