# Quiz 架构实验

当前版本已冻结为 **v2-候选r1**，源码摘要见 `CANDIDATE.json`。后续 [v2-r2](../experimental-r2/README.md) 在独立目录实验，不覆盖本候选，也不自动接入产品。

此目录是明确隔离的研究入口，App、原包配置、构建入口与 profile 均不引用它。不自动注册插件，也不读取或更改 App 的题库、供应商设置及生成任务。

`points.mjs` 是当前 v5 调度器的独立研究快照；来源和原文件摘要见 `fork-manifest.json`。复用原包的解析、概念身份、挖空、账本、worker 和持久化工具，实验替换来源档案、蓝图、复核契约与查重。原实现更新时需要明确审阅并重做快照，不能让研究副本悄悄漂移。

- `source.mjs`：逐位置核对来源并生成局部冲突档案，要求相同实例、不同结果与精确引文。没有原文证据不能隔离整篇。
- `blueprint.mjs`：共享知识点准备后，为全部单题任务先生成可追溯蓝图，再并发出题。基础记忆仍使用原有 fact/blank 预分配。
- `policy.mjs`：按策略复核。只有 recall 核对目标；选择题必须逐项核对真假且与唯一参考答案相符，解析也须成立。
- `rectification.mjs`：同知识点内分页比对完整历史，重复判定必须提供有效的新题 ID、较早匹配 ID 和实质理由。不存在的对象或解析失败是待复核，不是放行。重复任务与单题失败均进入有界整改，保存断点。
- `run.mjs`：独立命令，只写指定实验目录。baseline 是当前产品既有算法加可选通用指引；lab-v2 是实验快照。保留完整模型回包、阶段输入、usage、请求时间线、计划和断点。不会调用更强模型。

```powershell
node --test tests/quiz-lab.test.mjs
node scripts/quiz_bench/experimental/run.mjs artifacts/quiz-lab-example paired
```

真实评测使用此前授权的本地真实素材和 `.env` 配置，勿将输入、输出或凭证提交到公开仓库。正式三轮对照与开发预跑分开统计；每组配额和预算相同。最终质量必须人工逐题核对，不能用系统放行数替代可用题数。未证明稳定收益前不接入产品。

来源与改写说明见 [ATTRIBUTION.md](ATTRIBUTION.md)。
