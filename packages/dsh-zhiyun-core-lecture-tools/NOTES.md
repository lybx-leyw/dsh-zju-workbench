# NOTES —— 从 Python 源码读出的关键行为

> 对象：`packages/dsh-zhiyun-host-deeptutor/vendor/deeptutor/deeptutor/tools/`
> 以及决定「出题到底挂哪些工具」的 `agents/question/pipeline.py`。
> 行号指上述文件。本文只记录**不明显、但改了就会掉分**的东西。

---

## 0. 一句话结论

出题链真正挂载的讲义类工具只有四个：**`rag` / `kb_files` / `read_source` / `question_bank`**。
其余内置工具（exec、web_fetch、github、cron、ask_user、memory、notebook、workspace、
knowledge_frontier、media_gen…）不是「与出题无关」，就是属于产品侧交互与记忆子系统。
判断依据不是 `tools/builtin/__init__.py`（那是全部工具的目录），而是
`pipeline.py` 的 `_resolved_tools()` + `compose_enabled_tools()`。

---

## 1. 挂载清单是怎么算出来的（这条最容易搞错）

`pipeline.py:1596`：

```python
def _mount_flags(self, context):
    return ToolMountFlags(
        has_kb=bool(self.kb_name and not getattr(self, "_pageindex_tool_context", None)),
        has_sources=bool(self._source_index(context)),
        has_memory=user_has_memory(),
        has_notebooks=user_has_notebooks(),
        has_question_bank=user_has_question_bank(),
        has_exec=exec_capability_available(),
    )
```

`_resolved_tools()`（1606）= `compose_enabled_tools(...)` 的结果 + PageIndex 工具，
再经 `drop_unconfigured_generation_tools()`（只影响 `imagegen` / `videogen`）。

`compose_enabled_tools()`（`_shared/tool_composition.py:174`）的拼接顺序：

1. 用户开关（`registry.get_enabled(requested_tools)` ∩ `optional_whitelist`）
   —— 纯讲义出题时 `enabled_tools` 为空，这一项**没有贡献**；
2. `_CONDITIONAL_MOUNT_FLAGS` 里 flag 为真的工具，**按该 dict 的插入顺序**追加：
   `preprint`/`research_*`（scientific）、`rag`/`kb_files`/`knowledge_frontier`（has_kb）、
   `read_source`（has_sources）、`read_memory`、`list_notebook`/`write_note`、
   `question_bank`（has_question_bank）、`read_skill`、`load_tools`、`exec`、`mastery_*`；
3. `capability_owned`（出题链为空）；
4. 常开：`write_memory`、`learning_status`、`learning_update`、`web_fetch`、`github`、
   `ask_user`、`cron`；
5. 最后 `_finalize([*WORKSPACE_BASELINE_TOOLS, ...])` —— **四个 `workspace_*` 永远在最前**。

由此推出本包只搬四个工具的选择：

| 上游工具 | 为什么不要 |
|---|---|
| `knowledge_frontier` | 要调 arXiv 联网；本仓讲义是离线的 |
| `write_memory` / `read_memory` / `learning_*` | 记忆与学习日志，属于产品侧子系统 |
| `write_note` / `list_notebook` | 笔记落盘，由 `core-notes` 负责 |
| `workspace_*` | 文件工作区，与讲义无关 |
| `web_fetch` / `github` / `cron` / `ask_user` | 交互与外部抓取 |
| `exec` / `imagegen` / `videogen` / `preprint` … | 明确无关 |
| PageIndex SDK 工具 | 见 §7 |

> **顺序也是契约**。`_Conditional_MOUNT_FLAGS` 的插入顺序决定了提示词 `{tool_list}`
> 的顺序，也决定了 `build_openai_schemas()` 返回的 schema 数组顺序。模型的选择受
> 顺序影响 —— 本包的 `LECTURE_TOOL_ORDER` 就照那张表排：`rag, kb_files, read_source, question_bank`。

---

## 2. `_build_llm_tool_schemas()` 会就地改三处（1625）

```python
for schema in schemas:
    parameters["additionalProperties"] = False         # 所有工具
    if name == "rag":
        properties["query"].setdefault("minLength", 1)
        if kb_choices:
            properties["kb_name"]["enum"] = kb_choices
    if name == "read_source":
        if source_ids:
            properties["source_id"]["enum"] = source_ids
```

三件事：

1. **`query` 的 `minLength:1` 是 `setdefault`** —— schema 里已经有别的值时不覆盖。
2. **`kb_name` / `source_id` 被收窄成 enum，取值来自本轮真实挂载的东西**
   （`[self.kb_name]` / `sorted(source_index)`）。这是幻觉防线：模型连发都不会发一个
   不存在的 id。本包的 `lectureToolSchemas(tools, {kbChoices, sourceIds})` 复刻这条。
3. **`additionalProperties:false` 是全局的**，包括没有 `properties` 的 schema。

`has_kb` 与 PageIndex 互斥（1598 行 `and not ... _pageindex_tool_context`）：一旦
PageIndex 挂上，`rag`/`kb_files`/`knowledge_frontier` 全部**不挂**，改成 PageIndex 的
SDK 工具 + `_kb_system_note()` 里那段"不要调用 rag"的说明。本仓没有 PageIndex，
所以走的是前者 —— **这个分支选择决定了本包的存在意义**。

---

## 3. `rag` 的 schema 是 `raw_parameters`，不是参数行

`RAGTool.get_definition()`（`builtin/__init__.py:167`）在最后两行干了这件事：

```python
schema = definition.to_openai_schema()["function"]["parameters"]
schema["properties"]["presentation"]["type"] = ["string", "null"]
schema["properties"]["presentation"]["enum"].append(None)
definition.raw_parameters = schema
```

所以 `presentation` 的 type 是 `["string","null"]`、enum 里**有一个 `null`**。
`region` 带 `minItems: 4` / `maxItems: 4` / `items:{type:number,minimum:0,maximum:1}`，
`page` 带 `minimum: 1`。

**如果改成参数行再编码一遍**，`region.items` 的 minimum/maximum 与 enum 里的 `null`
都会丢 —— 它们不是 `ToolParameter.to_schema()` 表达得了的东西。这就是本包把
整份 schema 存进 `src/data/upstream.json` 而不是写成参数行的原因。

---

## 4. `read_source` 的三条错误语义（1059）

```python
if not source_index:                       → "Error: no attached sources are available for this turn."
if not source_id:
    if len(source_index) == 1: source_id = next(iter(source_index))   # 自动补
    else: → "Error: source_id is required when multiple sources are available."
if unknown:                                 → f"Error: unknown source_id {source_id!r}. Valid ids for this turn: {available}."
```

三条都不能省：

- **唯一来源时自动补 id**：让模型多跑一轮没有收益（猜的唯一答案就是它）。
  这条是「`sources` 的粒度」必须谨慎的原因：若把章 / 知识点 / 块三级都塞进
  `source_index`，一份只有一节的讲义也会有 3 条来源，这条分支永远走不到。
- **多来源却缺 id 必须拒绝**：默认取第一个会让模型养成"不填 id 也能拿到东西"的习惯，
  多来源时必然取错，而且错得**看不出来**（它拿到的是一份真实正文）。
- **未知 id 要点名可用 id**：这三个字（`Valid ids for this turn`）是模型自纠的唯一线索。

`{source_id!r}` 是 Python `repr`，产出**单引号**。JS 里顺手写的 `JSON.stringify` 产出
双引号，于是整句文案就与上游差一个字符。本包为此单独做了 `src/py-repr.js`。

---

## 5. `kb_files` 的清单文案由 `manifest.py` 决定，且渲染在数据层

`knowledge/manifest.py` 的文件头把理由写得很清楚：**检索说不出集合有多大**。
所以清单是独立的一等公民，而且：

- `MANIFEST_NOTE_LIMIT = 20`（系统提示里的清单）
- `KB_FILES_DEFAULT_LIMIT = 200`、`KB_FILES_MAX_LIMIT = 1000`（工具按需给全量）
- `_filter_names()`：pattern 含 `*?[` 走 **fnmatch**（大小写不敏感，全名与末段各试一次），
  否则按子串。`fnmatch` 的名字匹配是**大小写不敏感**的（`manifest.py` 里显式 `.lower()`）。
- `_kb_files_limit()`：`int(raw)` 失败 / ≤0 → 默认值，超上限 → 上限。**不抛错**。
  注意 `int("42.5")` 在 Python 里**抛 ValueError**（→ 默认 200），而 `parseInt("42.5")`
  静默给 42 —— 一个把坏参数当好的归一函数，会让可观测的异常变成看起来正常的 42。
- `render_manifest_report()` 的文案分 en/zh 两套，`zh` 的判定是 `language.startswith("zh")`。
- `_qualifier()` 会拼 provider + 索引状态（`(llamaindex, index ready)`）。**本地讲义没有
  这两个概念**，所以本包的 qualifier 留空 —— 形状不变，但不编造一个不存在的状态。

---

## 6. `question_bank` 的六个动作、三态与"永不抛错"

`tools/question_bank.py`：

1. **`run_question_bank()` 承诺永不抛错**（docstring: "Never raises — errors come back typed"）。
   题库是辅助能力，它出问题不该中断整轮出题。但它**吞的是"动作层"的异常**：
   `except Exception → QuestionBankOutcome(ok=False, error=f"Question bank error: {exc}")`。
2. **`is_correct` 有三态**（`agents/question/history.py` 的注释）：DB 的 0/1 列分不清
   "答错"与"还没答"，所以以 `user_answer` 是否为空为准 —— 没作答时是 `None`，
   提示词渲染成 "unknown" 而不是误导性的 "incorrect"。
   注意：**`history.py` 与 `question_bank.py` 是两套语义**。前者给探索提示词用（三态），
   后者给题库整理用（`✗` = 答错）。本包实现的是后者（工具输出），
   但 `createBankStore` 接受两种字段名。
3. **`organize` 按名字寻址，分类不存在就新建**。docstring 的理由：
   "the learner says 'my mistakes set', not 'category 7'"，而 create-then-file 是
   多一个模型掉球的环节。
4. **`_render_categories` 的空态是 `(no categories yet — \`organize\` creates one by name)`** ——
   这句本身就是给模型的操作提示，不是占位符。
5. **`record` 用内容哈希做 `question_id`**：`"pq_" + sha1(折叠空白 + casefold)[:16]`，
   让"同一道错题重复记录"更新原行而不是堆重复。
6. `_coerce_ids()` 会把 `[3, "4", "id-5"]` 里的坏值**收集起来并回显**
   （"Ignored non-numeric ids: ..."），而不是静默丢弃 —— 静默丢弃会让部分成功
   看起来像完全成功。

> 本包只实现读动作（`overview` / `list`）。写动作**如实拒绝**并说明原因：
> 上游文案里有一句 "The learner sees this immediately under Learning Space → Question Bank."
> 假成功会让模型对用户宣布一件没发生的事。

---

## 7. PageIndex 分支为什么不做

`_prepare_pageindex_tools()`（1580）在 `run()` 一开始就尝试挂 PageIndex SDK 工具
（`services/rag/pipelines/pageindex/tools.py`）。它们的 schema 来自**运行时的 SDK**
（`self._sdk_tool.params_json_schema`），名字是 `pageindex_cloud_<sdk tool>` /
`pageindex_oss_<sdk tool>` —— 也就是说**工具名和参数都不在源码里**，要装 `pageindex`
这个 Python 包才能枚举出来。本机 `import pageindex` 失败（未安装），仓库也不带这个依赖。

结论：这条分支在「不新增依赖」的前提下无法逐字复刻，而它一旦挂上就会**顶掉**
`rag`/`kb_files`（见 §2 的互斥），所以本包走的是无 PageIndex 的那条路 ——
与纯讲义出题的实际运行路径一致。

---

## 8. 提示词 hint 是另一份文案，且格式很具体

`tools/prompting/__init__.py` 的 `load_prompt_hints()` 从 `hints/{en,zh}/<tool>.yaml` 读，
`format_list_with_usage()` 的产出进 `explore.system` / `quiz_step.system` 的 `{tool_list}`：

```
- `read_source` — <short_description>
    When to use: <when_to_use>
    Input: <input_format>
```

三个细节：

- 缩进是**四空格**，不是两空格。这段文字进的是 system prompt 的 Markdown，
  缩进变化会让它渲染成嵌套列表。
- 没有 `short_description` 的工具**整条跳过**，不留空 bullet。
- `zh` 的标签是"适用场景" / "参数格式"，不是翻译成"何时使用"。

`_fallback_empty_tool_list()` 是 `- 无` / `- none`。注意 `_use_native_tools()` 的注释
（1616）：**返回 True 但没有工具**会让模型在正文里编造文本式 tool call，所以必须
"有工具"且"模型支持"两个条件同时成立才挂 native tools；但提示词里的 `{tool_list}`
**永远在**（无工具时渲染成 `- 无`）。

---

## 9. 工具结果的形态

- `rag` / `kb_files` / `read_source` 的 `ToolResult.content` 都是**裸文本**，不是 JSON。
  原因是 token 成本与可读性：正文动辄几千字，套 JSON 要多一层转义。
  结构化信息在 `metadata` / `sources` 里（trace、UI、召回审计用，不进模型上下文）。
- `rag` 的 `sources` 形状是 `{type:'rag', kb_name, ...provenance}`，provenance 来自检索
  管道（`title/content/source/page/chunk_id/score`）。上游 `_rag_sources()` 有一条
  容易漏的规则（`builtin/__init__.py:75`）：**只有成功且非空的答案**才允许把
  "查询本身"当作 citation；空结果 / 失败要返回**空** sources（issue #1500）。
- 失败时 `success=False` 但 `content` 仍可读（模型要读那段错误文案才能自纠）。

---

## 10. `findInlineLabels` 与工具文案互相影响（跨包）

`runtime/agentic/labels.py:152` 的 `find_inline_labels()` 会扫**行首**
`` ``TOOL`` `` / `` ``FINISH`` `` / `` ``THINK`` ``。工具 description 一旦多行且某行以
这三个词开头（包裹反引号与否都算），就会被判成"第二次出现协议标签"，
触发一轮协议违规重试 —— 白耗一次迭代，而且模型会看到一条莫名其妙的纠正。

本包的做法：**四个工具的 description 保持单行、不含 `{}`、不含裸的
FINISH/TOOL/THINK 大写词**，并在单测里锁死（`description 里没有会被 findInlineLabels 误判的字符`）。
参数描述同样受检。

---

## 11. 本包与上游的**有意**差异（都会在下面注明理由）

| 差异 | 理由 |
|---|---|
| `sources` 粒度 = 知识点（不含章 / 块） | §4：决定"唯一来源自动补 id"能否生效 |
| `rag` 的引用 id 用知识点 id，块 id 进 metadata | 引用必须能被 `read_source` 读回去，否则模型白耗一轮 |
| 精确来源选择器（page/region/figure/…）**认参数但拒绝** | 讲义没有 PDF 与像素；静默忽略会诱导模型编造"如图所示" |
| `kb_files` 的 qualifier 为空 | 本地讲义没有 provider / 索引状态；编一个"索引就绪"是在骗模型 |
| `question_bank` 的写动作如实拒绝 | 题库由宿主维护；假成功会让模型宣布一件没发生的事 |
| 检索是**字面**匹配（非向量） | 与 `core-knowledge` 同一层定位：命中理由永远说得清 |

---

## 12. 为什么没有 Cordis 插件壳

同层的 `core-tool` / `core-llm` 都只导出纯函数（没有 `apply` / `inject`），本包沿用同一约定。
更实际的理由：工具集是**每个 turn 用不同讲义构造一次**的东西 —— 做成插件级单例，
上一轮的讲义与题库就会留在闭包里，换课/换账号时串数据。所以只有工厂，没有单例。

---

## 13. 维护手法

`src/data/upstream.json` 是生成物，**不要手改**：

```bash
# 从 vendor 重新抽 schema / hint / 清单文案
python tools/gen-lecture-tool-data.py

# 用上游真实现产出输出基线，再与 JS 逐字比对
python tools/gen-lecture-baseline.py
node   tools/diff-lecture-tools.mjs      # 期望 ALL MATCH

# 本包单测
cd packages/dsh-zhiyun-core-lecture-tools && node tests/lecture-tools.test.mjs
```

`diff-lecture-tools.mjs` 覆盖 question_bank 的 12 个分支、kb_files 的 12 个渲染分支、
read_source 的 5 条路径。这是"文案没漂"的唯一机械证明 —— 单测里的硬编码期望值
是从这份基线抄进去的，用来挡住"重跑生成脚本把错的东西固化下来"。
