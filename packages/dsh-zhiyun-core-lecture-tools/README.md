# dsh-zhiyun-core-lecture-tools

智云 Pro **出题专用工具集**：讲义检索、讲义清单、按知识点读原文、历史题查询。

上游对应 `DeepTutor` 的 `tools/{builtin,question_bank,prompting,builtin_specs}.py`，
但**只搬出题时真正挂载的那四个工具**（判断依据见下文）。纯 JS、零第三方依赖、
讲义直接读内存、不调任何外部服务。

---

## 装与跑

```bash
node tests/lecture-tools.test.mjs    # 81 项，全绿
node --check src/index.js
```

> 不要用 `node --test`：本机会 `spawn EPERM`。

---

## 为什么只有四个工具

不是"挑了几个顺手的"，而是按 `agents/question/pipeline.py` 算出来的：

```python
def _mount_flags(self, context):      # 1596
    return ToolMountFlags(
        has_kb=bool(self.kb_name and not pageindex_context),
        has_sources=bool(self._source_index(context)),
        has_question_bank=user_has_question_bank(), ...)

def _resolved_tools(self, context):   # 1606
    names = compose_enabled_tools(registry=..., requested_tools=self.enabled_tools,
                                  optional_whitelist=default_optional_tools(),
                                  mount_flags=self._mount_flags(context))
    return drop_unconfigured_generation_tools([*names, *pageindex_tool_names])
```

| 来源 | 工具 |
|---|---|
| 用户开关（默认空） | —— |
| `has_kb` | `rag`, `kb_files`, `knowledge_frontier` |
| `has_sources` | `read_source` |
| `has_question_bank` | `question_bank` |
| 常开 | `write_memory`, `learning_status`, `learning_update`, `web_fetch`, `github`, `ask_user`, `cron` |
| workspace 基线 | `workspace_list`, `workspace_read`, `workspace_search`, `workspace_present` |

其中与「讲义 / 出题」相关的只有 **`rag` / `kb_files` / `read_source` / `question_bank`**。
`knowledge_frontier` 要联网调 arXiv，其余属于产品侧交互、记忆、笔记、文件工作区与
PageIndex SDK（运行时才能枚举出 schema，见 [NOTES.md](./NOTES.md) §7）。

---

## 对外契约

```js
import { createLectureTools, lectureToolSchemas } from 'dsh-zhiyun-core-lecture-tools';

const tools = createLectureTools({
  lecture: {                                    // 与 core-learning-resource 的 bundle 同形
    chapters: [{ title: '第一章 力学', topics: [
      { title: '牛顿第二定律', blocks: [{ kind: 'elaboration', text: '…' }] },
    ]}],
  },
  knowledge: { kbName: '力学讲义' },             // 可选：rag 的 kb_name 缺省值
  history: [{ id: 1, question: '…', is_correct: false, categories: [] }],  // 可选
  language: 'zh',                               // 影响工具输出语言，不影响 schema
});
// → [{name, description, parameters, handler}, …]  顺序：rag, kb_files, read_source, question_bank

const schemas = lectureToolSchemas(tools, { kbChoices: ['力学讲义'], sourceIds: ['t1-1'] });
// → OpenAI `tools` 参数：补 rag.query.minLength=1、收窄 enum、parameters.additionalProperties=false

const result = await tools[0].handler({ query: '牛顿第二定律', kb_name: '力学讲义' }, {});
// → {ok: true, result: {content, sources, metadata}}
// → {ok: false, error: '…'}
```

`handler` 的 `result` 是上游 `ToolResult` 的形状：**`content` 是裸文本**（模型读的就是它），
结构化信息在 `sources` / `metadata`（trace、UI、审计用，不进模型上下文）。
`core-tool` 的 `normalizeHandlerResult()` 认得这个形状，可以直接 `register()`。

### 四个工具

| 工具 | 干什么 | 输出 |
|---|---|---|
| `rag` | 在讲义里按查询检索（字面匹配，命中处带 `[t1-2]` 引用） | 命中段落 + `sources` |
| `kb_files` | 讲义清单：有多少个知识点、都叫什么、某个在不在 | 上游 `manifest.py` 的同一份文案（en/zh） |
| `read_source` | 按知识点 id 读该节全文 | 该节全部正文 |
| `question_bank` | 历史题查询（出题前查重）：`overview` / `list` | 上游 `question_bank.py` 的同一份文案 |

---

## 三条不能让步的约束

### 1. `description` 与 `parameters` 逐字来自上游

存在 `src/data/upstream.json`，由脚本从 vendor 生成（**不要手改**）：

```bash
python tools/gen-lecture-tool-data.py
```

模型看到的就是这些文字。改一个字都可能改变它的调用行为，而这条链的质量基线
（`writing_flaws ≥ 0.940` / `shortcuts ≥ 0.933`）是在原 schema 下测出来的。
所以 `parameters` 存的是**整份 JSON Schema**，不是参数行 —— `rag` 的 `region.minItems`、
`page.minimum`、`presentation.enum` 里那个 `null` 都是参数行表达不了的细节。

### 2. 讲义数据在内存里，没有第二个真相源

三个读工具共用 `buildLectureIndex()` 的同一份索引。id 是 `ch1` / `t1-2` / `b1-2-3`
（结构位置派生），与 `dsh-zhiyun-core-learning-resource` 的 `fromLecture()` **逐字一致**
—— 否则「题目回到来源」的链条会在两层之间断掉。

两个容易"顺手优化掉"的细节：

- **空正文块跳过，但位置照占**。第 3 块空了，第 4 块仍是 `b1-2-4`，不重排。
- **id 只依赖顺序，不依赖标题**。改标题不该让所有 id 重排。

### 3. 上游文案逐字对齐，包括 Python 的 `repr`

上游错误文案里有 `f"Unknown filter {filter_mode!r}"` —— `!r` 产出**单引号**，
而 JS 里顺手的 `JSON.stringify` 产出双引号。差一个字符也是差，所以本包带了一个
`py-repr.js`。比对方法是拿上游真实现跑基线：

```bash
python tools/gen-lecture-baseline.py     # 上游 Python 真跑的 29 个分支
node   tools/diff-lecture-tools.mjs      # 期望 ALL MATCH
```

---

## 与上游的有意差异

| 差异 | 理由 |
|---|---|
| `sources` 粒度 = 知识点（不含章 / 块） | 决定上游「唯一来源自动补 id」能否生效；块仍出现在 `rag` 的 metadata 里 |
| `rag` 引用 id 用知识点 id | 引用必须能被 `read_source` 读回去，否则模型白耗一轮迭代 |
| 精确来源选择器（page/region/figure/…）认参数但**明确拒绝** | 讲义没有 PDF 与像素；静默忽略会诱导模型编造"如图所示" |
| `kb_files` 的 qualifier 留空 | 本地讲义没有 provider / 索引状态；编一个"索引就绪"是在骗模型 |
| `question_bank` 的写动作如实拒绝 | 题库由宿主维护；上游那句 "The learner sees this immediately" 不能假着说 |

完整理由见 [NOTES.md](./NOTES.md)。

---

## 目录

```
src/
  index.js         契约入口：createLectureTools / lectureToolSchemas / pickLectureTools
  definitions.js   从 data/upstream.json 组装工具定义（每次新对象，可安全打补丁）
  schema.js        JSON Schema 生成 + 上游 _build_llm_tool_schemas 的三处补丁
  lecture-index.js 讲义 → 索引（id 派生、空块跳过、字面检索打分）
  rag.js           检索；精确来源选择器校验与拒绝文案
  kb-files.js      清单渲染（上游 manifest.py 的 en/zh 文案）+ glob / limit 归一
  read-source.js   按知识点取全文 + 三条错误语义
  question-bank.js 历史题查询（action/statement 渲染、store 适配器）
  prompt-hints.js  上游 prompting 的 JS 对位（{tool_list} 的内容，五种格式）
  py-repr.js       Python repr 的 JS 对位（错误文案里的引号形式）
  data/upstream.json  生成物：schema / hint / 清单文案 / 题库常量
tests/
  lecture-tools.test.mjs
```

---

## 与 `core-tool` 的关系

本包**不 import** `core-tool`：它只需要「工具是普通对象」这一个约定。
`lectureToolSchemas()` 的产出与 `core-tool` 的 `toOpenAISchema()` **形状完全一致**
（`{type:'function', function:{name, description, parameters}}`），两者可互换：

```js
import { createToolRegistry } from 'dsh-zhiyun-core-tool';
const registry = createToolRegistry();
for (const tool of createLectureTools({ lecture })) registry.register(tool);
registry.schemas(['rag', 'read_source']);   // 与 lectureToolSchemas() 同形
```
