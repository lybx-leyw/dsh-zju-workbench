/**
 * 场景排序：按 `order` 升序，同序保持原顺序（稳定）。
 *
 * 源：ref/OpenMAIC/lib/export/standalone-html/order-scenes.ts:1-14
 *
 * 导出与播放器共用这一条规则；上游把它放在导出层，就是为了两边不会漂移。
 */
export function orderManifestScenes(scenes) {
  return scenes
    .map((scene, index) => ({ scene, index }))
    .sort((a, b) => (a.scene.order ?? 0) - (b.scene.order ?? 0) || a.index - b.index)
    .map(({ scene }) => scene);
}
