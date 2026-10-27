/**
 * 中文友好的 `tokenize` —— 候选骨架里的**纯函数占位**，不含检索逻辑。
 *
 * 上游 `minisearch@7.2.0` 的默认分词只按空白与标点切（见 `./upstream.js`
 * `UPSTREAM_HAS_CJK_TOKENIZER` 一节的实跑表）。本文件只做一件事：
 * **把「一段中文」切成「能被倒排表命中的单元」**，其余（加权、前缀、打分、
 * 序列化）一律交回上游，不重写。
 *
 * # 切片口径（初稿，未定稿）
 *
 * | 字符类型 | 切法 | 例 |
 * | --- | --- | --- |
 * | CJK 连续段 | **bigram** + 单字 | `数学分析` → `数学` `学分` `分析` `数` `学` `分` `析` |
 * | 拉丁 / 数字连续段 | 整词，**小写** | `Taylor` → `taylor` |
 * | 空白、标点 | 作分隔，不产 token | — |
 *
 * bigram 的理由：中文没有词边界，`Intl.Segmenter('zh')` 给的是**词**，
 * 而用户搜的常常是**词的片段**（`傅里` 之于 `傅里叶`）。bigram 的召回最宽，
 * 代价是索引项变多（2 字词 → 2 个 token，单词 → 1 个）。
 *
 * 单字也进表，理由在 README 的 TODO-2：**短查询**（一个字）只有靠单字项才召回得到，
 * 而中文用户确实会搜一个字。
 *
 * # ⚠ 这个口径**没有定稿**，三个风险都写在 TODO 里
 *
 * 1. **召回会被放宽，但排序会变差**：bigram 会让「学分」这类跨词片段也命中，
 *    于是「命中集合膨胀」—— 这正是 r75 记过的 F-1 族问题。
 *    必须保留**原文子串复核**这一层（TODO-1），否则「检索变好」无法被证明。
 * 2. **索引膨胀**：一篇 1,000 字的中文笔记，bigram+单字大约产出 2,000 个 token。
 *    实测见 README「体积」一节（2,000 篇合成语料 ≈ 689 KB JSON），
 *    真实笔记库的规模需要**用真实数据量一次**，不能拿合成语料外推。
 * 3. **bigram 与单字同时入表会让打分失衡**：一个两字查询会同时命中 bigram 项
 *    与两个单字项，分数被叠三次。要么拆成两个字段加权，要么在查询侧去重。
 *
 * @module dsh-radar-note-search-tokenizer/tokenizer
 */

/** CJK 统一表意文字 + 扩展 A + 兼容表意 + 假名（与 `page-notes/src/client.jsx` 的 `countWords` 同集合）。 */
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/u;

/** 拉丁字母 / 数字 / 下划线 / 连字符：整段算一个词。 */
const LATIN = /[A-Za-z0-9_'’-]/u;

/**
 * 把一段文本切成检索单元。
 *
 * TODO-1：定稿前**不要**直接拿去接 `MiniSearch`。当前实现连「原文子串复核」都没有，
 *         只解决「能不能切」，不解决「切对了没有」。
 *
 * @param {string} text 一段正文或标题
 * @returns {string[]} 检索单元（已去空、拉丁已小写；**不去重**，重复次数是词频信息）
 */
export function tokenizeCJK(text) {
  const source = String(text ?? '');
  const out = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (CJK.test(ch)) {
      // 先取整段 CJK 连续串，再在段内做 bigram + 单字。
      let j = i;
      while (j < source.length && CJK.test(source[j])) j += 1;
      const run = source.slice(i, j);
      for (let k = 0; k < run.length; k += 1) {
        out.push(run[k]);
        if (k + 1 < run.length) out.push(run.slice(k, k + 2));
      }
      i = j;
      continue;
    }
    if (LATIN.test(ch)) {
      let j = i;
      while (j < source.length && LATIN.test(source[j])) j += 1;
      out.push(source.slice(i, j).toLowerCase());
      i = j;
      continue;
    }
    // 空白、标点、符号：分隔符，直接跳过。
    i += 1;
  }
  return out;
}

/**
 * 骨架用的**空实现**：把分词器接到上游实例。
 *
 * TODO-0：评审通过后改为 `new MiniSearch({ fields, tokenize: tokenizeCJK, ... })`，
 *         且**只在「笔记」页这一个实例上生效** —— 不要改
 *         `dsh-radar-search-rank` 的实例（那是「学习」页的重排，口径不同）。
 *
 * @param {unknown} _options
 * @throws {Error} 未实现
 */
export function createNoteSearch(_options) {
  throw Object.assign(
    new Error('radar-note-search-tokenizer: 候选骨架，未实现（见 src/tokenizer.js TODO-0）'),
    { code: 'NOT_IMPLEMENTED' },
  );
}
