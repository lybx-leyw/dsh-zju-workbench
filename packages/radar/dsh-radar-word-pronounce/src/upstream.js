/**
 * dsh-radar-word-pronounce · 上游封装占位（B 类）
 *
 * ⚠️ 候选骨架：未评审、未接入 profile、不可直接使用。
 *
 * # 上游是什么
 *
 * `cmu-pronouncing-dictionary@3.0.0`（ISC、零依赖、50k 次/周下载）导出**一张表**：
 *
 * ```js
 * import { dictionary } from 'cmu-pronouncing-dictionary'
 * dictionary['quick'] // → 'K W IH1 K'
 * dictionary['the']   // → 'DH AH0'
 * ```
 *
 * 键是**小写英文词**（可含 `(1)` 变体序号、`'s` 所有格、`.` 缩写点、数字）；
 * 值是 **ARPAbet 音素串**，空格分隔，`1` = 主重音、`0` = 无重音。
 * 约 13.4 万词，**通用美式**口音。
 *
 * # 本包装配什么（评审要先拍板的 7 条 TODO，见 src/index.js）
 *
 * 本文件只放**读上游的凭据与风险**，不含业务逻辑。
 */

/** 本骨架锁定的上游版本（精确版本，不用 `^`）。 */
export const UPSTREAM = Object.freeze({
  name: 'cmu-pronouncing-dictionary',
  version: '3.0.0',
  license: 'ISC',
  repository: 'https://github.com/words/cmu-pronouncing-dictionary',
  /** 上游数据源的原始出处（README 明写「Crawled from cmusphinx/cmudict」）。 */
  source: 'https://github.com/cmusphinx/cmudict',
});

/**
 * 上游导出的**单个符号**。`import { dictionary }` 会把整表（约 4.7 MB）加载进内存。
 */
export const UPSTREAM_EXPORT = 'dictionary';

/**
 * 核心风险（评审逐条确认后才可继续）。
 *
 * R-1 · 只有 ARPAbet，没有 IPA
 *   上游给的是 `K W IH1 K`，不是 `kwˈɪk`。要显示国际音标，必须叠一层
 *   **ARPAbet → IPA 映射表**（39 音素 + 3 个重音标记）。这层映射**由本包自写**，
 *   不引第二个上游（`arpabet-to-ipa` 系全是 ★≤7、无 npm 发布，锁不住版 —— 见报告 🔵 行）。
 *   ⚠ 映射前必须**先选定口音**：cmudict 只有通用美式，映射表若按英式写，
 *     `AA → ɒ` 会让 `hot` 读成 /hɒt/，与音频不符。默认走美式。
 *
 * R-2 · 4.7 MB 单文件
 *   `index.js` 是 4.7 MB 的单个对象字面量。**不得在浏览器侧 import**：
 *   `page-notes` / `page-quiz` 是 iframe 内 React 应用，加载 4.7 MB 会明显拖慢首屏。
 *   约束：**查表只在宿主（Node）侧**，下发到客户端的是**音素串**（每词 < 40 字节）。
 *   若评审要求客户端查表，则必须先按首字母分片（`a`–`z` 26 片），按需加载。
 *
 * R-3 · 键的归一化（**最可能翻车的一条**）
 *   上游键形如 `a`、`a(1)`、`a's`、`a.'s`、`a42128`。裸查 `student's` 或 `Students`
 *   会**静默返回 undefined**。必须按顺序归一：
 *     ① 转小写 → ② 去首尾空白 → ③ 按 `(n)` 取**第一变体**（`(1)` 不是主读音，`(0)`/无序号才是）
 *     → ④ 去所有格 `'s` / `’s` 再查一次 → ⑤ 仍无则**回落 TTS 直读**（不是报错）。
 *   评审须用 `student's` / `students` / `Students` / `well-known` 四个词验过。
 *
 * R-4 · 停更 4 年（`pushed 2021-08-12`）
 *   但它是**数据包**，不是代码库。风险是「新词查不到」（如 `chatbot`、`LLM`），
 *   不是「代码坏了」。锁 `3.0.0` 精确版本；查不到时走 R-3 的 ⑤ 回落分支。
 *
 * R-5 · 重音不等于语调
 *   上游只标**词级主重音**（`1`）。句子重音、升降调、连读在 ARPAbet 里**没有**。
 *   若某个面板想要「整句怎么读」，上游帮不上 —— 那是 TTS 的活（本仓 `classroom-media` 已有）。
 */

/**
 * 上游数据形态（评审对齐用）。
 *
 * @typedef {Object} UpstreamShape
 * @property {Record<string, string>} dictionary  词 → ARPAbet 音素串
 */

/** 一行样例，便于评审不装包也能看懂数据长什么样。 */
export const SAMPLE = Object.freeze({
  the: 'DH AH0',
  quick: 'K W IH1 K',
  brown: 'B R AW1 N',
  fox: 'F AA1 K S',
  'a(1)': 'EY1',
  "student's": 'S T UW1 D AH0 N T S',
});

/**
 * 取上游表。**评审通过前调用会抛错**（本骨架是占位）。
 *
 * @returns {never}
 */
export function loadUpstreamDictionary() {
  throw new Error(
    'dsh-radar-word-pronounce: 候选骨架，未评审。' +
      '评审通过后改为 `import { dictionary } from "cmu-pronouncing-dictionary"`，' +
      '并按 R-2 只在宿主侧加载、按 R-3 做键归一化。',
  );
}
