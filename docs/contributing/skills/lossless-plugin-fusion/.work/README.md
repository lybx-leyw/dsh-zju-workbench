# 无损融合 · 工作记录索引

> 这个目录放**过程产物**：实施清单、裁决、溯源报告、覆盖度审计、缺口清单。
> 接手的人从 [`HANDOFF.md`](HANDOFF.md) 开始读。

最后更新：2026-11-11

---

## 先读这三份

| 顺序 | 文件 | 看什么 |
| --- | --- | --- |
| 1 | [`HANDOFF.md`](HANDOFF.md) | **现状、分工、还剩什么、接手须知** |
| 2 | [`coverage-gaps.md`](coverage-gaps.md) | **还差什么**（唯一权威的缺口记录） |
| 3 | [`zju-assistant-impl-plan.md`](zju-assistant-impl-plan.md) | 整体清单 + 裁决汇总（D1–D21） |

---

## 裁决与决策

| 文件 | 内容 |
| --- | --- |
| [`zju-assistant-impl-plan.md`](zju-assistant-impl-plan.md) | 实施清单；第 32 行起是**裁决汇总 D1–D21** |
| [`zju-assistant-decisions.md`](zju-assistant-decisions.md) | 裁决的推理过程与备选方案 |
| [`zju-assistant-qa-approval.md`](zju-assistant-qa-approval.md) | 审批服务溯源（宿主 `ctx.approval` 的契约） |
| [`campus-split-plan.md`](campus-split-plan.md) | `source/campus` 拆成 `xuezai` + `pta` 的七步方案 |

---

## 覆盖度审计

| 文件 | 内容 |
| --- | --- |
| [`coverage-audit-batch-a.md`](coverage-audit-batch-a.md) | 批次 A：`zdbk` / `cc98` / `tyys` / `xuezai`（76 条 provides） |
| [`coverage-audit-batch-b.md`](coverage-audit-batch-b.md) | 批次 B：`lab` / `pta` / `sztz` / `xxt` / `classroom` + 四小包（71 条） |
| [`coverage-gaps.md`](coverage-gaps.md) | **两份审计的汇总结论 + 我自查的缺口** |

审计的核心发现：**覆盖率是假的**。表面 87–93%，但「名对了、功能废了」的条目
在实机上一个请求都发不出去。已修 8 处（见 `coverage-gaps.md` 第零、零之二节）。

---

## 逐包溯源（融合前的事实调查）

| 文件 | 内容 |
| --- | --- |
| [`zju-assistant-inventory.md`](zju-assistant-inventory.md) | 上游资产总览 |
| [`zju-assistant-entry-map.md`](zju-assistant-entry-map.md) | 入口映射 |
| [`zju-assistant-fusion.json`](zju-assistant-fusion.json) | 逐文件融合映射（1127 行，机器可读） |
| [`zju-assistant-trace-1-tools.md`](zju-assistant-trace-1-tools.md) | 溯源 1：工具注册 |
| [`zju-assistant-trace-2-approval.md`](zju-assistant-trace-2-approval.md) | 溯源 2：审批 |
| [`zju-assistant-trace-3-preset-skill.md`](zju-assistant-trace-3-preset-skill.md) | 溯源 3：preset 与 skill 机制 |
| [`zju-assistant-trace-4-slots.md`](zju-assistant-trace-4-slots.md) | 溯源 4：页面挂载槽 |
| [`zju-assistant-trace-5-campus.md`](zju-assistant-trace-5-campus.md) | 溯源 5：`source/campus` 拆包 |
| [`zju-assistant-source-tool-split.md`](zju-assistant-source-tool-split.md) | 读写分层方案 |
| [`zju-assistant-source-progress.md`](zju-assistant-source-progress.md) | 各数据源进度 |

---

## WebVPN（独立计划）

| 文件 | 内容 |
| --- | --- |
| [`zju-assistant-webvpn-plan.md`](zju-assistant-webvpn-plan.md) | W1–W8 阶段计划 |
| [`zju-assistant-webvpn-coverage.md`](zju-assistant-webvpn-coverage.md) | 覆盖度与风险备注 |

⚠️ 该计划有两项**未解除的风险**：真实校外网络从未验证（R-1）；
`setWebvpnSession` 当前无人调用，校外场景 `source/http` 仍抛 `WEBVPN_REQUIRED`（R-3）。

---

## 质量与验收方法

| 文件 | 内容 |
| --- | --- |
| [`acceptance-checklist.md`](acceptance-checklist.md) | 验收清单 |
| [`acceptance-baseline-tyys-notice.md`](acceptance-baseline-tyys-notice.md) | `tyys` / `notice` 的验收基线 |
| [`source-package-checklist.md`](source-package-checklist.md) | 单个数据源包的完成标准 |
| [`source-metrics-method.md`](source-metrics-method.md) | 怎么核对数字（**每个数字要用两种方法验**） |
| [`parallel-dispatch-rules.md`](parallel-dispatch-rules.md) | 派子代理时的规则与踩过的坑 |
| [`audit-yjsy.md`](audit-yjsy.md) · [`audit-chalaoshi.md`](audit-chalaoshi.md) · [`audit-ebook.md`](audit-ebook.md) · [`audit-cnki.md`](audit-cnki.md) | 四个包的逐个审核记录 |

---

## 一条要记住的教训

本目录的 `coverage-gaps.md` 第五节记录了我犯过的一个流程错误：
**把自己判断的「不做」写成了「裁决」**。

现在的规矩：注释里不许出现「不做 / 丢弃 / 不搬运」，除非能指向一条编号裁决。
没做就写「尚未实现」并记进缺口清单。
