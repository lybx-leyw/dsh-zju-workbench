/**
 * `question_bank` —— 出题前的历史题查询（以及题库整理动作）。
 *
 * # 为什么出题链会挂这个工具
 *
 * `_mount_flags()` 里 `has_question_bank=user_has_question_bank()`。对出题来说它的
 * 用处是**避免重复出题**：模型在 explore 阶段 `action="list"` 一次，就知道哪些题
 * 已经出过、哪些答错了，于是这一轮可以避开旧题面、偏向薄弱点。
 *
 * 但上游这个工具是六个动作的完整 CRUD（overview / list / organize / unfile /
 * bookmark / record）。本仓没有 SQLite 题库表，历史题由集成层以纯数据注入
 * （`history`）。所以：
 *
 * - **读动作**（`overview` / `list`）：完整实现，文案逐字对齐上游；
 * - **写动作**（`organize` / `unfile` / `bookmark` / `record`）：认，但如实拒绝，
 *   并说明「题库由宿主维护，本次会话不落盘」。
 *
 * 为什么写动作不能静默成功：上游文案里有一句
 * "The learner sees this immediately under Learning Space → Question Bank."
 * 假成功会让模型对用户宣布一件没发生的事。如实拒绝至少让模型说得出真话。
 *
 * # 存储适配器
 *
 * `history` 可以是三种形状，全部归一到一个内部 `store`：
 * 1. 数组：`[{id, question, questionType, correctAnswer, userAnswer, isCorrect,
 *    bookmarked, categories:[{name}], createdAt, sessionId}]` —— 最省事，也最常用；
 * 2. 带异步方法的对象：`list_notebook_entries()` / `question_bank_stats()` /
 *    `list_categories()` / `find_category_by_name()` —— 与上游 store 同形，
 *    集成层可以直接把 SQLite 适配器塞进来；
 * 3. `undefined`：空题库（此时 `overview` 输出上游的"题库是空的"那句）。
 *
 * 字段名两种写法都收（`question_type` 与 `questionType`）：上游 store 吐 snake_case，
 * 而本仓 JS 侧习惯 camelCase。归一放在这一层，是因为**工具输出**必须与上游逐字一致，
 * 不能靠调用方各自映射。
 */
import { UPSTREAM_DATA } from './definitions.js';
import { pyRepr } from './py-repr.js';

const QB = UPSTREAM_DATA.questionBank;
const ACTIONS = Object.freeze([...QB.actions]);
const FILTERS = Object.freeze([...QB.filters]);
const LIMITS = Object.freeze({ ...QB.limits });

export { ACTIONS as QUESTION_BANK_ACTIONS, FILTERS as QUESTION_BANK_FILTERS, LIMITS as QUESTION_BANK_LIMITS };

/** 写动作：本包只读，遇到就如实拒绝（见文件头）。 */
const WRITE_ACTIONS = Object.freeze(['organize', 'unfile', 'bookmark', 'record']);

/** 与上游 `_truncate()` 逐字一致：先折叠空白，再截断并加省略号。 */
export function truncate(value, limit) {
  const text = String(value ?? '').split(/\s+/).filter(Boolean).join(' ');
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function str(value) {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
}

function pick(record, ...keys) {
  for (const key of keys) {
    if (record?.[key] !== undefined && record?.[key] !== null) return record[key];
  }
  return undefined;
}

/**
 * 一条历史题 → 内部形状。
 *
 * `is_correct` 的三态是上游的刻意设计（`history.py` 注释）：DB 的 0/1 列分不清
 * "答错"与"还没答"，所以以 `user_answer` 是否为空为准 —— 没作答时是 `null`，
 * 让提示词渲染成 "unknown" 而不是误导性的 "incorrect"。
 * 题库工具（`question_bank.py`）走的是另一套语义（`✗` = 答错），
 * 这里按**题库**口径归一：有 `isCorrect` 就用它，缺省 false。
 */
export function normalizeEntry(raw = {}, index = 0) {
  const categories = Array.isArray(raw.categories)
    ? raw.categories
      .map((category) => (typeof category === 'string' ? { name: category } : { name: str(category?.name) }))
      .filter((category) => category.name)
    : [];
  return {
    id: Number.isFinite(Number(pick(raw, 'id'))) ? Number(pick(raw, 'id')) : index + 1,
    question: str(pick(raw, 'question', 'stem')),
    questionType: str(pick(raw, 'question_type', 'questionType', 'type')),
    correctAnswer: str(pick(raw, 'correct_answer', 'correctAnswer', 'answer')),
    userAnswer: str(pick(raw, 'user_answer', 'userAnswer')),
    explanation: str(pick(raw, 'explanation')),
    isCorrect: pick(raw, 'is_correct', 'isCorrect') === true,
    bookmarked: pick(raw, 'bookmarked') === true,
    categories,
    createdAt: Number(pick(raw, 'created_at', 'createdAt')) || 0,
    sessionId: str(pick(raw, 'session_id', 'sessionId')),
  };
}

function entryMatchesSearch(entry, needle) {
  if (!needle) return true;
  const lower = needle.toLowerCase();
  return entry.question.toLowerCase().includes(lower)
    || entry.userAnswer.toLowerCase().includes(lower)
    || entry.correctAnswer.toLowerCase().includes(lower);
}

function inCategory(entry, name) {
  const lower = name.toLowerCase();
  return entry.categories.some((category) => category.name.toLowerCase() === lower);
}

/**
 * 把 `history` 归一成内部只读 store。
 *
 * 异步对象分支里所有上游方法名都是 snake_case —— 那是上游 store 的真名，
 * 集成层写适配器时对着 `sqlite_store.py` 抄即可，不必猜 JS 命名。
 */
export function createBankStore(history) {
  if (history === null || history === undefined) {
    return {
      kind: 'empty',
      entries: [],
      async listNotebookEntries() {
        return { items: [], total: 0 };
      },
      async stats() {
        return { total: 0, wrong: 0, unresolved: 0, bookmarked: 0, uncategorized: 0 };
      },
      async categories() {
        return [];
      },
      async findCategoryByName() {
        return null;
      },
    };
  }

  if (Array.isArray(history)) {
    const entries = history.map((raw, index) => normalizeEntry(raw, index));
    return {
      kind: 'array',
      entries,
      async listNotebookEntries(query = {}) {
        let rows = entries;
        if (query.categoryId !== undefined && query.categoryId !== null) {
          const wanted = String(query.categoryId);
          rows = rows.filter((entry) => entry.categories.some((category) => String(category.name) === wanted));
        }
        if (query.uncategorized) rows = rows.filter((entry) => entry.categories.length === 0);
        if (query.bookmarked === true) rows = rows.filter((entry) => entry.bookmarked);
        if (query.isCorrect === false) rows = rows.filter((entry) => !entry.isCorrect);
        if (query.sessionId) rows = rows.filter((entry) => entry.sessionId === String(query.sessionId));
        rows = rows.filter((entry) => entryMatchesSearch(entry, str(query.search)));
        const total = rows.length;
        const limit = Number.isFinite(query.limit) ? query.limit : LIMITS.defaultList;
        return { items: rows.slice(0, limit), total };
      },
      async stats() {
        const total = entries.length;
        return {
          total,
          wrong: entries.filter((entry) => !entry.isCorrect).length,
          unresolved: entries.filter((entry) => !entry.isCorrect).length,
          bookmarked: entries.filter((entry) => entry.bookmarked).length,
          uncategorized: entries.filter((entry) => entry.categories.length === 0).length,
        };
      },
      async categories() {
        const counts = new Map();
        for (const entry of entries) {
          for (const category of entry.categories) {
            counts.set(category.name, (counts.get(category.name) ?? 0) + 1);
          }
        }
        return [...counts.entries()]
          .map(([name, entryCount]) => ({ id: name, name, entry_count: entryCount }))
          .sort((a, b) => a.name.localeCompare(b.name));
      },
      async findCategoryByName(name) {
        const lower = str(name).trim().toLowerCase();
        if (!lower) return null;
        const found = entries.some((entry) => entry.categories.some((category) => category.name.toLowerCase() === lower));
        return found ? { id: str(name).trim(), name: str(name).trim() } : null;
      },
    };
  }

  // 上游同形的异步 store。
  //
  // 方法名用**别名**而不是要求集成层改写成 camelCase：集成层对着
  // `sqlite_store.py` 抄 `list_notebook_entries` / `question_bank_stats` /
  // `list_categories` / `find_category_by_name` 即可。方法缺失时降级为空结果
  // 而不是抛错 —— 一个不完整的适配器不该让模型的整个 explore 轮次失败，
  // 但方法**存在却抛错**时必须把错抛给调用方（那才是真出问题，
  // 被吞掉会让 overview 显示"题库是空的"这种假事实）。
  const call = async (method, ...args) => {
    if (typeof history[method] !== 'function') return undefined;
    return history[method](...args);
  };
  return {
    kind: 'store',
    entries: null,
    async listNotebookEntries(query = {}) {
      const result = await call('list_notebook_entries', {
        category_id: query.categoryId,
        uncategorized: query.uncategorized,
        bookmarked: query.bookmarked,
        is_correct: query.isCorrect,
        search: query.search ?? '',
        limit: query.limit,
      });
      if (!result || !Array.isArray(result.items)) return { items: [], total: 0 };
      return {
        items: result.items.map((raw, index) => normalizeEntry(raw, index)),
        total: Number(result.total ?? result.items.length),
      };
    },
    async stats() {
      const result = await call('question_bank_stats');
      return result && typeof result === 'object'
        ? { ...result }
        : { total: 0, wrong: 0, unresolved: 0, bookmarked: 0, uncategorized: 0 };
    },
    async categories() {
      const result = await call('list_categories');
      return Array.isArray(result) ? result : [];
    },
    async findCategoryByName(name) {
      const result = await call('find_category_by_name', name);
      return result ?? null;
    },
  };
}

/** 一条历史题的渲染行，逐字对齐上游 `_render_entry()`。 */
export function renderEntry(entry) {
  const mark = entry.isCorrect ? '✓' : '✗';
  const star = entry.bookmarked ? ' ★' : '';
  let line = `- [${entry.id}] ${mark}${star} ${truncate(entry.question, LIMITS.maxQuestionPreview)}`;
  const given = truncate(entry.userAnswer, LIMITS.maxAnswerPreview);
  const expected = truncate(entry.correctAnswer, LIMITS.maxAnswerPreview);
  if (given || expected) {
    line += `\n    answered: ${given || '—'} | correct: ${expected || '—'}`;
  }
  const categories = entry.categories.map((category) => category.name).filter(Boolean);
  line += categories.length
    ? `\n    filed in: ${categories.join(', ')}`
    : '\n    filed in: (nothing yet)';
  return line;
}

/** 分类行，逐字对齐上游 `_render_categories()`。 */
export function renderCategories(categories) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return '(no categories yet — `organize` creates one by name)';
  }
  return categories.map((category) => `${category.name} (${category.entry_count ?? 0})`).join(', ');
}

function outcome(ok, action, { text = '', error = '', summary = {} } = {}) {
  return { ok, action, text, error, summary };
}

async function overview(store) {
  const stats = await store.stats();
  const categories = await store.categories();
  if (!stats.total) {
    return outcome(true, 'overview', {
      text: 'The question bank is empty — the learner has not answered any quiz questions yet.',
      summary: { stats, categories: [] },
    });
  }
  const text = `Question bank: ${stats.total} questions `
    + `(${stats.wrong} answered wrong, ${stats.bookmarked} bookmarked, `
    + `${stats.uncategorized} not filed in any category).\n`
    + `Categories: ${renderCategories(categories)}\n\n`
    + "Next: `list` the entries you want (filter='wrong' or 'uncategorized'), "
    + 'then `organize` them into a category by name.';
  return outcome(true, 'overview', { text, summary: { stats, categories } });
}

async function list(store, { filterMode, category, search, limit }) {
  const mode = str(filterMode || 'all').trim().toLowerCase();
  if (!FILTERS.includes(mode)) {
    return outcome(false, 'list', {
      error: `Unknown filter ${pyRepr(filterMode)}. Use one of: ${FILTERS.join(', ')}.`,
    });
  }
  let categoryId = null;
  const wanted = str(category).trim();
  if (wanted) {
    const match = await store.findCategoryByName(wanted);
    if (!match) {
      const categories = await store.categories();
      return outcome(false, 'list', {
        error: `No category named ${pyRepr(wanted)}. Existing: ${renderCategories(categories)}.`,
      });
    }
    categoryId = match.id ?? match.name;
  }
  const requested = Number.parseInt(String(limit ?? LIMITS.defaultList), 10);
  const capped = Math.max(1, Math.min(Number.isFinite(requested) ? requested : LIMITS.defaultList, LIMITS.maxList));
  const result = await store.listNotebookEntries({
    categoryId,
    uncategorized: mode === 'uncategorized',
    bookmarked: mode === 'bookmarked' ? true : undefined,
    isCorrect: mode === 'wrong' ? false : undefined,
    search: str(search),
    limit: capped,
  });
  const items = Array.isArray(result.items) ? result.items : [];
  const total = Number(result.total ?? 0);
  if (items.length === 0) {
    return outcome(true, 'list', {
      text: 'No question-bank entries match that filter.',
      summary: { count: 0, total: 0, filter: mode },
    });
  }
  let header = `Question bank — ${mode}`;
  if (wanted) header += ` in category '${wanted}'`;
  if (search) header += ` matching '${search}'`;
  header += ` (${items.length} of ${total}):`;
  const lines = [header, ''];
  for (const entry of items) lines.push(renderEntry(entry));
  if (total > items.length) {
    lines.push(`\n... ${total - items.length} more; raise \`limit\` or narrow with \`search\`.`);
  }
  lines.push(
    '\nThe number in [brackets] is the entry id — pass those ids to '
    + '`organize` to file them into a category.',
  );
  return outcome(true, 'list', {
    text: lines.join('\n'),
    summary: {
      count: items.length,
      total,
      filter: mode,
      entry_ids: items.map((entry) => entry.id),
    },
  });
}

/** 写动作的如实拒绝文案。见文件头：不许假装成功。 */
function writeRefusal(action, language) {
  if (language === 'zh') {
    return `题库由宿主维护，本次运行是只读的：\`${action}\` 没有执行，也没有任何改动发生。`
      + '请改用 `overview` / `list` 读取历史题（例如在出题前查重），并如实告知用户需要在「学习空间 → 题库」里手动整理。';
  }
  return `The question bank is host-owned and read-only in this run: \`${action}\` was not performed `
    + 'and nothing changed. Use `overview` / `list` to read history (e.g. to avoid duplicate questions), '
    + 'and tell the user plainly that filing must be done in Learning Space → Question Bank.';
}

/**
 * 跑一个题库动作。**永不抛错** —— 上游 `run_question_bank()` 的 docstring 就是这么
 * 承诺的（"Never raises — errors come back typed"），因为题库是辅助能力，
 * 它出问题不该中断整轮出题。
 */
export async function runQuestionBank(options = {}, store, { language = 'en' } = {}) {
  const action = str(options.action || 'overview').trim().toLowerCase();
  if (!ACTIONS.includes(action)) {
    return outcome(false, action, {
      error: `Unknown action ${pyRepr(options.action)}. Use one of: ${ACTIONS.join(', ')}.`,
    });
  }
  if (WRITE_ACTIONS.includes(action)) {
    return outcome(false, action, { error: writeRefusal(action, language) });
  }
  try {
    if (action === 'overview') return await overview(store);
    return await list(store, {
      filterMode: options.filter,
      category: options.category,
      search: options.search,
      limit: options.limit,
    });
  } catch (error) {
    return outcome(false, action, { error: `Question bank error: ${error?.message ?? error}` });
  }
}

export function createQuestionBankHandler({ history } = {}) {
  // store 惰性建一次：历史题在一次出题里不会变，每轮重建反而可能把
  // 异步适配器的方法重新探测一遍。但 `history` 是外部对象，探测本身要容错，
  // 所以建 store 也放进 try —— 构造期抛错不该让工具注册失败。
  let cached = null;
  const storeOf = () => {
    if (cached) return cached;
    try {
      cached = createBankStore(history);
    } catch {
      cached = createBankStore(null);
    }
    return cached;
  };

  return async function questionBankHandler(args = {}, ctx = {}) {
    const language = String(args.language ?? ctx?.language ?? ctx?.context?.language ?? 'en');
    const result = await runQuestionBank(args, storeOf(), { language });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        metadata: { question_bank: { action: result.action, ...result.summary } },
      };
    }
    return {
      ok: true,
      result: {
        content: result.text,
        metadata: { question_bank: result.summary ?? {} },
      },
    };
  };
}
