/**
 * 进度条分段归并：把细碎的块合并成**视觉上清爽**的几段。
 *
 * # 为什么需要它
 *
 * `core-player` 的 `buildContentSegments` 保留的是**语义边界**：它要求
 * 「相邻 + 角色相同 + `facets` 完全一致」才合并。而 `facets` 是解析器
 * 为每块单独标的细维度（定义 / 例子 / 推导…），两句相邻的话只要维度不同
 * 就会断开 —— 于是 100 分钟的课可能画出**几十上百个短段**，在 20px 高的
 * 轨道上就是一片密密麻麻的方块（用户原话："每个主线都是一个框，显得拥挤"）。
 *
 * 那个语义边界对**统计**有价值（知识点数、主线占比都靠它），所以不能改
 * `core-player`。但在**渲染**这一层，用户要的是"一眼看出结构"，不是"逐块
 * 编号"。所以归并放在这里。
 *
 * # 归并规则
 *
 * 只按"够不够长、够不够近"合并，**不看 facets**：
 *
 * | 参数 | 默认 | 理由 |
 * |---|---|---|
 * | `minSegmentMs` | 90s | 短于 1.5 分钟的段在 20px 轨道上不到 2px，画出来只是噪声 |
 * | `maxGapMs` | 30s | 间隔 30 秒内视为连续讲述；再长用户会认为是"跳出去过" |
 *
 * 两条都满足才并；不满足就保持分开 —— 真正的空档不该被填平
 * （填平会让"这段是连续的"变成谎话）。
 *
 * # 为什么角色不同的段不能并
 *
 * 主线与支线的颜色不同。把它们并成一段就必须二选一颜色，等于丢掉
 * "这里有支线"的信息。所以归并**只在同角色内部**做。
 */

/** 默认参数。 */
export const SEGMENT_MERGE_DEFAULTS = Object.freeze({
  /** 短于它的段会被并入邻居（20px 高度下不到 2px 的部分画了也没用）。 */
  minSegmentMs: 90_000,
  /** 间隔小于它的相邻段视为连续讲述。 */
  maxGapMs: 30_000,
});

/**
 * 归并分段。
 *
 * @param segments - `toSeekBar().segments`：`[{ from, to, role, summary, blockIndexes }]`，
 *   `from`/`to` 是 0–1 比例。
 * @param axisMs - 轨道总长（毫秒）。比例换算回毫秒要用它。
 * @param options - 覆盖 `SEGMENT_MERGE_DEFAULTS`。
 * @returns 归并后的新数组，形状与输入一致，按 `from` 升序、互不重叠。
 *
 * 算法：从左到右扫，对每个段判断"能不能并进上一段"。判断依据是
 * **上一段的当前长度**与**两段之间的空隙** —— 不是原始长度。
 * 因为连续合并多段之后，上一段可能已经够长了。
 */
export function mergeSegments(segments, axisMs, options = {}) {
  const { minSegmentMs, maxGapMs } = { ...SEGMENT_MERGE_DEFAULTS, ...(options ?? {}) };
  const list = Array.isArray(segments) ? segments : [];
  const axis = Number(axisMs);
  if (list.length === 0) return [];
  // 没有总长就换算不了毫秒 —— 原样返回，宁可拥挤也不要画错。
  if (!Number.isFinite(axis) || axis <= 0) return list.map((segment) => ({ ...segment }));

  const out = [];
  for (const segment of list) {
    const from = Number(segment?.from);
    const to = Number(segment?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) continue;

    const last = out[out.length - 1];
    if (last === undefined) {
      out.push(clone(segment, from, to));
      continue;
    }

    const gapMs = (from - last.to) * axis;
    const lastLengthMs = (last.to - last.from) * axis;
    // 角色不同绝不合并：颜色是唯一能表达"这里是支线"的通道。
    const sameRole = (last.role ?? 'none') === (segment.role ?? 'none');
    // 上一段已经够长、且这一段离得近 → 并进去（"长的吸收短的"）。
    // 上一段还很短、且两个都短 → 也并（"短的抱团"）。
    const absorbable = sameRole
      && gapMs <= maxGapMs
      && (lastLengthMs >= minSegmentMs || (to - from) * axis < minSegmentMs);

    if (absorbable) {
      last.to = to;
      // 摘要保留上一段的：合并后仍是"这一段从哪开始讲的东西"，
      // 换成后一段的会让标签指向这一大段中间某个位置，读起来是错的。
      last.blockIndexes = [...last.blockIndexes, ...(segment.blockIndexes ?? [])];
      continue;
    }
    out.push(clone(segment, from, to));
  }

  // 收尾：末尾若还剩一个明显过短的段，并回上一个（同角色且相邻）。
  // 不并的话它会孤零零地停在最右边，看着像渲染错误。
  if (out.length >= 2) {
    const tail = out[out.length - 1];
    const prev = out[out.length - 2];
    const tailMs = (tail.to - tail.from) * axis;
    const gapMs = (tail.from - prev.to) * axis;
    const sameRole = (prev.role ?? 'none') === (tail.role ?? 'none');
    if (tailMs < minSegmentMs && gapMs <= maxGapMs && sameRole) {
      prev.to = tail.to;
      prev.blockIndexes = [...prev.blockIndexes, ...tail.blockIndexes];
      out.pop();
    }
  }

  return out;
}

function clone(segment, from, to) {
  return {
    from,
    to,
    role: segment?.role ?? 'none',
    summary: typeof segment?.summary === 'string' ? segment.summary : '',
    blockIndexes: Array.isArray(segment?.blockIndexes) ? [...segment.blockIndexes] : [],
  };
}
