/**
 * 把解析终稿的块改成播放统计认的形状。
 *
 * 终稿上的角色写在 `tag.role`，取值是「主线 / 支线」。统计层只认 `main` / `branch`，
 * 主线占比也只数 `main`。这里做这一次对照，统计函数本身不认识解析器的字段名。
 */
export function blocksForStats(result) {
  return (result?.blocks ?? []).map((block) => ({
    startMs: block?.startMs,
    endMs: block?.endMs,
    sentences: block?.sentences,
    text: block?.text,
    role: statsRole(block?.tag?.role ?? block?.role),
    facets: block?.tag?.facets ?? block?.facets ?? [],
    summary: block?.tag?.summary ?? block?.summary ?? '',
  }));
}

function statsRole(value) {
  if (value === 'main' || value === '主线') return 'main';
  if (value === 'branch' || value === '支线') return 'branch';
  return null;
}
