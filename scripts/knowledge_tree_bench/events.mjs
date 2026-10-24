/**
 * 把 run.mjs 里零散的 emit 收成一个事件记录器。
 *
 * # 为什么要有这一层
 *
 * 之前每个阶段各写一套 emit，字段名还不统一（`stage.page` / `stage.index` /
 * `stage.id`）。日志要能"不现场也重建画面"，就得让每条事件形状一致：
 * `{ act, subject, data, t }` —— 谁、做了什么、产出什么、什么时候。
 *
 * 这层只做**归一化**，不判断业务：它不知道 vision 和 mix 的区别，
 * 只负责保证每条事件都符合 `log.mjs` 的契约。
 */

/**
 * 一个块的正文。真实块的正文在 `sentences[]`（有时候也有 `text`）。
 *
 * 全基准只该有**一处**取正文的写法 —— 分散写就会出现"这里读 text、
 * 那里读 sentences"，同一块在不同视图字数不同（审查第 6 条就是这么来的）。
 */
export function blockTextOf(block) {
  if (!block) return '';
  if (block.text != null && block.text !== '') return String(block.text);
  return (block.sentences ?? []).map((s) => s.text ?? '').join('');
}

/**
 * 一个 topic 的**可读正文**。
 *
 * 三种来源按优先级取（与 `hasBody` 同序）：
 *   · `passages` —— 习坎写出来的正文段落（最常见）
 *   · `blocks`   —— 结构化块（模型可能只给这个）
 *   · `draft`    —— 老师原话（填充失败时的兜底）
 */
export function bodyTextOf(topic) {
  if (!topic) return '';
  const passages = (topic.passages ?? []).map((p) => String(p.text ?? '')).filter(Boolean);
  if (passages.length) return passages.join('\n\n');
  const blocks = (topic.blocks ?? []).map((b) => {
    if (b.kind?.wire === 'example') return [b.stem, b.solution].filter(Boolean).join('\n');
    return String(b.text ?? '');
  }).filter(Boolean);
  if (blocks.length) return blocks.join('\n\n');
  return String(topic.draft ?? '');
}

/** 一个 topic 有没有正文（三种来源任一）。 */
function hasBody(topic) {
  const passageChars = (topic.passages ?? []).reduce((a, p) => a + String(p.text ?? '').length, 0);
  const blockChars = (topic.blocks ?? []).reduce((a, b) => a + String(b.text ?? b.stem ?? '').length, 0);
  const draftChars = String(topic.draft ?? '').length;
  return passageChars > 0 || blockChars > 0 || draftChars > 0;
}

/** 正文来自哪里（追查用）。 */
function bodySourceOf(topic) {
  if ((topic.passages ?? []).length) return 'passages';
  if ((topic.blocks ?? []).length) return 'blocks';
  if (String(topic.draft ?? '').length) return 'draft';
  return 'none';
}

/** 归一化一条事件。`at` 是相对开始的毫秒。 */
export function makeEvent(act, subject, data = {}, at = 0) {
  return {
    act,
    subject: subject ?? null,
    data: data ?? {},
    t: Number.isFinite(at) ? at : 0,
  };
}

/**
 * 从**解析产物**里抽出所有事件（用于没有实时回调的阶段）。
 *
 * 识别（vision/mix）**不能**走这里：它是并发的，事件必须按真实到达顺序发。
 * 这里只处理那些"一次性算完、顺序无争议"的阶段：筛支线 → 挂账 → 审查合并
 * → 重构 → 习坎 → 终稿。
 */
export function eventsFromResult(result) {
  const out = [];

  for (const item of result.board ?? []) {
    out.push(makeEvent('sieve', item.index, {
      page: item.page, why: item.why, summary: item.tag?.summary ?? '',
    }));
  }

  /* ★ 挂账事件必须读**挂账时的快照**。
   *
   * 审查第 9 条：早先读 `result.leafTrees` 的 `pendingTok` —— 但那时拆分
   * 已经把它清零了。实测 6000 token 的输入，回放里的"挂账"是 0 token。
   * 那不是"过程"，是"结果"被当成了"过程"。
   *
   * `result.stashSnapshot` 由 `buildTreeFromBlocks` 在挂账**之后、合并之前**
   * 留一份（见 tree.js）。没有它就退回 0 并**如实标注 `estimated: false`**，
   * 不假装知道。
   */
  const snapshot = result.stashSnapshot ?? null;
  if (Array.isArray(snapshot)) {
    for (const leaf of snapshot) {
      out.push(makeEvent('stash', leaf.page ?? null, {
        page: leaf.page ?? null,
        blocks: leaf.blocks ?? 0,
        pendingTok: leaf.pendingTok ?? 0,
        fromSnapshot: true,
      }));
    }
  } else {
    for (const leaf of result.leafTrees ?? []) {
      out.push(makeEvent('stash', leaf.page ?? null, {
        page: leaf.page ?? null, blocks: (leaf.blocks ?? []).length,
        pendingTok: leaf.pendingTok ?? 0,
        /* 老实说：这个数来自合并后的状态，可能是 0，不能当挂账时的量。 */
        fromSnapshot: false,
        note: '这是合并后的叶，pendingTok 已被清零；无挂账快照',
      }));
    }
  }

  for (const [i, item] of (result.mergeStats ?? []).entries()) {
    /* ★ 必须带 `overLine`：区分「没超线所以没切」与「超线但切不开」。
     *
     * 审查第 4 条：界面用 `split ? '切了' : '未超线'`，把"切不开"当成"没超线"。
     * 但真实块结构不匹配时，超长叶**根本切不动** —— 画成正常正好遮住
     * 「斩杀线是否有效」这个要验收的问题。
     *
     * `tookTok` 是合并前的 token 量（`mergeLeaf` 返回它），拿它和斩杀线比。
     */
    out.push(makeEvent('merge', i, {
      split: Boolean(item.split), parts: item.parts ?? 0, deep: item.deepSplits ?? 0,
      tookTok: item.tookTok ?? item.took ?? null,
      /* 由上层填（它知道本次的 splitLine），这里先留 null 表示"待定"。 */
      overLine: null,
      /* ★ **合并前后正文**（审查第 15 条）：只给计数无法验收 merge 做对没有。 */
      before: item.before ?? '',
      after: item.after ?? '',
      attachMade: item.attachMade ?? 0,
      depth: item.depth ?? 0,
    }));
  }

  for (const [i, point] of (result.knowledgePoints ?? []).entries()) {
    const blocks = point.blocks ?? [];
    out.push(makeEvent('regroup', point.id ?? `n${i}`, {
      tok: point.tok ?? 0,
      merged: point.merged ?? 1,
      pages: [...new Set(blocks.map((b) => b.page))].filter((p) => p != null),
      /* ⚠️ 正文在 `sentences[]`，块上没有 `text`。
       *
       * 早先读 `b.text ?? ''` → 真实块恒为 0 → 界面把有内容的知识点显示成
       * "0 字"（审查第 6 条）。这类假读数会让人怀疑整屏数据。
       */
      chars: blocks.reduce((a, b) => a + blockTextOf(b).length, 0),
      /* 标题取**第一块的概述**。不编造：没有概述就留空，界面显示"（无名）"。 */
      title: String(blocks.map((b) => b.tag?.summary ?? '').find((s) => s.trim()) ?? '').trim(),

      /* ★ **来源追踪**（审查第 17 条）。
       *
       * 早先只给"来源页"和字数 —— 同页有多个知识点时分不清谁是谁，
       * 上一轮发现的"概念正文丢失、例题重复"也无法沿屏幕追到原因。
       *
       * 现在给出完整来源：
       *   · `blockIds`  —— 这个知识点由哪些块组成（块 index）
       *   · `spans`     —— 每块的句号范围（`_segment` 表示它是某块的切分片段）
       *   · `attachIds` —— 依附块（例题/案例）
       *   · `mergedFrom`—— 由几片叶并来（重聚时合并的段数）
       */
      /* ★ 来源标识必须**唯一到片段**。
       *
       * 一个块被切成两片时，两片的 `index` 相同 —— 只用 index 会让
       * "同一块被两个知识点收录"变成假报警（内容其实没重复）。
       * 所以：有 `_part` 就用 `index#part`。
       */
      blockIds: blocks
        .map((b) => {
          const base = b.index ?? b._splitFrom ?? null;
          if (base == null) return null;
          return b._part == null ? String(base) : `${base}#${b._part}`;
        })
        .filter((x) => x != null),
      /* ★ **句子范围**必须是真实区间，不只是数量。
       *
       * 审查第 17 条：只给"多少句"时，你无法回答"这个知识点覆盖了老师讲的
       * 第几句话到第几句"，也就无法据此回查音频/原文对不上的地方。
       *
       * 这里给出：
       *   · `sentenceRange` —— [起始 ms, 结束 ms]（可回查音频）
       *   · `sentenceCount` —— 句数
       *   · `firstText`     —— 首句原文（能立刻认出讲了什么）
       */
      spans: blocks.map((b) => {
        const ss = b.sentences ?? [];
        const starts = ss.map((x) => x.startMs).filter((x) => Number.isFinite(x));
        const ends = ss.map((x) => x.endMs ?? x.startMs).filter((x) => Number.isFinite(x));
        return {
          block: b.index ?? b._splitFrom ?? null,
          /* 切分产生的块会带 `_segment`（第几段）与 `_splitFrom`（原块）。 */
          segment: b._segment ?? b._part ?? null,
          from: b._splitFrom ?? null,
          part: b._part ?? null,
          sentences: ss.length,
          sentenceCount: ss.length,
          sentenceRange: starts.length
            ? [Math.min(...starts), ends.length ? Math.max(...ends) : Math.max(...starts)]
            : null,
          firstText: String(ss[0]?.text ?? '').slice(0, 60),
          chars: blockTextOf(b).length,
          page: b.page ?? null,
        };
      }),
      attachIds: blocks.filter((b) => (b.tag?.facets ?? []).some((f) => f === '例题' || f === '案例'))
        .map((b) => b.index).filter((x) => x != null),
      mergedFrom: point.merged ?? 1,
    }));
  }

  return out;
}

/** 从讲义产物里抽习坎事件（章 → 知识点，两级）。 */
export function eventsFromLecture(assembled) {
  const out = [];
  for (const chapter of assembled.chapters ?? []) {
    const topics = chapter.topics ?? [];
    out.push(makeEvent('chapter', chapter.title ?? '', {
      title: chapter.title ?? '',
      chars: topics.reduce((a, t) => a + (t.chars ?? 0), 0),
    }));
    for (const topic of topics) {
      out.push(makeEvent('lecture', topic.title ?? '', {
        chapter: chapter.title ?? '',
        title: topic.title ?? '',
        chars: topic.chars ?? 0,
        blocks: (topic.blockIndexes ?? []).length,
        /* ★ **这一节的正文**。
         *
         * 审查第 16 条：早先只给标题、字数、块数 —— 探针里看不到一个字。
         * 那无法验收"讲义是否只由树填充、有没有编造"。
         *
         * 三种来源任一（passages / blocks / draft），拼成可读文本；
         * 截 3000 字避免单条事件过大，全量在 `lecture` 概要事件里。
         */
        text: bodyTextOf(topic).slice(0, 3000),
        /* 来源关系：这一节由哪些块支撑（追查用）。 */
        blockIndexes: (topic.blockIndexes ?? []).slice(0, 200),
        /* ⚠️ 装配后的 topic **没有** `isCovered` 字段（那是 `buildTree` 阶段的）。
         * 早先写 `Boolean(topic.isCovered)` → 恒为 false → 界面把已经写好的
         * 节点显示成"未讲"（审查第 6 条）。
         *
         * 正确判据是看**有没有正文**：有 passages/blocks/draft 就算讲过。
         * 都为空则如实标"无正文"，而不是标"未讲"。 */
        covered: hasBody(topic),
        bodySource: bodySourceOf(topic),
      }));
    }
  }
  return out;
}
