function getElementPercentageGeometry(element, viewportSize = 1000, viewportRatio = 0.5625) {
    if (!('left' in element) ||
        !('top' in element) ||
        !('width' in element) ||
        !('height' in element)) {
        return null;
    }
    const { left, top, width, height } = element;
    const x = (left / viewportSize) * 100;
    const y = (top / (viewportSize * viewportRatio)) * 100;
    const w = (width / viewportSize) * 100;
    const h = (height / (viewportSize * viewportRatio)) * 100;
    const centerX = x + w / 2;
    const centerY = y + h / 2;
    return { x, y, w, h, centerX, centerY };
}
function findElementGeometry(elements, elementId, viewportSize = 1000, viewportRatio = 0.5625) {
    const element = elements.find((el) => el.id === elementId);
    if (!element)
        return null;
    return getElementPercentageGeometry(element, viewportSize, viewportRatio);
}
function findNearestCorner(geometry) {
    const { centerX, centerY } = geometry;
    const corners = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
    ];
    let minDistance = Infinity;
    let nearestCorner = corners[0];
    for (const corner of corners) {
        const distance = Math.sqrt(Math.pow(corner.x - centerX, 2) + Math.pow(corner.y - centerY, 2));
        if (distance < minDistance) {
            minDistance = distance;
            nearestCorner = corner;
        }
    }
    return nearestCorner;
}

export { findElementGeometry, findNearestCorner, getElementPercentageGeometry };
//# sourceMappingURL=geometry.js.map
