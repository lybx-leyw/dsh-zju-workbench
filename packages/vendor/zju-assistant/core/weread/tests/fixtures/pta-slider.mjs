/** 合成原图、带透明边距的拼块及变暗的缺口，不含站点会话或真实题图。 */
export function ptaImages({ width = 320, height = 160, pieceWidth = 64, pieceHeight = 64, targetX = 185, y = 48, flat = false, duplicate = false, seed = 1 } = {}) {
  const background = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const piece = { width: pieceWidth, height: pieceHeight, data: new Uint8ClampedArray(pieceWidth * pieceHeight * 4) }
  for (let i = 0; i < background.data.length; i += 4) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const value = flat ? 120 : 45 + (seed >>> 24) * 0.6
    background.data.set([value, value + 15, value + 30, 255], i)
  }
  for (let row = 7; row < pieceHeight - 5; row++) for (let col = 5; col < pieceWidth - 5; col++) {
    if ((col - pieceWidth / 2) ** 2 + (row - 7) ** 2 < 36) continue
    const i = ((y + row) * width + targetX + col) * 4, j = (row * pieceWidth + col) * 4
    piece.data.set(background.data.subarray(i, i + 4), j)
    for (let c = 0; c < 3; c++) background.data[i + c] = 15 + background.data[i + c] * 0.48
    if (duplicate) {
      const other = ((y + row) * width + 30 + col) * 4
      background.data.set(background.data.subarray(i, i + 4), other)
    }
  }
  // 拼块白色描边不能参与纹理匹配。
  const alpha = piece.data.slice()
  for (let row = 2; row < pieceHeight - 2; row++) for (let col = 2; col < pieceWidth - 2; col++) {
    const i = (row * pieceWidth + col) * 4
    if (!alpha[i + 3]) continue
    if ([-2, 2].some(d => !alpha[((row + d) * pieceWidth + col) * 4 + 3] || !alpha[(row * pieceWidth + col + d) * 4 + 3])) piece.data.set([255, 255, 255], i)
  }
  return { background, piece, position: { x: 10, y }, answer: { targetX, targetY: y } }
}
