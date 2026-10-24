# Quiz 出题基准台

```powershell
npm run bench:quiz
# 固定端口、不自动打开浏览器
npm run bench:quiz -- --port 8801 --no-browser
```

与 `scripts/knowledge_tree_bench` 同样采用本机页面、真实产品插件装配、完整 JSONL 日志与事后产物查看。调用的是 `dsh-zhiyun-core-quiz.apply()` 提供的 `generatePoints`，不在基准里实现另一套出题器。接口默认值、OpenAI 兼容流式传输和日志写入器与知识树基准共用。

## 资料

- 自动列出 `scripts/knowledge_tree_bench/data/.logs` 中有终稿全文的日志。使用产品的讲义文本 codec 和知识点投影恢复正文；拒绝只有截断讲义事件的日志。
- 支持导入单个产品记录、`{records:[...]}`、v4 讲义 JSON，或同时选择原 bench 工作目录的 `parsed.json` 与 `lecture-final.json`。
- 也可导入 `{id,title,points:[{id,title,text,courseId,subId,blockIndexes}]}`。`text` 必须为完整材料。知识点使用产品的来源归属规则。
- `--sources-dir <目录>` 指定另一份知识树日志目录，`--out-dir <目录>` 指定产物目录。
- 合成教材是显式桩模式，只检验基准流程，不能说明真实模型质量。第一次可先选它试跑。

## 怎么比较

四策略与四题型交叉组成兼容的评测单元，分别测试基础巩固、理解拓展、应用变式、综合探究。不兼容组合不替换成别的题型；如果某策略没有任何兼容题型则报错。

每个策略/题型/题量/独立重复均冷启动；同一单元的连续批次共享概念缓存和完整历史，模拟用户连续生成。不同单元互不共享缓存，避免比较被先跑者污染。支持 1–4 个题量梯度、1–10 个连续批次、1–5 次独立重复，矩阵最多 200 批。建议先从 **每批 10 题 × 3 批 × 1 次重复**开始，再扩大范围。

种子固定知识点分配；每批的实际计划与资料均保存。模型输出与产品的随机挖空抽取仍可能波动，种子不承诺模型结果完全相同。报告保存供应商地址、模型、出题内核版本与源码摘要；配置、内核或资料变化后拒绝混入原评测继续。独立重复的 `trials` 报告平均值和总体标准差，`n` 为有观测值的次数。

逐批记录新增知识点/概念、累计覆盖、底稿内覆盖、题量分布 CV、完全重复、疑似近义重复、新拓展角度、题目家族、来源匹配、模型调用、失败、耗时和供应商返回的 token 数。没有 token 回报时保持未知；部分回报用 `usageReported` 明示，不按估算值假装实测成本。应用变式的近义相似只提示，不直接判失败。

## 真覆盖率与人工复核

**底稿内覆盖以系统已提取概念为分母，不等于真实知识覆盖。** 没有独立金标时，金标覆盖、答案正确性等显示“无法判定”，不会画成通过。模型自带复核结果不是金标。

先独立编写金标，例如：

```json
{"concepts":[
  {"id":"probability-definition","label":"概率的含义","required":true,"weight":2},
  {"id":"probability-range","label":"概率取值范围","required":true,"weight":1}
]}
```

在开始前导入，或跑完后点击“下载人工复核模板”，在模板 `gold` 中补入。模板同时提供概念原文与题目，人工为它们填写 `goldIds` 并设 `reviewed:true`；题目可填写 `correct`、`answerable`、`uniqueAnswer`、`meaningfulBlank`、`leaked`、`novel` 的布尔值。然后导入模板重新计算。未知项保留 `null`，不用强填。`leaked:true` 表示发生答案泄露，其余质量布尔项的 `true` 表示符合要求。

人工映射给出概念提取召回、出题覆盖、加权覆盖与质量指标；未全量复核时只报告已确认的覆盖下界，“未在已复核题中命中”不等于确定遗漏。资料摘要不匹配、无效金标和未知题号会拒绝导入。原始报告保留，复核另存。

## 进度、预算与恢复

模型 Key 只在内存中，从 stdin 或本机页面请求传递，不放入命令参数或磁盘；不会自动读取 App 私人凭据。本机 API 均验证一次性 token，并拒绝跨站请求。产物默认在被忽略的 `artifacts/quiz-bench/`，可能包含私人课堂资料，不应提交。

每次启动默认最多 120 次模型调用，可调 1–1000。达到预算、手动停止或关闭页面时保留 `state.json`；每个阶段和题目写入后立即更新断点。报告中可点击继续，重新填写凭据，沿用资料、分配与缓存。预算是**每次启动**的上限，恢复后的累计调用如实合计。完整完成但有缺额的批次保持缺额，不自动重试到“全绿”；新评测重新冷启动。

报告状态区分 `completed`、`partial`（有缺额）、`interrupted`、`failed`；合成模式另有明显标记。外部联网能力不在本轮控制变量内，基准默认使用课内资料。

## 命令行

```powershell
# 免费、显式合成桩演练
node scripts/quiz_bench/run.mjs --fixture --out artifacts/quiz-bench/demo
# 继续同一份评测
node scripts/quiz_bench/run.mjs --fixture --resume --out artifacts/quiz-bench/demo
```

实际模型评测从 stdin 读 JSON，字段包含 `input`（产品记录 JSON、原 bench 工作目录或 JSONL 日志）、`apiKey`、`baseUrl`、`model`，以及 `counts`、`batches`、`repeats`、`strategies`、`types`、`mode`、`difficulty`、`seed`、`maxCalls`。也可直接传入 `dataset`，或附带独立 `gold`。凭据不要写进配置文件；推荐本机页面输入。

每行事件以 `@@EV@@` 开头。每次产物包括：

| 文件 | 用途 |
|---|---|
| `events.jsonl` | 顺序事件、完整模型输入输出、概念底稿与题目，可回看 |
| `state.json` | 原始分配、历史、概念与逐题断点，供恢复 |
| `report.json` | 全量原始指标、各独立重复统计和题目 |
| `report.md` | 简要比较表 |
| `review.json` / `report-reviewed.*` | 人工复核与重新计算报告，不覆盖原始数据 |

```powershell
npm run test:quiz-bench
node scripts/test-quiz-bench.mjs
```

测试使用合成教材和可编程回包，覆盖装配、预算恢复、日志连续性、指标分母、冷/热缓存隔离、金标导入、凭据擦除及浏览器实际交互，不调用付费模型。
