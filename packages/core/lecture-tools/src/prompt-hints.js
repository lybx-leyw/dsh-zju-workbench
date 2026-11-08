/**
 * 工具提示词（prompt hints）的 JS 对位 —— 上游 `tools/prompting/__init__.py`。
 *
 * # 这个包为什么需要它
 *
 * 出题流水线把工具清单塞进 `explore.system` / `quiz_step.system` 的 `{tool_list}`，
 * 而填进去的不是 description，是**hint**：`short_description` + `when_to_use` +
 * `input_format`（`build_prompt_text(format="list_with_usage")`）。
 * 那三段文字比 description 更啰嗦，也更能左右模型「要不要调、怎么填参数」。
 * 少了它，工具虽然挂上了，模型却不知道自己什么时候该用 —— 上游的 `- 无`
 * 兜底分支说明这件事被认真对待过。
 *
 * # 五种格式全搬的理由
 *
 * 出题链只用 `list_with_usage`。其余四种（`list` / `table` / `aliases` / `phased`）
 * 是 chat 侧的用点，搬过来是为了「同一份 hint 渲染逻辑只有一处」——
 * 若只实现一种，将来有人给工具加别名（`rag_hybrid` 之类）时，
 * `format_aliases` 会在另一个包里被重新实现一遍，然后两边文案漂开。
 *
 * # 输出形状必须逐字一致
 *
 * 提示词是 `str.format` 的模板，`{tool_list}` 处替换成这里的返回值。多一个空行、
 * 少一个缩进，都会改变模型读到的段落结构。所以每个格式的拼接符
 * （`\n` / `\n\n` / `    ` 四空格缩进）都照抄上游。
 */
import { UPSTREAM_DATA } from './definitions.js';

const HINTS = UPSTREAM_DATA.hints;

const GUIDELINE_HEADER = Object.freeze({
  en: '**Autonomously decide which tool to use** based on the current sub-goal '
    + 'and the evidence gathered so far. Consider all available options:',
  zh: '**根据当前子目标和已收集的证据，自主决定使用哪个工具**。请综合考虑所有可用选项：',
});

const PHASE_LABELS = Object.freeze({
  en: {
    exploration: 'Phase 1: Exploration',
    expansion: 'Phase 2: Expansion',
    synthesis: 'Phase 3: Synthesis',
    verification: 'Phase 4: Verification',
    other: 'Other Tools',
  },
  zh: {
    exploration: '阶段 1：基础探索',
    expansion: '阶段 2：扩展补充',
    synthesis: '阶段 3：综合推理',
    verification: '阶段 4：验证核查',
    other: '其他工具',
  },
});

const PHASE_ORDER = Object.freeze(['exploration', 'expansion', 'synthesis', 'verification', 'other']);

const HINT_FIELDS = Object.freeze([
  'short_description',
  'when_to_use',
  'input_format',
  'guideline',
  'note',
  'phase',
]);

/** 与上游 `_normalize_language()` 一致：`zh*` → zh，`en*` → en，其余原样小写。 */
export function normalizeHintLanguage(language) {
  const normalized = String(language ?? 'en').toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('en')) return 'en';
  return normalized;
}

function emptyHints() {
  return {
    short_description: '',
    when_to_use: '',
    input_format: '',
    guideline: '',
    note: '',
    phase: '',
    aliases: [],
  };
}

/**
 * 取一个工具的 hint。先找目标语言，找不到回退英文（上游的 zh/en fallback）。
 *
 * 本包只有四个工具、两种语言，且数据是离线的 —— 不需要上游那套「文件不存在就
 * 往下找」的探测，但**回退方向**必须一样：中文缺失时给英文，而不是给空。
 */
export function loadPromptHints(toolName, language = 'en') {
  const lang = normalizeHintLanguage(language);
  const table = HINTS[toolName];
  if (!table) return emptyHints();
  const picked = table[lang] ?? table.en;
  if (!picked) return emptyHints();
  const hints = emptyHints();
  for (const field of HINT_FIELDS) hints[field] = String(picked[field] ?? '').trim();
  // 别名（`rag_hybrid` 这类）上游来自 yaml 的 aliases 段；本包四个工具都没有别名，
  // 但形状保持一致，免得调用方要写 `hint.aliases ?? []`。
  hints.aliases = [];
  return hints;
}

/** 批量取 hint，返回 `[[name, hints], ...]`（上游 `get_prompt_hints` 的形状）。 */
export function promptHintsFor(names, language = 'en') {
  return names.map((name) => [name, loadPromptHints(name, language)]);
}

/**
 * 渲染器，逐条对应上游 `ToolPromptComposer`。
 *
 * @param {string} language
 */
export function createPromptComposer(language = 'en') {
  const lang = normalizeHintLanguage(language);

  function formatList(hints) {
    const lines = [];
    for (const [name, hint] of hints) {
      if (hint.short_description) lines.push(`- ${name}: ${hint.short_description}`);
    }
    return lines.join('\n');
  }

  /**
   * 出题链实际用的格式：每条带 `when_to_use` 与 `input_format`。
   *
   * 缩进是**四空格**（上游 `f"    {when_label}: ..."`），不是列表续行常见的两空格。
   * 别"顺手"改成两空格：这段文字进的是 system prompt 的 Markdown，
   * 缩进变化会让它渲染成嵌套列表，段落结构跟着变。
   */
  function formatListWithUsage(hints) {
    const whenLabel = lang !== 'zh' ? 'When to use' : '适用场景';
    const inputLabel = lang !== 'zh' ? 'Input' : '参数格式';
    const blocks = [];
    for (const [name, hint] of hints) {
      if (!hint.short_description) continue; // 没有 short_description 的整条跳过，不留空 bullet
      const entry = [`- \`${name}\` — ${hint.short_description}`];
      if (hint.when_to_use) entry.push(`    ${whenLabel}: ${hint.when_to_use}`);
      if (hint.input_format) entry.push(`    ${inputLabel}: ${hint.input_format}`);
      blocks.push(entry.join('\n'));
    }
    return blocks.join('\n');
  }

  function formatTable(hints, controlActions = null) {
    const parts = [];
    const tableLines = [
      '| action | When to use | action_input |',
      '|--------|------------|--------------|',
    ];
    for (const [name, hint] of hints) {
      if (hint.when_to_use || hint.input_format) {
        tableLines.push(`| \`${name}\` | ${hint.when_to_use} | ${hint.input_format} |`);
      }
    }
    for (const control of controlActions ?? []) {
      tableLines.push(`| \`${control.name}\` | ${control.when_to_use} | ${control.input_format} |`);
    }
    parts.push(tableLines.join('\n'));

    const guidelines = hints
      .filter(([, hint]) => hint.guideline)
      .map(([name, hint]) => `  - \`${name}\` ${hint.guideline}`);
    if (guidelines.length) {
      const header = GUIDELINE_HEADER[lang] ?? GUIDELINE_HEADER.en;
      parts.push(`${header}\n${guidelines.join('\n')}`);
    }

    const notes = hints.filter(([, hint]) => hint.note).map(([, hint]) => `- ${hint.note}`);
    if (notes.length) parts.push(notes.join('\n'));

    return parts.join('\n\n');
  }

  function formatAliases(hints) {
    const lines = [];
    for (const [name, hint] of hints) {
      if (hint.aliases.length) {
        for (const alias of hint.aliases) {
          const description = alias.description || hint.short_description;
          const inputFormat = alias.input_format || hint.input_format || 'Natural language';
          lines.push(`- ${alias.name}: ${description} | Query format: ${inputFormat}`);
        }
        continue;
      }
      if (hint.short_description) {
        lines.push(
          `- ${name}: ${hint.short_description} | Query format: ${hint.input_format || 'Natural language'}`,
        );
      }
    }
    return lines.join('\n');
  }

  function formatPhased(hints) {
    const grouped = new Map(PHASE_ORDER.map((phase) => [phase, []]));
    for (const [name, hint] of hints) {
      const phase = hint.phase || 'other';
      if (!grouped.has(phase)) grouped.set(phase, []);
      if (hint.aliases.length) {
        for (const alias of hint.aliases) {
          const aliasPhase = alias.phase || phase;
          if (!grouped.has(aliasPhase)) grouped.set(aliasPhase, []);
          const aliasText = alias.when_to_use || alias.description || hint.guideline
            || hint.short_description;
          if (aliasText) grouped.get(aliasPhase).push(`- \`${alias.name}\`: ${aliasText}`);
        }
        continue;
      }
      if (hint.guideline) grouped.get(phase).push(`- \`${name}\`: ${hint.guideline}`);
      else if (hint.short_description) grouped.get(phase).push(`- \`${name}\`: ${hint.short_description}`);
    }

    const labels = PHASE_LABELS[lang] ?? PHASE_LABELS.en;
    const sections = [];
    for (const phase of PHASE_ORDER) {
      const items = grouped.get(phase) ?? [];
      if (!items.length) continue;
      const label = labels[phase] ?? labels.other;
      sections.push(`**${label}**\n${items.join('\n')}`);
    }
    return sections.join('\n\n');
  }

  return { language: lang, formatList, formatListWithUsage, formatTable, formatAliases, formatPhased };
}

/**
 * 按格式名渲染（上游 `compose_prompt_text`）。
 *
 * 未知格式**抛错**而不是回退到 `list`：静默回退会让提示词内容变少而没人发现
 * （`list` 只有一行 description），这种降级比直接失败更难查。
 */
export function composePromptText(hints, { format = 'list', language = 'en', ...options } = {}) {
  const composer = createPromptComposer(language);
  if (format === 'list') return composer.formatList(hints);
  if (format === 'list_with_usage') return composer.formatListWithUsage(hints);
  if (format === 'table') return composer.formatTable(hints, options.control_actions ?? null);
  if (format === 'aliases') return composer.formatAliases(hints);
  if (format === 'phased') return composer.formatPhased(hints);
  throw new Error(`Unsupported prompt format: ${format}`);
}

/** 出题链实际调用的那一条：`build_prompt_text(resolved, format="list_with_usage", language)`。 */
export function buildToolListText(names, language = 'en') {
  return composePromptText(promptHintsFor(names, language), { format: 'list_with_usage', language });
}

/** 空工具清单的兜底文案（上游 `_fallback_empty_tool_list`）。 */
export function fallbackEmptyToolList(language = 'en') {
  return normalizeHintLanguage(language) === 'zh' ? '- 无' : '- none';
}
