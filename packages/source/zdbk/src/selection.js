/**
 * 自主选课的**纯解析与校验层**（不碰网络、不碰 cordis）。
 *
 * # 为什么单独一个文件而不是塞进 `parse.js`
 *
 * `parse.js` 装的是「学生个人数据」四个接口的解析（成绩 / 考试 / 课表 / GPA），
 * 而选课是另一个模块：它的响应是**裸数组**、字段名是另一套（`xkkh` / `kcdm` /
 * `sxbj` / `xkzy` …）、页签信息藏在**首页 HTML** 里。混进同一张文件会让
 * 「读一个成绩要翻过 300 行选课逻辑」—— 分层的目的正好是不要这样。
 *
 * 与 `parse.js` 的分界一致：**这里只有纯函数**，输入是字符串或已解析的对象，
 * 输出是稳定形状；发请求、编排、缓存都在 `reads.js`。
 *
 * # 上游对应物
 *
 * 逐条对应 `vendor/zju-assistant/core/zju/lib/zdbk/xsxk.ts` 的 `parseSelectionContext`
 * / `rows` / `parseCapacity` / `preferenceGroup` / `selectionState` 与
 * `selection-task.ts` 的三个视图函数。**逻辑照搬**，只做两件事：
 *
 *   1. 上游抛 `BadResponse` / `ConfigError` / `NeedsUser`，这里统一成
 *      `ClassroomError`（与 `parse.js` 同一口径，路由只读 `code` + `message`）；
 *   2. 视图里的中文字段名保持原样（「已选上」「待筛选」），不改成本仓的英文词 ——
 *      那是给用户看的，换一套只会让两边说法不一致。
 */

import { ClassroomError } from '@lybx-leyw/dsh-zju-source-http';

const text = (value) => (value == null ? '' : String(value)).trim();

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”',
  lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–', middot: '·',
};

/**
 * 解 HTML 实体。
 *
 * @param {string} value - 含实体的文本。
 * @returns {string} 解好的文本。
 */
export function decodeEntities(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name) => ENTITIES[String(name).toLowerCase()] ?? match);
}

/**
 * 富文本 → 单行文本。
 *
 * 正方的多值字段（上课时间、地点、考试时间）用 `<br>` 分隔，偶尔用 `--` 表示「没有」。
 * 这两样都得在这里处理掉：`<br>` 原样上屏会把一整个 HTML 片段糊在界面上，
 * 而 `--` 当成地点显示出来就是一句假话。
 *
 * @param {unknown} value - 原值。
 * @param {string} [joiner] - 多值之间的连接符（默认顿号）。
 * @returns {string} 单行文本。
 */
export function flatten(value, joiner = '、') {
  return decodeEntities(String(value ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''))
    .split('\n')
    .map((line) => line.replace(/\u00a0/g, ' ').trim())
    .filter((line) => line && line !== '--')
    .join(joiner);
}

/**
 * 取一个标签上的全部属性（值已解实体）。
 *
 * 只支持双引号/单引号包裹的属性 —— 正方生成的 HTML 全是这种。
 *
 * @param {string} tag - 一个开始标签（含 `<` `>`）。
 * @returns {Record<string, string>} 属性表。
 */
function attrs(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map((match) => [match[1], decodeEntities(match[3])]),
  );
}

/**
 * 从选课首页 HTML 里取出全部 `<input>` 的「id（或 name）→ value」。
 *
 * @param {string} html - 首页正文。
 * @returns {Record<string, string>} 输入框值表。
 */
export function parseSelectionInputs(html) {
  const clean = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const inputs = {};
  for (const match of clean.matchAll(/<input\b[^>]*>/gi)) {
    const map = attrs(match[0]);
    const key = map.id || map.name;
    if (key) inputs[key] = map.value ?? '';
  }
  return inputs;
}

/**
 * 页签的 `kind`：决定这个页签能不能走「课程列表」那条查询链。
 *
 * - `xk_9` 是条件搜索页签，走 `search`；
 * - `xk_1_1` / `iconyjsxk` / `xk_7` 是补考、研究生、特殊选课，流程不同，未接入；
 * - 其余是普通课程页签，走 `courses`。
 *
 * @param {string} dl - 页签类别码。
 * @returns {'courses'|'search'|'special'} 页签类型。
 */
function kindOf(dl) {
  if (dl === 'xk_9') return 'search';
  if (['xk_1_1', 'iconyjsxk', 'xk_7'].includes(dl)) return 'special';
  return 'courses';
}

/**
 * 解析选课首页（`zzxkghb_cxZzxkGhbIndex.html`）。
 *
 * # 页签必须从 `onclick` 里取，不能从 `data-dl`
 *
 * 正方页面上部分页签的 `data-dl` 与真正传给 `categroyClick()` 的参数**不一样**
 * （2026-09 实测）。按 `data-dl` 取会让「点这个页签看到的课」与「这个接口返回的课」
 * 差一整类 —— 而且不报错，只是列表不同。
 *
 * # 缺字段就是错误，不是默认值
 *
 * `xn` / `xq` / `nj` / `zydm` / `xkzys` 少任何一个都说明**当前不是选课期**
 * 或者页面结构变了。给默认值（比如学期填「当前学期」）会让后面的请求带着错的
 * 学年学期去查，正方对此不报错 —— 只回一份空列表。
 *
 * @param {string} html - 首页正文。
 * @returns {object} 选课上下文。
 * @throws {ClassroomError} `SCHEMA_CHANGED` —— 关键字段缺失或格式异常。
 */
export function parseSelectionContext(html) {
  const inputs = parseSelectionInputs(html);
  for (const key of ['xn', 'xq', 'nj', 'zydm', 'xkzys']) {
    if (!inputs[key]) {
      throw new ClassroomError(
        'SCHEMA_CHANGED',
        `选课首页缺少 ${key}：现在可能不是选课时间，或页面结构已变化。`,
        { missing: key },
      );
    }
  }
  const maxChoices = Number(inputs.xkzys);
  if (!/^\d{4}-\d{4}$/.test(inputs.xn)) {
    throw new ClassroomError('SCHEMA_CHANGED', `选课首页的学年「${inputs.xn}」不是 2025-2026 这种格式。`);
  }
  if (!/^\d+$/.test(inputs.xq)) {
    throw new ClassroomError('SCHEMA_CHANGED', `选课首页的学期「${inputs.xq}」不是数字。`);
  }
  if (!Number.isInteger(maxChoices) || maxChoices < 1) {
    throw new ClassroomError('SCHEMA_CHANGED', `选课首页的可填志愿数「${inputs.xkzys}」不是正整数。`);
  }

  const clean = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  const categories = [];
  for (const match of clean.matchAll(/<li\b[^>]*>|<\/li\s*>|<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    if (/^<li\b/i.test(tag)) { stack.push(attrs(tag)); continue; }
    if (/^<\/li/i.test(tag)) { stack.pop(); continue; }
    // 只看 `<a ...>` 这一段（后面是链接文字，属性里不会有 onclick）。
    const opening = tag.slice(0, tag.indexOf('>') + 1);
    const map = attrs(opening);
    const call = map.onclick?.match(/categroyClick\(\s*this\s*,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/);
    if (!call) continue;
    const parent = stack.at(-1) ?? {};
    const dl = call[1];
    const lx = call[2];
    const name = parent.kclbmc || parent.title || flatten(tag);
    if (!categories.some((cat) => cat.dl === dl && cat.lx === lx && cat.name === name)) {
      /**
       * `kcbs` 是页签上挂着的一个**筛选标记**，课程列表接口要原样回传。
       * 它有值、但某些页签为空串 —— 空串也要留着（不能省成 undefined），
       * 因为「没有这个参数」与「这个参数是空」在正方那边不是一回事。
       */
      categories.push({ dl, lx, name, kcbs: parent.kcbs ?? '', kind: kindOf(dl) });
    }
  }

  return {
    academic_year: inputs.xn,
    semester: Number(inputs.xq),
    term: inputs.xq === '1' ? '秋冬' : inputs.xq === '2' ? '春夏' : inputs.xq,
    grade: inputs.nj,
    major_code: inputs.zydm,
    plan_id: `${inputs.nj}${inputs.zydm}`,
    /** 选课接口的表单字段 `xnxq`，形如 `(2025-2026-1)-`。**格式由服务端定**，别自己拼。 */
    xnxq: `(${inputs.xn}-${inputs.xq})-`,
    study_length: inputs.ylxs ?? '',
    max_choices: maxChoices,
    categories,
  };
}

/**
 * 从选课首页推出**本人**的培养方案标识（`nj` + `zydm`）。
 *
 * 与 `parseSelectionContext` 分开是因为它只要两个字段：培养方案查询在**非选课期**
 * 也该能用，而那时候 `xkzys`（可填志愿数）通常不在页面上。要求全部字段会让
 * 「查一下我的培养方案」在寒暑假直接失败。
 *
 * @param {string} html - 首页正文。
 * @returns {{id: string, year: string, major: string}|null} 推不出来时 null（如实返回，不猜）。
 */
export function parseMyPlan(html) {
  const inputs = parseSelectionInputs(html);
  const year = text(inputs.nj);
  const major = text(inputs.zydm);
  if (!/^\d{4}$/.test(year) || !major) return null;
  return { id: `${year}${major}`, year, major };
}

/**
 * 选课记录里保留的字段（白名单）。
 *
 * 正方的选课响应每条都夹着几十个渲染用的字段（`tabname`、`jxrwbview`、
 * `zyfzByKcdm` …）。全量透出会让「这个接口到底给了什么」变成一团噪音，
 * 而且那些字段是**页面渲染用**的，随版本变，不该被下游依赖。
 */
const SELECTION_FIELDS = new Set((
  'xkkh kcdm xskcdm t_kcdm kcmc kcxx kcbs kcgs kclb kcxz kcxzzt kkxy sftsxxk '
  + 'sftyfx tsbj jsxm jszgh jcmc tabname xf sxf xxq vxxq t_xxq sksj vsksj skdd '
  + 'kssj vkssj zxs skxs mxdx gjhkc jxfs rs yxrs brs grs brl grl sfxz sxbj xkzy '
  + 'xkzyfz vxkzyfz xksj jxbly hkbj xxkbj jcyd'
).split(' '));

/**
 * 解析一条选课记录。
 *
 * # 教学班响应里**没有** `kcdm`
 *
 * 这不是异常：正方只在那条查询的上下文里知道「这是哪门课的教学班」。
 * 所以 `fallbackCode` 是必需的 —— 不传的话每一条教学班都会被判成缺字段，
 * 而错误信息会指向「接口变了」，真实原因却是调用方没把课程代码带下来。
 *
 * @param {unknown} row - 一条原始记录。
 * @param {string} [fallbackCode] - 本次查询的课程代码。
 * @returns {Record<string, unknown>} 规整后的记录（`xkkh` / `kcdm` 必有）。
 * @throws {ClassroomError} `SCHEMA_CHANGED` —— 缺教学班号或课程代码。
 */
export function parseSelectionRow(row, fallbackCode) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new ClassroomError('SCHEMA_CHANGED', '选课接口返回的记录不是对象。');
  }
  const xkkh = text(row.xkkh);
  const kcdm = text(row.kcdm) || text(row.t_kcdm) || text(fallbackCode);
  if (!xkkh || !kcdm) {
    throw new ClassroomError('SCHEMA_CHANGED', '选课记录缺少教学班号 xkkh 或课程代码 kcdm。');
  }
  const kept = Object.fromEntries(Object.entries(row).filter(([key]) => SELECTION_FIELDS.has(key)));
  return { ...kept, xkkh, kcdm };
}

/**
 * 志愿组：同一组的教学班按 `xkzyfz`（组号）归并，没有组号时本色自成一组。
 *
 * @param {Record<string, unknown>} row - 选课记录。
 * @returns {string} 组标识。
 */
export function preferenceGroup(row) {
  return text(row.xkzyfz) || text(row.kcdm);
}

/**
 * 志愿状态。
 *
 * `sxbj`（是否选上标记）：`1` = 已选上，`0` = 待筛选。其余值一律 `unknown` ——
 * 猜一个「待筛选」会让用户以为还有希望，猜「已选上」更糟。
 *
 * @param {Record<string, unknown>} row - 选课记录。
 * @returns {'selected'|'pending'|'unknown'} 状态。
 */
export function selectionState(row) {
  const flag = text(row.sxbj);
  if (flag === '1') return 'selected';
  if (flag === '0') return 'pending';
  return 'unknown';
}

/**
 * 解析容量字段「余量/容量」。
 *
 * 正方把两件事塞在一个字符串里（`5/60`）。拆错的表现是「余量显示成 60」，
 * 页面上看不出错，只是哪天课满了也照显示有位置。
 *
 * @param {unknown} value - 原值，如 `5/60`。
 * @returns {{remaining: number|null, capacity: number|null}} 解析结果；格式不符时都为 null。
 */
export function parseCapacity(value) {
  const match = text(value).match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
  return match
    ? { remaining: Number(match[1]), capacity: Number(match[2]) }
    : { remaining: null, capacity: null };
}

/**
 * 分页表单。
 *
 * ⚠️ 正方的选课分页用的是**行号区间**（`kspage` / `jspage`，从 1 开始、含两端），
 * 不是页码。按页码传的表现是「第 2 页还是第 1 页的内容」，而且不报错。
 *
 * @param {number} [page] - 页码（从 1 开始）。
 * @param {number} [size] - 每页条数（1~50，正方自己的上限）。
 * @returns {Record<string, string>} `{ kspage, jspage }`。
 * @throws {ClassroomError} `INVALID_ARGUMENT` —— 页码或条数越界。
 */
export function selectionPageForm(page = 1, size = 20) {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(size) || size < 1 || size > 50) {
    throw new ClassroomError('INVALID_ARGUMENT', 'page 必须是正整数，size 必须在 1–50 之间。');
  }
  return { kspage: String((page - 1) * size + 1), jspage: String(page * size) };
}

/** 条件搜索可用的字段（服务端列名）。 */
export const SELECTION_SEARCH_FIELDS = [
  'kcmc', 'kcdm', 'jsxm', 'kclb', 'sksj', 'skdd', 'kkxy', 'xxq',
];

/** 条件搜索可用的比较方式。 */
export const SELECTION_SEARCH_OPERATORS = [
  'like', 'notlike', 'equal', 'notequal', 'leftlike', 'notleftlike', 'rightlike', 'notrightlike',
];

/**
 * 把搜索参数编成正方要的表单。
 *
 * 三种入口（`keyword` / `field` / `conditions`）互相约束：
 * `keyword` 是「一个 like 条件」的简写，`conditions` 是完整形态，两者不能同时给。
 *
 * @param {object} context - `parseSelectionContext` 的结果（要用 `xnxq`）。
 * @param {object} options - `{ keyword, field, conditions, relation, onlyAvailable }`。
 * @returns {Record<string, string>} 表单字段。
 * @throws {ClassroomError} `INVALID_ARGUMENT` —— 参数组合或取值非法。
 */
export function selectionSearchForm(context, options = {}) {
  if (options.keyword !== undefined && options.conditions !== undefined) {
    throw new ClassroomError('INVALID_ARGUMENT', 'keyword 与 conditions 只能给一个。');
  }
  const conditions = options.conditions
    ?? [{ field: options.field ?? 'kcmc', value: options.keyword }];
  const relation = options.relation ?? 'and';
  if (!['and', 'or'].includes(relation)) {
    throw new ClassroomError('INVALID_ARGUMENT', 'relation 只能是 and 或 or。');
  }
  if (!Array.isArray(conditions) || !conditions.length || conditions.length > 20) {
    throw new ClassroomError('INVALID_ARGUMENT', '搜索需要 1–20 个条件。');
  }
  const form = {
    xnxq: context.xnxq,
    cx_zbgx: relation,
    cx_ylcx: options.onlyAvailable ? '1' : '0',
  };
  conditions.forEach((condition, index) => {
    if (!condition || !SELECTION_SEARCH_FIELDS.includes(condition.field)
      || !SELECTION_SEARCH_OPERATORS.includes(condition.operator ?? 'like')) {
      throw new ClassroomError(
        'INVALID_ARGUMENT',
        `第 ${index + 1} 个搜索条件的字段或比较方式无效（字段可选 ${SELECTION_SEARCH_FIELDS.join(' / ')}）。`,
      );
    }
    const value = text(condition.value);
    if (!value) throw new ClassroomError('INVALID_ARGUMENT', `第 ${index + 1} 个搜索条件缺 value。`);
    form[`cxtjList[${index}].cxlb`] = condition.field;
    form[`cxtjList[${index}].cxgx`] = condition.operator ?? 'like';
    form[`cxtjList[${index}].cxnr`] = value;
  });
  return form;
}

/**
 * 校验一个教学班/课程池标识属于**当前**选课学期。
 *
 * # 为什么必须校验
 *
 * 课号里带学年学期（`(2025-2026-1)-CS1001G-0012345-1`）。拿上学期的课号去提交，
 * 正方不会拒绝 —— 它会把这条志愿存到一个不生效的地方，表现是「提交成功但志愿里没有」。
 * 所以在**发请求之前**就按课号判断。
 *
 * 体育池实测是 `4(2025-2026-1)-代码` 这种带前缀的形态，普通池也可能是 `T` / `A`
 * 开头，所以 `pool` 模式下允许一个可选前缀字母/数字。
 *
 * @param {string} id - 课号或池号。
 * @param {object} context - `parseSelectionContext` 的结果。
 * @param {boolean} [pool] - 是否为课程池（允许前缀）。
 * @throws {ClassroomError} `INVALID_ARGUMENT` —— 学期不符或格式不认识。
 */
export function assertSelectionTerm(id, context, pool = false) {
  const pattern = pool ? /^[A-Z0-9]?\((\d{4}-\d{4})-(\d+)\)-/ : /^\((\d{4}-\d{4})-(\d+)\)-/;
  const match = text(id).match(pattern);
  if (!match) {
    throw new ClassroomError('INVALID_ARGUMENT', `教学班／课程池标识「${text(id)}」里没有学年学期，无法确认属于本学期。`);
  }
  if (match[1] !== context.academic_year || match[2] !== String(context.semester)) {
    throw new ClassroomError(
      'INVALID_ARGUMENT',
      `教学班／课程池属于 ${match[1]}-${match[2]}，不是当前选课学期 ${context.academic_year}-${context.semester}。`,
      { expected: `${context.academic_year}-${context.semester}`, actual: `${match[1]}-${match[2]}` },
    );
  }
}

/**
 * 空值丢掉的辅助：`put('teacher', '')` → `{}`。
 *
 * 视图里塞一堆 `teacher: null` 会让「这条没有教师」与「这个字段不存在」看起来一样，
 * 下游就没法区分「平台没给」和「我们没取」。
 *
 * @param {string} key - 字段名。
 * @param {unknown} value - 值。
 * @returns {Record<string, unknown>} 要么空对象，要么 `{ [key]: value }`。
 */
function put(key, value) {
  return value === '' || value === null || value === undefined ? {} : { [key]: value };
}

/**
 * 课程视图（未展开教学班）。
 *
 * `pool` 是**这一条查询里**的课程号（`xkkh`），`selectionSections` 要用它。
 * `kcxx` 形如 `0~3.0~3.0-0.0`，第二段是学分 —— 没有 `xf` 字段时从它取。
 *
 * @param {Record<string, unknown>} row - 选课记录。
 * @param {string} [category] - 该条所属页签的 `dl`。
 * @returns {object} 课程视图。
 */
export function courseView(row, category) {
  const credits = text(row.xf) || text(String(row.kcxx ?? '').split('~')[1]);
  return {
    name: flatten(row.kcmc),
    code: text(row.kcdm),
    pool: text(row.xkkh),
    ...(category ? { category } : {}),
    ...put('credits', credits),
    ...put('category_label', flatten(row.kclb)),
    ...put('college', flatten(row.kkxy)),
    ...put('term', flatten(row.xxq)),
  };
}

/**
 * 教学班视图。
 *
 * @param {Record<string, unknown>} row - 选课记录。
 * @returns {object} 教学班视图。
 */
export function sectionView(row) {
  return {
    ...put('course', flatten(row.kcmc)),
    code: text(row.kcdm),
    section: text(row.xkkh),
    ...put('teacher', flatten(row.jsxm)),
    ...put('time', flatten(row.sksj, '；')),
    ...put('location', flatten(row.skdd, '；')),
    ...put('term', flatten(row.xxq)),
    ...put('exam', flatten(row.kssj ?? row.vkssj)),
    ...put('remaining', row.remaining ?? null),
    ...put('capacity', row.capacity ?? null),
  };
}

/**
 * 本人一个志愿的视图。
 *
 * `order` 是**组内**志愿次序（`xkzy`），不是全局序号；`group` 只在它和课程代码
 * 不同时才给（同课多志愿的情形），否则每一条都多一个冗余字段。
 *
 * @param {Record<string, unknown>} row - 选课记录。
 * @returns {object} 志愿视图。
 */
export function ownedView(row) {
  const state = selectionState(row);
  const group = preferenceGroup(row);
  const saved = text(row.xksj).slice(0, 16);
  return {
    ...sectionView(row),
    ...put('credits', text(row.xf)),
    order: Number(row.xkzy) || null,
    state: state === 'selected' ? '已选上' : state === 'pending' ? '待筛选' : '未知',
    ...(group !== text(row.kcdm) ? { group } : {}),
    ...put('saved_at', saved),
  };
}
