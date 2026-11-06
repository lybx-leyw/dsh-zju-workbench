/**
 * 讲义 → 可检索的本地索引。
 *
 * # 为什么要有这一层
 *
 * 上游这些工具的正文都来自外部服务（LightRAG / PageIndex / 文件系统）。本仓的
 * 讲义是**已经在内存里的** `{chapters:[{title, topics:[{title, blocks:[{kind,text}]}]}]}`，
 * 再去调一个外部检索服务既没有意义（数据就在手上），也会把「同一份讲义」变成
 * 两个真相源。所以三个读工具（rag / kb_files / read_source）共用这一层的同一份
 * 索引 —— 它们的 id、正文、顺序必须永远一致，否则模型从 `kb_files` 看到的 id
 * 拿去 `read_source` 会取不到东西。
 *
 * # id 为什么长这样
 *
 * `ch1` / `t1-2` / `b1-2-3` 是**结构位置**派生的，与
 * `dsh-zhiyun-core-learning-resource` 的 `fromLecture()` 逐字一致（那边产出
 * `ch{i}` / `t{i}-{j}` / `b{i}-{j}-{k}`）。这条一致性是硬要求而不是巧合：
 * 同一份讲义投影出的 learning-resource bundle 与这里算出的 id 若不一致，
 * 「题目回到来源」的链条就会在两层之间断掉。
 *
 * 由此推出两个容易被"顺手优化掉"的细节：
 * 1. **id 用原始下标算，不是过滤后的下标**。空正文块被跳过（`sources.js` 的
 *    `EMPTY_BLOCK` 行为），但它仍然占一个位置 —— 否则第 3 块空了，第 4 块就
 *    变成了 `b1-2-3`，两份实现从此对不上。
 * 2. **只依赖顺序，不依赖标题**。改标题不该让所有 id 重排，否则已出的题目
 *    会全部指向错误的块。
 */

/** 讲义块 → 纯文本。与 `core-learning-resource/sources.js` 的 `lectureBlockText` 同口径。 */
export function lectureBlockText(block) {
  if (!block || typeof block !== 'object') return '';
  const wire = typeof block.kind === 'string' ? block.kind : block.kind?.wire ?? null;
  if (wire === 'example') {
    // 例题的正文是「题干 + 解答」，只取 text 会丢解答（那是题目要考的东西）。
    return [block.stem, block.solution]
      .map((part) => (typeof part === 'string' ? part.trim() : ''))
      .filter((part) => part !== '')
      .join('\n\n');
  }
  const raw = block.text ?? block.displayText ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function str(value) {
  return typeof value === 'string' ? value : '';
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

/**
 * 建索引。
 *
 * # `sources` 为什么只收知识点，不收章和块
 *
 * 上游 `read_source` 读的是「一个已挂载来源」，而 sources 的粒度决定了
 * 上游那条**唯一来源自动补 id** 的行为能不能生效（`len(source_index) == 1`
 * 时省掉 source_id）。如果章、知识点、块三级全塞进 sources，一份只有一节的
 * 讲义也会有三条来源，那条分支永远走不到 —— 模型每次都必须填 id，
 * 而它填错的概率远高于上游。
 *
 * 所以 `sources` 的粒度对齐「讲义里可以被读懂的最小完整单元」= **知识点**：
 * - 章是知识点的容器，读整章在出题场景里等于「把这一节全喂进去」，
 *   没有比逐知识点读更有信息量，却让 id 空间多一层；
 * - 块是 `rag` 的**引用粒度**（引用要精确到块，否则说不清哪句话），
 *   但块不是「来源」：块不独立成篇，读它等于读知识点的一部分。
 *
 * 两套粒度各司其职：`rag` 用块引用 + 知识点 id，`read_source` 用知识点 id 读全文。
 * 模型从 `[t1-2]` 引用里拿到的 id 正好能拿回 `read_source` 读 —— 这条链是闭环的。
 *
 * @param {object} lecture `{title?, chapters:[{title?, topics:[{title?, blocks?, passages?}]}]}`
 * @returns {{
 *   chapters: Array<object>,
 *   sources: Map<string, object>,
 *   outline: Array<{id: string, name: string, chapterTitle: string, topicTitle: string}>,
 *   blocks: Array<object>,
 *   counts: {chapters: number, topics: number, blocks: number, chars: number},
 * }}
 */
export function buildLectureIndex(lecture) {
  const chapters = [];
  /** 可被 `read_source` 取用的来源：**知识点**一级（见上面「为什么只收知识点」）。 */
  const sources = new Map();
  /** kb_files 的「文档清单」：一个知识点算一条，名字是「章标题/知识点标题」。 */
  const outline = [];
  /** 平铺的块，rag 的检索与引用单位。 */
  const blocks = [];
  let charCount = 0;

  const rawChapters = asArray(lecture?.chapters);
  for (let ci = 0; ci < rawChapters.length; ci++) {
    const rawChapter = rawChapters[ci] ?? {};
    const chapterId = `ch${ci + 1}`;
    const chapterTitle = str(rawChapter.title).trim() || `Chapter ${ci + 1}`;
    const topics = [];
    const chapterTexts = [];

    const rawTopics = asArray(rawChapter.topics);
    for (let ti = 0; ti < rawTopics.length; ti++) {
      const rawTopic = rawTopics[ti] ?? {};
      const topicId = `t${ci + 1}-${ti + 1}`;
      const topicTitle = str(rawTopic.title).trim() || `Topic ${ci + 1}.${ti + 1}`;

      // 旧讲义只有 passages（填充失败时逐字等于 draft）：它仍然是正文，
      // 丢掉会让「讲义生成失败」变成「这个知识点是空的」——两者后果完全不同。
      const rawBlocks = asArray(rawTopic.blocks).length > 0
        ? asArray(rawTopic.blocks)
        : asArray(rawTopic.passages).map((passage) => ({ kind: 'elaboration', text: passage?.text ?? '' }));

      const topicBlocks = [];
      const topicTexts = [];
      for (let bi = 0; bi < rawBlocks.length; bi++) {
        const rawBlock = rawBlocks[bi] ?? {};
        // 下标用原始 bi 算（见文件头第 1 条）。
        const blockId = `b${ci + 1}-${ti + 1}-${bi + 1}`;
        const text = lectureBlockText(rawBlock);
        if (text === '') continue; // 空块不投影，但位置照样占掉
        const kind = typeof rawBlock.kind === 'string' ? rawBlock.kind : rawBlock.kind?.wire ?? 'elaboration';
        topicBlocks.push({ id: blockId, text, kind });
        topicTexts.push(text);
        blocks.push({
          id: blockId,
          topicId,
          chapterId,
          chapterTitle,
          topicTitle,
          text,
          kind,
        });
      }

      const topicText = topicTexts.join('\n\n');
      charCount += topicText.length;
      chapterTexts.push(topicText);

      sources.set(topicId, {
        id: topicId,
        kind: 'topic',
        title: topicTitle,
        chapterTitle,
        text: topicText,
        blockIds: topicBlocks.map((block) => block.id),
        charCount: topicText.length,
      });

      topics.push({ id: topicId, title: topicTitle, blocks: topicBlocks, text: topicText });
      // 名字用 POSIX 风格的两段路径：kb_files 的通配符按 `name` 与末段分别匹配，
      // 「章/知识点」这种形状让 `pattern="*牛顿*"` 与 `pattern="第二章/*"` 都能用。
      outline.push({
        id: topicId,
        name: `${chapterTitle}/${topicTitle}`,
        chapterTitle,
        topicTitle,
      });
    }

    const chapterText = chapterTexts.filter(Boolean).join('\n\n');
    chapters.push({ id: chapterId, title: chapterTitle, topics, text: chapterText });
  }

  return {
    chapters,
    sources,
    outline,
    blocks,
    counts: {
      chapters: chapters.length,
      topics: outline.length,
      blocks: blocks.length,
      chars: charCount,
    },
  };
}

/**
 * 来源 id 的排序键。
 *
 * 上游 `sorted(source_index.keys())` 是**字典序**，而 `t1-10` 与 `t1-2` 在字典序里
 * 前后颠倒。这里保持字典序（与上游一致：模型看到的 enum 顺序就是它），不"顺手"
 * 改成自然序 —— 顺序变化会让同一份输入产出不同的 schema 字节。
 */
export function sortSourceIds(ids) {
  return [...ids].sort();
}

/**
 * 检索用的分词。
 *
 * 中文没有空格，按空格切词等于不切。所以：拉丁词按单词切，汉字按**二元组**切
 * （单字会召回太多噪音，三元组会漏掉「牛顿第二定律」这类短术语的两字片段）。
 * 这与 `core-knowledge` 的字面检索是同一层定位：**字面匹配，不是向量检索**，
 * 所以命中理由永远说得清（命中了哪个词），不会出现"看起来相关但不知道为什么"。
 */
export function tokenize(text) {
  const lower = String(text ?? '').toLowerCase();
  const tokens = new Set();
  for (const match of lower.matchAll(/[a-z0-9][a-z0-9_+\-'.]*/g)) {
    tokens.add(match[0]);
  }
  for (const match of lower.matchAll(/[\u3400-\u4dbf\u4e00-\u9fff]+/g)) {
    const run = match[0];
    if (run.length === 1) tokens.add(run);
    for (let index = 0; index + 1 < run.length; index++) tokens.add(run.slice(index, index + 2));
  }
  return [...tokens];
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    count += 1;
    at = haystack.indexOf(needle, at + needle.length);
  }
  return count;
}

/**
 * 检索命中与否的判据：**命中了几个不同的查询词**，而不是分数过线。
 *
 * 为什么不能用「分数 ≥ 某个绝对值」：分数随查询长度线性变化，一个 3 字的
 * 查询与一个 12 字的查询根本不在同一个量纲上，阈值只能靠拍。
 *
 * 为什么阈值是「≥2 个不同词」：中文按二元组切词后，`定律` 这种高频二元组会让
 * 「库仑定律」命中「牛顿第二定律」那段 —— 只共享一个二字片段不足以说明相关。
 * 而**整串命中**（原文里真的出现了用户问的那串字）直接放行：那是最强的相关信号，
 * 不该被"只命中一个词"的规则挡掉。
 */
const MIN_DISTINCT_TOKENS = 2;

/**
 * 字面打分检索。
 *
 * 分数 = Σ(命中次数 × 词长)，再给**整串命中**一个额外权重。
 * 乘词长是因为长词更具体：「牛顿第二定律」命中一次比「的」命中十次更有信息量。
 *
 * 同分时按**讲义顺序**（`index` 升序）稳定排序：同一份讲义两次检索必须给出同一个
 * 结果顺序，否则模型看到的上文顺序会抖，出题风格跟着抖。
 */
export function searchLecture(index, query, { limit = 8 } = {}) {
  const tokens = tokenize(query);
  const phrase = String(query ?? '').trim().toLowerCase();
  if (tokens.length === 0 && phrase === '') return [];
  const needed = tokens.length <= 1 ? 1 : MIN_DISTINCT_TOKENS;
  const scored = [];
  for (let i = 0; i < index.blocks.length; i++) {
    const block = index.blocks[i];
    const haystack = block.text.toLowerCase();
    let score = 0;
    let distinct = 0;
    for (const token of tokens) {
      const hits = countOccurrences(haystack, token);
      if (hits > 0) {
        score += hits * token.length;
        distinct += 1;
      }
    }
    const wholePhrase = phrase !== '' && haystack.includes(phrase);
    if (wholePhrase) score += phrase.length * 8;
    if (!wholePhrase && distinct < needed) continue;
    if (score <= 0) continue;
    scored.push({ block, score, order: i });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.order - b.order));
  return scored.slice(0, Math.max(1, limit));
}
