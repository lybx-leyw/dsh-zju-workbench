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

/**
 * 四个汇总的展示文案。
 *
 * 语速和主线占比在覆盖时长为 0 时是 `null`（单块没有「相邻」）。这里写成
 * 「估不出来」，不用 0 顶上——0 会被读成「老师没说话」或「没有主线」。
 * 知识点数和例题数是计数，0 就是 0。
 */
export function sectionFacts(stats) {
  const speed = stats?.averageCharsPerMinute;
  const share = stats?.mainlineRatio;
  return [
    { label: '平均语速', value: speed == null ? '估不出来' : `${Math.round(speed)} 字/分` },
    { label: '知识点数', value: String(stats?.knowledgePointCount ?? 0) },
    { label: '主线占比', value: share == null ? '估不出来' : `${Math.round(share * 100)}%` },
    { label: '例题', value: String(stats?.exampleCount ?? 0) },
  ];
}
